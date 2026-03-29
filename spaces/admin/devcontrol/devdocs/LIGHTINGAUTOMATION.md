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

**Rooms:** `kitchen`, `kitchen-nook`, `living`, `skyloft`, `skyloft-bath`, `master-bath`, `stairs`, `cabin`, `nook`, `garage`, `garage-ceiling`, `garage-dj`, `garage-opener`, `outhouse`, `cedar`, `fishbowl`, `tea-lounge`, `spartan`, `all`
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

**Entities:** `light.living_room_lights` (4 WiZ ceiling + 1 WiZ Printer Nook + 2 Pequeno Nook), `light.livingroom_strip_light` (Govee LED strip)

Individual WiZ: `light.wiz_rgbw_tunable_81d231` (#1), `_816330` (#2), `_8206c2` (#3), `_819eee` (#4), `_81ab69` (Printer Nook)
Pequeno Nook: `light.smart_rgbtw_bulb_15` (Pequeno Nook Light 1), `light.smart_rgbtw_bulb_16` (Pequeno Nook Light 2)

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

**Entity:** `light.skyloft_ceiling` (6 WiZ BR30 Color bulbs)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.skyloft_ceiling","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.skyloft_ceiling"}'
```

Individual bulbs (numbered by physical socket position):

| Pos | Entity | Friendly Name | IP | MAC |
|-----|--------|---------------|-----|-----|
| 1 | `light.wiz_rgbww_tunable_08d7cb` | Skyloft Ceiling 1 | .104 | a8bb5008d7cb |
| 2 | `light.wiz_rgbww_tunable_08d763` | Skyloft Ceiling 2 | .251 | a8bb5008d763 |
| 3 | `light.wiz_rgbww_tunable_09ffc8` | Skyloft Ceiling 3 | .34 | a8bb5009ffc8 |
| 4 | `light.wiz_rgbww_tunable_09b70b` | Skyloft Ceiling 4 | .245 | a8bb5009b70b |
| 5 | `light.wiz_rgbw_tunable_8175e4` | Skyloft Ceiling 5 | .92 | a8bb508175e4 |
| 6 | `light.wiz_rgbww_tunable_0a6817` | Skyloft Ceiling 6 | .58 | a8bb500a6817 |

> Note: Bulb 5 is RGBW (not RGBWW) — slightly different WiZ model than the other 5.

---

### Skyloft Bathroom

**Entity:** `light.skyloft_bathroom` (2 OREIN Matter RGBTW bulbs)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.skyloft_bathroom","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.skyloft_bathroom"}'
```

Individual: `light.smart_rgbtw_bulb_11` (Left), `light.smart_rgbtw_bulb_10` (Right)

---

### Skyloft Bar

**Entity:** `light.skyloft_bar` (3 Tuya/SmartLife GU10 spotlights via LocalTuya)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.skyloft_bar","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.skyloft_bar"}'
```

Individual: `light.skyloft_bar_light_1` (Left), `light.skyloft_bar_light_2` (Middle), `light.skyloft_bar_light_3` (Right)

| Pos | Device ID | Local Key | MAC | LAN IP |
|-----|-----------|-----------|-----|--------|
| L | `ebf88bedf1475f7186vj9p` | `WgoX04Glqf43cW^2` | `18:de:50:5f:66:90` | .162 |
| M | `eb7c2e2652329ff6cfuzvd` | `SP!'9GC5[aYY3)~t` | `18:de:50:5f:67:4c` | .211 |
| R | `eb0a46324e9dd058fcc0ez` | `.dz~?/yR6R2W85j8` | `38:a5:c9:7c:3c:de` | .22 |

Brand: Lightinginside LED-GU10-SM. Protocol: Tuya WiFi v3.3 (SmartLife app).

> **Status (2026-03-28):** LocalTuya port 6668 closed even when lights are on — currently unavailable in HAOS. Controllable via SmartLife app / Tuya Cloud API.

---

### Skyloft — All Lights

**Entity:** `light.skyloft_lights` (all 11 Skyloft lights — ceiling + bathroom + bar)

```bash
~/ha-cmd.sh 'light/turn_on' '{"entity_id":"light.skyloft_lights","color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":"light.skyloft_lights"}'
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

### Kitchen Nook

**Entities:** `light.smart_rgbtw_bulb_12` (Kitchen Nook 1), `light.smart_rgbtw_bulb_13` (Kitchen Nook 2), `light.smart_rgbtw_bulb_14` (Kitchen Nook 3) — 3 Linkind Matter RGBTW bulbs

```bash
# All 3 nook bulbs
~/ha-cmd.sh 'light/turn_on' '{"entity_id":["light.smart_rgbtw_bulb_12","light.smart_rgbtw_bulb_13","light.smart_rgbtw_bulb_14"],"color_temp_kelvin":3000,"brightness":200}'
~/ha-cmd.sh 'light/turn_off' '{"entity_id":["light.smart_rgbtw_bulb_12","light.smart_rgbtw_bulb_13","light.smart_rgbtw_bulb_14"]}'

# Or use lights.sh
~/lights.sh kitchen-nook warm 80%
```

---

### Garage Mahal

**Entities:** `light.garage_all` (all 16 Govee H601F bars), `light.garage_ceiling` (12 ceiling bars), `light.garage_dj` (4 DJ booth bars)

```bash
# All 16 bars
~/lights.sh garage red
~/lights.sh garage off

# Sub-groups
~/lights.sh garage-ceiling blue 80%
~/lights.sh garage-dj purple

# Opener lights (separate)
~/lights.sh garage-opener on
```

**Layout (4 rows × 4 columns, numbered left-to-right, front-to-back):**

| Pos | Physical Name | Govee Name | HAOS Entity | MAC |
|-----|--------------|------------|-------------|-----|
| 1 | Garage Ceiling 1 | Garage Mahal 12 | `light.garage_mahal_12` | 32:EF:DC:B4:D9:5A:07:7C |
| 2 | Garage Ceiling 2 | Garage Mahal 11 | `light.garage_mahal_11` | 8C:4B:DC:B4:D9:5A:06:C8 |
| 3 | Garage Ceiling 3 | Garage Mahal 10 | `light.garage_mahal_10` | 18:EB:DC:06:75:48:DC:98 |
| 4 | Garage Ceiling 4 | Garage Mahal 13 | `light.garage_mahal_13` | 1C:90:DC:06:75:4D:C1:E8 |
| 5 | Garage Ceiling 5 | Garage Mahal 3 | `light.garage_mahal_3` | 26:E2:DC:B4:D9:58:39:5C |
| 6 | Garage Ceiling 6 | Garage Mahal 5 | `light.garage_mahal_5` | 2B:D0:DC:B4:D9:58:3A:C8 |
| 7 | Garage Ceiling 7 | Garage Mahal 2 | `light.garage_mahal_2` | 0C:EC:DC:B4:D9:59:46:E8 |
| 8 | Garage Ceiling 8 | Garage Mahal 4 | `light.garage_mahal_4` | 7F:85:98:88:E0:FB:90:F0 |
| 9 | Garage Ceiling 9 | Garage Mahal 8 | `light.garage_mahal_8` | 0E:46:DC:B4:D9:58:24:2C |
| 10 | Garage Ceiling 10 | Garage Mahal 6 | `light.garage_mahal_6` | C1:61:DC:B4:D9:58:1A:88 |
| 11 | Garage Ceiling 11 | Garage Mahal 1 | `light.garage_mahal_1` | 2A:D4:DC:B4:D9:58:3A:8C |
| 12 | Garage Ceiling 12 | Garage Mahal 7 | `light.garage_mahal_7` | 16:45:DC:B4:D9:58:48:28 |
| DJ1 | Garage DJ 1 | Garage Mahal 9 | `light.garage_mahal_9` | D9:83:DC:B4:D9:56:91:24 |
| DJ2 | Garage DJ 2 | Garage Mahal R3 | `light.garage_mahal_r3` | 1D:28:DC:B4:D9:56:8D:EC |
| DJ3 | Garage DJ 3 | Garage Mahal R2 | `light.garage_mahal_r2` | 79:A5:DC:B4:D9:5A:12:14 |
| DJ4 | Garage DJ 4 | Garage Mahal R1 | `light.garage_mahal_r1` | E9:59:DC:B4:D9:59:42:50 |

**Opener lights:** `light.garage_opener_1`, `light.garage_opener_2` (separate from bars, already in HAOS)

> All 16 bars are Govee H601F (7-segment RGBIC). Controlled via HAOS Govee integration (not cloud API) for reliable group control.

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
| Skyloft All | `light.skyloft_lights` | same pattern |
| Skyloft Ceil | `light.skyloft_ceiling` | same pattern |
| Skyloft Bath | `light.skyloft_bathroom` | same pattern |
| Skyloft Bar | `light.skyloft_bar` | same pattern |
| Kitchen | `light.kitchen_lights` | same pattern |
| Kitchen Nook | `light.smart_rgbtw_bulb_12`, `_13`, `_14` | use array |
| Stairs | `light.stairs_lights` | same pattern |
| Cabin 1 | `light.cabin_1` | same pattern |
| Nook | `light.nook` | same pattern |
| Garage All | `light.garage_all` | `~/lights.sh garage off` |
| Garage Ceiling | `light.garage_ceiling` | `~/lights.sh garage-ceiling off` |
| Garage DJ | `light.garage_dj` | `~/lights.sh garage-dj off` |
| Garage Opener | `light.garage_opener_1`, `_2` | `~/lights.sh garage-opener off` |
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
| Living Room | `light.living_room_lights` | 4 WiZ ceiling + 1 WiZ nook + 2 Pequeno Nook | WiZ/Matter |
| Living Room strip | `light.livingroom_strip_light` | 15-segment LED | Govee |
| Master Bathroom | `light.master_bathroom_lights` | 5 | OREIN Matter |
| Skyloft All | `light.skyloft_lights` | 11 (6+2+3) | WiZ/OREIN/Tuya |
| Skyloft Ceiling | `light.skyloft_ceiling` | 6 | WiZ BR30 Color |
| Skyloft Bathroom | `light.skyloft_bathroom` | 2 | OREIN Matter |
| Skyloft Bar | `light.skyloft_bar` | 3 (unavailable) | Tuya GU10 (LocalTuya) |
| Kitchen | `light.kitchen_lights` | 5 WiZ + 1 Matter + 4 Govee BR30 | WiZ/Leedarson/Govee |
| Kitchen Nook | `light.smart_rgbtw_bulb_12`, `_13`, `_14` | 3 | Linkind Matter |
| Stairs | `light.stairs_lights` | 2 | Linkind Matter |
| Cabin 1 | `light.cabin_1` | 1 | TP-Link KL135 |
| Nook | `light.nook` | 1 | TP-Link HS220 |
| Garage All | `light.garage_all` | 16 | Govee H601F (via HACS) |
| Garage Ceiling | `light.garage_ceiling` | 12 | Govee H601F (via HACS) |
| Garage DJ | `light.garage_dj` | 4 | Govee H601F (via HACS) |
| Garage Opener | `light.garage_opener_1`, `_2` | 2 | (already provisioned) |
| Stair Landing | `switch.stair_landing` | - | TP-Link HS210 |

### WiZ Proxy — DEPRECATED

All WiZ bulbs are now in HAOS. Do not use the WiZ Proxy for new control.

### Govee (~63 devices — cloud API via `lights.sh` + HTTP API)

Controlled via Govee cloud API. Groups accessible through `lights.sh`, HTTP API, and `home-assistant-control` edge function.

> **Garage Mahal** moved to HAOS (via Govee HACS integration) for reliable group control. The 16 bars still use Govee cloud as a fallback but `lights.sh` routes through HAOS.

| Area | Room key | Backend | Count | Types |
|------|----------|---------|-------|-------|
| Garage Mahal | `garage` | HAOS (Govee integration) | 16 H601F | Light bars — see Garage Mahal section |
| Outhouse | `outhouse` | Govee Cloud (13166268) | 6 H601F | Light bars |
| Spartan Cedar | `cedar` | Govee Cloud (12001251) | 4 H601F | Light bars |
| Spartan Fishbowl | `fishbowl` | Govee Cloud (12411702) | 4 H601F/A | Light bars |
| Spartan Lounge | `tea-lounge` | Govee Cloud (12411623) | 4 H601A | Light bars |
| Outdoor | — | Govee Cloud | 12 | String lights, fence, floods, pathway |
| Interior | — | Govee Cloud | 5 | LED strips, star projector |

**Govee CLI examples:**
```bash
~/lights.sh garage red
~/lights.sh outhouse blue 50%
~/lights.sh spartan purple          # all 3 Spartan rooms
~/lights.sh cedar,fishbowl off
```

**Govee API key:** stored at `~/.govee-api-key` on Alpuca and in `govee_config` table (id=1).

**Alexa:** Enable the **Govee Home** Alexa skill. Groups from the Govee app (Garage Mahal, Outhouse, etc.) will appear as Alexa devices.

### Tuya/SmartLife (~32 devices — cloud only)

Controlled via SmartLife app or Tuya Cloud API. Not yet in HAOS.
- Skyloft Bar GU10 spotlights (3 bulbs)
- Outdoor floods, string lights, dining bulbs

**Tuya Cloud credentials:** Access ID `c9rxjqkkc3wevmpm394c` · Secret `69a76a01c1b543ab93cd5ffdc13d9e95` · Data Center: Western America

---

## Alexa Voice Control

### How it works

HAOS → Nabu Casa (Home Assistant Cloud) → Amazon Alexa Smart Home Skill

All `light` entities in HAOS are automatically exposed to Alexa via Nabu Casa. No per-entity configuration needed.

- **Nabu Casa account:** active (trial subscription)
- **Alexa enabled:** `true` (in `.storage/cloud` on HAOS)
- **Remote URL:** `7nwydzudzhis82jcmf1mfzezaaw3hvgu.ui.nabu.casa`

### Voice commands

| Command | What it does |
|---------|-------------|
| "Alexa, turn on Skyloft Lights" | All 11 Skyloft lights (ceiling + bathroom + bar) |
| "Alexa, turn on Skyloft Ceiling" | 6 ceiling WiZ bulbs |
| "Alexa, turn on Skyloft Bathroom" | 2 bathroom OREIN bulbs |
| "Alexa, set Skyloft Ceiling to 50%" | Dim ceiling to 50% |
| "Alexa, turn Skyloft Lights red" | Set all Skyloft lights to red |
| "Alexa, turn on lights" | Controls lights in the Echo's assigned room |

### Room-aware control ("Alexa, turn on lights")

When an Echo device and lights are in the same Alexa room, "Alexa, turn on lights" (no room name) controls just that room's lights from that specific Echo.

**Setup in Alexa app:**
1. Discover devices: say "Alexa, discover devices" (or Alexa app → Devices → + → scan)
2. Create room: Devices → + → Add Room → name it (e.g., "Skyloft")
3. Add the Echo device in that room to the Alexa room
4. Add the light groups (e.g., "Skyloft Ceiling", "Skyloft Bathroom") to that room
5. Now "Alexa, turn on lights" from that Echo = only that room's lights

### Adding new HAOS lights to Alexa

1. Add the light entity to HAOS (via integration or configuration.yaml group)
2. Say "Alexa, discover devices" — Nabu Casa auto-exposes all `light` entities
3. Assign the new device to the correct Alexa room

### Govee lights on Alexa

Govee devices use the **Govee Home** Alexa skill (separate from HAOS/Nabu Casa).

1. Install "Govee Home" skill in Alexa app
2. Link Govee account (same credentials as Govee app)
3. Say "Alexa, discover devices" — all Govee groups appear (Garage Mahal, Outhouse, Cedar Chamber, Fishbowl, Spartan Tea Lounge)
4. Assign each to the correct Alexa room

| Voice command | What it does |
|--------------|-------------|
| "Alexa, turn on Garage Mahal" | All 16 light bars on |
| "Alexa, turn Outhouse red" | 6 light bars → red |
| "Alexa, set Garage Mahal to 50%" | Dim to 50% |
| "Alexa, turn off Cedar Chamber" | Cedar Chamber off |

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

- Fix Skyloft Bar GU10 LocalTuya connection — port 6668 stays closed. May need Tuya Cloud integration instead of LocalTuya
- Add `tuya_cloud` backend to `home-assistant-control` edge function
- HACS Govee LAN integration — local control without cloud (fallback for API outages)
- Set up Alexa rooms for all areas (Kitchen, Living Room, Master Bathroom, Stairs, Skyloft, Garage Mahal)
- Add outdoor Govee groups (string lights, fence, floods) to `lights.sh` once needed
- Migrate Outhouse + Spartan to HAOS Govee integration (same as Garage Mahal)
