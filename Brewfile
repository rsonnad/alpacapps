# AlpacApps Infra — Homebrew Bundle
# Install everything: brew bundle
# Check for outdated: brew bundle check
#
# Prerequisites NOT covered here:
#   - Xcode Command Line Tools: xcode-select --install
#   - Claude Code: https://claude.ai/download
#   - Claude account (Pro $20/mo recommended)

# Core tools
brew "git"                          # Version control
brew "gh"                           # GitHub CLI — repo management, Pages, auth
brew "node"                         # JavaScript runtime (includes npm/npx)
brew "libpq"                        # PostgreSQL client (psql) for DB validation
brew "bitwarden-cli"                # Bitwarden CLI (bw) — secrets vault for API keys and tokens

# Infrastructure CLIs
brew "supabase/tap/supabase"        # Supabase CLI — database, auth, edge functions
brew "cloudflare/cloudflare/cloudflared" # Cloudflare Tunnel client (optional)

# npm global packages (installed by scripts/install-prereqs.sh, listed here for reference):
#   wrangler                        — Cloudflare CLI (D1, R2, Workers)
#   typescript                      — TypeScript compiler
#   typescript-language-server      — LSP for Claude Code intelligence
