#!/usr/bin/env bash
#
# unifi-snapshot-cron.sh — daily UniFi config snapshot, intended for Alpuca cron at 4:00 AM.
#
# DEPLOYMENT NOTE (2026-05-07): This file in the repo is the canonical/dev version.
# The cron-runtime version lives at /Users/alpuca/scripts/unifi-snapshot-cron.sh on Alpuca.
# Reason: macOS TCC blocks cron from executing scripts in ~/Documents/ unless cron is granted
# Full Disk Access. Deploying a copy to /Users/alpuca/scripts/ avoids the issue (matches the
# pattern used by other working cron jobs like backup-finleg-to-rvault.sh). See service-access.md
# §0 "Cron jobs on Alpuca — script-location TCC gotcha" for the full story and re-deploy command.
#
# Crontab line (Alpuca):
#   0 4 * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/unifi-snapshot-cron.sh >> /Users/alpuca/logs/unifi-snapshot.log 2>&1
#
# Behaviour:
#   1. cd to repo + git pull (so local script always tracks main)
#   2. Unlock Bitwarden via macOS Keychain (entry: bitwarden-cli / rahulioson@gmail.com)
#   3. Pull UDM credentials + Supabase Dashboard token from BW
#   4. Run unifi-snapshot.py with date-tagged name + tags=[daily,scheduled,...]
#
# Snapshot lands in public.network_config_snapshots — same table as manual snapshots.
#
set -euo pipefail

REPO="/Users/alpuca/Documents/codingprojects/alpacapps"
BW="/opt/homebrew/bin/bw"
PY="/opt/homebrew/bin/python3"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] $*"; }

cd "$REPO"

log "[unifi-snapshot-cron] starting"

# Refresh repo so the script body matches main
if git pull --quiet --rebase --autostash 2>/dev/null; then
  log "git pull ok ($(git rev-parse --short HEAD))"
else
  log "WARN: git pull failed — proceeding with cached script"
fi

# Credentials. Two paths, in order:
#   (1) ~/.unifi-snapshot.env (matches existing Alpuca pattern: ~/.ha_llat, ~/.sb_service_key).
#       Should define UDM_SSH_PASS, UDM_WEB_PASS, SUPA_TOKEN. chmod 600 required.
#   (2) Bitwarden via macOS Keychain — works in interactive shells but typically NOT in cron/SSH on macOS,
#       so this is the fallback when running manually for testing.
ENV_FILE="$HOME/.unifi-snapshot.env"
if [ -r "$ENV_FILE" ]; then
  log "loading credentials from $ENV_FILE"
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
else
  log "no $ENV_FILE — falling back to Bitwarden via Keychain (won't work in cron)"
  BW_PASSWORD=$(security find-generic-password -a "rahulioson@gmail.com" -s "bitwarden-cli" -w 2>/dev/null || true)
  [ -z "$BW_PASSWORD" ] && { log "ERROR: keychain item bitwarden-cli not accessible and no $ENV_FILE"; exit 1; }
  export BW_PASSWORD
  BW_SESSION=$("$BW" unlock --passwordenv BW_PASSWORD --raw 2>/dev/null || true)
  [ -z "$BW_SESSION" ] && { log "ERROR: bw unlock failed"; exit 1; }
  export BW_SESSION; unset BW_PASSWORD
  export UDM_SSH_PASS=$("$BW" get item "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null \
    | "$PY" -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='SSH Password']")
  export UDM_WEB_PASS=$("$BW" get password "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null)
  export SUPA_TOKEN=$("$BW" get item "4febf188-93d8-4e74-b052-b428005949fe" --session "$BW_SESSION" 2>/dev/null \
    | "$PY" -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='Access Token']")
fi

if [ -z "${UDM_SSH_PASS:-}" ] || [ -z "${UDM_WEB_PASS:-}" ] || [ -z "${SUPA_TOKEN:-}" ]; then
  log "ERROR: missing UDM_SSH_PASS / UDM_WEB_PASS / SUPA_TOKEN"
  exit 1
fi

# Take snapshot
DATE_TAG=$(date +%Y-%m-%d)
log "running unifi-snapshot.py for $DATE_TAG"
"$PY" ./scripts/unifi-snapshot.py "Daily auto-snapshot $DATE_TAG" \
  --notes "Automated nightly snapshot from Alpuca cron. If something breaks during the day, this is the rollback baseline." \
  --tags daily,scheduled,sonos,wifi,auto

log "[unifi-snapshot-cron] done"
