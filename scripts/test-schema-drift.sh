#!/usr/bin/env bash
# Compares the columns produced by (repo migrations + pending) on a throw-away PostgreSQL against supabase/schema/live-columns.txt
# (structure-only snapshot of Production). Prints every difference. Exit 1 if there is drift not listed in supabase/schema/known-drift.txt.
set -uo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgdrift.XXXXXX); chown postgres "$DIR"; PORT=54332
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"; run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -q -X -d postgres"
cp "$ROOT"/supabase/schema/baseline_live.sql "$ROOT"/scripts/schema-counts.sql "$ROOT"/supabase/tests/supabase_stub.sql "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/pending/*.sql "$ROOT"/scripts/schema-columns.sql "$DIR"/; chmod 644 "$DIR"/*.sql
MODE=${1:-baseline}   # baseline = reconstructed live baseline (must match exactly); repo = the 12 repo migrations; all = repo + pending
run "cd $DIR && $P -f supabase_stub.sql" >/dev/null 2>&1
if [ "$MODE" = baseline ]; then run "cd $DIR && $P -v ON_ERROR_STOP=1 -f baseline_live.sql" > "$DIR/base.log" 2>&1 || { echo "BASELINE FAILED TO APPLY"; grep -v NOTICE "$DIR/base.log" | head; exit 1; }
else for f in $(cd "$ROOT/supabase/migrations" && ls *.sql | grep -v rollback | sort); do run "cd $DIR && $P -f $f" >/dev/null 2>&1; done; fi
[ "$MODE" = all ] && for f in $(cd "$ROOT/supabase/pending" && ls *.sql | grep -v rollback | sort); do run "cd $DIR && $P -f $f" >/dev/null 2>&1; done
run "cd $DIR && $P -At -f schema-columns.sql" > "$DIR/built.txt" 2>/dev/null
grep -v '^#' "$ROOT/supabase/schema/live-columns.txt" | sort > "$DIR/live.txt"; sort "$DIR/built.txt" > "$DIR/built.s"
diff "$DIR/live.txt" "$DIR/built.s" > "$DIR/diff.txt"; cat "$DIR/diff.txt"
run "cd $DIR && $P -At -f schema-counts.sql" | sort > "$DIR/counts.built"; sort "$ROOT/supabase/schema/live-counts.txt" > "$DIR/counts.live"
if [ "$MODE" = baseline ]; then diff "$DIR/counts.live" "$DIR/counts.built" && [ ! -s "$DIR/diff.txt" ] && echo "BASELINE MATCHES LIVE (columns + object counts)" && exit 0 || { echo "BASELINE DIFFERS FROM LIVE"; exit 1; }; fi
KNOWN="$ROOT/supabase/schema/known-drift-$MODE.txt"; [ -f "$KNOWN" ] || : > "$KNOWN"
if diff -q "$DIR/diff.txt" "$KNOWN" >/dev/null; then echo "SCHEMA DRIFT: unchanged from the documented baseline ($(grep -c '^[<>]' "$DIR/diff.txt") differing lines)"; else
  [ "${UPDATE_BASELINE:-}" = 1 ] && cp "$DIR/diff.txt" "$KNOWN" && echo "baseline updated" || { echo "SCHEMA DRIFT CHANGED vs documented baseline"; exit 1; }; fi
