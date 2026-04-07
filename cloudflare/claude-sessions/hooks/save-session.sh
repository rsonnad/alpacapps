#!/bin/bash
# Claude Code Stop/SessionEnd hook — saves full transcript to Cloudflare D1
# Reads session JSONL from disk, extracts conversation, posts to Worker
# Rate-limited: only saves once per 5 minutes per session to avoid excessive API calls

set -euo pipefail

API_URL="https://claude-sessions.alpacapps.workers.dev/sessions"
API_TOKEN="alpaca-sessions-2026"

# Read hook input from stdin
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Rate limit: only save once every 5 minutes per session
LOCK_DIR="$HOME/.claude/hooks/.session-locks"
mkdir -p "$LOCK_DIR" 2>/dev/null
LOCK_FILE="$LOCK_DIR/$SESSION_ID"
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$LOCK_AGE" -lt 300 ]; then
    exit 0
  fi
fi
touch "$LOCK_FILE"

# Find the session JSONL file
PROJECTS_DIR="$HOME/.claude/projects"
JSONL_FILE=""
for dir in "$PROJECTS_DIR"/*/; do
  candidate="${dir}${SESSION_ID}.jsonl"
  if [ -f "$candidate" ]; then
    JSONL_FILE="$candidate"
    break
  fi
done

if [ -z "$JSONL_FILE" ] || [ ! -f "$JSONL_FILE" ]; then
  exit 0
fi

# Extract project name. Map known repo paths to canonical short names so
# worktrees + main project all aggregate into one bucket. Falls back to a
# slugified path for unknown projects.
PROJECT_DIR=$(dirname "$JSONL_FILE")
DIR_SLUG=$(basename "$PROJECT_DIR")
case "$DIR_SLUG" in
  *genalpaca-admin*|*genalpaca/admin*) PROJECT_NAME="genalpaca" ;;
  *sponic-garden*|*sponic/garden*)     PROJECT_NAME="sponic" ;;
  *finleg*)                            PROJECT_NAME="finleg" ;;
  *portsie*)                           PROJECT_NAME="portsie" ;;
  *mistiq*)                            PROJECT_NAME="mistiq" ;;
  *Khangtsen*|*khangtsen*)             PROJECT_NAME="khangtsen" ;;
  *) PROJECT_NAME=$(echo "$DIR_SLUG" | sed 's/^-Users-[^-]*-//' | sed 's/-/\//g') ;;
esac

# Export variables so the Python heredoc can access them via os.environ
export JSONL_FILE SESSION_ID PROJECT_NAME API_URL API_TOKEN

# Extract conversation data using Python (handles JSON properly)
/usr/bin/python3 << 'PYEOF'
import json, sys, os, subprocess
from datetime import datetime

jsonl_file = os.environ.get("JSONL_FILE", "")
session_id = os.environ.get("SESSION_ID", "")
project_name = os.environ.get("PROJECT_NAME", "")
api_url = os.environ.get("API_URL", "")
api_token = os.environ.get("API_TOKEN", "")

if not jsonl_file or not os.path.exists(jsonl_file):
    sys.exit(0)

# Per-million-token prices in USD. Mirrors what claude-usage uses; cache_read
# is 10% of input, cache_creation is 1.25x input (Anthropic standard).
PRICING = {
    "opus":    {"in": 15.00, "out": 75.00, "cr": 1.50,  "cw": 18.75},
    "sonnet":  {"in":  3.00, "out": 15.00, "cr": 0.30,  "cw":  3.75},
    "haiku":   {"in":  0.80, "out":  4.00, "cr": 0.08,  "cw":  1.00},
}

def price_for(model_name):
    if not model_name:
        return PRICING["sonnet"]
    m = model_name.lower()
    if "opus" in m:   return PRICING["opus"]
    if "haiku" in m:  return PRICING["haiku"]
    return PRICING["sonnet"]

messages = []
model = None
started_at = None
ended_at = None
total_tokens = 0
input_tokens = 0
output_tokens = 0
cache_read_tokens = 0
cache_creation_tokens = 0
cost_usd = 0.0

with open(jsonl_file) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = entry.get("type", "")
        timestamp = entry.get("timestamp", "")

        if not started_at and timestamp:
            started_at = timestamp
        if timestamp:
            ended_at = timestamp

        if msg_type == "user":
            content = entry.get("message", {}).get("content", "")
            if isinstance(content, list):
                text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                content = "\n".join(text_parts)
            messages.append(f"## User\n{content}")

        elif msg_type == "assistant":
            msg = entry.get("message", {})
            if not model and msg.get("model"):
                model = msg["model"]
            usage = msg.get("usage", {})
            if usage:
                it = usage.get("input_tokens", 0) or 0
                ot = usage.get("output_tokens", 0) or 0
                cr = usage.get("cache_read_input_tokens", 0) or 0
                cw = usage.get("cache_creation_input_tokens", 0) or 0
                input_tokens += it
                output_tokens += ot
                cache_read_tokens += cr
                cache_creation_tokens += cw
                total_tokens += it + ot + cr + cw
                p = price_for(msg.get("model") or model)
                cost_usd += (it * p["in"] + ot * p["out"] + cr * p["cr"] + cw * p["cw"]) / 1_000_000
            content = msg.get("content", "")
            if isinstance(content, list):
                parts = []
                for p in content:
                    if isinstance(p, dict):
                        if p.get("type") == "text":
                            parts.append(p.get("text", ""))
                        elif p.get("type") == "tool_use":
                            parts.append(f"[Tool: {p.get('name','')}]")
                content = "\n".join(parts)
            messages.append(f"## Assistant\n{content}")

transcript = "\n\n---\n\n".join(messages)

# Calculate duration from actual timestamps
duration_mins = None
if started_at and ended_at:
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        duration_mins = max(1, int((end - start).total_seconds() / 60))
    except Exception:
        pass

# Build first user message as summary
summary = ""
for m in messages:
    if m.startswith("## User"):
        summary = m[8:200].strip()
        break

payload = json.dumps({
    "id": session_id,
    "project": project_name,
    "model": model,
    "started_at": started_at,
    "ended_at": ended_at,
    "duration_mins": duration_mins,
    "summary": summary,
    "transcript": transcript,
    "token_count": total_tokens if total_tokens else None,
    "input_tokens": input_tokens or None,
    "output_tokens": output_tokens or None,
    "cache_read_tokens": cache_read_tokens or None,
    "cache_creation_tokens": cache_creation_tokens or None,
    "cost_usd": round(cost_usd, 6) if cost_usd else None,
    "tags": None
})

# Post to Cloudflare Worker (INSERT OR REPLACE — idempotent)
try:
    subprocess.run(
        ["curl", "-s", "--tlsv1.2", "-X", "POST", api_url,
         "-H", f"Authorization: Bearer {api_token}",
         "-H", "Content-Type: application/json",
         "-d", payload,
         "--max-time", "10"],
        capture_output=True, timeout=15
    )
except Exception:
    pass
PYEOF

exit 0
