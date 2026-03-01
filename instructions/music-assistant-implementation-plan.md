# Music Assistant Implementation Plan — Detailed

**Objective:** Replace the current Sonos-only control path with Music Assistant (MA) as the core controller for Sonos devices, using Hostinger VPS as the proxy and Alpaca Mac for MA + Sonos.

**Context:** See [docs/MUSIC-ASSISTANT-EVALUATION.md](../docs/MUSIC-ASSISTANT-EVALUATION.md) for architecture, tradeoffs, and risks.

**Out of scope (this plan):** Retiring the DO droplet for other workers (Bug Scout, Tesla poller, etc.); that is a separate migration. This plan covers only the **music path**: Sonos proxy + (later) MA proxy on Hostinger, MA server on Alpaca Mac.

---

## Prerequisites

- [ ] Alpaca Mac: on Tailscale, subnet route `192.168.1.0/24` advertised and approved.
- [ ] Hostinger VPS: SSH access (`root@93.188.164.224`), Caddy already serving `alpaclaw.cloud`.
- [ ] Supabase: ability to set secrets (`SONOS_PROXY_URL`, `SONOS_PROXY_SECRET`; later `MUSIC_ASSISTANT_TOKEN`).
- [ ] Tailnet admin: ability to add Hostinger to the same Tailnet and approve routes.

---

## Phase 1: Hostinger as Sonos Proxy (Move Off DO for Music)

**Goal:** Run the Sonos proxy on Hostinger so the edge function and clients use Hostinger instead of the DO droplet for Sonos. No MA yet; this unblocks DO retirement for the music path and validates Hostinger ↔ Alpaca Mac connectivity.

### 1.1 Install Tailscale on Hostinger VPS

- [ ] SSH to Hostinger: `ssh root@93.188.164.224` (use password auth if key auth is broken; see CLAUDE.local.md).
- [ ] Install Tailscale:
  ```bash
  curl -fsSL https://tailscale.com/install.sh | sh
  tailscale up --accept-routes
  ```
- [ ] Authenticate (one-time): follow the URL printed by `tailscale up` to add the machine to your Tailnet.
- [ ] Confirm Tailnet admin has approved the subnet route from Alpaca Mac (`192.168.1.0/24`) so that Hostinger can accept routes.
- [ ] On Hostinger, verify reachability to Alpaca Mac:
  ```bash
  tailscale status   # note Alpaca Mac hostname and Tailscale IP
  ping -c 2 <alpaca-mac-tailscale-ip>
  curl -s -o /dev/null -w '%{http_code}' http://<alpaca-mac-tailscale-ip>:5005/zones
  ```
  The last command should return `200` and the Sonos zones JSON (or a short response). If not, fix Tailscale routes/firewall before continuing.

### 1.2 Add Sonos proxy on Hostinger (Caddy)

- [ ] Decide Sonos proxy URL. Options:
  - **A:** `https://alpaclaw.cloud/sonos` (same host as OpenClaw; add a `handle /sonos/*` block).
  - **B:** New subdomain, e.g. `music.alpacaplayhouse.com` or `sonos.alpacaplayhouse.com` (requires DNS + Caddy block).
- [ ] Get `SONOS_PROXY_SECRET` value (same secret as used on DO today; stored in HOMEAUTOMATION.local.md or Supabase secrets).
- [ ] On Hostinger, edit Caddyfile (location per Hostinger setup, e.g. `/etc/caddy/Caddyfile`):
  - Add a `handle` that matches the chosen path (e.g. `/sonos/*` or `music.alpacaplayhouse.com`).
  - Reverse-proxy to `http://<alpaca-mac-tailscale-ip>:5005`, stripping path prefix if needed (e.g. `/sonos` → `` so that `/sonos/zones` becomes `http://<alpaca-mac-tailscale-ip>:5005/zones`).
  - Add request header validation: require `X-Sonos-Secret: <SONOS_PROXY_SECRET>` (and return 403 if missing), so the proxy is not open to the internet.
- [ ] Reload Caddy: `caddy reload --config /etc/caddy/Caddyfile` (or equivalent).
- [ ] From your laptop, test (replace URL and secret):
  ```bash
  curl -s -H "X-Sonos-Secret: YOUR_SECRET" "https://alpaclaw.cloud/sonos/zones" | head -c 500
  ```
  Expect JSON array of zone groups.

### 1.3 Point Supabase and edge function at Hostinger

- [ ] Set Supabase secrets (replace with actual Hostinger Sonos proxy URL and same secret as before):
  ```bash
  supabase secrets set SONOS_PROXY_URL="https://alpaclaw.cloud/sonos" SONOS_PROXY_SECRET="..."
  ```
- [ ] No code change in `supabase/functions/sonos-control/index.ts` required; it already uses `SONOS_PROXY_URL` and `SONOS_PROXY_SECRET`.
- [ ] Smoke test: from resident Sonos page, load zones and trigger play/pause in one room. Confirm requests succeed (check Supabase function logs if needed).
- [ ] **Checklist:** Sonos page works with Hostinger as proxy; DO droplet no longer needed for Sonos traffic. Document the Hostinger Sonos proxy URL and Caddy snippet in HOMEAUTOMATION.md (or a small “Hostinger proxy” section).

### 1.4 (Optional) Move Sonos cron to Hostinger

- [ ] If Sonos schedules (e.g. morning playlist, pause-all at midnight) currently run as cron on the DO droplet, replicate them on Hostinger:
  - Add cron entries that `curl` the **Hostinger** Sonos proxy URL (or Alpaca Mac Tailscale IP:5005 directly with the same secret) with the same paths as today.
  - Use the same `X-Sonos-Secret` header. Store secret in a file or env on Hostinger (e.g. `/etc/cron.d/sonos` or a small script that sources a secret file).

**Phase 1 exit criteria:** Resident Sonos page and PAI music controls work via Hostinger proxy; Sonos cron (if any) runs on Hostinger. DO can be retired for the music path.

---

## Phase 2: Music Assistant on Alpaca Mac (PoC)

**Goal:** Run Music Assistant in Docker on Alpaca Mac; discover Sonos zones; obtain API token; verify play/pause/volume and (if possible) “play Spotify URI” from a machine that can reach Alpaca Mac (Hostinger or DO).

### 2.1 Install Docker on Alpaca Mac (if not already)

- [ ] On Alpaca Mac, confirm Docker is installed: `docker --version`. If not, install Docker Desktop for Mac or Colima/docker CLI and start the daemon.
- [ ] Ensure Docker runs at login (or via LaunchAgent) so MA survives reboot.

### 2.2 Run Music Assistant server in Docker

- [ ] Follow [Music Assistant installation](https://music-assistant.io/installation/) (Docker). Example (adjust image tag to a fixed version, e.g. `latest` or `2.0.0`):
  ```bash
  docker run -d \
    --name music-assistant \
    --restart unless-stopped \
    -p 8095:8095 \
    -v music-assistant-data:/data \
    ghcr.io/music-assistant/server:latest
  ```
- [ ] Open MA UI from a machine on the same network as Alpaca Mac (or from Alpaca Mac): `http://<alpaca-mac-ip>:8095` (or `http://localhost:8095` on the Mac). Complete first-run setup if prompted (create admin user, etc.).

### 2.3 Configure Sonos provider in MA

- [ ] In MA UI: Settings → Player providers → add **Sonos S1** (we have S1 devices). If you have S2 devices, add **Sonos** (S2) as well.
- [ ] Let MA discover players. Confirm all 12 zones appear with correct names (or the expected count).
- [ ] Note any naming differences (MA player name vs our `room` names used in the app) for later mapping in the edge function.

### 2.4 Create API token and test from Hostinger

- [ ] In MA UI: Settings → create a long-lived API token (or use the token shown in the API docs / settings). Copy the token.
- [ ] Store it securely: Supabase secret `MUSIC_ASSISTANT_TOKEN` (for edge function later) and (for manual testing) on Hostinger in a file or env, e.g. `MA_TOKEN`.
- [ ] From Hostinger (over Tailscale), test MA API:
  ```bash
  curl -s -X POST http://<alpaca-mac-tailscale-ip>:8095/api \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_MA_TOKEN" \
    -d '{"message_id":"1","command":"players/all","args":{}}'
  ```
  Expect JSON list of players. If the command name differs (e.g. `config/players/get` or `players/list`), check MA’s api-docs at `http://<alpaca-mac-ip>:8095/api-docs`.
- [ ] Test play/pause and volume for one player (use `player_id` from the list). Commands are in the api-docs; typical pattern is a command like `players/command` or `player_queues/play` with `player_id` in args.
- [ ] (Optional) Add Spotify (or another provider) in MA and test “play Spotify URI on player” so we know MA can replace direct Spotify API in the edge function.

**Phase 2 exit criteria:** MA runs on Alpaca Mac; Sonos zones visible as MA players; API token works from Hostinger; at least one play/pause/volume and (if applicable) Spotify play verified.

---

## Phase 3: MA Proxy on Hostinger + Edge Function Adapter

**Goal:** Edge function can call MA via Hostinger proxy; implement action mapping (getZones → players list, play, pause, volume, etc.) and keep announce (and optionally EQ) on Sonos proxy.

### 3.1 API mapping (one-time doc)

- [ ] On a machine that can reach MA, open `http://<alpaca-mac-ip>:8095/api-docs` (Swagger).
- [ ] List the exact MA commands we need and their request/response shape. Suggested mapping (adjust to actual MA command names):

| Our action       | MA command (example)     | Notes |
|------------------|--------------------------|--------|
| getZones         | players/all or similar   | Map response to zone list with coordinatorName, members, state. |
| getState         | player state for one id  | By room name → player_id then get state. |
| play             | player play              | player_id from room name. |
| pause            | player pause             | |
| playpause        | toggle play/pause        | |
| next / previous  | queue next/previous      | |
| volume           | player volume            | value 0–100. |
| mute / unmute    | player mute              | |
| favorites        | music/favorites or similar | May differ from Sonos favorites; document. |
| playlists        | music/playlists          | |
| playlist / favorite (play) | queue play item by URI or name | |
| join / leave     | sync group add/remove    | MA grouping API. |

- [ ] Create a short mapping doc in the repo (e.g. `docs/music-assistant-api-mapping.md`) or in this instructions folder so the edge function implementer has a single reference. Include: command name, args, and how we derive `player_id` from our `room` (room name → MA player_id lookup).

### 3.2 Add MA proxy on Hostinger (Caddy)

- [ ] Add a Caddy `handle` that matches the MA proxy path (e.g. `https://alpaclaw.cloud/ma-api` or `https://music.alpacaplayhouse.com/api`).
- [ ] Reverse-proxy to `http://<alpaca-mac-tailscale-ip>:8095/api`. Forward the request body and `Content-Type`; add `Authorization: Bearer <MA_TOKEN>` from env (so the edge function does not send the token; Hostinger injects it). Alternatively, edge function sends the token and Hostinger just forwards (simpler; token in Supabase only).
- [ ] Restrict access: either (1) require a header (e.g. `X-MA-Secret`) that only the edge function knows, or (2) rely on Supabase edge function as the only caller (no public discovery of the URL). Prefer (2) if the URL is not guessable; otherwise (1).
- [ ] Test from your machine (with token in header if not injected by Caddy):
  ```bash
  curl -s -X POST "https://alpaclaw.cloud/ma-api" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_MA_TOKEN" \
    -d '{"message_id":"1","command":"players/all","args":{}}'
  ```

### 3.3 Edge function: MA client + routing

- [ ] **Option A (recommended):** Extend `supabase/functions/sonos-control/index.ts`:
  - Add env or Supabase secrets: `MUSIC_ASSISTANT_URL` (Hostinger MA proxy URL, e.g. `https://alpaclaw.cloud/ma-api`), `MUSIC_ASSISTANT_TOKEN` (Bearer token). If Hostinger injects the token, only `MUSIC_ASSISTANT_URL` is needed.
  - For each incoming `action`, decide route: **MA** for getZones, getState, play, pause, playpause, next, previous, volume, mute, unmute, favorites, playlists, playlist, favorite, join, leave; **Sonos proxy** for `announce`, and optionally `bass`, `treble`, `balance` if we keep them.
  - Implement a small “MA client” in the same file: `maRequest(command, args)` that POSTs to `MUSIC_ASSISTANT_URL` with `{ message_id, command, args }` and Bearer token (if not injected by proxy). Map our `room` (room name) to MA `player_id` using a cached players list or a helper that calls `players/all` and finds by name.
- [ ] **Option B:** New function `ma-control` that handles only MA actions; `sonos-control` keeps Sonos-only actions (announce, EQ). Then the client would call two endpoints depending on action. Option A is simpler for the client (single endpoint).
- [ ] Implement mapping for: getZones, getState, play, pause, playpause, next, previous, volume, mute, unmute. Return shapes should match what `sonos-data.js` and `sonos.js` expect (see current Sonos proxy responses). Add a thin response adapter if MA’s JSON shape differs.
- [ ] Deploy: `supabase functions deploy sonos-control --no-verify-jwt`.
- [ ] Test from resident Sonos page: zones load, play/pause/volume work. If something breaks, compare response shape with what the client expects and fix the adapter.

**Phase 3 exit criteria:** Resident Sonos page uses MA for zones and transport (play/pause/volume, etc.) via Hostinger MA proxy; announce (and optionally EQ) still go to Sonos proxy. No client code changes yet if we keep the same response contract.

---

## Phase 4: Client, Scenes, Spotify, Favorites/Playlists

**Goal:** Align client and DB with MA where needed; reimplement scene activation via MA; migrate Spotify search/play to MA; handle favorites/playlists.

### 4.1 Client and sonos-data.js

- [ ] Keep `shared/services/sonos-data.js` and `residents/sonos.js` API contract unchanged: same function names and parameters. The edge function already returns compatible shapes (Phase 3).
- [ ] If we introduced any response differences (e.g. zone list shape), update `sonos-data.js` to parse the MA-derived response so `loadZones()`, `loadPlaylists()`, `loadFavorites()` still return the same structures. Optionally add a debug flag or query param to force “Sonos only” path during rollout.
- [ ] No change to `residents/sonos.html` layout unless we add MA-specific UI (e.g. “Source: Music Assistant”). Optional: show a small “Powered by Music Assistant” or version in Settings.

### 4.2 Scenes (sonos_scenes + sonos_scene_actions)

- [ ] Scene activation today: `activateScene(scene, onProgress)` in `sonos-data.js` calls Sonos API (leave, join, volume, playlist/favorite, bass/treble). Replace the **playback and grouping** steps with MA API calls:
  - Resolve room names to MA `player_id`s (use cached players list or a small lookup).
  - **Ungroup:** MA “remove from sync group” or equivalent for each player.
  - **Group:** MA “create sync group” or “add to group” with the coordinator.
  - **Volume:** MA set volume per player.
  - **Play:** MA “play playlist/favorite/item” on the coordinator (or per independent room). Playlist/favorite may be by URI (MA library) or by name; document how we map `sonos_scene_actions.playlist_name` and `source_type` to MA.
  - **EQ (bass/treble):** If MA exposes them, use MA; else keep a fallback to Sonos proxy for those actions only (or skip EQ in scenes).
- [ ] Keep DB schema: `sonos_scenes`, `sonos_scene_actions` unchanged. Only the implementation of `activateScene` (and any helper it uses) changes.
- [ ] Test: create or use an existing scene; activate from UI; confirm grouping, volumes, and playback match expectations.

### 4.3 Spotify search and play

- [ ] In the edge function, for actions `spotify-search` and `spotify-play`:
  - **spotify-play:** Replace “call Spotify API then Sonos proxy with Spotify URI” by “call MA with `music/item_by_uri` (or play-by-URI command) and player_id”. MA handles Spotify and streams to Sonos.
  - **spotify-search:** Option A — keep using Spotify API in the edge function for search (no change). Option B — use MA search if MA exposes a search command that returns Spotify results. Prefer A for minimal change; play path is the important part.
- [ ] Remove or reduce Spotify token handling in the edge function if MA fully handles play (no need for client_credentials token for play). Keep token only if we still do Spotify search in the edge function.
- [ ] Test: from Sonos page, search Spotify and play a track; confirm it plays on the selected zone via MA.

### 4.4 Favorites and playlists (Sonos vs MA)

- [ ] **Favorites:** Sonos favorites are device-side; MA has its own favorites (library). Decide: (1) Show MA favorites in the UI and drop Sonos favorites, or (2) Keep loading Sonos favorites from Sonos proxy for display and “play favorite” via MA by name/URI. Document decision in mapping doc. Implement the chosen path in the edge function and, if needed, in `loadFavorites()` / `playItem(..., 'favorite', name)`.
- [ ] **Playlists:** Similarly, MA playlists vs Sonos playlists. Prefer MA playlists for “play playlist” so we have one source of truth. If we keep Sonos playlists for display, we need a way to map “play playlist X” to MA (e.g. by URI or by name in MA). Implement and test.

### 4.5 Playlist tags and schedules

- [ ] **sonos_playlist_tags:** No schema change. UI continues to load tags from Supabase and show “starred”; “play” sends the same action to the edge function (playlist or favorite by name/URI). Edge function already uses MA for play.
- [ ] **Schedules:** If cron on Hostinger triggers “play at 7am” etc., update cron to call the **Hostinger Sonos proxy** (for announce) or the **edge function** (if we expose a small “trigger play” endpoint) or MA proxy. Prefer: cron calls Hostinger Sonos proxy for Sonos-only actions (e.g. play favorite by name) or we add a minimal “schedule trigger” that the edge function accepts (e.g. with a cron secret) and then calls MA. Document in HOMEAUTOMATION.md.

**Phase 4 exit criteria:** Scenes run via MA; Spotify play goes through MA; favorites/playlists and playlist tags work; schedules (if any) run via Hostinger and MA or Sonos proxy as designed.

---

## Phase 5: PAI, Mobile, Cleanup, Docs

**Goal:** PAI and mobile use the same edge function; announce stays on Sonos; optional cleanup and documentation.

### 5.1 PAI tools

- [ ] `control_sonos` and `announce` in `supabase/functions/alpaca-pai/index.ts` already call `sonos-control`. No change to tool names or parameters. Implementation is in the edge function (MA vs Sonos routing). Verify: from PAI chat, “play music in Kitchen” and “announce to the house: dinner is ready” both work (first via MA, second via Sonos announce).

### 5.2 Mobile music tab

- [ ] `mobile/app/tabs/music-tab.js` uses `sonos-data.js`; no change needed. After Phase 3–4, mobile automatically uses MA for control. Test on device or emulator: zones, play/pause, volume, scenes.

### 5.3 Optional: node-sonos-http-api usage

- [ ] After MA handles normal control, we still need node-sonos-http-api (or direct Sonos) for **announce** (Gemini TTS → WAV → Sonos `announceurl`). Keep the Sonos proxy on Hostinger for that.
- [ ] If MA later supports “play URL on player” and we implement announce by pushing the WAV URL to MA, we can then consider retiring node-sonos-http-api. Not required for this plan.

### 5.4 Documentation updates

- [ ] **HOMEAUTOMATION.md:** Add section “Hostinger VPS — Sonos and Music Assistant proxy”. Document: Tailscale setup, Caddy routes for `/sonos` and `/ma-api`, env vars (SONOS_PROXY_SECRET, MA_TOKEN), and that Alpaca Mac runs node-sonos-http-api (port 5005) and Music Assistant (port 8095).
- [ ] **CLAUDE.md:** Under “Home Automation” or “Sonos”, note that Music Assistant is the core controller; Sonos proxy remains for announce (and optionally EQ). Point to this implementation plan and the evaluation doc.
- [ ] **PRODUCTDESIGN.md:** Add a short subsection “Music Assistant as Sonos controller” — decision, why (single control plane, future players), and that we use Hostinger as proxy and Alpaca Mac for MA + Sonos.

**Phase 5 exit criteria:** PAI and mobile verified; docs updated; announce path and (if kept) EQ path documented.

---

## Rollback

- **Phase 1:** If Hostinger Sonos proxy fails, point `SONOS_PROXY_URL` back to the DO droplet URL until fixed.
- **Phase 2–3:** If MA or the MA proxy causes issues, in the edge function route all actions back to the Sonos proxy (feature flag or env `USE_MA=false`). No client change.
- **Phase 4–5:** Scene runner and Spotify can keep a “use Sonos API” path if we pass a flag; otherwise revert the edge function and scene code to Sonos-only until MA is stable.

---

## Testing Checklist (before marking complete)

- [ ] Resident Sonos page: load zones, play/pause/next/prev, volume, mute, play playlist, play favorite, join/leave.
- [ ] Scenes: activate at least two different scenes; confirm grouping and playback.
- [ ] Spotify: search and play track/album/playlist on a zone.
- [ ] Announce: from PAI or Sonos page, trigger TTS announce to one room and to all; confirm audio.
- [ ] PAI: “play [song] in Kitchen”, “pause Living Room”, “announce: testing”.
- [ ] Mobile Music tab: zones, play/pause, volume, scenes (and favorites/playlists if in scope).
- [ ] Schedules: if applicable, trigger one scheduled action and confirm it runs via Hostinger.

---

## File and Config Reference

| Item | Location |
|------|----------|
| Evaluation | `docs/MUSIC-ASSISTANT-EVALUATION.md` |
| Edge function | `supabase/functions/sonos-control/index.ts` |
| Data layer | `shared/services/sonos-data.js` |
| Resident page | `residents/sonos.js`, `residents/sonos.html` |
| Mobile tab | `mobile/app/tabs/music-tab.js` |
| PAI tools | `supabase/functions/alpaca-pai/index.ts` (control_sonos, announce) |
| DB scenes | `sonos_scenes`, `sonos_scene_actions` |
| DB playlist tags | `sonos_playlist_tags` |
| Supabase secrets | `SONOS_PROXY_URL`, `SONOS_PROXY_SECRET`, `MUSIC_ASSISTANT_TOKEN` (optional if proxy injects) |
| Hostinger | Caddy: Sonos proxy path, MA proxy path; Tailscale; cron (if any) |
| Alpaca Mac | node-sonos-http-api :5005; Music Assistant Docker :8095 |

---

## Order of Operations Summary

1. **Phase 1:** Hostinger + Tailscale → Sonos proxy on Hostinger → Supabase secrets → test Sonos page. (Enables DO retirement for music.)
2. **Phase 2:** MA in Docker on Alpaca Mac → Sonos provider → API token → test from Hostinger.
3. **Phase 3:** MA proxy on Hostinger → edge function MA client + routing → deploy → test zones and transport.
4. **Phase 4:** Scenes via MA, Spotify play via MA, favorites/playlists and tags, schedules.
5. **Phase 5:** PAI/mobile verification, docs, optional cleanup.

Estimated effort: Phase 1 (1–2 hours), Phase 2 (1–2 hours), Phase 3 (2–4 hours), Phase 4 (2–4 hours), Phase 5 (1–2 hours). Total roughly one to two days of focused work, plus testing and doc updates.
