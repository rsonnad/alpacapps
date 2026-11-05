#!/usr/bin/env bash
# Runs on Phoenix (alpacapps-workers) every 7 minutes from a systemd timer.
# GitHub runs muse-sync.yml's own */10 cron only a few times a day, so this
# starts that workflow whenever a Muse or Grokbot repo's main has moved past
# what the live site was built from. Everything it reads is public; the only
# secret is a fine-grained token that can do nothing but start Actions runs on
# rsonnad/alpacapps. See devcontrol/devdocs/DEPLOY.md -> "Muse sync trigger".
set -euo pipefail

TOKEN_FILE=/etc/alpacapps-muse-sync.env      # holds ALPACAPPS_DISPATCH_TOKEN=...
STATE=/var/tmp/alpacapps-muse-sync.last      # last dispatch, to avoid repeats
RAW=https://raw.githubusercontent.com/rsonnad/alpacapps/main

if [ -z "${ALPACAPPS_DISPATCH_TOKEN:-}" ]; then
  echo "No ALPACAPPS_DISPATCH_TOKEN (expected in $TOKEN_FILE); nothing to do."
  exit 0
fi

live=$(curl -fsS --max-time 20 "https://alpacaplayhouse.com/_deployment.json?t=$(date +%s)")

moved=""
for area in muse bots botsy; do
  for repo in $(curl -fsS --max-time 20 "$RAW/$area-sources.json" | jq -r '.sources[].repo' | sort -u); do
    head=$(git ls-remote "https://github.com/$repo.git" refs/heads/main | cut -f1)
    built=$(jq -r --arg a "$area" --arg r "$repo" '.[$a][$r] // ""' <<<"$live")
    if [ -n "$head" ] && [ "$head" != "$built" ]; then moved+="$area:$repo@${head:0:10} "; fi
  done
done

[ -z "$moved" ] && exit 0

# A publish takes ~3 minutes; don't start another sync for the same commits
# within 15 minutes. muse-sync itself also skips if a publish is running.
now=$(date +%s)
if [ -f "$STATE" ]; then
  read -r last_time last_moved <"$STATE" || true
  if [ "${last_moved:-}" = "$moved" ] && [ $((now - ${last_time:-0})) -lt 900 ]; then
    echo "Already started a sync for: $moved"
    exit 0
  fi
fi

echo "Moved: $moved- starting muse-sync.yml"
curl -fsS --max-time 20 -X POST \
  -H "Authorization: Bearer $ALPACAPPS_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/rsonnad/alpacapps/actions/workflows/muse-sync.yml/dispatches \
  -d '{"ref":"main"}'
echo "$now $moved" >"$STATE"
