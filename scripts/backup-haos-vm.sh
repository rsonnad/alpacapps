#!/bin/bash
# backup-haos-vm.sh — Copy the HAOS VM disk image to RVAULT20 and log to Supabase.
#
# Copies haos_generic-aarch64.img → /Volumes/RVAULT20/backups/haos/haos_YYYY-MM-DD.img
# Keeps 7-day rolling retention. Logs each backup to backup_files table.
#
# Runs on Alpuca (192.168.1.200) daily via cron at 3:17 AM CT:
#   17 3 * * * /Users/alpuca/scripts/backup-haos-vm.sh >> /Users/alpuca/logs/haos-vm-backup.log 2>&1
#
# Prerequisites:
#   - RVAULT20 mounted at /Volumes/RVAULT20
#   - HAOS VM image at ~/homeassistant-vm/haos_generic-aarch64.img
#   - Environment in ~/.env-alpacapps (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

set -uo pipefail

# ── config ───────────────────────────────────────────────────────────
SOURCE="$HOME/homeassistant-vm/haos_generic-aarch64.img"
BACKUP_DIR="/Volumes/RVAULT20/backups/haos"
DATE=$(date +"%Y-%m-%d")
DEST="$BACKUP_DIR/haos_${DATE}.img"
RETENTION_DAYS=7
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
SERVICE="haos-vm-image"

# Load env for Supabase creds
ENVFILE="$HOME/.env-alpacapps"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi
SUPABASE_URL="${SUPABASE_URL:-https://aphrrfprbixmhissnjfn.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# ── preflight checks ────────────────────────────────────────────────
if [ ! -f "$SOURCE" ]; then
  echo "$LOG_PREFIX ERROR: Source image not found: $SOURCE" >&2
  exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "$LOG_PREFIX Creating backup directory: $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
fi

if [ ! -d "/Volumes/RVAULT20" ]; then
  echo "$LOG_PREFIX ERROR: RVAULT20 not mounted" >&2
  exit 1
fi

# ── copy image ───────────────────────────────────────────────────────
echo "$LOG_PREFIX Starting HAOS VM backup: $SOURCE → $DEST"
START_TIME=$(date +%s)

if cp "$SOURCE" "$DEST"; then
  END_TIME=$(date +%s)
  DURATION=$(( END_TIME - START_TIME ))
  SIZE_BYTES=$(stat -f%z "$DEST" 2>/dev/null || stat --format=%s "$DEST" 2>/dev/null || echo 0)
  FILENAME="haos_${DATE}.img"
  echo "$LOG_PREFIX Backup complete: $FILENAME ($(( SIZE_BYTES / 1073741824 )) GB) in ${DURATION}s"
else
  echo "$LOG_PREFIX ERROR: cp failed" >&2
  exit 1
fi

# ── retention: delete files older than 7 days ────────────────────────
echo "$LOG_PREFIX Enforcing ${RETENTION_DAYS}-day retention..."
find "$BACKUP_DIR" -name "haos_*.img" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null

# ── log to Supabase backup_files table ───────────────────────────────
if [ -n "$SUPABASE_KEY" ]; then
  echo "$LOG_PREFIX Logging to Supabase..."
  curl -sf "$SUPABASE_URL/rest/v1/backup_files" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"service\":\"${SERVICE}\",\"backup_date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"filename\":\"${FILENAME}\",\"filepath\":\"${DEST}\",\"size_bytes\":${SIZE_BYTES}}" \
    >/dev/null 2>&1 \
    && echo "$LOG_PREFIX Logged to backup_files" \
    || echo "$LOG_PREFIX Warning: failed to log to Supabase"
else
  echo "$LOG_PREFIX Warning: SUPABASE_SERVICE_ROLE_KEY not set, skipping DB log"
fi

echo "$LOG_PREFIX Done."
