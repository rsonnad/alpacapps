# Home Assistant Unified Lighting Design

## Goal

Use Home Assistant (HA) as the single control plane for all lighting so residents and PAI can control lights without vendor apps (WiZ, Linkind, Govee Home, Alexa app).

Scope includes:
- WiZ bulbs (existing kitchen/living/master groups)
- Matter bulbs (Linkind + Govee Matter + other Matter lights)
- Existing non-Matter Govee devices (via HA integrations where possible, or temporary fallback path)

---

## Current State (What Exists Today)

### Implemented
- Resident lighting UI is Govee-only (`residents/lighting.js`, `shared/services/lighting-data.js`).
- `govee-control` edge function controls Govee Cloud API.
- `scripts/wiz-proxy/server.js` provides HTTP -> WiZ UDP control.
- `alexa-room-control` edge function already supports room-based WiZ + Govee control.
- DB table `alexa_room_targets` already stores room mappings with `wiz_ips` and `govee_group_ids`.

### Not implemented yet
- No Home Assistant runtime integration in edge functions.
- No Matter control path in app backend.
- No unified room/group abstraction in resident UI across multiple backends.

---

## Recommended Architecture (Best Model)

### Control model

Use a **Room-Oriented Entity Model**:
- Product layer controls rooms/groups (Kitchen, Living Room, Master Pasture).
- Integration layer resolves each room to one or more HA entities.
- Adapter layer translates commands into HA service calls.

This is the best fit because user intent is room-first, not device-ID-first.

### System model

1. **Home Assistant as Source of Truth**
   - HA owns devices, entities, groups/scenes, and Matter commissioning.
   - App stops doing direct vendor device discovery over time.

2. **Supabase as Policy + UX Index**
   - Keep auth, role checks, and app-facing metadata in Supabase.
   - Store a lightweight mapping of app room/group -> HA entity IDs.

3. **Edge Function as Secure HA Gateway**
   - Add `home-assistant-control` edge function.
   - Frontend/PAI call edge function, never HA directly.
   - Function enforces permissions and logs command events.

4. **Fallback adapters during migration**
   - WiZ path can remain via `wiz-proxy` while HA entities are being validated.
   - Existing `govee-control` can remain for non-Matter Govee until moved to HA.

---

## Data Design

## New tables

### `lighting_groups`
- `id` uuid pk
- `key` text unique (`kitchen`, `living_room`, etc.)
- `name` text
- `area` text
- `display_order` int
- `is_active` bool
- `created_at`, `updated_at`

### `lighting_group_targets`
- `id` uuid pk
- `group_id` uuid fk -> `lighting_groups.id`
- `backend` text check in (`home_assistant`, `wiz_proxy`, `govee_cloud`)
- `target_id` text (for HA: `light.kitchen_ceiling`; for fallback: group/device key)
- `metadata` jsonb (optional brightness/color limits, transition defaults)
- `is_active` bool
- `created_at`, `updated_at`

### `home_assistant_entities` (optional cache table)
- `entity_id` text pk
- `domain` text
- `friendly_name` text
- `area_name` text
- `capabilities` jsonb
- `is_active` bool
- `last_seen_at` timestamptz
- `updated_at` timestamptz

## Existing table reuse

- `alexa_room_targets` can be migration input but should not be long-term canonical model.
- `govee_devices` remains useful during transition.

---

## Edge Function Design

## `home-assistant-control`

Actions:
- `list_entities`
- `get_group_state`
- `set_power`
- `set_brightness`
- `set_color`
- `activate_scene`

Request shape:
- `{ action, groupKey?, entityIds?, payload? }`

Behavior:
1. Authenticate user and enforce `control_lighting`.
2. Resolve `groupKey` to one or more targets from `lighting_group_targets`.
3. For `home_assistant` targets:
   - call HA REST API service endpoints (`/api/services/light/turn_on`, `/turn_off`, etc.).
4. For fallback targets:
   - route to existing adapters (`wiz-proxy`, `govee-control`) until migrated.
5. Return normalized state payload to frontend.

Secrets:
- `HA_BASE_URL`
- `HA_TOKEN`
- Optional: `HA_TIMEOUT_MS`, `HA_VERIFY_TLS`

---

## Frontend Design

1. Introduce provider-agnostic lighting data service:
   - `shared/services/unified-lighting-data.js`
2. Render by logical groups (`lighting_groups`) not vendor tables.
3. Keep current card controls (power, brightness, color, scenes).
4. Add status badges for partial backend failures (ex: 5/6 targets succeeded).

Migration approach:
- Keep existing `residents/lighting.js` UI shell.
- Swap data source + control API progressively.

---

## PAI Design

Update PAI lighting tools to call unified group controls:
- Preferred tool: `control_lights` with room/group names.
- Backend resolves to `home-assistant-control`.
- During transition, backend fan-outs to fallback adapters where needed.

This keeps PAI prompt/API stable while infrastructure changes underneath.

---

## Rollout Plan

### Phase 0: Discovery + mapping
- Stand up HA inventory export.
- Map current rooms to HA entities.
- Confirm all Linkind + Govee Matter bulbs are in HA and controllable.

### Phase 1: Backend gateway
- Implement `home-assistant-control` with read-only actions first.
- Add `set_power` and `set_brightness`.
- Add command audit logging (table or existing error log pattern).

### Phase 2: Room abstraction
- Create `lighting_groups` + `lighting_group_targets`.
- Seed from known rooms (`kitchen`, `living_room`, `master_pasture`).
- Implement fallback routing for any missing HA entities.

### Phase 3: Resident UI migration
- Move resident lighting page to unified service.
- Verify group actions, state polling, and scene activation.

### Phase 4: PAI migration
- Point PAI light control to unified backend.
- Validate natural-language room control end-to-end.

### Phase 5: Decommission old paths
- Remove direct Govee-first assumptions from lighting UI.
- Keep `wiz-proxy` only if still needed as temporary adapter.
- Retain `alexa-room-control` only if still actively used.

---

## Risks and Mitigations

- **Entity churn in HA** (renamed `entity_id`s): use stable group keys + sync tooling.
- **Partial room failures**: return per-target results; UI shows degraded success.
- **Matter commissioning overhead**: stage by room; do not block WiZ/Govee controls.
- **Latency/timeouts**: apply retry/backoff and command timeout envelopes in edge function.

---

## Success Criteria

- Resident can control every room light from one page without vendor apps.
- PAI can control all room lights with a single tool path.
- Kitchen controls both WiZ and Linkind/Matter from one group action.
- No direct vendor app dependency for routine operations.
