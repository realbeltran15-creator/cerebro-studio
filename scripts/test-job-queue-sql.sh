#!/usr/bin/env bash
# Valida supabase/pending/20261101120000_job_queue.sql (y su rollback) en un PostgreSQL local DESECHABLE con stubs de Supabase.
# No toca la base compartida. Comprueba: idempotencia de la migracion, RLS, unicidad, reclamo atomico concurrente,
# recuperacion de lease caducado, reservas de presupuesto concurrentes y rollback. Necesita binarios de postgres y root.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgq.XXXXXX); chown postgres "$DIR"; PORT=54331
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
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
create table public.projects (id uuid primary key default gen_random_uuid(), owner_id uuid);
grant all on all tables in schema public to service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
SQL
run "cd $DIR && $P -d t -f stubs.sql && $P -d t -f 20261101120000_job_queue.sql && $P -d t -f 20261101120000_job_queue.sql"   # 2 veces = idempotente
run "cd $DIR && $P -d t -c 'grant all on all tables in schema public to service_role'"
A=00000000-0000-0000-0000-00000000000a; B=00000000-0000-0000-0000-00000000000b
q() { run "$P -d t -At -c \"$1\""; }
fail() { echo "FALLO: $1"; exit 1; }

# unicidad de idempotencia por (owner, kind, clave)
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','k','idem-key-1','h')"
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$B','k','idem-key-1','h')"   # otro propietario: permitido
if q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) values ('$A','k','idem-key-1','h')" 2>/dev/null; then fail "clave duplicada aceptada"; fi
# estado invalido y running sin lease
if q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, status) values ('$A','k','idem-key-2','h','bogus')" 2>/dev/null; then fail "estado invalido aceptado"; fi
if q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash, status) values ('$A','k','idem-key-3','h','running')" 2>/dev/null; then fail "running sin lease aceptado"; fi

# RLS: el usuario A ve solo lo suyo y no puede escribir
n=$(run "$P -d t -At -c \"set role authenticated; set request.jwt.claim.sub='$A'; select count(*) from job_queue\"" | tail -1)
[ "$n" = "1" ] || fail "RLS select: $n"
if run "$P -d t -At -c \"set role authenticated; set request.jwt.claim.sub='$A'; update job_queue set status='completed'\"" 2>/dev/null | grep -q .; then :; fi
s=$(q "select count(*) from job_queue where status='completed'"); [ "$s" = "0" ] || fail "el usuario pudo completar un trabajo"
if run "$P -d t -c \"set role authenticated; select claim_next_job('x',60)\"" 2>/dev/null; then fail "authenticated puede reclamar"; fi

# reclamo concurrente: 12 trabajos, 8 sesiones x 3 intentos -> cada trabajo reclamado exactamente una vez
q "delete from job_queue"
q "insert into job_queue (owner_id, kind, idempotency_key, payload_hash) select '$A','k','bulk-key-'||g,'h' from generate_series(1,12) g"
for i in 1 2 3 4 5 6 7 8; do
  ( for k in 1 2 3; do run "$P -d t -At -c \"set role service_role; select id from claim_next_job('ex-$i', 60)\"" ; done > "$DIR/c$i.txt" ) &
done; wait
tot=$(cat "$DIR"/c*.txt | grep -c . || true); uniq=$(cat "$DIR"/c*.txt | grep . | sort -u | wc -l)
[ "$uniq" = "$tot" ] || fail "trabajo reclamado dos veces ($tot reclamos, $uniq unicos)"
[ "$tot" = "12" ] || fail "se esperaban 12 reclamos y hubo $tot"
# lease caducado se recupera una vez; uno vigente no
q "update job_queue set lease_expires_at = now() - interval '1 second' where id = (select id from job_queue limit 1)"
r=$(run "$P -d t -At -c \"set role service_role; select count(*) from claim_next_job('rescue', 60) where id is not null\"" | tail -1)
[ "$r" = "1" ] || fail "no se recupero el lease caducado ($r)"
r=$(run "$P -d t -At -c \"set role service_role; select count(*) from claim_next_job('rescue2', 60) where id is not null\"" | tail -1)
[ "$r" = "0" ] || fail "se reclamo un lease vigente"

# presupuesto: sin limite = 0; 8 sesiones compiten por un limite de 10 con reservas de 3 -> pasan exactamente 3
r=$(q "select reserve_budget('$A', null, 's', 'gen', null, 'eur', 1, 'nolimit')"); [ "$r" = "f" ] || fail "reserva sin limite aceptada"
r=$(q "select reserve_budget('$A', null, 's', 'gen', null, 'eur', null, 'unknown')"); [ "$r" = "f" ] || fail "precio desconocido aceptado"
q "insert into budget_limits (owner_id, provider, unit, daily_limit) values ('$A','gen','credits',10)"
for i in 1 2 3 4 5 6 7 8; do
  run "$P -d t -At -c \"select reserve_budget('$A', null, 'step$i', 'gen', null, 'credits', 3, 'race-$i')\"" > "$DIR/r$i.txt" &
done; wait
ok=$(cat "$DIR"/r*.txt | grep -c '^t$' || true); [ "$ok" = "3" ] || fail "carrera de presupuesto: $ok reservas (esperadas 3)"
r=$(q "select reserve_budget('$A', null, 'step1', 'gen', null, 'credits', 3, 'race-1')")   # reintento con la misma clave
tot=$(q "select count(*) from budget_entries where owner_id='$A' and unit='credits'"); [ "$tot" = "3" ] || fail "la reserva repetida duplico filas ($tot)"
# aislamiento de propietario
r=$(q "select reserve_budget('$B', null, 's', 'gen', null, 'credits', 1, 'b-key')"); [ "$r" = "f" ] || fail "B heredo el limite de A"

# rollback
run "cd $DIR && $P -d t -f 20261101120000_job_queue.rollback.sql"
left=$(q "select count(*) from pg_tables where schemaname='public' and tablename in ('job_queue','job_approvals','budget_limits','budget_entries')")
[ "$left" = "0" ] || fail "el rollback dejo tablas"
fn=$(q "select count(*) from pg_proc where proname in ('claim_next_job','reserve_budget')"); [ "$fn" = "0" ] || fail "el rollback dejo funciones"
echo "ALL JOB-QUEUE SQL CHECKS PASSED"
