# CLAUDE.md Templates

The setup wizard uses one of these templates based on the selected profile.
Replace all `{PLACEHOLDERS}` with actual values during setup.

---

## General AI Enablement Profile

Use this for projects that are NOT property management — SaaS apps, personal tools, booking systems, CRMs, portfolios, etc. Minimal context, no property-specific overhead.

```markdown
# {PROJECT_NAME} — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — SQL queries, deploying functions, API calls
> - `docs/SCHEMA.md` — writing queries, modifying tables, debugging data
> - `docs/PATTERNS.md` — writing UI code, Tailwind styling, testing
> - `docs/DEPLOY.md` — pushing, deploying, version questions

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. Push immediately — GitHub Pages deploys on push to main. See `docs/DEPLOY.md`
3. CI bumps version — never bump locally

## Code Guards

- Filter archived items: `.filter(s => !s.is_archived)` client-side
- `showToast()` not `alert()` in admin
- Tailwind: use project tokens (see `docs/PATTERNS.md`). Run `npm run css:build` after new classes.

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages
- **Live:** https://{USERNAME}.github.io/{REPO}/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
```

---

## Property Management Profile

Use this for projects that manage physical spaces, tenants, bookings, devices, events, etc. Full context with all doc references and code guards.

```markdown
# {PROJECT_NAME} — Project Directives

> **On-demand docs — load when the task matches:**
> - `docs/CREDENTIALS.md` — SQL queries, deploying functions, SSH, API calls
> - `docs/SCHEMA.md` — writing queries, modifying tables, debugging data
> - `docs/PATTERNS.md` — writing UI code, Tailwind styling, code review, testing
> - `docs/KEY-FILES.md` — finding files, understanding project structure
> - `docs/DEPLOY.md` — pushing, deploying, version questions
> - `docs/INTEGRATIONS.md` — external APIs, vendor setup, pricing
> - `docs/CHANGELOG.md` — understanding recent changes, migration context

## Mandatory Behaviors

1. After code changes: end response with `vYYMMDD.NN H:MMa [model]` + affected URLs (read `version.json`)
2. On significant decisions: update `PRODUCTDESIGN.md` with **Decision** and **Why**
3. Push immediately — GitHub Pages deploys on push to main. See `docs/DEPLOY.md`
4. CI bumps version — never bump locally

## Code Guards

- `media_spaces` not `photo_spaces` — legacy migrated
- Filter archived items: `.filter(s => !s.is_archived)` client-side
- No personal info in consumer views — assignment dates only
- `showToast()` not `alert()` in admin
- `openLightbox(url)` for images
- Tailwind: use project tokens (see `docs/PATTERNS.md`). Run `npm run css:build` after new classes.
- Claude CLI as subprocess, never Anthropic API. Edge functions use Gemini.

## Quick Refs

- **Tech:** Vanilla HTML/JS + Tailwind v4 | Supabase | GitHub Pages | Capacitor 8
- **Live:** https://{USERNAME}.github.io/{REPO}/
- **Architecture:** Browser → GitHub Pages → Supabase (no server-side code)
```

---

## CLAUDE.local.md Template (both profiles)

Always gitignored. Created during setup.

```markdown
# Operator Directives

> **DB access:** Read `docs/CREDENTIALS.md`. Use Supabase Management API (never psql).
> **Push:** Always push immediately. Never bump version locally — CI handles it.
> **After push:** Wait ~60s, `git pull --rebase origin main`, read `version.json`.
> **Links:** Always include clickable URLs to affected pages after every push.
> **SQL:** Run migrations directly via Management API — never ask user to run SQL manually.

## Live URLs

- https://{USERNAME}.github.io/{REPO}/ (GitHub Pages)
- https://github.com/{USERNAME}/{REPO} (repo)
```
