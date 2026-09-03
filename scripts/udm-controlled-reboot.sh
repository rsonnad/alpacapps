#!/usr/bin/env bash
#
# udm-controlled-reboot.sh — deliberate one-shot reboot of the UDM Pro (192.168.1.1)
# to prove that udm-boot.service really restores the Sonos kernel baseline at boot.
#
# Why a reboot: everything the Sonos fix depends on lives in the router kernel and
# is only re-applied when the router boots. The 2026-08-30 outage was exactly a
# reboot that nothing recovered from. A deliberate reboot at a quiet hour is the
# only honest test; waiting weeks for a natural one is not a test plan.
#
# Safety: the script DISARMS ITSELF FIRST by deleting its own crontab line. A
# date-specific cron entry (e.g. `0 3 3 9 *`) would otherwise fire again next year.
#
# Arm (Alpuca), e.g. for 03:00 on Sep 3:
#   ( crontab -l; echo '0 3 3 9 * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/udm-controlled-reboot.sh >> /Users/alpuca/logs/udm-reboot.log 2>&1' ) | crontab -
#
# Re-arm after it has fired: rm ~/.udm-controlled-reboot.done
# Afterwards the 15-min sonos-health collector captures the post-boot state; the
# Monday report flips "persistence UNPROVEN" to CONFIRMED or shows what came up wrong.
#
set -uo pipefail

UDM=192.168.1.1
ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] [udm-controlled-reboot] $*"; }

# 1. Disarm before doing anything else.
# DO NOT call `crontab` here. On macOS `crontab -` HANGS FOREVER when invoked
# from inside a cron job (verified 2026-09-03: two `crontab -` processes stuck
# 12h38m and 6h38m, both scripts frozen on this very line, so neither the reboot
# nor the test ever ran and neither entry disarmed). One-shot semantics come from
# a sentinel file instead; remove the crontab line from an interactive shell.
SENTINEL="$HOME/.udm-controlled-reboot.done"
if [ -e "$SENTINEL" ]; then
  log "sentinel $SENTINEL exists — already ran on $(cat "$SENTINEL" 2>/dev/null); exiting"
  exit 0
fi
date '+%Y-%m-%dT%H:%M:%S%z' > "$SENTINEL"
log "sentinel written — this will not run again until $SENTINEL is removed"

# 2. Credentials (same file the collector uses).
ENV_FILE="$HOME/.unifi-snapshot.env"
[ -r "$ENV_FILE" ] || { log "ERROR: $ENV_FILE missing — aborting, no reboot issued"; exit 1; }
set -a; . "$ENV_FILE"; set +a

SSH="sshpass -p $UDM_SSH_PASS ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no -o ConnectTimeout=10 root@$UDM"

# 3. Record what we are rebooting from.
PRE=$($SSH 'echo "uptime=$(cut -d" " -f1 /proc/uptime)s snoop=$(cat /sys/devices/virtual/net/br0/bridge/multicast_snooping) quer=$(cat /sys/devices/virtual/net/br0/bridge/multicast_querier) udm_boot=$(systemctl is-enabled udm-boot.service 2>&1 | head -1) fw=$(ubnt-device-info firmware 2>/dev/null)"' 2>&1)
log "pre-reboot: $PRE"
if ! echo "$PRE" | grep -q 'udm_boot=enabled'; then
  log "WARN: udm-boot.service is not enabled — rebooting anyway; --remediate will repair within one tick"
fi

# 4. Reboot. The SSH session drops as the box goes down; that is expected.
$SSH 'reboot' >/dev/null 2>&1 || true
log "reboot issued to $UDM — expect ~3 min WAN/WiFi outage"

# 5. Tell the human.
KEY=$(cat "$HOME/.config/resend/key" 2>/dev/null | tr -d '\n')
if [ -n "$KEY" ] && command -v jq >/dev/null; then
  BODY=$(jq -n \
    --arg from "notifications@alpacaplayhouse.com" \
    --arg to "rahulioson@gmail.com" \
    --arg subject "🔁 UDM Pro controlled reboot issued $(ts)" \
    --arg text "Deliberate reboot of the UDM Pro to test Sonos kernel-fix persistence.

Pre-reboot state: $PRE

What happens next: the 15-min sonos-health collector samples the post-boot kernel.
PASS  = low uptime with snoop=0 quer=0 udm_boot=enabled and no REMEDIATED line.
FAIL  = a REMEDIATED alert (the fix did not persist, but was re-applied within one tick).
Monday's weekly report will state the verdict under 'Reboot / persistence check'." \
    '{from:$from,to:[$to],subject:$subject,text:$text}')
  if curl -s -m 20 -X POST https://api.resend.com/emails \
       -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
       -H 'User-Agent: alpacapps-udm-reboot/1.0' -d "$BODY" | grep -q '"id"'; then
    log "notification email sent"
  else
    log "WARN: notification email failed"
  fi
fi
log "done"
