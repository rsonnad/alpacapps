#!/bin/bash
# ============================================
# Image Generation Worker - Installation Script
# Run on DigitalOcean droplet as root
# ============================================

set -e

echo "=== GenAlpaca Image Gen Worker - Installation ==="

WORKER_DIR="/opt/image-gen"

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

# ---- Copy Worker Files ----
echo "Copying worker files..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/worker.js" "$WORKER_DIR/"
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
# Image Gen Worker Configuration
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-gemini-api-key
POLL_INTERVAL_MS=10000
GEMINI_DELAY_MS=3000
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
cp "$SCRIPT_DIR/image-gen.service" /etc/systemd/system/image-gen.service
systemctl daemon-reload
echo "  Service installed"

# ---- Summary ----
echo ""
echo "============================================"
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/image-gen/.env with your API keys:"
echo "     - SUPABASE_SERVICE_ROLE_KEY"
echo "     - GEMINI_API_KEY"
echo ""
echo "  2. Start the service:"
echo "     systemctl enable image-gen"
echo "     systemctl start image-gen"
echo ""
echo "  3. Check logs:"
echo "     journalctl -u image-gen -f"
echo "============================================"
