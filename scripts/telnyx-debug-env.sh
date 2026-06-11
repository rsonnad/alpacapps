#!/usr/bin/env bash
# Print or use AlpacApps Telnyx debugging credentials without storing them in git.
#
# Usage:
#   MGMT_TOKEN=sbp_... ./scripts/telnyx-debug-env.sh exports
#   eval "$(MGMT_TOKEN=sbp_... ./scripts/telnyx-debug-env.sh exports)"
#   MGMT_TOKEN=sbp_... ./scripts/telnyx-debug-env.sh deliveries

set -euo pipefail

PROJECT_REF="${ALPACAPPS_SUPABASE_PROJECT_REF:-aphrrfprbixmhissnjfn}"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
MODE="${1:-exports}"

if [ -z "${MGMT_TOKEN:-}" ]; then
  if command -v bw >/dev/null 2>&1; then
    MGMT_TOKEN="$(bw get item "fd5b3ae7-d6a7-4e57-8475-b410007ea3a7" 2>/dev/null \
      | python3 -c "import sys,json; item=json.load(sys.stdin); print(next(f['value'] for f in item.get('fields', []) if f['name'] == 'Management API Token'))" 2>/dev/null || true)"
  fi
fi

if [ -z "${MGMT_TOKEN:-}" ]; then
  cat >&2 <<'EOF'
Missing MGMT_TOKEN.

Set it from Bitwarden first:
  export BW_SESSION=$(~/bin/bw-unlock)
  export MGMT_TOKEN=$(bw get item "fd5b3ae7-d6a7-4e57-8475-b410007ea3a7" \
    | python3 -c "import sys,json; item=json.load(sys.stdin); print(next(f['value'] for f in item.get('fields', []) if f['name'] == 'Management API Token'))")
EOF
  exit 1
fi

query_telnyx_config() {
  curl -sS -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${MGMT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"query":"select api_key, phone_number, messaging_profile_id from telnyx_config where id = 1"}'
}

CONFIG_JSON="$(query_telnyx_config)"

TELNYX_API_KEY="$(printf '%s' "$CONFIG_JSON" | python3 -c "import sys,json; rows=json.load(sys.stdin); print(rows[0]['api_key'])")"
TELNYX_PHONE_NUMBER="$(printf '%s' "$CONFIG_JSON" | python3 -c "import sys,json; rows=json.load(sys.stdin); print(rows[0]['phone_number'])")"
TELNYX_MESSAGING_PROFILE_ID="$(printf '%s' "$CONFIG_JSON" | python3 -c "import sys,json; rows=json.load(sys.stdin); print(rows[0]['messaging_profile_id'])")"
TELNYX_WEBHOOK_URL="${SUPABASE_URL}/functions/v1/telnyx-webhook"

case "$MODE" in
  exports)
    printf 'export ALPACAPPS_SUPABASE_PROJECT_REF=%q\n' "$PROJECT_REF"
    printf 'export ALPACAPPS_SUPABASE_URL=%q\n' "$SUPABASE_URL"
    printf 'export ALPACAPPS_SUPABASE_MGMT_TOKEN=%q\n' "$MGMT_TOKEN"
    printf 'export TELNYX_API_KEY=%q\n' "$TELNYX_API_KEY"
    printf 'export TELNYX_PHONE_NUMBER=%q\n' "$TELNYX_PHONE_NUMBER"
    printf 'export TELNYX_MESSAGING_PROFILE_ID=%q\n' "$TELNYX_MESSAGING_PROFILE_ID"
    printf 'export TELNYX_WEBHOOK_URL=%q\n' "$TELNYX_WEBHOOK_URL"
    ;;
  deliveries)
    curl --globoff -sS "https://api.telnyx.com/v2/webhook_deliveries?filter[event_type]=message.received&page[size]=10" \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      | python3 -c 'import sys,json; data=json.load(sys.stdin).get("data", []); [print(f"{d["started_at"]}\t{d["status"]}\t{d.get("attempts", [{}])[0].get("http",{}).get("response",{}).get("status")}\t{d.get("webhook",{}).get("payload",{}).get("from",{}).get("phone_number","")}\t{d.get("webhook",{}).get("payload",{}).get("id","")}\t{d.get("webhook",{}).get("payload",{}).get("text","")!r}") for d in data]'
    ;;
  *)
    echo "Usage: $0 [exports|deliveries]" >&2
    exit 2
    ;;
esac
