#!/usr/bin/env bash
#
# unifi-snapshot-cron.sh — daily UniFi config snapshot, intended for Alpuca cron at 4:00 AM.
#
# Crontab line (Alpuca):
#   0 4 * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/Documents/codingprojects/alpacapps/scripts/unifi-snapshot-cron.sh >> /Users/alpuca/logs/unifi-snapshot.log 2>&1
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

# Unlock BW via macOS Keychain. Cron inherits the user's keychain access.
BW_PASSWORD=$(security find-generic-password -a "rahulioson@gmail.com" -s "bitwarden-cli" -w 2>/dev/null || true)
if [ -z "$BW_PASSWORD" ]; then
  log "ERROR: keychain item bitwarden-cli/rahulioson@gmail.com not accessible"
  exit 1
fi
export BW_PASSWORD

BW_SESSION=$("$BW" unlock --passwordenv BW_PASSWORD --raw 2>/dev/null || true)
if [ -z "$BW_SESSION" ]; then
  log "ERROR: bw unlock failed"
  exit 1
fi
export BW_SESSION
unset BW_PASSWORD

# Credentials
export UDM_SSH_PASS=$("$BW" get item "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null \
  | "$PY" -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='SSH Password']")
export UDM_WEB_PASS=$("$BW" get password "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null)
export SUPA_TOKEN=$("$BW" get item "4febf188-93d8-4e74-b052-b428005949fe" --session "$BW_SESSION" 2>/dev/null \
  | "$PY" -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='Access Token']")

if [ -z "$UDM_SSH_PASS" ] || [ -z "$UDM_WEB_PASS" ] || [ -z "$SUPA_TOKEN" ]; then
  log "ERROR: missing one of UDM_SSH_PASS / UDM_WEB_PASS / SUPA_TOKEN after BW fetch"
  exit 1
fi

# Take snapshot
DATE_TAG=$(date +%Y-%m-%d)
log "running unifi-snapshot.py for $DATE_TAG"
"$PY" ./scripts/unifi-snapshot.py "Daily auto-snapshot $DATE_TAG" \
  --notes "Automated nightly snapshot from Alpuca cron. If something breaks during the day, this is the rollback baseline." \
  --tags daily,scheduled,sonos,wifi,auto

log "[unifi-snapshot-cron] done"
