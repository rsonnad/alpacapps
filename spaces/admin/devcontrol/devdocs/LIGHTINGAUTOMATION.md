# Lighting Automation — Alpaca Playhouse

> Reference for all smart light devices, control commands, entity names, and backends.
> For HAOS setup, SSH access, and non-lighting devices see `devdocs/HOMEAUTOMATION.md`.
> **Per-bulb inventory lives in Supabase** (`lighting_devices`, `lighting_groups`, `lighting_group_targets`) — query DB for current state.

---

## How to Run Commands

Three ways to control lights, from simplest to lowest-level:

### 1. `lights.sh` — Human-friendly CLI (recommended)

On Alpuca or via SSH. No entity IDs needed.

```bash
# On Alpuca directly
~/lights.sh kitchen,living red
~/lights.sh all off
~/lights.sh skyloft 2700k 50%

# From another LAN machine
ssh paca@192.168.1.200 "~/lights.sh kitchen,living red"
```

**Rooms:** `kitchen`, `living`, `skyloft`, `skyloft-bath`, `master-bath`, `stairs`, `cabin`, `nook`, `all`
**Colors:** `red`, `green`, `blue`, `purple`, `magenta`, `pink`, `cyan`, `orange`, `amber`, `white`, `daylight`, `soft`, `warm`, `on`, `off`, or `NNNNk` (e.g. `2700k`)
**Brightness:** Optional percentage, e.g. `50%`. Default is 100%.

### 2. Light API — HTTP endpoint (for cloud, mobile apps, edge functions)

Public URL via Cloudflare Tunnel. Works from anywhere — cloud services, mobile apps, PAI agent.

- **URL:** `https://lights.alpacaplayhouse.com`
- **Auth:** Bearer token (stored in Bitwarden: "Light API — Alpuca")
- **LAN URL:** `http://192.168.1.200:8100` (no tunnel, faster)

```bash
# Control lights
curl -X POST https://lights.alpacaplayhouse.com/lights \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"rooms":"kitchen,living","color":"red","brightness":"50%"}'

# Health check (no auth)
curl https://lights.alpacaplayhouse.com/health

# List rooms/colors (auth required)
curl -H "Authorization: Bearer <token>" https://lights.alpacaplayhouse.com/lights/rooms
curl -H "Authorization: Bearer <token>" https://lights.alpacaplayhouse.com/lights/colors
```

**Response:** `{"status":"ok","rooms":"kitchen,living","color":"red","brightness":"50%"}`

**Service:** Python HTTP server at `~/light-api/server.py` on Alpuca, port 8100.
**LaunchAgent:** `com.alpacapps.light-api` (auto-start, keep-alive).
**Token file:** `~/light-api/.token` on Alpuca.
**Logs:** `/tmp/light-api.log`, `/tmp/light-api.err`

### 3. `ha-cmd.sh` — Raw HAOS service calls (low-level)

For entity-level control when `lights.sh` doesn't cover it (e.g. individual bulbs, non-light entities).

```bash
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.living_room_lights"}'
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.kitchen_lights","color_temp_kelvin":4000,"brightness":255}'
```

Uses a long-lived HAOS API token (expires 2036). Token in `devdocs/HOMEAUTOMATION.md` §1.

### Access matrix

| Caller | Use | Latency |
|--------|-----|---------|
| Claude Code (LAN) | `ssh paca@... "~/lights.sh ..."` | ~0.7s |
| Claude Desktop (Alpuca) | `~/lights.sh ...` | ~0.5s |
| PAI agent / edge functions | `POST https://lights.alpacaplayhouse.com/lights` | ~0.7s |
| Mobile apps | Same HTTP API | ~0.7s |
| Hostinger workers | Same HTTP API | ~0.7s |
| Alexa | Native HA Alexa integration (separate) | varies |

**DB query for current inventory:**
```sql
SELECT room, device_name, ha_entity_id, device_brand, protocol
FROM lighting_devices WHERE is_active ORDER BY room, socket_number;
```

---

## Room Command Reference

> All commands below use `~/ha-cmd.sh` directly (assumes running on Alpuca).
> From another machine, wrap with: `ssh -o StrictHostKeyChecking=no paca@192.168.1.200 "~/ha-cmd.sh '...' '{...}'"` (escape inner quotes).
> **Prefer `~/lights.sh` or the HTTP API** for standard room+color control.

### Living Room

**Entities:** `light.living_room_lights` (4 WiZ ceiling + 1 WiZ Printer Nook), `light.livingroom_strip_light` (Govee LED strip)

Individual: `light.wiz_rgbw_tunable_81d231` (#1), `_816330` (#2), `_8206c2` (#3), `_819eee` (#4), `_81ab69` (Printer Nook)

```bash
# Soft white
~/ha-cmd.sh 'light/turn_on' '{"entity_id":["light.living_room_lights","light.livingroom_strip_light"],"color_temp_kelvin":2700,"brightness":200}'

# RGB color (warm amber)
~/ha-cmd.sh 'light/turn_on' '{"entity_id":["light.living_room_lights","light.livingroom_strip_light"],"rgb_color":[255,147,41],"brightness":200}'

# Off
~/ha-cmd.sh 'light/turn_off' '{"entity_id":["light.living_room_lights","light.livingroom_strip_light"]}'
```

---

### Master Bathroom

**Entity:** `light.master_bathroom_lights` (5 OREIN Matter bulbs)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.master_bathroom_lights","color_temp_kelvin":3000,"brightness":180}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.master_bathroom_lights"}'
```

Individual: `light.smart_rgbtw_bulb` (Tub), `_2` (Shower), `_3` (Frig), `_4` (Closet), `_5` (Toilet)

---

### Skyloft Ceiling

**Entity:** `light.skyloft_lights` (5 WiZ BR30 bulbs; 6th offline)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.skyloft_lights","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.skyloft_lights"}'
```

---

### Skyloft Bathroom

**Entities:** `light.smart_rgbtw_bulb_10`, `light.smart_rgbtw_bulb_11` (2 OREIN Matter)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":["light.smart_rgbtw_bulb_10","light.smart_rgbtw_bulb_11"],"color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":["light.smart_rgbtw_bulb_10","light.smart_rgbtw_bulb_11"]}'
```

---

### Kitchen

**Entity:** `light.kitchen_lights` (5 WiZ + 1 Leedarson Matter + 4 Govee BR30 H6013)

Individual Govee BR30s: `light.kitchen_ceiling_5`, `light.kitchen_ceiling_6`, `light.kitchen_ceiling_7`, `light.kitchen_ceiling_8`

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.kitchen_lights","color_temp_kelvin":4000,"brightness":255}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.kitchen_lights"}'
```

---

### Stairs

**Entity:** `light.stairs_lights` (2 Linkind Matter bulbs)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.stairs_lights","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.stairs_lights"}'
```

Individual: `light.smart_rgbtw_bulb_6` (Top), `light.smart_rgbtw_bulb_7` (Bottom)

---

### Other Lights

| Room | Entity | Type |
|------|--------|------|
| Cabin 1 | `light.cabin_1` | TP-Link KL135 |
| Nook | `light.nook` | TP-Link HS220 dimmer |
| Stair Landing | `switch.stair_landing` | TP-Link HS210 |

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.nook","brightness":150}'
~/ha-cmd.sh 'switch/turn_on' '{"entity_id":"switch.stair_landing"}'
```

---

## Quick Entity Cheat Sheet

| Room | Entity | Turn off |
|------|--------|----------|
| Living Room | `light.living_room_lights` | `~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.living_room_lights"}'` |
| Living Strip | `light.livingroom_strip_light` | same pattern |
| Master Bath | `light.master_bathroom_lights` | same pattern |
| Skyloft Ceil | `light.skyloft_lights` | same pattern |
| Skyloft Bath | `light.smart_rgbtw_bulb_10`, `_11` | use array |
| Kitchen | `light.kitchen_lights` | same pattern |
| Stairs | `light.stairs_lights` | same pattern |
| Cabin 1 | `light.cabin_1` | same pattern |
| Nook | `light.nook` | same pattern |
| Stair Landing | `switch.stair_landing` | use `switch/turn_off` |

---

## Color Reference

### Color temperature (use `color_temp_kelvin`)

| Kelvin | Name |
|--------|------|
| 2200 | Candlelight |
| 2700 | Soft white |
| 3000 | Warm white |
| 4000 | Neutral white |
| 5000 | Bright white |
| 6500 | Daylight |

### Common RGB values (use `rgb_color: [R, G, B]`)

| Color | RGB |
|-------|-----|
| Warm amber | [255, 147, 41] |
| Red | [255, 0, 0] |
| Green | [0, 255, 0] |
| Blue | [0, 0, 255] |
| Purple | [128, 0, 255] |
| Pink | [255, 105, 180] |
| Cyan | [0, 255, 255] |

`brightness`: 0-255. Both `color_temp_kelvin` and `rgb_color` turn the light on if off.

---

## Device Inventory by Backend

### HAOS (via `~/ha-cmd.sh` on Alpuca)

| Room | Entity | Bulbs | Brand |
|------|--------|-------|-------|
| Living Room | `light.living_room_lights` | 4 WiZ ceiling + 1 WiZ nook | WiZ |
| Living Room strip | `light.livingroom_strip_light` | 15-segment LED | Govee |
| Master Bathroom | `light.master_bathroom_lights` | 5 | OREIN Matter |
| Skyloft Ceiling | `light.skyloft_lights` | 5 (6th offline) | WiZ BR30 |
| Skyloft Bathroom | `light.smart_rgbtw_bulb_10`, `_11` | 2 | OREIN Matter |
| Kitchen | `light.kitchen_lights` | 5 WiZ + 1 Matter + 4 Govee BR30 | WiZ/Leedarson/Govee |
| Stairs | `light.stairs_lights` | 2 | Linkind Matter |
| Cabin 1 | `light.cabin_1` | 1 | TP-Link KL135 |
| Nook | `light.nook` | 1 | TP-Link HS220 |
| Stair Landing | `switch.stair_landing` | - | TP-Link HS210 |

### WiZ Proxy — DEPRECATED

All WiZ bulbs are now in HAOS. Do not use the WiZ Proxy for new control.

### Govee (~63 devices — cloud only)

Controlled via `govee-control` Supabase edge function. Not yet in HAOS.

| Area | Count | Types |
|------|-------|-------|
| Garage Mahal | 18 | Light bars (R-series + standard) |
| Spartan | 16 | Light bars, strip, wall light |
| Outhouse | 7 | Light bars |
| Outdoor | 12 | String lights, fence, floods, pathway |
| Interior | 5 | LED strips, star projector |

### Tuya/SmartLife (~32 devices — cloud only)

Controlled via SmartLife app or Tuya Cloud API. Not yet in HAOS.
- Skyloft Bar GU10 spotlights (3 bulbs)
- Outdoor floods, string lights, dining bulbs

**Tuya Cloud credentials:** Access ID `c9rxjqkkc3wevmpm394c` · Secret `69a76a01c1b543ab93cd5ffdc13d9e95` · Data Center: Western America

---

## Troubleshooting

**WiZ bulbs not discovering in HAOS:**
- Bulbs use UDP broadcast on port 38899
- HAOS VM must be on same subnet (bridged networking)
- `nmap -sU -p 38899 192.168.1.0/24` to find them

**OREIN/Matter bulbs blocked (new commissioning):**
- After factory reset, bulbs enter pairing mode for only 2-3s before reconnecting to AiDot cloud
- Fix: block MACs from internet via UDM, factory reset, commission via HA Matter add-on

**SSH to Alpuca not working:**
- Key auth: `ssh paca@192.168.1.200` (preferred, tested working)
- If key auth fails, check `~/.ssh/authorized_keys` on Alpuca

---

## Planned / Future

- Add `tuya_cloud` backend to `home-assistant-control` edge function
- HACS Govee LAN integration — local control without cloud
- Map remaining WiZ entity IDs to rooms
- 6th Skyloft WiZ BR30 bulb needs WiFi pairing via WiZ app
