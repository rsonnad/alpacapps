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

## First-Time Setup

1. `npm install -g typescript-language-server typescript`
2. Run `/plugin install typescript-lsp@claude-plugins-official` in Claude Code (LSP env var is set via `.claude/settings.json`)

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Capacitor 8
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
