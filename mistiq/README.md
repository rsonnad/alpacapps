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
