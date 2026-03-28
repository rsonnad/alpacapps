# Lighting Automation — Alpaca Playhouse

> Reference for all smart light devices, control commands, entity names, and backends.
> For HAOS setup, SSH access, and non-lighting devices see `devdocs/HOMEAUTOMATION.md`.
> **Per-bulb inventory lives in Supabase** (`lighting_devices`, `lighting_groups`, `lighting_group_targets`) — query DB for current state.

---

## How to Run Commands

All light control goes through **HAOS** (Home Assistant OS at `192.168.1.39:8123`) via SSH to Alpuca.

Use **password SSH** (tested working 2026-03-27):

```bash
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" \
  ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  -o StrictHostKeyChecking=no -o ConnectTimeout=10 alpuca@192.168.1.200 \
  "~/ha-cmd.sh '<domain/service>' '<json>'"
```

`~/ha-cmd.sh` on Alpuca handles HAOS auth (`alpacaadmin`/`playhouse`) with 25-min token caching. The long-lived HA API token (if needed directly) is in `devdocs/HOMEAUTOMATION.md` §1.

**DB query for current inventory:**
```sql
SELECT room, device_name, ha_entity_id, device_brand, protocol
FROM lighting_devices WHERE is_active ORDER BY room, socket_number;
```

---

## Room Command Reference

### Living Room

**Entities:**
- `light.living_room_lights` — 5 WiZ bulbs + 1 Matter bulb (group)
- `light.livingroom_strip_light` — Govee LED strip (15 segments)

```bash
# Soft white (2700K) — default scene
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"],\"color_temp_kelvin\":2700,\"brightness\":200}'"

# RGB color (example: warm amber)
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"],\"rgb_color\":[255,147,41],\"brightness\":200}'"

# Turn off
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_off' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"]}'"
```

---

### Master Bathroom

**Entity:** `light.master_bathroom_lights` (5 OREIN Matter bulbs)

```bash
~/bin/alpuca mb-off
~/bin/alpuca mb-on 200         # brightness 0–255

# Custom color/temp via SSH
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.master_bathroom_lights\",\"color_temp_kelvin\":3000,\"brightness\":180}'"
```

Individual bulb entities: `light.smart_rgbtw_bulb` (Tub), `_2` (Shower), `_3` (Frig), `_4` (Closet), `_5` (Toilet)

---

### Skyloft Ceiling

**Entity:** `light.skyloft_lights` (5 WiZ BR30 bulbs; 6th bulb not yet on WiFi)

```bash
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.skyloft_lights\",\"color_temp_kelvin\":3000,\"brightness\":200}'"
```

---

### Skyloft Bathroom

**Entities:** `light.smart_rgbtw_bulb_10`, `light.smart_rgbtw_bulb_11` (2 OREIN Matter bulbs)

```bash
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.smart_rgbtw_bulb_10\",\"light.smart_rgbtw_bulb_11\"],\"color_temp_kelvin\":3000,\"brightness\":200}'"
```

---

### Kitchen

**Entity:** `light.kitchen_lights` (5 WiZ bulbs + 2 Leedarson Matter bulbs)

```bash
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.kitchen_lights\",\"color_temp_kelvin\":4000,\"brightness\":255}'"
```

---

### Other TP-Link lights

| Room | Entity | Type |
|------|--------|------|
| Cabin 1 | `light.cabin_1` | TP-Link KL135 smart plug |
| Nook | `light.nook` | TP-Link HS220 dimmer |

```bash
sshpass -p "$(bw-read 'Alpuca — Primary Home Server (Mac mini M4)')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.nook\",\"brightness\":150}'"
```

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

`brightness`: 0–255. Both `color_temp_kelvin` and `rgb_color` turn the light on if it's off.

---

## Device Inventory by Backend

### HAOS (via SSH to Alpuca)

All lights below are controlled via `~/ha-cmd.sh` on Alpuca:

| Room | Entity | Bulbs | Brand |
|------|--------|-------|-------|
| Living Room | `light.living_room_lights` | 5 WiZ + 1 Matter | WiZ/Leedarson |
| Living Room strip | `light.livingroom_strip_light` | 15-segment LED | Govee |
| Master Bathroom | `light.master_bathroom_lights` | 5 | OREIN Matter |
| Skyloft Ceiling | `light.skyloft_lights` | 5 (6th offline) | WiZ BR30 |
| Skyloft Bathroom | `light.smart_rgbtw_bulb_10`, `_11` | 2 | OREIN Matter |
| Kitchen | `light.kitchen_lights` | 5 WiZ + 2 Matter | WiZ/Leedarson |
| Cabin 1 | `light.cabin_1` | 1 | TP-Link KL135 |
| Nook | `light.nook` | 1 | TP-Link HS220 |
| Stair Landing | `switch.stair_landing` | — | TP-Link HS210 |

### WiZ Proxy — DEPRECATED

All WiZ bulbs are now in HAOS. Do not use the WiZ Proxy for new control. Use HAOS commands above.

> Legacy proxy ran on Almaca (192.168.1.74:8902), tunnelled via `cam.alpacaplayhouse.com`. Kept for reference only.

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

## WiZ Bulb Entity Map

Individual entity IDs and room assignments are stored in `lighting_devices` table. Query for current state:

```sql
SELECT ha_entity_id, device_name, room, mac_address, ip_address
FROM lighting_devices WHERE device_brand = 'WiZ' AND is_active ORDER BY room, socket_number;
```

Live entity IDs seen in HAOS (2026-03-27): `light.wiz_rgbww_tunable_09b70b`, `light.wiz_rgbw_tunable_816499`, `light.wiz_rgbw_tunable_81df16`, `light.wiz_rgbw_tunable_819f3e`, `light.wiz_rgbw_tunable_816dcc`, `light.wiz_rgbw_tunable_81570d`, `light.wiz_rgbw_tunable_819eee`, `light.wiz_rgbw_tunable_819307`, `light.wiz_rgbw_tunable_8173f0`, `light.wiz_rgbww_tunable_09ffc8`, `light.wiz_rgbw_tunable_8175e4`, `light.wiz_rgbw_tunable_8206c2`, `light.wiz_rgbw_tunable_81bc74`, `light.wiz_rgbww_tunable_0a6817`, `light.wiz_rgbw_tunable_81d231`, `light.wiz_rgbw_tunable_81cce4` + Skyloft BR30s.

---

## Troubleshooting

**WiZ bulbs not discovering in HAOS:**
- Bulbs use UDP broadcast on port 38899
- HAOS VM must be on same subnet (bridged networking)
- `nmap -sU -p 38899 192.168.1.0/24` to find them

**OREIN/Matter bulbs blocked (new commissioning):**
- After factory reset, bulbs enter pairing mode for only 2–3s before reconnecting to AiDot cloud
- Fix: block MACs from internet via UDM → factory reset → commission via HA Matter add-on

**SSH to Alpuca not working:**
- Use `sshpass` with password from Bitwarden (see §How to Run Commands above)
- Password SSH confirmed working 2026-03-27; key auth may or may not work depending on config

---

## Planned / Future

- Add `tuya_cloud` backend to `home-assistant-control` edge function (see `docs/guides/light-control-performance.md`)
- HACS Govee LAN integration — local control without cloud
- Map remaining WiZ entity IDs to rooms
- 6th Skyloft WiZ BR30 bulb needs WiFi pairing via WiZ app
