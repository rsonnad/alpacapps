# CLAUDE.md - AlpacApps Project Context

This file provides context for Claude (AI assistant) when working on this codebase.

> **See `CLAUDE.local.md` for credentials, connection strings, and environment-specific configuration.**
> That file is gitignored and contains operator directives, database access details, API keys, and deployment-specific settings.

## MANDATORY: End Every Response With Version + URLs

**After ANY code change or deploy, the LAST lines of your response MUST be:**

```
vYYMMDD.NN H:MMa [model]
https://alpacaplayhouse.com/path/to/affected-page.html
```

- Read the version from `version.json` (after pulling the CI bump commit)
- List clickable URLs to every page affected by the change
- These lines go at the **very end** — nothing after them

## MANDATORY: Update PRODUCTDESIGN.md on Significant Decisions

**When you make a decision that affects WHY the product is built the way it is, update `PRODUCTDESIGN.md`.**

This includes (but is not limited to):
- Choosing a new vendor or service over alternatives
- Selecting an AI model for a new use case
- Changing the business model, pricing, or cost structure
- Designing a new user-facing feature with meaningful tradeoffs
- Changing environment or infrastructure configuration patterns
- Adding or removing a payment method, communication channel, or integration
- Making a deliberate tradeoff (e.g. simplicity over flexibility, cost over capability)

**How to update:** Add a new subsection under the relevant section (or create a new section) following the existing pattern: **Decision** (what was decided), **Why** (reasoning, alternatives considered, tradeoffs accepted). Keep entries concise — a few sentences per bullet, not paragraphs.

**When NOT to update:** Routine bug fixes, minor UI tweaks, or implementation details that don't reflect a product-level choice. If the change is purely technical (how) rather than strategic (why), it belongs in `ARCHITECTURE.md` or `CLAUDE.md` instead.

## Excluded: `/mistiq/`

The `/mistiq/` directory is a **separate, unrelated project** (Mistiq Staffing). It shares this repo for hosting convenience only. Do NOT:
- Include Mistiq in shared components, skills, or reusable templates
- Apply AlpacApps style/font changes to Mistiq (it has its own brand)
- Reference Mistiq when packaging or sharing this codebase with others

## Project Overview

AlpacApps is a property management system for AlpacApps Residency. It manages rental spaces, tenants, bookings, payments, and photos.

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (no framework) + Tailwind CSS v4
- CSS: CSS custom properties (`--aap-*`) + Tailwind utility classes (coexist)
- Mobile: Capacitor 8 (iOS + Android) wrapping mobile-first SPA
- Backend: Supabase (PostgreSQL + Storage + Auth + Edge Functions)
- Hosting: GitHub Pages (static site)
- Bot: OpenClaw chatbot gateway (Hostinger VPS, Docker)

## Architecture

```
Browser → GitHub Pages (static HTML/JS) ──→ Supabase (database + storage + edge functions)
                                          ↗
Discord/WhatsApp/Telegram → OpenClaw (Hostinger VPS) → Supabase
                                          ↗
Mobile  → Capacitor App (iOS/Android) ──┘
            (same shared/ code as web)
```

No server-side code - all logic runs client-side. Supabase handles data persistence.

## Key Files

### Shared Modules (`/shared/`)
- `supabase.js` - Supabase client singleton (anon key embedded)
- `auth.js` - Authentication module for admin access
- `admin-shell.js` - Admin page shell (auth, nav, role checks)
- `resident-shell.js` - Resident page shell (auth, tab nav, PAI widget injection)
- `media-service.js` - Media upload, compression, tagging service
- `rental-service.js` - Rental application workflow management
- `event-service.js` - Event hosting request workflow
- `lease-template-service.js` - Lease template parsing and placeholder substitution
- `event-template-service.js` - Event agreement template parsing
- `worktrade-template-service.js` - Work trade agreement template parsing
- `pdf-service.js` - PDF generation from markdown using jsPDF
- `signwell-service.js` - SignWell e-signature API integration
- `email-service.js` - Email sending via Resend
- `brand-config.js` - Brand configuration loader (colors, fonts, logos from DB)
- `config-loader.js` - Property configuration loader (name, domain, email, payment, timezone from DB)
- `feature-registry.js` - Feature registry (core vs optional modules, config-driven enable/disable)
- `sms-service.js` - SMS sending via Telnyx (mirrors email-service.js pattern)
- `square-service.js` - Square payment processing (client-side tokenization)
- `hours-service.js` - Associate hours tracking (clock in/out, time entries)
- `identity-service.js` - Identity verification (upload tokens, DL verification)
- `payout-service.js` - PayPal payouts for associate payments
- `accounting-service.js` - Accounting/ledger service (Zelle auto-recording, payment tracking)
- `voice-service.js` - Vapi voice assistant configuration
- `pai-widget.js` - PAI floating chat widget (injected on all resident pages via resident-shell.js)
- `chat-widget.js` - Chat widget component
- `error-logger.js` - Client-side error capture and reporting
- `site-components.js` - Shared site UI components
- `version-info.js` - Version badge click handler
- `timezone.js` - Timezone utilities (Austin/Chicago)

### Shared Data Services (`/shared/services/`)
- `poll-manager.js` - Reusable polling class with visibility-based pause/resume
- `camera-data.js` - Camera stream config from `camera_streams` table
- `sonos-data.js` - Sonos zone state + control via `sonos-control` edge function
- `lighting-data.js` - Govee device groups + control via `govee-control` edge function
- `climate-data.js` - Nest thermostat state + control via `nest-control` edge function
- `cars-data.js` - Tesla vehicle data + commands via `tesla-command` edge function
- `laundry-data.js` - LG washer/dryer state + control via `lg-control` edge function
- `oven-data.js` - Anova oven state + control via `anova-control` edge function
- `glowforge-data.js` - Glowforge laser cutter status via `glowforge-control` edge function
- `printer-data.js` - FlashForge 3D printer state + control via `printer-control` edge function

### Mobile App (`/mobile/`)
- `capacitor.config.ts` - App config (ID: `com.alpacaplayhouse.app`, plugins, platform settings)
- `scripts/copy-web.js` - Build script: copies web assets → www/, injects capacitor.js, patches redirects
- `app/index.html` - App shell (loading overlay, login overlay, tab sections, bottom nav bar)
- `app/mobile.css` - Dark theme stylesheet (all mobile CSS in one file)
- `app/mobile-app.js` - Orchestrator (auth, tab switching, lazy loading via dynamic import())
- `app/tabs/cameras-tab.js` - HLS camera feeds with quality switching, auto-reconnect
- `app/tabs/music-tab.js` - Sonos zones: play/pause, volume, scenes, favorites
- `app/tabs/lights-tab.js` - Govee groups: on/off, brightness, color presets
- `app/tabs/climate-tab.js` - Nest thermostats: temp +/-, mode, eco toggle
- `app/tabs/cars-tab.js` - Tesla vehicles: battery, lock/unlock, flash lights

### Payment Page (`/pay/`)
- `index.html` - Self-service payment page for tenants (Stripe PaymentElement + manual methods)
- URL params: `?amount=`, `?description=`, `?person_id=`, `?person_name=`, `?email=`, `?payment_type=`, `?reference_type=`, `?reference_id=`
- Shows Zelle/Venmo/PayPal (free, manual) + Stripe ACH/card (online, 0.8% fee capped at $5)
- Stripe PaymentElement mounts with PaymentIntent clientSecret from `process-stripe-payment`
- On success, Stripe webhook creates ledger entry + sends confirmation email with statement

### Consumer View (`/spaces/`)
- `app.js` - Public listing with real availability from assignments
- Shows only `is_listed=true AND is_secret=false` spaces
- Sorts: available first → highest price → name
- Loads assignment dates (no personal info) for availability display

### Admin View (`/spaces/admin/`)
- `app.js` - Full admin dashboard with all spaces
- `manage.html` - Management tabs (Spaces, Rentals, Media, Users, Settings)
- `media.js` - Media library with tagging and filtering
- `rentals.html` / `rentals.js` - Rental application pipeline (Kanban)
- `events.html` / `events.js` - Event hosting request pipeline
- `accounting.html` / `accounting.js` - Accounting/ledger dashboard
- `voice.html` / `voice.js` - Voice assistant config + call logs
- `faq.html` / `faq.js` - FAQ/AI configuration page
- `worktracking.html` / `worktracking.js` - Admin hours management for associates
- `sms-messages.html` / `sms-messages.js` - SMS conversation viewer
- `templates.html` / `templates.js` - Lease/event template editor
- `brand.html` / `brand.js` - Brand style guide (colors, logos, typography, email preview)
- `settings.html` / `settings.js` - System settings (SignWell, Telnyx, fees, etc.)
- `users.html` / `users.js` - User management + invitations
- Shows occupant info, visibility controls, edit capabilities

### Resident View (`/residents/`)
- `climate.html` / `thermostat.js` - Climate page: Nest thermostats + 48-hour weather forecast
- `lighting.html` / `lighting.js` - Govee lighting control
- `sonos.html` / `sonos.js` - Sonos music control
- `cameras.html` / `cameras.js` - Camera feeds + two-way talkback audio
- `laundry.html` / `laundry.js` - LG washer/dryer monitoring
- `cars.html` / `cars.js` - Vehicle info + Tesla commands
- `profile.html` / `profile.js` - User profile (avatar, bio, social, privacy settings)
- `sensorinstallation.html` - UP-SENSE smart sensor installation guide
- `residents.css` - Shared CSS for all resident pages

### Associate View (`/associates/`)
- `worktracking.html` / `worktracking.js` - Clock in/out, timesheets, work photos, payment preferences

### PAI Discord Bot (`/pai-discord/`)
- `bot.js` - Discord → alpaca-pai edge function bridge (discord.js v14)
- `pai-discord.service` - Systemd service file for DO droplet
- `install.sh` - Droplet installation script

### Supabase Edge Functions (`/supabase/functions/`)
- `signwell-webhook/` - Receives SignWell webhook when documents are signed
- `send-sms/` - Outbound SMS via Telnyx API
- `telnyx-webhook/` - Receives inbound SMS from Telnyx
- `send-email/` - Outbound email via Resend API (45+ templates, branded wrapper)
- `_shared/email-brand-wrapper.ts` - Branded email shell (header/footer/buttons from brand_config)
- `resend-inbound-webhook/` - Receives inbound email via Resend webhook, routes/forwards, auto-records Zelle payments
- `govee-control/` - Proxies requests to Govee Cloud API (resident+ auth)
- `alpaca-pai/` - PAI chat + voice assistant: Gemini-powered natural language smart home control + property Q&A + Vapi voice calling (resident+ auth)
- `sonos-control/` - Proxies requests to Sonos HTTP API via Alpaca Mac (resident+ auth)
- `nest-control/` - Proxies requests to Google SDM API with OAuth token management (resident+ auth)
- `nest-token-refresh/` - Standalone Nest OAuth token refresher (cron)
- `tesla-command/` - Sends commands to Tesla vehicles via Fleet API (lock, unlock, wake, flash, honk) (resident+ auth)
- `create-tesla-account/` - Creates tesla_accounts row with server-held Fleet API credentials (resident+ auth); use default JWT
- `lg-control/` - LG ThinQ laundry control (status, start/stop, watch/unwatch notifications, push token registration) (resident+ auth)
- `anova-control/` - Anova Precision Oven control via WebSocket API (getStatus, startCook, stopCook) (resident+ auth)
- `glowforge-control/` - Glowforge laser cutter status via cookie-based web API (getStatus) (resident+ auth)
- `printer-control/` - FlashForge 3D printer control via TCP proxy (getStatus, startPrint, pausePrint, resumePrint, cancelPrint, setTemperature, toggleLight, homeAxes, listFiles) (resident+ auth)
- `verify-identity/` - Driver's license photo → Gemini Vision → auto-verify applicants/associates
- `paypal-payout/` - Sends PayPal payouts to associates
- `paypal-webhook/` - Receives PayPal payout status updates
- `vapi-server/` - Returns dynamic assistant config to Vapi on incoming calls
- `vapi-webhook/` - Receives Vapi call lifecycle events (end, transcript)
- `airbnb-sync/` - Fetches Airbnb iCal feeds → creates blocking assignments
- `ical/` - Generates iCal feeds per space for external calendar sync
- `regenerate-ical/` - Regenerates iCal feeds when assignments change
- `process-square-payment/` - Server-side Square payment processing
- `refund-square-payment/` - Square payment refunds
- `square-webhook/` - Receives Square webhook for payment/refund status changes (ACH PENDING→COMPLETED/FAILED)
- `process-stripe-payment/` - Creates Stripe PaymentIntent for ACH/card payments (returns clientSecret)
- `stripe-webhook/` - Receives Stripe webhook for payment/transfer status changes, sends confirmation emails
- `stripe-connect-onboard/` - Stripe Connect Express account creation + onboarding for associate payouts
- `stripe-payout/` - Outbound ACH payments to associates via Stripe Connect Transfers
- `record-payment/` - AI-assisted payment matching (Gemini)
- `resolve-payment/` - Manual payment resolution for pending matches
- `confirm-deposit-payment/` - Deposit payment confirmation workflow
- `error-report/` - Error logging and daily digest emails
- `contact-form/` - Public contact form submission handler
- `event-payment-reminder/` - Daily cron: 10-day payment reminders for events
- `ask-question/` - PAI Q&A backend
- `share-space/` - Serves OG meta tags for space share links (dynamic title, image, description) + redirects to real page
- `api/` - **Centralized Internal REST API** — single permissioned endpoint for all entity CRUD (spaces, people, tasks, assignments, vehicles, media, payments, bug_reports, time_entries, events, documents, sms, faq, invitations, password_vault, feature_requests, pai_config, tesla_accounts). Role-based access control (0=public → 4=oracle). Smart behaviors: fuzzy name/space resolution, auto-timestamps, row-level scoping. See `API.md` for full reference.

**Edge Function Deployment Flags:**
Functions that handle auth internally MUST be deployed with `--no-verify-jwt` to prevent Supabase's gateway from rejecting valid user tokens before they reach the function code.

| Function | Deploy command |
|----------|---------------|
| `sonos-control` | `supabase functions deploy sonos-control --no-verify-jwt` |
| `govee-control` | `supabase functions deploy govee-control --no-verify-jwt` |
| `nest-control` | `supabase functions deploy nest-control --no-verify-jwt` |
| `resend-inbound-webhook` | `supabase functions deploy resend-inbound-webhook --no-verify-jwt` |
| `telnyx-webhook` | `supabase functions deploy telnyx-webhook --no-verify-jwt` |
| `signwell-webhook` | `supabase functions deploy signwell-webhook --no-verify-jwt` |
| `tesla-command` | `supabase functions deploy tesla-command --no-verify-jwt` |
| `lg-control` | `supabase functions deploy lg-control --no-verify-jwt` |
| `anova-control` | `supabase functions deploy anova-control --no-verify-jwt` |
| `glowforge-control` | `supabase functions deploy glowforge-control --no-verify-jwt` |
| `printer-control` | `supabase functions deploy printer-control --no-verify-jwt` |
| `alpaca-pai` | `supabase functions deploy alpaca-pai --no-verify-jwt` |
| `verify-identity` | `supabase functions deploy verify-identity --no-verify-jwt` |
| `vapi-server` | `supabase functions deploy vapi-server --no-verify-jwt` |
| `vapi-webhook` | `supabase functions deploy vapi-webhook --no-verify-jwt` |
| `paypal-webhook` | `supabase functions deploy paypal-webhook --no-verify-jwt` |
| `reprocess-pai-email` | `supabase functions deploy reprocess-pai-email --no-verify-jwt` |
| `api` | `supabase functions deploy api --no-verify-jwt` |
| `square-webhook` | `supabase functions deploy square-webhook --no-verify-jwt` |
| `stripe-webhook` | `supabase functions deploy stripe-webhook --no-verify-jwt` |
| `share-space` | `supabase functions deploy share-space --no-verify-jwt` |
| All others | `supabase functions deploy <name>` (default JWT verification) |

---

> **Full database schema (tables, columns, key relationships):** See [docs/SCHEMA.md](docs/SCHEMA.md) — read on-demand when working on DB or migrations.

---

## Common Patterns

### Fetching Spaces with Media
```javascript
const { data } = await supabase
  .from('spaces')
  .select(`
    *,
    media_spaces(display_order, is_primary, media:media_id(id, url, caption))
  `)
  .eq('can_be_dwelling', true)
  .order('monthly_rate', { ascending: false, nullsFirst: false });
```

### Computing Availability
```javascript
// Load active assignments
const { data: assignments } = await supabase
  .from('assignments')
  .select('id, start_date, end_date, desired_departure_date, desired_departure_listed, status, assignment_spaces(space_id)')
  .in('status', ['active', 'pending_contract', 'contract_sent']);

// For each space, find current assignment
// Note: Only use desired_departure_date if desired_departure_listed is true
const currentAssignment = spaceAssignments.find(a => {
  if (a.status !== 'active') return false;
  const effectiveEndDate = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
  if (!effectiveEndDate) return true;
  return new Date(effectiveEndDate) >= today;
});
space.isAvailable = !currentAssignment;
```

### Uploading Media
```javascript
import { mediaService } from '../shared/media-service.js';

// Upload with automatic compression
const media = await mediaService.uploadMedia(file, {
  category: 'mktg',
  caption: 'Room photo'
});

// Link to space
await mediaService.linkMediaToSpace(media.id, spaceId, displayOrder);
```

### Building Mobile App
```bash
# From mobile/ directory:
cd mobile

# Full rebuild + sync to both platforms
npm run sync

# Sync to one platform only
npm run sync:ios
npm run sync:android

# Open in IDE to run on device/emulator
npm run open:ios       # Opens Xcode — press Play (▶) to run
npm run open:android   # Opens Android Studio — press Run
```

### Adding a New Mobile Tab Module
```javascript
// mobile/app/tabs/example-tab.js
import { ExampleService } from '../../../shared/services/example-data.js';
import { PollManager } from '../../../shared/services/poll-manager.js';

let poll;

export async function init(appUser) {
  const container = document.getElementById('exampleContent');
  // Render UI into container...

  // Start polling with visibility-based pause
  poll = new PollManager(() => refreshData(), 30000);
  poll.start();
}
```

### Sending SMS
```javascript
import { smsService } from '../shared/sms-service.js';

// Send to individual tenant (mirrors email-service.js pattern)
await smsService.sendPaymentReminder(tenant, amount, dueDate, period);
await smsService.sendGeneral(tenant, "Your package arrived.");

// Bulk send to all active tenants
await smsService.sendBulk('bulk_announcement', recipients, { message: "..." });

// Get conversation thread for a person
const messages = await smsService.getConversation(personId);
```

## Sorting & Display Rules

### Consumer View
1. Available spaces first (isAvailable = true)
2. Then by monthly_rate descending (highest price first)
3. Then by name alphabetically

### Admin View
1. By monthly_rate descending
2. Then by name

### Availability Display
- Available now: "Available: NOW"
- Occupied with end date: "Available: Mar 15" (when it becomes available)
- Occupied indefinitely: "Available: TBD"

## Deployment

This site deploys directly to GitHub Pages from the `main` branch. There is no build step, PR process, or branch protection - just push to main and it's live.

### Version: Bumped automatically on push to main

**Version format:** `vYYMMDD.NN H:MMa` — date + daily counter + Austin time (America/Chicago). Example: `v260211.03 5:06a` means the 3rd push on Feb 11 2026, at 5:06 AM Austin time. The version always increments: the date portion increases daily, and the counter `NN` resets each day. A Supabase sequence (`release_event_seq`) guarantees absolute ordering.

**How it works:** A GitHub Action (`bump-version-on-push.yml`) runs on every push to main (except its own `[skip ci]` commits). It:
1. Records the release event in `release_events` (Supabase) via `record_release_event()` — idempotent per push SHA, computes the version string in Austin time
2. Rewrites the version string in all HTML files (pattern-matches both `vYYMMDD.NN` and legacy `r` formats)
3. Writes `version.json` with release details (version, release #, actor, source, model, machine, commits)
4. Commits and pushes with `[skip ci]`

No local version bumping needed. Just push to main and CI handles it.

**One-time setup:** GitHub Settings → Secrets → `SUPABASE_DB_URL` (full Postgres connection string).

**Deploy workflow:**

```bash
git add -A
git commit -m "Your message"
./scripts/push-main.sh                     # pull --rebase, then push

# Or manually:
git pull --rebase origin main
git push origin main
```

**HTML pages:** Every HTML page has a version string (e.g., `v260211.03 5:06a`) in a `<span data-site-version>` or `class="site-nav__version"` that the bump script updates. New HTML pages should include a version span.

**version.json schema:**
```json
{
  "version": "v260211.03 5:06a",
  "release": 3,
  "sha": "abc12345",
  "actor": "rsonnad",
  "source": "github-main-push",
  "model": "ci",
  "machine": "runner-name",
  "pushedAt": "2026-02-11T11:06:00Z",
  "commits": [{ "sha": "abc12345", "message": "Fix something", "author": "Name" }]
}
```

### REQUIRED: Display Version in Chat

**You MUST display the current version string in every response where you make code changes or deploy.** Read from `version.json`. Format:

> `vYYMMDD.NN H:MMa [model]`

This ensures the user always knows which version they're looking at and which AI model produced it.

### REQUIRED: Post-Push Status Message

After every `git push`, you MUST include a status message so the user knows what was pushed and whether it's live. The format depends on which branch was pushed.

**If pushed to `main` (live deploy):**
> **Deployed to main** — the GitHub Action will bump the version and push; check the site or the latest Actions run for the new version.
> Test it here: https://alpacaplayhouse.com/residents/laundry.html

**If pushed to a feature/claude branch (NOT yet live):**
> **Pushed to branch `claude/branch-name`** (not yet deployed) `[model]`
> Changed files: `residents/residents.css`, `residents/laundry.html`
> To deploy: merge to main, push main (version will be bumped by GitHub Actions)

**Live site (clickable testing URL):** [https://alpacaplayhouse.com/](https://alpacaplayhouse.com/)

Common page URLs for testing links (use only on main deploys):
- Resident pages: [residents](https://alpacaplayhouse.com/residents/laundry.html) (cameras, climate, lighting, sonos, laundry, cars)
- Admin pages: [admin](https://alpacaplayhouse.com/spaces/admin/manage.html) (spaces, rentals, settings, templates, users, sms-messages)
- Public: [spaces](https://alpacaplayhouse.com/spaces/), [home](https://alpacaplayhouse.com/), [pay](https://alpacaplayhouse.com/pay/)

## Important Conventions

1. **Use `media_spaces` not `photo_spaces`** - The legacy photos/photo_spaces tables are fully migrated to media/media_spaces
2. **Filter archived spaces** - Always add `.filter(s => !s.is_archived)` client-side
3. **Don't expose personal info in consumer view** - Load assignment dates only, not person details
4. **Toast notifications in admin** - Use `showToast(message, type)` not `alert()`
5. **Lightbox for images** - Use `openLightbox(url)` for full-size image viewing
6. **Use Tailwind CSS for all new UI** - When writing new HTML or modifying existing elements, use Tailwind utility classes with AAP theme tokens instead of writing custom CSS. Use the `aap-*` prefixed tokens to stay on-brand:
   - Colors: `bg-aap-cream`, `bg-aap-dark`, `text-aap-amber`, `text-aap-text-muted`, `border-aap-border`
   - Shadows: `shadow-aap`, `shadow-aap-sm`, `shadow-aap-lg`, `shadow-aap-xl`
   - Radius: `rounded-aap` (8px), `rounded-aap-lg` (16px)
   - Status: `text-aap-success`, `text-aap-error`, `text-aap-warning`, `text-aap-info`
   - Layout: use Tailwind's `flex`, `grid`, `gap-*`, `p-*`, `m-*` utilities
   - Responsive: `md:` for tablet+, `lg:` for desktop
   - States: `hover:`, `focus:`, `active:` prefixes
   - **Don't rewrite working CSS** — only use Tailwind for new code or when actively modifying an element
   - **Run `npm run css:build`** after adding new Tailwind classes (CI also rebuilds on push)
7. **Use Claude CLI, never the Anthropic API directly** - For any process running on the DO droplet, Oracle instance, or any server where the CLI can run, always use the `claude` CLI (Claude Code) as a subprocess — never call the Anthropic API directly with an API key. For Supabase Edge Functions (Deno serverless) where the CLI can't run, use **Gemini** instead of Anthropic. There are zero places in the codebase that should call the Anthropic API directly — all workers use Claude CLI, all edge functions use Gemini.

---

> **API cost accounting, vendor pricing, external system details (SignWell, Resend, Telnyx, Hostinger, Nest, Tesla, Stripe, etc.):** See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — read on-demand when working on integrations or cost tracking.

---

## Supabase Details

- Anon key is in `shared/supabase.js` (safe to expose, RLS protects data)
- Storage buckets (Supabase Storage):
  - `housephotos` - Media/photos
  - `lease-documents` - Generated and signed lease PDFs
- External storage: Cloudflare R2 bucket `alpacapps` for documents/manuals (see Cloudflare R2 section in docs/INTEGRATIONS.md)

---

> **Recent changes (changelog, 49 entries):** See [docs/CHANGELOG.md](docs/CHANGELOG.md) — read on-demand for feature history and migration notes.

---

## Testing Changes

1. Check both card view and table view in consumer and admin views
2. Test on mobile web (responsive breakpoint at 768px)
3. Verify availability badges show correct dates
4. **Mobile app**: After changing `shared/services/` or `mobile/app/` files, rebuild with `cd mobile && npm run sync`, then run in Xcode or Android Studio
5. **Mobile app login**: Test both email/password and Google Sign In on both platforms

### Email Template Previewing

**IMPORTANT: Do NOT send real emails while iterating on email template design.** Resend has a daily quota. Instead:

1. Write the HTML to `tmp-invite-preview.html` (or similar) and open it in the browser for visual review
2. Iterate on the design using the local HTML preview only
3. Only send an actual email once the user confirms the design is finalized
4. When sending test emails, minimize sends — one test per finalized version, not per iteration

## Helpful Documentation

- `architecture.md` - Full system documentation
- `API.md` - REST API reference for Supabase
- `SKILL.md` - OpenClaw bot integration guide
- `HOMEAUTOMATION.md` - Home automation system (Sonos, UniFi, cameras)
