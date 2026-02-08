#!/bin/bash
# install.sh - Set up the Feature Builder on the DO droplet
# Run as root: bash install.sh

set -e

INSTALL_DIR="/opt/feature-builder"
REPO_DIR="${INSTALL_DIR}/repo"
SERVICE_FILE="/etc/systemd/system/feature-builder.service"

echo "=== PAI Feature Builder Installation ==="

# 1. Create directory
echo "[1/7] Creating ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"

# 2. Copy worker files
echo "[2/7] Copying worker files..."
cp feature_builder.js "${INSTALL_DIR}/"
cp package.json "${INSTALL_DIR}/"

# 3. Install dependencies
echo "[3/7] Installing dependencies..."
cd "${INSTALL_DIR}"
npm install

# 4. Clone repo if not exists
if [ ! -d "${REPO_DIR}" ]; then
  echo "[4/7] Cloning repo..."
  sudo -u bugfixer git clone git@github.com:rsonnad/alpacapps.git "${REPO_DIR}"
  cd "${REPO_DIR}"
  sudo -u bugfixer git config user.name "Feature Builder Bot"
  sudo -u bugfixer git config user.email "featurebuilder@alpacaplayhouse.com"
  sudo -u bugfixer git config core.sharedRepository group
else
  echo "[4/7] Repo already exists at ${REPO_DIR}"
fi

# 5. Set ownership
echo "[5/7] Setting file ownership..."
chown -R bugfixer:bugfixer "${INSTALL_DIR}"

# 6. Create .env if not exists
if [ ! -f "${INSTALL_DIR}/.env" ]; then
  echo "[6/7] Creating .env template..."
  cat > "${INSTALL_DIR}/.env" << 'ENVEOF'
SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY_HERE
SUPABASE_ANON_KEY=YOUR_ANON_KEY_HERE
REPO_DIR=/opt/feature-builder/repo
ENVEOF
  chown bugfixer:bugfixer "${INSTALL_DIR}/.env"
  echo "  >> IMPORTANT: Edit ${INSTALL_DIR}/.env with your actual keys!"
else
  echo "[6/7] .env already exists"
fi

# 7. Install systemd service
echo "[7/7] Installing systemd service..."
cp feature-builder.service "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable feature-builder

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit ${INSTALL_DIR}/.env with your Supabase keys"
echo "  2. Start the service: systemctl start feature-builder"
echo "  3. Check logs: journalctl -u feature-builder -f"
