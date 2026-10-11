#!/bin/bash
# Stop and remove the OCI A1 provisioner launchd agent.
#   ./uninstall.sh          # unload + remove plist and code; keep config + state (history)
#   ./uninstall.sh --purge  # also delete config, state and venv
set -euo pipefail
LABEL="com.alpuca.oci-a1-provisioner"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/scripts/oci-a1-provisioner"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/.config/oci-a1-provisioner" "$HOME/.local/state/oci-a1-provisioner" "$HOME/.venvs/oci-a1-provisioner"
fi
echo "Uninstalled $LABEL."
