#!/usr/bin/env bash
# Applies the PENDING migrations (research_cache, campaigns) to a THROW-AWAY local PostgreSQL with Supabase-style stubs
# (auth.users, auth.uid(), anon/authenticated roles, public.projects) and checks idempotency, RLS, constraints and rollback.
# It never touches the shared Supabase database. Needs the local postgresql binaries and root (to run as the postgres user).
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgtest.XXXXXX); chown postgres "$DIR"; PORT=54329
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
cp "$ROOT"/supabase/migrations/20261013120000_research_cache.sql "$ROOT"/supabase/migrations/20261015120000_campaigns.sql "$ROOT"/supabase/rollback/*.sql "$ROOT"/supabase/tests/migrations_check.sql "$DIR/"
chmod 644 "$DIR"/*.sql
run "$P -d postgres -c 'create database t'"
run "cd $DIR && $P -d t -f migrations_check.sql" | tee "$DIR/out.txt"
grep -q "ALL MIGRATION CHECKS PASSED" "$DIR/out.txt"
