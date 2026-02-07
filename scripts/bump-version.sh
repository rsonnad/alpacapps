#!/bin/bash
# bump-version.sh — Increment version number from DB, update all HTML files, write back to DB.
#
# Usage: ./scripts/bump-version.sh
#
# Version format: vYYMMDD.NN H:MMa/p
#   YYMMDD = date in Austin, TX timezone (America/Chicago)
#   NN     = zero-padded sequence number, starts at 01 each day
#   H:MMa/p = timestamp in Austin timezone (e.g., 8:04p)
#
# Flow:
#   1. Read current version from site_config table
#   2. Compute next version (bump NN if same day, reset to .01 if new day)
#   3. Find-and-replace the old version string in all HTML files
#   4. Write the new version back to the DB
#   5. Print the new version to stdout

set -euo pipefail

PSQL="/opt/homebrew/opt/libpq/bin/psql"
DB_URL="postgres://postgres.aphrrfprbixmhissnjfn:BirdBrain9gres%21@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Read current version from DB
CURRENT_VERSION=$($PSQL "$DB_URL" -t -A -c "SELECT version FROM site_config WHERE id = 1;")
if [ -z "$CURRENT_VERSION" ]; then
  echo "ERROR: Could not read version from site_config" >&2
  exit 1
fi

# Parse current version: vYYMMDD.NN
CURRENT_DATE="${CURRENT_VERSION:1:6}"   # e.g. "260206"
CURRENT_SEQ="${CURRENT_VERSION:8:2}"    # e.g. "14"

# 2. Compute today's date in Austin timezone
TODAY=$(TZ="America/Chicago" date +"%y%m%d")

if [ "$TODAY" = "$CURRENT_DATE" ]; then
  # Same day — increment sequence
  NEXT_SEQ=$(printf "%02d" $((10#$CURRENT_SEQ + 1)))
else
  # New day — reset to 01
  NEXT_SEQ="01"
fi

NEW_VERSION="v${TODAY}.${NEXT_SEQ}"

# Compute timestamp in Austin timezone (e.g., "8:04p" or "12:30a")
TIMESTAMP=$(TZ="America/Chicago" date +"%-I:%M%p" | sed 's/AM/a/;s/PM/p/')
DISPLAY_VERSION="${NEW_VERSION} ${TIMESTAMP}"

# 3. Replace ANY version string (v + 6 digits + . + 2 digits, optionally followed by timestamp) in all HTML files
cd "$PROJECT_ROOT"
VERSION_PATTERN='v[0-9]\{6\}\.[0-9]\{2\}\( [0-9]\{1,2\}:[0-9]\{2\}[ap]\)\{0,1\}'
find . -name "*.html" -not -path "./.git/*" -exec grep -l 'v[0-9]\{6\}\.[0-9]\{2\}' {} \; | while read -r file; do
  sed -i '' "s/$VERSION_PATTERN/$DISPLAY_VERSION/g" "$file"
done

# 4. Write new version to DB (store with timestamp)
$PSQL "$DB_URL" -c "UPDATE site_config SET version = '$DISPLAY_VERSION', updated_at = now() WHERE id = 1;" > /dev/null

# 5. Output new version
echo "$DISPLAY_VERSION"
