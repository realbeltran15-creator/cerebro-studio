#!/usr/bin/env bash
# PostgreSQL local desechable con el esquema RECONSTRUIDO de Production (baseline_live.sql + 7 pendientes) + PostgREST real +
# "Supabase-lite" (Auth y Storage SIMULADOS) + cliente @supabase/supabase-js real. Datos sintéticos. Nunca toca Production.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
PGRST=${POSTGREST_BIN:-/tmp/postgrest-12.2.3}; [ -x "$PGRST" ] || { echo "falta el binario PostgREST ($PGRST)"; exit 2; }
DIR=$(mktemp -d /tmp/pgjourney.XXXXXX); chown postgres "$DIR"; chmod 755 "$DIR"; PORT=54362; HTTP=54363; SECRET=test-only-secret-$(head -c 24 /dev/urandom | base64 | tr -dc a-z0-9)-xxxxxxxxxxxxxxxx
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { [ -n "${PID:-}" ] && kill $PID 2>/dev/null; run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null" && run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c max_connections=200' -l $DIR/log -w start >/dev/null" || exit 2
P="$BIN/psql -h $DIR -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1 postgres"
$P -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null && $P -f "$ROOT/supabase/schema/baseline_live.sql" >/dev/null 2>&1 || { echo "falla el esquema base"; exit 2; }
for f in $(ls "$ROOT"/supabase/pending/*.sql | grep -v rollback | sort); do $P -f "$f" >/dev/null 2>&1 || { echo "falla $f"; exit 2; }; done
# Production has this trigger on auth.users (managed by Supabase); the stub needs it explicitly.
$P -c "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
 create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator; grant usage on schema public to authenticator;" >/dev/null || exit 2
PGRST_DB_URI="postgres://authenticator@localhost:$PORT/postgres?host=$DIR" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=$HTTP PGRST_DB_POOL=30 "$PGRST" >"$DIR/pgrst.log" 2>&1 & PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:$HTTP/ && break; sleep 0.25; done
curl -s -o /dev/null http://127.0.0.1:$HTTP/ || { cat "$DIR/pgrst.log"; echo "PostgREST no arranca"; exit 2; }
cd "$ROOT" && PGRST_URL=http://127.0.0.1:$HTTP JWT_SECRET="$SECRET" PGDIR="$DIR" PGPORT=$PORT node scripts/${JOURNEY_SCRIPT:-local-journey.mjs}
