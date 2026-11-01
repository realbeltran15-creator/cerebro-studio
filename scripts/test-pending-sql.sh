#!/usr/bin/env bash
# PostgreSQL 16 LOCAL y DESECHABLE + sustitutos mínimos de auth/roles. NO es Supabase (sin PostgREST, Auth, Storage ni Realtime).
# Aplica las 5 propuestas de supabase/pending y ejecuta pruebas de integridad con sesiones concurrentes reales.
# Nunca toca Production. Salida: PASS/FAIL por prueba + resumen. Una prueba que documenta un defecto conocido se marca FINDING.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgpend.XXXXXX); chown postgres "$DIR"; PORT=54342
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null" && run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c max_connections=100' -l $DIR/log -w start >/dev/null" || { echo "no arranca PG"; exit 2; }
PSQL="$BIN/psql -h $DIR -p $PORT -U postgres -X -q -t -A"
chmod 755 "$DIR"
A=00000000-0000-0000-0000-00000000000a; B=00000000-0000-0000-0000-00000000000b
sql()  { $PSQL -v ON_ERROR_STOP=1 -c "$1" postgres 2>&1; }              # superusuario (service)
as()   { local u=$1; shift; $PSQL -v ON_ERROR_STOP=1 postgres -c "set role authenticated; select set_config('request.jwt.claim.sub','$u',false); $*" 2>&1 | grep -v '^$' | tail -n +2; }
PASS=0; FAIL=0; FIND=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1  -> $2"; }
find_(){ FIND=$((FIND+1)); echo "FINDING  $1  -> $2"; }
eq()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "esperado '$3' obtenido '$2'"; }

run "cat > $DIR/base.sql" < "$ROOT/supabase/tests/pending_live_shape.sql"
$PSQL -v ON_ERROR_STOP=1 -f "$DIR/base.sql" postgres >/dev/null 2>"$DIR/base.err" || { cat "$DIR/base.err"; echo "esquema base falla"; exit 2; }
for f in "$ROOT"/supabase/pending/20261102*[0-9]_*.sql; do case $f in *rollback*) continue;; esac
  $PSQL -v ON_ERROR_STOP=1 -f "$f" postgres >/dev/null 2>"$DIR/mig.err" && ok "aplica $(basename $f)" || bad "aplica $(basename $f)" "$(cat $DIR/mig.err)"; done
sql "insert into auth.users values ('$A'),('$B');
 insert into projects(id,owner_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','$A','pA'),('bbbbbbbb-0000-0000-0000-000000000001','$B','pB');
 insert into scripts(id,owner_id,project_id,title) values ('aaaaaaaa-0000-0000-0000-0000000000a1','$A','aaaaaaaa-0000-0000-0000-000000000001','Guion A');" >/dev/null
PA=aaaaaaaa-0000-0000-0000-000000000001; SA=aaaaaaaa-0000-0000-0000-0000000000a1

echo "== reserve_generation_spend =="
for i in $(seq 1 20); do sql "select reserve_generation_spend('$A','r$i','p','m','t',1,5,100)" > $DIR/rs$i & done; wait
eq "20 reservas paralelas, tope diario 5 -> exactamente 5 reservadas" "$(cat $DIR/rs*  | grep -c '^reserved$')" 5
eq "…y 15 rechazadas por daily_cap" "$(cat $DIR/rs* | grep -c '^daily_cap$')" 15
eq "libro de gasto = 5 filas, 5.0000 USD" "$(sql "select count(*)||'/'||sum(estimate_usd) from generation_spend where owner_id='$A'")" "5/5.0000"
rm -f $DIR/rs*
for i in $(seq 1 10); do sql "select reserve_generation_spend('$B','same','p','m','t',1,50,100)" > $DIR/rd$i & done; wait
eq "10 peticiones con el MISMO request_id -> 1 reserved" "$(cat $DIR/rd* | grep -c '^reserved$')" 1
eq "…y 9 duplicate" "$(cat $DIR/rd* | grep -c '^duplicate$')" 9
eq "tope 0 bloquea todo" "$(sql "select reserve_generation_spend('$B','z','p','m','t',0.01,0,100)")" daily_cap
eq "tope mensual" "$(sql "select reserve_generation_spend('$B','mm','p','m','t',2,50,2.5)")" monthly_cap
eq "usuarios independientes (tope de A no afecta a B)" "$(sql "select reserve_generation_spend('$B','ok1','p','m','t',1,50,100)")" reserved
r=$(as $A "select reserve_generation_spend('$A','hack','p','m','t',1,5,100)" || true); echo "$r" | grep -qi 'permission denied' && ok "authenticated NO puede llamar a reserve_generation_spend" || bad "permiso reserve" "$r"
r=$(as $A "insert into generation_spend(owner_id,request_id,provider,model,tier,estimate_usd) values ('$A','x','p','m','t',0)"); echo "$r" | grep -qi 'permission denied' && ok "authenticated NO puede insertar en el libro" || bad "insert libro" "$r"
eq "authenticated solo ve SU gasto (RLS)" "$(as $B "select count(*) from generation_spend where owner_id='$A'")" 0

echo "== transcription locks =="
for i in $(seq 1 12); do sql "select acquire_transcription_lock('k1','w$i',30)" > $DIR/lk$i & done; wait
eq "12 workers a la vez, 1 solo gana el bloqueo" "$(cat $DIR/lk* | grep -c '^t$')" 1
winner=$(for i in $(seq 1 12); do grep -q '^t$' $DIR/lk$i && echo w$i; done)
sql "select release_transcription_lock('k1','intruso')" >/dev/null
eq "otro dueño NO puede liberar" "$(sql "select count(*) from transcription_locks where key='k1'")" 1
sql "select release_transcription_lock('k1','$winner')" >/dev/null
eq "el dueño libera y se puede readquirir" "$(sql "select acquire_transcription_lock('k1','nuevo',30)")" t
eq "bloqueo vivo rechaza otro dueño" "$(sql "select acquire_transcription_lock('k1','otro',30)")" f
sql "select acquire_transcription_lock('k2','a',1)" >/dev/null; sleep 2.2
eq "bloqueo caducado (TTL 1s) se toma por otro" "$(sql "select acquire_transcription_lock('k2','b',30)")" t
r=$(as $A "select acquire_transcription_lock('k3','a',30)"); echo "$r" | grep -qi 'permission denied' && ok "authenticated NO puede llamar al bloqueo" || bad "permiso lock" "$r"
r=$(as $A "select count(*) from transcription_locks"); echo "$r" | grep -qi 'permission denied\|^0$' && ok "authenticated no lee transcription_locks" || bad "lee locks" "$r"

echo "== índice único de subtítulos =="
for i in $(seq 1 10); do sql "insert into assets(owner_id,asset_type,provenance) values ('$A','subtitle','{\"sourceAssetId\":\"src1\"}')" >/dev/null 2>&1 && echo 1 > $DIR/su$i & done; wait
eq "10 inserts concurrentes del mismo subtítulo -> 1 fila" "$(sql "select count(*) from assets where owner_id='$A' and asset_type='subtitle'")" 1
eq "mismo origen en OTRO usuario permitido" "$(sql "insert into assets(owner_id,asset_type,provenance) values ('$B','subtitle','{\"sourceAssetId\":\"src1\"}') returning 1" | head -1)" 1
eq "mismo origen en un asset NO subtítulo permitido (x2)" "$(sql "insert into assets(owner_id,asset_type,provenance) values ('$A','audio','{\"sourceAssetId\":\"src1\"}'),('$A','audio','{\"sourceAssetId\":\"src1\"}') returning 1" | head -1)" 1
eq "subtítulos sin sourceAssetId no chocan (x2)" "$(sql "insert into assets(owner_id,asset_type) values ('$A','subtitle'),('$A','subtitle') returning 1" | head -1)" 1
eq "otro origen del mismo usuario permitido" "$(sql "insert into assets(owner_id,asset_type,provenance) values ('$A','subtitle','{\"sourceAssetId\":\"src2\"}') returning 1" | head -1)" 1

echo "== create_storyboard_from_script =="
SC='[{"position":1,"duration_ms":4000,"narration":"hook","metadata":{"script_section_id":"s1"}},{"position":2,"duration_ms":6000,"narration":"cuerpo","metadata":{"script_section_id":"s2"}}]'
b1=$(as $A "select create_storyboard_from_script('$SA','$SC'::jsonb)")
b2=$(as $A "select create_storyboard_from_script('$SA','$SC'::jsonb)")
eq "idempotente secuencial: mismo storyboard" "$b1" "$b2"
eq "idempotente secuencial: 2 escenas, no 4" "$(sql "select count(*) from scenes where storyboard_id='$b1'")" 2
SC3='[{"position":1,"duration_ms":4000,"narration":"hook","metadata":{"script_section_id":"s1"}},{"position":3,"duration_ms":3000,"narration":"nueva","metadata":{"script_section_id":"s3"}}]'
as $A "select create_storyboard_from_script('$SA','$SC3'::jsonb)" >/dev/null
eq "reanudar añade solo la sección nueva (3 escenas, posiciones 1,2,3)" "$(sql "select count(*)||':'||string_agg(position::text,',' order by position) from scenes where storyboard_id='$b1'")" "3:1,2,3"
r=$(as $B "select create_storyboard_from_script('$SA','$SC'::jsonb)"); echo "$r" | grep -q script_not_found && ok "usuario B NO puede crear storyboard sobre guion de A" || bad "aislamiento guion" "$r"
eq "B no ve storyboards de A (RLS)" "$(as $B "select count(*) from storyboards")" 0
sql "insert into scripts(id,owner_id,project_id,title,version) values ('aaaaaaaa-0000-0000-0000-0000000000a2','$A','$PA','Guion A2',2)" >/dev/null; SA2=aaaaaaaa-0000-0000-0000-0000000000a2
for i in $(seq 1 10); do as $A "select create_storyboard_from_script('$SA2','$SC'::jsonb)" >$DIR/sb$i.err 2>&1 & done; wait
cp $DIR/sb1.err /tmp/sb1.err 2>/dev/null; cat $DIR/sb*.err | sort | uniq -c | head -5 >/tmp/sbsum.txt; nb=$(sql "select count(*) from storyboards where script_id='$SA2'"); ns=$(sql "select count(*) from scenes s join storyboards b on b.id=s.storyboard_id where b.script_id='$SA2'")
if [ "$nb" = 1 ] && [ "$ns" = 2 ]; then ok "10 llamadas concurrentes: 1 storyboard, 2 escenas"
else find_ "CARRERA create_storyboard_from_script: 10 llamadas concurrentes -> $nb storyboards, $ns escenas (esperado 1 y 2). La propuesta NO es segura bajo concurrencia." "necesita bloqueo (p.ej. pg_advisory_xact_lock por script) o índice único parcial en storyboards(script_id)"; fi

echo "== regresión: bloqueo por guion en create_storyboard_from_script =="
# 1) Independencia: una sesión retiene el lock del guion X; otra llamada sobre el guion Y NO debe esperar.
sql "insert into scripts(id,owner_id,project_id,title,version) values ('aaaaaaaa-0000-0000-0000-0000000000a3','$A','$PA','Guion A3',3)" >/dev/null; SA3=aaaaaaaa-0000-0000-0000-0000000000a3
$PSQL postgres -c "begin; select pg_advisory_xact_lock(hashtextextended('storyboard_from_script:$SA2',0)); select pg_sleep(4); commit;" >/dev/null 2>&1 & HOLD=$!
sleep 0.6
t0=$(date +%s%N); as $A "select create_storyboard_from_script('$SA3','$SC'::jsonb)" >/dev/null; t1=$(date +%s%N)
ms=$(( (t1-t0)/1000000 )); [ $ms -lt 2000 ] && ok "guion Y no espera al lock del guion X (${ms} ms con X retenido 4 s)" || bad "independencia de locks" "${ms} ms"
t0=$(date +%s%N); as $A "select create_storyboard_from_script('$SA2','$SC'::jsonb)" >/dev/null; t1=$(date +%s%N)
ms=$(( (t1-t0)/1000000 )); [ $ms -ge 2000 ] && ok "el MISMO guion sí espera al lock retenido (${ms} ms)" || bad "mismo guion debe esperar" "${ms} ms"
wait $HOLD
# 2) Liberación tras fallo: una llamada que falla (p_scenes inválido) no deja el lock retenido.
as $A "select create_storyboard_from_script('$SA3','[{\"position\":\"x\",\"duration_ms\":\"no\"}]'::jsonb)" >/dev/null 2>&1
eq "tras una llamada fallida no queda ningún advisory lock retenido" "$(sql "select count(*) from pg_locks where locktype='advisory'")" 0
t0=$(date +%s%N); as $A "select create_storyboard_from_script('$SA3','$SC'::jsonb)" >/dev/null; t1=$(date +%s%N)
[ $(( (t1-t0)/1000000 )) -lt 2000 ] && ok "tras el fallo, la siguiente llamada al mismo guion entra sin esperar" || bad "lock tras fallo" "esperó"
eq "el fallo no dejó storyboards/escenas duplicadas del guion A3" "$(sql "select count(*) from storyboards where script_id='$SA3'")" 1
# 3) Identificador estable y sin colisiones prácticas: 100 000 uuids distintos -> 100 000 claves distintas; misma entrada -> misma clave.
eq "hashtextextended determinista (misma entrada, misma clave)" "$(sql "select hashtextextended('storyboard_from_script:$SA',0)=hashtextextended('storyboard_from_script:$SA',0)")" t
eq "100 000 guiones distintos -> 100 000 claves de 64 bits distintas (0 colisiones)" "$(sql "select count(distinct hashtextextended('storyboard_from_script:'||gen_random_uuid()::text,0)) from generate_series(1,100000)")" 100000
eq "el prefijo separa dominios (no choca con el lock de gasto del mismo uuid)" "$(sql "select hashtextextended('storyboard_from_script:$SA',0)<>hashtextextended('generation_spend:$SA',0)")" t

echo "== reorder_scenes / escenas =="
RB=$(as $A "insert into storyboards(owner_id,project_id,title) values ('$A','$PA','R') returning id" | head -1)
for p in 1 2 3 4 5; do sql "insert into scenes(owner_id,storyboard_id,position,narration) values ('$A','$RB',$p,'e$p')" >/dev/null; done
ids=$(sql "select string_agg(id::text,',' order by position) from scenes where storyboard_id='$RB'"); IFS=, read -ra I <<< "$ids"
arr() { local s=""; for x in "$@"; do s="$s'$x',"; done; echo "array[${s%,}]::uuid[]"; }
as $A "select reorder_scenes('$RB', $(arr ${I[4]} ${I[3]} ${I[2]} ${I[1]} ${I[0]}))" >/dev/null
eq "reordenar invierte el orden y mantiene 1..5" "$(sql "select string_agg(narration,',' order by position) from scenes where storyboard_id='$RB'")" "e5,e4,e3,e2,e1"
r=$(as $A "select reorder_scenes('$RB', $(arr ${I[0]} ${I[1]}))"); echo "$r" | grep -q scene_set_mismatch && ok "conjunto incompleto -> scene_set_mismatch" || bad "mismatch incompleto" "$r"
r=$(as $A "select reorder_scenes('$RB', $(arr ${I[0]} ${I[1]} ${I[2]} ${I[3]} 99999999-0000-0000-0000-000000000000))"); echo "$r" | grep -q scene_set_mismatch && ok "id ajeno -> scene_set_mismatch" || bad "mismatch ajeno" "$r"
r=$(as $B "select reorder_scenes('$RB', $(arr ${I[0]} ${I[1]} ${I[2]} ${I[3]} ${I[4]}))"); echo "$r" | grep -q scene_set_mismatch && ok "usuario B no puede reordenar escenas de A" || bad "aislamiento reorder" "$r"
eq "tras los rechazos el orden NO cambió" "$(sql "select string_agg(narration,',' order by position) from scenes where storyboard_id='$RB'")" "e5,e4,e3,e2,e1"
perms=("${I[0]} ${I[1]} ${I[2]} ${I[3]} ${I[4]}" "${I[4]} ${I[3]} ${I[2]} ${I[1]} ${I[0]}" "${I[2]} ${I[0]} ${I[4]} ${I[1]} ${I[3]}" "${I[1]} ${I[3]} ${I[0]} ${I[2]} ${I[4]}")
for n in $(seq 1 12); do p=${perms[$((n%4))]}; as $A "select reorder_scenes('$RB', $(arr $p))" >/dev/null 2>$DIR/ro$n.err & done; wait
eq "12 reordenaciones concurrentes: posiciones siguen siendo 1..5 sin duplicados" "$(sql "select string_agg(position::text,',' order by position) from scenes where storyboard_id='$RB'")" "1,2,3,4,5"
errs=$(cat $DIR/ro*.err | grep -ci 'deadlock\|duplicate key'); [ "$errs" = 0 ] && ok "sin deadlocks ni violaciones de unicidad en reorder concurrente" || find_ "reorder concurrente: $errs errores deadlock/unique" "$(cat $DIR/ro*.err | sort | uniq -c | head -3)"
t0=$(sql "select updated_at from scenes where id='${I[0]}'"); sleep 0.05; sql "update scenes set narration='x' where id='${I[0]}'" >/dev/null
[ "$(sql "select updated_at > '$t0' from scenes where id='${I[0]}'")" = t ] && ok "trigger actualiza scenes.updated_at" || bad "touch" "no cambió"

echo "== borrados / integridad referencial =="
sql "delete from storyboards where id='$RB'" >/dev/null
eq "borrar storyboard borra sus escenas (cascade)" "$(sql "select count(*) from scenes where storyboard_id='$RB'")" 0
sql "delete from scripts where id='$SA'" >$DIR/del.err 2>&1
if grep -q 'violates foreign key' $DIR/del.err; then bad "borrar guion con storyboard" "$(cat $DIR/del.err)"; else eq "borrar guion conserva el storyboard con script_id NULL (FK real = SET NULL)" "$(sql "select count(*) from storyboards where id='$b1' and script_id is null")" 1; fi
sql "delete from auth.users where id='$B'" >/dev/null
eq "borrar usuario limpia gasto y proyectos (cascade)" "$(sql "select (select count(*) from generation_spend where owner_id='$B')+(select count(*) from projects where owner_id='$B')")" 0

echo "== reversibilidad (rollback) =="
for f in "$ROOT"/supabase/pending/20261102*.rollback.sql; do $PSQL -v ON_ERROR_STOP=1 -f "$f" postgres >/dev/null 2>"$DIR/rb.err" && ok "rollback $(basename $f)" || bad "rollback $(basename $f)" "$(head -c 200 $DIR/rb.err)"; done

echo; echo "RESUMEN: ejecutadas $((PASS+FAIL+FIND)) · pasan $PASS · fallan $FAIL · hallazgos de diseño $FIND · (PostgreSQL local con sustitutos, NO Supabase real)"
[ "$FAIL" = 0 ]
