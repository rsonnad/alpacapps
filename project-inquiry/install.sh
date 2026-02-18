#!/bin/bash
# Project Inquiry Worker — Install Script
# Run on the DO/Oracle server as root

set -e

INSTALL_DIR="/opt/project-inquiry"
SERVICE_NAME="project-inquiry"
USER="bugfixer"

echo "=== Installing Project Inquiry Worker ==="

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
GEMINI_API_KEY=<paste-gemini-api-key>
BRAVE_API_KEY=<paste-brave-api-key>
POLL_INTERVAL_MS=10000
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
cp "$(dirname "$0")/project-inquiry.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo "=== Done! ==="
echo "Check status: systemctl status $SERVICE_NAME"
echo "View logs:    journalctl -u $SERVICE_NAME -f"
