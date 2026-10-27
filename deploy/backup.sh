#!/usr/bin/env bash
# Nightly database + media backup for the Omoiyari POS VPS.
#
# Writes a custom-format pg_dump and a globals-only dump, then copies both and
# the recipe-image directory off-site with restic. `flock` makes overlapping
# runs impossible; a failed pg_dump aborts before restic runs.
#
# Install:
#   sudo install -m 0755 deploy/backup.sh /usr/local/bin/omoiyari-backup
#   sudo install -m 0644 deploy/systemd/omoiyari-backup.* /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now omoiyari-backup.timer
#
# Configuration lives in /etc/omoiyari-backup.env (see backup.env.example).
# The script is safe to run by hand: `sudo omoiyari-backup`.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/omoiyari-pos}"
BACKUP_DIR="${BACKUP_DIR:-/srv/omoiyari-pos/backups}"
MEDIA_DIR="${MEDIA_DIR:-/srv/omoiyari-pos/media}"
ENV_FILE="${ENV_FILE:-/etc/omoiyari-backup.env}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_DIR="$BACKUP_DIR/db"
DUMP="$DB_DIR/omoiyari-$STAMP.dump"
GLOBALS="$DB_DIR/globals-$STAMP.sql"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

mkdir -p "$DB_DIR"

# One run at a time. The lock is held on the script's own file descriptor, so
# it is released when the process exits, even on failure.
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || die "another backup is already running"

cd "$APP_DIR/deploy"

compose() { docker compose "$@"; }

compose exec -T db pg_isready -U "${POSTGRES_USER:-omoiyari}" -d "${POSTGRES_DB:-omoiyari}" >/dev/null \
  || die "database is not ready"

log "dumping database to $DUMP"
compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-omoiyari}" \
  -d "${POSTGRES_DB:-omoiyari}" \
  --format=custom --compress=9 --no-owner --no-privileges \
  > "$DUMP.partial"
mv "$DUMP.partial" "$DUMP"

# A truncated dump is worse than no dump: fail loudly if it cannot be read.
pg_restore --list "$DUMP" >/dev/null 2>&1 \
  || docker run --rm -i postgres:17 pg_restore --list < "$DUMP" >/dev/null \
  || die "dump $DUMP is not readable"

log "dumping roles/globals to $GLOBALS"
compose exec -T db pg_dumpall \
  -U "${POSTGRES_USER:-omoiyari}" --globals-only \
  > "$GLOBALS.partial"
mv "$GLOBALS.partial" "$GLOBALS"

if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  command -v restic >/dev/null || die "restic is not installed"
  log "uploading to $RESTIC_REPOSITORY"
  restic backup --tag omoiyari --host omoiyari-pos \
    "$DUMP" "$GLOBALS" "$MEDIA_DIR"
  # Keep 14 daily, 8 weekly, 12 monthly snapshots. `--prune` reclaims space.
  restic forget --tag omoiyari \
    --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
else
  log "RESTIC_REPOSITORY is unset — keeping a local-only backup"
fi

# Local copies are the fast restore path; off-site is the disaster path.
find "$DB_DIR" -type f \( -name '*.dump' -o -name '*.sql' \) -mtime "+$KEEP_LOCAL_DAYS" -delete

log "backup complete: $(du -h "$DUMP" | cut -f1) database, $(du -sh "$MEDIA_DIR" 2>/dev/null | cut -f1 || echo 'no media') media"
