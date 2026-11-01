#!/usr/bin/env bash
# Applies the FULL chain (12 repo migrations, then 7 pending) to a throw-away local PostgreSQL with Supabase-style stubs,
# then re-applies each pending one (idempotency), rolls them back in reverse order and re-applies. Never touches any remote project.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgchain.XXXXXX); chown postgres "$DIR"; PORT=54331
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X -d postgres"
cat > "$DIR/stub.sql" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub',''))::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
SQL
chmod 644 "$DIR/stub.sql"; cp "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/pending/*.sql "$DIR"/ 2>/dev/null; chmod 644 "$DIR"/*.sql
FAIL=0
# Known drift between the repo migrations and the live schema (the repo chain does NOT rebuild Production: live has
# assets.asset_type, opportunities.source_id, channel_connections.provider that no repo migration creates). Reported as DRIFT, not as a failure.
KNOWN="20261007120000_opportunities_unique_source 20261018120000_server_owned_security 20261102140000_subtitle_unique_per_source"
DRIFT=0
step() { # name file
  if out=$(run "cd $DIR && $P -f $2" 2>&1); then echo "ok   $1"; else
    if echo "$KNOWN" | grep -q "${2%.sql}"; then echo "DRIFT $1"; DRIFT=$((DRIFT+1)); else echo "FAIL $1"; FAIL=1; fi
    echo "$out" | grep -v NOTICE | head -3 | sed 's/^/       /'; fi; }
step stubs stub.sql
for f in $(cd "$ROOT/supabase/migrations" && ls *.sql | grep -v rollback | sort); do step "repo  $f" "$f"; done
PEND=$(cd "$ROOT/supabase/pending" && ls *.sql | grep -v rollback | sort)
for f in $PEND; do step "pend  $f" "$f"; done
for f in $PEND; do step "again $f (idempotent)" "$f"; done
for f in $(echo "$PEND" | sort -r); do step "rollb ${f%.sql}" "${f%.sql}.rollback.sql"; done
for f in $PEND; do step "reapp $f" "$f"; done
echo "known drift items: $DRIFT"; [ $FAIL = 0 ] && echo "CHAIN OK (apart from documented drift)" || { echo "CHAIN HAS FAILURES"; exit 1; }
