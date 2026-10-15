#!/usr/bin/env bash
# Applies the PENDING migrations (research_cache, campaigns) to a THROW-AWAY local PostgreSQL with Supabase-style stubs
# (auth.users, auth.uid(), anon/authenticated roles, public.projects) and checks idempotency, RLS, constraints and rollback.
# It never touches the shared Supabase database. Needs the local postgresql binaries and root (to run as the postgres user).
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d /tmp/pgtest.XXXXXX); chown postgres "$DIR"; PORT=54329
run() { su postgres -s /bin/bash -c "$*"; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$BIN/initdb -D $DIR/data -A trust >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
cp "$ROOT"/supabase/migrations/20261013120000_research_cache.sql "$ROOT"/supabase/migrations/20261015120000_campaigns.sql "$ROOT"/supabase/rollback/*.sql "$ROOT"/supabase/tests/migrations_check.sql "$DIR/"
chmod 644 "$DIR"/*.sql
run "$P -d postgres -c 'create database t'"
run "cd $DIR && $P -d t -f migrations_check.sql" | tee "$DIR/out.txt"
grep -q "ALL MIGRATION CHECKS PASSED" "$DIR/out.txt"

# Real concurrency: 8 simultaneous database sessions of the SAME user race for the same budget and the same lease.
# The advisory lock must let exactly floor(cap / units) reservations through and exactly one session win the lease.
run "$P -d postgres -c 'create database r'"
cat > "$DIR/race_setup.sql" <<'SQL'
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
\i 20261013120000_research_cache.sql
SQL
chmod 644 "$DIR/race_setup.sql"
run "cd $DIR && $P -d r -f race_setup.sql"
for i in 1 2 3 4 5 6 7 8; do
  run "$P -d r -At -c \"set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; select 'R:' || (public.research_reserve('race|$i', 102, 300, 600)->>'ok'); select 'L:' || public.research_lock('race-lease', 60); select 'S:' || (public.research_reserve('sr|$i', 1, 100000, 600, 2, 5)->>'ok')\"" >> "$DIR/race.txt" &
done
wait
RESERVED=$(grep -c '^R:true' "$DIR/race.txt" || true); LEASES=$(grep -c '^L:true' "$DIR/race.txt" || true)
SEARCHES=$(grep -c '^S:true' "$DIR/race.txt" || true)
echo "race (search limit, units to spare): accepted=$SEARCHES (expected 2 for 2 searches each under a limit of 5)"
echo "race: reservations accepted=$RESERVED (expected 2 for cap 300 / 102 units), leases won=$LEASES (expected 1)"
[ "$RESERVED" = "2" ] && [ "$LEASES" = "1" ] && [ "$SEARCHES" = "2" ]
echo "CONCURRENCY CHECK PASSED"
