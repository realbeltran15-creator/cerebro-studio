#!/usr/bin/env bash
# Stack local con servicios OFICIALES de Supabase, sin Docker:
#   Auth = supabase/auth (GoTrue) v2.180.0 compilado desde el código fuente
#   Storage = supabase/storage-api v1.40.0 compilado desde el código fuente (backend de objetos S3 → moto en 127.0.0.1:5555)
#   REST = PostgREST 12.2.3 (binario oficial) · BD = PostgreSQL 16 real · pasarela = enrutador de rutas (sustituye a Kong)
# Datos sintéticos; sin red externa; nunca toca Production. Uso: official-stack.sh up | down | status
# Requisitos previos (ver docs/informe-p4-9-supabase-local.md §3): $SRC/{gotrue,auth/migrations,storage/dist} ya compilados; /tmp/postgrest-12.2.3; moto_server.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); HERE="$ROOT/scripts/official-stack"; SRC=${SRC:-/tmp/supa-src}; export SRC
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=${STACK_DIR:-/tmp/off}; PG=54400; GW=${GATEWAY_PORT:-54321}
SECRET=${SECRET:-official-local-secret-0123456789abcdef0123456789}; export SECRET
PGRST=${POSTGREST_BIN:-/tmp/postgrest-12.2.3}
run() { su postgres -s /bin/bash -c "$*"; }
psq() { run "$BIN/psql -p $PG -X -q -v ON_ERROR_STOP=1 postgres $*"; }
psqc() { printf '%s\n' "$1" | run "$BIN/psql -p $PG -X -q -v ON_ERROR_STOP=1 postgres"; }
killmatch() { for p in $(ps -eo pid,args | awk -v m="$1" 'index($0,m) && !/awk/ {print $1}'); do kill "$p" 2>/dev/null; done; }
wait_http() { for _ in $(seq 1 ${2:-60}); do curl -s -m2 -o /dev/null "$1" && return 0; sleep 0.5; done; return 1; }
down() {
  killmatch "official-supabase-gateway.mjs"; killmatch "postgrest-12"; killmatch "dist/start/server.js"; killmatch "supa-src/gotrue"; killmatch "gotrue serve"; killmatch "moto_server"
  run "$BIN/pg_ctl -D $D/pg stop -m immediate >/dev/null 2>&1 || true"
}
status() { for u in "auth 9999/health" "storage 5000/status" "rest 3000/" "gateway $GW/auth/v1/health"; do set -- $u; printf '%s: ' "$1"; curl -s -m2 -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$2" || echo down; done; }
up() {
  down; sleep 1; chmod 777 "$D" 2>/dev/null || mkdir -p "$D" && chmod 777 "$D"; rm -rf "$D/pg" "$D/s3" "$D"/*.log; mkdir -p "$D/pg"; chown postgres "$D/pg"
  run "$BIN/initdb -D $D/pg -A trust >/dev/null" && run "$BIN/pg_ctl -D $D/pg -o '-p $PG -c listen_addresses=127.0.0.1 -c max_connections=200' -l $D/pg.log -w start >/dev/null" || { echo "PG_FAIL"; return 1; }
  psq <<'SQL'
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login password 'x'; grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin noinherit createrole login password 'x'; grant all on database postgres to supabase_auth_admin;
create schema auth authorization supabase_auth_admin; grant usage on schema auth to anon, authenticated, service_role; alter role supabase_auth_admin set search_path = auth;
create role supabase_storage_admin noinherit createrole login password 'x' bypassrls superuser; -- superusuario SOLO durante las migraciones; se retira abajo
grant anon, authenticated, service_role to supabase_storage_admin with admin option; grant postgres to supabase_storage_admin with admin option; grant postgres to authenticator;
grant all on database postgres to supabase_storage_admin;
create schema storage authorization supabase_storage_admin; grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, authenticator;
SQL
  (nohup moto_server -H 127.0.0.1 -p 5555 >"$D/moto.log" 2>&1 &); wait_http http://127.0.0.1:5555/ 40 || { echo MOTO_FAIL; return 1; }
  python3 -c "import boto3;boto3.client('s3',endpoint_url='http://127.0.0.1:5555',aws_access_key_id='k',aws_secret_access_key='s',region_name='us-east-1').create_bucket(Bucket='supabase-storage-local')" || { echo BUCKET_FAIL; return 1; }
  bash "$HERE/auth.sh" migrate >"$D/auth-migrate.log" 2>&1 || { echo AUTH_MIGRATE_FAIL; tail -5 "$D/auth-migrate.log"; return 1; }
  (nohup bash "$HERE/auth.sh" serve >"$D/auth.log" 2>&1 &); wait_http http://127.0.0.1:9999/health 40 || { echo AUTH_FAIL; return 1; }
  # Storage: primera arranque aplica sus migraciones (rol superusuario); se detiene, se ajustan propietarios, se retira el superusuario y se arranca de nuevo.
  [ -n "${NODE_PATH:-}" ] || true
  (nohup bash "$HERE/storage.sh" >"$D/storage.log" 2>&1 &); wait_http http://127.0.0.1:5000/status 90 || { echo STORAGE_FAIL1; tail -3 "$D/storage.log" | cut -c1-300; return 1; }
  killmatch "dist/start/server.js"; sleep 2
  psqc "alter table storage.migrations owner to supabase_storage_admin; alter table storage.buckets owner to supabase_storage_admin; alter table storage.objects owner to supabase_storage_admin; alter role supabase_storage_admin nosuperuser;" || return 1
  (nohup bash "$HERE/storage.sh" >"$D/storage.log" 2>&1 &); wait_http http://127.0.0.1:5000/status 90 || { echo STORAGE_FAIL2; tail -3 "$D/storage.log" | cut -c1-300; return 1; }
  # Privilegios por defecto que Supabase crea en cada proyecto nuevo (el esquema de la app depende de ellos; NO forman parte del baseline)
  psqc "alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;" || return 1
  # Esquema de la aplicación SOBRE los esquemas auth/storage reales (sin el stub)
  if [ -n "${SCHEMA_BUNDLE:-}" ]; then # el fichero único que se pegará en el proyecto de la beta: se valida aquí tal cual
    psq -f "$SCHEMA_BUNDLE" >/dev/null 2>"$D/err.txt" || { echo BUNDLE_FAIL; grep -v NOTICE "$D/err.txt" | head -3; return 1; }
  else
    psq -f "$ROOT/supabase/schema/baseline_live.sql" >/dev/null || { echo BASELINE_FAIL; return 1; }
    for f in $(ls "$ROOT"/supabase/pending/*.sql | grep -v rollback | sort); do psq -f "$f" >/dev/null 2>"$D/err.txt" || { echo "PENDING_FAIL $f"; head -3 "$D/err.txt"; return 1; }; done
    psqc "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();" || return 1
  fi
  (PGRST_DB_URI="postgres://authenticator:x@127.0.0.1:$PG/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=3000 PGRST_DB_POOL=30 nohup "$PGRST" >"$D/pgrst.log" 2>&1 &)
  wait_http http://127.0.0.1:3000/ 40 || { echo REST_FAIL; return 1; }
  (cd "$ROOT" && GATEWAY_PORT=$GW exec node scripts/official-supabase-gateway.mjs) >"$D/gw.log" 2>&1 </dev/null & wait_http "http://127.0.0.1:$GW/auth/v1/health" 20 || { echo GATEWAY_FAIL; return 1; }
  echo "STACK_OK gateway=http://127.0.0.1:$GW"
}
case "${1:-}" in up) up ;; down) down ;; status) status ;; *) echo "uso: $0 up|down|status"; exit 2 ;; esac
