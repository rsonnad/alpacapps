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
│  - Bot triggers      │  │  192.168.1.0/24      │  go2rtc    :1984 │
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
    │  - UniFi Protect  │ │  Kasa (2 switches)│  │  MasterBlaster    │
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
| Alpaca Mac | See `HOMEAUTOMATION.local.md` | alpacaopenmac-1 |

**Subnet Routing:** The Alpaca Mac advertises `192.168.1.0/24` to the Tailnet, allowing the DO droplet to reach any LAN device directly through Tailscale (no SSH hop needed for TCP/HTTPS traffic).

**Configuration:**
- Alpaca Mac: `tailscale up --advertise-routes=192.168.1.0/24`
- DO Droplet: `tailscale up --accept-routes`
- Alpaca Mac: IP forwarding enabled (`net.inet.ip.forwarding=1` in `/etc/sysctl.conf`)
- Tailscale Admin: Subnet route approved for `alpacaopenmac`

**Note:** UDP-based protocols (WiZ lights, Sonos mDNS discovery) still require executing commands on the Alpaca Mac via SSH, since Tailscale subnet routing only forwards TCP traffic reliably. The Sonos HTTP API on the Alpaca Mac handles this bridging for Sonos control.

## Alpaca Mac (Home Server)

A dedicated MacBook running macOS 12.7.6 (Monterey), lid closed, plugged in, on Black Rock City WiFi. Acts as a bridge between the DO droplet and local LAN devices.

### Bulletproof Configuration

The Mac is configured to survive power outages, reboots, and network disruptions without any human intervention.

**Auto-login:**
- `alpaca` user logs in automatically on boot (System Preferences > Users & Groups > Login Options)
- No password prompt on startup — desktop loads unattended

**Power Management** (`pmset -a`):
- `sleep 0` — never sleep
- `disksleep 0` — never spin down disks
- `displaysleep 0` — never turn off display
- `womp 1` — Wake on LAN enabled
- **Note:** `autorestart` is NOT supported on this MacBook Pro 13,2 (desktop-only feature). After a complete power failure that drains the battery, someone must press the power button. The internal battery provides a buffer for short outages.
- `standby 0` — no standby mode
- `autopoweroff 0` — no auto power off
- `hibernatemode 0` — no hibernation
- `powernap 0` — no Power Nap (prevents unpredictable wakes)

**Caffeinate Daemon** (`/Library/LaunchDaemons/com.caffeinate.plist`):
- Runs `/usr/bin/caffeinate -dims` as a LaunchDaemon (runs as root, before login)
- `KeepAlive: true` — restarts if killed
- `RunAtLoad: true` — starts on boot
- Prevents sleep at the system level as a safety net

**Networking & Remote Access:**
- SSH: Remote Login enabled (`systemsetup -setremotelogin on`)
- Screen Sharing: Enabled with full Remote Management permissions
- Tailscale: `TailscaleStartOnLogin=1`, auto-update enabled
- Tailscale operator: `alpaca` (can run `tailscale` commands without sudo)
- Subnet routing: Advertises `192.168.1.0/24` to the Tailnet
- IP Forwarding: `net.inet.ip.forwarding=1` in `/etc/sysctl.conf`

**Security:**
- `sudo`: NOPASSWD for `alpaca` user (`/etc/sudoers.d/alpaca`)
- Tailscale key expiry: Disabled (won't disconnect unexpectedly)

### What Happens on Reboot

1. Mac must be manually powered on after a full power loss (MacBook Pro limitation — `autorestart` is desktop-only). The internal battery provides a buffer for short outages.
2. `alpaca` user logs in automatically (no password prompt)
3. Caffeinate daemon starts (LaunchDaemon, runs before login)
4. Tailscale app launches (Login Item, `TailscaleStartOnLogin=1`)
5. Sonos HTTP API starts (`~/Library/LaunchAgents/com.sonos.httpapi.plist`)
6. go2rtc starts (`~/Library/LaunchAgents/com.go2rtc.plist`)
7. DO droplet can SSH in via Tailscale within ~60 seconds of boot

**No human intervention required.**

### Services Running

| Service | Port | Auto-Start | Purpose |
|---------|------|------------|---------|
| node-sonos-http-api | 5005 | launchd (`com.sonos.httpapi`) | Sonos speaker control |
| go2rtc | 1984 | launchd (`com.go2rtc`) | Camera HLS/WebRTC streaming (9 streams) |
| Tailscale | — | Login item | VPN mesh connectivity |
| caffeinate | — | LaunchDaemon | Prevent sleep |

### Software Installed

- **Homebrew** (`/usr/local/bin/brew`)
- **Node.js 18.20.8** via nvm (`~/.nvm/versions/node/v18.20.8/`)
- **node-sonos-http-api** (`~/node-sonos-http-api/`)
- **Tailscale 1.94.1** (`/Applications/Tailscale.app`, CLI at `/usr/local/bin/tailscale`)

### Setting Up a New Remote Mac (Checklist)

If you ever need to configure another Mac as a remote server, follow this checklist:

1. **Auto-login:** System Preferences > Users & Groups > Login Options > Automatic login
2. **Power management:** `sudo pmset -a sleep 0 disksleep 0 displaysleep 0 womp 1 standby 0 autopoweroff 0 hibernatemode 0 powernap 0` (add `autorestart 1` if using a desktop Mac — not supported on MacBooks)
3. **Caffeinate daemon:** Create `/Library/LaunchDaemons/com.caffeinate.plist` with `caffeinate -dims`, `KeepAlive: true`, `RunAtLoad: true`
4. **Load caffeinate:** `sudo launchctl load -w /Library/LaunchDaemons/com.caffeinate.plist`
5. **Enable SSH:** `sudo systemsetup -setremotelogin on`
6. **Enable Screen Sharing:** System Preferences > Sharing > Remote Management (check all permissions)
7. **Install Tailscale:** Download from tailscale.com, sign in, set operator: `sudo tailscale set --operator=USERNAME`
8. **Tailscale auto-start:** Ensure `TailscaleStartOnLogin=1` in Tailscale preferences
9. **Tailscale auto-update:** `tailscale set --auto-update`
10. **Disable key expiry:** In Tailscale admin console (login.tailscale.com) > Machine settings > Disable key expiry
11. **Subnet routing:** `tailscale set --advertise-routes=192.168.1.0/24` + approve in admin console
12. **Passwordless sudo:** `echo "USERNAME ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/USERNAME && sudo chmod 440 /etc/sudoers.d/USERNAME`
13. **IP forwarding:** `echo 'net.inet.ip.forwarding=1' | sudo tee -a /etc/sysctl.conf && sudo sysctl -w net.inet.ip.forwarding=1`
14. **Install Chrome Remote Desktop** (fallback remote access that doesn't depend on Tailscale)

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

#### Volume & EQ

```bash
GET /{room}/volume/{0-100}        # Set absolute volume
GET /{room}/volume/+5             # Increase by 5
GET /{room}/volume/-5             # Decrease by 5
GET /{room}/groupVolume/{0-100}   # Set volume for entire group
GET /{room}/mute
GET /{room}/unmute
GET /{room}/bass/{-10 to 10}      # Set bass EQ
GET /{room}/treble/{-10 to 10}    # Set treble EQ
GET /{room}/loudness/{on|off}     # Toggle loudness compensation
GET /{room}/balance/{-100 to 100} # Set L/R balance (custom action, see below)
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

### Custom Actions

#### Balance (`balance.js`)

The balance endpoint is a custom action added to node-sonos-http-api. Stock node-sonos-http-api does NOT support balance control (upstream PR #454 was never merged).

**File:** `~/node-sonos-http-api/lib/actions/balance.js` (on Alpaca Mac)

**How it works:**
- Sends raw SOAP `SetVolume` calls to the speaker's `RenderingControl` endpoint
- Uses separate `LF` (Left Front) and `RF` (Right Front) UPnP channels
- Balance value `-100` to `+100`:
  - `-100` = full left (LF=100%, RF=0%)
  - `0` = center (LF=100%, RF=100%)
  - `+100` = full right (LF=0%, RF=100%)
- The formula: `LF = (bal > 0 ? 100 - bal : 100)`, `RF = (bal < 0 ? 100 + bal : 100)`

**Usage:**
```bash
GET /{room}/balance/0      # Center (both channels at 100%)
GET /{room}/balance/-30    # Slightly left (LF=100%, RF=70%)
GET /{room}/balance/50     # Right-biased (LF=50%, RF=100%)
```

**Note:** Sonos does NOT report balance state in its `/state` API response. The frontend persists balance values in `localStorage` and re-applies them when needed. When adjusting balance, the slider shows the locally cached value, not a Sonos-reported value.

### Sonos Proxy Chain (Browser → Supabase → DO Droplet → Alpaca Mac)

The browser doesn't access the Sonos HTTP API directly. Instead, requests flow through a proxy chain:

```
Browser (sonos.js)
  → Supabase Edge Function (sonos-control)
    → Nginx reverse proxy on DO droplet (port 8055)
      → Alpaca Mac via Tailscale (100.102.122.65:5005)
        → node-sonos-http-api → Sonos speakers
```

#### Nginx Config on DO Droplet

**File:** `/etc/nginx/sites-enabled/sonos-proxy`

```nginx
server {
    listen 8055;
    server_name _;
    location /sonos/ {
        if ($http_x_sonos_secret != "<secret>") {
            return 403;
        }
        rewrite ^/sonos/(.*)$ /$1 break;
        proxy_pass http://100.102.122.65:5005;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        proxy_buffering off;
    }
}
```

- Port 8055 is opened in UFW (`ufw allow 8055/tcp`)
- Secret is verified via `X-Sonos-Secret` header
- Path `/sonos/` prefix is stripped before proxying to Alpaca Mac
- Actual secret value is in `HOMEAUTOMATION.local.md`

#### Supabase Edge Function: `sonos-control`

**Deployment:** `supabase functions deploy sonos-control --no-verify-jwt`

**CRITICAL:** Must deploy with `--no-verify-jwt` flag! The function handles auth internally via `supabase.auth.getUser(token)`. Without this flag, Supabase's gateway-level JWT verification rejects valid user tokens with `{"code":401,"message":"Invalid JWT"}` before the function code even executes.

**Supabase Secrets Required:**
| Secret | Value | Notes |
|--------|-------|-------|
| `SONOS_PROXY_URL` | `http://159.89.157.120:8055/sonos` | DO droplet IP + nginx port + path prefix |
| `SONOS_PROXY_SECRET` | (see HOMEAUTOMATION.local.md) | Must match nginx `$http_x_sonos_secret` check |

Set with: `supabase secrets set SONOS_PROXY_URL="..." SONOS_PROXY_SECRET="..."`

**Auth flow in the function:**
1. Extracts Bearer token from `Authorization` header
2. Calls `supabase.auth.getUser(token)` to verify the user
3. Checks `app_users.role` is `resident`, `associate`, `staff`, or `admin`
4. Builds Sonos HTTP API path from the `action` parameter
5. Fetches `${SONOS_PROXY_URL}${path}` with `X-Sonos-Secret` header
6. Returns the Sonos API response as JSON

**Supported actions:** `getZones`, `getState`, `play`, `pause`, `playpause`, `next`, `previous`, `volume`, `mute`, `unmute`, `favorite`, `favorites`, `playlists`, `playlist`, `pauseall`, `resumeall`, `join`, `leave`, `bass`, `treble`, `loudness`, `balance`

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

### go2rtc (Camera Streaming)

go2rtc converts RTSPS from UniFi Protect into HLS/WebRTC/MSE for browser playback.
Runs on Alpaca Mac as launchd service `com.go2rtc` (v1.9.14).

**Why go2rtc, not MediaMTX:** MediaMTX's HLS muxer crashes repeatedly on UniFi Protect's malformed SPS NAL units ("unable to extract DTS: invalid SPS"). go2rtc handles these quirky streams perfectly with zero errors.

**Config:** `~/go2rtc/go2rtc.yaml` on Alpaca Mac (source in `scripts/go2rtc/go2rtc.yaml`)

**Key detail:** UniFi Protect URLs use `rtspx://` protocol (RTSP over TLS control channel, no SRTP on media data). Remove `?enableSrtp` from the Protect RTSP URLs.

**Available Streams (9 total — 3 cameras × 3 quality levels):**

| Stream Name | Camera | Resolution |
|-------------|--------|------------|
| `alpacamera-high` | Alpacamera (backyard) | 2688x1512 |
| `alpacamera-med` | Alpacamera | 1280x720 |
| `alpacamera-low` | Alpacamera | 640x360 |
| `front-house-high` | Front Of House | 2688x1512 |
| `front-house-med` | Front Of House | 1280x720 |
| `front-house-low` | Front Of House | 640x360 |
| `side-yard-high` | Side Yard | 2688x1512 |
| `side-yard-med` | Side Yard | 1280x720 |
| `side-yard-low` | Side Yard | 640x360 |

**Access URLs** (replace `{stream}` with any stream name above):

| Protocol | URL | Use Case |
|----------|-----|----------|
| HLS (fMP4) | `http://localhost:1984/api/stream.m3u8?src={stream}&mp4` | Browser playback (HLS.js) |
| HLS (TS) | `http://localhost:1984/api/stream.m3u8?src={stream}` | Basic HLS (audio only) |
| MP4 stream | `http://localhost:1984/api/stream.mp4?src={stream}` | Direct MP4 (continuous) |
| RTSP | `rtsp://localhost:8554/{stream}` | VLC, NVR, programmatic |
| API | `http://localhost:1984/api/streams` | Stream status/consumers |
| Web UI | `http://localhost:1984/` | Built-in player (LAN only) |

**Via Tailscale** (from DO droplet): Replace `localhost` with `100.102.122.65`

**Public access** (via Caddy reverse proxy on DO droplet):
- HLS: `https://cam.alpacaplayhouse.com/api/stream.m3u8?src={stream}&mp4`
- Only `/api/*` paths are proxied; web UI is blocked
- CORS restricted to `rsonnad.github.io` and `alpacaplayhouse.com`

**On-demand:** go2rtc only connects to cameras when a viewer requests a stream. Streams auto-disconnect when no consumers remain.

**IMPORTANT — `&mp4` parameter:** Always use `&mp4` in the HLS URL. Without it, go2rtc sends TS segments that contain only audio. The `&mp4` flag enables fMP4 mode with proper init segments (EXT-X-MAP) that include video.

**Logs:** `~/go2rtc/logs/stdout.log` and `~/go2rtc/logs/stderr.log`

**Service management:**
```bash
# On Alpaca Mac
launchctl list | grep go2rtc                                   # Check status
launchctl unload ~/Library/LaunchAgents/com.go2rtc.plist       # Stop
launchctl load ~/Library/LaunchAgents/com.go2rtc.plist         # Start
tail -f ~/go2rtc/logs/stdout.log                               # View logs
```

### Caddy Reverse Proxy (cam.alpacaplayhouse.com)

Caddy on the DO droplet reverse-proxies go2rtc's API through HTTPS with auto-provisioned Let's Encrypt certificate.

**DNS:** `cam` A record → `159.89.157.120` (DO droplet IP, configured in GoDaddy)

**Config:** `/etc/caddy/Caddyfile` on DO droplet

**What Caddy does:**
1. Receives HTTPS requests at `cam.alpacaplayhouse.com/api/*`
2. Strips go2rtc's CORS headers (which are `*`)
3. Adds origin-specific CORS headers (github.io, alpacaplayhouse.com)
4. Proxies to go2rtc at `http://100.102.122.65:1984` via Tailscale
5. Blocks all non-`/api/` paths (returns 404)

**Manage Caddy:**
```bash
# On DO droplet
caddy validate --config /etc/caddy/Caddyfile    # Validate config
systemctl reload caddy                            # Reload without downtime
systemctl status caddy                            # Check status
```

### Database: camera_streams Table

Stream configuration is stored in Supabase, not hardcoded in the frontend.

| Column | Type | Purpose |
|--------|------|---------|
| `stream_name` | text | Unique stream ID (e.g., `alpacamera-low`) |
| `camera_name` | text | Display name (e.g., `Alpacamera`) |
| `quality` | text | `low`, `med`, or `high` |
| `resolution` | text | e.g., `640x360` |
| `location` | text | Physical location description |
| `proxy_base_url` | text | Default: `https://cam.alpacaplayhouse.com` |
| `lan_ip` | text | Camera LAN IP |
| `is_active` | bool | Whether to show in UI |

Frontend constructs HLS URL as: `${proxy_base_url}/api/stream.m3u8?src=${stream_name}&mp4`

RLS: Authenticated users can read; no public access.

### UniFi Protect API (Camera Control)

The UDM Pro exposes an unofficial REST API for camera settings (IR, PTZ, etc.).

**Authentication:** Same as Network API — cookie-based with CSRF token from JWT.

```bash
# IR LED control script (on Alpaca Mac)
python3 /tmp/unifi_ir.py auto    # Set all cameras to auto IR
python3 /tmp/unifi_ir.py on      # Force IR LEDs on
python3 /tmp/unifi_ir.py off     # Force IR LEDs off
```

**Camera IDs (from Protect API bootstrap):**

| Camera | Protect ID |
|--------|-----------|
| Alpacamera | `694c550400317503e400044b` |
| Front Of House | `696534fc003eed03e4028eee` |
| Side Yard | `696537cc0067ed03e402929c` |

**Key PATCH endpoint:** `PATCH https://192.168.1.1/proxy/protect/api/cameras/{id}`

**IR LED modes:** `auto` (default), `on`, `off`, `autoFilterOnly`, `manual`

**ISP Settings** (via `ispSettings` in PATCH body):
- `irLedMode` — IR LED control
- `irLedLevel` — IR intensity (0-6)
- `icrSensitivity` — Day/night switch threshold

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

### Sonos page shows "No Sonos zones found" or "Failed to load Sonos zones"

Debug the proxy chain step by step:

1. **Alpaca Mac → Sonos HTTP API** (from DO droplet via Tailscale):
   ```bash
   ssh alpaca@100.102.122.65 "curl -s http://localhost:5005/zones | head -c 200"
   ```

2. **DO Droplet → Nginx proxy** (from DO droplet):
   ```bash
   curl -s -H 'X-Sonos-Secret: <secret>' 'http://localhost:8055/sonos/zones' | head -c 200
   ```

3. **External → DO Droplet** (from outside):
   ```bash
   curl -s -H 'X-Sonos-Secret: <secret>' 'http://159.89.157.120:8055/sonos/zones' | head -c 200
   ```

4. **Supabase Edge Function** (with valid user token):
   ```bash
   curl -s -H "Authorization: Bearer <user_jwt>" -H "apikey: <anon_key>" \
     -H 'Content-Type: application/json' -d '{"action":"getZones"}' \
     'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control'
   ```

**Common causes:**
- Edge function deployed without `--no-verify-jwt` → gateway rejects tokens with `{"code":401,"message":"Invalid JWT"}`
- `SONOS_PROXY_URL` or `SONOS_PROXY_SECRET` Supabase secrets don't match nginx config
- Secrets changed but edge function not redeployed (secrets only take effect on next deploy)
- Port 8055 blocked by UFW on DO droplet
- Tailscale tunnel down between DO droplet and Alpaca Mac

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
| **WiZ** (Philips/Signify) | 11 bulbs | UDP :38899 (local) | `pywizlight` CLI/Python | Working — fully controllable |
| **Govee/AiDot** (ESP32) | 63 devices | Cloud REST API (+ optional LAN UDP) | Govee Cloud API | **Working** — Cloud API key active, all devices controllable |
| **Matter** | 13 devices (2 fabrics) | mDNS/Matter over IP | `chip-tool` or Home Assistant | Discovered — need commissioning info |
| **TP-Link Kasa** | 2 switches | Cloud + local | `python-kasa` | Working — fully controllable |
| **Tuya** | 3 devices | Cloud + local | `tinytuya` | Discovered at .69, .208, .254 |
| **Amazon Smart Plug** | 1 plug | Cloud | Alexa app | AmazonPlug13A2 at 192.168.1.145 |
| **Alexa** | Hub for voice control | Cloud | `alexa-remote-control` | 7 Echo/Show devices on network |

**Total smart lighting/plug devices: ~80** (63 Govee + 11 WiZ + 2 Kasa + 3 Tuya + 1 Amazon plug)

> **AiDot vs Govee:** AiDot is Govee's parent company. All AiDot-hostname and espressif-hostname devices are Govee products. The Cloud API reveals **63 total Govee devices** (54 individual lights + 9 group controllers), organized by area in the device catalog below.

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

### Govee / AiDot Lights (63 devices via Cloud API)

AiDot is Govee's parent company. All these devices are Govee products. **Cloud API is now active** — controllable from the DO droplet or anywhere, no LAN required.

#### Device Catalog (by area)

**Garage Mahal (15 lights + 1 group)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| garage mahal (group) | SameModeGroup | 13452517 | Group controller |
| garage mahal 1 | H601F | 2A:D4:DC:B4:D9:58:3A:8C | Light bar |
| garage mahal 2 | H601F | 0C:EC:DC:B4:D9:59:46:E8 | Light bar |
| Garage Mahal 3 | H601F | 26:E2:DC:B4:D9:58:39:5C | Light bar |
| Garage Mahal 4 | H601F | 7F:85:98:88:E0:FB:90:F0 | Light bar |
| Garage Mahal 5 | H601F | 2B:D0:DC:B4:D9:58:3A:C8 | Light bar |
| Garage Mahal 6 | H601F | C1:61:DC:B4:D9:58:1A:88 | Light bar |
| Garage Mahal 7 | H601F | 16:45:DC:B4:D9:58:48:28 | Light bar |
| Garage Mahal 8 | H601F | 0E:46:DC:B4:D9:58:24:2C | Light bar |
| Garage Mahal 9 | H601F | D9:83:DC:B4:D9:56:91:24 | Light bar |
| Garage Mahal 10 | H601F | 18:EB:DC:06:75:48:DC:98 | Light bar |
| Garage Mahal 11 | H601F | 8C:4B:DC:B4:D9:5A:06:C8 | Light bar |
| Garage Mahal 12 | H601F | 32:EF:DC:B4:D9:5A:07:7C | Light bar |
| Garage Mahal 13 | H601F | 1C:90:DC:06:75:4D:C1:E8 | Light bar |
| Garage Mahal R1 | H601F | E9:59:DC:B4:D9:59:42:50 | Light bar |
| Garage Mahal R2 | H601F | 79:A5:DC:B4:D9:5A:12:14 | Light bar |
| Garage Mahal R3 | H601F | 1D:28:DC:B4:D9:56:8D:EC | Light bar |

**Spartan Room (16 lights + 4 groups)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| Spartan (group) | SameModeGroup | 12411623 | Group controller |
| Spartan Main (group) | SameModeGroup | 12411712 | Group controller |
| Spartan LilBed (group) | SameModeGroup | 12411702 | Group controller |
| Spartan Small Bed (group) | SameModeGroup | 12001251 | Group controller |
| Spartan Main 1 | H601A | 07:81:D0:C9:07:E7:47:FA | Light bar |
| Spartan Main 2 | H601A | 07:68:98:17:3C:27:34:38 | Light bar |
| Spartan Main 3 | H601A | 08:35:98:17:3C:28:B9:14 | Light bar |
| Spartan Main 4 | H601A | 08:3B:98:17:3C:27:34:32 | Light bar |
| Spartan Main 5 | H601A | 08:2D:98:17:3C:28:93:5E | Light bar |
| Spartan Main 6 | H601A | 08:40:98:17:3C:07:AF:D2 | Light bar |
| Spartan Bigbed 1 | H601F | 0A:C2:DC:06:75:52:3A:6C | Light bar |
| Spartan Bigbed 2 | H601F | 12:2F:DC:06:75:4D:B4:F4 | Light bar |
| Spartan Bigbed 3 | H601F | 20:28:DC:06:75:4A:7D:C0 | Light bar |
| Spartan Bigbed 4 | H601F | 0A:46:DC:06:75:49:7D:58 | Light bar |
| Spartan Lilbed 1 | H601A | 07:89:98:17:3C:06:57:66 | Light bar |
| Spartan Lilbed 2 | H601A | 06:BE:98:17:3C:08:FC:DC | Light bar |
| spartan UpDown Wall | H7076 | 26:70:DE:99:C1:C6:5B:84 | Wall light |
| spartan roof | H6173 | 1B:63:C8:39:33:30:49:91 | Strip light |

**Outhouse (6 lights + 1 group)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| Outhouse (group) | SameModeGroup | 13166268 | Group controller |
| outhousemain1 | H601F | 73:E5:DC:B4:D9:4D:29:88 | Light bar |
| outhousemain2 | H601F | 12:DC:DC:B4:D9:4C:A4:84 | Light bar |
| outhousemain3 | H601F | 13:BC:DC:B4:D9:4D:47:D4 | Light bar |
| outhousemain4 | H601F | 43:F2:DC:B4:D9:4D:1C:DC | Light bar |
| outhouse stall left | H601F | 4B:F5:DC:B4:D9:59:28:10 | Light bar |
| outhouse stall right | H601F | 1E:D4:DC:B4:D9:5A:11:34 | Light bar |

**Bedrooms (2 groups)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| East Bedroom (group) | SameModeGroup | 12097639 | Group controller |
| West Bedroom (group) | SameModeGroup | 12097082 | Group controller |
| West Bedroom (group 2) | SameModeGroup | 12097079 | Group controller |
| Common (group) | SameModeGroup | 12097114 | Group controller |

**Outdoor / Yard (12 lights)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| Front Container Floods | H7057 | 10:84:DA:B9:84:86:4D:11 | Floodlight |
| Front fence Lights | H70C5 | 7A:0F:C5:75:4E:0E:1B:1B | Permanent outdoor |
| far back fence lights | H70C5 | 17:2A:C4:75:55:E6:73:8E | Permanent outdoor |
| north back fence light | H70C5 | 0E:7E:C5:75:4E:0E:38:30 | Permanent outdoor |
| Pond tree | H70C5 | 0D:26:C6:75:6E:0E:2F:12 | Permanent outdoor |
| Sauna Fence Light | H70C2 | 6C:15:CC:A6:34:7E:CD:02 | Permanent outdoor |
| Sauna Stick Lights | H7055 | F9:FC:CA:30:38:36:40:37 | Pathway light |
| sauna tree String | H70C2 | 1C:5D:E8:4B:E4:72:BE:38 | Permanent outdoor |
| food fence string | H7026 | 29:96:DD:99:83:C6:18:39 | String light |
| back patio string Lite | H7039 | 0D:AE:D0:C8:03:C6:4E:03 | String light |
| LED garag String Light | H7039 | 18:85:DD:6E:06:06:72:49 | String light |
| shower flood | H7057 | 19:4B:DB:C3:43:86:13:70 | Floodlight |

**Interior / Other (5 lights)**

| Name | SKU | Device ID | Type |
|------|-----|-----------|------|
| Stairway | H6109 | 09:FD:A4:C1:38:93:77:E2 | LED strip |
| livingroom strip light | H619E | 3A:CF:D4:AD:FC:06:C8:5C | Strip light |
| balcony striplight | H6172 | AD:57:D7:39:32:35:39:1A | Strip light |
| dog house roof | H6117 | 3E:06:A4:C1:38:1C:DE:19 | LED strip |
| TreDeco Projector | H7071 | 10:40:DC:91:77:3B:AD:CD | Star projector |

#### Govee Cloud API

**API key:** Stored in `HOMEAUTOMATION.local.md`
**Base URL:** `https://openapi.api.govee.com/router/api/v1/`

Works from DO droplet or anywhere — no LAN access needed.

```bash
# List all devices
curl -s -H "Govee-API-Key: $GOVEE_KEY" \
  https://openapi.api.govee.com/router/api/v1/user/devices

# Get device state
curl -s -X POST -H "Govee-API-Key: $GOVEE_KEY" \
  -H "Content-Type: application/json" \
  https://openapi.api.govee.com/router/api/v1/device/state \
  -d '{"requestId":"1","payload":{"sku":"H601F","device":"DEVICE_ID"}}'

# Turn on/off
curl -s -X POST -H "Govee-API-Key: $GOVEE_KEY" \
  -H "Content-Type: application/json" \
  https://openapi.api.govee.com/router/api/v1/device/control \
  -d '{"requestId":"1","payload":{"sku":"SKU","device":"DEVICE_ID","capability":{"type":"devices.capabilities.on_off","instance":"powerSwitch","value":1}}}'

# Set brightness (1-100)
curl -s -X POST -H "Govee-API-Key: $GOVEE_KEY" \
  -H "Content-Type: application/json" \
  https://openapi.api.govee.com/router/api/v1/device/control \
  -d '{"requestId":"1","payload":{"sku":"SKU","device":"DEVICE_ID","capability":{"type":"devices.capabilities.range","instance":"brightness","value":50}}}'

# Set color (RGB as integer: R*65536 + G*256 + B)
curl -s -X POST -H "Govee-API-Key: $GOVEE_KEY" \
  -H "Content-Type: application/json" \
  https://openapi.api.govee.com/router/api/v1/device/control \
  -d '{"requestId":"1","payload":{"sku":"SKU","device":"DEVICE_ID","capability":{"type":"devices.capabilities.color_setting","instance":"colorRgb","value":16711680}}}'

# Set color temperature (2000-9000K, varies by device)
curl -s -X POST -H "Govee-API-Key: $GOVEE_KEY" \
  -H "Content-Type: application/json" \
  https://openapi.api.govee.com/router/api/v1/device/control \
  -d '{"requestId":"1","payload":{"sku":"SKU","device":"DEVICE_ID","capability":{"type":"devices.capabilities.color_setting","instance":"colorTemperatureK","value":3000}}}'
```

**Rate limits:** 10,000 requests/day, 10 requests/minute per device.

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

### Tuya Devices (3 confirmed + 2 additional)

Discovered via `tinytuya` (installed on Alpaca Mac) and UDM Pro client list. All confirmed Tuya devices show hostname "wlan0" and OUI "Tuya Smart Inc."

| Device | IP | MAC | Protocol | Notes |
|--------|-----|-----|----------|-------|
| Unknown | 192.168.1.69 | fc:67:1f:ae:11:35 | 3.3 | Responds to tinytuya broadcast |
| Unknown | 192.168.1.208 | fc:67:1f:ae:0c:fe | — | Tuya OUI confirmed |
| Unknown | 192.168.1.254 | 10:5a:17:c6:2d:d5 | — | Tuya OUI confirmed |

**Additional devices with Tuya-era OUI** (18:de:50, possibly offline or different subnet):
- `192.168.1.164` (18:de:50:5f:66:90) — not in current UDM client list
- `192.168.1.219` (18:de:50:5f:67:4c) — not in current UDM client list

### Other Smart Devices on Network

**Smart Home / IoT:**

| Device | Hostname | IP | MAC | Type |
|--------|----------|-----|-----|------|
| Amazon Smart Plug | AmazonPlug13A2 | 192.168.1.145 | 24:ce:33:93:d9:b1 | Smart plug |
| Nest Thermostat | Nest-Thermostat-940D | 192.168.1.111 | 14:c1:4e:7a:94:0d | Thermostat (Matter) |
| Nest Thermostat | Nest-Thermostat-AE0D | 192.168.1.139 | 14:c1:4e:2d:ae:0d | Thermostat (Matter) |
| Nest Thermostat | Nest-Thermostat-8EEB | 192.168.1.249 | 14:c1:4e:b5:8e:eb | Thermostat (Matter) |
| MyQ Garage Opener | MyQ-64F | 192.168.1.243 | 2c:d2:6b:93:30:22 | Garage door |
| Midea Air Conditioner | (none) | 192.168.1.237 | c4:39:60:0e:e9:70 | HVAC |
| EcoNet Water Heater | EcoNet-EC2E9842615B | 192.168.1.168 | ec:2e:98:42:61:5b | Water heater |
| ANOVA Oven | ANOVA Oven | 192.168.1.181 | 10:52:1c:be:49:b8 | Kitchen appliance |
| LG Smart Dryer | LG_Smart_Dryer2_open | 192.168.1.22 | ac:f1:08:80:6f:9b | Laundry |
| LG Smart Washer | LG_Smart_Laundry2_open | 192.168.1.246 | ac:f1:08:1e:ba:c7 | Laundry |
| Intellirocks device | (none) | 192.168.1.10 | d4:ad:fc:43:5f:b2 | IoT sensor? |

**Cameras & Security:**

| Device | Hostname | IP | MAC | Type |
|--------|----------|-----|-----|------|
| UniFi G5 PTZ | Alpacamera | 192.168.1.173 | f4:e2:c6:7a:7f:fe | UVC G5 PTZ (fw 5.1.240, recording) |
| UniFi G5 PTZ | Front Of House | 192.168.1.182 | 1c:6a:1b:87:8f:55 | UVC G5 PTZ (fw 5.1.240, recording) |
| UniFi G5 PTZ | Side Yard | 192.168.1.110 | f4:e2:c6:79:a0:a2 | UVC G5 PTZ (fw 5.1.240, recording) |
| Wansview 1 | WVCABN73I8YL861I | 192.168.1.18 | 30:4a:26:15:bc:69 | Wansview WiFi cam (RTSP verified, offline from LAN) |
| Wansview 2 | WVCABN8ZLH8LFC3B | 192.168.1.21 | 30:4a:26:15:bc:70 | Wansview WiFi cam (auth OK, no video — offline?) |
| Wansview 3 | WVCABNUQUXILGOBE | 192.168.1.26 | 30:4a:26:18:c2:8d | Wansview WiFi cam (auth OK, no video — offline?) |
| Wansview 4 | WVCB34M3DFFQBTTU | 192.168.1.132 | 68:b9:d3:03:86:0e | Wansview WiFi cam (**streaming via go2rtc**) |

**Entertainment & Media:**

| Device | Hostname | IP | MAC | Type |
|--------|----------|-----|-----|------|
| VIZIO TV | viziocastdisplay | 192.168.1.129 | a4:8d:3b:d5:14:97 | TV (HomeKit + Cast) |
| Roku | JonRoku | 192.168.1.163 | d4:e2:2f:e1:23:57 | Streaming |
| HP Printer | HP536C6E | 192.168.1.64 | b0:5c:da:53:6c:6f | Printer |
| IR Blaster | iRed | 192.168.1.8 | a8:5b:b7:a1:59:23 | IR control (Apple) |

**Vehicles:**

| Device | Hostname | IP | MAC |
|--------|----------|-----|-----|
| Tesla Model 3 | Tesla_Model_3 | 192.168.1.136 | cc:88:26:18:b5:77 |

### Alexa / Amazon Devices (11 on network)

Amazon/Echo devices serve as the current voice control hub for lights.

**Echo/Show (voice assistants):**

| Hostname | IP | MAC | Type |
|----------|-----|-----|------|
| amazon-080d0e2f9 | 192.168.1.42 | 0c:ee:99:91:8a:4f | Echo |
| amazon-7c33ec9c38900cc0 | 192.168.1.100 | 0c:dc:91:76:4a:d7 | Echo |
| echoshow-3bf32cb7f1ef46a6 | 192.168.1.131 | 08:91:a3:37:4f:4f | Echo Show |
| echoshow-9f2eb6d9d752aab3 | 192.168.1.184 | 58:e4:88:b5:37:af | Echo Show |
| amazon-67f77a339 | 192.168.1.190 | a4:08:01:b4:36:06 | Echo |
| amazon-14ea528bd | 192.168.1.213 | 40:a2:db:a3:77:be | Echo |
| amazon-20cb70679 | 192.168.1.229 | f4:03:2a:22:dd:e6 | Echo |

**Other Amazon devices:**

| Hostname | IP | MAC | Type |
|----------|-----|-----|------|
| AmazonPlug13A2 | 192.168.1.145 | 24:ce:33:93:d9:b1 | Smart Plug |
| (none) | 192.168.1.91 | f0:2f:9e:bb:80:30 | Unknown Amazon |
| (none) | 192.168.1.209 | cc:f7:35:a3:53:32 | Unknown Amazon |
| (none) | 192.168.1.228 | 08:7c:39:39:be:89 | Unknown Amazon |
| (none) | 192.168.1.232 | 70:70:aa:21:b8:d8 | Unknown Amazon |

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

### Full Network Device Count (from UDM Pro)

| Category | Count | Notes |
|----------|-------|-------|
| Govee/AiDot lights | 63 | 54 individual lights + 9 group controllers (Cloud API active) |
| WiZ lights | 11 | All ESP05_SHRGBL_21 color bulbs |
| TP-Link switches | 2 | HS210 (Stair Landing) + HS220 (Nook) |
| Tuya devices | 3-5 | 3 confirmed, 2 possibly offline |
| Amazon Smart Plugs | 1 | AmazonPlug13A2 |
| Alexa Echo/Show | 7 | Voice control hubs |
| Other Amazon | 4 | Unknown type |
| Sonos speakers | 12 | All identified |
| Nest thermostats | 3 | Matter-enabled |
| Cameras | 7 | 3 UniFi G5 PTZ + 4 Trolink |
| Appliances | 5 | LG washer/dryer, Anova, Midea AC, EcoNet |
| Other IoT | 3 | MyQ garage, iRed IR, Intellirocks |
| **Total IoT devices** | **~95** | |

### TODO: Camera Streaming

- [x] ~~**Deploy camera streaming**~~ — Deployed 2026-02-07. go2rtc v1.9.14 on Alpaca Mac with 9 streams. Caddy reverse proxy on DO droplet at `cam.alpacaplayhouse.com`. HLS.js frontend at `residents/cameras.html`.
- [x] ~~**Fix Tailscale connectivity**~~ — Fixed 2026-02-07. Re-authenticated Tailscale, new device `alpacaopenmac-1` at `100.102.122.65`. Key expiry disabled.
- [x] ~~**MediaMTX → go2rtc migration**~~ — MediaMTX crashed on UniFi Protect's malformed SPS NAL units. Switched to go2rtc which handles them perfectly. MediaMTX binary kept at `~/mediamtx/mediamtx.v1.16.0.bak` but service is unloaded.
- [x] ~~**Identify Trolink cameras**~~ — These are Wansview/Trolink cameras (Trolink is Wansview's OEM). RTSP on port 554, ONVIF on port 8899, HTTP on port 80 (Boa web server, hi3510 chipset). Each camera has unique RTSP credentials set via Wansview app (Settings > Local Application > Local Account). Wansview 4 (.132) is streaming via go2rtc. Wansview 1 (.18) verified working via ffprobe but unreachable from Alpaca Mac. Wansview 2 (.21) and 3 (.26) accept auth but send no video data (likely physically offline).
- [ ] **Get physical locations of Wansview cameras** — Currently named "Wansview 1" through "Wansview 4" as placeholders
- [ ] **Troubleshoot Wansview 1 (.18)** — RTSP confirmed working via DO droplet but go2rtc on Alpaca Mac gets "host is down". May be a WiFi/ARP issue on the local network.
- [ ] **Troubleshoot Wansview 2 (.21) and 3 (.26)** — RTSP auth succeeds with all credentials but cameras send no video. Likely powered off or disconnected.

### Wansview Camera Integration

**Brand:** Wansview (Trolink OEM). Cloud account: `alpacaplayhouse@gmail.com`
**Chipset:** hi3510 (Boa/0.94.13 web server, AJSS/1.0.4 RTSP server)
**Protocols:** RTSP (port 554), ONVIF (port 8899), HTTP (port 80)
**RTSP paths:** `/live/ch0` (1920x1080 high), `/live/ch1` (768x432 low)
**Codec:** H.264 High, 15fps, AAC-LC 8kHz mono audio

**Credentials** (each camera has unique RTSP credentials, set in Wansview app > Settings > Local Application > Local Account):

| Camera | IP | Hostname | RTSP User | RTSP Password | Status |
|--------|-----|----------|-----------|---------------|--------|
| Wansview 1 | 192.168.1.18 | WVCABN73I8YL861I | `eVm1DUbw` | `Q9wjylqPseNj0eo5` | go2rtc can't reach (host down from LAN) |
| Wansview 2 | 192.168.1.21 | WVCABN8ZLH8LFC3B | — | — | Auth passes, no video (offline?) |
| Wansview 3 | 192.168.1.26 | WVCABNUQUXILGOBE | — | — | Auth passes, no video (offline?) |
| Wansview 4 | 192.168.1.132 | WVCB34M3DFFQBTTU | `P8oqrztI` | `UhJTMvMjQx8WAxG1` | ✅ **Streaming via go2rtc** |

**Unmatched credentials** (from Wansview app, not yet mapped to a specific camera):
- `5EZbH9Uf` / `96bcJZg26H6gQj2b`
- `lHSsv3X9` / `scbevBv1uBW4n9P7`
- `v0H7TTAR` / `8kRmuNVjy9osqAYS`

**go2rtc streams** (in `scripts/go2rtc/go2rtc.yaml`, deployed to `~/go2rtc/go2rtc.yaml` on Alpaca Mac):
```yaml
wansview-1-high:
  - rtsp://eVm1DUbw:Q9wjylqPseNj0eo5@192.168.1.18:554/live/ch0
wansview-1-low:
  - rtsp://eVm1DUbw:Q9wjylqPseNj0eo5@192.168.1.18:554/live/ch1
wansview-4-high:
  - rtsp://P8oqrztI:UhJTMvMjQx8WAxG1@192.168.1.132:554/live/ch0
wansview-4-low:
  - rtsp://P8oqrztI:UhJTMvMjQx8WAxG1@192.168.1.132:554/live/ch1
```

**DB entries** (`camera_streams` table):
- `wansview-1-high` / `wansview-1-low` → "Wansview 1" (high 1920x1080, low 768x432)
- `wansview-4-high` / `wansview-4-low` → "Wansview 4" (high 1920x1080, low 768x432)

**Key differences from UniFi cameras:**
- Plain `rtsp://` not `rtspx://` (no TLS)
- Only 2 quality levels (high/low) vs UniFi's 3 (high/med/low)
- No PTZ, no snapshots, no IR/LED settings via Protect API
- Credentials in RTSP URL (UniFi uses token-based paths)

### TODO: Lighting Catalog

**Completed:**
- [x] **Get Govee API key** — `d0f84...764` (stored in `HOMEAUTOMATION.local.md`)
- [x] **Map Govee devices to rooms** — 63 devices cataloged via Cloud API (see device catalog above)
- [x] **Verified Govee Cloud API control** — brightness, on/off, color all working from DO droplet

**Pending credentials:**
- [ ] **Get Alexa refresh token** — `alexa-cookie2` proxy at http://159.89.157.120:3001 (fixed, working)

**Manual identification needed:**
- [ ] **Map WiZ room IDs to physical rooms** — Open WiZ app, note room names for IDs 4528222, 4352002, 4937866
- [ ] **Enable Govee LAN Control** — Per-device in Govee Home app: Settings → LAN Control → ON (optional, Cloud API works fine)
- [ ] **Identify 3 Tuya devices** — Check Tuya/Smart Life app for .69, .208, .254
- [ ] **Identify 4 unknown Amazon devices** — .91, .209, .228, .232 (plugs? Fire sticks?)
- [ ] **Identify Matter devices** — The 10 Alexa-fabric Matter devices are likely Govee bulbs re-exposed via Alexa's Matter bridge
