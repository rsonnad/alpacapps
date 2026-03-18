#!/bin/bash
# backup-alpacapps-to-rvault.sh — Back up all AlpacApps services to RVAULT20.
#
# Backs up:
#   1. Supabase PostgreSQL (pg_dump → gzip)
#   2. Cloudflare R2 bucket (aws s3 sync)
#   3. Cloudflare D1 database (API export → SQL file)
#   4. GitHub repo (bare mirror)
#
# Runs on Alpaca Mac weekly via cron (Mondays 1:00 AM local).
#
# Prerequisites:
#   - pg_dump (brew install postgresql@17 or libpq)
#   - aws CLI (/usr/local/bin/aws)
#   - curl, jq
#   - RVAULT20 mounted at /Volumes/RVAULT20
#   - Environment in ~/.env-alpacapps
#
# Usage:
#   ./backup-alpacapps-to-rvault.sh              # full backup
#   ./backup-alpacapps-to-rvault.sh --dry-run    # show what would happen
#
# Cron (every Monday 1:00 AM local):
#   0 1 * * 1 /Users/alpaca/scripts/backup-alpacapps-to-rvault.sh >> /Users/alpaca/logs/alpacapps-backup.log 2>&1

set -euo pipefail

# ── config ───────────────────────────────────────────────────────────
BACKUP_ROOT="/Volumes/RVAULT20/backups/alpacapps"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
DATE=$(date -u +"%Y%m%d-%H%M%S")
START_TIME=$(date +%s)

# Load env
ENVFILE="$HOME/.env-alpacapps"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
else
  echo "$LOG_PREFIX ERROR: $ENVFILE not found" >&2
  exit 1
fi

# Supabase
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
SUPABASE_URL="${SUPABASE_URL:-https://aphrrfprbixmhissnjfn.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Cloudflare R2
R2_ACCESS="${R2_ACCESS_KEY_ID:-}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-}"
R2_ACCOUNT="${R2_ACCOUNT_ID:-}"
R2_ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"
R2_BUCKET="${R2_BUCKET_NAME:-alpacapps}"

# Cloudflare D1
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
D1_DATABASE_ID="${D1_DATABASE_ID:-98d0e680-8abe-4ce3-a941-70cb391adbf8}"

# GitHub
GH_REPO="https://github.com/rsonnad/alpacapps.git"

# Tools
AWS=/usr/local/bin/aws

# ── parse args ───────────────────────────────────────────────────────
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── validate ─────────────────────────────────────────────────────────
missing=""
[ -z "$SUPABASE_DB_URL" ] && missing="$missing SUPABASE_DB_URL"
[ -z "$R2_ACCESS" ]       && missing="$missing R2_ACCESS_KEY_ID"
[ -z "$R2_SECRET" ]       && missing="$missing R2_SECRET_ACCESS_KEY"
[ -z "$R2_ACCOUNT" ]      && missing="$missing R2_ACCOUNT_ID"
if [ -n "$missing" ]; then
  echo "$LOG_PREFIX ERROR: Missing env vars:$missing" >&2
  exit 1
fi

[ -x "$AWS" ] || { echo "$LOG_PREFIX ERROR: aws CLI not found at $AWS" >&2; exit 1; }

if [ ! -d "/Volumes/RVAULT20" ]; then
  echo "$LOG_PREFIX ERROR: RVAULT20 not mounted" >&2
  exit 1
fi

# ── dry run ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN ==="
  echo "Backup root: $BACKUP_ROOT"
  echo ""
  echo "1. Supabase DB → $BACKUP_ROOT/supabase/full-$DATE.sql.gz"
  echo "2. R2 sync:     s3://$R2_BUCKET/ → $BACKUP_ROOT/r2/$R2_BUCKET/"
  echo "3. D1 export:   claude-sessions → $BACKUP_ROOT/d1/claude-sessions-$DATE.sql"
  echo "4. GitHub:      $GH_REPO → $BACKUP_ROOT/github/alpacapps.git"
  exit 0
fi

echo "$LOG_PREFIX ═══════════════════════════════════════════════════"
echo "$LOG_PREFIX Starting AlpacApps backup to RVAULT20"
echo "$LOG_PREFIX ═══════════════════════════════════════════════════"

# Track per-service status
declare -A SERVICE_STATUS
declare -A SERVICE_DETAIL

# ── 1. Supabase Database ─────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [1/4] Supabase PostgreSQL dump..."

DB_DIR="$BACKUP_ROOT/supabase"
mkdir -p "$DB_DIR"
DUMP_FILE="$DB_DIR/full-${DATE}.sql.gz"

# Find pg_dump (prefer v17 for Supabase compatibility)
if [ -x /opt/homebrew/opt/postgresql@17/bin/pg_dump ]; then
  PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump
elif [ -x /opt/homebrew/opt/libpq/bin/pg_dump ]; then
  PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
elif command -v pg_dump >/dev/null 2>&1; then
  PG_DUMP=pg_dump
else
  echo "$LOG_PREFIX   WARNING: pg_dump not found — skipping DB backup"
  SERVICE_STATUS[supabase]="skipped"
  SERVICE_DETAIL[supabase]="pg_dump not found"
  PG_DUMP=""
fi

if [ -n "${PG_DUMP:-}" ]; then
  if $PG_DUMP "$SUPABASE_DB_URL" --no-owner --no-privileges --clean --if-exists --schema=public 2>/dev/null | gzip > "$DUMP_FILE"; then
    DB_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    echo "$LOG_PREFIX   Done: $DUMP_FILE ($DB_SIZE)"
    SERVICE_STATUS[supabase]="success"
    SERVICE_DETAIL[supabase]="$DB_SIZE"

    # Prune old dumps (keep last 12)
    DUMP_COUNT=$(ls -1 "$DB_DIR"/full-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
    if [ "$DUMP_COUNT" -gt 12 ]; then
      ls -1t "$DB_DIR"/full-*.sql.gz | tail -n +13 | while read -r old; do
        echo "$LOG_PREFIX   Pruning: $(basename "$old")"
        rm -f "$old"
      done
    fi
  else
    echo "$LOG_PREFIX   ERROR: pg_dump failed"
    SERVICE_STATUS[supabase]="error"
    SERVICE_DETAIL[supabase]="pg_dump failed"
    rm -f "$DUMP_FILE"
  fi
fi

# ── 2. Cloudflare R2 ─────────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [2/4] Cloudflare R2 sync ($R2_BUCKET)..."

R2_DIR="$BACKUP_ROOT/r2/$R2_BUCKET"
mkdir -p "$R2_DIR"

if AWS_ACCESS_KEY_ID="$R2_ACCESS" \
   AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
   $AWS s3 sync "s3://$R2_BUCKET/" "$R2_DIR/" \
     --endpoint-url "$R2_ENDPOINT" \
     --no-progress \
     --size-only 2>/dev/null; then
  R2_COUNT=$(find "$R2_DIR" -type f | wc -l | tr -d ' ')
  R2_SIZE=$(du -sh "$R2_DIR" 2>/dev/null | cut -f1)
  echo "$LOG_PREFIX   Done: $R2_COUNT files ($R2_SIZE)"
  SERVICE_STATUS[r2]="success"
  SERVICE_DETAIL[r2]="{\"files\":$R2_COUNT,\"size\":\"$R2_SIZE\"}"
else
  echo "$LOG_PREFIX   ERROR: R2 sync failed"
  SERVICE_STATUS[r2]="error"
  SERVICE_DETAIL[r2]="sync failed"
fi

# ── 3. Cloudflare D1 ─────────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [3/4] Cloudflare D1 export (claude-sessions)..."

D1_DIR="$BACKUP_ROOT/d1"
mkdir -p "$D1_DIR"
D1_FILE="$D1_DIR/claude-sessions-${DATE}.sql"

if [ -n "$CF_API_TOKEN" ]; then
  # Use Cloudflare API to export D1 database
  # Step 1: Initiate export
  EXPORT_RESP=$(curl -sf "https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT}/d1/database/${D1_DATABASE_ID}/export" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"output_format":"file","dump_options":{"no_schema":false,"no_data":false,"tables":[]}}' 2>/dev/null) || true

  if [ -n "$EXPORT_RESP" ]; then
    # Check for signed URL in response
    SIGNED_URL=$(echo "$EXPORT_RESP" | jq -r '.result.signed_url // empty' 2>/dev/null)

    if [ -n "$SIGNED_URL" ]; then
      # Download the export
      if curl -sf "$SIGNED_URL" -o "$D1_FILE" 2>/dev/null; then
        D1_SIZE=$(du -h "$D1_FILE" | cut -f1)
        echo "$LOG_PREFIX   Done: $D1_FILE ($D1_SIZE)"
        SERVICE_STATUS[d1]="success"
        SERVICE_DETAIL[d1]="$D1_SIZE"
      else
        echo "$LOG_PREFIX   ERROR: D1 download failed"
        SERVICE_STATUS[d1]="error"
        SERVICE_DETAIL[d1]="download failed"
        rm -f "$D1_FILE"
      fi
    else
      # Fallback: try polling for the export
      TASK_ID=$(echo "$EXPORT_RESP" | jq -r '.result.task_id // .result.filename // empty' 2>/dev/null)
      if [ -n "$TASK_ID" ]; then
        echo "$LOG_PREFIX   Export initiated (task: $TASK_ID), polling..."
        sleep 5
        # Poll for completion
        for i in $(seq 1 12); do
          POLL_RESP=$(curl -sf "https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT}/d1/database/${D1_DATABASE_ID}/export" \
            -H "Authorization: Bearer $CF_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"current_bookmark\":\"$TASK_ID\"}" 2>/dev/null) || true

          POLL_URL=$(echo "$POLL_RESP" | jq -r '.result.signed_url // empty' 2>/dev/null)
          POLL_STATUS=$(echo "$POLL_RESP" | jq -r '.result.status // empty' 2>/dev/null)

          if [ -n "$POLL_URL" ]; then
            curl -sf "$POLL_URL" -o "$D1_FILE" 2>/dev/null
            D1_SIZE=$(du -h "$D1_FILE" | cut -f1)
            echo "$LOG_PREFIX   Done: $D1_FILE ($D1_SIZE)"
            SERVICE_STATUS[d1]="success"
            SERVICE_DETAIL[d1]="$D1_SIZE"
            break
          elif [ "$POLL_STATUS" = "error" ]; then
            echo "$LOG_PREFIX   ERROR: D1 export failed"
            SERVICE_STATUS[d1]="error"
            SERVICE_DETAIL[d1]="export failed"
            break
          fi
          sleep 5
        done
        [ -z "${SERVICE_STATUS[d1]:-}" ] && { SERVICE_STATUS[d1]="error"; SERVICE_DETAIL[d1]="export timed out"; }
      else
        # Maybe the response itself contains SQL data inline
        echo "$LOG_PREFIX   WARNING: Unexpected D1 API response — saving raw"
        echo "$EXPORT_RESP" > "$D1_FILE"
        SERVICE_STATUS[d1]="warning"
        SERVICE_DETAIL[d1]="raw response saved"
      fi
    fi
  else
    echo "$LOG_PREFIX   ERROR: D1 API call failed"
    SERVICE_STATUS[d1]="error"
    SERVICE_DETAIL[d1]="API call failed"
  fi

  # Prune old D1 exports (keep last 12)
  D1_COUNT=$(ls -1 "$D1_DIR"/claude-sessions-*.sql 2>/dev/null | wc -l | tr -d ' ')
  if [ "$D1_COUNT" -gt 12 ]; then
    ls -1t "$D1_DIR"/claude-sessions-*.sql | tail -n +13 | while read -r old; do
      echo "$LOG_PREFIX   Pruning: $(basename "$old")"
      rm -f "$old"
    done
  fi
else
  echo "$LOG_PREFIX   WARNING: CLOUDFLARE_API_TOKEN not set — skipping D1 backup"
  SERVICE_STATUS[d1]="skipped"
  SERVICE_DETAIL[d1]="no API token"
fi

# ── 4. GitHub Repo ───────────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [4/4] GitHub repo mirror..."

GH_DIR="$BACKUP_ROOT/github/alpacapps.git"

if command -v git >/dev/null 2>&1; then
  if [ -d "$GH_DIR" ]; then
    # Update existing mirror
    if git -C "$GH_DIR" remote update 2>/dev/null; then
      BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
      COMMIT_COUNT=$(git -C "$GH_DIR" rev-list --all --count 2>/dev/null || echo "?")
      echo "$LOG_PREFIX   Updated mirror: $BRANCH_COUNT branches, $COMMIT_COUNT commits"
      SERVICE_STATUS[github]="success"
      SERVICE_DETAIL[github]="{\"branches\":$BRANCH_COUNT,\"commits\":$COMMIT_COUNT}"
    else
      echo "$LOG_PREFIX   ERROR: git remote update failed"
      SERVICE_STATUS[github]="error"
      SERVICE_DETAIL[github]="remote update failed"
    fi
  else
    # Initial bare clone
    mkdir -p "$(dirname "$GH_DIR")"
    if git clone --bare "$GH_REPO" "$GH_DIR" 2>/dev/null; then
      BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
      echo "$LOG_PREFIX   Cloned mirror: $BRANCH_COUNT branches"
      SERVICE_STATUS[github]="success"
      SERVICE_DETAIL[github]="{\"branches\":$BRANCH_COUNT,\"initial_clone\":true}"
    else
      echo "$LOG_PREFIX   ERROR: git clone failed"
      SERVICE_STATUS[github]="error"
      SERVICE_DETAIL[github]="clone failed"
    fi
  fi
else
  echo "$LOG_PREFIX   WARNING: git not found — skipping"
  SERVICE_STATUS[github]="skipped"
  SERVICE_DETAIL[github]="git not found"
fi

# ── summary ──────────────────────────────────────────────────────────
echo ""
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)

# Determine overall status
OVERALL="success"
for svc in supabase r2 d1 github; do
  if [ "${SERVICE_STATUS[$svc]:-}" = "error" ]; then
    OVERALL="error"
    break
  fi
done

echo "$LOG_PREFIX ═══════════════════════════════════════════════════"
echo "$LOG_PREFIX Backup complete in ${DURATION}s"
echo "$LOG_PREFIX Total size: $TOTAL_SIZE"
echo "$LOG_PREFIX Services: supabase=${SERVICE_STATUS[supabase]:-?} r2=${SERVICE_STATUS[r2]:-?} d1=${SERVICE_STATUS[d1]:-?} github=${SERVICE_STATUS[github]:-?}"
echo "$LOG_PREFIX ═══════════════════════════════════════════════════"

# ── log to Supabase ──────────────────────────────────────────────────
if [ -n "$SUPABASE_KEY" ]; then
  DETAILS_JSON=$(cat <<ENDJSON
{
  "total_size": "$TOTAL_SIZE",
  "supabase": {"status":"${SERVICE_STATUS[supabase]:-skipped}","detail":"${SERVICE_DETAIL[supabase]:-}"},
  "r2": {"status":"${SERVICE_STATUS[r2]:-skipped}","detail":${SERVICE_DETAIL[r2]:-"\"skipped\""}},
  "d1": {"status":"${SERVICE_STATUS[d1]:-skipped}","detail":"${SERVICE_DETAIL[d1]:-}"},
  "github": {"status":"${SERVICE_STATUS[github]:-skipped}","detail":${SERVICE_DETAIL[github]:-"\"skipped\""}}
}
ENDJSON
)
  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"full-to-rvault\",\"status\":\"$OVERALL\",\"duration_seconds\":$DURATION,\"details\":$DETAILS_JSON}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log backup to Supabase"
fi
