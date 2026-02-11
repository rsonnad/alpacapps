#!/bin/bash
# bump-version.sh — record one release event per push to main, update HTML, write version.json.
#
# Usage:
#   ./scripts/bump-version.sh [--model MODEL_CODE] [--source SOURCE]
#                             [--push-sha SHA] [--actor LOGIN] [--actor-id ID]
#                             [--branch BRANCH] [--before-sha SHA] [--after-sha SHA]
#                             [--pushed-at ISO8601]
#
# This script is intended for CI on push to main. It is idempotent per push SHA:
# repeated runs for the same SHA return the same release sequence/version.

set -euo pipefail

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

json_escape() {
  printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Parse arguments
MODEL_CODE="${AAP_MODEL_CODE:-}"
SOURCE="${RELEASE_SOURCE:-}"
PUSH_SHA="${RELEASE_PUSH_SHA:-}"
ACTOR_LOGIN="${RELEASE_ACTOR_LOGIN:-}"
ACTOR_ID="${RELEASE_ACTOR_ID:-}"
BRANCH_NAME="${RELEASE_BRANCH:-}"
COMPARE_FROM_SHA="${RELEASE_COMPARE_FROM_SHA:-}"
COMPARE_TO_SHA="${RELEASE_COMPARE_TO_SHA:-}"
PUSHED_AT="${RELEASE_PUSHED_AT:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --model) MODEL_CODE="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --push-sha) PUSH_SHA="$2"; shift 2 ;;
    --actor) ACTOR_LOGIN="$2"; shift 2 ;;
    --actor-id) ACTOR_ID="$2"; shift 2 ;;
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --before-sha) COMPARE_FROM_SHA="$2"; shift 2 ;;
    --after-sha) COMPARE_TO_SHA="$2"; shift 2 ;;
    --pushed-at) PUSHED_AT="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/bump-version.sh [--model MODEL_CODE] [--source SOURCE] [--push-sha SHA] [--actor LOGIN] [--actor-id ID] [--branch BRANCH] [--before-sha SHA] [--after-sha SHA] [--pushed-at ISO8601]" >&2
      exit 1
      ;;
  esac
done

# Auto-detect psql path (macOS Homebrew vs Linux)
if [ -x "/opt/homebrew/opt/libpq/bin/psql" ]; then
  PSQL="/opt/homebrew/opt/libpq/bin/psql"
elif command -v psql &>/dev/null; then
  PSQL="psql"
else
  echo "ERROR: psql not found" >&2
  exit 1
fi

DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "ERROR: SUPABASE_DB_URL is required" >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -z "$PUSH_SHA" ]; then
  PUSH_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
fi
if [ -z "$COMPARE_TO_SHA" ]; then
  COMPARE_TO_SHA="$PUSH_SHA"
fi
if [ -z "$BRANCH_NAME" ]; then
  BRANCH_NAME=$(git branch --show-current 2>/dev/null || echo "main")
fi
if [ -z "$ACTOR_LOGIN" ]; then
  ACTOR_LOGIN=$(git log -1 --pretty='%an' 2>/dev/null || echo "unknown")
fi
if [ -z "$SOURCE" ]; then
  SOURCE="unknown"
fi
if [ -z "$PUSHED_AT" ]; then
  PUSHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
fi

# Infer model from branch name if not explicitly provided.
if [ -z "$MODEL_CODE" ]; then
  case "$BRANCH_NAME" in
    claude/*) MODEL_CODE="claude" ;;
    gemini/*) MODEL_CODE="gemini" ;;
    gpt/*) MODEL_CODE="gpt" ;;
    cursor/*) MODEL_CODE="cursor" ;;
    *) MODEL_CODE="" ;;
  esac
fi

# Local machine name for metadata
MACHINE_NAME="${AAP_MACHINE_NAME:-}"
if [ -z "$MACHINE_NAME" ] && [ -f "$PROJECT_ROOT/.machine-name" ]; then
  MACHINE_NAME=$(tr -d '\r' < "$PROJECT_ROOT/.machine-name" | head -n 1)
fi

# Gather exact commits included in this push range (in chronological order).
FIXES_JSON="[]"
CHANGE_ENTRIES=""
RANGE_SPEC=""
if [ -n "$COMPARE_FROM_SHA" ] && [ "$COMPARE_FROM_SHA" != "0000000000000000000000000000000000000000" ]; then
  RANGE_SPEC="$COMPARE_FROM_SHA..$COMPARE_TO_SHA"
elif [ -n "$COMPARE_TO_SHA" ]; then
  RANGE_SPEC="$COMPARE_TO_SHA~1..$COMPARE_TO_SHA"
fi

if [ -n "$RANGE_SPEC" ]; then
  LOG_LINES=$(git log --reverse --pretty=format:'%H%x09%h%x09%an%x09%ae%x09%cI%x09%s' "$RANGE_SPEC" 2>/dev/null || true)
else
  LOG_LINES=""
fi

if [ -n "$LOG_LINES" ]; then
  while IFS=$'\t' read -r sha short author_name author_email committed_at subject; do
    [ -z "$sha" ] && continue
    esc_sha=$(json_escape "$sha")
    esc_short=$(json_escape "$short")
    esc_author_name=$(json_escape "$author_name")
    esc_author_email=$(json_escape "$author_email")
    esc_committed_at=$(json_escape "$committed_at")
    esc_subject=$(json_escape "$subject")
    [ -n "$CHANGE_ENTRIES" ] && CHANGE_ENTRIES="$CHANGE_ENTRIES,"
    CHANGE_ENTRIES="$CHANGE_ENTRIES{\"sha\":\"$esc_sha\",\"short\":\"$esc_short\",\"author_name\":\"$esc_author_name\",\"author_email\":\"$esc_author_email\",\"committed_at\":\"$esc_committed_at\",\"message\":\"$esc_subject\"}"
  done <<< "$LOG_LINES"
fi
[ -n "$CHANGE_ENTRIES" ] && FIXES_JSON="[$CHANGE_ENTRIES]"

# 1) Record idempotent release event in DB and retrieve canonical sequence/version.
SAFE_PUSH_SHA=$(sql_escape "$PUSH_SHA")
SAFE_BRANCH=$(sql_escape "$BRANCH_NAME")
SAFE_COMPARE_FROM=$(sql_escape "$COMPARE_FROM_SHA")
SAFE_COMPARE_TO=$(sql_escape "$COMPARE_TO_SHA")
SAFE_PUSHED_AT=$(sql_escape "$PUSHED_AT")
SAFE_ACTOR_LOGIN=$(sql_escape "$ACTOR_LOGIN")
SAFE_ACTOR_ID=$(sql_escape "$ACTOR_ID")
SAFE_SOURCE=$(sql_escape "$SOURCE")
SAFE_MODEL_CODE=$(sql_escape "$MODEL_CODE")
SAFE_MACHINE_NAME=$(sql_escape "$MACHINE_NAME")
SAFE_METADATA=$(sql_escape "{\"workflow\":\"bump-version.sh\"}")
SAFE_FIXES_JSON=$(sql_escape "$FIXES_JSON")

RELEASE_ROW=$($PSQL "$DB_URL" -t -A --no-psqlrc -F $'\t' -c "
  SELECT
    seq::text,
    display_version,
    pushed_at::text,
    actor_login,
    source
  FROM record_release_event(
    '$SAFE_PUSH_SHA',
    '$SAFE_BRANCH',
    NULLIF('$SAFE_COMPARE_FROM', ''),
    NULLIF('$SAFE_COMPARE_TO', ''),
    '$SAFE_PUSHED_AT'::timestamptz,
    '$SAFE_ACTOR_LOGIN',
    NULLIF('$SAFE_ACTOR_ID', ''),
    '$SAFE_SOURCE',
    NULLIF('$SAFE_MODEL_CODE', ''),
    NULLIF('$SAFE_MACHINE_NAME', ''),
    '$SAFE_METADATA'::jsonb,
    '$SAFE_FIXES_JSON'::jsonb
  );
" | head -1)

if [ -z "$RELEASE_ROW" ]; then
  echo "ERROR: Failed to record release event" >&2
  exit 1
fi

RELEASE_SEQ=$(echo "$RELEASE_ROW" | awk -F $'\t' '{print $1}')
NEW_DISPLAY_VERSION=$(echo "$RELEASE_ROW" | awk -F $'\t' '{print $2}')
RELEASE_PUSHED_AT=$(echo "$RELEASE_ROW" | awk -F $'\t' '{print $3}')
RELEASE_ACTOR=$(echo "$RELEASE_ROW" | awk -F $'\t' '{print $4}')
RELEASE_SOURCE=$(echo "$RELEASE_ROW" | awk -F $'\t' '{print $5}')

# Keep existing single-row site_config.version in sync for legacy readers.
$PSQL "$DB_URL" -t -A --no-psqlrc -c "
  UPDATE site_config
  SET version = '$(sql_escape "$NEW_DISPLAY_VERSION")', updated_at = now()
  WHERE id = 1;
" >/dev/null 2>&1 || true

# 2) Replace version string in all HTML files.
VERSION_PATTERN='\(v[0-9]\{6\}\.[0-9]\{2\}\( [0-9]\{1,2\}:[0-9]\{2\}[ap]\)\{0,1\}\|r[0-9]\{9\}\)'
IS_GNU_SED=false
if sed --version 2>/dev/null | grep -q 'GNU'; then
  IS_GNU_SED=true
fi

find . -name "*.html" -not -path "./.git/*" -exec grep -l '\(v[0-9]\{6\}\.[0-9]\{2\}\|r[0-9]\{9\}\)' {} \; | while read -r file; do
  if [ "$IS_GNU_SED" = true ]; then
    sed -i "s/$VERSION_PATTERN/$NEW_DISPLAY_VERSION/g" "$file"
  else
    sed -i '' "s/$VERSION_PATTERN/$NEW_DISPLAY_VERSION/g" "$file"
  fi
done

# 3) Generate version.json from canonical release data.
COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
FULL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
ISO_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

CHANGES_JSON="[]"
if [ -n "$CHANGE_ENTRIES" ]; then
  CHANGES_JSON="[$CHANGE_ENTRIES]"
fi

SAFE_JSON_VERSION=$(json_escape "$NEW_DISPLAY_VERSION")
SAFE_JSON_MODEL=$(json_escape "$MODEL_CODE")
SAFE_JSON_MACHINE=$(json_escape "$MACHINE_NAME")
SAFE_JSON_COMMIT=$(json_escape "$COMMIT_HASH")
SAFE_JSON_FULL_COMMIT=$(json_escape "$FULL_HASH")
SAFE_JSON_TIMESTAMP=$(json_escape "$ISO_TIMESTAMP")
SAFE_JSON_PUSH_SHA=$(json_escape "$PUSH_SHA")
SAFE_JSON_BRANCH=$(json_escape "$BRANCH_NAME")
SAFE_JSON_COMPARE_FROM=$(json_escape "$COMPARE_FROM_SHA")
SAFE_JSON_COMPARE_TO=$(json_escape "$COMPARE_TO_SHA")
SAFE_JSON_RELEASE_PUSHED_AT=$(json_escape "$RELEASE_PUSHED_AT")
SAFE_JSON_RELEASE_ACTOR=$(json_escape "$RELEASE_ACTOR")
SAFE_JSON_RELEASE_SOURCE=$(json_escape "$RELEASE_SOURCE")

cat > "$PROJECT_ROOT/version.json" << ENDJSON
{
  "version": "$SAFE_JSON_VERSION",
  "model": "$SAFE_JSON_MODEL",
  "machine": "$SAFE_JSON_MACHINE",
  "commit": "$SAFE_JSON_COMMIT",
  "full_commit": "$SAFE_JSON_FULL_COMMIT",
  "timestamp": "$SAFE_JSON_TIMESTAMP",
  "changes": $CHANGES_JSON,
  "release": {
    "seq": $RELEASE_SEQ,
    "display_version": "$SAFE_JSON_VERSION",
    "push_sha": "$SAFE_JSON_PUSH_SHA",
    "branch": "$SAFE_JSON_BRANCH",
    "compare_from_sha": "$SAFE_JSON_COMPARE_FROM",
    "compare_to_sha": "$SAFE_JSON_COMPARE_TO",
    "pushed_at": "$SAFE_JSON_RELEASE_PUSHED_AT",
    "actor_login": "$SAFE_JSON_RELEASE_ACTOR",
    "source": "$SAFE_JSON_RELEASE_SOURCE"
  }
}
ENDJSON

# 4) Output canonical version.
if [ -n "$MODEL_CODE" ]; then
  echo "$NEW_DISPLAY_VERSION  [$MODEL_CODE]"
else
  echo "$NEW_DISPLAY_VERSION"
fi
