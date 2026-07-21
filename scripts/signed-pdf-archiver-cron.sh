#!/bin/bash
# Cron wrapper for the signed-document PDF archiver.
#
# Lives in /Users/alpuca/scripts/ rather than the repo checkout under
# ~/Documents: macOS TCC blocks cron from executing anything under Documents
# ("Operation not permitted"), even though the same script runs fine over SSH.
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
LOG=/Users/alpuca/logs/signed-pdf-archiver.log
LOCK=/tmp/signed-pdf-archiver.lock

# Single-flight: a large backfill can outlast the poll interval, and two Chrome
# renders racing the same queue row would upload the same PDF twice. macOS has
# no flock(1), so use mkdir — atomic on every POSIX filesystem.
if ! mkdir "$LOCK" 2>/dev/null; then
  # Clear a lock orphaned by a reboot or a killed run (older than 1 hour).
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

/opt/homebrew/bin/python3 /Users/alpuca/scripts/signed-pdf-archiver.py >> "$LOG" 2>&1

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then
  tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
