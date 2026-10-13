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
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_cache' and policyname = 'research_cache_owner_all') then
    create policy research_cache_owner_all on public.research_cache for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;
