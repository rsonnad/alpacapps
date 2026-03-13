#!/bin/bash
# Claude Code SessionEnd hook — saves full transcript to Cloudflare D1
# Reads session JSONL from disk, extracts conversation, posts to Worker
#
# Installation:
#   1. Copy this file to ~/.claude/hooks/save-session.sh
#   2. chmod +x ~/.claude/hooks/save-session.sh
#   3. Add to ~/.claude/settings.json:
#      "hooks": {
#        "SessionEnd": [{ "type": "command", "command": "bash ~/.claude/hooks/save-session.sh" }]
#      }
#   4. Update API_URL and API_TOKEN below with your Worker URL and token.

set -euo pipefail

API_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/sessions"
API_TOKEN="YOUR_AUTH_TOKEN"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
CWD=$(echo "$INPUT" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Find the session JSONL file
# Claude stores sessions in ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
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

# Extract project name from the directory path
PROJECT_DIR=$(dirname "$JSONL_FILE")
PROJECT_NAME=$(basename "$PROJECT_DIR" | sed 's/^-Users-[^-]*-//' | sed 's/-/\//g')

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

messages = []
model = None
started_at = None
total_tokens = 0

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
                total_tokens += usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
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

# Calculate duration
duration_mins = None
if started_at:
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        duration_mins = int((datetime.now(start.tzinfo) - start).total_seconds() / 60)
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
    "duration_mins": duration_mins,
    "summary": summary,
    "transcript": transcript,
    "token_count": total_tokens if total_tokens else None,
    "tags": None
})

# Post to Cloudflare Worker
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
