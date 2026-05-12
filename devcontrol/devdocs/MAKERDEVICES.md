# Maker Devices — Glowforge + FlashForge

Operational notes for the maker tools surfaced in `/devices/appliances.html`.

## Overview

| Device | UI section | Edge function | Data service | Tables |
| --- | --- | --- | --- | --- |
| Glowforge Plus laser cutter | Maker Tools | `glowforge-control` | `shared/services/glowforge-data.js` | `glowforge_config`, `glowforge_machines` |
| FlashForge Adventurer 5M Pro | 3D Printing | `printer-control` | `shared/services/printer-data.js` | `printer_config`, `printer_devices` |

Deploy both edge functions with `--no-verify-jwt` because each function performs its own app-user permission checks.

## Glowforge Plus

### Current Shape

- Read-only status integration. No write/control endpoints are documented or implemented.
- Live endpoint: `https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/glowforge-control`
- Cloud API target: `https://api.glowforge.com/gfcore/users/machines`
- Auth: email/password sign-in at `accounts.glowforge.com`, CSRF token, then session cookies.
- Credentials live in Supabase secrets: `GLOWFORGE_EMAIL`, `GLOWFORGE_PASSWORD`.
- Runtime session cookies are cached in `glowforge_config.session_cookies` with a 7-day expiry.
- `session_cookies` and `session_expires_at` are sensitive. Do not expose them to `authenticated` users or frontend `select('*')` calls.

### Important 2026-05 Finding

The Glowforge credentials in Bitwarden are valid, and local login from this Mac can fetch one machine:

- Machine serial: `GQF-892`
- Display name in AlpacApps: `Glowforge`
- Type: `plus`

However, Glowforge rejects sessions created directly from Supabase Edge with:

```text
Glowforge API returned 401: {"errors":["User not found"]}
```

The edge runtime successfully collects the expected cookie names:

```text
_gf_user_session, remember_user_token, gfrt, gf_has_session
```

So the failure is not missing cookies or stale Supabase secrets. The working path is:

1. Create a Glowforge session from a local trusted machine with `npm run glowforge:refresh-session`.
2. The script verifies the machines API and stores that cookie string in `glowforge_config.session_cookies`.
3. Let `glowforge-control` use the cached session for `getStatus`.

With a locally seeded session, the deployed edge function returns one machine and the immediate second call returns `{ cached: true }`.

### Local Session Refresh Script

Run this from a trusted local Mac when `glowforge_config.session_expires_at` is near expiry or when the function reports `User not found` after re-auth:

```bash
npm run glowforge:refresh-session
```

What it does:

1. Reads Glowforge credentials from Bitwarden item `Glowforge — Laser Cutter API`.
2. Logs into `accounts.glowforge.com` locally.
3. Verifies `https://api.glowforge.com/gfcore/users/machines` returns machine data.
4. Reads Supabase connection fields from Bitwarden item `Supabase — AlpacApps Project`.
5. Updates `glowforge_config.session_cookies`, `session_expires_at`, clears `last_error`, and leaves the cookies service-role-only.

Dry run:

```bash
npm run glowforge:refresh-session -- --dry-run
```

Environment overrides:

```bash
GLOWFORGE_BW_ITEM="Glowforge — Laser Cutter API" \
SUPABASE_BW_ITEM="Supabase — AlpacApps Project" \
PSQL_BIN="/opt/homebrew/opt/libpq/bin/psql" \
npm run glowforge:refresh-session
```

### Refresh And Throttle Behavior

- `glowforge-control` checks `glowforge_config.last_synced_at`.
- If the previous sync is under 30 seconds old and `force` is not true, it returns cached rows from `glowforge_machines`.
- Normal frontend calls do not force refresh.
- `shared/services/glowforge-data.js` accepts `refreshGlowforgeStatus({ force: true })` if an admin-only forced refresh is ever needed.

### Security Notes

- Never render or log cookie values.
- It is acceptable to log cookie names for diagnostics.
- Frontend admin settings must select only non-sensitive config columns:

```js
.select('id, is_active, test_mode, last_error, last_synced_at, updated_at')
```

- External strings from Glowforge API responses must be HTML-escaped before writing to `innerHTML`.

### Useful Commands

Deploy:

```bash
supabase functions deploy glowforge-control --no-verify-jwt --project-ref aphrrfprbixmhissnjfn
```

Test through the deployed function with a normal user JWT:

```bash
curl -sS -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/glowforge-control" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"getStatus"}'
```

Expected success shape:

```json
{
  "machines": [],
  "count": 1,
  "cached": false
}
```

## FlashForge Adventurer 5M Pro

### Current Shape

- Device name: `Alpaca Foundry`
- Model: FlashForge Adventurer 5M Pro
- Serial: `SNMSQE9C09604`
- Firmware: `v3.2.7`
- Build volume: `220x220x220mm`
- LAN IP: `192.168.1.106`
- TCP control port: `8899`
- MJPEG camera: `http://192.168.1.106:8080/?action=stream`

### Architecture

The printer speaks a LAN TCP G-code protocol, so AlpacApps uses a proxy chain:

```text
Browser
  -> printer-control Supabase edge function
  -> Hostinger Caddy
  -> Tailscale to Alpuca LAN
  -> printer-proxy.js HTTP bridge on port 8913
  -> FlashForge TCP port 8899
```

The proxy health check listens on port 8914. The proxy handles FlashForge control acquisition:

```text
M601 S1 -> command -> M602
```

### Commands

Common G-code commands used by the proxy/function:

| Command | Purpose |
| --- | --- |
| `M115` | Printer info |
| `M105` | Temperatures |
| `M27` | Print progress |
| `M119` | Endstops |
| `M23` / `M24` | Select/start print |
| `M25` | Pause print |
| `M26` | Resume/cancel-style print control, depending on wrapper |
| `M104` | Set nozzle temperature |
| `M140` | Set bed temperature |
| `M146` | LED control |
| `G28` | Home axes |
| `M661` | List files |

### Config And Permissions

- Edge function: `supabase/functions/printer-control/index.ts`
- Data service: `shared/services/printer-data.js`
- UI: `/devices/appliances.html` 3D Printing section and `/devices/3dprinter.html`
- Proxy config table: `printer_config`
- Device cache table: `printer_devices`
- Permissions:
  - `view_printer`
  - `control_printer`
  - `admin_printer_settings`

### Useful Commands

Deploy:

```bash
supabase functions deploy printer-control --no-verify-jwt --project-ref aphrrfprbixmhissnjfn
```

Check the proxy health from a machine with route access:

```bash
curl -sS "http://100.74.59.97:8914/health"
```

Check the printer control port from Alpuca:

```bash
ssh -F /dev/null -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes alpuca@100.74.59.97 \
  'nc -vz -w 3 192.168.1.106 8899'
```

## Troubleshooting

| Symptom | Likely Cause | Check |
| --- | --- | --- |
| Glowforge says `integration is disabled` | Missing `glowforge_config` row or `is_active=false` | `select id,is_active from glowforge_config;` |
| Glowforge says `User not found` after re-auth | Supabase Edge-created session rejected by Glowforge | Seed a local verified session; do not rotate credentials blindly |
| Glowforge frontend shows `0 machine(s)` in test mode | Function returning legacy test shape | Ensure response includes `count: 0, machines: []` |
| FlashForge status unavailable | Proxy unreachable or Tailscale route broken | Check `printer_config.proxy_url`, Caddy, Tailscale, and proxy health on Alpuca port 8914 |
| FlashForge command ignored | Control not acquired or printer busy | Confirm proxy wraps command with `M601 S1` / `M602` |
| FlashForge ports refuse connections | Printer LAN mode/API disabled or IP changed | On printer touchscreen, enable LAN mode/control, confirm IP/checkCode, then test `8899`, `8898`, and camera `8080` from Alpuca |
