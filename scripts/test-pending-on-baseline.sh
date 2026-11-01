#!/usr/bin/env bash
# Applies the reconstructed LIVE BASELINE (supabase/schema/baseline_live.sql), then the 7 pending migrations to a throw-away local PostgreSQL with Supabase-style stubs,
# then re-applies each pending one (idempotency), rolls them back in reverse order and re-applies. Never touches any remote project.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgbase.XXXXXX); chown postgres "$DIR"; PORT=54333
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X -d postgres"
cp "$ROOT"/supabase/tests/supabase_stub.sql "$DIR/stub.sql"; chmod 644 "$DIR/stub.sql"; cp "$ROOT"/supabase/schema/baseline_live.sql "$ROOT"/supabase/pending/*.sql "$DIR"/ 2>/dev/null; chmod 644 "$DIR"/*.sql
FAIL=0
# Known drift between the repo migrations and the live schema (the repo chain does NOT rebuild Production: live has
# assets.asset_type, opportunities.source_id, channel_connections.provider that no repo migration creates). Reported as DRIFT, not as a failure.
KNOWN="none"
DRIFT=0
step() { # name file
  if out=$(run "cd $DIR && $P -f $2" 2>&1); then echo "ok   $1"; else
    if echo "$KNOWN" | grep -q "${2%.sql}"; then echo "DRIFT $1"; DRIFT=$((DRIFT+1)); else echo "FAIL $1"; FAIL=1; fi
    echo "$out" | grep -v NOTICE | head -3 | sed 's/^/       /'; fi; }
step stubs stub.sql
step "baseline_live.sql" baseline_live.sql
PEND=$(cd "$ROOT/supabase/pending" && ls *.sql | grep -v rollback | sort)
for f in $PEND; do step "pend  $f" "$f"; done
for f in $PEND; do step "again $f (idempotent)" "$f"; done
for f in $(echo "$PEND" | sort -r); do step "rollb ${f%.sql}" "${f%.sql}.rollback.sql"; done
for f in $PEND; do step "reapp $f" "$f"; done
echo "known drift items: $DRIFT"; [ $FAIL = 0 ] && echo "CHAIN OK " || { echo "CHAIN HAS FAILURES"; exit 1; }
