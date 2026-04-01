# AlpacApps — Project Directives

> **On-demand docs — load when the task matches:**
> - `spaces/admin/devcontrol/devdocs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
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
> - `spaces/admin/devcontrol/devdocs/TESTING-GUIDE.md` — **load for:** test account credentials, auth testing, QA workflows, admin page testing
> - `spaces/admin/devcontrol/devdocs/SECRETS-GUIDE.md` — **load for:** Bitwarden CLI, secrets management, bw-read helper, API key storage, credential access patterns
> - `spaces/admin/devcontrol/devdocs/LOCAL-AI-SETUP.md` — **load for:** local AI models, Ollama, Atomic Chat, Qwen setup
> - `ARCHITECTURE.md` — **load for:** system architecture, component relationships, module boundaries, data flow
> - `API.md` — **load for:** REST endpoints, edge functions, API calls, request/response formats
> - `PRODUCTDESIGN.md` — **load for:** product decisions, UX philosophy, business model, feature prioritization
> - `spaces/admin/devcontrol/devdocs/home-assistant-lighting-design.md` — **load for:** HAOS lighting architecture, entity naming, automation templates, migration status

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. On significant decisions: update `PRODUCTDESIGN.md` with **Decision** and **Why**
3. Push immediately — GitHub Pages deploys on push to main. See `spaces/admin/devcontrol/devdocs/DEPLOY.md`
4. CI bumps version — never bump locally
5. Exclude `/mistiq/` from all AlpacApps work

## Code Guards

- `media_spaces` not `photo_spaces` — legacy migrated
- Filter: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer views — assignment dates only
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind: use `aap-*` tokens (see `spaces/admin/devcontrol/devdocs/PATTERNS.md` for full list). Run `npm run css:build` after new classes.
- Claude CLI as subprocess, never Anthropic API. Edge functions use Gemini.
- **Infra hero banner:** `infra/index.html` and `docs/alpacappsinfra.html` use a full-width banner card hero (wide alpaca image on top, text below). Do NOT replace with dark full-bleed hero or side-by-side layout. Look for the `⚠️ HERO BANNER` comment.
- **Permitting Est. Cost link:** In `jackie/pages/permittingplan/index.html`, the Est. Cost value and Estimated Total value MUST link to `cost-estimate-breakdown.html`. Do NOT remove these links. Look for `⚠️ KEEP` comments.

## Device Control Protocol

To control ANY device (lights, thermostats, cameras, vehicles, appliances):

1. **For lights — use HAOS API directly (1 call).** Do NOT use `lights.alpacaplayhouse.com` (404 since 2026-03-31).
   ```bash
   ssh -o StrictHostKeyChecking=no paca@192.168.1.200 "curl -s -X POST 'http://192.168.1.39:8123/api/services/light/turn_off' \
     -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxN2FlNmMyNTdhYWY0NGMxODBjZmMxOWU3ZDBiZWExMiIsImlhdCI6MTc3NDE1NTUzNSwiZXhwIjoyMDg5NTE1NTM1fQ.MdIZq95i9pJBKuKxn_aeyrK1O55JbMhsgtnM7GcTkXQ' \
     -H 'Content-Type: application/json' \
     -d '{\"entity_id\":\"light.ENTITY\"}'"
   ```
   For turn_on with color: add `\"rgb_color\":[R,G,B],\"brightness\":0-255` to the JSON body.

2. **Light entity quick-reference (use these exact entity IDs):**
   | User says | HAOS entity_id |
   |-----------|---------------|
   | garage / garage mahal | `light.garage_all` |
   | garage ceiling | `light.garage_ceiling` |
   | garage dj | `light.garage_dj` |
   | outhouse | `light.outhouse_all` |
   | outhouse ceiling | `light.outhouse_ceiling` |
   | outhouse stalls | `light.outhouse_stalls` |
   | outhouse porch | `light.outhouse_porch_lights` |
   | skyloft | `light.skyloft_lights` |
   | skyloft ceiling | `light.skyloft_ceiling` |
   | skyloft bathroom | `light.skyloft_bathroom` |
   | living room | `light.living_room_lights` |
   | kitchen | `light.kitchen_lights` |
   | dining room | `light.dining_room_lights` |
   | master bathroom | `light.master_bathroom_lights` |
   | stairs | `light.stairs_lights` |
   | spartan | `light.spartan_all` |
   | sauna | `light.sauna_lights` |
   | facade | `light.facade_lights` |
   | front fence | `light.front_fence_lights` |
   | back patio string | `light.back_patio_string_lite` |
   | food fence | `light.food_fence_string` |
   | master pasture | `light.master_pasture_lights` |
   | nook / pequeno nook | `light.pequeno_nook_lights` |
   | cabins fence | `light.cabins_fence` |
   | balcony | `light.balcony_striplight` |

3. **Verify after:** `ssh paca@192.168.1.200 "curl -s 'http://192.168.1.39:8123/api/states/light.ENTITY' -H 'Authorization: Bearer TOKEN'" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])"`

4. **For non-light devices:** query `device_control_recipes`: `SELECT * FROM device_control_recipes WHERE device_name ILIKE '%keyword%' AND action = 'turn_on'`
5. **Browse all devices:** `devices_unified` VIEW unions all device tables into one queryable surface
6. **Directory page:** https://alpacaplayhouse.com/directory/devices.html

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

- Run `/plugin install typescript-lsp@claude-plugins-official` once (LSP env var is set via `.claude/settings.json`)

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Native mobile (Kotlin + Swift)
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
