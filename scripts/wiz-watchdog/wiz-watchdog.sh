#!/bin/bash
# wiz-watchdog — detect WiZ bulbs stuck "unavailable" and reload their HA config entries.
#
# Why: WiZ bulbs frequently drop "unavailable" in HA. When a bulb in a group
# (e.g. light.master_bathroom_lights) is unavailable, Alexa group commands
# ("Alexa, turn off the master bath lights") hang or partially fail.
#
# What: every run, finds light.smart_* entities in state=unavailable and calls
# homeassistant.reload_config_entry on each. HA re-attempts the bulb's setup;
# for transient network glitches the bulb recovers within ~30 seconds. For
# hard failures (bulb powered off, IP collision) the metrics in Supabase
# show the pattern so it's clear a physical fix is needed.
#
# Cron (every 5 min):
#   */5 * * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/wiz-watchdog.sh >> /Users/alpuca/logs/wiz-watchdog.log 2>&1
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

HA_URL="${HA_URL:-http://192.168.1.39:8123}"
HA_TOKEN_FILE="$HOME/.ha_llat"
[ -f "$HA_TOKEN_FILE" ] && HA_TOKEN=$(head -1 "$HA_TOKEN_FILE")
# Fallback: extract from ~/ha-cmd.sh which has it hardcoded
if [ -z "${HA_TOKEN:-}" ] && [ -f "$HOME/ha-cmd.sh" ]; then
  HA_TOKEN=$(grep -E '^TOKEN=' "$HOME/ha-cmd.sh" | head -1 | cut -d'"' -f2)
fi
[ -z "${HA_TOKEN:-}" ] && { echo "[$(date '+%F %T')] ERROR: no HA token"; exit 1; }

# Supabase for metrics (read service-role key from existing env file)
SB_KEY=""
ENVFILE="$HOME/.env-alpacapps"
[ -f "$ENVFILE" ] && SB_KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$ENVFILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SB_URL="https://aphrrfprbixmhissnjfn.supabase.co"

TS="[$(date '+%Y-%m-%d %H:%M:%S')]"

UNAVAILABLE=$(curl -s --max-time 10 -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states" \
  | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
for e in d:
    eid = e.get('entity_id','')
    if eid.startswith('light.smart_') and e.get('state') == 'unavailable':
        fn = e.get('attributes',{}).get('friendly_name','-')
        print(f\"{eid}\t{fn}\")
")

if [ -z "$UNAVAILABLE" ]; then
  echo "$TS All WiZ bulbs healthy"
  exit 0
fi

COUNT=$(echo "$UNAVAILABLE" | wc -l | tr -d ' ')
echo "$TS Found $COUNT unavailable WiZ bulb(s); reloading their config entries"

FIXED=0; FAILED=0
while IFS=$'\t' read -r eid fname; do
  [ -z "$eid" ] && continue
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST \
    -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
    -d "{\"entity_id\":\"$eid\"}" \
    "$HA_URL/api/services/homeassistant/reload_config_entry")
  if [ "$HTTP" = "200" ]; then
    echo "$TS   reloaded $eid ($fname)"
    FIXED=$((FIXED+1))
  else
    echo "$TS   FAILED $eid ($fname): HTTP $HTTP"
    FAILED=$((FAILED+1))
  fi
  sleep 0.3
done <<< "$UNAVAILABLE"

echo "$TS Done: reload-attempts=$FIXED failed=$FAILED total-unavailable=$COUNT"

# Optional metric to Supabase (best-effort)
if [ -n "$SB_KEY" ]; then
  PAYLOAD=$(printf '{"target":"alpuca","command":"wiz_watchdog","status":"completed","requested_by":"cron","completed_at":"%s","result":{"unavailable_count":%d,"reloads_attempted":%d,"reload_failures":%d}}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COUNT" "$FIXED" "$FAILED")
  curl -s --max-time 5 -X POST \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -H "Content-Type: application/json" \
    -d "$PAYLOAD" "$SB_URL/rest/v1/system_commands" >/dev/null 2>&1 || true
fi
