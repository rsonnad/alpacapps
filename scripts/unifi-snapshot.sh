#!/usr/bin/env bash
#
# unifi-snapshot.sh — capture UniFi config to Supabase (history/rollback record)
#
# Wrapper that pulls credentials from Bitwarden and runs unifi-snapshot.py.
#
# Usage:
#   ./scripts/unifi-snapshot.sh "snapshot name" [--notes "..."] [--stable] [--tags sonos,wifi,working]
#
# Required: bw CLI authenticated, sshpass, python3, ~/bin/bw-unlock
#
set -euo pipefail

cd "$(dirname "$0")/.."

export BW_SESSION="${BW_SESSION:-$(~/bin/bw-unlock 2>/dev/null)}"
[ -z "$BW_SESSION" ] && { echo "✗ bw-unlock failed"; exit 1; }

export UDM_SSH_PASS=$(/opt/homebrew/bin/bw get item "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null \
  | python3 -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='SSH Password']")
export UDM_WEB_PASS=$(/opt/homebrew/bin/bw get password "UniFi Dream Machine Pro — Network Gateway" --session "$BW_SESSION" 2>/dev/null)
export SUPA_TOKEN=$(/opt/homebrew/bin/bw get item "4febf188-93d8-4e74-b052-b428005949fe" --session "$BW_SESSION" 2>/dev/null \
  | python3 -c "import sys,json; item=json.load(sys.stdin); [print(f['value'],end='') for f in item.get('fields',[]) if f['name']=='Access Token']")

python3 ./scripts/unifi-snapshot.py "$@"
