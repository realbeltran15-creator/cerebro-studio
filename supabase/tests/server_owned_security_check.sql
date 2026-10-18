-- Run by scripts/test-server-owned-security.sh in a THROW-AWAY local database. Stubs mimic Supabase and the LIVE schema/policies (18-10-2026).
\set QUIET on
\set ON_ERROR_STOP on
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table public.publication_jobs (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), project_id uuid, platform text not null,
  status text not null default 'draft', scheduled_for timestamptz, approved_at timestamptz, approved_by uuid, idempotency_key text, payload jsonb not null default '{}', result jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.approvals (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), action_type text, entity_type text, entity_id text,
  status text, risk_summary text, requested_at timestamptz default now(), decided_at timestamptz);
create table public.channel_connections (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), provider text, external_account_id text,
  external_account_name text, scopes text[] default '{}', status text, token_ciphertext text, token_metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.automation_runs (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), automation_id uuid not null, trigger text, status text,
  summary jsonb, error text, started_at timestamptz default now(), finished_at timestamptz);
-- Live policies today.
alter table public.publication_jobs enable row level security; alter table public.approvals enable row level security;
alter table public.channel_connections enable row level security; alter table public.automation_runs enable row level security;
create policy publication_jobs_own on public.publication_jobs for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy approvals_own on public.approvals for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy connections_own on public.channel_connections for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy automation_runs_owner_all on public.automation_runs for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.publication_jobs (id, owner_id, platform, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'youtube', 'draft'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'youtube', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'youtube', 'published'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'youtube', 'draft');
insert into public.channel_connections (id, owner_id, provider, external_account_id, status, token_ciphertext) values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'youtube', 'UC1', 'connected', 'v1.secret');

create function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
  exception when raise_exception then raise; when others then raise notice 'ok (rejected): %', label; end;
end $$;
create function pg_temp.expect_rows(sql text, n int, label text) returns void language plpgsql as $$
declare c int; begin execute sql; get diagnostics c = row_count; if c <> n then raise exception 'FAIL %: % rows, expected %', label, c, n; end if; raise notice 'ok: % (% rows)', label, c; end $$;
grant all on function pg_temp.expect_fail(text, text), pg_temp.expect_rows(text, int, text) to public;

\echo == apply the migration twice (idempotent)
\i 20261018120000_server_owned_security.sql
\i 20261018120000_server_owned_security.sql

\echo == browser session of owner A
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_rows($$select * from public.publication_jobs$$, 3, 'A reads only own jobs');
select pg_temp.expect_fail($$insert into public.approvals (owner_id, action_type, status) values ('00000000-0000-0000-0000-00000000000a', 'publish', 'approved')$$, 'forged approval');
select pg_temp.expect_fail($$insert into public.publication_jobs (owner_id, platform, status) values ('00000000-0000-0000-0000-00000000000a', 'youtube', 'approved')$$, 'insert approved job');
select pg_temp.expect_fail($$update public.publication_jobs set status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'self-approve draft');
select pg_temp.expect_fail($$update public.publication_jobs set payload = '{"privacyStatus":"public"}' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 'edit approved payload');
select pg_temp.expect_rows($$update public.publication_jobs set result = '{"videoId":"x"}' where id = 'aaaaaaaa-0000-0000-0000-000000000003'$$, 0, 'published job not writable');
select pg_temp.expect_rows($$delete from public.publication_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000003'$$, 0, 'published job not deletable');
select pg_temp.expect_rows($$insert into public.publication_jobs (owner_id, platform, status) values ('00000000-0000-0000-0000-00000000000a', 'youtube', 'draft')$$, 1, 'create draft');
select pg_temp.expect_rows($$update public.publication_jobs set payload = '{"title":"t"}', status = 'awaiting_approval' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'edit draft');
select pg_temp.expect_rows($$update public.publication_jobs set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 1, 'cancel approved job');
select pg_temp.expect_rows($$update public.publication_jobs set status = 'draft' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$, 0, 'cannot touch B job');
select pg_temp.expect_rows($$select id, provider, external_account_name, status from public.channel_connections$$, 1, 'reads own connection (safe columns)');
select pg_temp.expect_fail($$select token_ciphertext from public.channel_connections$$, 'read encrypted token');
select pg_temp.expect_fail($$update public.channel_connections set status = 'connected' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'modify connection');
select pg_temp.expect_fail($$delete from public.channel_connections where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'delete connection');
select pg_temp.expect_fail($$insert into public.channel_connections (owner_id, provider, status) values ('00000000-0000-0000-0000-00000000000a', 'tiktok', 'connected')$$, 'create connection');
select pg_temp.expect_fail($$insert into public.generation_spend (owner_id, request_id, provider, model, tier, estimate_usd) values ('00000000-0000-0000-0000-00000000000a', 'r', 'p', 'm', 'paid', 0)$$, 'write spend ledger');
reset role;

\echo == server (service role)
set role service_role;
select pg_temp.expect_rows($$update public.publication_jobs set status = 'approved', result = '{"approvalSeal":"v1.x"}' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'server approves');
select pg_temp.expect_rows($$insert into public.approvals (owner_id, action_type, status) values ('00000000-0000-0000-0000-00000000000a', 'publish', 'approved')$$, 1, 'server records approval');
select pg_temp.expect_rows($$update public.channel_connections set token_ciphertext = 'v1.new' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 1, 'server refreshes token');
select pg_temp.expect_rows($$insert into public.generation_spend (owner_id, request_id, provider, model, tier, estimate_usd) values ('00000000-0000-0000-0000-00000000000a', 'req-1', 'fal', 'flux', 'paid', 0.05)$$, 1, 'server books spend');
select pg_temp.expect_fail($$insert into public.generation_spend (owner_id, request_id, provider, model, tier, estimate_usd) values ('00000000-0000-0000-0000-00000000000a', 'req-1', 'fal', 'flux', 'paid', 0.05)$$, 'same request booked twice');
select pg_temp.expect_rows($$insert into public.automation_runs (owner_id, automation_id, status) values ('00000000-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'running')$$, 1, 'first running run');
select pg_temp.expect_fail($$insert into public.automation_runs (owner_id, automation_id, status) values ('00000000-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'running')$$, 'second simultaneous run');
reset role;

\echo == owner reads the ledger but cannot delete it
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_rows($$select * from public.generation_spend$$, 1, 'owner reads own spend');
select pg_temp.expect_fail($$delete from public.generation_spend$$, 'delete spend history');
reset role;
set role anon;
select pg_temp.expect_rows($$select * from public.publication_jobs$$, 0, 'anon reads nothing');
reset role;

\echo == rollback restores the original behaviour
\i 20261018120000_server_owned_security.down.sql
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_rows($$update public.publication_jobs set status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 1, 'after rollback: for-all policy again');
select pg_temp.expect_rows($$update public.channel_connections set status = 'connected'$$, 1, 'after rollback: connections writable again');
reset role;
\echo ALL SERVER-OWNED SECURITY CHECKS PASSED
