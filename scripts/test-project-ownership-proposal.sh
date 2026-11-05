#!/usr/bin/env bash
# Prueba la PROPUESTA de permisos de channel_connections en un PostgreSQL desechable (stubs + baseline + 7 pendientes). No toca Production.
# Opción A (GRANT SELECT por columnas, la propuesta) y opción B (RPC security definer, solo para comparar).
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgpo.XXXXXX); chown postgres "$DIR"; PORT=54336
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"; run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
cp "$ROOT"/supabase/tests/supabase_stub.sql "$ROOT"/supabase/schema/baseline_live.sql "$ROOT"/supabase/pending/*.sql "$ROOT"/supabase/proposed/*.sql "$DIR"/; chmod 644 "$DIR"/*.sql
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X -d postgres"
q() { run "$P -At -c \"$1\"" 2>&1; }
PASS=0; FAIL=0; ok() { PASS=$((PASS+1)); echo "PASS $1"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL $1 -> $2"; }
run "cd $DIR && $P -f supabase_stub.sql" >/dev/null && run "cd $DIR && $P -f baseline_live.sql" >/dev/null 2>&1 || { echo "falla el esquema base"; exit 2; }
for f in $(cd "$ROOT/supabase/pending" && ls *.sql | grep -v rollback | sort); do run "cd $DIR && $P -f $f" >/dev/null 2>&1 || { echo "falla $f"; exit 2; }; done
run "$P -c \"create role authenticated nologin; create role anon nologin; grant usage on schema public to authenticated, anon;\"" >/dev/null 2>&1

A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
PA=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; PB=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
run "$P -c \"insert into auth.users(id,email) values ('$A','a@x.test'),('$B','b@x.test') on conflict do nothing; insert into public.projects(id,owner_id,name) values ('$PA','$A','Proyecto A'),('$PB','$B','Proyecto B');\"" >/dev/null 2>&1
run "$P -c \"grant select,insert,update,delete on all tables in schema public to authenticated;\"" >/dev/null 2>&1
as() { run "$P -At -c \"set role authenticated; select set_config('request.jwt.claim.sub','$1',false); $2\"" 2>&1; }
INS_ASSET="insert into public.assets(owner_id,project_id,asset_type,storage_path,license_status) values"
# ANTES: reproduce el hallazgo
r=$(as $B "$INS_ASSET ('$B','$PA','image','x.png','owned') returning 1"); echo "$r" | grep -q "^1$" && ok "antes: B inserta un activo en el proyecto de A (el defecto)" || ko "antes" "$r"
run "$P -c \"delete from public.assets\"" >/dev/null 2>&1
run "cd $DIR && $P -f 20261105130000_project_ownership_check.sql" >/dev/null 2>&1 || { echo "falla la propuesta"; exit 2; }
r=$(as $B "$INS_ASSET ('$B','$PA','image','x.png','owned') returning 1"); echo "$r" | grep -qi "row-level security" && ok "después: B ya no inserta un activo en el proyecto de A" || ko "B->A activo" "$r"
r=$(as $B "insert into public.render_jobs(owner_id,project_id,output_format,status,composition) values ('$B','$PA','16:9','draft','{}') returning 1"); echo "$r" | grep -qi "row-level security" && ok "después: B no crea render_jobs en el proyecto de A" || ko "B->A render" "$r"
r=$(as $B "$INS_ASSET ('$B','$PB','image','y.png','owned') returning 1"); echo "$r" | grep -q "^1$" && ok "B sí inserta en su propio proyecto" || ko "B propio" "$r"
r=$(as $B "$INS_ASSET ('$B',null,'image','z.png','owned') returning 1"); echo "$r" | grep -q "^1$" && ok "B sí inserta sin proyecto (Biblioteca general)" || ko "B sin proyecto" "$r"
r=$(as $B "update public.assets set project_id='$PA' where storage_path='y.png' returning 1"); echo "$r" | grep -qi "row-level security" && ok "B no puede MOVER su activo al proyecto de A (UPDATE)" || ko "mover" "$r"
r=$(as $A "$INS_ASSET ('$A','$PA','image','a.png','owned') returning 1"); echo "$r" | grep -q "^1$" && ok "A conserva su permiso en su proyecto" || ko "A propio" "$r"
r=$(as $A "update public.assets set license_status='licensed' where storage_path='a.png' returning 1"); echo "$r" | grep -q "^1$" && ok "A puede actualizar sus filas" || ko "A update" "$r"
r=$(as $A "select count(*) from public.assets"); [ "$(echo "$r" | tail -1)" = 1 ] && ok "aislamiento de lectura intacto (A ve solo lo suyo, no las 2 de B)" || ko "lectura" "$r"
r=$(as $A "delete from public.assets where storage_path='a.png' returning 1"); echo "$r" | grep -q "^1$" && ok "A puede borrar sus filas" || ko "A delete" "$r"
run "cd $DIR && $P -f 20261105130000_project_ownership_check.sql" >/dev/null 2>&1 && ok "idempotente (se puede reaplicar)" || ko "idempotencia" ""
run "cd $DIR && $P -f 20261105130000_project_ownership_check.rollback.sql" >/dev/null 2>&1; r=$(as $B "$INS_ASSET ('$B','$PA','image','w.png','owned') returning 1"); echo "$r" | grep -q "^1$" && ok "rollback restaura el comportamiento anterior" || ko "rollback" "$r"
echo; echo "RESUMEN: $PASS correctas, $FAIL fallidas"; [ $FAIL = 0 ]
