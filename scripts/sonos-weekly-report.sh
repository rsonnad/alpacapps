#!/usr/bin/env bash
#
# sonos-weekly-report.sh — Monday-morning Sonos digest, emailed via Resend.
#
# Third layer of the Sonos telemetry stack:
#   unifi-snapshot-cron.sh   nightly   config drift  -> network_config_snapshots
#   sonos-health-cron.sh     15 min    acute alerts  -> sonos_health_samples
#   sonos-weekly-report.sh   weekly    trends/verdict-> email
#
# It answers the questions a single sample can't: did the UDM reboot and did the
# kernel fix survive it, and does retry rate actually worsen as zones are grouped
# (which decides the channel-1 rebalance).
#
# DEPLOYMENT NOTE: same macOS TCC gotcha as the other cron jobs — cron cannot
# execute scripts under ~/Documents/. Deploy a copy to /Users/alpuca/scripts/.
#
# Crontab line (Alpuca) — Mondays 08:00 America/Chicago:
#   0 8 * * 1 PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/sonos-weekly-report.sh >> /Users/alpuca/logs/sonos-weekly.log 2>&1
#
set -euo pipefail

PY="/opt/homebrew/bin/python3"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] $*"; }

if [ -r "/Users/alpuca/scripts/sonos-weekly-report.py" ]; then
  SCRIPT="/Users/alpuca/scripts/sonos-weekly-report.py"
else
  SCRIPT="/Users/alpuca/Documents/codingprojects/alpacapps/scripts/sonos-weekly-report.py"
fi

ENV_FILE="$HOME/.unifi-snapshot.env"
if [ ! -r "$ENV_FILE" ]; then
  log "ERROR: $ENV_FILE not readable"
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

if [ -z "${SUPA_TOKEN:-}" ]; then
  log "ERROR: SUPA_TOKEN missing from $ENV_FILE"
  exit 1
fi

log "generating weekly Sonos report"
"$PY" "$SCRIPT" "$@"
log "done"
