#!/usr/bin/env bash
# Applies every migration to a fresh local Postgres (with Supabase stand-ins)
# and runs the SQL test suite against the result.
#
# Usage:  PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
#
# Two passes, because both starting points are real:
#   upgrade — the live project: migrations 0001-0006, then today's data,
#             then everything after. Proves existing rooms survive.
#   fresh   — a new self-hosted deployment: every migration on an empty
#             database. Proves a clean install needs no legacy data.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../migrations"
db=anya_test

psql_q() { psql -v ON_ERROR_STOP=1 -q -X -o /dev/null "$@" 2> >(grep -vE "wal_level|already exists, skipping|does not exist, skipping|drop cascades|^DETAIL|^HINT" | sed -E "s/^psql:[^ ]+ NOTICE:  //" >&2); }

fresh_db() {
  psql_q -d postgres -c "drop database if exists $db" -c "create database $db"
  psql_q -d "$db" -c "create extension if not exists pgcrypto"
  psql_q -d "$db" -f "$here/supabase_stubs.sql"
}

apply() { # apply migrations whose number is in [from, to]
  local from=$1 to=$2
  for file in "$migrations"/*.sql; do
    local n
    n=$(basename "$file" | cut -c1-4)
    if ((10#$n >= from && 10#$n <= to)); then
      psql_q -d "$db" -f "$file"
    fi
  done
}

last=$(basename "$(ls "$migrations"/*.sql | tail -1)" | cut -c1-4)

echo "== upgrade path (live project) =="
fresh_db
apply 1 6
psql_q -d "$db" -f "$here/seed_legacy.sql"
apply 7 "$last"
psql_q -d "$db" -f "$here/tests_upgrade.sql"
psql_q -d "$db" -f "$here/tests_isolation.sql"

echo "== fresh path (new self-hosted deployment) =="
fresh_db
apply 1 "$last"
psql_q -d "$db" -f "$here/tests_fresh.sql"
psql_q -d "$db" -f "$here/tests_isolation.sql"

echo "ALL TESTS PASSED"
