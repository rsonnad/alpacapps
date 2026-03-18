# AlpacApps — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — **load for:** SQL queries, deploying functions, SSH, API calls
> - `docs/SCHEMA.md` — **load for:** writing queries, modifying tables, debugging data
> - `docs/PATTERNS.md` — **load for:** writing UI code, Tailwind styling, code review, testing
> - `docs/KEY-FILES.md` — **load for:** finding files, understanding project structure
> - `docs/DEPLOY.md` — **load for:** pushing, deploying, version questions
> - `docs/INTEGRATIONS.md` — **load for:** external APIs, vendor setup, pricing
> - `docs/CHANGELOG.md` — **load for:** understanding recent changes, migration context

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. On significant decisions: update `PRODUCTDESIGN.md` with **Decision** and **Why**
3. Push immediately — GitHub Pages deploys on push to main. See `docs/DEPLOY.md`
4. CI bumps version — never bump locally
5. Exclude `/mistiq/` from all AlpacApps work

## Code Guards

- `media_spaces` not `photo_spaces` — legacy migrated
- Filter: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer views — assignment dates only
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind: use `aap-*` tokens (see `docs/PATTERNS.md` for full list). Run `npm run css:build` after new classes.
- Claude CLI as subprocess, never Anthropic API. Edge functions use Gemini.
- **Infra hero banner:** `infra/index.html` and `docs/alpacappsinfra.html` use a full-width banner card hero (wide alpaca image on top, text below). Do NOT replace with dark full-bleed hero or side-by-side layout. Look for the `⚠️ HERO BANNER` comment.
- **Permitting Est. Cost link:** In `jackie/pages/permittingplan/index.html`, the Est. Cost value and Estimated Total value MUST link to `cost-estimate-breakdown.html`. Do NOT remove these links. Look for `⚠️ KEEP` comments.

## First-Time Setup

- Run `/plugin install typescript-lsp@claude-plugins-official` once (LSP env var is set via `.claude/settings.json`)

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Capacitor 8
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
