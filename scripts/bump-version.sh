#!/bin/bash
# bump-version.sh — Atomically increment version number in DB, update all HTML files.
#
# Usage: ./scripts/bump-version.sh
#
# Version format: vYYMMDD.NN H:MMa/p
#   YYMMDD = date in Austin, TX timezone (America/Chicago)
#   NN     = zero-padded sequence number, starts at 01 each day
#   H:MMa/p = timestamp in Austin timezone (e.g., 8:04p)
#
# Flow:
#   1. Atomically increment version in DB using UPDATE ... RETURNING (no race conditions)
#   2. Find-and-replace the old version string in all HTML files
#   3. Print the new version to stdout
#
# The SQL does the increment in a single atomic statement:
#   - If same day: bump sequence number
#   - If new day: reset to .01

set -euo pipefail

# Auto-detect psql path (macOS Homebrew vs Linux)
if [ -x "/opt/homebrew/opt/libpq/bin/psql" ]; then
  PSQL="/opt/homebrew/opt/libpq/bin/psql"
elif command -v psql &>/dev/null; then
  PSQL="psql"
else
  echo "ERROR: psql not found" >&2
  exit 1
fi

DB_URL="postgres://postgres.aphrrfprbixmhissnjfn:BirdBrain9gres%21@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Compute today's date and timestamp in Austin timezone
TODAY=$(TZ="America/Chicago" date +"%y%m%d")
TIMESTAMP=$(TZ="America/Chicago" date +"%-I:%M%p" | sed 's/AM/a/;s/PM/p/')

# 1. Atomically increment version in DB and return the new value.
#    This is a single UPDATE statement — no race condition between read and write.
#    Logic:
#      - Extract the date part (chars 2-7) and sequence part (chars 9-10) from current version
#      - If date matches today: increment sequence
#      - If new day: reset to 01
#    Returns the new display version (e.g., "v260207.48 11:43a")
NEW_DISPLAY_VERSION=$($PSQL "$DB_URL" -t -A --no-psqlrc -c "
  UPDATE site_config
  SET
    version = CASE
      WHEN substring(version from 2 for 6) = '${TODAY}'
      THEN 'v${TODAY}.' || lpad((substring(version from 9 for 2)::int + 1)::text, 2, '0') || ' ${TIMESTAMP}'
      ELSE 'v${TODAY}.01 ${TIMESTAMP}'
    END,
    updated_at = now()
  WHERE id = 1
  RETURNING version;
" | head -1)

if [ -z "$NEW_DISPLAY_VERSION" ]; then
  echo "ERROR: Failed to bump version in site_config" >&2
  exit 1
fi

# 2. Replace ANY version string in all HTML files
cd "$PROJECT_ROOT"
VERSION_PATTERN='v[0-9]\{6\}\.[0-9]\{2\}\( [0-9]\{1,2\}:[0-9]\{2\}[ap]\)\{0,1\}'

# Detect sed flavor: macOS BSD vs GNU
IS_GNU_SED=false
if sed --version 2>/dev/null | grep -q 'GNU'; then
  IS_GNU_SED=true
fi

find . -name "*.html" -not -path "./.git/*" -exec grep -l 'v[0-9]\{6\}\.[0-9]\{2\}' {} \; | while read -r file; do
  if [ "$IS_GNU_SED" = true ]; then
    sed -i "s/$VERSION_PATTERN/$NEW_DISPLAY_VERSION/g" "$file"
  else
    sed -i '' "s/$VERSION_PATTERN/$NEW_DISPLAY_VERSION/g" "$file"
  fi
done

# 3. Generate version.json with commit hash + branch inclusion info
#    HEAD at this point includes all merged branches (bump commit comes after).
COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
FULL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
ISO_TIMESTAMP=$(TZ="America/Chicago" date -Iseconds 2>/dev/null || TZ="America/Chicago" date +"%Y-%m-%dT%H:%M:%S%z")

# Fetch latest remote refs so branch lists are current
git fetch --prune origin 2>/dev/null || true

# Included: remote branches already merged into HEAD
INCLUDED_JSON="[]"
if git rev-parse HEAD &>/dev/null; then
  INCLUDED_JSON=$(git branch -r --merged HEAD 2>/dev/null \
    | grep -v 'HEAD\|main$\|master$' \
    | sed 's|origin/||;s|^[[:space:]]*||' \
    | sort \
    | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
fi

# Pending: remote branches NOT yet merged into HEAD
PENDING_JSON="[]"
if git rev-parse HEAD &>/dev/null; then
  PENDING_JSON=$(git branch -r --no-merged HEAD 2>/dev/null \
    | grep -v 'HEAD\|main$\|master$' \
    | sed 's|origin/||;s|^[[:space:]]*||' \
    | sort \
    | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
fi

cat > "$PROJECT_ROOT/version.json" << ENDJSON
{
  "version": "$NEW_DISPLAY_VERSION",
  "commit": "$COMMIT_HASH",
  "full_commit": "$FULL_HASH",
  "timestamp": "$ISO_TIMESTAMP",
  "included": $INCLUDED_JSON,
  "pending": $PENDING_JSON
}
ENDJSON

# 4. Output new version
echo "$NEW_DISPLAY_VERSION"
