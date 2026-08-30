#!/bin/bash
# Cron wrapper for the Garmin Forerunner 145/245 deal watcher.
#
# Lives in /Users/alpuca/scripts/ rather than the repo checkout under
# ~/Documents: macOS TCC blocks cron from executing anything under Documents
# ("Operation not permitted"), even though the same script runs fine over SSH.
#
# Alpuca is America/Chicago. 8:00am Eastern = 7:00am Central; 6:00pm Eastern =
# 5:00pm Central (the offset is 1 hour year-round because both zones observe DST).
#
#   0 7  * * * PATH=... /Users/alpuca/scripts/garmin-watch-deal-watch.sh morning >> /Users/alpuca/logs/garmin-watch-deal-watch.log 2>&1
#   0 17 * * * PATH=... /Users/alpuca/scripts/garmin-watch-deal-watch.sh evening >> /Users/alpuca/logs/garmin-watch-deal-watch.log 2>&1
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export HOME=/Users/alpuca
export GROK_DELEGATE="${GROK_DELEGATE:-/Users/alpuca/sponic/infra/bin/grok-delegate}"

MODE="${1:-morning}"
LOG=/Users/alpuca/logs/garmin-watch-deal-watch.log
LOCK=/tmp/garmin-watch-deal-watch.lock
PY=/Users/alpuca/scripts/garmin-watch-deal-watch.py

mkdir -p /Users/alpuca/logs /Users/alpuca/.garmin-watch-deal-watch

# Single-flight. Grok can run 10-20 minutes; a second tick must not overlap.
# macOS has no flock(1), so use mkdir — atomic on every POSIX filesystem.
if ! mkdir "$LOCK" 2>/dev/null; then
  # Clear a lock orphaned by a reboot or a killed run (older than 40 minutes).
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +40 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] skip: lock held ($LOCK)"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

/opt/homebrew/bin/python3 "$PY" "$MODE"
RC=$?

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then
  tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
exit "$RC"
