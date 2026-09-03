#!/usr/bin/env bash
#
# sonos-multizone-oneshot.sh — run the full multi-zone test once, at a scheduled
# time. One-shot semantics come from a sentinel file, NOT crontab self-editing.
#
# Self-disarming for the same reason as udm-controlled-reboot.sh: a date-specific
# cron entry (`0 9 3 9 *`) would otherwise fire again next year.
#
# Arm (Alpuca), e.g. 09:00 on Sep 3:
#   ( crontab -l; echo '0 9 3 9 * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/sonos-multizone-oneshot.sh >> /Users/alpuca/logs/sonos-multizone-test.log 2>&1' ) | crontab -
#
# Cancel before it fires (from an INTERACTIVE shell, never from cron):
#   crontab -l | grep -v sonos-multizone-oneshot | crontab -
# Re-run after it has fired: rm ~/.sonos-multizone-oneshot.done
#
set -uo pipefail

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] [multizone-oneshot] $*"; }

# DO NOT call `crontab` here. On macOS `crontab -` HANGS FOREVER when invoked
# from inside a cron job (verified 2026-09-03: two `crontab -` processes stuck
# 12h38m and 6h38m, both scripts frozen on this very line, so neither the reboot
# nor the test ever ran and neither entry disarmed). One-shot semantics come from
# a sentinel file instead; remove the crontab line from an interactive shell.
SENTINEL="$HOME/.sonos-multizone-oneshot.done"
if [ -e "$SENTINEL" ]; then
  log "sentinel $SENTINEL exists — already ran on $(cat "$SENTINEL" 2>/dev/null); exiting"
  exit 0
fi
date '+%Y-%m-%dT%H:%M:%S%z' > "$SENTINEL"
log "sentinel written — this will not run again until $SENTINEL is removed"

ENV_FILE="$HOME/.unifi-snapshot.env"
[ -r "$ENV_FILE" ] || { log "ERROR: $ENV_FILE missing — aborting"; exit 1; }
set -a; . "$ENV_FILE"; set +a

log "starting full multi-zone test (12 phases, ~3 h)"
/opt/homebrew/bin/python3 /Users/alpuca/scripts/sonos-multizone-test.py "$@"
rc=$?
log "test exited rc=$rc"
exit $rc
