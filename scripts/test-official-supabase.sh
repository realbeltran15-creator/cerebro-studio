#!/usr/bin/env bash
# Valida Auth/Storage OFICIALES de Supabase (compilados desde el código fuente, sin Docker) con el cliente @supabase/supabase-js real.
# Reinicia el stack desde cero (datos sintéticos) y ejecuta el trayecto de datos + sección 6 (solo servicios oficiales).
#   JOURNEY_SCRIPT=local-e2e-editor.mjs  → E2E audiovisual real (Next.js + Chromium + FFprobe) contra el stack oficial.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
bash scripts/official-stack.sh up > /tmp/stack-up.log 2>&1 </dev/null || { cat /tmp/stack-up.log; echo "el stack oficial no arranca"; exit 2; }
SECRET=${SECRET:-official-local-secret-0123456789abcdef0123456789}
OFFICIAL=1 PGRST_URL=http://127.0.0.1:3000 JWT_SECRET="$SECRET" PGDIR=/var/run/postgresql PGPORT=54400 node scripts/${JOURNEY_SCRIPT:-local-journey.mjs}
rc=$?; [ "${KEEP_STACK:-}" = 1 ] || bash scripts/official-stack.sh down >/dev/null 2>&1; exit $rc
