#!/usr/bin/env bash
# PostgreSQL local desechable + PostgREST 12.2.3 REAL (binario oficial, gratis) + cliente @supabase/postgrest-js REAL.
# JWT firmados por el propio test (NO es Supabase Auth). Sin Storage, sin Realtime. Nunca toca Production. Requiere /tmp/postgrest-12.2.3.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
PGRST=${POSTGREST_BIN:-/tmp/postgrest-12.2.3}; [ -x "$PGRST" ] || { echo "falta el binario PostgREST ($PGRST)"; exit 2; }
DIR=$(mktemp -d /tmp/pgrstint.XXXXXX); chown postgres "$DIR"; chmod 755 "$DIR"; PORT=54352; HTTP=54353; SECRET=test-only-secret-$(head -c 24 /dev/urandom | base64 | tr -dc a-z0-9)-xxxxxxxxxxxxxxxx
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { [ -n "${PID:-}" ] && kill $PID 2>/dev/null; run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null" && run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c max_connections=200' -l $DIR/log -w start >/dev/null" || exit 2
P="$BIN/psql -h $DIR -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1 postgres"
$P -f "$ROOT/supabase/tests/pending_live_shape.sql" >/dev/null || exit 2
for f in "$ROOT"/supabase/pending/20261102*[0-9]_*.sql; do case $f in *rollback*) continue;; esac; $P -f "$f" >/dev/null || { echo "falla $f"; exit 2; }; done
$P -c "create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator; grant usage on schema public to authenticator; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
 revoke all on public.transcription_locks from anon, authenticated;" >/dev/null || exit 2
PGRST_DB_URI="postgres://authenticator@localhost:$PORT/postgres?host=$DIR" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=$HTTP PGRST_DB_POOL=30 \
  "$PGRST" >"$DIR/pgrst.log" 2>&1 & PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:$HTTP/ && break; sleep 0.25; done
curl -s -o /dev/null http://127.0.0.1:$HTTP/ || { cat "$DIR/pgrst.log"; echo "PostgREST no arranca"; exit 2; }
cd "$ROOT" && PGRST_URL=http://127.0.0.1:$HTTP JWT_SECRET="$SECRET" PGDIR="$DIR" PGPORT=$PORT node scripts/postgrest-integration.mjs
