#!/usr/bin/env bash
# Pull a copy of the VPS backups to your own machine.
#
# Run this on your laptop, NOT on the VPS. It is the no-R2 / no-card path:
# the VPS keeps nightly dumps, and this copies them somewhere that survives
# losing the VPS.
#
#   ./deploy/pull-backup.sh
#   VPS=deploy@1.2.3.4 DEST=~/omoiyari-backups ./deploy/pull-backup.sh
#   ./deploy/pull-backup.sh --dry-run
#   ./deploy/pull-backup.sh --no-media
#
# Environment:
#   VPS         ssh target                       (default: deploy@your-vps)
#   REMOTE_DIR  app directory on the VPS         (default: /srv/omoiyari-pos)
#   DEST        local destination                (default: ~/omoiyari-backups)
#   KEEP_DAYS   local dump retention in days     (default: 30)
#   SSH_PORT    ssh port                         (default: 22)
#
# Nothing is deleted on the remote side, and `--delete` is never used: a
# missing file on the VPS must not erase the copy on your machine.

set -euo pipefail

VPS="${VPS:-deploy@your-vps}"
REMOTE_DIR="${REMOTE_DIR:-/srv/omoiyari-pos}"
DEST="${DEST:-$HOME/omoiyari-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
SSH_PORT="${SSH_PORT:-22}"

DRY_RUN=0
WITH_MEDIA=1

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-media) WITH_MEDIA=0 ;;
    -h | --help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ -n "$VPS" ]] || die "VPS is empty"
[[ -n "$DEST" ]] || die "DEST is empty"
case "$DEST" in
  / | "$HOME") die "refusing to write into '$DEST'; set DEST to a dedicated folder" ;;
esac

mkdir -p "$DEST/db"
if [[ "$WITH_MEDIA" == "1" ]]; then
  mkdir -p "$DEST/media"
fi

RSYNC=(rsync -avz --human-readable -e "ssh -p $SSH_PORT")
if [[ "$DRY_RUN" == "1" ]]; then
  RSYNC+=(--dry-run)
  log "dry run: nothing will be written"
fi

log "pulling database dumps from $VPS:$REMOTE_DIR/backups/db"
"${RSYNC[@]}" "$VPS:$REMOTE_DIR/backups/db/" "$DEST/db/"

if [[ "$WITH_MEDIA" == "1" ]]; then
  log "pulling recipe images from $VPS:$REMOTE_DIR/media"
  "${RSYNC[@]}" "$VPS:$REMOTE_DIR/media/" "$DEST/media/"
fi

# Prove the newest dump is readable when a local pg_restore exists. The laptop
# may not have Postgres installed; that is fine, the size is still printed.
latest="$(ls -t "$DEST"/db/*.dump 2>/dev/null | head -1 || true)"
if [[ -n "$latest" ]]; then
  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$latest" >/dev/null || die "newest dump is unreadable: $latest"
    log "verified $latest ($(du -h "$latest" | cut -f1))"
  else
    log "newest dump: $latest ($(du -h "$latest" | cut -f1)); pg_restore not installed, skipped check"
  fi
else
  log "WARNING: no .dump file found on the VPS — has the backup timer run?"
fi

if [[ "$DRY_RUN" != "1" ]]; then
  find "$DEST/db" -type f \( -name '*.dump' -o -name '*.sql' \) -mtime "+$KEEP_DAYS" -exec rm -f {} +
  log "kept dumps newer than $KEEP_DAYS days in $DEST/db"
fi

log "done: $DEST"
