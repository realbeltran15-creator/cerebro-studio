#!/usr/bin/env bash
# Prueba la PROPUESTA de permisos de channel_connections en un PostgreSQL desechable (stubs + baseline + 7 pendientes). No toca Production.
# Opción A (GRANT SELECT por columnas, la propuesta) y opción B (RPC security definer, solo para comparar).
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgcc.XXXXXX); chown postgres "$DIR"; PORT=54334
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
# El stub puede haber creado ya los roles; el baseline aplica el revoke. Datos sintéticos de dos usuarios.
A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
run "$P -c \"insert into auth.users(id,email) values ('$A','a@x.test'),('$B','b@x.test') on conflict do nothing; insert into public.channel_connections(owner_id,provider,external_account_id,external_account_name,status,token_ciphertext,token_metadata) values ('$A','youtube','ca','Canal A','connected','SECRETO-A','{\\\"k\\\":1}'),('$B','youtube','cb','Canal B','connected','SECRETO-B','{}');\"" >/dev/null 2>&1
as() { run "$P -At -c \"set role authenticated; select set_config('request.jwt.claim.sub','$1',false); $2\"" 2>&1; }
as_anon() { run "$P -At -c \"set role anon; $1\"" 2>&1; }
# Estado ANTES (reproduce el 403)
r=$(as $A "select count(*) from public.channel_connections"); echo "$r" | grep -qi "permission denied" && ok "antes: authenticated recibe 403 (permission denied) como en Production" || ko "antes" "$r"
# Opción A
run "cd $DIR && $P -f 20261105120000_channel_connections_status_read.sql" >/dev/null 2>&1 || { echo "falla la propuesta"; exit 2; }
r=$(as $A "select provider||':'||external_account_name||':'||status from public.channel_connections where provider='youtube' and status='connected'" | tail -1); [ "$r" = "youtube:Canal A:connected" ] && ok "A: el usuario A lee su estado de conexión (columnas que usan las 6 páginas)" || ko "A lectura" "$r"
r=$(as $A "select count(*) from public.channel_connections" | tail -1); [ "$r" = 1 ] && ok "A: RLS aísla filas (A solo ve 1, no la de B)" || ko "A aislamiento" "$r"
r=$(as $B "select external_account_name from public.channel_connections" | tail -1); [ "$r" = "Canal B" ] && ok "A: B solo ve lo suyo" || ko "A B" "$r"
for col in token_ciphertext token_metadata owner_id "*"; do r=$(as $A "select $col from public.channel_connections"); echo "$r" | grep -qi "permission denied" && ok "A: select $col → denegado (sin exposición de tokens)" || ko "A $col" "$r"; done
r=$(as $A "select id from public.channel_connections where token_ciphertext is not null"); echo "$r" | grep -qi "permission denied" && ok "A: tampoco se puede filtrar/sondear por token_ciphertext" || ko "A sondeo" "$r"
for stmt in "update public.channel_connections set status='revoked'" "delete from public.channel_connections" "insert into public.channel_connections(owner_id,provider) values ('$A','x')"; do r=$(as $A "$stmt"); echo "$r" | grep -qi "permission denied" && ok "A: escritura denegada ($stmt)" || ko "A escritura" "$r"; done
r=$(as_anon "select count(*) from public.channel_connections"); echo "$r" | grep -qi "permission denied" && ok "A: anónimo denegado" || ko "A anon" "$r"
run "cd $DIR && $P -f 20261105120000_channel_connections_status_read.sql" >/dev/null 2>&1 && ok "A: idempotente (se puede reaplicar)" || ko "A idempotencia" ""
run "cd $DIR && $P -f 20261105120000_channel_connections_status_read.rollback.sql" >/dev/null 2>&1; r=$(as $A "select count(*) from public.channel_connections"); echo "$r" | grep -qi "permission denied" && ok "A: el rollback restaura el estado de Production" || ko "A rollback" "$r"
# Opción B (solo comparación): RPC security definer
run "$P -c \"create function public.my_channel_connections() returns table(id uuid, provider text, external_account_id text, external_account_name text, scopes text[], status text, updated_at timestamptz) language sql stable security definer set search_path = public as 'select id, provider, external_account_id, external_account_name, scopes, status, updated_at from public.channel_connections where owner_id = auth.uid()'; revoke all on function public.my_channel_connections() from public, anon; grant execute on function public.my_channel_connections() to authenticated;\"" >/dev/null 2>&1
r=$(as $A "select external_account_name from public.my_channel_connections()" | tail -1); [ "$r" = "Canal A" ] && ok "B (comparación): la RPC devuelve solo lo del propietario" || ko "B" "$r"
echo; echo "RESUMEN: $PASS correctas, $FAIL fallidas"; [ $FAIL = 0 ]
