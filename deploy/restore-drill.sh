#!/usr/bin/env bash
# Restore the newest backup into a throwaway database and prove it is usable.
#
#   sudo deploy/restore-drill.sh                 # newest local dump
#   sudo deploy/restore-drill.sh /path/to.dump   # a specific dump
#   KEEP=1 sudo deploy/restore-drill.sh          # leave the test DB behind
#
# This never touches the production database: the target name must end in
# `_restore_test`, and the script refuses anything else.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/omoiyari-pos}"
BACKUP_DIR="${BACKUP_DIR:-/srv/omoiyari-pos/backups}"
TARGET="${TARGET:-omoiyari_restore_test}"
DUMP="${1:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ "$TARGET" == *_restore_test ]] || die "TARGET must end in _restore_test (got '$TARGET')"

if [[ -z "$DUMP" ]]; then
  DUMP="$(find "$BACKUP_DIR/db" -name '*.dump' -type f -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
fi
[[ -f "$DUMP" ]] || die "dump not found: '$DUMP'"

cd "$APP_DIR/deploy"
compose() { docker compose "$@"; }
psql_admin() { compose exec -T db psql -U "${POSTGRES_USER:-omoiyari}" -d postgres -v ON_ERROR_STOP=1 "$@"; }

log "restoring $DUMP into $TARGET"
psql_admin -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)"
psql_admin -c "CREATE DATABASE \"$TARGET\" TEMPLATE template0 ENCODING 'UTF8'"

compose exec -T db pg_restore \
  -U "${POSTGRES_USER:-omoiyari}" -d "$TARGET" \
  --no-owner --no-privileges --exit-on-error < "$DUMP"

log "checking restored schema and data"
compose exec -T db psql -U "${POSTGRES_USER:-omoiyari}" -d "$TARGET" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['users','branches','recipes','ingredients','inventory','orders','stock_ledger']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = t
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'restored database is missing tables: %', missing;
  END IF;
END $$;

SELECT 'users' AS table, count(*) FROM users
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'stock_ledger', count(*) FROM stock_ledger
UNION ALL SELECT 'recipes', count(*) FROM recipes
UNION ALL SELECT 'inventory', count(*) FROM inventory
ORDER BY 1;
SQL

log "checking Drizzle migration history"
compose exec -T db psql -U "${POSTGRES_USER:-omoiyari}" -d "$TARGET" -Atc \
  "select count(*) from drizzle.__drizzle_migrations" \
  | grep -qE '^[1-9][0-9]*$' || die "drizzle history is empty"

if [[ "${KEEP:-0}" != "1" ]]; then
  psql_admin -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"
  log "drill passed; dropped $TARGET"
else
  log "drill passed; kept $TARGET"
fi
