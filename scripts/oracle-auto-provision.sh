#!/bin/bash

#######################################################################
# Oracle Cloud Always Free ARM Auto-Provisioning Script
#######################################################################
# This script automatically retries creating an Oracle Cloud Always Free
# ARM instance until capacity becomes available.
#
# Usage:
#   1. Install Oracle CLI: bash <(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)
#   2. Configure Oracle CLI: oci setup config
#   3. Run this script: ./oracle-auto-provision.sh
#
# The script will:
#   - Retry every 5 minutes until successful
#   - Create instance with 4 OCPUs, 24GB RAM, 200GB storage
#   - Send notification when instance is created
#   - Output instance IP address
#######################################################################

set -e

# Configuration (update these with your values)
COMPARTMENT_ID="ocid1.tenancy.oc1..aaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Your tenancy OCID
AVAILABILITY_DOMAIN="zkxJ:PHX-AD-1"  # Format: <region-key>:<AD-name>
SUBNET_ID="ocid1.subnet.oc1.phx.aaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Will be created on first VCN
SHAPE="VM.Standard.A1.Flex"
IMAGE_ID="ocid1.image.oc1.phx.aaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Canonical Ubuntu 22.04
INSTANCE_NAME="alpacapps-workers"
SSH_PUBLIC_KEY_FILE="$HOME/.ssh/oracle_key.pub"
NOTIFICATION_EMAIL="wingsiebird@gmail.com"
RETRY_INTERVAL=300  # 5 minutes

# Try all 3 availability domains in rotation
AVAILABILITY_DOMAINS=(
  "zkxJ:PHX-AD-1"
  "zkxJ:PHX-AD-2"
  "zkxJ:PHX-AD-3"
)

CURRENT_AD_INDEX=0

#######################################################################
# Helper Functions
#######################################################################

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

send_notification() {
  local subject="$1"
  local body="$2"

  # Use Supabase edge function to send email
  curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/send-email" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"template\": \"custom\",
      \"to\": \"${NOTIFICATION_EMAIL}\",
      \"subject\": \"${subject}\",
      \"html\": \"${body}\"
    }" > /dev/null 2>&1
}

get_or_create_vcn() {
  log "Checking for existing VCN..."

  # Try to find existing VCN
  local vcn_id=$(oci network vcn list \
    --compartment-id "$COMPARTMENT_ID" \
    --query "data[?\"display-name\"=='alpacapps-vcn'].id | [0]" \
    --raw-output 2>/dev/null)

  if [[ -n "$vcn_id" && "$vcn_id" != "null" ]]; then
    log "Found existing VCN: $vcn_id"
    echo "$vcn_id"
    return 0
  fi

  log "Creating new VCN..."
  vcn_id=$(oci network vcn create \
    --compartment-id "$COMPARTMENT_ID" \
    --display-name "alpacapps-vcn" \
    --cidr-block "10.0.0.0/16" \
    --wait-for-state AVAILABLE \
    --query "data.id" \
    --raw-output)

  log "Created VCN: $vcn_id"
  echo "$vcn_id"
}

get_or_create_subnet() {
  local vcn_id="$1"
  local ad="$2"

  log "Checking for existing public subnet..."

  # Try to find existing subnet
  local subnet_id=$(oci network subnet list \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --query "data[?\"display-name\"=='public-subnet'].id | [0]" \
    --raw-output 2>/dev/null)

  if [[ -n "$subnet_id" && "$subnet_id" != "null" ]]; then
    log "Found existing subnet: $subnet_id"
    echo "$subnet_id"
    return 0
  fi

  log "Creating new public subnet..."

  # Get internet gateway for VCN
  local igw_id=$(oci network internet-gateway list \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --query "data[0].id" \
    --raw-output 2>/dev/null)

  if [[ -z "$igw_id" || "$igw_id" == "null" ]]; then
    log "Creating internet gateway..."
    igw_id=$(oci network internet-gateway create \
      --compartment-id "$COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --is-enabled true \
      --display-name "igw-alpacapps" \
      --wait-for-state AVAILABLE \
      --query "data.id" \
      --raw-output)
  fi

  # Get default route table
  local rt_id=$(oci network route-table list \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --query "data[?\"display-name\"=='Default Route Table for alpacapps-vcn'].id | [0]" \
    --raw-output 2>/dev/null)

  if [[ -z "$rt_id" || "$rt_id" == "null" ]]; then
    rt_id=$(oci network route-table list \
      --compartment-id "$COMPARTMENT_ID" \
      --vcn-id "$vcn_id" \
      --query "data[0].id" \
      --raw-output)
  fi

  # Update route table with internet gateway route
  oci network route-table update \
    --rt-id "$rt_id" \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"networkEntityId\":\"$igw_id\"}]" \
    --force > /dev/null 2>&1

  # Create subnet
  subnet_id=$(oci network subnet create \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$vcn_id" \
    --cidr-block "10.0.0.0/24" \
    --display-name "public-subnet" \
    --route-table-id "$rt_id" \
    --wait-for-state AVAILABLE \
    --query "data.id" \
    --raw-output)

  log "Created subnet: $subnet_id"
  echo "$subnet_id"
}

get_ubuntu_image_id() {
  local ad="$1"

  log "Finding latest Ubuntu 22.04 image for $ad..."

  # Find Canonical Ubuntu 22.04 image
  local image_id=$(oci compute image list \
    --compartment-id "$COMPARTMENT_ID" \
    --operating-system "Canonical Ubuntu" \
    --operating-system-version "22.04" \
    --shape "$SHAPE" \
    --sort-by TIMECREATED \
    --sort-order DESC \
    --query "data[0].id" \
    --raw-output 2>/dev/null)

  if [[ -z "$image_id" || "$image_id" == "null" ]]; then
    log "ERROR: Could not find Ubuntu 22.04 image for shape $SHAPE"
    exit 1
  fi

  log "Found image: $image_id"
  echo "$image_id"
}

try_create_instance() {
  local ad="${AVAILABILITY_DOMAINS[$CURRENT_AD_INDEX]}"

  log "Attempting to create instance in availability domain: $ad"

  # Get or create VCN and subnet
  local vcn_id=$(get_or_create_vcn)
  local subnet_id=$(get_or_create_subnet "$vcn_id" "$ad")
  local image_id=$(get_ubuntu_image_id "$ad")

  # Read SSH public key
  if [[ ! -f "$SSH_PUBLIC_KEY_FILE" ]]; then
    log "ERROR: SSH public key file not found: $SSH_PUBLIC_KEY_FILE"
    exit 1
  fi

  local ssh_key=$(cat "$SSH_PUBLIC_KEY_FILE")

  # Try to create instance
  local result=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$ad" \
    --shape "$SHAPE" \
    --shape-config '{"ocpus":4,"memoryInGBs":24}' \
    --image-id "$image_id" \
    --subnet-id "$subnet_id" \
    --display-name "$INSTANCE_NAME" \
    --assign-public-ip true \
    --boot-volume-size-in-gbs 200 \
    --metadata "{\"ssh_authorized_keys\":\"$ssh_key\"}" \
    --wait-for-state RUNNING 2>&1)

  if echo "$result" | grep -q "Out of host capacity"; then
    log "Out of capacity in $ad"
    return 1
  elif echo "$result" | grep -q "ServiceError"; then
    log "ERROR creating instance: $result"
    return 1
  else
    log "SUCCESS! Instance created in $ad"
    echo "$result"
    return 0
  fi
}

#######################################################################
# Main Loop
#######################################################################

log "Starting Oracle Cloud Always Free ARM auto-provisioning..."
log "Instance name: $INSTANCE_NAME"
log "Shape: $SHAPE (4 OCPUs, 24GB RAM, 200GB storage)"
log "Retry interval: ${RETRY_INTERVAL}s"
log ""

attempt=0

while true; do
  attempt=$((attempt + 1))
  ad="${AVAILABILITY_DOMAINS[$CURRENT_AD_INDEX]}"

  log "Attempt #$attempt - Trying $ad..."

  if result=$(try_create_instance); then
    # Success! Extract instance details
    instance_id=$(echo "$result" | grep '"id":' | head -1 | sed 's/.*"id": "\([^"]*\)".*/\1/')

    # Get public IP
    sleep 10  # Wait for networking to initialize
    public_ip=$(oci compute instance list-vnics \
      --instance-id "$instance_id" \
      --query "data[0].\"public-ip\"" \
      --raw-output)

    log ""
    log "=========================================="
    log "INSTANCE CREATED SUCCESSFULLY!"
    log "=========================================="
    log "Instance ID: $instance_id"
    log "Public IP: $public_ip"
    log "Availability Domain: $ad"
    log "SSH command: ssh -i ~/.ssh/oracle_key ubuntu@$public_ip"
    log "=========================================="

    # Send success notification
    send_notification \
      "Oracle ARM Instance Created!" \
      "<h2>Success!</h2><p>Oracle Cloud Always Free ARM instance has been provisioned.</p><p><strong>Public IP:</strong> $public_ip</p><p><strong>SSH:</strong> <code>ssh -i ~/.ssh/oracle_key ubuntu@$public_ip</code></p><p>You can now run the migration script to move all workers from DigitalOcean.</p>"

    # Save details to file
    cat > /tmp/oracle-instance-details.txt <<EOF
Instance ID: $instance_id
Public IP: $public_ip
Availability Domain: $ad
SSH Command: ssh -i ~/.ssh/oracle_key ubuntu@$public_ip

Next Steps:
1. SSH into the instance: ssh -i ~/.ssh/oracle_key ubuntu@$public_ip
2. Run the migration script: bash <(curl -s https://raw.githubusercontent.com/rsonnad/alpacapps/main/scripts/migrate-to-oracle.sh)
3. Update CLAUDE.local.md with the new IP address
4. After 48 hours of testing, shut down the DigitalOcean droplet
EOF

    log "Instance details saved to: /tmp/oracle-instance-details.txt"

    exit 0
  else
    # Failed - try next availability domain
    CURRENT_AD_INDEX=$(( (CURRENT_AD_INDEX + 1) % 3 ))

    log "Waiting ${RETRY_INTERVAL}s before next attempt..."
    sleep "$RETRY_INTERVAL"
  fi
done
