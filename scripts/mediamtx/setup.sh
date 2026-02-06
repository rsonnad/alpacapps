#!/bin/bash
# MediaMTX Setup Script for Alpaca Mac
# Installs MediaMTX, extracts UDM Pro cert fingerprint, deploys config & launchd service
#
# Run this ON the Alpaca Mac (or via SSH):
#   ssh alpaca@100.110.178.14 'bash -s' < scripts/mediamtx/setup.sh
#
# Or from the DO droplet:
#   ssh alpaca@100.110.178.14 'bash -s' < /path/to/setup.sh

set -euo pipefail

INSTALL_DIR="$HOME/mediamtx"
CONFIG_FILE="$INSTALL_DIR/mediamtx.yml"
PLIST_FILE="$HOME/Library/LaunchAgents/com.mediamtx.plist"
UDM_HOST="192.168.1.1"
UDM_PORT="7441"

echo "=== MediaMTX Setup for GenAlpaca ==="
echo ""

# Step 1: Install MediaMTX via Homebrew
echo "[1/6] Installing MediaMTX..."
if command -v mediamtx &>/dev/null; then
    echo "  MediaMTX already installed: $(mediamtx --version 2>&1 || echo 'unknown version')"
else
    if command -v brew &>/dev/null; then
        brew install mediamtx
    else
        echo "ERROR: Homebrew not found. Install it first: https://brew.sh"
        exit 1
    fi
fi

# Ensure binary is in expected location
MEDIAMTX_BIN=$(which mediamtx)
echo "  Binary at: $MEDIAMTX_BIN"

# Symlink to /usr/local/bin if not already there (launchd plist expects it)
if [ "$MEDIAMTX_BIN" != "/usr/local/bin/mediamtx" ] && [ ! -f /usr/local/bin/mediamtx ]; then
    echo "  Symlinking to /usr/local/bin/mediamtx..."
    sudo ln -sf "$MEDIAMTX_BIN" /usr/local/bin/mediamtx
fi

# Step 2: Create install directory
echo "[2/6] Creating install directory..."
mkdir -p "$INSTALL_DIR"

# Step 3: Extract UDM Pro TLS fingerprint
echo "[3/6] Extracting UDM Pro TLS certificate fingerprint..."
FINGERPRINT=$(openssl s_client -connect "${UDM_HOST}:${UDM_PORT}" </dev/null 2>/dev/null \
    | sed -n '/BEGIN/,/END/p' \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
    | cut -d "=" -f2 \
    | tr -d ':')

if [ -z "$FINGERPRINT" ]; then
    echo "ERROR: Could not extract TLS fingerprint from ${UDM_HOST}:${UDM_PORT}"
    echo "Make sure you're on the local network (192.168.1.x) and the UDM Pro is reachable."
    exit 1
fi

echo "  Fingerprint: $FINGERPRINT"

# Step 4: Deploy config with fingerprint
echo "[4/6] Deploying mediamtx.yml..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/mediamtx.yml" ]; then
    # Running from repo — use local config
    sed "s/FINGERPRINT_PLACEHOLDER/$FINGERPRINT/g" "$SCRIPT_DIR/mediamtx.yml" > "$CONFIG_FILE"
else
    # Running via stdin or remote — use heredoc config
    cat > "$CONFIG_FILE" << 'CONFIGEOF'
PASTE_CONFIG_HERE
CONFIGEOF
    sed -i '' "s/FINGERPRINT_PLACEHOLDER/$FINGERPRINT/g" "$CONFIG_FILE"
fi

echo "  Config written to: $CONFIG_FILE"

# Step 5: Deploy launchd plist
echo "[5/6] Setting up launchd service..."

# Stop existing service if running
launchctl unload "$PLIST_FILE" 2>/dev/null || true

cat > "$PLIST_FILE" << 'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mediamtx</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/mediamtx</string>
        <string>INSTALL_DIR_PLACEHOLDER/mediamtx.yml</string>
    </array>
    <key>WorkingDirectory</key>
    <string>INSTALL_DIR_PLACEHOLDER</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>INSTALL_DIR_PLACEHOLDER/mediamtx.log</string>
    <key>StandardErrorPath</key>
    <string>INSTALL_DIR_PLACEHOLDER/mediamtx.log</string>
</dict>
</plist>
PLISTEOF

sed -i '' "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" "$PLIST_FILE"

launchctl load "$PLIST_FILE"
echo "  Service loaded and started"

# Step 6: Verify
echo "[6/6] Verifying..."
sleep 3

if curl -s http://localhost:9997/v3/paths/list > /dev/null 2>&1; then
    echo ""
    echo "=== SUCCESS ==="
    echo "MediaMTX is running!"
    echo ""
    echo "Stream URLs (from any machine on the LAN or Tailscale):"
    echo "  RTSP:   rtsp://192.168.1.74:8554/{stream-name}"
    echo "  HLS:    http://192.168.1.74:8888/{stream-name}"
    echo "  WebRTC: http://192.168.1.74:8889/{stream-name}"
    echo ""
    echo "Available streams:"
    echo "  alpacamera-high, alpacamera-med, alpacamera-low"
    echo "  front-house-high, front-house-med, front-house-low"
    echo "  side-yard-high, side-yard-med, side-yard-low"
    echo ""
    echo "API:      http://192.168.1.74:9997/v3/paths/list"
    echo "Logs:     $INSTALL_DIR/mediamtx.log"
    echo ""
    echo "Fingerprint used: $FINGERPRINT"
else
    echo ""
    echo "WARNING: MediaMTX may not have started correctly."
    echo "Check logs: tail -50 $INSTALL_DIR/mediamtx.log"
    echo "Try manually: mediamtx $CONFIG_FILE"
fi
