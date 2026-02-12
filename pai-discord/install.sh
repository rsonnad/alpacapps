#!/bin/bash
# ============================================
# PAI Discord Bot - Installation Script
# Run on DigitalOcean droplet as root
# ============================================

set -e

echo "=== AlpacApps PAI Discord Bot - Installation ==="

WORKER_DIR="/opt/pai-discord"

# ---- Prerequisites ----
echo ""
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not installed. Install it first."
    exit 1
fi
echo "  Node.js: $(node --version)"

# ---- Directory Setup ----
echo ""
echo "Setting up directories..."
mkdir -p "$WORKER_DIR"

# ---- Copy Bot Files ----
echo "Copying bot files..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/bot.js" "$WORKER_DIR/"
cp "$SCRIPT_DIR/package.json" "$WORKER_DIR/"

# ---- Install Dependencies ----
echo ""
echo "Installing dependencies..."
cd "$WORKER_DIR"
npm install

# ---- Set Ownership ----
chown -R bugfixer:bugfixer "$WORKER_DIR"

# ---- Environment File ----
ENV_FILE="$WORKER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo ""
    echo "Creating environment file..."
    cat > "$ENV_FILE" << 'ENVEOF'
# PAI Discord Bot Configuration
DISCORD_TOKEN=<paste-discord-bot-token>
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key>
CHANNEL_IDS=1471024050343247894
ENVEOF
    chown bugfixer:bugfixer "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "  Created $ENV_FILE - PLEASE EDIT WITH YOUR API KEYS"
else
    echo "  Environment file already exists at $ENV_FILE"
fi

# ---- Systemd Service ----
echo ""
echo "Installing systemd service..."
cp "$SCRIPT_DIR/pai-discord.service" /etc/systemd/system/pai-discord.service
systemctl daemon-reload
echo "  Service installed"

# ---- Summary ----
echo ""
echo "============================================"
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/pai-discord/.env with your tokens:"
echo "     - DISCORD_TOKEN"
echo "     - SUPABASE_SERVICE_ROLE_KEY"
echo ""
echo "  2. Start the service:"
echo "     systemctl enable pai-discord"
echo "     systemctl start pai-discord"
echo ""
echo "  3. Check logs:"
echo "     journalctl -u pai-discord -f"
echo "============================================"
