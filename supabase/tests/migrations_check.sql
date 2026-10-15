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

\echo == project deletion keeps the campaign (project_id set null); user deletion removes their data
delete from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin if (select project_id from public.campaigns limit 1) is not null then raise exception 'project_id should be nulled'; end if; end $$;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
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
  if to_regclass('public.campaigns') is not null or to_regclass('public.research_cache') is not null then raise exception 'rollback incomplete'; end if;
  if (select count(*) from public.projects) <> 1 then raise exception 'rollback touched projects'; end if;
end $$;
\echo ALL MIGRATION CHECKS PASSED
