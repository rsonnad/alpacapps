# AlpacApps — Project Directives

> **On-demand docs (read when needed):**
> - `docs/KEY-FILES.md` — file index, edge function deploy flags
> - `docs/PATTERNS.md` — code patterns, sorting rules, testing
> - `docs/SCHEMA.md` — database tables + relationships
> - `docs/CREDENTIALS.md` — all credentials + DB access commands (gitignored)
> - `docs/INTEGRATIONS.md` — external services + API costs
> - `docs/CHANGELOG.md` — recent changes
> - `docs/DEPLOY.md` — deployment workflow, version format, live URLs

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
- Tailwind `aap-*` tokens: `bg-aap-cream`, `bg-aap-dark`, `text-aap-amber`, `shadow-aap`, `rounded-aap`
- Claude CLI as subprocess, never Anthropic API. Edge functions use Gemini.

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Capacitor 8
- **Live:** https://alpacaplayhouse.com/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
