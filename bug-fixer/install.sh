#!/bin/bash
# ============================================
# Bug Fixer Worker - Installation Script
# Run on DigitalOcean droplet as root
# ============================================

set -e

echo "=== GenAlpaca Bug Fixer - Installation ==="

# ---- Prerequisites ----
echo ""
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "  Node.js: $(node --version)"

# Check git
if ! command -v git &> /dev/null; then
    apt-get install -y git
fi
echo "  Git: $(git --version)"

# Chromium dependencies for Puppeteer (headless screenshot capture)
echo "  Installing Chromium dependencies..."
apt-get install -y \
    chromium-browser \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libxshmfence1 \
    fonts-liberation \
    2>/dev/null || echo "  (some chromium deps may already be installed)"
echo "  Chromium deps: installed"

# ---- Claude Code CLI ----
echo ""
echo "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code
echo "  Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

# ---- Repository Setup ----
REPO_DIR="/opt/bug-fixer/repo"
WORKER_DIR="/opt/bug-fixer"

echo ""
echo "Setting up directories..."
mkdir -p "$WORKER_DIR"

if [ ! -d "$REPO_DIR" ]; then
    echo "Cloning repository..."
    git clone https://github.com/rsonnad/alpacapps.git "$REPO_DIR"
else
    echo "Repository already exists at $REPO_DIR"
    cd "$REPO_DIR"
    git fetch origin
    git reset --hard origin/main
fi

# ---- Worker Dependencies ----
echo ""
echo "Installing worker dependencies..."
cp /Users/rahulio/Documents/CodingProjects/genalpaca-admin/bug-fixer/worker.js "$WORKER_DIR/" 2>/dev/null || true
cp /Users/rahulio/Documents/CodingProjects/genalpaca-admin/bug-fixer/package.json "$WORKER_DIR/" 2>/dev/null || true

# If files aren't local, they should already be in $WORKER_DIR
cd "$WORKER_DIR"
npm install

# ---- Environment File ----
ENV_FILE="$WORKER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo ""
    echo "Creating environment file..."
    cat > "$ENV_FILE" << 'ENVEOF'
# Bug Fixer Worker Configuration
# Fill in these values:

ANTHROPIC_API_KEY=your-anthropic-api-key
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
BOT_USER_PASSWORD=your-bot-user-password
REPO_DIR=/opt/bug-fixer/repo
POLL_INTERVAL_MS=30000
MAX_FIX_TIMEOUT_MS=300000
ENVEOF
    echo "  Created $ENV_FILE - PLEASE EDIT WITH YOUR API KEYS"
else
    echo "  Environment file already exists at $ENV_FILE"
fi

# ---- Systemd Service ----
echo ""
echo "Installing systemd service..."
cat > /etc/systemd/system/bug-fixer.service << 'SVCEOF'
[Unit]
Description=GenAlpaca Bug Fixer Worker
After=network.target

[Service]
Type=simple
User=bugfixer
Environment=HOME=/home/bugfixer
WorkingDirectory=/opt/bug-fixer
EnvironmentFile=/opt/bug-fixer/.env
ExecStart=/usr/bin/node /opt/bug-fixer/worker.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bug-fixer

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
echo "  Service installed"

# ---- Git Configuration ----
echo ""
echo "Configuring git in repo..."
cd "$REPO_DIR"
git config user.name "Bug Fixer Bot"
git config user.email "bugfixer@alpacaplayhouse.com"

# ---- Summary ----
echo ""
echo "============================================"
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/bug-fixer/.env with your API keys:"
echo "     - ANTHROPIC_API_KEY"
echo "     - SUPABASE_SERVICE_ROLE_KEY"
echo "     - BOT_USER_PASSWORD (for admin page screenshots)"
echo ""
echo "  2. Configure git push credentials (choose one):"
echo "     a) SSH key: Add deploy key to GitHub repo"
echo "     b) HTTPS token: git config credential.helper store"
echo "        Then: cd $REPO_DIR && git push (enter token once)"
echo ""
echo "  3. Start the service:"
echo "     systemctl enable bug-fixer"
echo "     systemctl start bug-fixer"
echo ""
echo "  4. Check logs:"
echo "     journalctl -u bug-fixer -f"
echo "============================================"
