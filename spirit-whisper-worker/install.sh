#!/bin/bash
# Install Spirit Whisper worker on DigitalOcean droplet
# Run as root: bash install.sh

set -e

INSTALL_DIR="/opt/spirit-whisper-worker"
SERVICE_NAME="spirit-whisper-worker"
USER="bugfixer"

echo "=== Installing Spirit Whisper Worker ==="

# Create directory
mkdir -p "$INSTALL_DIR"

# Copy files
cp worker.js "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"

# Create .env template if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<'EOF'
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>
POLL_INTERVAL_MS=30000
# Comma-separated Sonos zones to target (optional)
# SONOS_ZONES=Living Sound,Dining Sound,Backyard Sound
EOF
  echo "Created .env template — edit with real keys: $INSTALL_DIR/.env"
fi

# Install dependencies
cd "$INSTALL_DIR" && npm install

# Set ownership
chown -R "$USER:$USER" "$INSTALL_DIR"

# Install systemd service
cp "$INSTALL_DIR/../spirit-whisper-worker.service" "/etc/systemd/system/$SERVICE_NAME.service" 2>/dev/null || \
  cp "$(dirname "$0")/spirit-whisper-worker.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "=== Installation complete ==="
echo "1. Edit .env:           nano $INSTALL_DIR/.env"
echo "2. Start service:       systemctl start $SERVICE_NAME"
echo "3. Check logs:          journalctl -u $SERVICE_NAME -f"
