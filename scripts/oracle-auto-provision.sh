#!/bin/bash

#######################################################################
# Oracle Cloud Always Free ARM Auto-Provisioning Script
#######################################################################
# Retries creating an ARM instance every 2 minutes until capacity opens.
# Rotates through all 3 Phoenix availability domains.
#
# Run:     ./scripts/oracle-auto-provision.sh
# Background: nohup ./scripts/oracle-auto-provision.sh > /tmp/oracle-provision.log 2>&1 &
# Monitor: tail -f /tmp/oracle-provision.log
# Stop:    kill $(cat /tmp/oracle-provision.pid)
#######################################################################

export SUPPRESS_LABEL_WARNING=True
echo $$ > /tmp/oracle-provision.pid

COMPARTMENT_ID="ocid1.tenancy.oc1..aaaaaaaan3gvchaxdm33hrhauigevmbelubtexrgbeicfzwrura7hvkgsqza"
SUBNET_ID="ocid1.subnet.oc1.phx.aaaaaaaatw36j765qtkbanpp4ao5otw45hbqglyzmqgunwi3orzrbeuycuma"
IMAGE_ID="ocid1.image.oc1.phx.aaaaaaaahzur55ghl5ypjy27zsuh7adac4ppnofrp2d3wuxu7iam4ibgkaia"
SHAPE="VM.Standard.A1.Flex"
INSTANCE_NAME="alpacapps-workers"
SSH_KEY_FILE="/Users/rahulio/.ssh/oracle_key.pub"
RETRY_INTERVAL=120

ADS=("jaQr:PHX-AD-1" "jaQr:PHX-AD-2" "jaQr:PHX-AD-3")
AD_INDEX=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=========================================="
log "Oracle ARM Auto-Provisioning (PID $$)"
log "4 OCPUs, 24GB RAM, 200GB boot, Ubuntu 22.04"
log "Retry every ${RETRY_INTERVAL}s across 3 ADs"
log "=========================================="

attempt=0
while true; do
  attempt=$((attempt + 1))
  ad="${ADS[$AD_INDEX]}"
  log "Attempt #$attempt — $ad"

  result=$(oci compute instance launch --compartment-id "$COMPARTMENT_ID" --availability-domain "$ad" --shape "$SHAPE" --shape-config '{"ocpus":4,"memoryInGBs":24}' --image-id "$IMAGE_ID" --subnet-id "$SUBNET_ID" --display-name "$INSTANCE_NAME" --assign-public-ip true --boot-volume-size-in-gbs 200 --ssh-authorized-keys-file "$SSH_KEY_FILE" 2>&1) || true

  if echo "$result" | grep -qi "out of.*capacity"; then
    log "  ❌ Out of capacity"
  elif echo "$result" | grep -qi "LimitExceeded"; then
    log "  ❌ Limit exceeded"
  elif echo "$result" | grep -qi "ServiceError\|RequestException"; then
    msg=$(echo "$result" | grep '"message"' | head -1 | sed 's/.*"message": "\(.*\)".*/\1/')
    log "  ❌ $msg"
  elif echo "$result" | grep -q '"lifecycle-state"'; then
    instance_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
    log "  ✅ PROVISIONING! ID: $instance_id"
    log "  Waiting for RUNNING..."
    oci compute instance get --instance-id "$instance_id" --wait-for-state RUNNING --wait-interval-seconds 15 > /dev/null 2>&1 || true
    sleep 10
    public_ip=$(oci compute instance list-vnics --instance-id "$instance_id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
    log ""
    log "=========================================="
    log "🎉 INSTANCE CREATED!"
    log "IP:  $public_ip"
    log "SSH: ssh -i ~/.ssh/oracle_key ubuntu@$public_ip"
    log "=========================================="
    echo "IP=$public_ip" > /tmp/oracle-instance-details.txt
    echo "SSH=ssh -i ~/.ssh/oracle_key ubuntu@$public_ip" >> /tmp/oracle-instance-details.txt
    osascript -e "display notification \"IP: $public_ip\" with title \"Oracle ARM Instance Created!\" sound name \"Glass\"" 2>/dev/null || true
    rm -f /tmp/oracle-provision.pid
    exit 0
  else
    log "  ⚠️  ${result:0:120}"
  fi

  AD_INDEX=$(( (AD_INDEX + 1) % 3 ))
  log "  Next: ${RETRY_INTERVAL}s..."
  sleep "$RETRY_INTERVAL"
done
