#!/usr/bin/env bash
# Inicio / estado / parada SEGURA de Cerebro Studio en local (stack Supabase oficial sin Docker + la app en localhost).
# Uso: bash scripts/beta-local.sh up | status | down        (Linux o WSL2; no instala nada permanente ni arranca solo con el sistema)
# Datos 100 % sintéticos y locales; nunca usa URL, claves, base de datos ni bucket de Production. Solo escucha en 127.0.0.1.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
APP_PORT=${APP_PORT:-3100}; GW=${GATEWAY_PORT:-54321}; PIDF=/tmp/cerebro-beta-app.pid
SECRET=${SECRET:-official-local-secret-0123456789abcdef0123456789}
b64() { node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "$1"; }
anon_key() { local h p s; h=$(b64 '{"alg":"HS256","typ":"JWT"}'); p=$(b64 '{"role":"anon","iss":"local","exp":4102444800}'); s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$SECRET" -binary | basenc --base64url -w0 | tr -d '='); echo "$h.$p.$s"; }
port_busy() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && { exec 3>&-; return 0; }; return 1; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "FALTA: $1 ($2)"; return 1; }; }
preflight() {
  local bad=0
  for c in "node:Node.js 20+" "psql:PostgreSQL" "curl:curl" "openssl:openssl" "moto_server:moto (pip install moto[server])"; do need "${c%%:*}" "${c#*:}" || bad=1; done
  [ -d "${SRC:-/tmp/supa-src}/auth" ] || { echo "FALTA: servicios oficiales Auth/Storage compilados en ${SRC:-/tmp/supa-src} (ver docs/informe-p4-9-supabase-local.md §3)"; bad=1; }
  local free; free=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo); [ "${free:-0}" -ge 2500 ] || { echo "POCA MEMORIA: ${free} MB libres; hacen falta al menos 2500 MB"; bad=1; }
  for p in $GW $APP_PORT 54400 3000 5000 9999 5555; do port_busy $p && { echo "PUERTO OCUPADO: $p (¿ya está arrancado? prueba: bash scripts/beta-local.sh status)"; bad=1; }; done
  return $bad
}
status() {
  bash scripts/official-stack.sh status
  printf 'app: '; curl -s -m3 -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$APP_PORT/" || echo down
  printf 'memoria libre: %s MB\n' "$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
}
up() {
  preflight || { echo "No se arranca: corrige lo anterior."; exit 2; }
  local anon; anon=$(anon_key)
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GW" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$anon" NEXT_PUBLIC_CEREBRO_BETA=private node --experimental-strip-types scripts/check-beta-config.mjs 2>/dev/null | tail -1 | grep -q '^OK' || { echo "La configuración de la beta fue rechazada (no se arranca nada)."; exit 2; }
  echo "Arrancando base de datos y servicios locales (≈1 min)…"
  bash scripts/official-stack.sh up 2>&1 | tail -1 | grep -q STACK_OK || { echo "El stack no arrancó. Detenido."; bash scripts/official-stack.sh down; exit 2; }
  [ -d .next ] || { echo "No hay compilación: ejecuta antes «npx next build» con las variables de la beta (≈3 min)."; bash scripts/official-stack.sh down; exit 2; }
  (NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GW" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$anon" NEXT_PUBLIC_CEREBRO_BETA=private nohup npx next start -H 127.0.0.1 -p "$APP_PORT" >/tmp/cerebro-beta-app.log 2>&1 & echo $! >"$PIDF")
  for _ in $(seq 1 60); do curl -s -m2 -o /dev/null "http://127.0.0.1:$APP_PORT/" && { echo "LISTO: abre http://127.0.0.1:$APP_PORT en tu navegador (solo este ordenador)."; return 0; }; sleep 1; done
  echo "La app no respondió; revisa /tmp/cerebro-beta-app.log. Se detiene todo."; down; exit 2
}
down() {
  [ -f "$PIDF" ] && { pkill -P "$(cat "$PIDF")" 2>/dev/null; kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }
  pkill -f "next start -H 127.0.0.1 -p $APP_PORT" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  bash scripts/official-stack.sh down; echo "Detenido. Los datos de prueba se borran al volver a arrancar."
}
case "${1:-}" in up) up ;; status) status ;; down) down ;; *) echo "uso: $0 up|status|down"; exit 2 ;; esac
