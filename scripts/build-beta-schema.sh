#!/usr/bin/env bash
# Genera supabase/beta/schema-beta.sql: UN solo fichero para pegar en el SQL Editor de un proyecto Supabase NUEVO y VACÍO
# (baseline reconstruido + 7 pendientes en orden + disparador sobre auth.users). Nunca se ejecuta contra Production.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); OUT="$ROOT/supabase/beta/schema-beta.sql"
{
  echo "-- Cerebro Studio · esquema de la beta privada. GENERADO por scripts/build-beta-schema.sh (no editar a mano)."
  echo "-- Para un proyecto Supabase NUEVO y VACÍO. NO ejecutar en Production ni en ningún proyecto con datos."
  echo "-- Contenido: baseline_live.sql + supabase/pending/*.sql (en orden, sin rollbacks) + disparador on_auth_user_created + política de propiedad de proyecto."
  echo; echo "-- ===== baseline_live.sql ====="; cat "$ROOT/supabase/schema/baseline_live.sql"
  for f in $(ls "$ROOT"/supabase/pending/*.sql | grep -v rollback | sort); do echo; echo "-- ===== pending/$(basename "$f") ====="; cat "$f"; done
  echo; echo "-- ===== disparador sobre auth.users (esquema gestionado por Supabase; el baseline no lo crea) ====="
  echo "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();"
  echo; echo "-- ===== endurecimiento de la beta: una fila propia no puede apuntar al proyecto de otra persona (proposed/20261105130000) ====="
  cat "$ROOT/supabase/proposed/20261105130000_project_ownership_check.sql"
} > "$OUT"
echo "$OUT ($(wc -l < "$OUT") líneas, sha256 $(sha256sum "$OUT" | cut -c1-16))"
