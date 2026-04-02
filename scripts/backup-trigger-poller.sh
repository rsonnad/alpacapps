#!/bin/bash
# backup-trigger-poller.sh — Check for pending manual backup triggers and execute them.
#
# Polls the backup_triggers table for status='pending' rows, then runs
# the relevant backup section from the main backup script.
#
# Designed to run every 5 minutes via cron on Almaca:
#   */5 * * * * /Users/alpaca/scripts/backup-trigger-poller.sh >> /Users/alpaca/logs/backup-trigger-poller.log 2>&1
#
# Prerequisites: same as backup-alpacapps-to-rvault.sh (env in ~/.env-alpacapps)

set -uo pipefail

# Ensure PATH includes Homebrew (cron has minimal PATH)
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [trigger-poller]"

# Load env
ENVFILE="$HOME/.env-alpacapps"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
else
  echo "$LOG_PREFIX ERROR: $ENVFILE not found" >&2
  exit 1
fi

SUPABASE_URL="${SUPABASE_URL:-https://aphrrfprbixmhissnjfn.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
BACKUP_ROOT="/Volumes/RVAULT20/backups/alpacapps"
DATE=$(date -u +"%Y%m%d-%H%M%S")

if [ -z "$SUPABASE_KEY" ]; then
  echo "$LOG_PREFIX ERROR: SUPABASE_SERVICE_ROLE_KEY not set" >&2
  exit 1
fi

# R2 config
R2_ACCESS="${R2_ACCESS_KEY_ID:-}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-}"
R2_ACCOUNT="${R2_ACCOUNT_ID:-}"
R2_ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"
R2_BUCKET="${R2_BUCKET_NAME:-alpacapps}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
D1_DATABASE_ID="${D1_DATABASE_ID:-98d0e680-8abe-4ce3-a941-70cb391adbf8}"
AWS=$(command -v aws 2>/dev/null || echo /opt/homebrew/bin/aws)
GH_REPO="https://github.com/rsonnad/alpacapps.git"

# ── Auto-fail stale triggers (stuck running >30 min) ────────────────
STALE_CUTOFF=$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
STALE=$(curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?status=eq.running&requested_at=lt.$STALE_CUTOFF&select=id" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" 2>/dev/null)

if [ -n "$STALE" ] && [ "$STALE" != "[]" ]; then
  echo "$STALE" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    print(t['id'])
" | while read -r stale_id; do
    curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?id=eq.$stale_id" \
      -X PATCH \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"failed\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"notes\":\"Auto-failed: stuck running >30min\"}" \
      >/dev/null 2>&1
    echo "$LOG_PREFIX Auto-failed stale trigger $stale_id"
  done
fi

# ── Check for pending triggers ────────────────────────────────────────
PENDING=$(curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?status=eq.pending&order=requested_at.asc" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" 2>/dev/null)

if [ -z "$PENDING" ] || [ "$PENDING" = "[]" ]; then
  # No pending triggers — exit quietly
  exit 0
fi

echo "$LOG_PREFIX Found pending triggers"

# Check RVAULT20 is mounted
if [ ! -d "/Volumes/RVAULT20" ]; then
  echo "$LOG_PREFIX ERROR: RVAULT20 not mounted — cannot execute backups" >&2
  # Mark all pending as failed
  echo "$PENDING" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    print(t['id'])
" | while read -r tid; do
    curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?id=eq.$tid" \
      -X PATCH \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"failed\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"result\":{\"error\":\"RVAULT20 not mounted\"}}" \
      >/dev/null 2>&1
  done
  exit 1
fi

# ── Process each trigger ──────────────────────────────────────────────
echo "$PENDING" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    print(f\"{t['id']}|{t['service']}\")
" | while IFS='|' read -r TRIGGER_ID SERVICE; do

  echo "$LOG_PREFIX Processing trigger $TRIGGER_ID: $SERVICE"

  # Mark as running
  curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?id=eq.$TRIGGER_ID" \
    -X PATCH \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"running\",\"started_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    >/dev/null 2>&1

  RESULT_STATUS="completed"
  RESULT_JSON="{}"
  SVC_START=$(date +%s)

  case "$SERVICE" in

    supabase-db)
      echo "$LOG_PREFIX   Running Supabase pg_dump..."
      DB_DIR="$BACKUP_ROOT/supabase"
      mkdir -p "$DB_DIR"
      DUMP_FILE="$DB_DIR/full-${DATE}.sql.gz"

      PG_DUMP=""
      if [ -x /usr/local/opt/libpq/bin/pg_dump ]; then
        PG_DUMP=/usr/local/opt/libpq/bin/pg_dump
      elif [ -x /opt/homebrew/opt/postgresql@17/bin/pg_dump ]; then
        PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump
      elif [ -x /opt/homebrew/opt/libpq/bin/pg_dump ]; then
        PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
      elif command -v pg_dump >/dev/null 2>&1; then
        PG_DUMP=pg_dump
      fi

      if [ -z "$PG_DUMP" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"pg_dump not found\"}"
      elif [ -z "$SUPABASE_DB_URL" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"SUPABASE_DB_URL not set\"}"
      elif $PG_DUMP "$SUPABASE_DB_URL" --no-owner --no-privileges --clean --if-exists --schema=public 2>/dev/null | gzip > "$DUMP_FILE"; then
        DB_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
        echo "$LOG_PREFIX   Done: $DUMP_FILE ($DB_SIZE)"
        RESULT_JSON="{\"size\":\"$DB_SIZE\",\"file\":\"$(basename "$DUMP_FILE")\"}"
        # Log to backup_files so it appears in Backups table
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
          ls -1t "$DB_DIR"/full-*.sql.gz | tail -n +13 | while read -r old; do rm -f "$old"; done
        fi
      else
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"pg_dump failed\"}"
        rm -f "$DUMP_FILE"
      fi
      ;;

    cloudflare-r2)
      echo "$LOG_PREFIX   Running R2 sync..."
      R2_DIR="$BACKUP_ROOT/r2/$R2_BUCKET"
      mkdir -p "$R2_DIR"

      if [ -z "$R2_ACCESS" ] || [ -z "$R2_SECRET" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"R2 credentials not set\"}"
      elif AWS_ACCESS_KEY_ID="$R2_ACCESS" AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
           $AWS s3 sync "s3://$R2_BUCKET/" "$R2_DIR/" --endpoint-url "$R2_ENDPOINT" --no-progress --size-only 2>/dev/null; then
        R2_COUNT=$(find "$R2_DIR" -type f | wc -l | tr -d ' ')
        R2_SIZE=$(du -sh "$R2_DIR" 2>/dev/null | cut -f1)
        echo "$LOG_PREFIX   Done: $R2_COUNT files ($R2_SIZE)"
        RESULT_JSON="{\"files\":$R2_COUNT,\"size\":\"$R2_SIZE\"}"
      else
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"sync failed\"}"
      fi
      ;;

    cloudflare-d1)
      echo "$LOG_PREFIX   Running D1 export..."
      D1_DIR="$BACKUP_ROOT/d1"
      mkdir -p "$D1_DIR"
      D1_FILE="$D1_DIR/claude-sessions-${DATE}.sql"

      if [ -z "$CF_API_TOKEN" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"CLOUDFLARE_API_TOKEN not set\"}"
      else
        D1_OK=false
        for D1_ATTEMPT in 1 2 3; do
          EXPORT_RESP=$(curl -sf --retry 2 --retry-delay 5 \
            "https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT}/d1/database/${D1_DATABASE_ID}/export" \
            -H "Authorization: Bearer $CF_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{"output_format":"file","dump_options":{"no_schema":false,"no_data":false,"tables":[]}}' 2>/dev/null) || true

          SIGNED_URL=$(echo "$EXPORT_RESP" | jq -r '.result.signed_url // empty' 2>/dev/null)
          if [ -z "$SIGNED_URL" ]; then
            D1_ERR="D1 export API returned no signed_url (attempt $D1_ATTEMPT)"
            echo "$LOG_PREFIX   $D1_ERR"
            [ "$D1_ATTEMPT" -lt 3 ] && sleep 10
            continue
          fi
          if curl -sf --retry 2 --retry-delay 5 "$SIGNED_URL" -o "$D1_FILE" 2>/dev/null && [ -s "$D1_FILE" ]; then
            D1_OK=true
            break
          else
            D1_ERR="D1 signed URL download failed (attempt $D1_ATTEMPT)"
            echo "$LOG_PREFIX   $D1_ERR"
            rm -f "$D1_FILE"
            [ "$D1_ATTEMPT" -lt 3 ] && sleep 10
          fi
        done

        if [ "$D1_OK" = true ]; then
          D1_SIZE=$(du -h "$D1_FILE" | cut -f1)
          echo "$LOG_PREFIX   Done: $D1_FILE ($D1_SIZE)"
          RESULT_JSON="{\"size\":\"$D1_SIZE\",\"file\":\"$(basename "$D1_FILE")\"}"
          # Log to backup_files
          D1_SIZE_BYTES=$(stat -f%z "$D1_FILE" 2>/dev/null || echo 0)
          curl -sf "$SUPABASE_URL/rest/v1/backup_files" \
            -H "apikey: $SUPABASE_KEY" \
            -H "Authorization: Bearer $SUPABASE_KEY" \
            -H "Content-Type: application/json" \
            -H "Prefer: resolution=merge-duplicates" \
            -d "{\"service\":\"cloudflare-d1\",\"backup_date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"filename\":\"$(basename "$D1_FILE")\",\"filepath\":\"$D1_FILE\",\"size_bytes\":$D1_SIZE_BYTES}" \
            >/dev/null 2>&1 || true
          # Prune old exports (keep last 12)
          D1_COUNT=$(ls -1 "$D1_DIR"/claude-sessions-*.sql 2>/dev/null | wc -l | tr -d ' ')
          if [ "$D1_COUNT" -gt 12 ]; then
            ls -1t "$D1_DIR"/claude-sessions-*.sql | tail -n +13 | while read -r old; do rm -f "$old"; done
          fi
        else
          RESULT_STATUS="failed"
          RESULT_JSON="{\"error\":\"${D1_ERR}\"}"
          rm -f "$D1_FILE"
        fi
      fi
      ;;

    github-repo)
      echo "$LOG_PREFIX   Running GitHub mirror update..."
      GH_DIR="$BACKUP_ROOT/github/alpacapps.git"

      if ! command -v git >/dev/null 2>&1; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"git not found\"}"
      elif [ -d "$GH_DIR" ]; then
        # Clean macOS resource fork files that cause "non-monotonic index" errors
        find "$GH_DIR" -name '._*' -delete 2>/dev/null || true
        GIT_OK=false
        GIT_ERR=""
        for GIT_ATTEMPT in 1 2 3; do
          GIT_OUTPUT=$(git -C "$GH_DIR" remote update 2>&1)
          GIT_RC=$?
          if [ $GIT_RC -eq 0 ]; then
            GIT_OK=true
            break
          else
            GIT_ERR=$(echo "$GIT_OUTPUT" | grep -v "^error: non-monotonic" | tail -1)
            echo "$LOG_PREFIX   git remote update failed (attempt $GIT_ATTEMPT, rc=$GIT_RC): $GIT_ERR"
            [ "$GIT_ATTEMPT" -lt 3 ] && sleep 5
          fi
        done
        if [ "$GIT_OK" = true ]; then
          BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
          COMMIT_COUNT=$(git -C "$GH_DIR" rev-list --all --count 2>/dev/null || echo "0")
          echo "$LOG_PREFIX   Updated: $BRANCH_COUNT branches, $COMMIT_COUNT commits"
          RESULT_JSON="{\"branches\":$BRANCH_COUNT,\"commits\":$COMMIT_COUNT}"
          # Log to backup_files
          GH_SIZE_BYTES=$(du -s "$GH_DIR" 2>/dev/null | cut -f1)
          GH_SIZE_BYTES=$((GH_SIZE_BYTES * 512))  # du -s gives 512-byte blocks on macOS
          curl -sf "$SUPABASE_URL/rest/v1/backup_files" \
            -H "apikey: $SUPABASE_KEY" \
            -H "Authorization: Bearer $SUPABASE_KEY" \
            -H "Content-Type: application/json" \
            -H "Prefer: resolution=merge-duplicates" \
            -d "{\"service\":\"github-repo\",\"backup_date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"filename\":\"github/ ($(git -C "$GH_DIR" rev-list --all --count 2>/dev/null || echo 0) commits)\",\"filepath\":\"$GH_DIR\",\"size_bytes\":$GH_SIZE_BYTES}" \
            >/dev/null 2>&1 || true
        else
          RESULT_STATUS="failed"
          RESULT_JSON="{\"error\":\"remote update failed after 3 attempts: ${GIT_ERR}\"}"
        fi
      else
        mkdir -p "$(dirname "$GH_DIR")"
        if git clone --bare "$GH_REPO" "$GH_DIR" 2>/dev/null; then
          BRANCH_COUNT=$(git -C "$GH_DIR" branch -a 2>/dev/null | wc -l | tr -d ' ')
          echo "$LOG_PREFIX   Cloned: $BRANCH_COUNT branches"
          RESULT_JSON="{\"branches\":$BRANCH_COUNT,\"initial_clone\":true}"
        else
          RESULT_STATUS="failed"
          RESULT_JSON="{\"error\":\"clone failed\"}"
        fi
      fi
      ;;

    home-assistant)
      echo "$LOG_PREFIX   Running Home Assistant backup via WebSocket Supervisor API..."
      # HA backup requires WebSocket → supervisor/api (HTTP API doesn't expose Supervisor)
      HA_TOKEN=""
      if [ -f "$HOME/.ha_llat" ]; then
        HA_TOKEN=$(head -1 "$HOME/.ha_llat")
      fi

      if [ -z "$HA_TOKEN" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"No HA token in ~/.ha_llat\"}"
      else
        BACKUP_NAME="Manual $(date '+%Y-%m-%d %H:%M')"
        BACKUP_RESULT=$(HA_TOKEN="$HA_TOKEN" BACKUP_NAME="$BACKUP_NAME" python3 << 'PYEOF'
import asyncio, json, os

async def create_backup():
    try:
        import websockets
    except ImportError:
        print("ERROR: websockets not installed")
        return
    token = os.environ["HA_TOKEN"]
    name = os.environ["BACKUP_NAME"]
    try:
        async with websockets.connect("ws://192.168.1.39:8123/api/websocket", close_timeout=300) as ws:
            await ws.recv()  # auth_required
            await ws.send(json.dumps({"type": "auth", "access_token": token}))
            msg = json.loads(await ws.recv())
            if msg["type"] != "auth_ok":
                print(f"AUTH_FAIL: {msg}")
                return
            await ws.send(json.dumps({
                "id": 1, "type": "supervisor/api",
                "endpoint": "/backups/new/full",
                "method": "post",
                "data": {"name": name}
            }))
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=600))
            if msg.get("success"):
                slug = msg["result"].get("data", {}).get("slug", "")
                size = msg["result"].get("data", {}).get("size", "")
                print(f"OK: {slug} ({size})")
            else:
                print(f"FAIL: {json.dumps(msg)}")
    except Exception as e:
        print(f"ERROR: {e}")

asyncio.run(create_backup())
PYEOF
        )
        echo "$LOG_PREFIX   Result: $BACKUP_RESULT"

        if echo "$BACKUP_RESULT" | grep -q "^OK:"; then
          SLUG=$(echo "$BACKUP_RESULT" | sed 's/^OK: //' | cut -d' ' -f1)
          RESULT_JSON="{\"slug\":\"$SLUG\",\"name\":\"$BACKUP_NAME\"}"
        else
          RESULT_STATUS="failed"
          ERR_MSG=$(echo "$BACKUP_RESULT" | head -1)
          RESULT_JSON="{\"error\":\"$ERR_MSG\"}"
        fi
      fi
      ;;

    haos-vm-image)
      echo "$LOG_PREFIX   Running HAOS VM image backup..."
      # Find the HAOS disk image (check known paths)
      HAOS_IMG=""
      for candidate in \
        "$HOME/homeassistant-vm/haos_generic-aarch64-17.1.img" \
        "$HOME/homeassistant-vm/haos_generic-aarch64.img" \
        "$HOME/haos/haos_generic-aarch64.img"; do
        if [ -f "$candidate" ]; then
          HAOS_IMG="$candidate"
          break
        fi
      done

      HAOS_BACKUP_DIR="/Volumes/rvault20/BackupsRS/haos-vm"
      if [ -z "$HAOS_IMG" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"HAOS image not found at any known path\"}"
      elif [ ! -d "/Volumes/rvault20" ]; then
        RESULT_STATUS="failed"
        RESULT_JSON="{\"error\":\"rvault20 not mounted\"}"
      else
        mkdir -p "$HAOS_BACKUP_DIR"
        DEST="$HAOS_BACKUP_DIR/haos-$(date +%Y-%m-%d).img"
        echo "$LOG_PREFIX   Copying $(du -h "$HAOS_IMG" | cut -f1) image..."
        if cp "$HAOS_IMG" "$DEST" 2>/dev/null; then
          # Also copy EFI files
          cp "$(dirname "$HAOS_IMG")/efi_vars.fd" "$HAOS_BACKUP_DIR/efi_vars-$(date +%Y-%m-%d).fd" 2>/dev/null || true
          cp "$(dirname "$HAOS_IMG")/efi_code.fd" "$HAOS_BACKUP_DIR/efi_code.fd" 2>/dev/null || true
          IMG_SIZE=$(du -h "$DEST" | cut -f1)
          echo "$LOG_PREFIX   Done: $DEST ($IMG_SIZE)"
          RESULT_JSON="{\"size\":\"$IMG_SIZE\",\"file\":\"$(basename "$DEST")\"}"
          # Prune old (keep 7)
          ls -1t "$HAOS_BACKUP_DIR"/haos-*.img 2>/dev/null | tail -n +8 | while read -r old; do
            DATE_PART="${old##*haos-}"
            DATE_PART="${DATE_PART%.img}"
            rm -f "$old" "$HAOS_BACKUP_DIR/efi_vars-$DATE_PART.fd" 2>/dev/null
          done
        else
          RESULT_STATUS="failed"
          RESULT_JSON="{\"error\":\"cp failed\"}"
        fi
      fi
      ;;

    *)
      echo "$LOG_PREFIX   Unknown service: $SERVICE"
      RESULT_STATUS="failed"
      RESULT_JSON="{\"error\":\"unknown service\"}"
      ;;
  esac

  SVC_END=$(date +%s)
  SVC_DURATION=$((SVC_END - SVC_START))

  # Mark trigger as completed/failed
  curl -sf "$SUPABASE_URL/rest/v1/backup_triggers?id=eq.$TRIGGER_ID" \
    -X PATCH \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$RESULT_STATUS\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"result\":$RESULT_JSON}" \
    >/dev/null 2>&1

  # Also log to backup_logs if successful
  if [ "$RESULT_STATUS" = "completed" ]; then
    DETAILS_JSON="{\"trigger_id\":$TRIGGER_ID,\"duration_seconds\":$SVC_DURATION,\"service\":\"$SERVICE\",\"result\":$RESULT_JSON}"
    curl -sf "$SUPABASE_URL/rest/v1/backup_logs" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"source\":\"trigger-poller\",\"backup_type\":\"manual-$SERVICE\",\"status\":\"$RESULT_STATUS\",\"duration_seconds\":$SVC_DURATION,\"details\":$DETAILS_JSON}" \
      >/dev/null 2>&1
  fi

  echo "$LOG_PREFIX   Trigger $TRIGGER_ID: $RESULT_STATUS (${SVC_DURATION}s)"

done

echo "$LOG_PREFIX Done processing triggers"
