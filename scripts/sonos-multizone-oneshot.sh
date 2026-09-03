#!/usr/bin/env bash
#
# sonos-multizone-oneshot.sh — run the full multi-zone test once, at a scheduled
# time, then remove its own crontab line.
#
# Self-disarming for the same reason as udm-controlled-reboot.sh: a date-specific
# cron entry (`0 9 3 9 *`) would otherwise fire again next year.
#
# Arm (Alpuca), e.g. 09:00 on Sep 3:
#   ( crontab -l; echo '0 9 3 9 * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/sonos-multizone-oneshot.sh >> /Users/alpuca/logs/sonos-multizone-test.log 2>&1' ) | crontab -
#
# Cancel before it fires:
#   crontab -l | grep -v sonos-multizone-oneshot | crontab -
#
set -uo pipefail

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] [multizone-oneshot] $*"; }

crontab -l 2>/dev/null | grep -v 'sonos-multizone-oneshot' | crontab -
log "crontab entry removed — will not fire again"

ENV_FILE="$HOME/.unifi-snapshot.env"
[ -r "$ENV_FILE" ] || { log "ERROR: $ENV_FILE missing — aborting"; exit 1; }
set -a; . "$ENV_FILE"; set +a

log "starting full multi-zone test (12 phases, ~3 h)"
/opt/homebrew/bin/python3 /Users/alpuca/scripts/sonos-multizone-test.py "$@"
rc=$?
log "test exited rc=$rc"
exit $rc
