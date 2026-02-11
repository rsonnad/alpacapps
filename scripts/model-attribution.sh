#!/bin/bash
# model-attribution.sh — infer AI model per commit in a branch range.
#
# Usage:
#   ./scripts/model-attribution.sh                 # current branch vs origin/main (or last 20 on main)
#   ./scripts/model-attribution.sh origin/main     # explicit base ref
#   ./scripts/model-attribution.sh SHA1..SHA2      # explicit git range

set -euo pipefail

infer_model() {
  local subject="$1"
  local body="$2"
  local author_name="$3"
  local author_email="$4"
  local ai_model=""

  ai_model=$(printf "%s\n" "$body" | awk 'BEGIN{IGNORECASE=1}/^AI-Model:[[:space:]]*/{sub(/^AI-Model:[[:space:]]*/, ""); print; exit}')
  if [ -n "$ai_model" ]; then
    printf "%s" "$ai_model"
    return 0
  fi

  local haystack
  haystack=$(printf "%s\n%s\n%s\n%s" "$subject" "$body" "$author_name" "$author_email" | tr '[:upper:]' '[:lower:]')

  if [[ "$haystack" == *"gpt-5.3-codex"* ]] || [[ "$haystack" == *"gpt 5.3 codex"* ]]; then
    printf "gpt-5.3-codex"
  elif [[ "$haystack" == *"claude opus 4.6"* ]] || [[ "$haystack" == *"opus-4.6"* ]]; then
    printf "opus-4.6"
  elif [[ "$haystack" == *"claude code"* ]]; then
    printf "claude-code"
  elif [[ "$haystack" == *"gemini"* ]]; then
    printf "gemini"
  elif [[ "$haystack" == *"cursoragent@cursor.com"* ]] || [[ "$haystack" == *"co-authored-by: cursor"* ]]; then
    printf "cursor"
  else
    printf "unknown"
  fi
}

BASE_OR_RANGE="${1:-origin/main}"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
RANGE=""

if [[ "$BASE_OR_RANGE" == *".."* ]]; then
  RANGE="$BASE_OR_RANGE"
elif [ "$CURRENT_BRANCH" = "main" ] || [ -z "$CURRENT_BRANCH" ]; then
  RANGE="HEAD~20..HEAD"
else
  if git rev-parse --verify "$BASE_OR_RANGE" >/dev/null 2>&1; then
    BASE_COMMIT=$(git merge-base HEAD "$BASE_OR_RANGE")
    RANGE="$BASE_COMMIT..HEAD"
  else
    echo "Base ref not found: $BASE_OR_RANGE" >&2
    exit 1
  fi
fi

COMMIT_COUNT=$(git rev-list --count "$RANGE" 2>/dev/null || echo "0")
if [ "$COMMIT_COUNT" = "0" ]; then
  echo "No commits found for range: $RANGE"
  exit 0
fi

printf "Range: %s\n" "$RANGE"
printf "%-10s %-16s %s\n" "Commit" "Model" "Subject"
printf "%-10s %-16s %s\n" "----------" "----------------" "------------------------------"

TMP_COUNTS=$(mktemp)
trap 'rm -f "$TMP_COUNTS"' EXIT

while :; do
  IFS= read -r -d '' short || break
  IFS= read -r -d '' author_name || break
  IFS= read -r -d '' author_email || break
  IFS= read -r -d '' subject || break
  IFS= read -r -d '' body || break
  model=$(infer_model "$subject" "$body" "$author_name" "$author_email")
  printf "%-10s %-16s %s\n" "$short" "$model" "$subject"
  printf "%s\n" "$model" >> "$TMP_COUNTS"
done < <(git log --reverse --pretty=format:'%h%x00%an%x00%ae%x00%s%x00%b%x00' "$RANGE")

echo
echo "Summary:"
awk '{c[$0]++} END {for (m in c) printf "  %-16s %d\n", m, c[m]}' "$TMP_COUNTS" | sort -k2,2nr -k1,1
