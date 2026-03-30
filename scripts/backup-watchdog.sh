#!/bin/bash
# backup-watchdog.sh — Self-healing backup monitor.
#
# Checks for failed backup triggers, collects error context, and sends
# the problem to Claude CLI on Alpuca to diagnose, fix, and re-invoke.
# Loops until all services have a recent successful backup.
#
# Runs hourly via cron on Alpuca:
#   0 * * * * /Users/alpuca/scripts/backup-watchdog.sh >> /Users/alpuca/logs/backup-watchdog.log 2>&1
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
RVAULT20 is a USB drive mounted at /Volumes/rvault20.
Backup scripts are in ~/scripts/.
Env vars are in ~/.env-alpacapps.

FAILED SERVICES THAT NEED FIXING:
HEADER

echo "$NEEDS_FIX" >> "$DIAG_FILE"
echo "" >> "$DIAG_FILE"

# Add failed trigger details
echo "## Failed trigger details (last 24h):" >> "$DIAG_FILE"
echo "$FAILED" | python3 -c "
import sys, json
for t in json.load(sys.stdin):
    print(f\"  Service: {t['service']}\")
    print(f\"  Status: {t['status']}\")
    print(f\"  Time: {t.get('completed_at','?')}\")
    r = t.get('result') or {}
    if isinstance(r, dict):
        print(f\"  Error: {r.get('error','unknown')}\")
    print()
" >> "$DIAG_FILE"

# Add recent log tails
echo "## Recent backup-trigger-poller.log (last 30 lines):" >> "$DIAG_FILE"
tail -30 "$HOME/logs/backup-trigger-poller.log" >> "$DIAG_FILE" 2>/dev/null

echo "" >> "$DIAG_FILE"
echo "## Recent alpacapps-backup.log (last 20 lines):" >> "$DIAG_FILE"
tail -20 "$HOME/logs/alpacapps-backup.log" >> "$DIAG_FILE" 2>/dev/null

# Add system state
echo "" >> "$DIAG_FILE"
echo "## System state:" >> "$DIAG_FILE"
echo "RVAULT20 mounted: $(mount | grep -c rvault20 || echo 0)" >> "$DIAG_FILE"
echo "pg_dump: $(which pg_dump 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "aws: $(which aws 2>/dev/null || echo 'not in PATH')" >> "$DIAG_FILE"
echo "HAOS img: $(ls ~/homeassistant-vm/haos_generic-aarch64*.img 2>/dev/null || echo 'not found')" >> "$DIAG_FILE"
echo "SUPABASE_DB_URL set: $([ -n \"${SUPABASE_DB_URL:-}\" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"
echo "SUPABASE_SERVICE_ROLE_KEY set: $([ -n \"${SUPABASE_SERVICE_ROLE_KEY:-}\" ] && echo 'yes' || echo 'no')" >> "$DIAG_FILE"

echo "" >> "$DIAG_FILE"
cat >> "$DIAG_FILE" << 'INSTRUCTIONS'
## Your task:
1. Read the errors above and diagnose root cause for each failed service.
2. Fix the issue if possible (edit scripts, install missing tools, fix paths, etc.)
3. After fixing, re-run the backup for each failed service by executing:
   ~/scripts/backup-trigger-poller.sh
   (It will pick up any pending triggers automatically.)
4. If the backup still fails, explain what's wrong and what manual intervention is needed.

IMPORTANT:
- Do NOT modify ~/.env-alpacapps secrets.
- Do NOT change cron entries (those are managed separately).
- Focus on fixing the scripts in ~/scripts/ or system issues (mount, PATH, tools).
- After your fix, verify the backup succeeded by checking the trigger status.
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
