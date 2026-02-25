#!/bin/bash
# remote-control.sh — Start a Claude Code Remote Control session for a project
#
# Usage:
#   ./remote-control.sh              # Default: alpacapps
#   ./remote-control.sh portsie      # Portsie project
#   ./remote-control.sh <name>       # Any project at /opt/<name>/repo
#
# Prerequisites:
#   - Claude Code 2.1.52+ installed (npm i -g @anthropic-ai/claude-code)
#   - Authenticated: run `claude /login` once to link your Max account
#   - Project repo cloned to /opt/<project>/repo
#
# After starting, connect from your phone at https://claude.ai/code
# or scan the QR code shown in the terminal.

set -e

PROJECT="${1:-alpacapps}"

# Resolve project directory
case "$PROJECT" in
  alpacapps) DIR="/opt/bug-fixer/repo" ;;  # Legacy path — existing bug-fixer clone
  portsie)   DIR="/opt/portsie/repo" ;;
  *)         DIR="/opt/$PROJECT/repo" ;;
esac

if [ ! -d "$DIR" ]; then
  echo "Error: Project directory not found: $DIR"
  echo ""
  echo "To set up a new project:"
  echo "  1. mkdir -p /opt/$PROJECT"
  echo "  2. git clone <repo-url> /opt/$PROJECT/repo"
  echo "  3. cd /opt/$PROJECT/repo && git config user.name 'Remote Control Bot'"
  echo "  4. chown -R bugfixer:bugfixer /opt/$PROJECT"
  exit 1
fi

echo "Starting Remote Control for: $PROJECT"
echo "Directory: $DIR"
echo ""
echo "Connect from your phone at https://claude.ai/code"
echo "Press Ctrl+C to end the session."
echo ""

cd "$DIR"
exec claude remote-control
