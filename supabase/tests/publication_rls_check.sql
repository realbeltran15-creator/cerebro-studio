-- Run by scripts/test-publication-rls.sh in a THROW-AWAY local database. Stubs mimic Supabase (roles, auth.uid(), service_role).
\set QUIET on
\set ON_ERROR_STOP on
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.publication_jobs (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), platform text not null,
  status text not null default 'draft', idempotency_key text, payload jsonb not null default '{}', result jsonb, approved_at timestamptz, updated_at timestamptz);
create table public.approvals (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), action_type text, entity_type text,
  entity_id text, status text, decided_at timestamptz);
-- Original policies, as in production today.
alter table public.publication_jobs enable row level security; alter table public.approvals enable row level security;
create policy publication_jobs_owner_all on public.publication_jobs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy approvals_owner_all on public.approvals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant all on public.publication_jobs, public.approvals to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.publication_jobs (id, owner_id, platform, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'youtube', 'draft'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'youtube', 'approved'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'youtube', 'published'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'youtube', 'draft');

create function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
  exception when raise_exception then raise; when others then raise notice 'ok (rejected): %', label; end;
end $$;
create function pg_temp.expect_rows(sql text, n int, label text) returns void language plpgsql as $$
declare c int; begin execute sql; get diagnostics c = row_count; if c <> n then raise exception 'FAIL %: % rows, expected %', label, c, n; end if; raise notice 'ok: % (% rows)', label, c; end $$;
grant all on function pg_temp.expect_fail(text, text), pg_temp.expect_rows(text, int, text) to public;

\echo == apply the migration twice (idempotent)
\i 20261018120000_publication_rls_hardening.sql
\i 20261018120000_publication_rls_hardening.sql

\echo == browser session of owner A
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_rows($$select * from public.publication_jobs$$, 3, 'A reads only own jobs');
select pg_temp.expect_rows($$select * from public.approvals$$, 0, 'A reads own approvals');
select pg_temp.expect_fail($$insert into public.approvals (owner_id, action_type, status) values ('00000000-0000-0000-0000-00000000000a', 'publish', 'approved')$$, 'forged approval insert');
select pg_temp.expect_fail($$insert into public.publication_jobs (owner_id, platform, status) values ('00000000-0000-0000-0000-00000000000a', 'youtube', 'approved')$$, 'insert already approved');
select pg_temp.expect_fail($$update public.publication_jobs set status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'self-approve a draft');
select pg_temp.expect_fail($$update public.publication_jobs set payload = '{"privacyStatus":"public"}' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 'edit payload of approved job keeping it approved');
select pg_temp.expect_rows($$update public.publication_jobs set result = '{"videoId":"x"}' where id = 'aaaaaaaa-0000-0000-0000-000000000003'$$, 0, 'published job is not writable');
select pg_temp.expect_rows($$delete from public.publication_jobs where id = 'aaaaaaaa-0000-0000-0000-000000000003'$$, 0, 'published job cannot be deleted');
select pg_temp.expect_rows($$insert into public.publication_jobs (owner_id, platform, status) values ('00000000-0000-0000-0000-00000000000a', 'youtube', 'draft')$$, 1, 'create draft');
select pg_temp.expect_rows($$update public.publication_jobs set payload = '{"title":"t"}', status = 'awaiting_approval' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'edit draft');
select pg_temp.expect_rows($$update public.publication_jobs set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 1, 'cancel approved job');
select pg_temp.expect_rows($$update public.publication_jobs set status = 'draft' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$, 0, 'cannot touch B job');
reset role;

\echo == server writer (service role)
set role service_role;
select pg_temp.expect_rows($$update public.publication_jobs set status = 'approved', result = '{"approvalSeal":"v1.x"}' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'server approves');
select pg_temp.expect_rows($$insert into public.approvals (owner_id, action_type, status) values ('00000000-0000-0000-0000-00000000000a', 'publish', 'approved')$$, 1, 'server records approval');
select pg_temp.expect_rows($$update public.publication_jobs set status = 'published' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 1, 'server marks published');
reset role;

\echo == anon sees nothing
set role anon;
select pg_temp.expect_rows($$select * from public.publication_jobs$$, 0, 'anon reads nothing');
reset role;

\echo == rollback restores the original behaviour
\i 20261018120000_publication_rls_hardening.down.sql
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_rows($$update public.publication_jobs set status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 1, 'after rollback: for-all policy again');
reset role;
\echo ALL PUBLICATION RLS CHECKS PASSED
