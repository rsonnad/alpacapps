#!/bin/bash
# Paint Color Analyzer Worker — Install Script
# Run on the DO/Oracle server as root

set -e

INSTALL_DIR="/opt/paint-analyzer"
SERVICE_NAME="paint-analyzer"
USER="bugfixer"

echo "=== Installing Paint Color Analyzer Worker ==="

# Create directory
mkdir -p "$INSTALL_DIR"

# Copy files
cp worker.js "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"

# Create .env if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << 'EOF'
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>
ANTHROPIC_API_KEY=<paste-anthropic-api-key>
BRAVE_API_KEY=<paste-brave-api-key>
POLL_INTERVAL_MS=10000
CLAUDE_MODEL=claude-sonnet-4-6
EOF
  echo ">>> Created .env — fill in the API keys!"
else
  echo ">>> .env already exists, skipping"
fi

# Set ownership
chown -R "$USER:$USER" "$INSTALL_DIR"

# Install dependencies
cd "$INSTALL_DIR"
sudo -u "$USER" npm install --production

# Install systemd service
cp "$INSTALL_DIR/../genalpaca-admin/paint-analyzer/paint-analyzer.service" /etc/systemd/system/ 2>/dev/null || \
  cp "$(dirname "$0")/paint-analyzer.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo "=== Done! ==="
echo "Check status: systemctl status $SERVICE_NAME"
echo "View logs:    journalctl -u $SERVICE_NAME -f"
