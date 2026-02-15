#!/bin/bash

#######################################################################
# Setup Oracle CLI on DigitalOcean Droplet
#######################################################################
# This script installs Oracle Cloud CLI on the DO droplet and starts
# the auto-provisioning script that will claim an Always Free ARM instance.
#
# Run on DO droplet:
#   bash <(curl -s https://raw.githubusercontent.com/rsonnad/alpacapps/main/scripts/setup-oracle-cli-droplet.sh)
#######################################################################

set -e

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "Installing Oracle Cloud CLI..."

# Install Oracle CLI (non-interactive)
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)" -- \
  --accept-all-defaults \
  --install-dir ~/oracle-cli \
  --exec-dir ~/bin \
  --update-path-and-enable-tab-completion

# Add to PATH for current session
export PATH="$HOME/bin:$PATH"

log "Oracle CLI installed successfully"
log "Version: $(oci --version)"

# Configure Oracle CLI
log ""
log "Now we need to configure Oracle CLI with your credentials."
log "You'll need:"
log "  1. User OCID (from Oracle Cloud Console → Profile → User Settings)"
log "  2. Tenancy OCID (from Oracle Cloud Console → Profile → Tenancy)"
log "  3. Region (us-phoenix-1)"
log ""
log "Starting interactive configuration..."
log "When prompted for API key, choose to generate a new key pair."
log ""

oci setup config

log ""
log "Oracle CLI configured successfully!"
log ""
log "Next steps:"
log "  1. Upload the public key to Oracle Cloud Console:"
log "     - Go to: Profile → User Settings → API Keys → Add API Key"
log "     - Paste the contents of: ~/.oci/oci_api_key_public.pem"
log "  2. After uploading the public key, copy your SSH public key to the droplet:"
log "     scp ~/.ssh/oracle_key.pub root@159.89.157.120:~/.ssh/"
log "  3. Then run the auto-provisioning script:"
log "     cd /opt/alpacapps && ./scripts/oracle-auto-provision.sh"
log ""
