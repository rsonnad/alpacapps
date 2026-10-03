# Mistiq Staffing

**This is a separate project.** It is NOT part of the AlpacApps/GenAlpaca property management system.

Mistiq is an international staffing/recruitment site with its own branding, fonts, styles, and multilingual pages. It lives in this repo for convenience (shared GitHub Pages hosting) but is completely independent.

## Do Not

- Include Mistiq code in shared components (`/shared/`)
- Reference Mistiq in reusable setup templates or skills
- Apply AlpacApps font/style changes to Mistiq (it has its own brand: Cormorant Garamond + Lato)
- Include Mistiq in any packaged/shareable version of this codebase

## Structure

- `index.html` + `styles.css` — Main English site
- `apply/` — Application form
- `jobs/` — Job listings
- `de/`, `es/`, `ja/`, `pl/`, `ru/`, `th/`, `zh/` — Localized versions

## Language auto-selection (jobs pages)

`lang-redirect.js` is loaded synchronously in `<head>` of all eight `/mistiq/{xx/}jobs/` pages.

**Only `/mistiq/jobs/` (English) ever redirects.** A localized URL is treated as an explicit choice (e.g. a Thai link shared on LINE) and is never overridden.

Decision order on `/mistiq/jobs/`:

| # | Signal | Result |
|---|--------|--------|
| 1 | `?lang=xx` query param | go to `xx`, remember it (`?lang=en` forces English — use for testing / US-targeted links) |
| 2 | Remembered pick (`localStorage['mistiq-lang']`, set when any flag is clicked) | go there |
| 3 | First supported language in `navigator.languages`, if not English | go there (ja → `/ja/jobs/`, de → `/de/jobs/`…) |
| 4 | Device time zone matches `Asia/*` | Thai |
| 5 | none | stay on English |

English browser language deliberately falls through to step 4 — many Thai phones run an English UI.

**Decision:** infer country from the device time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), not IP geolocation.
**Why:** GitHub Pages has no server to read a geo header; an IP-lookup API would add a network round-trip before render (visible English→Thai flash), a third-party dependency with rate limits, a privacy disclosure, and is wrong for VPN users. The time zone is synchronous and free. Trade-off: a traveler whose phone is still on home time is classified by home, which for a recruiting page is arguably the right answer.

**Known coarse edge:** `Asia/*` includes India, the Gulf, Israel, Central Asia and Korea, who all get Thai unless their browser language is one we support. Narrow `ASIA_TZ` in `lang-redirect.js` if that matters.

Other details:
- Redirect uses `location.replace` (no back-button loop) and preserves query string (UTM) and hash.
- Crawlers are not redirected; every jobs page carries `hreflang` alternates + `x-default` so search engines index each language directly. Keep the `hreflang` list in sync with `SUPPORTED`.
- The redirect would otherwise make `document.referrer` our own URL, so the original referrer is passed via `sessionStorage` → `window.mistiqReferrer`; the `jobs_en` / `jobs_th` pageview tracking reads that first. The English page's pageview is never sent on a redirect (script runs before the tracking code).
- All storage access is wrapped in try/catch; with storage blocked, steps 1/3/4 still work, only "remember my pick" is lost.

Adding a language: create `xx/jobs/index.html`, add `xx` to `SUPPORTED`, add an `hreflang` line to all jobs pages, add the flag to every picker.
