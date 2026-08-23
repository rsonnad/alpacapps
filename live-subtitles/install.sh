#!/bin/bash
# Install live-subtitles as a systemd service on Alpuca
set -e

SERVICE_DIR="/home/alpuca/live-subtitles"
SERVICE_NAME="live-subtitles"

echo "=== Installing $SERVICE_NAME ==="

# Copy files
mkdir -p "$SERVICE_DIR"
cp package.json server.js test-client.html "$SERVICE_DIR/"

# Install deps
cd "$SERVICE_DIR"
npm install --production

# Install systemd service
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=Live Subtitles Server
After=network.target

[Service]
Type=simple
User=alpuca
WorkingDirectory=$SERVICE_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SUBTITLE_PORT=8910

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "=== $SERVICE_NAME installed and running ==="
echo "Status: http://localhost:8910/subtitles/status"
echo "Test UI: http://localhost:8910/test"
