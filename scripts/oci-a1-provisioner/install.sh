#!/bin/bash
# Install / upgrade the OCI A1 provisioner as a launchd agent on Alpuca (macOS).
#
#   ./scripts/oci-a1-provisioner/install.sh            # install or upgrade
#   ./scripts/oci-a1-provisioner/install.sh --force    # skip legacy-script safety checks
#
# Idempotent. Copies code out of the repo checkout (worktrees switch branches;
# the job must not change under it), builds a dedicated venv, renders the plist,
# runs `provision.py check`, and only then loads the job.
# Docs: scripts/oci-a1-provisioner/README.md
set -euo pipefail

LABEL="com.alpuca.oci-a1-provisioner"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/scripts/oci-a1-provisioner"
VENV="$HOME/.venvs/oci-a1-provisioner"
CONF_DIR="$HOME/.config/oci-a1-provisioner"
CONF="$CONF_DIR/config.env"
STATE="$HOME/.local/state/oci-a1-provisioner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(uname)" = "Darwin" ] || die "macOS only (launchd). See README for running elsewhere."

# 1. Never run alongside the legacy provisioner: two launchers = possible double launch.
if [ $FORCE -eq 0 ]; then
  if pgrep -fl 'oracle-auto-provision|oracle-provision' >/dev/null 2>&1; then
    pgrep -fl 'oracle-auto-provision|oracle-provision'
    die "legacy provisioner is still running. Stop it first (README: 'Retiring the old script')."
  fi
  # Legacy LaunchAgent from infra/oracle-cloud.html (its WatchPaths relaunches it on success).
  if launchctl list 2>/dev/null | grep -q 'com.oracle.arm-provision'; then
    die "legacy LaunchAgent com.oracle.arm-provision is loaded. Unload it first (README: 'Retiring the old script')."
  fi
  if [ -e "$HOME/.oracle-provisioned" ]; then
    die "~/.oracle-provisioned exists — the old script reported SUCCESS at some point.
       Check the OCI console for an existing A1 instance before provisioning another.
       If none exists: rm ~/.oracle-provisioned and re-run."
  fi
fi

# 2. Code + venv
mkdir -p "$APP" "$STATE" "$CONF_DIR" "$HOME/Library/LaunchAgents"
cp "$SRC/provision.py" "$SRC/requirements.txt" "$APP/"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$APP/requirements.txt"

# 3. Config (never overwritten)
if [ ! -f "$CONF" ]; then
  cp "$SRC/config.env.example" "$CONF"
  chmod 600 "$CONF"
  echo "Created $CONF — fill in COMPARTMENT_ID, SUBNET_ID (and notification settings), then re-run this script."
  exit 0
fi
chmod 600 "$CONF"

# 4. Validate before loading anything
"$VENV/bin/python" "$APP/provision.py" check || die "check failed — fix config, then re-run."

# 5. (Re)load launchd job
sed "s#__HOME__#$HOME#g" "$SRC/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Status:  $VENV/bin/python $APP/provision.py status"
echo "Log:                tail -f $STATE/provisioner.log"
