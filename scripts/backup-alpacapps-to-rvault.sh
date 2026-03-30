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

set -uo pipefail

# Ensure PATH includes Homebrew (cron has minimal PATH)
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

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
while [ $# -gt 0 ]; do
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

echo "$LOG_PREFIX ======================================================="
echo "$LOG_PREFIX Starting AlpacApps backup to RVAULT20"
echo "$LOG_PREFIX ======================================================="

# Track per-service status (bash 3.x compatible — no associative arrays)
SVC_SUPABASE_STATUS="pending"
SVC_SUPABASE_DETAIL=""
SVC_R2_STATUS="pending"
SVC_R2_DETAIL=""
SVC_R2_DETAIL_JSON=""
SVC_D1_STATUS="pending"
SVC_D1_DETAIL=""
SVC_GITHUB_STATUS="pending"
SVC_GITHUB_DETAIL=""
SVC_GITHUB_DETAIL_JSON=""

# ── 1. Supabase Database ─────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [1/4] Supabase PostgreSQL dump..."

DB_DIR="$BACKUP_ROOT/supabase"
mkdir -p "$DB_DIR"
DUMP_FILE="$DB_DIR/full-${DATE}.sql.gz"

# Find pg_dump (prefer v17 for Supabase compatibility)
PG_DUMP=""
if [ -x /usr/local/opt/libpq/bin/pg_dump ]; then
  PG_DUMP=/usr/local/opt/libpq/bin/pg_dump
elif [ -x /opt/homebrew/opt/postgresql@17/bin/pg_dump ]; then
  PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump
elif [ -x /opt/homebrew/opt/libpq/bin/pg_dump ]; then
  PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
elif command -v pg_dump >/dev/null 2>&1; then
  PG_DUMP=pg_dump
else
  echo "$LOG_PREFIX   WARNING: pg_dump not found — skipping DB backup"
  SVC_SUPABASE_STATUS="skipped"
  SVC_SUPABASE_DETAIL="pg_dump not found"
fi

if [ -n "$PG_DUMP" ]; then
  if $PG_DUMP "$SUPABASE_DB_URL" --no-owner --no-privileges --clean --if-exists --schema=public 2>/dev/null | gzip > "$DUMP_FILE"; then
    DB_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    echo "$LOG_PREFIX   Done: $DUMP_FILE ($DB_SIZE)"
    SVC_SUPABASE_STATUS="success"
    SVC_SUPABASE_DETAIL="$DB_SIZE"

    # Log to backup_files so it appears in DevControl Backups table
    DB_SIZE_BYTES=$(stat -f%z "$DUMP_FILE" 2>/dev/null || echo 0)
    curl -sf "$SUPABASE_URL/rest/v1/backup_files" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: resolution=merge-duplicates" \
      -d "{\"service\":\"supabase-db\",\"backup_date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"filename\":\"$(basename "$DUMP_FILE")\",\"filepath\":\"$DUMP_FILE\",\"size_bytes\":$DB_SIZE_BYTES}" \
      >/dev/null 2>&1 && echo "$LOG_PREFIX   Logged to backup_files" || echo "$LOG_PREFIX   WARN: failed to log to backup_files"

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
    SVC_SUPABASE_STATUS="error"
    SVC_SUPABASE_DETAIL="pg_dump failed"
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
  SVC_R2_STATUS="success"
  SVC_R2_DETAIL="$R2_COUNT files ($R2_SIZE)"
  SVC_R2_DETAIL_JSON="{\"files\":$R2_COUNT,\"size\":\"$R2_SIZE\"}"
else
  echo "$LOG_PREFIX   ERROR: R2 sync failed"
  SVC_R2_STATUS="error"
  SVC_R2_DETAIL="sync failed"
  SVC_R2_DETAIL_JSON="\"sync failed\""
fi

# ── 3. Cloudflare D1 ─────────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [3/4] Cloudflare D1 export (claude-sessions)..."

D1_DIR="$BACKUP_ROOT/d1"
mkdir -p "$D1_DIR"
D1_FILE="$D1_DIR/claude-sessions-${DATE}.sql"

if [ -n "$CF_API_TOKEN" ]; then
  # Use Cloudflare API to export D1 database
  EXPORT_RESP=$(curl -sf "https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT}/d1/database/${D1_DATABASE_ID}/export" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"output_format":"file","dump_options":{"no_schema":false,"no_data":false,"tables":[]}}' 2>/dev/null) || true

  if [ -n "$EXPORT_RESP" ]; then
    SIGNED_URL=$(echo "$EXPORT_RESP" | jq -r '.result.signed_url // empty' 2>/dev/null)

    if [ -n "$SIGNED_URL" ]; then
      if curl -sf "$SIGNED_URL" -o "$D1_FILE" 2>/dev/null; then
        D1_SIZE=$(du -h "$D1_FILE" | cut -f1)
        echo "$LOG_PREFIX   Done: $D1_FILE ($D1_SIZE)"
        SVC_D1_STATUS="success"
        SVC_D1_DETAIL="$D1_SIZE"
      else
        echo "$LOG_PREFIX   ERROR: D1 download failed"
        SVC_D1_STATUS="error"
        SVC_D1_DETAIL="download failed"
        rm -f "$D1_FILE"
      fi
    else
      # Fallback: try polling for the export
      TASK_ID=$(echo "$EXPORT_RESP" | jq -r '.result.task_id // .result.filename // empty' 2>/dev/null)
      if [ -n "$TASK_ID" ]; then
        echo "$LOG_PREFIX   Export initiated (task: $TASK_ID), polling..."
        sleep 5
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
            SVC_D1_STATUS="success"
            SVC_D1_DETAIL="$D1_SIZE"
            break
          elif [ "$POLL_STATUS" = "error" ]; then
            echo "$LOG_PREFIX   ERROR: D1 export failed"
            SVC_D1_STATUS="error"
            SVC_D1_DETAIL="export failed"
            break
          fi
          sleep 5
        done
        if [ "$SVC_D1_STATUS" = "pending" ]; then
          SVC_D1_STATUS="error"
          SVC_D1_DETAIL="export timed out"
        fi
      else
        echo "$LOG_PREFIX   WARNING: Unexpected D1 API response — saving raw"
        echo "$EXPORT_RESP" > "$D1_FILE"
        SVC_D1_STATUS="warning"
        SVC_D1_DETAIL="raw response saved"
      fi
    fi
  else
    echo "$LOG_PREFIX   ERROR: D1 API call failed"
    SVC_D1_STATUS="error"
    SVC_D1_DETAIL="API call failed"
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
  SVC_D1_STATUS="skipped"
  SVC_D1_DETAIL="no API token"
fi

# ── 4. GitHub Repo ───────────────────────────────────────────────────
echo ""
echo "$LOG_PREFIX [4/4] GitHub repo mirror..."

GH_DIR="$BACKUP_ROOT/github/alpacapps.git"

if command -v git >/dev/null 2>&1; then
  if [ -d "$GH_DIR" ]; then
    if git -C "$GH_DIR" remote update 2>/dev/null; then
      BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
      COMMIT_COUNT=$(git -C "$GH_DIR" rev-list --all --count 2>/dev/null || echo "0")
      echo "$LOG_PREFIX   Updated mirror: $BRANCH_COUNT branches, $COMMIT_COUNT commits"
      SVC_GITHUB_STATUS="success"
      SVC_GITHUB_DETAIL="$BRANCH_COUNT branches, $COMMIT_COUNT commits"
      SVC_GITHUB_DETAIL_JSON="{\"branches\":$BRANCH_COUNT,\"commits\":$COMMIT_COUNT}"
    else
      echo "$LOG_PREFIX   ERROR: git remote update failed"
      SVC_GITHUB_STATUS="error"
      SVC_GITHUB_DETAIL="remote update failed"
      SVC_GITHUB_DETAIL_JSON="\"remote update failed\""
    fi
  else
    mkdir -p "$(dirname "$GH_DIR")"
    if git clone --bare "$GH_REPO" "$GH_DIR" 2>/dev/null; then
      BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
      echo "$LOG_PREFIX   Cloned mirror: $BRANCH_COUNT branches"
      SVC_GITHUB_STATUS="success"
      SVC_GITHUB_DETAIL="$BRANCH_COUNT branches (initial clone)"
      SVC_GITHUB_DETAIL_JSON="{\"branches\":$BRANCH_COUNT,\"initial_clone\":true}"
    else
      echo "$LOG_PREFIX   ERROR: git clone failed"
      SVC_GITHUB_STATUS="error"
      SVC_GITHUB_DETAIL="clone failed"
      SVC_GITHUB_DETAIL_JSON="\"clone failed\""
    fi
  fi
else
  echo "$LOG_PREFIX   WARNING: git not found — skipping"
  SVC_GITHUB_STATUS="skipped"
  SVC_GITHUB_DETAIL="git not found"
  SVC_GITHUB_DETAIL_JSON="\"git not found\""
fi

# ── summary ──────────────────────────────────────────────────────────
echo ""
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)

# Determine overall status
OVERALL="success"
for s in "$SVC_SUPABASE_STATUS" "$SVC_R2_STATUS" "$SVC_D1_STATUS" "$SVC_GITHUB_STATUS"; do
  if [ "$s" = "error" ]; then
    OVERALL="error"
    break
  fi
done

echo "$LOG_PREFIX ======================================================="
echo "$LOG_PREFIX Backup complete in ${DURATION}s"
echo "$LOG_PREFIX Total size: $TOTAL_SIZE"
echo "$LOG_PREFIX Services: supabase=$SVC_SUPABASE_STATUS r2=$SVC_R2_STATUS d1=$SVC_D1_STATUS github=$SVC_GITHUB_STATUS"
echo "$LOG_PREFIX ======================================================="

# ── log to Supabase ──────────────────────────────────────────────────
if [ -n "$SUPABASE_KEY" ]; then
  DETAILS_JSON="{\"total_size\":\"$TOTAL_SIZE\",\"supabase\":{\"status\":\"$SVC_SUPABASE_STATUS\",\"detail\":\"$SVC_SUPABASE_DETAIL\"},\"r2\":{\"status\":\"$SVC_R2_STATUS\",\"detail\":${SVC_R2_DETAIL_JSON:-"\"$SVC_R2_DETAIL\""}},\"d1\":{\"status\":\"$SVC_D1_STATUS\",\"detail\":\"$SVC_D1_DETAIL\"},\"github\":{\"status\":\"$SVC_GITHUB_STATUS\",\"detail\":${SVC_GITHUB_DETAIL_JSON:-"\"$SVC_GITHUB_DETAIL\""}}}"

  curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"alpaca-mac\",\"backup_type\":\"full-to-rvault\",\"status\":\"$OVERALL\",\"duration_seconds\":$DURATION,\"details\":$DETAILS_JSON}" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX Warning: failed to log backup to Supabase"

  # Clear any pending manual triggers — the weekly run satisfies them
  for svc in supabase-db cloudflare-r2 cloudflare-d1 github-repo; do
    curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?status=eq.pending&service=eq.$svc" \
      -X PATCH \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"completed\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"result\":{\"satisfied_by\":\"weekly-run\"}}" \
      >/dev/null 2>&1
  done
fi
