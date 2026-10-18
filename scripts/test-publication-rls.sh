#!/usr/bin/env bash
# Applies the PREPARED publication RLS hardening migration to a THROW-AWAY local PostgreSQL (never the shared Supabase database)
# and checks what the browser can and cannot do, the server (service role) path, idempotency and the rollback.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgrls.XXXXXX); chown postgres "$DIR"; PORT=54331
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
cp "$ROOT"/supabase/migrations/20261018120000_publication_rls_hardening.sql "$ROOT"/supabase/rollback/20261018120000_publication_rls_hardening.down.sql "$ROOT"/supabase/tests/publication_rls_check.sql "$DIR/"
chmod 644 "$DIR"/*.sql
run "$P -d postgres -c 'create database t'"
run "cd $DIR && $P -d t -f publication_rls_check.sql" 2>&1 | tee "$DIR/out.txt"
grep -q "ALL PUBLICATION RLS CHECKS PASSED" "$DIR/out.txt"
