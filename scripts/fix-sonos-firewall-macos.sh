#!/bin/bash
# fix-sonos-firewall-macos.sh
# Configures macOS firewall to allow Sonos discovery and control.
# Run on the MacBook: bash scripts/fix-sonos-firewall-macos.sh

set -e

echo "=== Sonos Firewall Fix for macOS ==="
echo ""

# 1. Check current firewall status
echo "1. Checking macOS Application Firewall status..."
FW_STATUS=$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1)
echo "   $FW_STATUS"

if echo "$FW_STATUS" | grep -q "disabled"; then
    echo "   Firewall is OFF — Sonos should work without changes."
    echo "   If Sonos still isn't working, the issue is likely network/multicast, not firewall."
    echo ""
    echo "   Common non-firewall fixes:"
    echo "   - Ensure MacBook is on the same WiFi/VLAN as Sonos speakers (192.168.1.x)"
    echo "   - Disable VPN if active (VPNs block multicast)"
    echo "   - Restart Sonos app"
    echo ""
    read -p "   Want to continue with firewall config anyway? (y/N) " CONT
    [[ "$CONT" != "y" && "$CONT" != "Y" ]] && exit 0
fi

echo ""
echo "2. Configuring firewall for Sonos..."

# Allow Sonos app if installed
SONOS_APP="/Applications/Sonos.app"
SONOS_S1="/Applications/Sonos S1 Controller.app"

for APP in "$SONOS_APP" "$SONOS_S1"; do
    if [ -d "$APP" ]; then
        echo "   Adding $APP to firewall allow list..."
        sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$APP"
        sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$APP"
        echo "   ✓ $APP allowed"
    fi
done

# 3. Allow signed apps to receive incoming connections (needed for Sonos discovery)
echo ""
echo "3. Allowing signed apps to accept incoming connections..."
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsigned on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsignedapp on
echo "   ✓ Signed apps allowed"

# 4. Enable stealth mode OFF (stealth mode blocks ICMP and discovery protocols)
echo ""
echo "4. Disabling stealth mode (blocks multicast discovery)..."
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode off
echo "   ✓ Stealth mode disabled"

# 5. Ensure mDNS/Bonjour is not blocked (Sonos uses mDNS for discovery)
echo ""
echo "5. Checking mDNS (Bonjour) daemon..."
if pgrep -x mDNSResponder > /dev/null; then
    echo "   ✓ mDNSResponder is running"
else
    echo "   ✗ mDNSResponder is NOT running — this is unusual on macOS"
    echo "   Try: sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.mDNSResponder.plist"
fi

# 6. Check for pf (packet filter) rules that might block Sonos
echo ""
echo "6. Checking pf (packet filter) for Sonos-blocking rules..."
PF_ENABLED=$(sudo pfctl -s info 2>&1 | head -1)
echo "   $PF_ENABLED"

if echo "$PF_ENABLED" | grep -q "Enabled"; then
    echo "   Checking for rules blocking Sonos ports (1400, 1900, 5353)..."
    BLOCKING=$(sudo pfctl -s rules 2>&1 | grep -E "block.*(1400|1900|5353|multicast)" || true)
    if [ -n "$BLOCKING" ]; then
        echo "   ⚠ Found potentially blocking rules:"
        echo "   $BLOCKING"
        echo ""
        echo "   Adding pf pass rules for Sonos..."

        # Create Sonos pf anchor
        PF_SONOS="/etc/pf.anchors/sonos"
        sudo tee "$PF_SONOS" > /dev/null << 'PFRULES'
# Sonos firewall rules
# UDP 1900 - SSDP/UPnP discovery
pass in quick proto udp from any to any port 1900 no state
pass out quick proto udp from any to any port 1900 no state
# UDP 5353 - mDNS (Bonjour) discovery
pass in quick proto udp from any to any port 5353 no state
pass out quick proto udp from any to any port 5353 no state
# TCP 1400/1443 - Sonos control
pass in quick proto tcp from 192.168.1.0/24 to any port {1400, 1443} no state
pass out quick proto tcp from any to 192.168.1.0/24 port {1400, 1443} no state
# TCP 3400-3500 - Sonos streaming
pass in quick proto tcp from 192.168.1.0/24 to any port 3400:3500 no state
pass out quick proto tcp from any to 192.168.1.0/24 port 3400:3500 no state
# Multicast - SSDP
pass in quick proto udp from any to 239.255.255.250 no state
pass out quick proto udp from any to 239.255.255.250 no state
PFRULES

        # Add anchor to pf.conf if not already there
        if ! sudo grep -q "sonos" /etc/pf.conf 2>/dev/null; then
            echo 'anchor "sonos"' | sudo tee -a /etc/pf.conf > /dev/null
            echo 'load anchor "sonos" from "/etc/pf.anchors/sonos"' | sudo tee -a /etc/pf.conf > /dev/null
        fi

        sudo pfctl -f /etc/pf.conf 2>&1 || true
        echo "   ✓ pf rules added for Sonos"
    else
        echo "   ✓ No Sonos-blocking pf rules found"
    fi
else
    echo "   ✓ pf is disabled — no packet filter blocking"
fi

# 7. Restart Sonos-related services
echo ""
echo "7. Flushing mDNS cache..."
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder 2>/dev/null || true
echo "   ✓ mDNS cache flushed"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Quit and reopen the Sonos app"
echo "  2. If speakers still don't appear, check:"
echo "     - Same network/VLAN as speakers (192.168.1.x subnet)"
echo "     - VPN is disabled"
echo "     - WiFi is on 5GHz (some routers isolate 2.4/5GHz clients)"
echo "  3. Test discovery: dns-sd -B _sonos._tcp"
echo "  4. Test direct control: curl -s http://192.168.1.39:8123/api/states/media_player.living_sound -H 'Authorization: Bearer \$HA_TOKEN'"
