#!/usr/bin/env bash
# AlpacApps Infra — Prerequisite Installer
# Installs and updates everything needed for project setup (except Xcode CLI tools).
#
# Usage:
#   curl -fsSL https://alpacaplayhouse.com/scripts/install-prereqs.sh | bash
#   — or —
#   ./scripts/install-prereqs.sh
#
# What this installs/updates:
#   git, gh (GitHub CLI), node (+ npm/npx), supabase CLI, wrangler, libpq (psql),
#   bitwarden-cli (bw), typescript-language-server, typescript
#
# What this does NOT install (requires manual setup):
#   - Xcode Command Line Tools (run: xcode-select --install)
#   - Claude Code / Claude Desktop (download from claude.ai/download)

set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
fail()  { echo -e "${RED}[fail]${NC}  $1"; }

echo ""
echo "======================================"
echo "  AlpacApps Infra — Prerequisite Setup"
echo "======================================"
echo ""

# --- Check OS ---
OS="$(uname -s)"
if [[ "$OS" != "Darwin" ]]; then
  fail "This script is for macOS only. For Linux, install: git, gh, node, supabase CLI, wrangler, libpq."
  exit 1
fi

# --- Check Xcode CLI Tools ---
if ! xcode-select -p &>/dev/null; then
  warn "Xcode Command Line Tools not installed."
  echo "  Run: xcode-select --install"
  echo "  Then re-run this script."
  exit 1
fi
ok "Xcode Command Line Tools"

# --- Check/Install Homebrew ---
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to path for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"

# --- Helper: install or upgrade a brew formula ---
brew_ensure() {
  local formula="$1"
  local display_name="${2:-$1}"
  if brew list --formula "$formula" &>/dev/null; then
    local current
    current="$(brew info --json=v2 "$formula" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['formulae'][0]['installed'][0]['version'])" 2>/dev/null || echo "?")"
    local latest
    latest="$(brew info --json=v2 "$formula" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['formulae'][0]['versions']['stable'])" 2>/dev/null || echo "?")"
    if [[ "$current" != "$latest" && "$latest" != "?" ]]; then
      info "Upgrading $display_name ($current -> $latest)..."
      brew upgrade "$formula" 2>/dev/null || true
    fi
    ok "$display_name ($(command -v "${display_name##*/}" &>/dev/null && "${display_name##*/}" --version 2>/dev/null | head -1 || echo "$current"))"
  else
    info "Installing $display_name..."
    brew install "$formula"
    ok "$display_name installed"
  fi
}

# --- Helper: install or upgrade a tap formula ---
brew_tap_ensure() {
  local tap="$1"
  local formula="$2"
  local display_name="${3:-$2}"
  brew tap "$tap" 2>/dev/null || true
  brew_ensure "$formula" "$display_name"
}

# --- Helper: install or upgrade a global npm package ---
npm_ensure() {
  local pkg="$1"
  local cmd="${2:-$1}"
  if command -v "$cmd" &>/dev/null; then
    info "Updating $pkg..."
    npm update -g "$pkg" 2>/dev/null || npm install -g "$pkg"
    ok "$pkg ($("$cmd" --version 2>/dev/null | head -1))"
  else
    info "Installing $pkg..."
    npm install -g "$pkg"
    ok "$pkg installed"
  fi
}

echo ""
info "=== Brew packages ==="

# Core tools
brew_ensure "git" "git"
brew_ensure "gh" "gh"
brew_ensure "node" "node"
brew_ensure "libpq" "libpq"
brew_ensure "bitwarden-cli" "bw"

# Supabase CLI (from their tap)
brew_tap_ensure "supabase/tap" "supabase" "supabase"

echo ""
info "=== npm global packages ==="

# Wrangler (Cloudflare CLI)
npm_ensure "wrangler" "wrangler"

# TypeScript LSP (for Claude Code intelligence)
npm_ensure "typescript" "tsc"
npm_ensure "typescript-language-server" "typescript-language-server"

# --- Verify libpq is on PATH ---
echo ""
info "=== PATH checks ==="
PSQL_PATH="$(brew --prefix libpq)/bin/psql"
if [[ -x "$PSQL_PATH" ]]; then
  ok "psql available at $PSQL_PATH"
  if ! command -v psql &>/dev/null; then
    warn "psql is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"$(brew --prefix libpq)/bin:\$PATH\""
  fi
else
  warn "psql binary not found — libpq may need relinking: brew link --force libpq"
fi

# --- Summary ---
echo ""
echo "======================================"
echo "  All prerequisites installed!"
echo "======================================"
echo ""
echo "  Installed:"
echo "    git             $(git --version 2>/dev/null | awk '{print $3}')"
echo "    gh              $(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
echo "    node            $(node --version 2>/dev/null)"
echo "    npm             $(npm --version 2>/dev/null)"
echo "    supabase        $(supabase --version 2>/dev/null | awk '{print $2}' || echo '?')"
echo "    wrangler        $(wrangler --version 2>/dev/null | awk '{print $2}' || echo '?')"
echo "    psql            $($PSQL_PATH --version 2>/dev/null | awk '{print $3}' || echo 'not on PATH')"
echo "    bw              $(bw --version 2>/dev/null || echo '?')"
echo "    tsc             $(tsc --version 2>/dev/null || echo '?')"
echo ""
echo "  Not covered (manual setup required):"
echo "    Claude Desktop  https://claude.ai/download"
echo "    Claude account  https://claude.ai (Pro \$20/mo recommended)"
echo ""
echo "  Bitwarden (secrets vault):"
echo "    bw login                     # once, with your Bitwarden account"
echo "    export BW_SESSION=\$(bw unlock --raw)"
echo ""
echo "  Next step:"
echo "    git clone https://github.com/rsonnad/alpacapps-infra.git my-project"
echo "    cd my-project && claude"
echo "    /setup-alpacapps-infra"
echo ""
