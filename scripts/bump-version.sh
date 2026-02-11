#!/bin/bash
# bump-version.sh — record a release event in Supabase, rewrite version strings
# in all HTML files, and write version.json.
#
# Called by CI (GitHub Action) on every push to main.
# Idempotent per push SHA: repeated runs return the same sequence number.
#
# Usage:  ./scripts/bump-version.sh [--model CODE] [--source SRC]

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────
sql_esc() { printf "%s" "$1" | sed "s/'/''/g"; }
json_esc() { printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# ── parse args / env ─────────────────────────────────────────────────
MODEL="${AAP_MODEL_CODE:-}"
SOURCE="${RELEASE_SOURCE:-}"
PUSH_SHA="${RELEASE_PUSH_SHA:-}"
ACTOR="${RELEASE_ACTOR_LOGIN:-}"
BRANCH="${RELEASE_BRANCH:-}"
FROM_SHA="${RELEASE_COMPARE_FROM_SHA:-}"
TO_SHA="${RELEASE_COMPARE_TO_SHA:-}"
PUSHED_AT="${RELEASE_PUSHED_AT:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --model)  MODEL="$2";  shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

# ── resolve psql ─────────────────────────────────────────────────────
if [ -x "/opt/homebrew/opt/libpq/bin/psql" ]; then
  PSQL="/opt/homebrew/opt/libpq/bin/psql"
elif command -v psql &>/dev/null; then
  PSQL="psql"
else
  echo "ERROR: psql not found" >&2; exit 1
fi

DB_URL="${SUPABASE_DB_URL:-}"
[ -z "$DB_URL" ] && { echo "ERROR: SUPABASE_DB_URL is required" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# ── defaults from git / env ──────────────────────────────────────────
[ -z "$PUSH_SHA" ]  && PUSH_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[ -z "$TO_SHA" ]    && TO_SHA="$PUSH_SHA"
[ -z "$BRANCH" ]    && BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
[ -z "$ACTOR" ]     && ACTOR=$(git log -1 --pretty='%an' 2>/dev/null || echo "${USER:-unknown}")
[ -z "$SOURCE" ]    && SOURCE="local-script"
[ -z "$PUSHED_AT" ] && PUSHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ -z "$MODEL" ]; then
  case "$BRANCH" in
    claude/*) MODEL="claude" ;; gemini/*) MODEL="gemini" ;;
    gpt/*)    MODEL="gpt" ;;    cursor/*) MODEL="cursor" ;;
    *)        MODEL="cur" ;;
  esac
fi

# Machine name
MACHINE="${AAP_MACHINE_NAME:-}"
[ -z "$MACHINE" ] && [ -f "$PROJECT_ROOT/.machine-name" ] && MACHINE=$(head -1 "$PROJECT_ROOT/.machine-name" | tr -d '\r')
[ -z "$MACHINE" ] && command -v scutil >/dev/null 2>&1 && MACHINE=$(scutil --get ComputerName 2>/dev/null || true)
[ -z "$MACHINE" ] && MACHINE=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "unknown")

# ── gather commits in the push range ─────────────────────────────────
RANGE=""
if [ -n "$FROM_SHA" ] && [ "$FROM_SHA" != "0000000000000000000000000000000000000000" ]; then
  RANGE="$FROM_SHA..$TO_SHA"
elif [ -n "$TO_SHA" ]; then
  RANGE="$TO_SHA~1..$TO_SHA"
fi

COMMITS_JSON="[]"
COMMITS_FOR_DB="[]"
if [ -n "$RANGE" ]; then
  LOG=$(git log --reverse --pretty=format:'%H%x09%h%x09%an%x09%ae%x09%cI%x09%s' "$RANGE" 2>/dev/null || true)
  if [ -n "$LOG" ]; then
    DB_ENTRIES=""
    VJ_ENTRIES=""
    while IFS=$'\t' read -r sha short aname aemail cat subj; do
      [ -z "$sha" ] && continue
      # For version.json (simple)
      [ -n "$VJ_ENTRIES" ] && VJ_ENTRIES="$VJ_ENTRIES,"
      VJ_ENTRIES="$VJ_ENTRIES{\"sha\":\"$(json_esc "$short")\",\"message\":\"$(json_esc "$subj")\",\"author\":\"$(json_esc "$aname")\"}"
      # For DB (full)
      [ -n "$DB_ENTRIES" ] && DB_ENTRIES="$DB_ENTRIES,"
      DB_ENTRIES="$DB_ENTRIES{\"sha\":\"$(json_esc "$sha")\",\"short\":\"$(json_esc "$short")\",\"author_name\":\"$(json_esc "$aname")\",\"author_email\":\"$(json_esc "$aemail")\",\"committed_at\":\"$(json_esc "$cat")\",\"message\":\"$(json_esc "$subj")\"}"
    done <<< "$LOG"
    [ -n "$VJ_ENTRIES" ] && COMMITS_JSON="[$VJ_ENTRIES]"
    [ -n "$DB_ENTRIES" ] && COMMITS_FOR_DB="[$DB_ENTRIES]"
  fi
fi

COMMIT_COUNT=$(echo "$COMMITS_FOR_DB" | python3 -c "import sys,json;print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo 0)

# ── 1) record release event in DB ────────────────────────────────────
# commit_summaries in metadata = same as COMMITS_FOR_DB (admin releases page reads .sha + .message)
META="{\"workflow\":\"bump-version.sh\",\"commit_count\":$COMMIT_COUNT,\"commit_summaries\":$COMMITS_FOR_DB}"
ROW=$($PSQL "$DB_URL" -t -A --no-psqlrc -F $'\t' -c "
  SELECT seq::text, display_version, pushed_at::text, actor_login, source
  FROM record_release_event(
    '$(sql_esc "$PUSH_SHA")',
    '$(sql_esc "$BRANCH")',
    NULLIF('$(sql_esc "$FROM_SHA")', ''),
    NULLIF('$(sql_esc "$TO_SHA")', ''),
    '$(sql_esc "$PUSHED_AT")'::timestamptz,
    '$(sql_esc "$ACTOR")',
    NULL,
    '$(sql_esc "$SOURCE")',
    NULLIF('$(sql_esc "$MODEL")', ''),
    NULLIF('$(sql_esc "$MACHINE")', ''),
    '$(sql_esc "$META")'::jsonb,
    '$(sql_esc "$COMMITS_FOR_DB")'::jsonb
  );
" | head -1)

[ -z "$ROW" ] && { echo "ERROR: Failed to record release event" >&2; exit 1; }

SEQ=$(echo "$ROW"  | awk -F $'\t' '{print $1}')
VER=$(echo "$ROW"  | awk -F $'\t' '{print $2}')
R_AT=$(echo "$ROW" | awk -F $'\t' '{print $3}')
R_ACT=$(echo "$ROW"| awk -F $'\t' '{print $4}')
R_SRC=$(echo "$ROW"| awk -F $'\t' '{print $5}')
[ -z "$R_AT" ]  && R_AT="$PUSHED_AT"
[ -z "$R_ACT" ] && R_ACT="$ACTOR"
[ -z "$R_SRC" ] && R_SRC="$SOURCE"

# Keep legacy site_config in sync
$PSQL "$DB_URL" -t -A --no-psqlrc -c "
  UPDATE site_config SET version = '$(sql_esc "$VER")', updated_at = now() WHERE id = 1;
" >/dev/null 2>&1 || true

# ── 2) rewrite version string in all HTML files ─────────────────────
PAT='\(v[0-9]\{6\}\.[0-9]\{2\}\( [0-9]\{1,2\}:[0-9]\{2\}[ap]\)\{0,1\}\|r[0-9]\{9\}\)'
IS_GNU=false; sed --version 2>/dev/null | grep -q 'GNU' && IS_GNU=true

find . -name "*.html" -not -path "./.git/*" -exec grep -l '\(v[0-9]\{6\}\.[0-9]\{2\}\|r[0-9]\{9\}\)' {} \; | while read -r f; do
  if [ "$IS_GNU" = true ]; then
    sed -i "s/$PAT/$VER/g" "$f"
  else
    sed -i '' "s/$PAT/$VER/g" "$f"
  fi
done

# ── 3) write version.json ────────────────────────────────────────────
cat > "$PROJECT_ROOT/version.json" << ENDJSON
{
  "version": "$(json_esc "$VER")",
  "release": $SEQ,
  "sha": "$(json_esc "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)")",
  "fullSha": "$(json_esc "$(git rev-parse HEAD 2>/dev/null || echo unknown)")",
  "actor": "$(json_esc "$R_ACT")",
  "source": "$(json_esc "$R_SRC")",
  "model": "$(json_esc "$MODEL")",
  "machine": "$(json_esc "$MACHINE")",
  "pushedAt": "$(json_esc "$R_AT")",
  "commits": $COMMITS_JSON
}
ENDJSON

# ── 4) output ────────────────────────────────────────────────────────
echo "$VER  [$MODEL]"
