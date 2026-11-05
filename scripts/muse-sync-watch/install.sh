#!/usr/bin/env bash
# Install or update the watcher on Phoenix. Run from this folder on Phoenix:
#   sudo ./install.sh
# The token goes in /etc/alpacapps-muse-sync.env (root:ubuntu 0640):
#   ALPACAPPS_DISPATCH_TOKEN=<Bitwarden "GitHub — alpacapps Muse sync dispatch token">
set -euo pipefail
cd "$(dirname "$0")"
install -m 0755 muse-sync-watch.sh /usr/local/bin/alpacapps-muse-sync-watch
install -m 0644 alpacapps-muse-sync.service alpacapps-muse-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now alpacapps-muse-sync.timer
systemctl list-timers alpacapps-muse-sync.timer --no-pager
