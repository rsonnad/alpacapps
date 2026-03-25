# Home Automation — Alpaca Playhouse

> Comprehensive reference for all smart home devices, Home Assistant setup, and migration plans.
> Last updated: 2026-03-22

---

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │       Home Assistant OS 17.1         │
                    │     http://192.168.1.39:8123         │
                    │  (QEMU VM on Rahul M4 Airtop)       │
                    └───┬────┬────┬────┬────┬────┬────┬───┘
                        │    │    │    │    │    │    │
              ┌─────────┘    │    │    │    │    │    └─────────┐
              ▼              ▼    │    ▼    │    ▼              ▼
         WiZ Bulbs      Sonos │  Cast  │  TP-Link      Music Assistant
         (16/26)      (9 speakers)    │        │       (192.168.1.200:8095)
                              │       │        │
                         ┌────┘       │        └────┐
                         ▼            ▼             ▼
                    WiiM Speaker   HP Printer    LinkPlay
                    (Spartan)     (IPP)          (Spartan)
```

**Not yet integrated** (need HACS or credentials):
- Govee lights (57 devices) — needs HACS + Govee LAN/Cloud
- Nest thermostats (3) — needs Google Device Access API
- LG washer — needs HACS SmartThinQ
- Tesla vehicles (5) — needs HACS Tesla Custom
- UniFi Protect cameras (8) — needs API key from UDM
- VIZIO TV — needs physical PIN from TV screen
- OREIN/AiDot Matter bulbs (5) — blocked, see notes

---

## 1. Home Assistant OS — VM Setup

### Current Host: Rahul M4 Airtop

| Setting | Value |
|---------|-------|
| **HAOS Version** | 17.1 |
| **VM IP** | `192.168.1.39` (bridged on en0 via vmnet) |
| **Web UI** | http://192.168.1.39:8123 |
| **Login** | `alpacaadmin` / `playhouse` |
| **Host Machine** | Rahul M4 Airtop (Apple Silicon) |
| **Hypervisor** | Raw QEMU with `vmnet-bridged` (NOT UTM — UTM can't do bridged networking in QEMU mode) |
| **Start Script** | `sudo ~/homeassistant-vm/start-ha.sh` |
| **Auto-start** | LaunchDaemon at `/Library/LaunchDaemons/com.alpacapps.homeassistant-vm.plist` |
| **API Token (long-lived)** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxN2FlNmMyNTdhYWY0NGMxODBjZmMxOWU3ZDBiZWExMiIsImlhdCI6MTc3NDE1NTUzNSwiZXhwIjoyMDg5NTE1NTM1fQ.MdIZq95i9pJBKuKxn_aeyrK1O55JbMhsgtnM7GcTkXQ` |
| **Token Name** | `claude-automation` |

### API Usage

```bash
# Health check
curl -s http://192.168.1.39:8123/api/ \
  -H "Authorization: Bearer $HA_TOKEN"

# Get all states
curl -s http://192.168.1.39:8123/api/states \
  -H "Authorization: Bearer $HA_TOKEN"

# Control a light
curl -s -X POST http://192.168.1.39:8123/api/services/light/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.wiz_rgbw_tunable_81ab69"}'

# Control a media player
curl -s -X POST http://192.168.1.39:8123/api/services/media_player/media_play \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "media_player.living_sound"}'
```

### UEFI First Boot

If the UEFI shell appears instead of booting:
```
FS0:
EFI\BOOT\BOOTAA64.EFI
```

### Previous HA Core (Almaca)

The old HA Core instance on Almaca (192.168.1.200:8123) is still running as reference. It's a venv-based install under `~/homeassistant-venv/` with config at `~/.homeassistant/`. This will be decommissioned after HAOS migration is complete.

---

## 2. Migration Plan — Mac Mini (~2026-03-31)

### Steps

1. **Create HAOS backup** via Settings → System → Backups → Create Backup
2. **Transfer backup** to Mac Mini (SCP or USB)
3. **Install QEMU** on Mac Mini (`brew install qemu`)
4. **Copy VM folder** `~/homeassistant-vm/` to Mac Mini
5. **Update `start-ha.sh`** with correct network interface name (check `ifconfig` on Mini)
6. **Start VM** on Mac Mini: `sudo ~/homeassistant-vm/start-ha.sh`
7. **Restore backup** if needed via HAOS onboarding
8. **Update LaunchDaemon** — copy plist to `/Library/LaunchDaemons/` on Mac Mini
9. **Verify all devices** reconnect (same subnet, so IPs stay the same)
10. **Disable sleep** on Mac Mini: `sudo pmset -a sleep 0 displaysleep 0`

### Why Mac Mini

- Apple Silicon native — better QEMU performance
- Dedicated home server (not Airtop which is a dev machine)
- `home-assistant-chip-core` Matter wheel available on ARM64 (blocked on Intel x86_64)
- Lower power consumption for always-on server

---

## 3. Configured Integrations (35 entries)

| Integration | Count | Status | Notes |
|-------------|-------|--------|-------|
| **WiZ** | 16 bulbs | Loaded | RGBW Tunable, auto-discovered via UDP |
| **Sonos** | 9 speakers | Loaded | All rooms working |
| **Google Cast** | 2 devices | Loaded | Jon + 1 other |
| **TP-Link** | 3 devices | Loaded | Cabin 1 KL135, Nook HS220, Stair Landing HS210 |
| **Music Assistant** | 1 entry | Loaded | Connected to Almaca :8095 |
| **DLNA DMR** | 1 device | Loaded | Spartan WiiM |
| **LinkPlay** | 1 device | Loaded | Spartan WiiM |
| **IPP (Printer)** | 1 device | Loaded | HP ENVY Photo 7800 |
| **Matter** | 1 entry | Loaded | Server running, no devices paired yet |
| **Thread** | 1 entry | Loaded | Border router available |
| **Supervisor** | 1 entry | Loaded | HAOS Supervisor |
| **go2rtc** | 1 entry | Loaded | WebRTC streaming |
| **Others** | 6 | Loaded | Sun, Backup, Met.no weather, Radio Browser, Shopping List, Google TTS |

### Pending Discoveries (3 remaining)

| Device | Integration | Blocker |
|--------|------------|---------|
| Dream-Machine-Pro (192.168.1.1) | UniFi Protect | Needs API key — create local user in UDM console |
| vizio | VIZIO SmartCast | Needs PIN code displayed on TV screen |
| VIZIO TV 9643 | HomeKit Device | Needs PIN code displayed on TV screen |

---

## 4. Device Inventory

### 4.1 WiZ Bulbs (16 discovered / 26 expected)

All WiZ RGBW Tunable bulbs communicate via UDP port 38899. They are auto-discovered by HA.

| Entity ID | Friendly Name | State | Room (TBD) |
|-----------|---------------|-------|------------|
| `light.wiz_rgbw_tunable_81ab69` | WiZ RGBW Tunable 81AB69 | on | — |
| `light.wiz_rgbw_tunable_8175e4` | WiZ RGBW Tunable 8175E4 | on | — |
| `light.wiz_rgbw_tunable_81bc74` | WiZ RGBW Tunable 81BC74 | on | — |
| `light.wiz_rgbw_tunable_81d231` | WiZ RGBW Tunable 81D231 | on | — |
| `light.wiz_rgbw_tunable_816330` | WiZ RGBW Tunable 816330 | on | — |
| `light.wiz_rgbw_tunable_8173f0` | WiZ RGBW Tunable 8173F0 | on | — |
| `light.wiz_rgbw_tunable_816dcc` | WiZ RGBW Tunable 816DCC | on | — |
| `light.wiz_rgbw_tunable_81df16` | WiZ RGBW Tunable 81DF16 | on | — |
| `light.wiz_rgbw_tunable_819eee` | WiZ RGBW Tunable 819EEE | on | — |
| `light.wiz_rgbw_tunable_816499` | WiZ RGBW Tunable 816499 | on | — |
| `light.wiz_rgbw_tunable_8206c2` | WiZ RGBW Tunable 8206C2 | on | — |
| `light.wiz_rgbw_tunable_8151af` | WiZ RGBW Tunable 8151AF | on | — |
| `light.wiz_rgbw_tunable_81cce4` | WiZ RGBW Tunable 81CCE4 | on | — |
| `light.wiz_rgbw_tunable_819f3e` | WiZ RGBW Tunable 819F3E | on | — |
| `light.wiz_rgbw_tunable_81570d` | WiZ RGBW Tunable 81570D | on | — |
| `light.wiz_rgbw_tunable_819307` | WiZ RGBW Tunable 819307 | on | — |

**10 missing WiZ bulbs** — known locations:
- Master Pasture ceiling: 4 bulbs
- Kitchen: 6 bulbs (5 responding on old proxy, 1 offline)
- Living Room: 2 bulbs
- 4 unassigned IPs: .10, .120, .142, .212

**WiZ Proxy (legacy):** Still running on Almaca port 8902, tunneled via `cam.alpacaplayhouse.com`. Will be deprecated once all bulbs are in HAOS.

### 4.2 Sonos Speakers (9 speakers, 22 entities)

| Room | Entity | State |
|------|--------|-------|
| Living Sound | `media_player.living_sound` | idle |
| Dining Sound | `media_player.dining_sound` | paused |
| Front Outside Sound | `media_player.front_outside_sound` | paused |
| Skyloft Sound | `media_player.skyloft_sound` | idle |
| Outhouse | `media_player.outhouse` | paused |
| MasterBlaster | `media_player.masterblaster` | paused |
| Pequeno | `media_player.pequeno` | paused |
| DJ | `media_player.dj` | paused |
| garage outdoors | `media_player.garage_outdoors` | paused |

**Full Sonos room list** (from Sonos HTTP API on Almaca :5005):
Living Sound, Dining Sound, Outhouse, Skyloft Sound, Front Outside Sound, Pequeno, MasterBlaster, DJ, garage outdoors, Kitchen, Office, Bedroom, TV Room, Bathroom

**Sonos HTTP API** (legacy, still on Almaca):
```bash
curl http://192.168.1.200:5005/{Room}/musicsearch/spotify/song/{query}
curl http://192.168.1.200:5005/{Room}/{play|pause|stop}
```

### 4.3 TP-Link Smart Home (3 devices)

| Device | IP | Type | Entity |
|--------|-----|------|--------|
| Cabin 1 KL135 | 192.168.1.180 | Smart plug | `light.cabin_1` + power sensors |
| Nook HS220 | 192.168.1.101 | Dimmer switch | `light.nook` |
| Stair Landing HS210 | 192.168.1.230 | 3-way switch | `switch.stair_landing` |

Cabin 1 provides power consumption sensors: current (2.8W), today, this month, total.

### 4.4 Govee Lights — NOT YET IN HAOS (57 devices in Supabase)

Govee devices are controlled via Govee Cloud API through a Supabase edge function (`govee-control`). Need HACS Govee LAN integration for local control in HA.

| Area | Count | Types |
|------|-------|-------|
| Garage Mahal | 18 | Light bars (13 + 3 R-series + 1 group + 1 individual) |
| Spartan | 16 | Light bars (14), strip, wall light, 4 group controllers (Cedar Chamber, Fishbowl, Spartan Tea Lounge) |
| Outhouse | 7 | Light bars (6 + 1 group controller) |
| Outdoor | 12 | String lights, fence lights, floodlights, pathway lights |
| Interior | 5 | Strip lights, star projector, LED strips |

### 4.5 Nest Thermostats — NOT YET IN HAOS (3 in Supabase)

| Room | IP | Device Type |
|------|-----|-------------|
| Kitchen | 192.168.1.139 | Thermostat |
| Master | 192.168.1.111 | Thermostat |
| Skyloft | 192.168.1.249 | Thermostat |

**Setup requirements:**
1. Google Cloud project with Device Access API enabled
2. Nest Device Access console credentials (check Bitwarden for "Google Nest" or "Google Cloud")
3. OAuth 2.0 consent screen setup
4. One-time $5 fee for Device Access registration

### 4.6 LG Appliances — NOT YET IN HAOS (1 in Supabase)

| Device | Type |
|--------|------|
| Washer | washer |

Needs HACS integration: `SmartThinQ Sensors` or `LG ThinQ`

### 4.7 Tesla Vehicles — NOT YET IN HAOS (5 in Supabase)

| Name | Model | VIN | State |
|------|-------|-----|-------|
| Brisa Branca | Model 3 | 5YJ3E1EB0NF189739 | offline |
| Casper | Model 3 | 5YJ3E1EA3KF431880 | online |
| Cygnus | Model Y | 7SAYGDED0TA462517 | offline |
| Delphi | Model Y | 7SAYGDEE7PF923598 | offline |
| Sloop | Model Y | 7SAYGDED2TA496393 | online |

Needs HACS integration: `Tesla Custom Integration` — requires Tesla auth token.

### 4.8 Camera Streams — NOT YET IN HAOS (8 unique cameras)

| Camera | Location | IP | Model | Stream |
|--------|----------|-----|-------|--------|
| Alpacamera | Backyard/patio | 192.168.1.200 (Protect proxy) | G5 PTZ | RTSP :8554 |
| Front Of House | Front yard/driveway | 192.168.1.200 (Protect proxy) | G5 PTZ | RTSP :8554 |
| Side Yard | Side deck area | 192.168.1.200 (Protect proxy) | G5 PTZ | RTSP :8554 |
| Back Yard | Back yard | 192.168.1.24 | Wansview | RTSP :8554 |
| Front Cam | Front entrance | 192.168.1.132 | Wansview | RTSP :8554 |
| Garage | Garage | 192.168.1.18 | Wansview | RTSP :8554 |
| Patio Cam | Patio | 192.168.1.247 | Wansview | RTSP :8554 |
| Shed Cam | Shed | 192.168.1.28 | Wansview | RTSP :8554 |
| Driveway (Blink) | Driveway | 192.168.1.212 | Blink | RTSP :8554 |

**UniFi Protect integration** needs an API key from the UDM console (192.168.1.1). Create a local-only user with viewer permissions, then generate an API key.

**UDM Credentials:** `alpacaauto` / `StillForest160!auto`

### 4.9 OREIN/AiDot Matter Bulbs — BLOCKED (5 bulbs)

Master Bathroom ceiling lights. These are Matter-over-WiFi but commissioning is blocked:

| IP | MAC |
|----|-----|
| 192.168.1.31 | 50:78:7d:64:fc:1c |
| 192.168.1.98 | 50:78:7d:b3:30:14 |
| 192.168.1.102 | 50:78:7d:7b:67:80 |
| 192.168.1.159 | 50:78:7d:b3:32:6c |
| 192.168.1.187 | 3c:84:27:73:94:80 |

**Pairing code:** `31346312534` (passcode `20542615`, short disc `12`)

**Problem:** After factory reset, bulbs enter Matter commissioning for only 2-3 seconds before reconnecting to AiDot cloud.

**Resolution:** Block MACs from internet via UDM web UI → factory reset → bulbs stay in pairing mode → commission via HA Matter add-on.

### 4.10 Other Devices

| Device | Entity | State |
|--------|--------|-------|
| HP ENVY Photo 7800 | `sensor.hp_envy_photo_7800_series` | idle |
| — Black ink | `sensor.hp_envy_photo_7800_series_black_ink` | 60% |
| — Tri-color ink | `sensor.hp_envy_photo_7800_series_tri_color_ink` | 20% |
| Spartan WiiM | `media_player.spartan_wiim` | off |

---

## 5. HACS Installation (TODO)

HACS (Home Assistant Community Store) is needed for:
- **Govee LAN Control** — local Govee device control
- **Tesla Custom Integration** — Tesla vehicle integration
- **SmartThinQ Sensors** — LG washer/dryer
- **Govee Cloud** — fallback for Govee if LAN doesn't work

### Installation Steps

1. Install **Terminal & SSH** add-on from the add-on store (slug: `core_ssh`)
2. Start the add-on and open the terminal
3. Run: `wget -O - https://get.hacs.xyz | bash -`
4. Restart Home Assistant
5. Go to Settings → Integrations → Add Integration → search "HACS"
6. Follow GitHub OAuth flow to authenticate

---

## 6. Room/Area Assignments (TODO)

Rooms to create in HAOS (matching physical property):

| Room | Devices Expected |
|------|-----------------|
| Master Pasture | 4 WiZ bulbs, Nest thermostat |
| Kitchen | 6 WiZ bulbs, Nest thermostat, Sonos Kitchen |
| Living Room | 2 WiZ bulbs, Sonos Living Sound |
| Master Bathroom | 5 OREIN Matter bulbs |
| Skyloft | Nest thermostat, Sonos Skyloft Sound |
| Garage Mahal | 17 Govee light bars, Sonos garage outdoors |
| Spartan | 14 Govee light bars, WiiM speaker |
| Outhouse | 6 Govee light bars, Sonos Outhouse |
| Front Yard | Govee fence lights, Front Outside Sound |
| Back Yard | Govee string lights, cameras |
| Cabin 1 | TP-Link KL135 |
| Nook | TP-Link HS220 dimmer |
| Stair Landing | TP-Link HS210 switch |
| DJ Room | Sonos DJ |
| Dining Room | Sonos Dining Sound |
| Office | Sonos Office |
| Bedroom | Sonos Bedroom |
| TV Room | Sonos TV Room, VIZIO TV |
| Bathroom | Sonos Bathroom |

---

## 7. Planned Automations

| Automation | Trigger | Action |
|------------|---------|--------|
| Porch lights at sunset | Sun below horizon | Turn on Front fence, back patio lights |
| Porch lights off at sunrise | Sun above horizon | Turn off outdoor lights |
| Thermostat night mode | 10:00 PM daily | Set all thermostats to 68°F |
| Thermostat day mode | 7:00 AM daily | Set all thermostats to 72°F |
| Welcome home | Person arrives (phone GPS) | Turn on entry lights |
| Goodnight | 11:00 PM or voice command | Turn off all lights, lock doors |
| Laundry done | LG washer state → idle | Send notification |

---

## 8. Network Infrastructure

### UniFi Dream Machine Pro

| Setting | Value |
|---------|-------|
| IP | 192.168.1.1 |
| Web UI | https://192.168.1.1/ |
| Credentials | `alpacaauto` / `StillForest160!auto` |
| Firmware | 5.0.12 |
| Network App | 10.1.85 |

### Key Device IPs

| Device | IP | Purpose |
|--------|-----|---------|
| UDM Pro | 192.168.1.1 | Router, UniFi Protect |
| Almaca | 192.168.1.200 | Old HA Core, Sonos API, WiZ Proxy, Music Assistant, UniFi Protect RTSP proxy |
| HAOS VM | 192.168.1.39 | New Home Assistant OS |
| Nest Kitchen | 192.168.1.139 | Thermostat |
| Nest Master | 192.168.1.111 | Thermostat |
| Nest Skyloft | 192.168.1.249 | Thermostat |
| TP-Link Cabin 1 | 192.168.1.180 | Smart plug |
| TP-Link Nook | 192.168.1.101 | Dimmer |
| TP-Link Stair | 192.168.1.230 | Switch |

---

## 9. Legacy Systems (still running on Almaca)

These services on Almaca (192.168.1.200) will be migrated or deprecated:

| Service | Port | Status | Migrate? |
|---------|------|--------|----------|
| HA Core | 8123 | Running | Replaced by HAOS VM |
| Sonos HTTP API | 5005 | Running | Keep — HA Sonos integration is separate |
| WiZ Proxy | 8902 | Running | Deprecate once all WiZ in HAOS |
| Music Assistant | 8095 | Running | Already connected to HAOS |
| UP-Sense Monitor | cron | Running | Move to HAOS automation |

---

## 10. Troubleshooting

### HAOS VM won't start
```bash
# Check if QEMU process is running
ps aux | grep qemu

# Start manually
sudo ~/homeassistant-vm/start-ha.sh

# Check LaunchDaemon status
sudo launchctl list | grep homeassistant
```

### WiZ bulbs not discovering
- Bulbs use UDP broadcast on port 38899
- HAOS VM must be on the same subnet (bridged networking)
- Check: `nmap -sU -p 38899 192.168.1.0/24` from a machine on the LAN
- If bulbs are on a different VLAN, they won't be discovered

### Can't connect to HAOS
- Verify VM IP: `arp -a | grep 192.168.1.39`
- Check QEMU process: `ps aux | grep qemu`
- If IP changed: check DHCP leases in UDM → consider static assignment

### Sonos not showing all speakers
- HAOS and Sonos must be on same subnet
- Multicast/mDNS must be enabled on the network
- Check: `dns-sd -B _sonos._tcp` from a machine on the LAN

---

## 11. Quick Reference Commands

### Control lights via API
```bash
export HA_TOKEN="eyJhbGci..."  # Use the long-lived token

# Turn on all WiZ lights
curl -s -X POST http://192.168.1.39:8123/api/services/light/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "all"}'

# Set a specific light to warm white at 50% brightness
curl -s -X POST http://192.168.1.39:8123/api/services/light/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.wiz_rgbw_tunable_81ab69", "brightness": 128, "color_temp_kelvin": 3000}'

# Turn off stair landing switch
curl -s -X POST http://192.168.1.39:8123/api/services/switch/turn_off \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "switch.stair_landing"}'
```

### Sonos control via API
```bash
# Play/pause
curl -s -X POST http://192.168.1.39:8123/api/services/media_player/media_play_pause \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "media_player.living_sound"}'

# Set volume (0.0 - 1.0)
curl -s -X POST http://192.168.1.39:8123/api/services/media_player/volume_set \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "media_player.living_sound", "volume_level": 0.3}'
```

### Entity counts (current)
```
light          : 18  (16 WiZ + Cabin 1 + Nook)
media_player   : 22  (9 Sonos × 2 + WiiM × 3 + Jon)
switch         : 38  (Sonos alarms + TP-Link switches)
number         : 43  (Sonos EQ + WiZ effect speeds)
sensor         : 17  (TP-Link power + printer ink + sun + backup)
binary_sensor  :  3  (TP-Link cloud connections)
button         : 11  (Sonos favorites + WiiM controls)
update         :  4  (HA Core, OS, Supervisor, Matter Server)
─────────────────────
TOTAL          : 164 entities
```
