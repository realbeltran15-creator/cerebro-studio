-- Cache and usage log for Investigación. Each row is one paid YouTube Data API sample (search + videos + channels),
-- stored per user so the same topic/market is never fetched twice inside its lifetime and the daily budget can be enforced.
create table if not exists public.research_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  kind text not null default 'topic',
  payload jsonb not null,
  units integer not null default 0 check (units >= 0),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (owner_id, cache_key)
);
create index if not exists research_cache_owner_fetched_idx on public.research_cache (owner_id, fetched_at desc);
alter table public.research_cache enable row level security;
revoke all on public.research_cache from anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_cache' and policyname = 'research_cache_owner_all') then
    create policy research_cache_owner_all on public.research_cache for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

-- Coordination between server instances (Vercel runs several at once). Both functions are SECURITY INVOKER: row level security still applies
-- and the owner is always auth.uid(), never a parameter.

-- Start of the YouTube quota day: it resets at midnight Pacific time, not UTC.
create or replace function public.research_quota_day_start() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'
$$;

-- Atomic "check the daily budget and reserve units": the check and the insert happen under one advisory lock per user,
-- so two instances can never both pass the check before either one is recorded. A reservation that is never settled keeps counting.
create or replace function public.research_reserve(p_key text, p_units integer, p_cap integer, p_ttl_seconds integer)
returns jsonb language plpgsql as $$
declare uid uuid := (select auth.uid()); used integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'no_session', 'used', 0); end if;
  if p_units < 0 or p_cap < 0 then raise exception 'invalid units'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research_reserve:' || uid::text, 0));
  select coalesce(sum(units), 0) into used from public.research_cache where owner_id = uid and fetched_at >= public.research_quota_day_start();
  if used + p_units > p_cap then return jsonb_build_object('ok', false, 'reason', 'budget', 'used', used); end if;
  insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at)
  values (uid, p_key, 'reserve', '{}'::jsonb, p_units, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (owner_id, cache_key) do update set kind = 'reserve', units = excluded.units, fetched_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'used', used + p_units);
end $$;

-- Exclusive lease on one piece of work: true for exactly one caller until the lease expires or is released.
create or replace function public.research_lock(p_key text, p_ttl_seconds integer) returns boolean language plpgsql as $$
declare uid uuid := (select auth.uid()); got uuid;
begin
  if uid is null then return false; end if;
  insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at)
  values (uid, p_key, 'lock', '{}'::jsonb, 0, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (owner_id, cache_key) do update set kind = 'lock', fetched_at = now(), expires_at = excluded.expires_at
    where public.research_cache.expires_at <= now()
  returning id into got;
  return got is not null;
end $$;
revoke all on function public.research_reserve(text, integer, integer, integer), public.research_lock(text, integer) from public, anon;
grant execute on function public.research_reserve(text, integer, integer, integer), public.research_lock(text, integer) to authenticated;
