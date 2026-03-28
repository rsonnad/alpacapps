# Lighting Automation — Alpaca Playhouse

> Reference for all smart light devices, control commands, entity names, and backends.
> For HAOS setup, SSH access, and non-lighting devices see `docs/HOMEAUTOMATION.md`.

---

## How to Run Commands

All light control goes through **HAOS** (Home Assistant OS at `192.168.1.39:8123`) via SSH to Alpuca.

**⚠️ `~/bin/alpuca ha` is broken** — its password SSH auth fails. Use direct SSH with key auth:

```bash
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no -o ConnectTimeout=5 alpuca@192.168.1.200 \
  "~/ha-cmd.sh '<domain/service>' '<json>'"
```

`~/ha-cmd.sh` on Alpuca handles HAOS auth (`alpacaadmin`/`playhouse`) with 25-min token caching.

The long-lived HA API token (if needed directly) is in `docs/HOMEAUTOMATION.md` §1.

---

## Room Command Reference

### Living Room

**Entities:**
- `light.living_room_lights` — 5 WiZ bulbs + 1 Matter bulb (group)
- `light.livingroom_strip_light` — Govee LED strip (15 segments)

```bash
# Soft white (2700K) — default scene
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"],\"color_temp_kelvin\":2700,\"brightness\":200}'"

# RGB color (example: warm amber)
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"],\"rgb_color\":[255,147,41],\"brightness\":200}'"

# Turn off
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_off' '{\"entity_id\":[\"light.living_room_lights\",\"light.livingroom_strip_light\"]}'"
```

---

### Master Bathroom

**Entity:** `light.master_bathroom_lights` (5 OREIN Matter bulbs)

```bash
~/bin/alpuca mb-off
~/bin/alpuca mb-on 200         # brightness 0–255

# Custom color/temp via SSH
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.master_bathroom_lights\",\"color_temp_kelvin\":3000,\"brightness\":180}'"
```

Individual bulb entities: `light.smart_rgbtw_bulb` (Tub), `_2` (Shower), `_3` (Frig), `_4` (Closet), `_5` (Toilet)

---

### Skyloft Ceiling

**Entity:** `light.skyloft_lights` (5 WiZ BR30 bulbs; 6th bulb not yet on WiFi)

```bash
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.skyloft_lights\",\"color_temp_kelvin\":3000,\"brightness\":200}'"
```

---

### Skyloft Bathroom

**Entities:** `light.smart_rgbtw_bulb_10`, `light.smart_rgbtw_bulb_11` (2 OREIN Matter bulbs)

```bash
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":[\"light.smart_rgbtw_bulb_10\",\"light.smart_rgbtw_bulb_11\"],\"color_temp_kelvin\":3000,\"brightness\":200}'"
```

---

### Kitchen

**Entity:** `light.kitchen_lights` (5 WiZ bulbs + 2 Leedarson Matter bulbs)

```bash
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
  "~/ha-cmd.sh 'light/turn_on' '{\"entity_id\":\"light.kitchen_lights\",\"color_temp_kelvin\":4000,\"brightness\":255}'"
```

---

### Other TP-Link lights

| Room | Entity | Type |
|------|--------|------|
| Cabin 1 | `light.cabin_1` | TP-Link KL135 smart plug |
| Nook | `light.nook` | TP-Link HS220 dimmer |

```bash
ssh -o PubkeyAuthentication=yes -o PasswordAuthentication=no -o StrictHostKeyChecking=no alpuca@192.168.1.200 \
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

### WiZ Proxy (legacy — Almaca port 8902)

WiZ bulbs are also reachable directly via the WiZ Proxy on Almaca. This is the legacy path — all WiZ bulbs are now in HAOS. Use HAOS commands above instead. Proxy will be deprecated once stable.

**Proxy auth token:** `ba3497a6a682aa51b5706918d766c4fddeda38c7d4ef2045ea373b025befe063`
**LAN:** `http://192.168.1.74:8902` · **Tunnel:** `https://cam.alpacaplayhouse.com`

```bash
# Direct WiZ group command (bypass HAOS)
curl -s -X POST http://192.168.1.74:8902/group/temperature \
  -H "Authorization: Bearer ba3497a6a682aa51b5706918d766c4fddeda38c7d4ef2045ea373b025befe063" \
  -H "Content-Type: application/json" \
  -d '{"ips":["192.168.1.106","192.168.1.138"],"temp":2700,"dimming":80}'
```

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

## WiZ Bulb Entity Map (16 discovered in HAOS)

| Entity ID | Room (TBD) |
|-----------|------------|
| `light.wiz_rgbw_tunable_81ab69` | — |
| `light.wiz_rgbw_tunable_8175e4` | — |
| `light.wiz_rgbw_tunable_81bc74` | — |
| `light.wiz_rgbw_tunable_81d231` | Living Room (group member) |
| `light.wiz_rgbw_tunable_816330` | Living Room (group member) |
| `light.wiz_rgbw_tunable_8173f0` | — |
| `light.wiz_rgbw_tunable_816dcc` | — |
| `light.wiz_rgbw_tunable_81df16` | — |
| `light.wiz_rgbw_tunable_819eee` | Living Room (group member) |
| `light.wiz_rgbw_tunable_816499` | — |
| `light.wiz_rgbw_tunable_8206c2` | Living Room (group member) |
| `light.wiz_rgbw_tunable_8151af` | — |
| `light.wiz_rgbw_tunable_81cce4` | — |
| `light.wiz_rgbw_tunable_819f3e` | — |
| `light.wiz_rgbw_tunable_81570d` | — |
| `light.wiz_rgbw_tunable_819307` | — |
| `light.wiz_rgbw_tunable_81ab69` | Living Room (group member) |

**10 WiZ bulbs not yet discovered** in HAOS: Master Pasture (4), Kitchen (6, 1 offline)

---

## Troubleshooting

**WiZ bulbs not discovering in HAOS:**
- Bulbs use UDP broadcast on port 38899
- HAOS VM must be on same subnet (bridged networking)
- `nmap -sU -p 38899 192.168.1.0/24` to find them

**OREIN/Matter bulbs blocked (new commissioning):**
- After factory reset, bulbs enter pairing mode for only 2–3s before reconnecting to AiDot cloud
- Fix: block MACs from internet via UDM → factory reset → commission via HA Matter add-on

**`alpuca ha` wrapper not working:**
- Uses password SSH auth which is currently broken on Alpuca
- Use direct `ssh -o PubkeyAuthentication=yes ... alpuca@192.168.1.200` instead

---

## Planned / Future

- Add `tuya_cloud` backend to `home-assistant-control` edge function (see `docs/guides/light-control-performance.md`)
- HACS Govee LAN integration — local control without cloud
- Map remaining WiZ entity IDs to rooms
- 6th Skyloft WiZ BR30 bulb needs WiFi pairing via WiZ app
