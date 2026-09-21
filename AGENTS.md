# AlpacApps — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
> - `spaces/admin/devcontrol/devdocs/SCHEMA.md` — **load for:** writing queries, modifying tables, debugging data
> - `spaces/admin/devcontrol/devdocs/PATTERNS.md` — **load for:** writing UI code, Tailwind styling, code review, testing
> - `spaces/admin/devcontrol/devdocs/KEY-FILES.md` — **load for:** finding files, understanding project structure
> - `spaces/admin/devcontrol/devdocs/DEPLOY.md` — **load for:** pushing, deploying, version questions
> - `spaces/admin/devcontrol/devdocs/INTEGRATIONS.md` — **load for:** external APIs, vendor setup, pricing
> - `spaces/admin/devcontrol/devdocs/CHANGELOG.md` — **load for:** understanding recent changes, migration context
> - `spaces/admin/devcontrol/devdocs/CAD.md` — **load for:** 3D modeling, Blender, QGIS, CAD tool reference
> - `spaces/admin/devcontrol/devdocs/CAD-SITE-PLANS.md` — **load for:** site plan workflows, GIS data sources, permit drawings
> - `spaces/admin/devcontrol/devdocs/CAD-RENDER-PIPELINE.md` — **load for:** 3D property rendering, photorealistic render pipeline, on-site data collection tasks
> - `spaces/admin/devcontrol/devdocs/HOMEAUTOMATION.md` — **load for:** smart home devices, Home Assistant setup, HAOS integrations, device management, automations
> - `spaces/admin/devcontrol/devdocs/LIGHTINGAUTOMATION.md` — **load for:** controlling lights, changing light colors/brightness, light entities, WiZ/HAOS/Govee/Tuya light control
> - `devcontrol/devdocs/MAKERDEVICES.md` — **load for:** Glowforge laser cutter, FlashForge 3D printer, Maker Tools, 3D Printing, maker device proxy/session troubleshooting
> - `spaces/admin/devcontrol/devdocs/TESTING-GUIDE.md` — **load for:** test account credentials, auth testing, QA workflows, admin page testing
> - `spaces/admin/devcontrol/devdocs/SECRETS-GUIDE.md` — **load for:** Bitwarden CLI, secrets management, bw-read helper, API key storage, credential access patterns
> - `devcontrol/devdocs/LOCAL-AI-SETUP.md` — **load for:** local AI models, Ollama, msty, Qwen 3 / DeepSeek R1 / VL setup, PortoSams2T model storage
> - `spaces/admin/devcontrol/devdocs/clawlikeagents.md` — **load for:** AI agents overview, AlpaClaw, PAI, Hermes, model routing, adding new agents
> - `spaces/admin/devcontrol/devdocs/spotifyapi.md` — **load for:** Spotify API, playlist creation, OAuth flow, token refresh, Dev Mode limitations
> - `ARCHITECTURE.md` — **load for:** system architecture, component relationships, module boundaries, data flow
> - `API.md` — **load for:** REST endpoints, edge functions, API calls, request/response formats
> - `PRODUCTDESIGN.md` — **load for:** product decisions, UX philosophy, business model, feature prioritization
> - `spaces/admin/devcontrol/devdocs/home-assistant-lighting-design.md` — **load for:** HAOS lighting architecture, entity naming, automation templates, migration status
> - `spaces/admin/devcontrol/devdocs/REMOTE-ACCESS.md` — **load for:** SSH tunneling, remote access to Alpuca/UDM Pro, Tailscale, Cloudflare tunnel, port forwarding
> - `devcontrol/devdocs/ALPUCA-MACHINE.md` — **load for:** Alpuca Mac hardware/OS, background services, moondream-indexer memory hazard + takedown, runaway-process diagnostics, tripwire setup. Canonical home — finleg and other repos link here.

## Person Lookup Routing

When the user names a person (e.g. "is X working?", "what's X's schedule?", "what did X do yesterday?"):

1. **Resolve identity in BOTH IDs** — they are different UUIDs:
   - `people.id` = `app_users.id` — the person/auth identity
   - `associate_profiles.id` — what every work table FKs to

   ```sql
   SELECT u.id AS person_id, ap.id AS associate_profile_id, u.display_name
   FROM app_users u
   LEFT JOIN associate_profiles ap ON ap.app_user_id = u.id
   WHERE u.email ILIKE '...' OR u.display_name ILIKE '...';
   ```

2. **For ANY work data, use `associate_profiles.id` — NEVER `people.id`:**
   - `time_entries.associate_id` → `associate_profiles.id`
   - `associate_schedules.associate_id` → `associate_profiles.id`
   - `work_photos.associate_id` → `associate_profiles.id`
   - `schedule_edits.associate_id` → `associate_profiles.id`
   - `payouts.associate_id` → `associate_profiles.id`

3. **Common queries:**
   - "Working now?" → `time_entries WHERE associate_id=<profile_id> AND clock_out IS NULL`
   - "This week's schedule?" → `associate_schedules WHERE associate_id=<profile_id> AND schedule_date BETWEEN <mon> AND <sun>`
   - "Yesterday's photos?" → `work_photos WHERE associate_id=<profile_id> AND work_date=<date>`

4. **If a result is unexpectedly empty for an active associate, suspect wrong-ID first** before reporting "no records".

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. On significant decisions: update `PRODUCTDESIGN.md` with **Decision** and **Why**
3. Push immediately — GitHub Pages deploys on push to main. See `spaces/admin/devcontrol/devdocs/DEPLOY.md`
4. CI bumps version — never bump locally
5. Exclude `/mistiq/` from all AlpacApps work

## TTRAN Task Routing

- When the user says `ttran AA##` or names a ttran task, look first in `/Volumes/PortoSams2T/ttran/` for matching files before searching the repo.
- Example: `ttran AA10` resolves to `/Volumes/PortoSams2T/ttran/AA10 glowforge-fix-plan.md`.

## Code Guards

- `media_spaces` not `photo_spaces` — legacy migrated
- Filter: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer views — assignment dates only
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind: use `aap-*` tokens (see `spaces/admin/devcontrol/devdocs/PATTERNS.md` for full list). Run `npm run css:build` after new classes.
- Codex CLI as subprocess, never Anthropic API. Edge functions use Gemini.
- **Infra hero banner:** `infra/index.html` and `docs/alpacappsinfra.html` use a full-width banner card hero (wide alpaca image on top, text below). Do NOT replace with dark full-bleed hero or side-by-side layout. Look for the `⚠️ HERO BANNER` comment.
- **Permitting Est. Cost link:** In `spaces/admin/permittingplan.html`, the Est. Cost value and Estimated Total value MUST link to `cost-estimate-breakdown.html`. Do NOT remove these links. Look for `⚠️ KEEP` comments.

## Device Control Protocol

> **Load `spaces/admin/devcontrol/devdocs/LIGHTINGAUTOMATION.md`** for light entity IDs, HAOS commands, and `lights.sh` CLI.
> For non-light devices: query `device_control_recipes` or browse `devices_unified` VIEW.
> Directory: https://alpacaplayhouse.com/directory/devices.html

## Service Connection Protocol

Before connecting to ANY external service (SSH, API, R2, Supabase, etc.):

1. **Check `memory/service-access.md`** for a verified copy-paste recipe — use it exactly
2. **If no recipe:** check `docs/CREDENTIALS.md` for credential references
3. **Build command** using `bw-read "ExactItemName" "ExactFieldName"` — never guess item names
4. **If `bw-read` fails:** run `bw list items --search "keyword"` to find the correct item name, then update docs
5. **After first success with a new service:** add the working recipe to `memory/service-access.md`
6. **After session with connection failures:** run `/connectivity-audit` to update docs

**NEVER:** guess Bitwarden field names, try multiple auth methods without diagnosing, use hardcoded credentials, or skip documenting a newly-discovered connection recipe.

## First-Time Setup

- Run `/plugin install typescript-lsp@Codex-plugins-official` once (LSP env var is set via `.Codex/settings.json`)

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Native mobile (Kotlin + Swift)
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool FIRST.
Skills are listed in the system reminder — match by keyword (e.g., bugs → investigate, ship → ship, QA → qa, review → review).
