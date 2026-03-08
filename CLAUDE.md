# CLAUDE.md - AlpacApps Project Context

> **Credentials & SSH access:** See `CLAUDE.local.md` (gitignored, auto-loaded).
> **On-demand docs (read only when needed):**
> - `docs/KEY-FILES.md` — file index, edge function deploy flags
> - `docs/PATTERNS.md` — code patterns, sorting rules, testing checklist
> - `docs/SCHEMA.md` — database tables, columns, relationships
> - `docs/INTEGRATIONS.md` — API costs, vendor pricing, external systems
> - `docs/CHANGELOG.md` — recent changes and migration notes
> - `docs/CREDENTIALS.md` — all service credentials (gitignored)

## MANDATORY: End Every Response With Version + URLs

After ANY code change or deploy, the LAST lines MUST be:
```
vYYMMDD.NN H:MMa [model]
https://alpacaplayhouse.com/path/to/affected-page.html
```
Read version from `version.json`. List clickable URLs to every affected page.

## MANDATORY: Update PRODUCTDESIGN.md on Significant Decisions

When making decisions affecting WHY the product is built a certain way (new vendor, AI model choice, pricing change, feature tradeoffs, infrastructure patterns), add to `PRODUCTDESIGN.md` with **Decision** and **Why**. Skip for routine bug fixes.

## Excluded: `/mistiq/`

Separate project (Mistiq Staffing). Do NOT include in shared components or apply AlpacApps styles to it.

## Project Overview

Property management system for AlpacApps Residency. Manages rental spaces, tenants, bookings, payments, photos.

**Tech Stack:** Vanilla HTML/CSS/JS + Tailwind CSS v4 | Capacitor 8 (iOS/Android) | Supabase (Postgres + Storage + Auth + Edge Functions) | GitHub Pages | OpenClaw (Hostinger VPS)

## Architecture

```
Browser → GitHub Pages (static HTML/JS) ──→ Supabase
Discord/WhatsApp/Telegram → OpenClaw (Hostinger VPS) → Supabase
Mobile → Capacitor App ──→ Supabase
```
No server-side code — all logic runs client-side. Supabase handles persistence.

> **File index:** See [docs/KEY-FILES.md](docs/KEY-FILES.md) for shared modules, data services, mobile, admin, resident, edge functions, and deploy flags.

## Deployment

GitHub Pages from `main` branch. No build step — push to main and it's live.

**Version format:** `vYYMMDD.NN H:MMa` — date + daily counter + Austin time. CI bumps automatically via GitHub Action on every push.

```bash
git add -A && git commit -m "message"
./scripts/push-main.sh   # pull --rebase, then push
```

After push: wait ~60s for CI, `git pull --rebase origin main`, read `version.json`, report version.

**Post-push format (main):** "Deployed to main — ..." with test URLs.
**Post-push format (branch):** "Pushed to branch `name` (not yet deployed)" with changed files list.

**Live site:** https://alpacaplayhouse.com/
- Resident: https://alpacaplayhouse.com/residents/ (cameras, climate, lighting, sonos, laundry, cars)
- Admin: https://alpacaplayhouse.com/spaces/admin/manage.html
- Public: https://alpacaplayhouse.com/spaces/ | https://alpacaplayhouse.com/pay/

## Important Conventions

1. **Use `media_spaces` not `photo_spaces`** — legacy tables fully migrated
2. **Filter archived spaces** — `.filter(s => !s.is_archived)` client-side
3. **Don't expose personal info in consumer view** — assignment dates only
4. **Toast notifications in admin** — `showToast(message, type)` not `alert()`
5. **Lightbox for images** — `openLightbox(url)`
6. **Tailwind CSS for new UI** — use `aap-*` tokens: `bg-aap-cream`, `bg-aap-dark`, `text-aap-amber`, `shadow-aap`, `rounded-aap`. Run `npm run css:build` after adding new classes.
7. **Claude CLI, never Anthropic API** — servers use `claude` CLI as subprocess. Edge functions use Gemini. Zero direct Anthropic API calls.

## Supabase

- Anon key in `shared/supabase.js` (safe, RLS-protected)
- Storage: `housephotos` (media), `lease-documents` (PDFs)
- External: Cloudflare R2 bucket `alpacapps`

> **Code patterns, sorting rules, testing:** See [docs/PATTERNS.md](docs/PATTERNS.md)
