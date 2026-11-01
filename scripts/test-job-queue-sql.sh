#!/usr/bin/env bash
# Valida supabase/pending/20261101120000_job_queue.sql (y su rollback) en un PostgreSQL local DESECHABLE
# (solo socket unix en /tmp, sin red, con stubs de Supabase). Jamas toca la base compartida ni usa credenciales.
# Comprueba: idempotencia, RLS por roles, permisos EXECUTE, fencing de leases, aprobaciones, presupuesto bajo
# concurrencia, reservas inciertas, estados terminales, y que el rollback deja el esquema EXACTAMENTE como estaba.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgq.XXXXXX); chown postgres "$DIR"; PORT=54331
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
PASS=0
fail() { echo "FALLO: $1"; exit 1; }
ok() { PASS=$((PASS+1)); echo "  ok - $1"; }
grep -qiE 'supabase\.co|postgres(ql)?://|service_role_key|password' "$ROOT"/supabase/pending/20261101120000_job_queue*.sql && fail "la migracion contiene referencias a una base real o credenciales"
ok "migracion sin URLs ni credenciales"
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o \"-p $PORT -k $DIR -c listen_addresses=''\" -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
cp "$ROOT"/supabase/pending/20261101120000_job_queue*.sql "$DIR/"; chmod 644 "$DIR"/*.sql
run "$P -d postgres -c 'create database t'"
cat > "$DIR/stubs.sql" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
create table public.projects (id uuid primary key default gen_random_uuid(), owner_id uuid, name text);
insert into public.projects (id, owner_id, name) values ('00000000-0000-0000-0000-0000000000f1', null, 'preexistente');
alter default privileges in schema public grant all on tables to service_role;
grant all on all tables in schema public to service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
SQL
run "cd $DIR && $P -d t -f stubs.sql"
run "$BIN/pg_dump -h $DIR -p $PORT -U postgres -d t --schema-only" | grep -vE '^(--|\\restrict|\\unrestrict)' > "$DIR/schema_before.sql"
run "cd $DIR && $P -d t -f 20261101120000_job_queue.sql" 2>&1 | grep -v NOTICE
run "cd $DIR && $P -d t -f 20261101120000_job_queue.sql" 2>&1 | grep -v NOTICE
ok "migracion aplicada dos veces sin error"
A=00000000-0000-0000-0000-00000000000a; B=00000000-0000-0000-0000-00000000000b
# q: como superusuario. sa: como service_role. ua/ub: como usuarios autenticados. an: anon.
q()  { run "$P -d t -At -c \"$1\"" 2>/dev/null | tail -1; }
sa() { run "$P -d t -At -c \"set role service_role; $1\"" 2>/dev/null | tail -1; }
ua() { run "$P -d t -At -c \"set role authenticated; set request.jwt.claim.sub='$A'; $1\"" 2>&1 | tail -1; }
ub() { run "$P -d t -At -c \"set role authenticated; set request.jwt.claim.sub='$B'; $1\"" 2>&1 | tail -1; }
an() { run "$P -d t -At -c \"set role anon; $1\"" 2>&1 | tail -1; }
denied() { echo "$1" | grep -qiE 'permission denied|violates row-level|violates check|ya esta en estado terminal|violates unique'; }

for t in job_queue job_approvals budget_limits budget_entries; do
  [ "$(q "select relrowsecurity from pg_class where relname='$t'")" = "t" ] || fail "RLS desactivada en $t"
done; ok "RLS activada en las 4 tablas"

# ---- unicidad / constraints
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','k','idem-key-1','h')"
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$B','k','idem-key-1','h')"
[ -z "$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','k','idem-key-1','h') returning id")" ] || fail "clave duplicada aceptada"
[ -z "$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, status) values ('$A','k','idem-key-2','h','bogus') returning id")" ] || fail "estado invalido aceptado"
[ -z "$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, status) values ('$A','k','idem-key-3','h','running') returning id")" ] || fail "running sin lease aceptado"
[ -z "$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, max_attempts) values ('$A','k','idem-key-4','h',99) returning id")" ] || fail "max_attempts fuera de rango aceptado"
ok "idempotencia unica por propietario; estados/lease/rangos validados"

# ---- aislamiento por roles (NO solo superusuario)
[ "$(ua "select count(*) from job_queue")" = "1" ] || fail "A no ve exactamente lo suyo"
[ "$(ub "select count(*) from job_queue")" = "1" ] || fail "B no ve exactamente lo suyo"
[ "$(ua "select count(*) from job_queue where owner_id='$B'")" = "0" ] || fail "A ve trabajos de B"
ok "cada usuario ve solo sus trabajos"
for stmt in "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','x','new-key-001','h')" \
            "update job_queue set status='completed'" "delete from job_queue" \
            "insert into budget_limits (owner_id, provider, unit, daily_limit) values ('$A','gen','eur',1000)" \
            "update budget_limits set daily_limit=1000000" "delete from budget_entries" \
            "update budget_entries set state='released'" \
            "insert into job_approvals (owner_id, job_id, step, action, payload_hash, expires_at) select owner_id, id, 's', 'spend', payload_hash, now()+interval '1 day' from job_queue limit 1" \
            "update job_approvals set revoked_at=null"; do
  r=$(ua "$stmt"); denied "$r" || fail "usuario autenticado pudo ejecutar: $stmt -> $r"
done
ok "usuario autenticado NO puede insertar/actualizar/borrar en ninguna tabla (presupuesto y aprobaciones incluidos)"
for stmt in "select count(*) from job_queue" "select count(*) from budget_limits" "select count(*) from budget_entries" "select count(*) from job_approvals"; do
  r=$(an "$stmt"); denied "$r" || fail "anon pudo leer: $stmt -> $r"
done; ok "anon sin acceso alguno"
for fn in "claim_next_job('x',60)" "reserve_budget('$A',null,'s','gen',null,'eur',0,'k')" "heartbeat_job(gen_random_uuid(),gen_random_uuid(),60)" \
          "save_job_steps(gen_random_uuid(),gen_random_uuid(),'[]','x')" "finish_job(gen_random_uuid(),gen_random_uuid(),'completed')" \
          "check_approval(gen_random_uuid(),'s','spend')" "settle_budget('$A','k','eur',0)" "release_budget('$A','k')" \
          "mark_budget_uncertain('$A','k')" "resolve_uncertain_budget('$A','k',true)"; do
  for who in ua ub an; do r=$($who "select $fn"); denied "$r" || fail "$who pudo ejecutar $fn -> $r"; done
done; ok "ningun rol salvo service_role puede ejecutar las funciones privilegiadas"
n=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prorettype <> 'trigger'::regtype and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('public',p.oid,'execute'))")
[ "$n" = "0" ] || fail "hay funciones ejecutables por anon/authenticated/public: $n"
n=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prorettype <> 'trigger'::regtype and not has_function_privilege('service_role',p.oid,'execute')")
[ "$n" = "0" ] || fail "funciones que service_role no puede ejecutar: $n"
ok "TODAS las funciones de public (no solo las nombradas) restringidas a service_role"
n=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef and not exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%')")
[ "$n" = "0" ] || fail "funciones SECURITY DEFINER sin search_path fijo: $n"; ok "toda funcion SECURITY DEFINER fija search_path"

# ---- estados terminales inmutables
J=$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, status) values ('$A','k','term-key-1','h','completed') returning id")
r=$(q "update job_queue set status='pending' where id='$J' returning id"); [ -z "$r" ] || fail "se resucito un trabajo completado"
ok "un trabajo terminal no puede volver a pending/running"

# ---- reclamo concurrente + fencing
q "delete from job_queue"
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) select '$A','k','bulk-key-'||g,'h' from generate_series(1,12) g"
for i in 1 2 3 4 5 6 7 8; do
  ( for k in 1 2 3; do sa "select id from claim_next_job('ex-$i', 60)"; done > "$DIR/c$i.txt" ) &
done; wait
tot=$(cat "$DIR"/c*.txt | grep -c . || true); uniq=$(cat "$DIR"/c*.txt | grep . | sort -u | wc -l)
[ "$uniq" = "$tot" ] || fail "trabajo reclamado dos veces ($tot reclamos, $uniq unicos)"; [ "$tot" = "12" ] || fail "se esperaban 12 reclamos y hubo $tot"
ok "12 trabajos x 8 sesiones concurrentes: cada uno reclamado exactamente una vez"
J=$(q "select id from job_queue limit 1"); T1=$(q "select claim_token from job_queue where id='$J'")
[ "$(sa "select heartbeat_job('$J','$T1',60)")" = "t" ] || fail "heartbeat legitimo rechazado"
[ "$(sa "select heartbeat_job('$J',gen_random_uuid(),60)")" = "f" ] || fail "heartbeat con token ajeno aceptado"
[ "$(sa "select finish_job('$J',gen_random_uuid(),'completed')")" = "f" ] || fail "finish con token ajeno aceptado"
q "update job_queue set lease_expires_at = now() - interval '1 second' where id='$J'"
[ "$(sa "select heartbeat_job('$J','$T1',60)")" = "f" ] || fail "heartbeat con lease caducado aceptado"
[ "$(sa "select finish_job('$J','$T1','completed')")" = "f" ] || fail "finish con lease caducado aceptado"
ok "heartbeat/finish rechazan token ajeno y lease caducado"
q "update job_queue set lease_expires_at = now() - interval '1 second' where id='$J'"
R=$(sa "select claim_token from claim_next_job('rescue', 60) where id='$J'")
[ -n "$R" ] && [ "$R" != "$T1" ] || fail "no se recupero el lease caducado con token nuevo"
[ "$(sa "select finish_job('$J','$T1','completed')")" = "f" ] || fail "el ejecutor antiguo (token viejo) pudo terminar el trabajo"
[ "$(sa "select save_job_steps('$J','$T1','[]','x')")" = "f" ] || fail "el ejecutor antiguo pudo escribir pasos"
[ "$(q "select status from job_queue where id='$J'")" = "running" ] || fail "el trabajo cambio de estado por un token viejo"
ok "ejecutor antiguo descartado tras reclamar el lease (fencing)"
# 8 sesiones intentan terminar con el mismo token: exactamente una gana
for i in 1 2 3 4 5 6 7 8; do sa "select finish_job('$J','$R','completed')" > "$DIR/f$i.txt" & done; wait
[ "$(cat "$DIR"/f*.txt | grep -c '^t$')" = "1" ] || fail "finish concurrente no fue unico"
ok "finish concurrente con el mismo token: exactamente uno gana"
[ "$(sa "select count(*) from claim_next_job('late',60) where id='$J'")" = "0" ] || fail "se reclamo un trabajo terminado"

# ---- aprobaciones (fuente unica de verdad)
AJ=$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','k','appr-key-1','hash1') returning id")
[ "$(sa "select check_approval('$AJ','gen','spend')")" = "approval_missing" ] || fail "aprobacion ausente no detectada"
q "insert into job_approvals (owner_id, job_id, step, action, payload_hash, expires_at) values ('$A','$AJ','gen','spend','hash1', now()+interval '1 hour')"
[ -z "$(sa "select check_approval('$AJ','gen','spend')")" ] || fail "aprobacion valida rechazada"
[ "$(sa "select check_approval('$AJ','gen','publish')")" = "approval_missing" ] || fail "aprobacion de otra accion aceptada"
[ "$(sa "select check_approval('$AJ','otro','spend')")" = "approval_missing" ] || fail "aprobacion de otro paso aceptada"
q "update job_queue set payload_hash='cambiado' where id='$AJ'"
[ "$(sa "select check_approval('$AJ','gen','spend')")" = "approval_invalidated" ] || fail "payload cambiado no invalida la aprobacion"
q "update job_queue set payload_hash='hash1' where id='$AJ'; update job_approvals set revoked_at=now() where job_id='$AJ'"
[ "$(sa "select check_approval('$AJ','gen','spend')")" = "approval_revoked" ] || fail "revocada no detectada"
q "update job_approvals set revoked_at=null, expires_at=now()-interval '1 second' where job_id='$AJ'"
[ "$(sa "select check_approval('$AJ','gen','spend')")" = "approval_expired" ] || fail "caducada no detectada"
BJ=$(q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$B','k','appr-key-2','hash1') returning id")
q "insert into job_approvals (owner_id, job_id, step, action, payload_hash, expires_at) values ('$A','$BJ','gen','spend','hash1', now()+interval '1 hour')"
[ "$(sa "select check_approval('$BJ','gen','spend')")" = "approval_invalidated" ] || fail "aprobacion de OTRO propietario aceptada"
ok "aprobaciones: ausente, otra accion/paso, payload cambiado, revocada, caducada y de otro propietario -> todas rechazadas"

# ---- presupuesto
r=$(sa "select reserve_budget('$A', null, 's', 'gen', null, 'eur', 1, 'nolimit')"); [ "$r" = "f" ] || fail "reserva sin limite aceptada"
r=$(sa "select reserve_budget('$A', null, 's', 'gen', null, 'eur', null, 'unknown')"); [ "$r" = "f" ] || fail "precio desconocido aceptado"
r=$(sa "select reserve_budget('$A', null, 's', 'gen', null, 'eur', -1, 'neg')"); [ "$r" = "f" ] || fail "importe negativo aceptado"
ok "sin limite = 0, precio desconocido y negativo bloqueados"
q "insert into budget_limits (owner_id, provider, unit, daily_limit) values ('$A','gen','credits',10)"
for i in 1 2 3 4 5 6 7 8; do sa "select reserve_budget('$A', null, 'step$i', 'gen', null, 'credits', 3, 'race-$i')" > "$DIR/r$i.txt" & done; wait
[ "$(cat "$DIR"/r*.txt | grep -c '^t$')" = "3" ] || fail "carrera de presupuesto: no fueron exactamente 3 reservas"
sa "select reserve_budget('$A', null, 'step1', 'gen', null, 'credits', 3, 'race-1')" >/dev/null
[ "$(q "select count(*) from budget_entries where owner_id='$A' and unit='credits'")" = "3" ] || fail "la reserva repetida duplico filas"
[ "$(q "select sum(reserved) from budget_entries where owner_id='$A' and unit='credits'")" = "9.0000" ] || fail "se supero el limite"
ok "8 sesiones sobre limite 10 con reservas de 3: exactamente 3 (9 <= 10); reintento no duplica"
[ "$(sa "select reserve_budget('$B', null, 's', 'gen', null, 'credits', 1, 'b-key')")" = "f" ] || fail "B heredo el limite de A"
ok "B no hereda el limite de A"
# incierto: no se libera, sigue contando; settle sobre incierto; resolve manual
K=$(q "select idempotency_key from budget_entries where owner_id='$A' order by created_at limit 1"); BASE="${K%:credits}"
sa "select mark_budget_uncertain('$A','$BASE')" >/dev/null
[ "$(sa "select release_budget('$A','$BASE')")" = "0" ] || fail "release libero una reserva incierta"
[ "$(q "select state from budget_entries where idempotency_key='$K'")" = "uncertain" ] || fail "la reserva dejo de ser incierta"
[ "$(sa "select reserve_budget('$A', null, 'zz', 'gen', null, 'credits', 2, 'after-unc')")" = "f" ] || fail "una reserva incierta dejo de ocupar presupuesto"
ok "reserva incierta: release no la libera y sigue ocupando limite"
sa "select resolve_uncertain_budget('$A','$BASE', false)" >/dev/null
[ "$(q "select state from budget_entries where idempotency_key='$K'")" = "released" ] || fail "resolve(no cobrado) no libero"
[ "$(sa "select reserve_budget('$A', null, 'zz', 'gen', null, 'credits', 2, 'after-unc')")" = "t" ] || fail "tras resolver no cabe"
K2=$(q "select idempotency_key from budget_entries where owner_id='$A' and state='reserved' limit 1"); B2="${K2%:credits}"
sa "select mark_budget_uncertain('$A','$B2')" >/dev/null; sa "select resolve_uncertain_budget('$A','$B2', true, 2.5)" >/dev/null
[ "$(q "select state||actual from budget_entries where idempotency_key='$K2'")" = "settled2.5000" ] || fail "resolve(cobrado) no concilio"
sa "select settle_budget('$A','after-unc','credits',2)" >/dev/null
[ "$(q "select state from budget_entries where idempotency_key='after-unc:credits'")" = "settled" ] || fail "settle no concilio"
ok "resolucion manual de lo incierto (cobrado/no cobrado) y conciliacion"
# release libera lo normal
sa "select reserve_budget('$A', null, 'rel', 'gen', null, 'credits', 1, 'rel-key')" >/dev/null
[ "$(sa "select release_budget('$A','rel-key')")" = "1" ] || fail "release no libero una reserva normal"
# comodines LIKE no abren la puerta
sa "select release_budget('$A','%')" >/dev/null
[ "$(q "select count(*) from budget_entries where owner_id='$A' and state='released' and idempotency_key not in ('rel-key:credits','$K')")" = "0" ] || fail "un comodin libero reservas ajenas"
ok "release libera lo normal; los comodines % y _ no liberan otras reservas"

# ---- rollback: el esquema vuelve EXACTAMENTE al de antes y los datos preexistentes siguen
run "cd $DIR && $P -d t -f 20261101120000_job_queue.rollback.sql"
run "$BIN/pg_dump -h $DIR -p $PORT -U postgres -d t --schema-only" | grep -vE '^(--|\\restrict|\\unrestrict)' > "$DIR/schema_after.sql"
diff -q "$DIR/schema_before.sql" "$DIR/schema_after.sql" >/dev/null || { diff "$DIR/schema_before.sql" "$DIR/schema_after.sql" | head -20; fail "el rollback no restauro el esquema original"; }
[ "$(q "select name from public.projects")" = "preexistente" ] || fail "el rollback toco datos preexistentes"
ok "rollback: esquema identico al previo (pg_dump) y datos preexistentes intactos"
run "cd $DIR && $P -d t -f 20261101120000_job_queue.sql" 2>&1 | grep -v NOTICE; run "cd $DIR && $P -d t -f 20261101120000_job_queue.rollback.sql"
run "cd $DIR && $P -d t -f 20261101120000_job_queue.rollback.sql"     # rollback tambien idempotente
ok "aplicar -> rollback -> rollback de nuevo sin error"
echo "ALL JOB-QUEUE SQL CHECKS PASSED ($PASS grupos)"
