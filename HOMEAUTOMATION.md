# Home Automation System

Programmatic control of Sonos speakers, UniFi network, cameras, and lighting at GenAlpaca Residency.

> **See `HOMEAUTOMATION.local.md` for IP addresses, credentials, and sensitive configuration.**
> That file is gitignored and contains Tailscale IPs, WiFi passwords, and API credentials.

## Architecture

```
┌─────────────────────┐                          ┌──────────────────┐
│  DO Droplet          │                          │  Alpaca Mac      │
│  (openclawzcloud-    │───── Tailscale VPN ────►│  (home server)   │
│   runner)            │    (subnet routing)      │                  │
│                      │                          │  node-sonos-     │
│  - Cron alarms       │  ┌─ direct LAN access ─►│   http-api :5005 │
│  - Bot triggers      │  │  192.168.1.0/24      │  MediaMTX  :8554 │
│  - UDM Pro API calls │  │  (via subnet route)  │  SSH       :22   │
│  - Lighting control  │  │                       │  pywizlight      │
└──────────┬──────────┘  │                       └────────┬─────────┘
           │              │                                │
           └──────────────┘                   LAN (192.168.1.0/24)
                                                          │
              ┌───────────────────┬───────────────────────┤
              │                   │                       │
    ┌────────▼─────────┐ ┌──────▼──────────┐  ┌────────▼─────────┐
    │  UDM Pro          │ │  Smart Lights    │  │  Sonos Speakers   │
    │  192.168.1.1      │ │                  │  │  12 zones         │
    │                   │ │  WiZ (11 bulbs)  │  │                   │
    │  - Network API    │ │  Govee (~19)     │  │  Living Sound     │
    │  - UniFi Protect  │ │  Kasa (1 switch) │  │  MasterBlaster    │
    │  - WireGuard VPN  │ │  Tuya (2)        │  │  DJ, Backyard...  │
    │  - DHCP/Firewall  │ │  Matter (13)     │  │  (see full list)  │
    └───────────────────┘ └──────────────────┘  └──────────────────┘
```

### Connectivity Model

The DO droplet has **direct access to the entire LAN** (`192.168.1.0/24`) via Tailscale subnet routing through the Alpaca Mac. This means:

- **Sonos:** Droplet curls `http://<alpaca-tailscale-ip>:5005/{room}/{action}` (Sonos API runs on Alpaca Mac)
- **UDM Pro API:** Droplet curls `https://192.168.1.1/api/...` directly (session-based cookie auth)
- **UniFi Protect:** Droplet curls `https://192.168.1.1/proxy/protect/api/...` directly
- **WiZ Lights:** Droplet sends commands via SSH to Alpaca Mac (UDP requires LAN presence)
- **Govee Lights:** Cloud API from anywhere, or LAN control via Alpaca Mac
- **All other LAN devices:** Reachable from droplet at their `192.168.1.x` IPs

## Network Topology

### UniFi Dream Machine Pro

- **Router/Gateway:** `192.168.1.1`
- **WAN:** Spectrum (66.68.143.215)
- **Single VLAN:** Default network `192.168.1.0/24` (all devices on same subnet)
- **WireGuard VPN Server:** Configured on WAN1

### WiFi Networks

All three SSIDs are on the **Native Network** (same `192.168.1.0/24` subnet):

| SSID | Purpose | Clients |
|------|---------|---------|
| **Black Rock City** | Main network, Sonos speakers, most devices | ~99 |
| **Alpacalypse** | Secondary | ~6 |
| **the password is: Eight Sm...** | Guest-facing | ~2 |

### Tailscale Mesh VPN

Tailscale connects the DO droplet to the Alpaca Mac and the entire LAN:

| Machine | Tailscale IP | Hostname |
|---------|-------------|----------|
| DO Droplet | See `HOMEAUTOMATION.local.md` | openclawzcloudrunner |
| Alpaca Mac | See `HOMEAUTOMATION.local.md` | alpacaopenmac |

**Subnet Routing:** The Alpaca Mac advertises `192.168.1.0/24` to the Tailnet, allowing the DO droplet to reach any LAN device directly through Tailscale (no SSH hop needed for TCP/HTTPS traffic).

**Configuration:**
- Alpaca Mac: `tailscale up --advertise-routes=192.168.1.0/24`
- DO Droplet: `tailscale up --accept-routes`
- Alpaca Mac: IP forwarding enabled (`net.inet.ip.forwarding=1` in `/etc/sysctl.conf`)
- Tailscale Admin: Subnet route approved for `alpacaopenmac`

**Note:** UDP-based protocols (WiZ lights, Sonos mDNS discovery) still require executing commands on the Alpaca Mac via SSH, since Tailscale subnet routing only forwards TCP traffic reliably. The Sonos HTTP API on the Alpaca Mac handles this bridging for Sonos control.

## Alpaca Mac (Home Server)

A dedicated MacBook running macOS 12.7.6 (Monterey), lid closed, plugged in, on Black Rock City WiFi. Acts as a bridge between the DO droplet and local LAN devices.

### Configuration

- **Auto-login:** Enabled (recovers from power outages)
- **Sleep prevention:** "Prevent automatic sleeping when display is off" enabled under Power Adapter
- **Auto-updates:** Disabled (prevents unexpected restarts)
- **SSH:** Remote Login enabled for all users
- **Tailscale:** Auto-starts on login, advertises subnet route `192.168.1.0/24`
- **IP Forwarding:** Enabled (`net.inet.ip.forwarding=1` in `/etc/sysctl.conf`) — required for Tailscale subnet routing
- **sudo password:** See `HOMEAUTOMATION.local.md`

### Services Running

| Service | Port | Auto-Start | Purpose |
|---------|------|------------|---------|
| node-sonos-http-api | 5005 | launchd (`com.sonos.httpapi`) | Sonos speaker control |
| MediaMTX | 8554 | launchd (pending setup) | Camera RTSP restreaming |
| Tailscale | — | Login item | VPN mesh connectivity |

### Software Installed

- **Homebrew** (`/usr/local/bin/brew`)
- **Node.js 18.20.8** via nvm (`~/.nvm/versions/node/v18.20.8/`)
- **node-sonos-http-api** (`~/node-sonos-http-api/`)
- **Tailscale** (`/Applications/Tailscale.app`)

### launchd Service: Sonos API

Plist: `~/Library/LaunchAgents/com.sonos.httpapi.plist`

- `KeepAlive: true` — auto-restarts on crash
- `RunAtLoad: true` — starts when user logs in
- `ThrottleInterval: 10` — 10s delay between crash restarts
- Logs: `~/node-sonos-http-api/logs/stdout.log` and `stderr.log`

**Manage the service:**
```bash
# Check status
launchctl list | grep sonos

# Restart
launchctl unload ~/Library/LaunchAgents/com.sonos.httpapi.plist
launchctl load ~/Library/LaunchAgents/com.sonos.httpapi.plist

# View logs
tail -f ~/node-sonos-http-api/logs/stdout.log
```

## Sonos System

### Speaker Rooms (12 zones)

| Room | Notes |
|------|-------|
| Outhouse | Front yard bathroom |
| Living Sound | Main living area |
| SkyBalcony Sound | Sky balcony |
| MasterBlaster | Master bedroom |
| Pequeno | Small room |
| Dining Sound | Dining area |
| Garage Bridge - no sound | Garage bridge (no speaker output) |
| Front Outside Sound | Front outdoor area |
| DJ | DJ setup |
| Backyard Sound | Backyard |
| Skyloft Sound | Skyloft area |
| garage outdoors | Garage outdoor area |

### Sonos HTTP API

Base URL (from Alpaca Mac): `http://localhost:5005`
Base URL (from DO Droplet via Tailscale): `http://<alpaca-mac-tailscale-ip>:5005`

Room names are case-insensitive. Spaces in room names use `%20` in URLs.

#### Playback Control

```bash
# Play / Pause / Toggle
GET /{room}/play
GET /{room}/pause
GET /{room}/playpause

# Next / Previous track
GET /{room}/next
GET /{room}/previous

# Get current state (track info, volume, playback state)
GET /{room}/state
```

#### Volume

```bash
GET /{room}/volume/{0-100}        # Set absolute volume
GET /{room}/volume/+5             # Increase by 5
GET /{room}/volume/-5             # Decrease by 5
GET /{room}/groupVolume/{0-100}   # Set volume for entire group
GET /{room}/mute
GET /{room}/unmute
```

#### Favorites & Playlists

```bash
GET /{room}/favorite/{name}       # Play a Sonos favorite by name
GET /{room}/favorites             # List all favorites
GET /{room}/playlist/{name}       # Play a Sonos playlist
GET /{room}/queue                 # View current queue
GET /{room}/clearqueue            # Clear the queue
```

#### Text-to-Speech (TTS)

Uses macOS built-in `say` command (configured as `macSay` provider):

```bash
GET /{room}/say/{message}                    # Default language and volume
GET /{room}/say/{message}/en-us/{volume}     # With language and volume
GET /sayall/{message}                        # Announce on ALL speakers
```

#### Audio Clips

Place MP3 files in `~/node-sonos-http-api/static/clips/`, then:

```bash
GET /{room}/clip/{filename}/{volume}    # Play clip on one speaker
GET /clipall/{filename}                  # Play on all speakers
```

#### Speaker Grouping

```bash
GET /{room}/join/{other-room}     # Add room to other-room's group
GET /{room}/leave                 # Remove room from its group
```

#### Music Search (requires service credentials)

```bash
GET /{room}/musicsearch/deezer/song/{query}      # Search Deezer
GET /{room}/musicsearch/apple/song/{query}        # Search Apple Music
GET /{room}/musicsearch/spotify/song/{query}      # Search Spotify (blocked)
```

#### System-Wide

```bash
GET /zones                        # List all zones and their states
GET /pauseall                     # Pause everything
GET /resumeall                    # Resume everything
GET /reindex                      # Re-discover speakers
GET /lockvolumes                  # Lock all volumes
GET /unlockvolumes                # Unlock volumes
```

#### Presets

Create JSON files in `~/node-sonos-http-api/presets/`:

```json
{
  "players": [
    { "roomName": "Living Sound", "volume": 20 },
    { "roomName": "Dining Sound", "volume": 15 }
  ],
  "favorite": "Deep Focus",
  "playMode": { "shuffle": true, "repeat": "all" },
  "pauseOthers": true
}
```

Trigger with: `GET /preset/{preset-name}`

#### Sleep Timer

```bash
GET /{room}/sleep/{seconds}       # Set sleep timer
GET /{room}/sleep/off             # Cancel sleep timer
```

### Settings

Config file: `~/node-sonos-http-api/settings.json`

```json
{
  "port": 5005,
  "ip": "0.0.0.0",
  "announceVolume": 35,
  "tts": {
    "provider": "macSay",
    "voice": "Samantha"
  }
}
```

### Music Services

| Service | Status | Notes |
|---------|--------|-------|
| **Sonos Favorites** | Working | Play any saved favorite by name. Best current option. |
| **Deezer** | Available | Free API, no approval needed. Must link Deezer account in Sonos app first. |
| **Spotify** | Blocked | Developer portal on hold, can't create new apps. |
| **Apple Music** | Requires setup | Needs Apple Developer account ($99/yr) for MusicKit API keys. |
| **YouTube Music** | Not supported | Sonos doesn't expose YouTube Music via UPnP/HTTP API. |
| **TuneIn Radio** | Working | Built into Sonos, no config needed. |

### Important Notes

- **Must use Node.js 18** — Node 20+ has unresolved keep-alive bugs with this project
- **Speakers discovered via mDNS/SSDP** — Alpaca Mac must be on the same subnet as Sonos speakers
- **Sonos S1 vs S2** — Check which system version the speakers use. The API works with both but mixed environments can cause discovery issues.

## UniFi Dream Machine Pro — Network API

The UDM Pro exposes a local REST API for full network management.

### Authentication

Uses session-based cookie auth (NOT API keys). Uses the `alpacaauto` local-only admin account (credentials in `HOMEAUTOMATION.local.md`).

```bash
# Login (from DO droplet — has direct LAN access via Tailscale subnet routing)
# Write credentials to a JSON file first to avoid shell escaping issues with special characters
cat > /tmp/unifi_login.json << 'EOF'
{"username":"alpacaauto","password":"SEE_LOCAL_MD"}
EOF

curl -k -X POST \
  -H 'Content-Type: application/json' \
  -d @/tmp/unifi_login.json \
  -c /tmp/unifi_cookies.txt \
  https://192.168.1.1/api/auth/login

# Use cookies for subsequent calls
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/network/api/s/default/rest/firewallrule

# Check network health
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/network/api/s/default/stat/health
```

**Important:** The password contains `!` which bash interprets as history expansion. Always use a file (`-d @file`) or single-quoted heredoc to avoid escaping issues.

### Key API Endpoints

All network endpoints are prefixed with `/proxy/network/api/s/default/`:

| Resource | Endpoint | CRUD |
|----------|----------|------|
| WiFi networks | `rest/wlanconf` | Full |
| Firewall rules | `rest/firewallrule` | Full |
| Firewall groups | `rest/firewallgroup` | Full |
| Port forwarding | `rest/portforward` | Full |
| Networks/VLANs/DHCP | `rest/networkconf` | Full |
| Static routes | `rest/routing` | Full |
| Connected clients | `stat/sta` | Read + commands |
| Devices (APs, switches) | `stat/device` | Read + commands |
| Site health | `stat/health` | Read |
| System info | `stat/sysinfo` | Read |

### Libraries

- **Node.js:** `node-unifi` (npm)
- **Python:** `pyunifi` (pip)
- **Infrastructure as Code:** Terraform/Pulumi `unifi` provider

## UniFi Protect — Camera Streaming

### Enabling RTSP

RTSP is off by default. For each camera:

1. UniFi Protect → Select Camera → Settings → Advanced → **Enable RTSP**
2. Copy the RTSPS URL (unique per camera per quality level)

### RTSP URL Format

```
rtsps://192.168.1.1:7441/<unique_stream_token>
```

- Uses TLS (`rtsps://`) on port **7441**
- Self-signed certificate — clients must accept/ignore it
- Each camera gets a unique token copied from the UI

### MediaMTX (Restreaming)

MediaMTX converts RTSPS from UniFi Protect into standard RTSP/HLS/WebRTC:

Config (`mediamtx.yml`):
```yaml
paths:
  front-door:
    source: rtsps://192.168.1.1:7441/TOKEN_HERE
    sourceFingerprint: ""
  side-yard:
    source: rtsps://192.168.1.1:7441/TOKEN_HERE
    sourceFingerprint: ""
```

Access at: `rtsp://<alpaca-mac-ip>:8554/front-door`

### Programmatic API

The UDM Pro has an unofficial but stable local API for Protect:

```
GET https://192.168.1.1/proxy/protect/api/bootstrap    # Full config
GET https://192.168.1.1/proxy/protect/api/cameras       # List cameras
GET /cameras/{id}/snapshot?ts=...                        # JPEG snapshot
```

Libraries: `unifi-protect` (npm), `pyunifiprotect` (pip)

## Scheduling & Alarms

Use cron on the DO droplet to trigger Sonos actions via Tailscale:

```bash
# Example: Wake-up alarm weekdays at 7am CT
0 7 * * 1-5 curl -s http://<alpaca-tailscale-ip>:5005/MasterBlaster/favorite/Morning%20Playlist
0 7 * * 1-5 curl -s http://<alpaca-tailscale-ip>:5005/MasterBlaster/volume/25

# Example: Nightly announcement at 10pm
0 22 * * * curl -s "http://<alpaca-tailscale-ip>:5005/sayall/Quiet%20hours%20start%20now"

# Example: Pause all music at midnight
0 0 * * * curl -s http://<alpaca-tailscale-ip>:5005/pauseall
```

## Common Commands (Quick Reference)

All commands assume running on the DO droplet. The droplet has direct LAN access via Tailscale subnet routing.

```bash
# === Sonos (via Alpaca Mac Sonos HTTP API) ===

# List all Sonos zones
curl -s http://<alpaca-tailscale-ip>:5005/zones | python3 -m json.tool

# Play a favorite
curl -s "http://<alpaca-tailscale-ip>:5005/Living%20Sound/favorite/Deep%20Focus"

# Set volume
curl -s "http://<alpaca-tailscale-ip>:5005/Living%20Sound/volume/25"

# TTS announcement
curl -s "http://<alpaca-tailscale-ip>:5005/sayall/Hello%20from%20the%20server"

# Pause everything
curl -s http://<alpaca-tailscale-ip>:5005/pauseall

# === UDM Pro Network API (direct access) ===

# Login (write creds to file first — see Authentication section)
curl -k -X POST -H 'Content-Type: application/json' \
  -d @/tmp/unifi_login.json -c /tmp/unifi_cookies.txt \
  https://192.168.1.1/api/auth/login

# Network health
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/network/api/s/default/stat/health

# List connected clients
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/network/api/s/default/stat/sta

# List firewall rules
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/network/api/s/default/rest/firewallrule

# === UniFi Protect (direct access) ===

# List cameras
curl -k -b /tmp/unifi_cookies.txt \
  https://192.168.1.1/proxy/protect/api/cameras

# === WiZ Lights (via SSH to Alpaca Mac — UDP requires LAN presence) ===

# Turn on a light
ssh alpaca@<alpaca-tailscale-ip> \
  "echo '{\"method\":\"setPilot\",\"params\":{\"state\":true,\"dimming\":80,\"temp\":3000}}' | nc -u -w1 192.168.1.108 38899"

# Turn off a light
ssh alpaca@<alpaca-tailscale-ip> \
  "echo '{\"method\":\"setPilot\",\"params\":{\"state\":false}}' | nc -u -w1 192.168.1.108 38899"

# === Infrastructure ===

# SSH to Alpaca Mac
ssh alpaca@<alpaca-tailscale-ip>

# Check Tailscale status
tailscale status
```

## Troubleshooting

### Sonos speakers not found (`/zones` returns empty)

1. Verify Alpaca Mac is on Black Rock City WiFi: `networksetup -getairportnetwork en0`
2. Check firewall isn't blocking UDP 1900/1905 (SSDP discovery)
3. Restart the Sonos API service (see launchd commands above)
4. Try `/reindex` to force re-discovery

### Can't SSH to Alpaca Mac from DO droplet

1. Check Tailscale is running on both: `tailscale status`
2. Verify both are on the same Tailnet (same account)
3. Check Alpaca Mac hasn't gone to sleep (power adapter must be connected)
4. If Mac rebooted, verify auto-login worked and Tailscale started

### Sonos API not responding after Mac reboot

1. SSH in and check: `launchctl list | grep sonos`
2. If not running, load it: `launchctl load ~/Library/LaunchAgents/com.sonos.httpapi.plist`
3. Check logs: `tail -20 ~/node-sonos-http-api/logs/stderr.log`

### TTS not working

1. Verify `macSay` is configured in `settings.json`
2. The Mac must have audio output capability (even with lid closed)
3. Check that the `say` command works locally: `say "test"`

### DO droplet can't reach LAN devices (192.168.1.x)

1. Check Tailscale on droplet accepts routes: `tailscale status` — look for "accept-routes" warning
2. If needed: `tailscale up --accept-routes`
3. Check Alpaca Mac is advertising routes: `tailscale status` on the Mac
4. If needed: `/Applications/Tailscale.app/Contents/MacOS/Tailscale up --advertise-routes=192.168.1.0/24`
5. Check IP forwarding on Alpaca Mac: `sysctl net.inet.ip.forwarding` (should be `1`)
6. If needed: `sudo sysctl -w net.inet.ip.forwarding=1`
7. Verify subnet route is approved in Tailscale admin: https://login.tailscale.com/admin/machines

### UDM Pro API login fails

1. Verify the `alpacaauto` account exists: check UniFi OS → Admins & Users
2. Ensure using file-based payload (`-d @/tmp/unifi_login.json`) to avoid shell escaping issues with `!` in password
3. Verify the droplet can reach `192.168.1.1`: `curl -k -s -o /dev/null -w '%{http_code}' https://192.168.1.1/`
4. Sessions expire — re-login if getting 401 responses

## Lighting System

The property has **100+ lights** across three ecosystems, plus Alexa and Matter integration.
Lighting has historically been managed ad-hoc through individual apps (WiZ, Govee Home, Alexa).
The goal is to unify control through the DO droplet → Alpaca Mac → local network chain.

### Ecosystem Overview

| Ecosystem | Count | Protocol | Control | Status |
|-----------|-------|----------|---------|--------|
| **WiZ** (Philips/Signify) | 11 discovered | UDP :38899 (local) | `pywizlight` CLI/Python | Working — fully controllable |
| **Govee** (ESP32-based) | ~19 suspected | UDP multicast (LAN) or Cloud REST API | `govee-py` / Govee Cloud API | LAN control disabled — need Govee Home app or Cloud API |
| **Matter** | 13 devices (2 fabrics) | mDNS/Matter over IP | `chip-tool` or Home Assistant | Discovered — need commissioning info |
| **TP-Link Kasa** | 2 (HS210 + HS220) | Cloud + local | `python-kasa` | Working — fully controllable |
| **Tuya** | 1+ device | Cloud + local | `tinytuya` | Discovered (192.168.1.69) |
| **Alexa** | Hub for voice control | Cloud | `alexa-remote-control` | 5 Amazon/Echo devices on network |

### WiZ Lights (11 discovered)

All WiZ bulbs are model **ESP05_SHRGBL_21** (RGBL color bulbs), firmware **1.35.0**, home ID **2901528**.

| IP | MAC | Room ID | Current Scene | Brightness |
|----|-----|---------|---------------|------------|
| 192.168.1.108 | a8:bb:50:81:64:99 | 4528222 | Cozy | 94/255 |
| 192.168.1.239 | a8:bb:50:81:51:af | 4528222 | Cozy | 94/255 |
| 192.168.1.90 | a8:bb:50:81:75:e4 | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.250 | a8:bb:50:81:57:0d | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.39 | a8:bb:50:81:ab:69 | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.216 | a8:bb:50:81:bc:74 | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.147 | a8:bb:50:81:9f:3e | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.242 | a8:bb:50:81:93:07 | 4352002 | Warm white (2700K) | 143/255 |
| 192.168.1.150 | a8:bb:50:81:c7:44 | 4937866 | Warm white (2700K) | 255/255 |
| 192.168.1.245 | a8:bb:50:82:01:ed | 4937866 | Warm white (2700K) | 255/255 |
| 192.168.1.85 | a8:bb:50:81:fe:44 | 4937866 | Warm white (2700K) | 255/255 |

**Room ID groupings** (from WiZ app, names TBD):
- Room 4528222: 2 bulbs (Cozy scene)
- Room 4352002: 6 bulbs (Warm white)
- Room 4937866: 3 bulbs (Warm white, full brightness)

#### WiZ Control (pywizlight)

Installed on Alpaca Mac at `/Users/alpaca/Library/Python/3.9/bin/wizlight`.

```bash
# From Alpaca Mac (or via SSH from droplet)
# Discover all WiZ lights
/Users/alpaca/Library/Python/3.9/bin/wizlight discover --b 192.168.1.255

# Turn on/off
/Users/alpaca/Library/Python/3.9/bin/wizlight on --ip 192.168.1.108 --brightness 128
/Users/alpaca/Library/Python/3.9/bin/wizlight off --ip 192.168.1.108

# Set color temperature
/Users/alpaca/Library/Python/3.9/bin/wizlight on --ip 192.168.1.108 --k 3000 --brightness 200

# Check state
/Users/alpaca/Library/Python/3.9/bin/wizlight state --ip 192.168.1.108
```

**Raw UDP control** (no library needed):
```bash
# Turn on (warm white, 80% brightness)
echo '{"method":"setPilot","params":{"state":true,"dimming":80,"temp":3000}}' | nc -u -w1 192.168.1.108 38899

# Turn off
echo '{"method":"setPilot","params":{"state":false}}' | nc -u -w1 192.168.1.108 38899

# Set RGB color
echo '{"method":"setPilot","params":{"state":true,"r":255,"g":100,"b":0,"dimming":80}}' | nc -u -w1 192.168.1.108 38899

# Get current state
echo '{"method":"getPilot"}' | nc -u -w1 192.168.1.108 38899

# Get system info
echo '{"method":"getSystemConfig"}' | nc -u -w1 192.168.1.108 38899
```

### Govee Lights (~19 suspected devices)

Govee devices use Espressif ESP32 chipsets (MAC prefix `dc:b4:d9`). They do **not** respond to LAN API scans — LAN Control must be enabled per-device in the Govee Home app, or use the cloud API.

**Suspected Govee device IPs** (all `dc:b4:d9:*` MAC addresses):
```
192.168.1.27   dc:b4:d9:5a:11:34
192.168.1.38   dc:b4:d9:58:24:2c
192.168.1.44   dc:b4:d9:4d:1c:dc
192.168.1.63   dc:b4:d9:4c:a4:84
192.168.1.81   dc:b4:d9:58:48:28
192.168.1.107  dc:b4:d9:5a:12:14
192.168.1.109  dc:b4:d9:58:3a:8c
192.168.1.125  dc:b4:d9:4d:47:d4
192.168.1.137  dc:b4:d9:59:42:50
192.168.1.140  dc:b4:d9:59:28:10
192.168.1.165  dc:b4:d9:58:3a:c8
192.168.1.167  dc:b4:d9:56:91:24  (also advertises as "espressif" in mDNS)
192.168.1.171  dc:b4:d9:56:8d:ec
192.168.1.175  dc:b4:d9:4d:29:88
192.168.1.185  dc:b4:d9:5a:06:c8
192.168.1.197  dc:b4:d9:58:39:5c
192.168.1.224  dc:b4:d9:5a:07:7c
192.168.1.235  dc:b4:d9:59:46:e8
192.168.1.252  dc:b4:d9:58:1a:88
```

#### Govee Cloud API

To use the cloud API (works from DO droplet, no local network needed):

1. Open Govee Home app → Profile icon → Settings (gear) → **"Apply for API Key"**
2. Or visit: https://developer.govee.com/reference/apply-you-govee-api-key
3. API key arrives via email

```bash
# List all devices
curl -s -H "Govee-API-Key: YOUR_KEY" \
  https://developer.govee.com/router/api/v1/user/devices

# Turn on a device
curl -s -X POST -H "Govee-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  https://developer.govee.com/router/api/v1/device/control \
  -d '{"requestId":"1","payload":{"sku":"MODEL","device":"DEVICE_MAC","capability":{"type":"devices.capabilities.on_off","instance":"powerSwitch","value":1}}}'
```

#### Enabling Govee LAN Control

For each Govee device, in the Govee Home app:
1. Select device → Settings (gear icon) → scroll down → **LAN Control** → toggle ON

Once enabled, devices respond to multicast discovery on `239.255.255.250:4001` and accept commands on UDP port 4003.

### Matter Devices (13 discovered)

Found via mDNS `_matter._tcp` browsing. Two distinct fabric IDs suggest two different Matter controllers:

**Fabric 74593773AA15087D** (10 devices — likely Alexa/Echo):
| Instance | Port |
|----------|------|
| 74593773AA15087D-05E73316C9F48CB1 | 5541 (at F7E8EADE257E.local.) |
| 74593773AA15087D-016F6A8E1A442571 | — |
| 74593773AA15087D-024300462FDF9C51 | — |
| 74593773AA15087D-05E7A8B34EDB3ED1 | — |
| 74593773AA15087D-0189460B60EF8841 | — |
| 74593773AA15087D-0178C9DDA6C5E591 | — |
| 74593773AA15087D-01690F9729249281 | — |
| 74593773AA15087D-0166EC3EC8260591 | — |
| 74593773AA15087D-0242FD532D42EDE1 | — |
| 74593773AA15087D-018000081D063A71 | — |

**Fabric 2E3FA401322CBB40** (3 devices — likely Google/Nest):
| Instance | Host | Port |
|----------|------|------|
| 2E3FA401322CBB40-00000000BAF5E0E7 | 14C14E7A940D.local. | 5540 |
| 2E3FA401322CBB40-0000000068A6F13E | 14C14E2DAE0D.local. | 5540 |
| 2E3FA401322CBB40-0000000025D77772 | 14C14EB58EEB.local. | 5540 |

The `14C14E*` hostnames correspond to Google/Nest devices (Nest thermostats at .111, .139, .249 in ARP table). These 3 Matter devices are the **Nest thermostats** themselves advertising Matter support.

### TP-Link Kasa Devices (2 discovered)

Discovered via `python-kasa` (installed on Alpaca Mac at `/Users/alpaca/Library/Python/3.9/bin/kasa`).

| Device | IP | Model | Room | State | Extra |
|--------|-----|-------|------|-------|-------|
| **Stair Landing** | 192.168.1.230 | HS210(US) | Stair landing | ON | 3-way wall switch, MAC 5C:A6:E6:D3:F5:CB |
| **Nook** | 192.168.1.101 | HS220(US) | Nook | ON (25% brightness) | Dimmer switch, MAC 00:5F:67:10:F9:51 |

```bash
# From Alpaca Mac — discover TP-Link devices
/Users/alpaca/Library/Python/3.9/bin/kasa discover

# Turn on/off
/Users/alpaca/Library/Python/3.9/bin/kasa --host 192.168.1.230 on
/Users/alpaca/Library/Python/3.9/bin/kasa --host 192.168.1.230 off

# Set brightness (HS220 dimmer only)
/Users/alpaca/Library/Python/3.9/bin/kasa --host 192.168.1.101 brightness 50
```

### Tuya Devices (1 discovered via broadcast)

Discovered via `tinytuya` (installed on Alpaca Mac).

| Device | IP | Tuya ID | Protocol | Notes |
|--------|-----|---------|----------|-------|
| Unknown | 192.168.1.69 | eb5675c98829e89548zvya | 3.3 | Responds to tinytuya broadcast |

**Additional Tuya-OUI devices** (MAC prefix `18:de:50`, not responding to Tuya broadcast):
- `192.168.1.164` (18:de:50:5f:66:90)
- `192.168.1.219` (18:de:50:5f:67:4c)

These may be Tuya-based devices from a white-label brand (many smart plugs, sensors use Tuya chipsets).

### Other Smart Devices on Network

| Device | IP | MAC/OUI | Type |
|--------|-----|---------|------|
| VIZIO TV (HomeKit) | — | — | TV/display |
| Nest Thermostat | 192.168.1.111 | 14:c1:4e (Google) | Thermostat |
| Nest Thermostat | 192.168.1.139 | 14:c1:4e (Google) | Thermostat |
| Nest Thermostat | 192.168.1.249 | 14:c1:4e (Google) | Thermostat |
| Amazon Echo (dot?) | 192.168.1.42 | — | Voice assistant |
| Amazon Echo (dot?) | 192.168.1.100 | — | Voice assistant |
| Echo Show | 192.168.1.131 | — | Voice assistant + screen |
| Echo Show | 192.168.1.184 | — | Voice assistant + screen |
| Amazon device | 192.168.1.190 | — | Echo/Fire device |
| Amazon device | 192.168.1.213 | — | Echo/Fire device |
| Amazon device | 192.168.1.229 | — | Echo/Fire device |
| HP Printer | 192.168.1.64 | b0:5c:da (HP) | Printer |
| LG Smart Dryer | 192.168.1.22 | ac:f1:08 (LG) | Appliance |
| Roku (Jon's) | 192.168.1.163 | d4:e2:2f (Roku) | Streaming |
| ESP32 device | 192.168.1.49 | 3c:84:27 (Espressif) | IoT device |

### Alexa Devices (7 on network)

Amazon/Echo devices serve as the current voice control hub for lights:
- `192.168.1.42` — amazon-080d0e2f9
- `192.168.1.100` — amazon-7c33ec9c38900cc0
- `192.168.1.131` — echoshow-3bf32cb7f1ef46a6
- `192.168.1.184` — echoshow-9f2eb6d9d752aab3
- `192.168.1.190` — amazon-67f77a339
- `192.168.1.213` — amazon-14ea528bd
- `192.168.1.229` — amazon-20cb70679

To query all Alexa-registered devices (including lights, smart plugs, etc.):
1. Install [alexa-remote-control](https://github.com/thorsten-gehrig/alexa-remote-control) on the DO droplet
2. Use [alexa-cookie-cli](https://github.com/adn77/alexa-cookie-cli) for one-time browser auth
3. Run `./alexa_remote_control.sh -l` to list all registered smart home devices

### Alexa Authentication (for full device inventory)

`alexa-remote-control` is installed at `/opt/alexa-remote-control/` on the DO droplet, configured for US (amazon.com).

**To generate a refresh token:**
1. Run the auth proxy: `cd /opt/alexa-remote-control && node alexa_auth.js`
2. Open `http://159.89.157.120:3001` in browser
3. Log into Amazon with the Alexa account
4. Copy the `REFRESH_TOKEN` from the server output
5. Set it: `export REFRESH_TOKEN="Atnr|..."`
6. Run: `./alexa_remote_control.sh -l` to list ALL devices

**Dependencies installed:**
- `alexa-cookie2` (npm, in `/opt/alexa-remote-control/node_modules/`)
- `jq` (system package)

### Software Installed on Alpaca Mac for Lighting

| Tool | Path | Purpose |
|------|------|---------|
| `pywizlight` | `/Users/alpaca/Library/Python/3.9/bin/wizlight` | WiZ light discovery & control |
| `python-kasa` | `/Users/alpaca/Library/Python/3.9/bin/kasa` | TP-Link Kasa discovery & control |
| `tinytuya` | (Python library) | Tuya device discovery & control |

### TODO: Lighting Catalog

- [ ] **Map WiZ room IDs to physical rooms** — Open WiZ app, note which room each bulb is assigned to
- [ ] **Get Govee API key** — Govee Home → Profile → Settings → Apply for API Key (or https://developer.govee.com)
- [ ] **Enable Govee LAN Control** — In Govee Home app per-device: Settings → LAN Control → ON
- [ ] **Get Alexa refresh token** — Log into http://159.89.157.120:3001 and save the token
- [ ] **Identify Tuya device at 192.168.1.69** — Check Tuya/Smart Life app
- [ ] **Identify Tuya-OUI devices at .164 and .219** — May be white-label Tuya
- [ ] **Identify Matter devices** — The 10 Alexa-fabric Matter devices are likely Govee/WiZ re-exposed via Alexa's Matter bridge
- [ ] **Count remaining lights** — Many Govee lights (strip lights, panels, etc.) may be cloud-only
