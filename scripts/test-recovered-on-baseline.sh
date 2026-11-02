#!/usr/bin/env bash
# Las migraciones recuperadas de Production (supabase/recovered/) no deben cambiar el esquema ya reconstruido en baseline_live.sql.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgrec.XXXXXX); chown postgres "$DIR"; chmod 755 "$DIR"; PORT=54372
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }; trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null" && run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null" || exit 2
P="$BIN/psql -h $DIR -p $PORT -U postgres -X -q -At -v ON_ERROR_STOP=1 postgres"
pass=0; fail=0; t() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1 (esperado '$3', obtenido '$2')"; fi; }
$P -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null && $P -f "$ROOT/supabase/schema/baseline_live.sql" >/dev/null 2>&1 || { echo "falla el baseline"; exit 2; }
fp() { $P -c "select md5(string_agg(x, '|' order by x)) from (select indexname||indexdef x from pg_indexes where schemaname='public' union all select policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname='public' union all select 'priv:'||has_function_privilege('anon','public.handle_new_user()','execute')::text||has_function_privilege('authenticated','public.handle_new_user()','execute')::text) s"; }
A=$(fp)
# El baseline es el estado FINAL; la migración original es historia en orden. 3 políticas que modifica fueron sustituidas después por server_owned_security (en el repo).
$P -v ON_ERROR_STOP=0 -f "$ROOT/supabase/recovered/20260916214243_security_and_performance_hardening.sql" >/dev/null 2>"$DIR/e1"
t "hardening original: las únicas sentencias que no aplican son las 3 políticas sustituidas después por server_owned_security" "$(grep ERROR "$DIR/e1" | sed -E 's/.*policy "([a-z_]+)".*/\1/' | sort | tr '\n' ' ')" "approvals_own connections_own publication_jobs_own "
t "hardening original no cambia índices, políticas ni privilegios (lo que aplica ya estaba reflejado en el baseline)" "$(fp)" "$A"
t "los 12 índices del hardening existen" "$($P -c "select count(*) from pg_indexes where schemaname='public' and indexname in ('assets_project_id_idx','audit_log_actor_id_idx','metric_snapshots_project_id_idx','opportunities_project_id_idx','publication_jobs_approved_by_idx','publication_jobs_project_id_idx','render_jobs_output_asset_id_idx','render_jobs_owner_id_idx','render_jobs_project_id_idx','scenes_owner_id_idx','storyboards_owner_id_idx','storyboards_project_id_idx')")" 12
t "anon/authenticated no pueden ejecutar handle_new_user" "$($P -c "select has_function_privilege('anon','public.handle_new_user()','execute')::text||has_function_privilege('authenticated','public.handle_new_user()','execute')::text")" falsefalse
$P -f "$ROOT/supabase/recovered/20260928193119_shared_ai_memory_v1.sql" >/dev/null 2>"$DIR/e2" && r2=ok || r2=error; t "shared_ai_memory_v1 se aplica sin error" "$r2" ok
t "shared_ai_memory_v1 no toca el esquema public" "$(fp)" "$A"
t "ai_memory no es accesible para anon/authenticated" "$($P -c "select has_schema_privilege('anon','ai_memory','usage')::text||has_schema_privilege('authenticated','ai_memory','usage')::text")" falsefalse
echo; echo "RESUMEN: $pass correctas, $fail fallidas"; [ $fail = 0 ]
