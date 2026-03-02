#!/usr/bin/env bash
#
# update-bedroom-codes.sh — Update bedroom access codes in the DB and email the assignee
#
# Usage (on DO droplet where SUPABASE_SERVICE_ROLE_KEY is available):
#   source /opt/bug-fixer/.env   # or any worker's .env
#   bash scripts/update-bedroom-codes.sh
#
# Or pass env inline:
#   SUPABASE_SERVICE_ROLE_KEY=ey... bash scripts/update-bedroom-codes.sh
#
# The script reads bedroom-codes.json for the list of rooms + codes + recipients.

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://aphrrfprbixmhissnjfn.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required — source a worker .env first}"

REST="$SUPABASE_URL/rest/v1"
FUNC="$SUPABASE_URL/functions/v1"

# ── Read config ──────────────────────────────────────────────────────
CONFIG_FILE="$(dirname "$0")/bedroom-codes.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: $CONFIG_FILE not found. Create it first (see template in script comments)."
  exit 1
fi

# Parse JSON config
RECIPIENTS=$(jq -r '.recipients[]' "$CONFIG_FILE")
ROOMS=$(jq -c '.rooms[]' "$CONFIG_FILE")

echo "=== Updating Bedroom Codes ==="

# ── Step 1: Update each room's access_code in the DB ─────────────────
while IFS= read -r room; do
  SPACE_ID=$(echo "$room" | jq -r '.space_id')
  SPACE_NAME=$(echo "$room" | jq -r '.name')
  NEW_CODE=$(echo "$room" | jq -r '.code')

  echo -n "  Updating $SPACE_NAME → $NEW_CODE ... "

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    "$REST/spaces?id=eq.$SPACE_ID" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"access_code\": \"$NEW_CODE\"}")

  if [[ "$HTTP_CODE" == "204" ]]; then
    echo "OK"
  else
    echo "FAILED (HTTP $HTTP_CODE)"
  fi
done <<< "$ROOMS"

# ── Step 2: Build the HTML table of codes ────────────────────────────
TABLE_HTML="<table style=\"width:100%;border-collapse:collapse;margin:16px 0;\">"
TABLE_HTML+="<tr style=\"background:#f2f0e8;\"><td style=\"padding:12px 16px;border:1px solid #e6e2d9;font-weight:600;\">Room</td><td style=\"padding:12px 16px;border:1px solid #e6e2d9;font-weight:600;\">Code</td></tr>"

TABLE_TEXT=""

while IFS= read -r room; do
  NAME=$(echo "$room" | jq -r '.name')
  CODE=$(echo "$room" | jq -r '.code')
  TABLE_HTML+="<tr><td style=\"padding:12px 16px;border:1px solid #e6e2d9;\">$NAME</td><td style=\"padding:12px 16px;border:1px solid #e6e2d9;font-size:18px;font-weight:700;letter-spacing:2px;\">$CODE</td></tr>"
  TABLE_TEXT+="$NAME: $CODE\n"
done <<< "$ROOMS"

TABLE_HTML+="</table>"

MESSAGE_HTML="<p>Here are the updated bedroom access codes for your reference:</p>${TABLE_HTML}<p>Please use these codes when accessing these rooms for cleaning and maintenance.</p><p>Thank you!</p>"
MESSAGE_TEXT="Here are the updated bedroom access codes:\n\n${TABLE_TEXT}\nPlease use these codes when accessing these rooms for cleaning and maintenance.\n\nThank you!"

# ── Step 3: Send email to each recipient ─────────────────────────────
echo ""
echo "=== Sending Notification Emails ==="

for RECIPIENT in $RECIPIENTS; do
  FIRST_NAME=$(echo "$RECIPIENT" | cut -d'@' -f1 | sed 's/.*/\u&/')

  echo -n "  Emailing $RECIPIENT ... "

  RESULT=$(curl -s -X POST "$FUNC/send-email" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg type "general_invitation" \
      --arg to "$RECIPIENT" \
      --arg subject "Updated Room Codes — Work Assignment" \
      --arg first_name "$FIRST_NAME" \
      --arg message "$MESSAGE_HTML" \
      --arg message_text "$MESSAGE_TEXT" \
      '{
        type: $type,
        to: $to,
        subject: $subject,
        data: {
          first_name: $first_name,
          subject: $subject,
          message: $message,
          message_text: $message_text
        }
      }')")

  if echo "$RESULT" | jq -e '.success' > /dev/null 2>&1; then
    echo "OK ($(echo "$RESULT" | jq -r '.id'))"
  else
    echo "FAILED: $RESULT"
  fi
done

echo ""
echo "=== Done ==="
