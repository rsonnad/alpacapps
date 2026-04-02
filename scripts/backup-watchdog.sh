#!/bin/bash
# backup-watchdog.sh — Self-healing backup monitor.
#
# Checks for failed backup triggers, collects error context, and sends
# the problem to Claude CLI on Alpuca to diagnose, fix, and re-invoke.
# Loops until all services have a recent successful backup.
#
# Runs hourly via cron on Alpuca:
#   30 * * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/backup-watchdog.sh >> /Users/alpuca/logs/backup-watchdog.log 2>&1
#
# Requires: claude CLI, ~/.env-alpacapps, curl, jq

set -uo pipefail

export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [backup-watchdog]"
LOG_FILE="$HOME/logs/backup-watchdog.log"
LOCK_FILE="/tmp/backup-watchdog.lock"
MAX_RETRIES=3
RETRY_DELAY=300  # 5 minutes between retries

# Load env
ENVFILE="$HOME/.env-alpacapps"
if [ -f "$ENVFILE" ]; then
  export $(grep -v '^#' "$ENVFILE" | grep '=' | xargs) 2>/dev/null || true
fi

SB_URL="${SUPABASE_URL:-https://aphrrfprbixmhissnjfn.supabase.co}"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SB_KEY" ]; then
  echo "$LOG_PREFIX ERROR: SUPABASE_SERVICE_ROLE_KEY not set" >&2
  exit 1
fi

# ── Lock file (prevent concurrent runs) ──────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f%m "$LOCK_FILE") ))
  if [ "$LOCK_AGE" -gt 3600 ]; then
    echo "$LOG_PREFIX Stale lock (${LOCK_AGE}s) — removing"
    rm -f "$LOCK_FILE"
  else
    echo "$LOG_PREFIX Already running (lock age: ${LOCK_AGE}s) — skipping"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Check for recent failures ────────────────────────────────────────
echo "$LOG_PREFIX Checking for failed backup triggers in last 24h..."

SINCE=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)

FAILED=$(curl -sf "$SB_URL/rest/v1/backup_triggers?status=eq.failed&completed_at=gte.$SINCE&order=completed_at.desc" \
  -H "apikey: $SB_KEY" \
  -H "Authorization: Bearer $SB_KEY" 2>/dev/null)

if [ -z "$FAILED" ] || [ "$FAILED" = "[]" ]; then
  echo "$LOG_PREFIX No failed triggers in last 24h — all healthy"
  exit 0
fi

FAIL_COUNT=$(echo "$FAILED" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "$LOG_PREFIX Found $FAIL_COUNT failed trigger(s)"

# ── Check which services need attention ──────────────────────────────
# Get unique failed services that don't have a more recent success
SERVICES_NEEDING_FIX=$(echo "$FAILED" | python3 -c "
import sys, json
failed = json.load(sys.stdin)
services = set()
for t in failed:
    services.add(t['service'])
for s in sorted(services):
    print(s)
")

if [ -z "$SERVICES_NEEDING_FIX" ]; then
  echo "$LOG_PREFIX All failed services have subsequent successes — OK"
  exit 0
fi

# Check if each failed service has a recent success (would mean it self-healed)
NEEDS_FIX=""
for SVC in $SERVICES_NEEDING_FIX; do
  RECENT_SUCCESS=$(curl -sf "$SB_URL/rest/v1/backup_triggers?service=eq.$SVC&status=eq.completed&completed_at=gte.$SINCE&limit=1" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY" 2>/dev/null)

  if [ -z "$RECENT_SUCCESS" ] || [ "$RECENT_SUCCESS" = "[]" ]; then
    NEEDS_FIX="$NEEDS_FIX $SVC"
    echo "$LOG_PREFIX   $SVC — NEEDS FIX (no recent success)"
  else
    echo "$LOG_PREFIX   $SVC — OK (has recent success after failure)"
  fi
done

NEEDS_FIX=$(echo "$NEEDS_FIX" | xargs)  # trim whitespace
if [ -z "$NEEDS_FIX" ]; then
  echo "$LOG_PREFIX All services self-healed — nothing to do"
  exit 0
fi

# ── Collect diagnostic context ───────────────────────────────────────
echo "$LOG_PREFIX Collecting diagnostic context for: $NEEDS_FIX"

DIAG_FILE="/tmp/backup-watchdog-diag.txt"
cat > "$DIAG_FILE" << 'HEADER'
# Backup Watchdog — Failure Diagnosis Request

You are running on Alpuca (Mac Mini M4, 192.168.1.200).
RVAULT20 is a USB drive mounted at /Volumes/RVAULT20.
Backup scripts are in ~/scripts/.
Env vars are in ~/.env-alpacapps (already loaded — do NOT modify secrets).

HEADER

echo "## FAILED SERVICES THAT NEED FIXING:" >> "$DIAG_FILE"
echo "$NEEDS_FIX" >> "$DIAG_FILE"
echo "" >> "$DIAG_FILE"

# Add failed trigger details with full result JSON
echo "## Failed trigger details (last 24h):" >> "$DIAG_FILE"
echo "$FAILED" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    print(f\"  Service: {t['service']}\")
    print(f\"  Status: {t['status']}\")
    print(f\"  Requested: {t.get('requested_at','?')}\")
    print(f\"  Completed: {t.get('completed_at','?')}\")
    r = t.get('result')
    if r:
        if isinstance(r, str):
            print(f\"  Result: {r}\")
        else:
            print(f\"  Result: {json.dumps(r)}\")
    notes = t.get('notes','')
    if notes:
        print(f\"  Notes: {notes}\")
    print()
" >> "$DIAG_FILE"

# Add recent log tails (more lines for better context)
echo "## Recent backup-trigger-poller.log (last 60 lines):" >> "$DIAG_FILE"
tail -60 "$HOME/logs/backup-trigger-poller.log" >> "$DIAG_FILE" 2>/dev/null

echo "" >> "$DIAG_FILE"
echo "## Recent alpacapps-backup.log (last 30 lines):" >> "$DIAG_FILE"
tail -30 "$HOME/logs/alpacapps-backup.log" >> "$DIAG_FILE" 2>/dev/null

echo "" >> "$DIAG_FILE"
echo "## Recent watchdog log (last 20 lines):" >> "$DIAG_FILE"
tail -20 "$HOME/logs/backup-watchdog.log" >> "$DIAG_FILE" 2>/dev/null

# Add comprehensive system state
echo "" >> "$DIAG_FILE"
echo "## System state:" >> "$DIAG_FILE"
echo "RVAULT20 mounted: $(mount | grep -c -i rvault20 || echo 0)" >> "$DIAG_FILE"
echo "RVAULT20 free space: $(df -h /Volumes/RVAULT20 2>/dev/null | tail -1 | awk '{print $4}' || echo 'N/A')" >> "$DIAG_FILE"
echo "pg_dump: $(which pg_dump 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "aws: $(which aws 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "jq: $(which jq 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "git: $(which git 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "HAOS img: $(ls ~/homeassistant-vm/haos_generic-aarch64*.img 2>/dev/null || echo 'not found')" >> "$DIAG_FILE"
echo "SUPABASE_DB_URL set: $([ -n "${SUPABASE_DB_URL:-}" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"
echo "SUPABASE_SERVICE_ROLE_KEY set: $([ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"
echo "CLOUDFLARE_API_TOKEN set: $([ -n "${CLOUDFLARE_API_TOKEN:-}" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"
echo "R2_ACCOUNT_ID set: $([ -n "${R2_ACCOUNT_ID:-}" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"
echo "D1_DATABASE_ID: ${D1_DATABASE_ID:-not set}" >> "$DIAG_FILE"
echo "Network — Cloudflare API: $(curl -sf --max-time 5 -o /dev/null -w '%{http_code}' https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-none}" 2>/dev/null || echo 'unreachable')" >> "$DIAG_FILE"
echo "Network — GitHub: $(curl -sf --max-time 5 -o /dev/null -w '%{http_code}' https://github.com 2>/dev/null || echo 'unreachable')" >> "$DIAG_FILE"

# Include the relevant sections of the backup script for each failing service
echo "" >> "$DIAG_FILE"
echo "## Relevant script sections (from ~/scripts/backup-trigger-poller.sh):" >> "$DIAG_FILE"
for FAILING_SVC in $NEEDS_FIX; do
  echo "" >> "$DIAG_FILE"
  echo "### ---- $FAILING_SVC section ----" >> "$DIAG_FILE"
  # Extract the case block for this service
  sed -n "/^    ${FAILING_SVC})/,/^    ;;$/p" "$HOME/scripts/backup-trigger-poller.sh" >> "$DIAG_FILE" 2>/dev/null
done

# Include per-service live diagnostic tests
echo "" >> "$DIAG_FILE"
echo "## Live diagnostic tests (run just now):" >> "$DIAG_FILE"
for FAILING_SVC in $NEEDS_FIX; do
  echo "" >> "$DIAG_FILE"
  echo "### $FAILING_SVC:" >> "$DIAG_FILE"
  case "$FAILING_SVC" in
    cloudflare-d1)
      D1_DB="${D1_DATABASE_ID:-98d0e680-8abe-4ce3-a941-70cb391adbf8}"
      D1_TEST=$(curl -sf "https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID:-}/d1/database/${D1_DB}/export" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-}" \
        -H "Content-Type: application/json" \
        -d '{"output_format":"file","dump_options":{"no_schema":false,"no_data":false,"tables":[]}}' 2>&1)
      echo "  D1 export API response success: $(echo "$D1_TEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success','?'))" 2>/dev/null || echo 'parse failed')" >> "$DIAG_FILE"
      echo "  D1 signed_url present: $(echo "$D1_TEST" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print('yes' if r.get('signed_url') else 'no')" 2>/dev/null || echo 'parse failed')" >> "$DIAG_FILE"
      SIGNED_URL_TEST=$(echo "$D1_TEST" | jq -r '.result.signed_url // empty' 2>/dev/null)
      if [ -n "$SIGNED_URL_TEST" ]; then
        echo "  D1 download test: $(curl -sf --max-time 30 "$SIGNED_URL_TEST" -o /dev/null -w 'HTTP %{http_code}, %{size_download} bytes' 2>/dev/null || echo 'FAILED')" >> "$DIAG_FILE"
      fi
      ;;
    github-repo)
      GH_TEST_DIR="/Volumes/RVAULT20/backups/alpacapps/github/alpacapps.git"
      echo "  GH bare repo exists: $([ -d "$GH_TEST_DIR" ] && echo yes || echo no)" >> "$DIAG_FILE"
      echo "  macOS ._ files: $(find "$GH_TEST_DIR" -name '._*' 2>/dev/null | wc -l | tr -d ' ')" >> "$DIAG_FILE"
      GIT_TEST_OUT=$(git -C "$GH_TEST_DIR" remote update 2>&1)
      GIT_TEST_RC=$?
      echo "  git remote update exit code: $GIT_TEST_RC" >> "$DIAG_FILE"
      echo "  git remote update output: $(echo "$GIT_TEST_OUT" | tail -3)" >> "$DIAG_FILE"
      ;;
    supabase-db)
      echo "  pg_dump version: $(pg_dump --version 2>/dev/null || echo 'not found')" >> "$DIAG_FILE"
      echo "  DB URL reachable: $(pg_isready -d "${SUPABASE_DB_URL:-}" 2>&1 | tail -1 || echo 'pg_isready not found')" >> "$DIAG_FILE"
      ;;
    cloudflare-r2)
      echo "  aws s3 ls test: $(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}" aws s3 ls "s3://${R2_BUCKET_NAME:-alpacapps}/" --endpoint-url "https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com" 2>&1 | head -2)" >> "$DIAG_FILE"
      ;;
    home-assistant)
      echo "  HA reachable: $(curl -sf --max-time 5 -o /dev/null -w '%{http_code}' http://192.168.1.39:8123/api/ -H "Authorization: Bearer $(head -1 ~/.ha_llat 2>/dev/null)" 2>/dev/null || echo 'unreachable')" >> "$DIAG_FILE"
      ;;
  esac
done

echo "" >> "$DIAG_FILE"
cat >> "$DIAG_FILE" << 'INSTRUCTIONS'
## Your task:
1. Read the errors and live diagnostic results above. Identify the root cause for each failed service.
2. Fix the issue if possible:
   - Edit scripts in ~/scripts/ to fix bugs, handle edge cases, or improve error handling.
   - Fix system issues (missing tools, wrong paths, file permissions).
   - Clean up corrupt files (e.g. macOS ._ resource forks in git repos on RVAULT20).
3. After fixing, create new pending backup triggers for each fixed service:
   curl -sf "https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/backup_triggers" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"service":"SERVICE_NAME","requested_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","status":"pending"}'
   Then wait 10 seconds and run ~/scripts/backup-trigger-poller.sh to execute them.
4. Verify the backup succeeded by checking trigger status.
5. If the backup still fails after your fix, explain what's wrong and what manual intervention is needed.

IMPORTANT:
- Do NOT modify ~/.env-alpacapps secrets.
- Do NOT change cron entries (those are managed separately).
- The backup script is at ~/scripts/backup-trigger-poller.sh — you can read and edit it.
- Env vars from ~/.env-alpacapps are already loaded in the shell.
INSTRUCTIONS

# ── Send to Claude CLI ───────────────────────────────────────────────
echo "$LOG_PREFIX Sending diagnosis to Claude CLI..."

ATTEMPT=0
while [ $ATTEMPT -lt $MAX_RETRIES ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "$LOG_PREFIX Attempt $ATTEMPT/$MAX_RETRIES"

  # Check if Claude CLI is available
  if ! command -v claude >/dev/null 2>&1; then
    echo "$LOG_PREFIX ERROR: claude CLI not found in PATH"
    break
  fi

  # Run Claude with the diagnostic context
  # Use --print flag for non-interactive output, timeout after 10 minutes
  CLAUDE_OUTPUT=$(timeout 600 claude --print --dangerously-skip-permissions \
    "$(cat "$DIAG_FILE")" 2>&1) || true

  echo "$LOG_PREFIX Claude response (truncated):"
  echo "$CLAUDE_OUTPUT" | tail -20

  # Check if backups succeeded after Claude's fix
  sleep 10  # Give triggers time to update

  ALL_FIXED=true
  for SVC in $NEEDS_FIX; do
    CHECK_SUCCESS=$(curl -sf "$SB_URL/rest/v1/backup_triggers?service=eq.$SVC&status=eq.completed&completed_at=gte.$SINCE&limit=1" \
      -H "apikey: $SB_KEY" \
      -H "Authorization: Bearer $SB_KEY" 2>/dev/null)

    if [ -z "$CHECK_SUCCESS" ] || [ "$CHECK_SUCCESS" = "[]" ]; then
      echo "$LOG_PREFIX   $SVC — still failing after attempt $ATTEMPT"
      ALL_FIXED=false
    else
      echo "$LOG_PREFIX   $SVC — FIXED!"
    fi
  done

  if [ "$ALL_FIXED" = true ]; then
    echo "$LOG_PREFIX All services fixed after $ATTEMPT attempt(s)!"
    break
  fi

  if [ $ATTEMPT -lt $MAX_RETRIES ]; then
    echo "$LOG_PREFIX Waiting ${RETRY_DELAY}s before retry..."
    sleep $RETRY_DELAY

    # Re-create pending triggers for still-failing services
    for SVC in $NEEDS_FIX; do
      CHECK_SUCCESS=$(curl -sf "$SB_URL/rest/v1/backup_triggers?service=eq.$SVC&status=eq.completed&completed_at=gte.$SINCE&limit=1" \
        -H "apikey: $SB_KEY" \
        -H "Authorization: Bearer $SB_KEY" 2>/dev/null)

      if [ -z "$CHECK_SUCCESS" ] || [ "$CHECK_SUCCESS" = "[]" ]; then
        curl -sf "$SB_URL/rest/v1/backup_triggers" \
          -H "apikey: $SB_KEY" \
          -H "Authorization: Bearer $SB_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"service\":\"$SVC\",\"requested_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"pending\"}" \
          >/dev/null 2>&1
        echo "$LOG_PREFIX   Re-triggered $SVC"
      fi
    done
  fi
done

if [ "$ALL_FIXED" != true ]; then
  echo "$LOG_PREFIX ALERT: Failed to fix backups after $MAX_RETRIES attempts"
  echo "$LOG_PREFIX Services still failing: $NEEDS_FIX"
  # Could add Slack/email alert here in the future
fi

rm -f "$DIAG_FILE"
echo "$LOG_PREFIX Done"
