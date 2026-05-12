# Service Access Recipes

Verified copy-paste recipes for external services and machines. Prefer these before rediscovering credentials or hostnames.

## Almaca SSH and Tailscale

Use when checking the legacy ALMACA MacBook Pro 16, including mounted local volumes such as `SW-SDCAM`.

### Tailscale SSH

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43
```

### LAN SSH Fallback

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@192.168.1.74
```

### Verify `SW-SDCAM` on Almaca

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43 \
  'hostname; scutil --get ComputerName 2>/dev/null || true; ls -la /Volumes; test -d /Volumes/SW-SDCAM && df -h /Volumes/SW-SDCAM && mount | grep -i SW-SDCAM'
```

If the Tailscale IP has a stale host key in local `known_hosts`, use a temporary known-hosts file instead of changing the user's SSH config:

```bash
ssh -o UserKnownHostsFile=/tmp/almaca-known-hosts \
  -o StrictHostKeyChecking=accept-new \
  alpaca@100.115.27.43 \
  'hostname; ls -la /Volumes; df -h /Volumes/SW-SDCAM 2>/dev/null || true'
```

Verified 2026-05-11:

```text
ComputerName: Almaca
Tailscale IP: 100.115.27.43
LAN IP: 192.168.1.74
SW-SDCAM: /Volumes/SW-SDCAM
Filesystem: exfat
Observed capacity: 231Gi total, 40Gi used, 191Gi available
```

## Alpuca SSH and Printer Proxy

Use when checking the primary home server, LAN devices, or the FlashForge printer proxy.

### Tailscale SSH

```bash
ssh -F /dev/null -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new \
  alpuca@100.74.59.97
```

### Printer Proxy Health

```bash
ssh -F /dev/null -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new \
  alpuca@100.74.59.97 \
  'curl -sS http://127.0.0.1:8914/health'
```

Verified 2026-05-11:

```text
ComputerName: Alpuca.local
Tailscale IP: 100.74.59.97
LAN IP: 192.168.1.200
Printer proxy: com.printer-proxy on port 8913, health on 8914
```
