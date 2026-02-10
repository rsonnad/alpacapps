#!/bin/sh
# modl.sh — set AAP_MODEL_CODE from a short alias.
#
# Usage (recommended):
#   source ./scripts/modl.sh g
#   source ./scripts/modl.sh o
#   source ./scripts/modl.sh c
#   source ./scripts/modl.sh a   # Cursor Auto
#
# Aliases:
#   g -> gpt-5.3-codex
#   o -> opus-4.6
#   c -> composer-1.5
#   a -> modl a (Cursor Auto)

set_model() {
  case "$1" in
    g|gpt|gpt-5.2|gpt-5.3|gpt-5.3-codex)
      code="gpt-5.3-codex"
      ;;
    o|opus|opus-4.6)
      code="opus-4.6"
      ;;
    c|composer|composer-1.5)
      code="composer-1.5"
      ;;
    a|auto|cursor-auto)
      code="modl a"
      ;;
    *)
      echo "Usage: source ./scripts/modl.sh {g|o|c|a}" >&2
      return 1
      ;;
  esac
  export AAP_MODEL_CODE="$code"
  echo "AAP_MODEL_CODE=$code"
}

set_model "$1"
