#!/bin/bash
# push-main.sh — bump version, commit, push to main with metadata.
#
# Usage:
#   ./scripts/push-main.sh --model "gpt-5.2-codex" --machine "rahulio-macair"
#   ./scripts/push-main.sh --model "gpt-5.2-codex"
#   ./scripts/push-main.sh
#
# Model can also be set via AAP_MODEL_CODE, machine via AAP_MACHINE_NAME or .machine-name.

set -euo pipefail

MODEL_CODE="${AAP_MODEL_CODE:-}"
MACHINE_NAME="${AAP_MACHINE_NAME:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --model)
      MODEL_CODE="$2"
      shift 2
      ;;
    --machine)
      MACHINE_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/push-main.sh [--model MODEL] [--machine MACHINE]" >&2
      exit 1
      ;;
  esac
done

if [ -n "$MODEL_CODE" ]; then
  export AAP_MODEL_CODE="$MODEL_CODE"
fi

if [ -n "$MACHINE_NAME" ]; then
  export AAP_MACHINE_NAME="$MACHINE_NAME"
fi

./scripts/bump-version.sh ${AAP_MODEL_CODE:+--model "$AAP_MODEL_CODE"}
git add -A
git commit -m "$(cat <<'EOF'
Bump site version.
EOF
)"
git push origin main
