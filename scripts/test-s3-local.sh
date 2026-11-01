#!/usr/bin/env bash
# Pruebas de almacenamiento contra un servidor S3 LOCAL (moto) con el código REAL de lib/storage (R2_ENDPOINT). Sustituto: NO valida R2 ni Supabase Storage.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); python3 -c 'import moto' 2>/dev/null || pip install 'moto[server]' --break-system-packages -q
D=$(mktemp -d /tmp/s3data.XXXXXX); PORT=54360
# moto implementa multipart, listados y abort completos pero NO valida firmas SigV4 (declarado en el informe).
python3 -m moto.server -H 127.0.0.1 -p $((PORT+1)) >"$D.moto.log" 2>&1 & PID2=$!
trap 'kill $PID2 2>/dev/null; rm -rf "$D" "$D.log" "$D.moto.log"' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:$((PORT+1))/ && break; sleep 0.25; done
curl -s -o /dev/null -X PUT http://127.0.0.1:$((PORT+1))/cerebro-test
cd "$ROOT" && S3_LOCAL_ENDPOINT=http://127.0.0.1:$((PORT+1)) npx vitest run tests/integration/s3-local.test.ts --reporter=verbose 2>&1 | grep -vE "^$"
