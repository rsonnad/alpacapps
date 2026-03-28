# AlpacApps — Project Directives

> **On-demand docs — load when the task matches:**
> - `devdocs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
> - `devdocs/SCHEMA.md` — **load for:** writing queries, modifying tables, debugging data
> - `devdocs/PATTERNS.md` — **load for:** writing UI code, Tailwind styling, code review, testing
> - `devdocs/KEY-FILES.md` — **load for:** finding files, understanding project structure
> - `devdocs/DEPLOY.md` — **load for:** pushing, deploying, version questions
> - `devdocs/INTEGRATIONS.md` — **load for:** external APIs, vendor setup, pricing
> - `devdocs/CHANGELOG.md` — **load for:** understanding recent changes, migration context
> - `devdocs/CAD.md` — **load for:** 3D modeling, Blender, QGIS, CAD tool reference
> - `devdocs/CAD-SITE-PLANS.md` — **load for:** site plan workflows, GIS data sources, permit drawings
> - `devdocs/CAD-RENDER-PIPELINE.md` — **load for:** 3D property rendering, photorealistic render pipeline, on-site data collection tasks
> - `devdocs/HOMEAUTOMATION.md` — **load for:** smart home devices, Home Assistant setup, HAOS integrations, device management, automations
> - `devdocs/LIGHTINGAUTOMATION.md` — **load for:** controlling lights, changing light colors/brightness, light entities, WiZ/HAOS/Govee/Tuya light control
> - `devdocs/TESTING-GUIDE.md` — **load for:** test account credentials, auth testing, QA workflows, admin page testing
> - `devdocs/SECRETS-GUIDE.md` — **load for:** Bitwarden CLI, secrets management, bw-read helper, API key storage, credential access patterns
> - `devdocs/LOCAL-AI-SETUP.md` — **load for:** local AI models, Ollama, Atomic Chat, Qwen setup
> - `ARCHITECTURE.md` — **load for:** system architecture, component relationships, module boundaries, data flow
> - `API.md` — **load for:** REST endpoints, edge functions, API calls, request/response formats
> - `PRODUCTDESIGN.md` — **load for:** product decisions, UX philosophy, business model, feature prioritization
> - `devdocs/home-assistant-lighting-design.md` — **load for:** HAOS lighting architecture, entity naming, automation templates, migration status

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. On significant decisions: update `PRODUCTDESIGN.md` with **Decision** and **Why**
3. Push immediately — GitHub Pages deploys on push to main. See `devdocs/DEPLOY.md`
4. CI bumps version — never bump locally
5. Exclude `/mistiq/` from all AlpacApps work

## Code Guards

- `media_spaces` not `photo_spaces` — legacy migrated
- Filter: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer views — assignment dates only
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind: use `aap-*` tokens (see `devdocs/PATTERNS.md` for full list). Run `npm run css:build` after new classes.
- Claude CLI as subprocess, never Anthropic API. Edge functions use Gemini.
- **Infra hero banner:** `infra/index.html` and `docs/alpacappsinfra.html` use a full-width banner card hero (wide alpaca image on top, text below). Do NOT replace with dark full-bleed hero or side-by-side layout. Look for the `⚠️ HERO BANNER` comment.
- **Permitting Est. Cost link:** In `jackie/pages/permittingplan/index.html`, the Est. Cost value and Estimated Total value MUST link to `cost-estimate-breakdown.html`. Do NOT remove these links. Look for `⚠️ KEEP` comments.

## First-Time Setup

- Run `/plugin install typescript-lsp@claude-plugins-official` once (LSP env var is set via `.claude/settings.json`)

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Capacitor 8
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
