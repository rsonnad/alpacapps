#!/bin/bash
# bump-version.sh — Atomically increment version number in DB, update all HTML files.
#
# Usage: ./scripts/bump-version.sh [--model MODEL_CODE]
#
# Options:
#   --model MODEL_CODE   AI model that created this version (e.g., o4.6, g2.5, s4.0)
#                        If not provided, infers from branch name pattern or defaults to "unknown"
#
# Version format: vYYMMDD.NN H:MMa/p
#   YYMMDD = date in Austin, TX timezone (America/Chicago)
#   NN     = zero-padded sequence number, starts at 01 each day
#   H:MMa/p = timestamp in Austin timezone (e.g., 8:04p)
#
# Flow:
#   1. Atomically increment version in DB using UPDATE ... RETURNING (no race conditions)
#   2. Find-and-replace the old version string in all HTML files
#   3. Generate version.json with model tracking info
#   4. Print the new version to stdout
#
# The SQL does the increment in a single atomic statement:
#   - If same day: bump sequence number
#   - If new day: reset to .01

set -euo pipefail

# Parse arguments
MODEL_CODE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --model)
      MODEL_CODE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/bump-version.sh [--model MODEL_CODE]" >&2
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

DB_URL="postgres://postgres.aphrrfprbixmhissnjfn:BirdBrain9gres%21@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Local machine name for version metadata (prefer env var)
MACHINE_NAME="${AAP_MACHINE_NAME:-}"
if [ -z "$MACHINE_NAME" ] && [ -f "$PROJECT_ROOT/.machine-name" ]; then
  MACHINE_NAME=$(cat "$PROJECT_ROOT/.machine-name" | tr -d '\r' | head -n 1)
fi
SAFE_MACHINE_NAME=$(echo "$MACHINE_NAME" | sed 's/"/\\"/g')

# Infer model from branch name if not explicitly provided
if [ -z "$MODEL_CODE" ]; then
  CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  case "$CURRENT_BRANCH" in
    claude/*)  MODEL_CODE="claude" ;;
    gemini/*)  MODEL_CODE="gemini" ;;
    gpt/*)     MODEL_CODE="gpt" ;;
    cursor/*)  MODEL_CODE="cursor" ;;
    *)         MODEL_CODE="" ;;  # Will show as empty if truly unknown
  esac
fi

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
  INCLUDED_RAW=$(git branch -r --merged HEAD 2>/dev/null | grep -v 'HEAD\|main$\|master$' || true)
  if [ -n "$INCLUDED_RAW" ]; then
    INCLUDED_JSON=$(echo "$INCLUDED_RAW" \
      | sed 's|^[[:space:]]*||;s|^origin/||' \
      | sort \
      | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
  fi
fi

# Pending: remote branches NOT yet merged into HEAD
PENDING_JSON="[]"
if git rev-parse HEAD &>/dev/null; then
  PENDING_RAW=$(git branch -r --no-merged HEAD 2>/dev/null | grep -v 'HEAD\|main$\|master$' || true)
  if [ -n "$PENDING_RAW" ]; then
    PENDING_JSON=$(echo "$PENDING_RAW" \
      | sed 's|^[[:space:]]*||;s|^origin/||' \
      | sort \
      | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
  fi
fi

# 4. Gather recent changes (non-merge, non-bump commits from last 48h)
CHANGES_JSON=$(git log --oneline --no-merges --since="48 hours ago" 2>/dev/null \
  | grep -v "chore: bump version\|Bump version\|fix: \[Follow-up\]" \
  | head -15 \
  | awk -F' ' '{
    hash=$1; $1=""; msg=substr($0,2);
    gsub(/"/, "\\\"", msg);
    printf "%s{\"hash\":\"%s\",\"msg\":\"%s\"}", (NR>1?",":""), hash, msg
  }' \
  | awk 'BEGIN{printf "["} {printf "%s", $0} END{printf "]"}')
[ -z "$CHANGES_JSON" ] && CHANGES_JSON="[]"

# 5. Gather bug fix details from DB — map branch UUID prefix → diagnosis
#    Extract diagnosis from fix_summary JSON embedded in Claude Code output
BUGFIXES_JSON="{}"
if [ "$INCLUDED_JSON" != "[]" ]; then
  # Extract bugfix branch UUIDs (first 8 chars of the UUID in branch name)
  BUGFIX_IDS=$(echo "$INCLUDED_JSON" | tr ',' '\n' | grep 'bugfix/' \
    | sed 's/.*bugfix\/[0-9]*-//;s/-.*//' | sort -u | tr '\n' ',' | sed 's/,$//')

  if [ -n "$BUGFIX_IDS" ]; then
    SQL_IN=$(echo "$BUGFIX_IDS" | tr ',' '\n' | awk '{printf "%s\x27%s%%\x27", (NR>1?",":""), $0}')
    BUGFIXES_JSON=$($PSQL "$DB_URL" -t -A -c "
      SELECT json_object_agg(
        left(id::text, 8),
        json_build_object(
          'desc', COALESCE(
            left(regexp_replace(
              substring(fix_summary from '\"diagnosis\":\s*\"([^\"]+)\"'),
              '\s+', ' ', 'g'
            ), 120),
            left(regexp_replace(fix_summary, '\s+', ' ', 'g'), 120)
          ),
          'status', status,
          'page', page_url
        )
      ) FROM bug_reports
      WHERE id::text LIKE ANY(ARRAY[$SQL_IN])
    " 2>/dev/null | head -1)
    [ -z "$BUGFIXES_JSON" ] && BUGFIXES_JSON="{}"
  fi
fi

# 6. Gather feature branch details (pending features)
FEATURES_JSON="{}"
# Feature branches have format: feature/YYYYMMDD-UUID
# We can get their commit messages
if [ "$PENDING_JSON" != "[]" ]; then
  FEAT_ENTRIES=""
  for branch in $(echo "$PENDING_JSON" | tr -d '[]"' | tr ',' '\n' | grep 'feature/'); do
    # Branch name already has origin/ stripped by sed, so add it back for git log
    FEAT_MSG=$(git log "origin/$branch" --oneline -1 2>/dev/null | cut -d' ' -f2- || true)
    if [ -n "$FEAT_MSG" ]; then
      SAFE_MSG=$(echo "$FEAT_MSG" | sed 's/"/\\"/g' | head -c 120)
      SAFE_BRANCH=$(echo "$branch" | sed 's/"/\\"/g')
      [ -n "$FEAT_ENTRIES" ] && FEAT_ENTRIES="$FEAT_ENTRIES,"
      FEAT_ENTRIES="$FEAT_ENTRIES\"$SAFE_BRANCH\":\"$SAFE_MSG\""
    fi
  done
  [ -n "$FEAT_ENTRIES" ] && FEATURES_JSON="{$FEAT_ENTRIES}"
fi

# 7. Build per-branch model map — infer AI model from branch naming convention
#    Branch patterns: claude/* → claude, gemini/* → gemini, gpt/* → gpt, cursor/* → cursor
#    Also reads from commit trailers if present (Model-Code: xxx)
MODELS_JSON="{}"
ALL_BRANCHES=$(echo "$INCLUDED_JSON" "$PENDING_JSON" | tr -d '[]' | tr ',' '\n' | tr -d '"' | sort -u)
if [ -n "$ALL_BRANCHES" ]; then
  MODEL_ENTRIES=""
  for branch in $ALL_BRANCHES; do
    [ -z "$branch" ] && continue
    BRANCH_MODEL=""
    # Infer from branch name prefix
    case "$branch" in
      claude/*)    BRANCH_MODEL="claude" ;;
      gemini/*)    BRANCH_MODEL="gemini" ;;
      gpt/*)       BRANCH_MODEL="gpt" ;;
      cursor/*)    BRANCH_MODEL="cursor" ;;
      bugfix/*)    BRANCH_MODEL="claude" ;;  # bugfix branches are typically Claude Code
      redesign/*)  BRANCH_MODEL="" ;;
      ui/*)        BRANCH_MODEL="" ;;
    esac
    # Try to read Model-Code trailer from the branch's latest commit
    if [ -z "$BRANCH_MODEL" ]; then
      TRAILER=$(git log "origin/$branch" -1 --format='%(trailers:key=Model-Code,valueonly)' 2>/dev/null || true)
      [ -n "$TRAILER" ] && BRANCH_MODEL=$(echo "$TRAILER" | tr -d '[:space:]')
    fi
    if [ -n "$BRANCH_MODEL" ]; then
      SAFE_BRANCH=$(echo "$branch" | sed 's/"/\\"/g')
      SAFE_MODEL=$(echo "$BRANCH_MODEL" | sed 's/"/\\"/g')
      [ -n "$MODEL_ENTRIES" ] && MODEL_ENTRIES="$MODEL_ENTRIES,"
      MODEL_ENTRIES="$MODEL_ENTRIES\"$SAFE_BRANCH\":\"$SAFE_MODEL\""
    fi
  done
  [ -n "$MODEL_ENTRIES" ] && MODELS_JSON="{$MODEL_ENTRIES}"
fi

# Escape MODEL_CODE for JSON
SAFE_MODEL_CODE=$(echo "$MODEL_CODE" | sed 's/"/\\"/g')

# 7b. Gather branch metadata (commit hash + commit time) for hover details
BRANCH_META_JSON="{}"
BRANCH_LIST=$(echo "$INCLUDED_JSON" "$PENDING_JSON" \
  | tr -d '[]"' | tr ',' '\n' | sed '/^$/d' | sort -u)
if [ -n "$BRANCH_LIST" ]; then
  BRANCH_ENTRIES=""
  while read -r branch; do
    [ -z "$branch" ] && continue
    INFO=$(git log "origin/$branch" -1 --format="%H|%h|%cI" 2>/dev/null || true)
    if [ -n "$INFO" ]; then
      FULL_COMMIT="${INFO%%|*}"
      REST="${INFO#*|}"
      SHORT_COMMIT="${REST%%|*}"
      COMMIT_TIME="${REST#*|}"
      SAFE_BRANCH=$(echo "$branch" | sed 's/"/\\"/g')
      [ -n "$BRANCH_ENTRIES" ] && BRANCH_ENTRIES="$BRANCH_ENTRIES,"
      BRANCH_ENTRIES="$BRANCH_ENTRIES\"$SAFE_BRANCH\":{\"full_commit\":\"$FULL_COMMIT\",\"short_commit\":\"$SHORT_COMMIT\",\"commit_time\":\"$COMMIT_TIME\"}"
    fi
  done <<< "$BRANCH_LIST"
  [ -n "$BRANCH_ENTRIES" ] && BRANCH_META_JSON="{$BRANCH_ENTRIES}"
fi
cat > "$PROJECT_ROOT/version.json" << ENDJSON
{
  "version": "$NEW_DISPLAY_VERSION",
  "model": "$SAFE_MODEL_CODE",
  "machine": "$SAFE_MACHINE_NAME",
  "commit": "$COMMIT_HASH",
  "full_commit": "$FULL_HASH",
  "timestamp": "$ISO_TIMESTAMP",
  "included": $INCLUDED_JSON,
  "pending": $PENDING_JSON,
  "changes": $CHANGES_JSON,
  "bugfixes": $BUGFIXES_JSON,
  "features": $FEATURES_JSON,
  "models": $MODELS_JSON,
  "branch_meta": $BRANCH_META_JSON
}
ENDJSON

# 8. Output new version (with model if available)
if [ -n "$MODEL_CODE" ]; then
  echo "$NEW_DISPLAY_VERSION  [$MODEL_CODE]"
else
  echo "$NEW_DISPLAY_VERSION"
fi
