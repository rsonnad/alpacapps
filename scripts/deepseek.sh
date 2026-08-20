#!/usr/bin/env bash
# deepseek.sh — hand one well-specified coding task to a cheap worker model
# (DeepSeek v4 Flash on OpenRouter) and print the reply on stdout.
#
# This is the "worker" half of an orchestrator/worker setup. Your orchestrator
# — Claude Sonnet in Claude Code, or GPT-5.6 Luna in ChatGPT/Codex — writes the
# spec, calls this script, then reviews and applies whatever comes back.
#
# Usage:
#   scripts/deepseek.sh task.md              # spec from a file
#   echo "..." | scripts/deepseek.sh         # spec from stdin
#   scripts/deepseek.sh task.md src/a.js src/b.js   # spec + files to include
#
# Env:
#   OPENROUTER_API_KEY  required (read from .env if present)
#   DEEPSEEK_MODEL      default: deepseek/deepseek-v4-flash
#   DEEPSEEK_MAX_TOKENS default: 8000
#   OPENROUTER_BASE_URL default: https://openrouter.ai/api/v1

set -euo pipefail

MODEL="${DEEPSEEK_MODEL:-deepseek/deepseek-v4-flash}"
MAX_TOKENS="${DEEPSEEK_MAX_TOKENS:-8000}"
BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"

# Pull OPENROUTER_API_KEY out of .env without executing the file.
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f .env ]; then
  OPENROUTER_API_KEY="$(grep -m1 '^[[:space:]]*OPENROUTER_API_KEY=' .env 2>/dev/null \
    | sed 's/^[[:space:]]*OPENROUTER_API_KEY=//; s/^["'"'"']//; s/["'"'"']$//')" || true
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "deepseek.sh: OPENROUTER_API_KEY is not set." >&2
  echo "  Add it to .env as OPENROUTER_API_KEY=sk-or-... (and keep .env out of git)." >&2
  exit 2
fi

# First arg is the spec if it is a readable file; otherwise read stdin.
if [ $# -gt 0 ] && [ -f "$1" ]; then
  SPEC="$(cat "$1")"
  shift
else
  SPEC="$(cat)"
fi

if [ -z "${SPEC//[[:space:]]/}" ]; then
  echo "deepseek.sh: empty task spec — nothing to send." >&2
  exit 2
fi

# Any remaining args are files to append as context.
CONTEXT=""
for f in "$@"; do
  if [ -f "$f" ]; then
    CONTEXT="${CONTEXT}

===== FILE: ${f} =====
$(cat "$f")"
  else
    echo "deepseek.sh: skipping missing file '$f'" >&2
  fi
done

SYSTEM="You are a careful coding worker. You were handed a fully specified task by an orchestrating model. Do exactly what the spec says and nothing more. Do not redesign, do not rename things you were not asked to rename, and do not add features. Return complete file contents or a unified diff, whichever the spec asks for, with no commentary outside the code."

REQ="$(SPEC="$SPEC" CONTEXT="$CONTEXT" SYSTEM="$SYSTEM" MODEL="$MODEL" MAX_TOKENS="$MAX_TOKENS" python3 -c '
import json, os
print(json.dumps({
    "model": os.environ["MODEL"],
    "max_tokens": int(os.environ["MAX_TOKENS"]),
    "temperature": 0,
    "messages": [
        {"role": "system", "content": os.environ["SYSTEM"]},
        {"role": "user", "content": os.environ["SPEC"] + os.environ["CONTEXT"]},
    ],
}))')"

RESP="$(curl -sS --max-time 300 "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Title: AlpacApps" \
  -d "$REQ")"

RESP="$RESP" python3 -c '
import json, os, sys
raw = os.environ["RESP"]
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    sys.stderr.write("deepseek.sh: non-JSON response from OpenRouter:\n" + raw[:500] + "\n")
    sys.exit(1)
if "error" in d:
    err = d["error"]
    msg = err.get("message", err) if isinstance(err, dict) else err
    sys.stderr.write("deepseek.sh: OpenRouter error: %s\n" % msg)
    sys.exit(1)
try:
    print(d["choices"][0]["message"]["content"])
except (KeyError, IndexError):
    sys.stderr.write("deepseek.sh: unexpected response shape:\n" + raw[:500] + "\n")
    sys.exit(1)
u = d.get("usage") or {}
if u:
    sys.stderr.write("deepseek.sh: %s prompt + %s completion tokens\n"
                     % (u.get("prompt_tokens", "?"), u.get("completion_tokens", "?")))
'
