#!/usr/bin/env bash
# Rehearses the activation on a THROW-AWAY local PostgreSQL that mirrors the live state read on 20-10-2026
# (policies *_own `for all` to public, full table grants, 2 connections, 0 running runs), applies the three pending
# migrations in the activation order and runs supabase/activation/post-check.sql. Never touches the shared database.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgact.XXXXXX); chown postgres "$DIR"; PORT=54332
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X -t -A"
cp "$ROOT"/supabase/migrations/2026101{3,5,8}120000_*.sql "$ROOT"/supabase/activation/post-check.sql "$DIR/"
cat > "$DIR/live_state.sql" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table public.projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null);
create table public.publication_jobs (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), project_id uuid, platform text not null,
  status text not null default 'draft', scheduled_for timestamptz, approved_at timestamptz, approved_by uuid, idempotency_key text, payload jsonb not null default '{}', result jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.approvals (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), action_type text, entity_type text, entity_id text,
  status text, risk_summary text, requested_at timestamptz default now(), decided_at timestamptz);
create table public.channel_connections (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), provider text, external_account_id text,
  external_account_name text, scopes text[] default '{}', status text, token_ciphertext text, token_metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.automation_runs (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), automation_id uuid not null, trigger text, status text,
  summary jsonb, error text, started_at timestamptz default now(), finished_at timestamptz);
alter table public.projects enable row level security; alter table public.publication_jobs enable row level security; alter table public.approvals enable row level security;
alter table public.channel_connections enable row level security; alter table public.automation_runs enable row level security;
create policy approvals_own on public.approvals for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy publication_jobs_own on public.publication_jobs for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy connections_own on public.channel_connections for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy automation_runs_owner_all on public.automation_runs for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
insert into public.channel_connections (owner_id, provider, status, token_ciphertext) values
  ('00000000-0000-0000-0000-00000000000a', 'youtube', 'connected', 'x'), ('00000000-0000-0000-0000-00000000000a', 'instagram', 'connected', 'y');
SQL
chmod 644 "$DIR"/*.sql
run "$P -d postgres -c 'create database t'"
run "cd $DIR && $P -d t -f live_state.sql"
for f in 20261013120000_research_cache.sql 20261015120000_campaigns.sql 20261018120000_server_owned_security.sql; do run "cd $DIR && $P -d t -f $f" >/dev/null; done
OUT=$(run "cd $DIR && $P -F ' ' -d t -f post-check.sql")
echo "post-check: $OUT"
[[ "$OUT" =~ ^(t\ )*t$ ]] && echo "ACTIVATION REHEARSAL PASSED" || { echo "ACTIVATION REHEARSAL FAILED"; exit 1; }
