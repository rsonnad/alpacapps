# Remote Access Guide

How to SSH into Alpuca (home server) and the UDM Pro (network gateway) when you're **not on the home LAN** (not 192.168.1.x).

All credentials referenced via Bitwarden CLI (`bw-read`). No secrets in this file.

---

## Network Topology

```
Internet
  │
  ├── UDM Pro (gateway, 192.168.1.1)
  │     └── Alpuca (Mac Mini M4, 192.168.1.200)
  │           ├── HAOS VM (192.168.1.39)
  │           ├── Cloudflare Tunnel (alpaca-cam)
  │           └── Tailscale (100.74.59.97)
  │
  └── Your machine (remote)
        ├── Tailscale (if available)
        └── cloudflared CLI (if installed)
```

**UDM Pro has NO Tailscale and NO cloud remote access** (`unifi.ui.com` is disabled — local-only admin account). All remote access goes through Alpuca as a jump host.

---

## Method 0: SSH aliases (fastest, when on home LAN)

On your dev Mac (and any machine where you set this up), `~/.ssh/config` should define `alpuca` (LAN-primary), `alpuca-ts` (Tailscale fallback), `alpuca-cf` (Cloudflare tunnel), and `udm` (UDM Pro via ProxyJump alpuca). Plus a `udm` shell wrapper that handles password auth via Bitwarden.

**Result — same as the longer recipes below, but typed as:**

```bash
ssh alpuca                          # SSH to Alpuca over LAN
ssh alpuca-ts                       # SSH to Alpuca over Tailscale (if on tailnet)
udm                                 # interactive root shell on UDM Pro
udm 'dpkg -l | grep unifi'          # one-shot command on UDM
udm 'cat /etc/iptables.rules'       # any command, with ProxyJump + password auth handled
```

ControlMaster is enabled on the `alpuca*` hosts, so repeated commands in a 10-minute window reuse one TCP session (~40ms vs ~500ms per call).

### Setup on a new machine

Add to `~/.ssh/config`:

```ssh-config
Host alpuca
  HostName 192.168.1.200
  User paca

Host alpuca-ts
  HostName 100.74.59.97
  User paca

Host alpuca-cf
  HostName ssh.alpacaplayhouse.com
  User paca
  ProxyCommand cloudflared access ssh --hostname %h

Host alpuca alpuca-ts alpuca-cf
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m

Host udm
  HostName 192.168.1.1
  User root
  ProxyJump alpuca
  PubkeyAuthentication no
  PreferredAuthentications keyboard-interactive,password
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

Then drop `~/bin/udm` (already on your dev Mac — see Bitwarden item "UniFi Dream Machine Pro — Network Gateway" / field "SSH Password" for the script's data source). The wrapper reads the password from BW and runs `sshpass -p "$PASS" ssh udm "$@"`.

**Why `keyboard-interactive` not `password`:** the UDM only advertises `publickey,keyboard-interactive` — setting `PreferredAuthentications password` causes "Permission denied" because there's nothing for ssh to try. `sshpass` handles keyboard-interactive fine.

**To switch alpuca primary to Tailscale instead** (e.g. when this machine lives off-LAN), swap the HostNames between `alpuca` and `alpuca-ts`.

---

## Method 1: Tailscale (preferred)

Requires Tailscale running on your machine and the target device.

```bash
# Start Tailscale if needed
# macOS: open Tailscale app, or:
/Applications/Tailscale.app/Contents/MacOS/Tailscale up

# SSH to Alpuca
ssh -o StrictHostKeyChecking=no paca@100.74.59.97

# SSH to Almaca
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43

# SSH to UDM via Alpuca
ssh -o StrictHostKeyChecking=no paca@100.74.59.97 \
  "sshpass -p '\$(bw-read \"UniFi Dream Machine Pro — Network Gateway\" \"SSH Password\")' \
  ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1"

# Port-forward UDM web UI (local:8443 -> UDM:443)
ssh -o StrictHostKeyChecking=no -f -N -L 8443:192.168.1.1:443 paca@100.74.59.97
# Then open: https://localhost:8443/  (accept self-signed cert)
# Login: alpacaauto / (BW: "UniFi Dream Machine Pro — Network Gateway")

# Kill the tunnel when done
lsof -ti:8443 | xargs kill
```

### Tailscale IPs

| Device | Tailscale IP | Role |
|--------|-------------|------|
| Alpuca (Mac Mini M4) | `100.74.59.97` | Home server, jump host to LAN |
| M4 Air (Rahul portable) | `100.114.248.79` | Dev machine |
| M2AirMac | `100.71.62.48` | Secondary |
| Almaca (MacBook Pro 16) | `100.115.27.43` | Legacy — avoid |
| AlpineMac (MacBook Pro 15) | `100.67.3.39` | Kiosk |
| Entry Tablet (Galaxy Tab) | `100.103.110.7` | Hall kiosk |

### Friendly DNS name — `mac.alpu.ca` (Finder SMB · Screen Sharing · SSH)

`mac.alpu.ca` is a public Cloudflare A record → Alpuca's Tailscale IP `100.74.59.97`. It exists so you can reach Alpuca by an easy name **without** relying on Tailscale MagicDNS, which isn't configured on every client (e.g. `alpuca.tail9c9221.ts.net` does **not** resolve in Finder on rahul-m4-airtop — that's the exact failure this name fixes).

| Service | Connect with | How |
|---|---|---|
| Files (SMB) | `smb://mac.alpu.ca` | Finder → **Go → Connect to Server** (⌘K) |
| Screen sharing (VNC) | `vnc://mac.alpu.ca` | Finder ⌘K, or Screen Sharing.app |
| Shell (SSH) | `ssh paca@mac.alpu.ca` | terminal (same as `paca@100.74.59.97`) |

- **On-tailnet only.** It resolves for everyone, but `100.74.59.97` is a Tailscale CGNAT address — it only *connects* from devices joined to the tailnet. Off-tailnet, use Method 2 (Cloudflare tunnel) for SSH.
- **Maintenance.** Tailscale IPs are sticky — they change only if Alpuca is removed and re-added to the tailnet. If that happens, update the A record. `alpu.ca` lives on a **separate** Cloudflare account (`rahulioson@gmail.com`, NS `luke/lisa`), not the main `wingsiebird` one. Edit it via the **`Cloudflare-D1`** token field of Bitwarden item **`Cloudflare — Rah Hul Account (alpu.ca)`** (zone id `5258bd9d21828c4a66c318a5d085fa0c`). Per that item's notes legend, both `Cloudflare-D1` (Zone DNS + Page Rules) and `Cloudflare-D2` (Zone DNS + Email Routing) have DNS edit; `Token Factory` / `Redirect Rules Token` do not. _(Record added 2026-06-08.)_

### Almaca Volume Checks

Use this from any machine with the repo and Tailscale access to verify the legacy Almaca MacBook and its mounted volumes.

```bash
# Preferred route: Tailscale
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43 \
  'hostname; scutil --get ComputerName 2>/dev/null || true; ls -la /Volumes'

# Confirm SW-SDCAM is mounted on Almaca
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43 \
  'test -d /Volumes/SW-SDCAM && df -h /Volumes/SW-SDCAM && mount | grep -i SW-SDCAM'

# If known_hosts has a stale key for the Tailscale IP, use a temporary known-hosts file for one-off verification
ssh -o UserKnownHostsFile=/tmp/almaca-known-hosts \
  -o StrictHostKeyChecking=accept-new \
  alpaca@100.115.27.43 \
  'hostname; ls -la /Volumes; df -h /Volumes/SW-SDCAM 2>/dev/null || true'
```

Expected `SW-SDCAM` mount when present:

```text
/dev/disk2s1 on /Volumes/SW-SDCAM (exfat, local, nodev, nosuid, noowners)
```

LAN fallback when on the home network:

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@192.168.1.74 \
  'hostname; ls -la /Volumes; df -h /Volumes/SW-SDCAM 2>/dev/null || true'
```

---

## Method 2: Cloudflare Tunnel (no Tailscale needed)

Uses Cloudflare Zero Trust + tunnel. No open ports on the network. Requires `cloudflared` installed locally.

```bash
# Install (one-time)
brew install cloudflared

# 1. Start local TCP proxy (runs in background, no browser auth needed)
cloudflared access tcp \
  --hostname ssh.alpacaplayhouse.com \
  --url localhost:2225 \
  --service-token-id "$(bw-read 'Cloudflare Access — Alpuca SSH Service Token' 'Client ID')" \
  --service-token-secret "$(bw-read 'Cloudflare Access — Alpuca SSH Service Token' 'Client Secret')" &

# 2. SSH to Alpuca
ssh -o StrictHostKeyChecking=no -p 2225 paca@localhost

# 3. SSH to UDM via Alpuca
ssh -o StrictHostKeyChecking=no -p 2225 paca@localhost \
  "sshpass -p '\$(bw-read \"UniFi Dream Machine Pro — Network Gateway\" \"SSH Password\")' \
  ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1"

# 4. Port-forward UDM web UI
ssh -o StrictHostKeyChecking=no -f -N -p 2225 -L 8443:192.168.1.1:443 paca@localhost
# Then open: https://localhost:8443/

# 5. Kill proxy when done
pkill -f "cloudflared access tcp"
```

### Gotchas

- **Must use `--service-token-id` and `--service-token-secret` flags.** Env vars (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) do NOT work with `cloudflared access tcp`.
- If you visit `ssh.alpacaplayhouse.com` in a browser, you'll see a Cloudflare Access login page asking for an email. That's browser-based OTP auth — the service token approach above bypasses it entirely.
- The tunnel config is **remotely managed** via the Cloudflare dashboard/API. The local config file on Alpuca (`~/.cloudflared/config.yml`) is overridden by remote config.

### Cloudflare Access Setup Reference

- **Access App:** "Alpuca SSH" (type: self_hosted, domain: ssh.alpacaplayhouse.com)
- **Service Token:** "Alpuca SSH Service Token"
- **Allowed emails (browser OTP fallback):** rahulioson@gmail.com, wingsiebird@gmail.com, auto@alpacaplayhouse.com
- **Tunnel:** `alpaca-cam` (ID: 7a786e40), ingress: `ssh.alpacaplayhouse.com → tcp://localhost:22`
- **Cloudflare account:** wingsiebird@gmail.com (account ID in BW: "Cloudflare — DNS + Domain Management")

---

## Method 3: UDM Port Forward (last resort)

Uses an iptables NAT rule on the UDM to forward a public port to Alpuca's SSH. **Rules do NOT persist across UDM reboots.**

```bash
# SSH to Alpuca via public IP
ssh -o StrictHostKeyChecking=no -p 2222 paca@66.68.143.215

# Port-forward UDM web UI
ssh -o StrictHostKeyChecking=no -f -N -p 2222 -L 8443:192.168.1.1:443 paca@66.68.143.215
# Then open: https://localhost:8443/
```

### Re-adding the port forward after UDM reboot

Requires Tailscale or Cloudflare tunnel to reach Alpuca first:

```bash
# Via Tailscale (or replace with Cloudflare proxy)
ssh paca@100.74.59.97 "sshpass -p '\$(bw-read \"UniFi Dream Machine Pro — Network Gateway\" \"SSH Password\")' \
  ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1 \
  'iptables -t nat -I PREROUTING -i eth8 -p tcp --dport 2222 -j DNAT --to-destination 192.168.1.200:22 && \
   iptables -I FORWARD -p tcp -d 192.168.1.200 --dport 22 -j ACCEPT'"
```

---

## Method Comparison

| Method | Needs installed | Survives UDM reboot | Open ports | Security |
|--------|----------------|---------------------|------------|----------|
| Tailscale | Tailscale app | Yes | None | Encrypted mesh VPN |
| Cloudflare tunnel | `cloudflared` CLI | Yes | None | Zero Trust + service token |
| UDM port forward | Nothing | **No** | Port 2222 exposed | SSH key auth only |

---

## UDM Pro Access

| Account | Method | Permissions | Use for |
|---------|--------|-------------|---------|
| `root` | SSH only | Full root shell | Firewall rules, iptables, system config |
| `alpacaauto` | Web API | Super Admin (read-write with CSRF) | Network settings, client listing |

**UDM SSH requires `-o PubkeyAuthentication=no`** — without it, SSH tries pubkey, fails, then keyboard-interactive skips the password prompt. The `Host udm` block in **Method 0** sets this; if invoking ssh by hand, add the flag.

**Cloud remote access (`unifi.ui.com`) is DISABLED.** The admin account is local-only (no Ubiquiti SSO linked). To enable: UDM web UI → Settings → System → Administration → Remote Access.

---

*Last tested: 2026-05-11*
