-- Run by scripts/test-migrations.sh inside a throw-away database. Stubs mimic what Supabase provides.
\set QUIET on
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null);
alter table public.projects enable row level security;
create policy projects_own on public.projects for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant all on public.projects to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;  -- Supabase default
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.projects (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'A project'), ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'B project');

\echo == apply both migrations, twice (idempotent)
\i 20261013120000_research_cache.sql
\i 20261015120000_campaigns.sql
\i 20261013120000_research_cache.sql
\i 20261015120000_campaigns.sql

create function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label; exception when raise_exception then raise; when others then raise notice 'ok (rejected): %', label; end;
end $$;
grant all on function pg_temp.expect_fail(text, text) to public;

\echo == RLS: owner A can write and read; B sees nothing and cannot modify; anon sees nothing
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.campaigns (owner_id, name, brief, project_id) values ('00000000-0000-0000-0000-00000000000a', 'camp A', '{"goal":"views"}', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.research_cache (owner_id, cache_key, payload, units, expires_at) values ('00000000-0000-0000-0000-00000000000a', 'k1', '{}', 204, now() + interval '7 days');
do $$ begin if (select count(*) from public.campaigns) <> 1 then raise exception 'A should see its campaign'; end if; end $$;
select pg_temp.expect_fail($q$insert into public.campaigns (owner_id, name) values ('00000000-0000-0000-0000-00000000000b', 'spoof')$q$, 'A cannot create rows owned by B');
select pg_temp.expect_fail($q$insert into public.campaigns (owner_id, name, project_id) values ('00000000-0000-0000-0000-00000000000a', 'x', 'bbbbbbbb-0000-0000-0000-000000000001')$q$, 'A cannot link B''s project');
select pg_temp.expect_fail($q$insert into public.campaigns (owner_id, status) values ('00000000-0000-0000-0000-00000000000a', 'hack')$q$, 'invalid status');
select pg_temp.expect_fail($q$insert into public.research_cache (owner_id, cache_key, payload, units, expires_at) values ('00000000-0000-0000-0000-00000000000a', 'k2', '{}', -5, now())$q$, 'negative units');
select pg_temp.expect_fail($q$insert into public.research_cache (owner_id, cache_key, payload, units, expires_at) values ('00000000-0000-0000-0000-00000000000a', 'k1', '{}', 1, now())$q$, 'duplicate cache key per owner');
select pg_temp.expect_fail($q$insert into public.campaigns (owner_id, brief) select '00000000-0000-0000-0000-00000000000a', jsonb_build_object('x', repeat('a', 300000))$q$, 'oversized brief');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.campaigns) <> 0 then raise exception 'B must not see A''s campaigns'; end if;
  if (select count(*) from public.research_cache) <> 0 then raise exception 'B must not see A''s cache'; end if;
  update public.campaigns set name = 'hijack'; if found then raise exception 'B must not update A''s campaigns'; end if;
  delete from public.campaigns; if found then raise exception 'B must not delete A''s campaigns'; end if;
end $$;
reset role;
set role anon; reset request.jwt.claim.sub;
select pg_temp.expect_fail($q$select count(*) from public.campaigns$q$, 'anon has no privileges on campaigns');
select pg_temp.expect_fail($q$select count(*) from public.research_cache$q$, 'anon has no privileges on research_cache');
reset role;

\echo == the write pattern of the app: upsert on (owner_id, cache_key), usage lines, daily sum, expiry
insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at) values ('00000000-0000-0000-0000-00000000000a', 'v2|topic|x', 'topic', '{"v":1}', 0, now(), now() + interval '7 days')
  on conflict (owner_id, cache_key) do update set payload = excluded.payload, units = excluded.units, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at) values ('00000000-0000-0000-0000-00000000000a', 'v2|topic|x', 'topic', '{"v":2}', 0, now(), now() + interval '7 days')
  on conflict (owner_id, cache_key) do update set payload = excluded.payload, units = excluded.units, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at) values
  ('00000000-0000-0000-0000-00000000000a', 'v1|usage|topic|1|a', 'usage', '{}', 102, now(), now() + interval '2 days'),
  ('00000000-0000-0000-0000-00000000000a', 'v1|usage|topic|2|b', 'usage', '{}', 102, now(), now() + interval '2 days'),
  ('00000000-0000-0000-0000-00000000000a', 'v1|usage|old|3|c', 'usage', '{}', 500, now() - interval '2 days', now() - interval '1 day');
do $$ begin
  if (select count(*) from public.research_cache where cache_key = 'v2|topic|x') <> 1 then raise exception 'upsert created a duplicate'; end if;
  if (select payload->>'v' from public.research_cache where cache_key = 'v2|topic|x') <> '2' then raise exception 'upsert did not replace the payload'; end if;
  if (select coalesce(sum(units), 0) from public.research_cache where owner_id = '00000000-0000-0000-0000-00000000000a' and fetched_at >= public.research_quota_day_start()) <> 204 + 204 then raise exception 'daily sum wrong (k1 had 204 units from the RLS test)'; end if;
  if (select count(*) from public.research_cache where expires_at < now()) <> 1 then raise exception 'expiry bookkeeping wrong'; end if;
end $$;

\echo == atomic functions: reserve under the cap, refuse over it, lock exclusivity, expiry takeover, Pacific quota day, owner isolation
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare r jsonb; got boolean; begin
  -- A already has 408 units today (see above): cap 600 leaves room for exactly one 102 and then one more 90
  r := public.research_reserve('v2|reserve|t1', 102, 600, 600); if not (r->>'ok')::boolean or (r->>'used')::int <> 510 then raise exception 'reserve 1 wrong: %', r; end if;
  r := public.research_reserve('v2|reserve|t2', 102, 600, 600); if (r->>'ok')::boolean or r->>'reason' <> 'budget' then raise exception 'reserve over the cap must be refused: %', r; end if;
  if (select count(*) from public.research_cache where cache_key = 'v2|reserve|t2') <> 0 then raise exception 'a refused reservation must not leave a row'; end if;
  -- settling = the row becomes a usage line with the real units; releasing = delete
  update public.research_cache set kind = 'usage', units = 50 where cache_key = 'v2|reserve|t1';
  r := public.research_reserve('v2|reserve|t3', 102, 600, 600); if not (r->>'ok')::boolean or (r->>'used')::int <> 458 + 102 then raise exception 'settled units not counted: %', r; end if;
  got := public.research_lock('topic:x', 60); if not got then raise exception 'first lock must succeed'; end if;
  got := public.research_lock('topic:x', 60); if got then raise exception 'second lock must fail while the lease is held'; end if;
  update public.research_cache set expires_at = now() - interval '1 second' where cache_key = 'topic:x';
  got := public.research_lock('topic:x', 60); if not got then raise exception 'an expired lease must be taken over'; end if;
  delete from public.research_cache where cache_key = 'topic:x'; got := public.research_lock('topic:x', 60); if not got then raise exception 'lock after unlock must succeed'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare r jsonb; begin
  r := public.research_reserve('v2|reserve|b1', 100, 150, 600); if not (r->>'ok')::boolean or (r->>'used')::int <> 100 then raise exception 'B must have its own budget: %', r; end if;
  if not public.research_lock('topic:x', 60) then raise exception 'locks are per owner'; end if;
end $$;
reset role;
set role anon;
select pg_temp.expect_fail($q$select public.research_reserve('k', 1, 10, 10)$q$, 'anon cannot execute research_reserve');
select pg_temp.expect_fail($q$select public.research_lock('k', 10)$q$, 'anon cannot execute research_lock');
reset role;
do $$ begin
  -- Pacific day: the quota day start is 7 or 8 hours after UTC midnight at most and never in the future
  if public.research_quota_day_start() > now() or public.research_quota_day_start() < now() - interval '25 hours' then raise exception 'quota day start out of range'; end if;
  if (extract(hour from public.research_quota_day_start() at time zone 'America/Los_Angeles')) <> 0 then raise exception 'quota day must start at Pacific midnight'; end if;
end $$;

\echo == project deletion keeps the campaign (project_id set null); user deletion removes their data
delete from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin if (select project_id from public.campaigns limit 1) is not null then raise exception 'project_id should be nulled'; end if; end $$;
delete from public.projects where owner_id = '00000000-0000-0000-0000-00000000000b';
delete from auth.users where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
do $$ begin if (select count(*) from public.campaigns) + (select count(*) from public.research_cache) <> 0 then raise exception 'cascade on user delete failed'; end if; end $$;

\echo == indexes and policies present
do $$ begin
  if (select count(*) from pg_indexes where tablename in ('campaigns','research_cache') and indexname in ('campaigns_owner_updated_idx','campaigns_project_idx','research_cache_owner_fetched_idx')) <> 3 then raise exception 'missing index'; end if;
  if (select count(*) from pg_policies where tablename in ('campaigns','research_cache')) <> 2 then raise exception 'policy count'; end if;
  if (select count(*) from pg_class where relname in ('campaigns','research_cache') and relrowsecurity) <> 2 then raise exception 'RLS not enabled'; end if;
end $$;

\echo == rollback removes both tables and leaves projects untouched
\i 20261015120000_campaigns.down.sql
\i 20261013120000_research_cache.down.sql
do $$ begin
  if to_regclass('public.campaigns') is not null or to_regclass('public.research_cache') is not null or to_regproc('public.research_reserve') is not null or to_regproc('public.research_lock') is not null then raise exception 'rollback incomplete'; end if;
  if (select count(*) from public.projects) <> 0 then raise exception 'rollback touched projects'; end if;
end $$;
\echo ALL MIGRATION CHECKS PASSED
