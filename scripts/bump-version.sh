#!/bin/bash
# bump-version.sh — record a release event in Supabase, rewrite version strings
# in all HTML files, and write version.json.
#
# Called by CI (GitHub Action) on every push to main.
# Idempotent per push SHA: repeated runs return the same sequence number.
#
# Uses Supabase REST API (HTTPS) — no psql or direct DB connections needed.
#
# Usage:  ./scripts/bump-version.sh [--model CODE] [--source SRC]

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────
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

# ── resolve Supabase API credentials ────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
[ -z "$SUPABASE_URL" ] && { echo "ERROR: SUPABASE_URL is required" >&2; exit 1; }
[ -z "$SUPABASE_SERVICE_ROLE_KEY" ] && { echo "ERROR: SUPABASE_SERVICE_ROLE_KEY is required" >&2; exit 1; }

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

# ── 1) record release event via Supabase REST API ───────────────────
META="{\"workflow\":\"bump-version.sh\",\"commit_count\":$COMMIT_COUNT,\"commit_summaries\":$COMMITS_FOR_DB}"

RPC_PAYLOAD=$(python3 -c "
import json, sys
payload = {
    'p_push_sha': sys.argv[1],
    'p_branch': sys.argv[2],
    'p_compare_from_sha': sys.argv[3] if sys.argv[3] else None,
    'p_compare_to_sha': sys.argv[4],
    'p_pushed_at': sys.argv[5],
    'p_actor_login': sys.argv[6],
    'p_actor_id': None,
    'p_source': sys.argv[7],
    'p_model_code': sys.argv[8] if sys.argv[8] else None,
    'p_machine_name': sys.argv[9] if sys.argv[9] else None,
    'p_metadata': json.loads(sys.argv[10]),
    'p_commits': json.loads(sys.argv[11])
}
print(json.dumps(payload))
" "$PUSH_SHA" "$BRANCH" "$FROM_SHA" "$TO_SHA" "$PUSHED_AT" "$ACTOR" "$SOURCE" "$MODEL" "$MACHINE" "$META" "$COMMITS_FOR_DB")

echo "Recording release event via REST API..."
API_RESULT=$(curl -s -w "\n%{http_code}" -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/record_release_event" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$RPC_PAYLOAD")

HTTP_CODE=$(echo "$API_RESULT" | tail -1)
API_BODY=$(echo "$API_RESULT" | sed '$d')

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "ERROR: Supabase RPC failed (HTTP $HTTP_CODE)" >&2
  echo "Response: $API_BODY" >&2
  exit 1
fi

# Parse response — the RPC returns a single row (the release_events record)
SEQ=$(echo "$API_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['seq'])" 2>/dev/null)
VER=$(echo "$API_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['display_version'])" 2>/dev/null)
R_AT=$(echo "$API_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pushed_at',''))" 2>/dev/null)
R_ACT=$(echo "$API_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('actor_login',''))" 2>/dev/null)
R_SRC=$(echo "$API_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('source',''))" 2>/dev/null)

[ -z "$VER" ] || [ "$VER" = "null" ] && { echo "ERROR: Failed to get version from API" >&2; echo "Response: $API_BODY" >&2; exit 1; }
[ -z "$R_AT" ]  && R_AT="$PUSHED_AT"
[ -z "$R_ACT" ] && R_ACT="$ACTOR"
[ -z "$R_SRC" ] && R_SRC="$SOURCE"

# Keep legacy site_config in sync via REST API
curl -s -X PATCH \
  "${SUPABASE_URL}/rest/v1/site_config?id=eq.1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"$(json_esc "$VER")\",\"updated_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" \
  >/dev/null 2>&1 || true

# ── 1b) backfill deployed_version for feature requests whose commit is in this push ──
if [ -n "$COMMITS_FOR_DB" ] && [ "$COMMITS_FOR_DB" != "[]" ]; then
  SHAS=$(echo "$COMMITS_FOR_DB" | python3 -c "
import sys, json
commits = json.loads(sys.stdin.read())
for c in commits:
    print(c['sha'])
" 2>/dev/null || true)
  if [ -n "$SHAS" ]; then
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      # Update feature_requests where commit_sha matches and deployed_version is null
      curl -s -X PATCH \
        "${SUPABASE_URL}/rest/v1/feature_requests?commit_sha=eq.${sha}&deployed_version=is.null" \
        -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"deployed_version\":\"$(json_esc "$VER")\"}" \
        >/dev/null 2>&1 || true
    done <<< "$SHAS"
  fi
fi

# ── 2) rewrite version string in all HTML files ─────────────────────
# Strategy: target spans by attribute/class name (robust even if content is empty).
IS_GNU=false; sed --version 2>/dev/null | grep -q 'GNU' && IS_GNU=true

do_sed() {
  if [ "$IS_GNU" = true ]; then
    sed -i "$1" "$2"
  else
    sed -i '' "$1" "$2"
  fi
}

find . -name "*.html" -not -path "./.git/*" | while read -r f; do
  changed=false
  # 1) data-site-version spans: replace content between > and </
  if grep -q 'data-site-version' "$f"; then
    do_sed "s/\(data-site-version[^>]*>\)[^<]*/\1$VER/" "$f"
    changed=true
  fi
  # 2) site-nav__version spans: replace content between > and </
  if grep -q 'site-nav__version' "$f"; then
    do_sed "s/\(site-nav__version[^>]*>\)[^<]*/\1$VER/" "$f"
    changed=true
  fi
  # 3) Fallback: pattern-match any remaining version strings (v or r format)
  if grep -q '\(v[0-9]\{6\}\.[0-9]\{2\}\|r[0-9]\{9\}\)' "$f"; then
    PAT='\(v[0-9]\{6\}\.[0-9]\{2\}\( [0-9]\{1,2\}:[0-9]\{2\}[ap]\)\{0,1\}\|r[0-9]\{9\}\)'
    do_sed "s/$PAT/$VER/g" "$f"
    changed=true
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
