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
| 4 | Device time zone is `Asia/Bangkok` (Thailand) | Thai |
| 5 | none | stay on English |

English browser language deliberately falls through to step 4 — many Thai phones run an English UI.

**Decision:** infer country from the device time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), not IP geolocation.
**Why:** GitHub Pages has no server to read a geo header; an IP-lookup API would add a network round-trip before render (visible English→Thai flash), a third-party dependency with rate limits, a privacy disclosure, and is wrong for VPN users. The time zone is synchronous and free. Trade-off: a traveler whose phone is still on home time is classified by home, which for a recruiting page is arguably the right answer.

**Decision (2026-10-03):** Thailand only, not all of Asia. **Why:** `Asia/*` also covers India, the Gulf, Israel, Korea, etc., none of whom read Thai. Visitors elsewhere in Asia still get their own language via step 3 when we have it (ja, zh), otherwise English. To add a country, add its zone ID(s) to `THAI_TZ` in `lang-redirect.js`.

Other details:
- Redirect uses `location.replace` (no back-button loop) and preserves query string (UTM) and hash.
- Crawlers are not redirected; every jobs page carries `hreflang` alternates + `x-default` so search engines index each language directly. Keep the `hreflang` list in sync with `SUPPORTED`.
- The redirect would otherwise make `document.referrer` our own URL, so the original referrer is passed via `sessionStorage` → `window.mistiqReferrer`; the `jobs_en` / `jobs_th` pageview tracking reads that first. The English page's pageview is never sent on a redirect (script runs before the tracking code).
- All storage access is wrapped in try/catch; with storage blocked, steps 1/3/4 still work, only "remember my pick" is lost.

Adding a language: create `xx/jobs/index.html`, add `xx` to `SUPPORTED`, add an `hreflang` line to all jobs pages, add the flag to every picker.

## Mobile layout guardrails

- **Fixed overlays are capped at `max-width: 100vw`** (`.mistiq-header`, `.mistiq-mobile-nav`). If anything on a page overflows horizontally, mobile Chrome widens the layout viewport and a `left:0; right:0` fixed element stretches with it. That once pushed the language picker and hamburger off-screen on a Pixel 10 (412px). `100vw` stays pinned to the screen width.
- **Never give an image a bare `max-width: <px>`.** It overrides the global `img { max-width: 100% }`. Use `max-width: min(<px>, 100%)`. The 2026-10 overflow came from `.mistiq-facility__image { max-width: 600px }`.
- **To check for overflow:** at 360px and 412px wide, `document.documentElement.scrollWidth` must equal `clientWidth` *with real images loaded*. A test that blocks images will miss image-caused overflow.

## Assets

- `saunatubs.webp` (1200×805, ~125 KB) replaces the 8.3 MB `Saunatubs.png` in Supabase storage on every home and jobs page. The original is still in the `mistiq-assets` bucket if a higher-resolution source is ever needed.
