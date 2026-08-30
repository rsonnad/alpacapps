#!/usr/bin/env bash
#
# sonos-health-cron.sh — Sonos/network symptom telemetry, every 15 min on Alpuca.
#
# Companion to unifi-snapshot-cron.sh (nightly CONFIG history). This one samples
# SYMPTOMS and emails via Resend when the system enters a known-bad state.
#
# DEPLOYMENT NOTE: same macOS TCC gotcha as unifi-snapshot-cron.sh — cron cannot
# execute scripts under ~/Documents/ without Full Disk Access. Deploy a copy to
# /Users/alpuca/scripts/ and point cron at that. See service-access.md §0.
#
#   cp scripts/sonos-health-cron.sh scripts/sonos-health.py /Users/alpuca/scripts/
#
# Crontab line (Alpuca):
#   */15 * * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/sonos-health-cron.sh >> /Users/alpuca/logs/sonos-health.log 2>&1
#
# Credentials: ~/.unifi-snapshot.env (UDM_SSH_PASS, UDM_WEB_PASS, SUPA_TOKEN) —
# the same file the nightly snapshot uses. No separate secret to rotate.
#
set -euo pipefail

REPO="/Users/alpuca/Documents/codingprojects/alpacapps"
PY="/opt/homebrew/bin/python3"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] $*"; }

# Prefer the deployed copy; fall back to the repo checkout when run by hand.
if [ -r "/Users/alpuca/scripts/sonos-health.py" ]; then
  SCRIPT="/Users/alpuca/scripts/sonos-health.py"
else
  SCRIPT="$REPO/scripts/sonos-health.py"
fi

ENV_FILE="$HOME/.unifi-snapshot.env"
if [ ! -r "$ENV_FILE" ]; then
  log "ERROR: $ENV_FILE not readable — cannot reach UDM"
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

if [ -z "${UDM_SSH_PASS:-}" ] || [ -z "${UDM_WEB_PASS:-}" ] || [ -z "${SUPA_TOKEN:-}" ]; then
  log "ERROR: missing UDM_SSH_PASS / UDM_WEB_PASS / SUPA_TOKEN in $ENV_FILE"
  exit 1
fi

# Runs every 15 min, so keep the log to one line per healthy run and let the
# script print detail only when something is wrong.
if OUT=$("$PY" "$SCRIPT" "$@" 2>&1); then
  if echo "$OUT" | grep -q "VIOLATION"; then
    log "PROBLEM:"
    echo "$OUT"
  else
    log "$(echo "$OUT" | head -1)"
  fi
else
  log "ERROR: sonos-health.py exited nonzero"
  echo "$OUT"
  exit 1
fi
