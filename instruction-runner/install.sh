#!/bin/bash
# install.sh - Set up the Instruction Runner on the DO droplet
# Run as root: bash install.sh

set -e

INSTALL_DIR="/opt/instruction-runner"
REPO_DIR="${INSTALL_DIR}/repo"
SERVICE_FILE="/etc/systemd/system/instruction-runner.service"

echo "=== Instruction Runner Installation ==="

# 1. Create directory
echo "[1/6] Creating ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"

# 2. Copy worker files
echo "[2/6] Copying worker files..."
cp worker.js "${INSTALL_DIR}/"
cp package.json "${INSTALL_DIR}/"

# 3. Install dependencies
echo "[3/6] Installing dependencies..."
cd "${INSTALL_DIR}"
npm install

# 4. Clone repo if not exists
if [ ! -d "${REPO_DIR}" ]; then
  echo "[4/6] Cloning repo..."
  sudo -u bugfixer git clone git@github.com:rsonnad/alpacapps.git "${REPO_DIR}"
  cd "${REPO_DIR}"
  sudo -u bugfixer git config user.name "Instruction Runner Bot"
  sudo -u bugfixer git config user.email "runner@alpacaplayhouse.com"
  sudo -u bugfixer git config core.sharedRepository group
else
  echo "[4/6] Repo already exists at ${REPO_DIR}"
fi

# 5. Set ownership
echo "[5/6] Setting file ownership..."
chown -R bugfixer:bugfixer "${INSTALL_DIR}"

# 6. Create .env if not exists
if [ ! -f "${INSTALL_DIR}/.env" ]; then
  echo "[6/6] Creating .env..."
  cat > "${INSTALL_DIR}/.env" << 'ENVEOF'
REPO_DIR=/opt/instruction-runner/repo
POLL_INTERVAL_MS=30000
MAX_EXEC_TIMEOUT_MS=600000
ENVEOF
  chown bugfixer:bugfixer "${INSTALL_DIR}/.env"
else
  echo "[6/6] .env already exists"
fi

# 7. Install systemd service
echo "Installing systemd service..."
cp instruction-runner.service "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable instruction-runner

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Start the service: systemctl start instruction-runner"
echo "  2. Check logs: journalctl -u instruction-runner -f"
echo ""
echo "Usage: From Android Claude Code, push a branch with files in instructions/"
echo "  e.g. instructions/my-task.md containing the task description"
echo "  The runner will pick it up, execute via Claude Code, and push results."
