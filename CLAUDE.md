# CLAUDE.md - AlpacApps Project Context

This file provides context for Claude (AI assistant) when working on this codebase.

> **See `CLAUDE.local.md` for credentials, connection strings, and environment-specific configuration.**
> That file is gitignored and contains operator directives, database access details, API keys, and deployment-specific settings.

## Excluded: `/mistiq/`

The `/mistiq/` directory is a **separate, unrelated project** (Mistiq Staffing). It shares this repo for hosting convenience only. Do NOT:
- Include Mistiq in shared components, skills, or reusable templates
- Apply AlpacApps style/font changes to Mistiq (it has its own brand)
- Reference Mistiq when packaging or sharing this codebase with others

## Project Overview

AlpacApps is a property management system for AlpacApps Residency. It manages rental spaces, tenants, bookings, payments, and photos.

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (no framework)
- Mobile: Capacitor 8 (iOS + Android) wrapping mobile-first SPA
- Backend: Supabase (PostgreSQL + Storage + Auth + Edge Functions)
- Hosting: GitHub Pages (static site)
- Bot: OpenClaw Discord bot (separate DigitalOcean droplet)

## Architecture

```
Browser → GitHub Pages (static HTML/JS) ──→ Supabase (database + storage + edge functions)
                                          ↗
Discord → OpenClaw Bot (DO Droplet) ────┘
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
- `verify-identity/` - Driver's license photo → Claude Vision API → auto-verify applicants/associates
- `paypal-payout/` - Sends PayPal payouts to associates
- `paypal-webhook/` - Receives PayPal payout status updates
- `vapi-server/` - Returns dynamic assistant config to Vapi on incoming calls
- `vapi-webhook/` - Receives Vapi call lifecycle events (end, transcript)
- `airbnb-sync/` - Fetches Airbnb iCal feeds → creates blocking assignments
- `ical/` - Generates iCal feeds per space for external calendar sync
- `regenerate-ical/` - Regenerates iCal feeds when assignments change
- `process-square-payment/` - Server-side Square payment processing
- `refund-square-payment/` - Square payment refunds
- `record-payment/` - AI-assisted payment matching (Gemini)
- `resolve-payment/` - Manual payment resolution for pending matches
- `confirm-deposit-payment/` - Deposit payment confirmation workflow
- `error-report/` - Error logging and daily digest emails
- `contact-form/` - Public contact form submission handler
- `event-payment-reminder/` - Daily cron: 10-day payment reminders for events
- `ask-question/` - PAI Q&A backend
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
| `alpaca-pai` | `supabase functions deploy alpaca-pai --no-verify-jwt` |
| `verify-identity` | `supabase functions deploy verify-identity --no-verify-jwt` |
| `vapi-server` | `supabase functions deploy vapi-server --no-verify-jwt` |
| `vapi-webhook` | `supabase functions deploy vapi-webhook --no-verify-jwt` |
| `paypal-webhook` | `supabase functions deploy paypal-webhook --no-verify-jwt` |
| `api` | `supabase functions deploy api --no-verify-jwt` |
| All others | `supabase functions deploy <name>` (default JWT verification) |

## Database Schema (Supabase)

### Core Tables
```
spaces          - Rental units (name, rates, beds, baths, visibility flags)
people          - Tenants/guests (name, contact, type)
assignments     - Bookings (person_id, dates, rate, status)
assignment_spaces - Junction: which spaces are in which assignments
```

### Media System (New - use this, not legacy photos)
```
media           - All media files (url, dimensions, caption, category)
media_spaces    - Junction: media ↔ spaces (with display_order, is_primary)
media_tags      - Tag definitions (name, color)
media_tag_assignments - Junction: media ↔ tags
```

### SMS System
```
telnyx_config        - Telnyx API configuration (single row, id=1)
                      (api_key, messaging_profile_id, phone_number, is_active, test_mode)
sms_messages         - Log of all SMS sent/received
                      (person_id, direction, from/to_number, body, sms_type, telnyx_id, status)
```

### Inbound Email System
```
inbound_emails       - Log of all inbound emails received via Resend
                      (resend_email_id, from_address, to_address, cc, subject,
                       body_html, body_text, attachments, route_action,
                       forwarded_to, forwarded_at, special_logic_type,
                       processed_at, raw_payload)
```

### Lease Agreement System
```
lease_templates      - Markdown templates with {{placeholders}}
                      (name, content, version, is_active)
signwell_config      - SignWell API configuration (single row)
                      (api_key, webhook_secret, test_mode)
```

Key columns added to `rental_applications`:
- `generated_pdf_url` - URL to generated lease PDF in Supabase storage
- `signwell_document_id` - SignWell document tracking ID
- `signed_pdf_url` - URL to signed lease PDF after e-signature

### Govee Lighting System
```
govee_config         - Govee Cloud API configuration (single row, id=1)
                      (api_key, api_base, is_active, test_mode, last_synced_at)
govee_devices        - All Govee/AiDot smart lights (63 devices)
                      (device_id, sku, name, area, device_type, is_group,
                       capabilities, online, last_state, is_active, notes,
                       parent_group_id, display_order, space_id)
govee_models         - SKU → friendly model name lookup (16 rows)
                      (sku [PK], model_name, category)
```

### Nest Thermostat System
```
nest_config          - Google SDM API OAuth credentials (single row, id=1)
                      (google_client_id, google_client_secret, sdm_project_id,
                       refresh_token, access_token, token_expires_at,
                       is_active, test_mode)
nest_devices         - Cached thermostat info (3 devices: Master, Kitchen, Skyloft)
                      (sdm_device_id, room_name, device_type, display_order,
                       is_active, last_state [jsonb], lan_ip)
thermostat_rules     - Future rules engine (schema only, not yet implemented)
                      (name, device_id [FK→nest_devices], rule_type,
                       conditions [jsonb], actions [jsonb], is_active, priority)
```

### Weather System
```
weather_config       - OpenWeatherMap API configuration (single row, id=1)
                      (owm_api_key, latitude, longitude, location_name, is_active)
```

### Tesla & Vehicle System
```
tesla_accounts  - Tesla account credentials + Fleet API config
                  (owner_name, tesla_email, refresh_token, access_token,
                   token_expires_at, is_active, last_error,
                   last_token_refresh_at, fleet_client_id, fleet_client_secret,
                   fleet_api_base, created_at, updated_at)
vehicles        - All vehicles (renamed from tesla_vehicles)
                  (account_id [FK→tesla_accounts], vehicle_api_id, vin,
                   name, make, model, year, color, color_hex, svg_key, image_url,
                   owner_name, display_order, is_active,
                   vehicle_state [online/asleep/offline/unknown],
                   last_state [jsonb], last_synced_at, created_at, updated_at)
vehicle_drivers - Junction: vehicles ↔ people (who can drive which vehicle)
                  (vehicle_id [FK→vehicles], person_id [FK→people])
```

### Camera Streaming System
```
camera_streams  - go2rtc HLS stream configuration (9 rows: 3 cameras × 3 qualities)
                  (camera_name, quality [low/med/high], stream_name,
                   proxy_base_url, location, protect_share_url, is_active)
```

### LG Laundry System
```
lg_config           - LG ThinQ API configuration (single row, id=1)
                      (pat, api_base, country_code, client_id, is_active, test_mode, last_error)
lg_appliances       - LG washer/dryer devices with cached state
                      (lg_device_id, device_type [washer/dryer], name, model, lan_ip,
                       display_order, is_active, last_state [jsonb], last_synced_at)
push_tokens         - FCM push notification tokens per user (shared, not LG-specific)
                      (app_user_id [FK→app_users], token, platform [ios/android],
                       device_info, is_active)
laundry_watchers    - Who is watching which appliance for cycle-end notification
                      (app_user_id [FK→app_users], appliance_id [FK→lg_appliances])
```

### Cloudflare R2 & Document Storage
```
r2_config       - Cloudflare R2 configuration (single row, id=1)
                  (account_id, bucket_name, public_url, is_active)
document_index  - Documents stored in R2 for PAI lookup
                  (title, description, keywords [text[]], source_url,
                   file_type, file_size_bytes, storage_backend [supabase/r2],
                   is_active, uploaded_by, created_at, updated_at)
```

### AI Image Generation
```
image_gen_jobs  - Async image generation job queue
                  (prompt, job_type, status, metadata [jsonb],
                   result_media_id [FK→media], result_url,
                   input_tokens, output_tokens, estimated_cost_usd,
                   batch_id, batch_label, attempt_count, max_attempts,
                   priority, created_at, started_at, completed_at)
```

### Prompt Library
```
prompts         - Versioned prompt library (multiple versions per name)
                  (name, version, content, category, description,
                   metadata [jsonb], is_active, created_by [FK→app_users],
                   created_at, updated_at)
                  Unique: (name, version); unique partial index on (name) WHERE is_active
                  Helper functions: get_prompt(name), create_prompt_version(name, content, ...)
                  Categories: image_gen, email, pai, marketing, general
                  Seeded prompts: pai_daily_art (v1+v2), alpaca_trio_tech (v1)
```

### User & Auth System
```
app_users       - Application users with roles and profiles
                  (supabase_auth_id, email, role [admin/staff/resident/associate],
                   display_name, first_name, last_name, phone, phone2,
                   avatar_url, bio, person_id [FK→people],
                   nationality, location_base, gender,
                   privacy_phone, privacy_email, privacy_bio [public/residents/private],
                   facebook_url, instagram_url, linkedin_url, x_url,
                   created_at, last_sign_in_at)
user_invitations - Pending user invitations (email, role, invited_by, expires_at)
```

### Brand Configuration
```
brand_config    - Singleton (id=1) brand configuration stored as JSONB
                  (config [jsonb], updated_at, updated_by [FK→app_users])
                  Contains: brand names, color palette, typography, logos,
                  visual elements, email template tokens
                  Readable by all (anon), writable by admin only
```

### Associate Hours & Payouts
```
associate_profiles   - Associate metadata
                      (app_user_id [FK→app_users], person_id [FK→people],
                       hourly_rate, payment_method, payment_handle,
                       identity_verification_status [pending/link_sent/verified/flagged/rejected],
                       setup_completed_at)
time_entries         - Clock in/out records
                      (associate_id [FK→associate_profiles], space_id [FK→spaces],
                       clock_in, clock_out, duration_minutes,
                       is_manual, manual_reason, notes,
                       latitude, longitude, status [active/completed/paid],
                       paid_at, payout_id [FK→payouts])
work_photos          - Before/during/after work photos
                      (time_entry_id [FK→time_entries], associate_id,
                       photo_url, photo_type [before/progress/after], caption)
paypal_config        - PayPal API credentials (single row, id=1)
                      (client_id, client_secret, sandbox_client_id, sandbox_client_secret,
                       webhook_id, sandbox_webhook_id, is_active, test_mode)
payouts              - Payout records for associate payments
                      (associate_id, person_id, amount, payment_method,
                       external_payout_id, status [pending/processing/completed/failed/returned],
                       time_entry_ids [uuid[]], created_at, completed_at)
```

### Identity Verification
```
upload_tokens        - Secure tokenized upload links for ID verification
                      (token, person_id [FK→people], app_user_id [FK→app_users],
                       purpose, expires_at, used_at)
identity_verifications - Extracted DL data from Claude Vision API
                      (person_id, app_user_id, photo_url,
                       extracted_name, extracted_dob, extracted_dl_number,
                       extracted_address, match_status [auto_approved/flagged/rejected],
                       verified_at, reviewed_by)
```

### Vapi Voice Calling System
```
vapi_config          - Vapi API configuration (single row, id=1)
                      (api_key, phone_number_id, is_active, test_mode)
voice_assistants     - Configurable AI voice assistants
                      (name, system_prompt, model, voice, temperature,
                       tools [jsonb], is_active)
voice_calls          - Call log
                      (vapi_call_id, caller_phone, person_id [FK→people],
                       assistant_id [FK→voice_assistants], duration_seconds,
                       cost_usd, transcript [jsonb], recording_url,
                       status, created_at)
```

### Airbnb iCal Sync
```
(Uses existing spaces + assignments tables)
Key columns on spaces:
  airbnb_ical_url    - Inbound iCal feed URL from Airbnb listing
  airbnb_link        - Public Airbnb listing URL
  airbnb_rate        - Airbnb listing price
  airbnb_blocked_dates - JSONB array of blocked date ranges
```

### Legacy (Deprecated - don't use for new features)
```
photos          - Old photo storage
photo_spaces    - Old photo-space links
```

### Key Columns on `spaces`
- `type` - Free-form text field (e.g., "Dwelling", "Amenity", "Event")
- `is_listed` - Show in consumer view
- `is_secret` - Only accessible via direct URL with ?id=
- `can_be_dwelling` - Filter for rental listings
- `can_be_event` - Can be used for events
- `is_archived` - Soft delete (filtered out everywhere)

### Key Columns on `assignments`
- `status` - active, pending_contract, contract_sent, completed, cancelled
- `start_date`, `end_date` - Assignment period
- `desired_departure_date` - Early exit date (tenant wants to leave early)
- `desired_departure_listed` - Boolean, when true the early exit date is shown to consumers for availability

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
- Public: [spaces](https://alpacaplayhouse.com/spaces/), [home](https://alpacaplayhouse.com/)

## Important Conventions

1. **Use `media_spaces` not `photo_spaces`** - The old photo system is deprecated
2. **Filter archived spaces** - Always add `.filter(s => !s.is_archived)` client-side
3. **Don't expose personal info in consumer view** - Load assignment dates only, not person details
4. **Toast notifications in admin** - Use `showToast(message, type)` not `alert()`
5. **Lightbox for images** - Use `openLightbox(url)` for full-size image viewing

## API Cost Accounting (REQUIRED)

**Every feature that makes external API calls MUST log usage to the `api_usage_log` table for cost tracking.**

This is non-negotiable. When building or modifying any feature that calls a paid API, you must instrument it to log each API call with its cost data. This lets us track spending by vendor and by feature category.

### The `api_usage_log` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `vendor` | text NOT NULL | API provider (see vendor list below) |
| `category` | text NOT NULL | Granular feature category (see category list below) |
| `endpoint` | text | API endpoint or operation name |
| `input_tokens` | integer | Input/request tokens (for LLM APIs) |
| `output_tokens` | integer | Output/response tokens (for LLM APIs) |
| `units` | numeric | Non-token usage units (SMS segments, emails, minutes, etc.) |
| `unit_type` | text | What the units represent (e.g., "sms_segments", "emails", "call_minutes", "documents", "api_calls") |
| `estimated_cost_usd` | numeric | Calculated cost for this call |
| `metadata` | jsonb | Additional context (model name, prompt snippet, error info, etc.) |
| `app_user_id` | uuid FK→app_users | User who triggered the call (if applicable) |
| `created_at` | timestamptz | When the API call was made |

### Vendors

Use these exact vendor strings:

| Vendor | Services |
|--------|----------|
| `gemini` | Gemini API (image gen, PAI chat, payment matching) |
| `anthropic` | Claude API (identity verification, bug analysis) |
| `vapi` | Vapi voice calls |
| `telnyx` | SMS sending/receiving |
| `resend` | Email sending |
| `signwell` | E-signature documents |
| `square` | Payment processing |
| `paypal` | Associate payouts |
| `openweathermap` | Weather API |
| `google_sdm` | Nest thermostat API (Google Smart Device Management) |
| `tesla` | Tesla Fleet API |
| `lg_thinq` | LG ThinQ API |
| `govee` | Govee Cloud API |
| `supabase` | Supabase platform (storage, edge function invocations) |
| `cloudflare_r2` | Cloudflare R2 object storage |

### Categories (Granular)

Use descriptive, granular categories that identify the specific feature. Examples:

| Category | Description |
|----------|-------------|
| `spaces_image_gen` | AI-generated space/marketing images |
| `pai_chat` | PAI conversational AI (text chat) |
| `pai_voice` | PAI voice assistant (Vapi calls) |
| `pai_smart_home` | PAI smart home commands (lights, music, climate) |
| `life_of_pai_backstory` | Life of PAI backstory generation |
| `life_of_pai_voice` | Life of PAI voice/personality generation |
| `identity_verification` | DL photo verification via Claude Vision |
| `lease_esignature` | Lease document e-signatures |
| `payment_matching` | AI-assisted payment matching |
| `bug_analysis` | Bug Scout automated bug analysis |
| `feature_building` | Feature Builder automated implementation |
| `sms_tenant_notification` | SMS notifications to tenants |
| `sms_bulk_announcement` | Bulk SMS announcements |
| `email_tenant_notification` | Email notifications to tenants |
| `email_system_alert` | System alert emails (errors, digests) |
| `email_payment_receipt` | Payment receipt/confirmation emails |
| `weather_forecast` | Weather API calls |
| `nest_climate_control` | Thermostat reads and commands |
| `tesla_vehicle_poll` | Tesla vehicle data polling |
| `tesla_vehicle_command` | Tesla vehicle commands (lock, unlock, etc.) |
| `lg_laundry_poll` | LG washer/dryer status polling |
| `govee_lighting_control` | Govee light commands |
| `sonos_music_control` | Sonos playback commands |
| `square_payment_processing` | Square payment transactions |
| `paypal_associate_payout` | PayPal associate payouts |
| `airbnb_ical_sync` | Airbnb calendar sync |
| `r2_document_upload` | Document upload to Cloudflare R2 |
| `pai_email_classification` | PAI email classification via Gemini |

**When adding a new feature that uses an API, add a new category to this list.** Categories should be specific enough to answer "how much does X feature cost us per month?"

### How to Log (Edge Functions)

In Supabase edge functions, log after each API call:

```typescript
// After making an API call, log the usage
await supabaseAdmin.from('api_usage_log').insert({
  vendor: 'gemini',
  category: 'pai_chat',
  endpoint: 'generateContent',
  input_tokens: response.usageMetadata?.promptTokenCount,
  output_tokens: response.usageMetadata?.candidatesTokenCount,
  estimated_cost_usd: calculateGeminiCost(inputTokens, outputTokens),
  metadata: { model: 'gemini-2.0-flash', conversation_id: '...' },
  app_user_id: userId
});
```

### How to Log (DO Droplet Workers)

Workers should log via direct Supabase insert (they already have service role keys):

```javascript
await supabase.from('api_usage_log').insert({
  vendor: 'tesla',
  category: 'tesla_vehicle_poll',
  endpoint: 'vehicle_data',
  units: vehicleCount,
  unit_type: 'api_calls',
  estimated_cost_usd: 0, // Free tier / included
  metadata: { vehicles_polled: vehicleNames }
});
```

### Cost Aggregation

The accounting admin page (`spaces/admin/accounting.html`) should show:
- **By vendor**: Total spend per vendor per month
- **By category**: Total spend per category per month
- **Drill-down**: Click vendor → see category breakdown

### Pricing Reference (for cost calculation)

| Vendor | Pricing |
|--------|---------|
| Gemini 2.5 Flash | Input: $0.15/1M tokens, Output: $3.50/1M tokens (under 200k context) |
| Gemini 2.0 Flash | Input: $0.10/1M tokens, Output: $0.40/1M tokens |
| Claude (Anthropic) | Varies by model — check current pricing |
| Vapi | ~$0.05-0.15/min (varies by provider + model) |
| Telnyx SMS | ~$0.004/segment outbound, ~$0.001/segment inbound |
| Resend Email | Free tier: 100/day, then $0.00028/email |
| SignWell | Included in plan (25 docs/month free) |
| Square | 2.6% + $0.10 per transaction |
| PayPal Payouts | $0.25/payout (US) |

## Supabase Details

- Anon key is in `shared/supabase.js` (safe to expose, RLS protects data)
- Storage buckets (Supabase Storage):
  - `housephotos` - Media/photos
  - `lease-documents` - Generated and signed lease PDFs
- External storage: Cloudflare R2 bucket `alpacapps` for documents/manuals (see Cloudflare R2 section)

## External Systems

### SignWell (E-Signatures)
- API Key: Stored in `signwell_config` table (not hardcoded)
- API Base: `https://www.signwell.com/api/v1`
- Used for rental agreement e-signatures

**Workflow:**
1. Admin generates PDF from lease template (Documents tab)
2. Admin clicks "Send for Signature" → SignWell API creates document
3. Tenant receives email, signs in SignWell
4. Webhook notifies system → downloads signed PDF → stores in Supabase
5. `agreement_status` updated to "signed"

### Resend (Email)
- **Domain**: `alpacaplayhouse.com` (verified, sending + receiving)
- **Account**: wingsiebird@gmail.com
- **API Key**: Stored as Supabase secret `RESEND_API_KEY`
- **Webhook Secret**: Stored as Supabase secret `RESEND_WEBHOOK_SECRET` (SVIX-based)
- **Outbound**: `send-email` Edge Function sends via Resend API (43 templates)
  - From: `notifications@alpacaplayhouse.com` (forwarded emails) or `noreply@alpacaplayhouse.com` (system emails)
  - Client service: `shared/email-service.js`
- **Inbound**: `resend-inbound-webhook` Edge Function (deployed with `--no-verify-jwt`)
  - Webhook URL: `https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/resend-inbound-webhook`
  - Event: `email.received`
  - All inbound emails logged to `inbound_emails` table
  - Webhook payload doesn't include body — fetched separately via Resend API

**DNS Records** (GoDaddy, domain: `alpacaplayhouse.com`):
- MX `@` → `inbound-smtp.us-east-1.amazonaws.com` (priority 10) — inbound receiving
- MX `send` → `feedback-smtp.us-east-1.amazonses.com` (priority 10) — SPF for outbound
- TXT `send` → SPF record for outbound
- TXT `resend._domainkey` → DKIM record

**Inbound Email Routing** (`*@alpacaplayhouse.com`):
| Prefix | Action | Destination |
|--------|--------|-------------|
| `haydn@` | Forward | `hrsonnad@gmail.com` |
| `rahulio@` | Forward | `rahulioson@gmail.com` |
| `sonia@` | Forward | `sonia245g@gmail.com` |
| `team@` | Forward | `alpacaplayhouse@gmail.com` |
| `herd@` | Special logic | (stub — future AI processing) |
| `auto@` | Special logic | Bug report replies → new bug report; others → admin |
| `pai@` | Special logic | Gemini classifies → questions/commands get PAI reply; documents uploaded to R2; other forwarded to admin |
| Everything else | Forward | `alpacaplayhouse@gmail.com` |

### Telnyx (SMS)
- Config stored in `telnyx_config` table (api_key, messaging_profile_id, phone_number, test_mode)
- Outbound: `send-sms` Edge Function calls Telnyx Messages API
- Inbound: `telnyx-webhook` Edge Function receives SMS, stores in `sms_messages` table
- Client service: `shared/sms-service.js` (mirrors email-service.js pattern)
- Admin UI: Settings tab has test mode toggle, compose SMS, bulk SMS, inbound SMS view

### DigitalOcean Droplet
- Runs OpenClaw Discord bot and Bug Scout (`bug_scout.js`)
- Bug Scout: polls `bug_reports` for pending bugs → runs Claude Code to fix → commits to `bugfix/` branch → merges to main
- Feature Builder: `feature-builder/feature_builder.js` — polls PAI feature requests → runs Claude Code to implement
- Bug fixer repo is a clone of this repo, used for verification screenshots
- Uses `SKILL.md` for API knowledge
- Queries Supabase directly for tenant/space info
- **Workers on droplet:** Bug Scout (`bug-fixer.service`), Tesla Poller (`tesla-poller.service`), Image Gen (`image-gen.service`), LG Poller (`lg-poller.service`), Feature Builder (`feature-builder.service`), PAI Discord Bot (`pai-discord.service`)

### Home Automation (Sonos, UniFi, Cameras)
- Full documentation in `HOMEAUTOMATION.md`
- Credentials and IPs in `HOMEAUTOMATION.local.md`
- Alpaca Mac (home server) bridges DO droplet to local LAN via Tailscale
- Sonos HTTP API on port 5005: play, pause, volume, favorites, TTS
- UniFi Network API on UDM Pro port 443: firewall, DHCP, WiFi management
- 12 Sonos zones controllable via `http://<alpaca-tailscale-ip>:5005/{room}/{action}`

### Google Nest (Thermostats)
- **API**: Google Smart Device Management (SDM) API
- **Auth**: OAuth 2.0 with refresh token stored in `nest_config` table
- **Devices**: 3 Nest thermostats — Master, Kitchen, Skyloft
- **LAN IPs**: 192.168.1.111 (Master), .139 (Kitchen), .249 (Skyloft)
- **Edge function**: `nest-control` proxies to SDM API, handles token refresh
- **SDM API base**: `https://smartdevicemanagement.googleapis.com/v1`
- **Traits used**: Temperature, Humidity, ThermostatMode, ThermostatHvac, ThermostatEco, ThermostatTemperatureSetpoint, Connectivity
- **Temperature**: SDM API uses Celsius, UI shows Fahrenheit, edge function converts
- **Rate limit**: 5 QPS per SDM project (polling at 0.1 QPS is well within limit)
- **OAuth setup**: One-time admin flow via Climate tab Settings → "Authorize Google Account"

### OpenWeatherMap (Weather)
- **API**: One Call API 3.0 (with 2.5 free tier fallback)
- **Config**: `weather_config` table (owm_api_key, latitude, longitude, location_name)
- **Location**: 160 Still Forest Dr, Cedar Creek, TX (30.13, -97.46)
- **Display**: Rain windows summary + expandable hourly 48-hour forecast
- **Client-side only**: No edge function needed, API key safe for read-only weather

### AI Image Generation (Gemini)
- **Worker:** `/opt/image-gen/worker.js` on DO droplet (systemd: `image-gen.service`)
- **API:** Gemini 2.5 Flash Image (`generateContent` with `responseModalities: ["TEXT","IMAGE"]`)
- **Cost:** ~$0.039/image (1290 output tokens x $30/1M tokens)
- **Storage:** `housephotos/ai-gen/` prefix in Supabase Storage
- **DB:** `image_gen_jobs` table (job queue), results link to `media` table
- **Trigger:** Insert rows into `image_gen_jobs` — worker polls every 10s
- **Batch:** Set `batch_id` + `batch_label` for grouped jobs
- **Cost tracking:** API response includes `usageMetadata` token counts, stored per-job
- **MCP (local):** Nano Banana MCP configured in `.mcp.json` for interactive Claude Code sessions
  - Uses same Gemini API key as the worker
  - Tools: `generate_image`, `edit_image`, `continue_editing`
  - Restart Claude Code after changing `.mcp.json`

### Tesla Vehicle Data Poller + Commands
- **Worker:** `/opt/tesla-poller/worker.js` on DO droplet (systemd: `tesla-poller.service`)
- **API:** Tesla Fleet API (`https://fleet-api.prd.na.vn.cloud.tesla.com`)
- **Auth URL:** `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`
- **App:** "Tespaca" registered at developer.tesla.com, public key at `.well-known/appspecific/com.tesla.3p.public-key.pem`
- **Fleet creds:** `fleet_client_id`, `fleet_client_secret`, `fleet_api_base` stored per account in `tesla_accounts` table
- **Token rotation:** Refresh tokens may rotate — new token saved immediately after exchange
- **Polling:** Every 5 min, sleep-aware (doesn't wake sleeping cars)
- **DB:** `tesla_accounts` (credentials + Fleet API config), `vehicles` (cached state in `last_state` JSONB), `vehicle_drivers` (vehicle ↔ person junction)
- **Client:** `residents/cars.js` polls Supabase every 30s with visibility-based pause
- **Vehicles:** 6 cars on 1 account: Casper (Model 3 2019), Delphi (Model Y 2023), Sloop (Model Y 2026), Cygnus (Model Y 2026), Kimba (Model Y 2022), Brisa Branca (Model 3 2022)
- **Data tracked:** battery, range, charging state, odometer, climate, location, tire pressure, lock state
- **Commands:** `tesla-command` Supabase edge function — lock, unlock, wake, flash lights, honk horn
- **Commands auth:** resident+ role required (any resident can unlock to rotate cars off chargers)
- **UI:** Lock/unlock and flash buttons on each car card in `residents/cars.js`

### Camera Streaming (go2rtc + Caddy)
- **Server:** go2rtc v1.9.14 on Alpaca Mac (`~/go2rtc/go2rtc`)
- **Config:** `~/go2rtc/go2rtc.yaml` (also in repo at `scripts/go2rtc/go2rtc.yaml`)
- **Protocol:** `rtspx://` (RTSP over TLS, no SRTP) to UniFi Protect on UDM Pro
- **Cameras:** 3 UniFi G5 PTZ cameras × 3 quality levels = 9 streams
- **Proxy:** Caddy on DO droplet at `cam.alpacaplayhouse.com/api/*` → go2rtc:1984 via Tailscale
- **HLS URL format:** `https://cam.alpacaplayhouse.com/api/stream.m3u8?src={stream_name}&mp4`
- **DB:** `camera_streams` table stores stream config (stream_name, proxy_base_url, quality, location)
- **Client:** `residents/cameras.js` loads streams from DB, plays via HLS.js with fMP4 mode (`&mp4` parameter)
- **PTZ:** UniFi Protect API — continuous move at `POST /proxy/protect/api/cameras/{id}/move`, presets at `POST .../ptz/goto/{slot}`
- **CORS:** Caddy strips go2rtc's CORS headers, adds origin-specific ones for `rsonnad.github.io` and `alpacaplayhouse.com`
- **Launchd:** `com.go2rtc` service (KeepAlive + RunAtLoad)
- **Full docs:** `HOMEAUTOMATION.md`

### LG ThinQ (Washer/Dryer)
- **API**: LG ThinQ Connect REST API (PAT auth)
- **PAT Portal**: https://connect-pat.lgthinq.com/
- **API Base**: `https://api-aic.lgthinq.com` (Americas region)
- **Worker**: `/opt/lg-poller/worker.js` on DO droplet (systemd: `lg-poller.service`)
- **Polling**: Every 30s for rapid laundry status updates
- **DB**: `lg_config` (PAT/API config), `lg_appliances` (cached state in `last_state` JSONB)
- **Edge Function**: `lg-control` (status, control, watch/unwatch, push token registration)
- **Push**: FCM push notifications when cycle ends to subscribed watchers
- **QR**: Deep link QR codes on machines → auto-subscribe to notifications
- **Devices**: Washer (192.168.1.246), Dryer (192.168.1.22)
- **Washer states**: POWER_OFF, INITIAL, DETECTING, RUNNING, RINSING, SPINNING, DRYING, STEAM_SOFTENING, COOL_DOWN, RINSE_HOLD, REFRESHING, PAUSE, RESERVED, END, SLEEP, ERROR
- **Dryer states**: POWER_OFF, INITIAL, RUNNING, PAUSE, END, ERROR, DIAGNOSIS, RESERVED
- **Client**: `residents/laundry.js` polls Supabase every 15s with visibility-based pause

### Vapi (AI Voice Calling)
- **API**: Vapi.ai (voice AI platform)
- **Pattern**: Server URL — Vapi calls `vapi-server` edge function on each incoming call to get assistant config dynamically
- **Webhook**: `vapi-webhook` edge function receives call lifecycle events
- **Caller ID**: Matches caller phone → `people` table for personalized greeting
- **Dynamic prompt**: Injects current occupants, availability, caller name into system prompt
- **Tools**: Routes tool calls to PAI (smart home control, property Q&A, send links)
- **DB**: `vapi_config`, `voice_assistants`, `voice_calls`
- **Admin UI**: `spaces/admin/voice.html` — manage assistants, view call logs, configure settings
- **Cost**: ~$0.10-$0.30 per call

### PAI Discord Bot
- **Architecture**: Lightweight Node.js bot that bridges Discord → `alpaca-pai` edge function
- **Source**: `pai-discord/bot.js` (in repo), deployed to `/opt/pai-discord/` on DO droplet
- **Library**: discord.js v14
- **Service**: `pai-discord.service` (systemd, runs as `bugfixer` user)
- **Auth**: Service role key → `alpaca-pai` with `context.source: "discord"`
- **User lookup**: Matches `discord_user_id` → `app_users.discord_id` for role-based access
- **Channels**: Listens to configured `CHANNEL_IDS` + DMs + @mentions
- **History**: In-memory per-user conversation history (12 messages, 30 min TTL)
- **Env vars**: `DISCORD_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CHANNEL_IDS`
- **Discord guild**: Alpacord (ID: `1471023710755487867`), channel `#pai-in-the-sky` (ID: `1471024050343247894`)
- **Install**: `cd pai-discord && bash install.sh` on droplet, then edit `.env`

### PayPal (Associate Payouts)
- **API**: PayPal Payouts API (batch payments)
- **Auth**: OAuth client credentials flow
- **Edge functions**: `paypal-payout` (send) + `paypal-webhook` (status updates)
- **Config**: `paypal_config` table (client_id, client_secret, sandbox variants, test_mode)
- **DB**: `payouts` table (amount, status, time_entry_ids linkage)
- **Supports**: Sandbox + production environments
- **Gated on**: Associate identity verification status

### Camera Talkback (Two-Way Audio via FFmpeg)
- **Relay server**: `scripts/talkback-relay/talkback-relay.js` on Alpaca Mac
- **Protocol**: WebSocket (port 8902) → FFmpeg → UDP to camera:7004
- **Audio pipeline**: Browser PCM S16LE 48kHz mono → FFmpeg → AAC-ADTS 22.05kHz mono 32kbps
- **Cameras**: Alpacamera (192.168.1.173), Front Of House (.182), Side Yard (.110)
- **Health check**: Port 8903
- **LaunchAgent**: `com.talkback-relay.plist`
- **Requires**: FFmpeg installed on Alpaca Mac (`FFMPEG_PATH` env var, defaults to `ffmpeg`)
- **Client**: `residents/cameras.js` CameraTalkback class — Web Audio API microphone capture, push-to-talk UI

### Airbnb (iCal Sync)
- **Edge functions**: `airbnb-sync` (fetch iCal), `ical` (export iCal), `regenerate-ical` (on changes)
- **Inbound**: Fetches Airbnb iCal feeds from `spaces.airbnb_ical_url`
- **Outbound**: Exports assignments per space as iCal (GET `/functions/v1/ical?space={slug}`)
- **Parent cascade**: Blocking parent space blocks all child spaces
- **DB columns on spaces**: `airbnb_ical_url`, `airbnb_link`, `airbnb_rate`, `airbnb_blocked_dates`

### Cloudflare R2 (Object Storage)
- **Account**: Cloudflare AlpacApps (wingsiebird@gmail.com)
- **Bucket**: `alpacapps` (APAC region)
- **S3 API**: `https://<account_id>.r2.cloudflarestorage.com`
- **Public URL**: `https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev`
- **Auth**: S3-compatible API with AWS Signature V4
- **Supabase Secrets**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
- **DB config**: `r2_config` table (single row, id=1)
- **Shared helper**: `supabase/functions/_shared/r2-upload.ts` — `uploadToR2()`, `deleteFromR2()`, `getR2PublicUrl()`
- **Key paths in bucket**: `documents/` (manuals, guides for PAI lookup)
- **Document tracking**: `document_index` table maps files to R2 URLs with metadata for PAI's `lookup_document` tool
- **Pricing**: 10 GB free, $0.015/GB-mo beyond that, zero egress fees
- **Legacy**: Google Drive folder still has old rental agreements (not programmatically accessed)

### Google Drive (Legacy)
- Rental agreements stored in a shared folder (legacy)
- Not programmatically accessed

## Recent Changes to Be Aware Of

1. **Consumer view now loads real availability** - Fetches assignments to show actual dates
2. **Media system migration** - Using `media`/`media_spaces` tables instead of `photos`/`photo_spaces`
3. **Space archiving** - `is_archived` flag for soft deletes
4. **Image compression** - Client-side compression for images > 500KB
5. **Early exit feature** - `desired_departure_date` + `desired_departure_listed` on assignments
   - Admin sets desired departure date
   - Admin clicks "List" to publish it for consumers
   - Only when listed does it affect availability display
6. **Space type field** - Free-form `type` column on spaces table, editable in admin modal
7. **Manage page filters** - Search, parent area dropdown, dwelling/non-dwelling checkboxes
8. **URL parameter handling** - `/spaces/admin/?edit=<id>` auto-opens edit modal
9. **Lease Template System** - Database-driven lease generation with placeholders
   - Templates stored in `lease_templates` table with markdown + `{{placeholders}}`
   - PDF generation via jsPDF (client-side)
   - SignWell integration for e-signatures
   - Settings tab in manage.html for template editing
10. **Rental Pipeline** - Kanban-style rental application workflow
   - Stages: Applications → Approved → Contract → Deposit → Ready
   - Documents tab with PDF generation and signature tracking
11. **Telnyx SMS Integration** - Outbound and inbound SMS via Telnyx
   - `shared/sms-service.js` mirrors email-service.js pattern
   - Edge functions: `send-sms` (outbound) and `telnyx-webhook` (inbound)
   - Admin Settings: test mode toggle, compose SMS, bulk SMS, inbound SMS view
   - Config in `telnyx_config` table, messages logged in `sms_messages` table
12. **Bug Fix Verification Screenshots** - After fixing a bug, the worker takes a screenshot
   - Uses Puppeteer (headless Chromium) on the DigitalOcean droplet
   - Waits 90s for GitHub Pages deploy, then screenshots the page
   - For admin pages: injects bot user auth session into Puppeteer's localStorage
   - Uploads screenshot to `bug-screenshots` Supabase Storage bucket
   - Sends follow-up email (`bug_report_verified`) with the screenshot
13. **Bug Reports Browser Info** - Extensions collect full environment data
   - `bug_reports` table captures: `user_agent`, `browser_name`, `browser_version`, `os_name`, `os_version`, `screen_resolution`, `viewport_size`, `device_type`, `extension_platform`, `extension_version`
   - Worker writes back `diagnosis` (root cause) and `notes` (observations/caveats) after Claude Code analyzes the bug
   - Claude Code prompt instructs it to output structured JSON with `diagnosis`, `fix_summary`, and `notes`
14. **Resend Inbound Email** - Inbound email receiving and routing via Resend
   - Domain `alpacaplayhouse.com` configured for both sending and receiving
   - MX record points to `inbound-smtp.us-east-1.amazonaws.com`
   - Edge function: `resend-inbound-webhook` (SVIX signature verification)
   - Prefix-based routing: personal forwards, team@, auto@ (bug reply logic), herd@ (stub)
   - All emails logged to `inbound_emails` table
   - Forwarded emails preserve original sender name, set reply-to to original sender
15. **Home Automation System** - Sonos + UniFi programmatic control
   - Alpaca Mac (macOS 12.7.6) runs as home server on Black Rock City WiFi
   - node-sonos-http-api discovers and controls 12 Sonos zones
   - Custom `balance.js` action added for L/R balance control (uses SOAP LF/RF channels)
   - Proxy chain: Browser → Supabase edge function → nginx on DO droplet (port 8055) → Alpaca Mac via Tailscale
   - `SONOS_PROXY_URL` and `SONOS_PROXY_SECRET` stored as Supabase secrets
   - Edge function `sonos-control` MUST be deployed with `--no-verify-jwt`
   - Tailscale mesh VPN connects DO droplet to Alpaca Mac
   - UniFi Network API for firewall/DHCP/WiFi management
   - `HOMEAUTOMATION.md` for full documentation (proxy chain details, balance action, troubleshooting)
16. **Govee Lighting Integration** - 63 Govee/AiDot smart lights backed up in Supabase
   - `govee_config` table stores API key, test mode toggle (single row, id=1)
   - `govee_devices` table stores all 63 devices with name, SKU, area, type
   - `govee_devices.parent_group_id` links individual devices to their parent group
   - `govee_devices.display_order` controls group sort order in UI
   - `govee_models` table maps SKU → friendly model name (e.g., H601F → "Recessed Lights Pro")
   - Cloud API base: `https://openapi.api.govee.com/router/api/v1/`
   - `govee_devices.space_id` links devices to spaces table for hierarchy-based UI grouping
   - Lighting page (`residents/lighting.html`) loads groups dynamically from DB
   - Groups organized into collapsible `<details>/<summary>` sections by space hierarchy (depth-1 ancestor)
   - Section collapse state persisted in localStorage
   - Settings (test mode toggle, device inventory) shown to admin users on lighting page
   - Edge function: `govee-control` proxies requests to Govee Cloud API (staff+ auth required)
   - Areas: Garage Mahal (17), Spartan (18), Outdoor (12), Outhouse (7), Interior (5), Bedrooms (4)
17. **Nest Thermostat Integration** - Climate page with Google SDM API
   - `residents/climate.html` + `residents/thermostat.js` — Climate tab in resident nav
   - 3 thermostats: Master, Kitchen, Skyloft (LAN IPs: .111, .139, .249)
   - Full controls: current temp, target temp +/-, mode (Heat/Cool/Heat-Cool/Off), eco toggle
   - Edge function: `nest-control` handles OAuth token refresh + SDM API proxy
   - DB: `nest_config` (OAuth creds), `nest_devices` (cached state), `thermostat_rules` (future)
   - OAuth flow: admin completes one-time Google authorization from Settings section
   - 30s polling with visibility-based pause (same pattern as Sonos/Govee)
18. **Weather Forecast on Climate Page** - 48-hour forecast via OpenWeatherMap
   - Rain windows summary at top: "Rain expected: Today 2 PM - 5 PM (70% chance)"
   - Expandable hourly detail chart with temp and precipitation probability per hour
   - `weather_config` table stores OWM API key + lat/lon (Cedar Creek, TX: 30.13, -97.46)
   - Supports One Call API 3.0 with 2.5 free tier fallback
   - Client-side API call (no edge function needed)
19. **AI Image Generation Worker** - Async Gemini image gen on DO droplet
   - Worker at `/opt/image-gen/worker.js` polls `image_gen_jobs` table every 10s
   - Gemini 2.5 Flash Image API generates images from text prompts
   - Uploads to Supabase Storage (`housephotos/ai-gen/`), creates `media` record
   - Per-job cost tracking from API response token counts (~$0.039/image)
   - Retry up to 3x on failure, 3s rate-limit delay between API calls
   - Systemd service: `image-gen.service` (runs as `bugfixer` user)
   - Nano Banana MCP (`.mcp.json`, gitignored) for interactive image gen in Claude Code
20. **Cars Resident Page + Tesla Fleet API** - Live Tesla vehicle data + commands at `residents/cars.html`
   - 6 Tesla vehicles on 1 account: Casper (Model 3 2019), Delphi (Model Y 2023), Sloop (Model Y 2026), Cygnus (Model Y 2026), Kimba (Model Y 2022), Brisa Branca (Model 3 2022)
   - Migrated from Tesla Owner API (dead) to Fleet API (`fleet-api.prd.na.vn.cloud.tesla.com`)
   - "Tespaca" app registered at developer.tesla.com, EC public key hosted in repo
   - Fleet API creds (`fleet_client_id`, `fleet_client_secret`) stored per account in `tesla_accounts`
   - DO droplet poller (`tesla-poller.service`) polls Fleet API every 5 min
   - Sleep-aware: doesn't wake sleeping cars, just records state
   - Client polls Supabase every 30s with visibility-based pause
   - Admin Settings tab for pasting refresh tokens per account
   - Data grid: battery, odometer, status, climate, location, tires, lock state
   - Lock/unlock + flash buttons on each car card via `tesla-command` edge function
   - Edge function handles wake-up (30s polling) before sending commands to sleeping cars
   - Staleness indicator shows time since last sync
21. **Camera Streaming via go2rtc** - Live HLS camera feeds on Cameras resident page
   - 3 UniFi G5 PTZ cameras restreamed via go2rtc on Alpaca Mac
   - go2rtc handles UniFi Protect's quirky RTSP (MediaMTX crashed on SPS parsing)
   - `rtspx://` protocol (RTSP over TLS control, no SRTP on media)
   - Caddy reverse proxy on DO droplet: `cam.alpacaplayhouse.com` → go2rtc:1984 via Tailscale
   - HLS fMP4 mode (`&mp4` parameter) required — without it, segments contain only audio
   - `camera_streams` DB table stores stream config, frontend constructs HLS URL dynamically
   - PTZ controls via UniFi Protect API (continuous move + preset goto)
   - Lightbox mode with camera navigation and quality switching
22. **LG Laundry Monitoring** - Live washer/dryer status on Laundry resident page
   - LG ThinQ Connect API with PAT auth from https://connect-pat.lgthinq.com/
   - Worker: `lg-poller` on DO droplet polls every 30s
   - Edge function: `lg-control` (status, control, watch/unwatch, push token registration)
   - Resident page: `residents/laundry.html` with progress bars, time remaining, "Notify When Done"
   - DB: `lg_config` (PAT), `lg_appliances` (cached state), `push_tokens` (FCM), `laundry_watchers`
   - Cycle completion detection: worker detects RUNNING→END transition, sends FCM push to watchers
   - QR codes on machines → deep link → auto-subscribe to notifications (Phase 5-6 pending)
   - Washer states: POWER_OFF, INITIAL, DETECTING, RUNNING, RINSING, SPINNING, DRYING, END, ERROR
   - Dryer states: POWER_OFF, INITIAL, RUNNING, PAUSE, END, ERROR
23. **Camera Two-Way Talkback Audio** - Push-to-talk on camera feeds via FFmpeg relay
   - `scripts/talkback-relay/talkback-relay.js` — WebSocket relay server on Alpaca Mac
   - Browser captures microphone (Web Audio API, 48kHz mono PCM)
   - FFmpeg transcodes PCM → AAC-ADTS 22.05kHz mono, streams UDP to camera:7004
   - WebSocket protocol on port 8902, health check on port 8903
   - 3 cameras supported: Alpacamera (.173), Front Of House (.182), Side Yard (.110)
   - Push-to-talk UI in both grid and lightbox views
   - LaunchAgent: `com.talkback-relay.plist` on Alpaca Mac
   - Requires FFmpeg installed on Alpaca Mac
24. **Vapi Voice Calling System** - AI phone assistant for property inquiries
   - Vapi handles phone calls → `vapi-server` edge function returns assistant config dynamically
   - Caller identification by phone number → personalized greeting
   - Dynamic prompt injection with current occupants, availability, caller name
   - Tool integration via PAI (smart home control, property Q&A)
   - `vapi-webhook` edge function logs call data (duration, cost, transcript)
   - Admin UI: `spaces/admin/voice.html` for managing assistants + viewing call logs
   - DB: `vapi_config`, `voice_assistants`, `voice_calls`
   - `send_link` tool: PAI can send clickable URLs via SMS instead of reading URLs aloud
25. **User Profile Page** - Self-service profile editor at `residents/profile.html`
   - Avatar upload, display name, first/last name, phone, email
   - Social links (Facebook, Instagram, LinkedIn, X)
   - Privacy controls: per-field visibility (public/residents/private)
   - Nationality + Location Base fields with flag emojis
   - Role + resident status badges
26. **Associate Hours Tracking** - Clock in/out system for property associates
   - Associate page: `associates/worktracking.html` (mobile-optimized)
   - Admin page: `spaces/admin/worktracking.html`
   - Clock in/out with GPS location, running timer, work photos (before/progress/after)
   - Manual entry with required justification (tracked for transparency)
   - Payment preferences: PayPal, Venmo, Zelle, Square, Cash, Check, Bank/ACH
   - Hourly rate per associate, space association
   - DB: `associate_profiles`, `time_entries`, `work_photos`
   - Service: `shared/hours-service.js`
27. **Identity Verification** - Driver's license verification via Claude Vision API
   - `verify-identity` edge function: photo → Claude Vision → extract name/DOB/DL#/address
   - Auto-compares to applicant or associate profile data
   - Auto-approves exact matches, flags mismatches for admin review
   - Tokenized secure upload links (expire after 7 days)
   - Storage: `identity-documents` bucket
   - Associates can self-initiate from Hours page Payment tab
   - DB: `upload_tokens`, `identity_verifications`
28. **PayPal Payouts** - Instant associate payments via PayPal
   - Edge functions: `paypal-payout` (send) + `paypal-webhook` (status updates)
   - OAuth client credentials flow for API auth
   - Sandbox + production mode support
   - DB: `paypal_config`, `payouts`
   - Linked to specific `time_entry_ids` for audit trail
   - Gate payouts on identity verification status
29. **Zelle Auto-Recording from Inbound Email** - Automatic payment detection
   - `resend-inbound-webhook` detects Zelle payment confirmation emails
   - Parses sender name, amount, date from email body
   - Auto-creates ledger entry for the payment
   - Fixes Zelle email address: `alpacaplayhouse@gmail.com` (not payments@)
30. **Airbnb iCal Sync** - Two-way calendar sync with Airbnb
   - `airbnb-sync` edge function: fetch Airbnb iCal → create blocking assignments
   - `ical` edge function: export assignments as iCal per space
   - `regenerate-ical`: regenerates on assignment changes
   - Parent/child space cascade: blocking parent blocks all children
   - 21 pre-configured space slugs
31. **Vehicle Management Overhaul** - Renamed `tesla_vehicles` → `vehicles` table
   - Added `owner_name`, `make` fields for non-Tesla vehicles
   - `vehicle_drivers` junction table (vehicles ↔ people)
   - Self-service Tesla OAuth connect/disconnect per vehicle
   - Vehicle visibility filtering by role
   - Vehicle registration email sent automatically after lease signing
32. **PAI Feature Builder** - Autonomous feature implementation from PAI chat
   - `feature-builder/feature_builder.js` on DO droplet
   - PAI can submit feature requests → worker polls DB → runs Claude Code
   - Git workflow: pull → feature branch → commit → merge to main with version bump
   - Systemd service: `feature-builder.service`
33. **Emergency Contacts Page** - `lost.html` for lockout scenarios
   - Phone numbers displayed reversed (obfuscation against scraping)
   - Clean card UI with Haydn, Rahulio, Sonia contacts
34. **Space Access Codes** - `access_code` text field on spaces table
   - Stores keypad/door codes for each space
35. **UP-SENSE Smart Sensors** - UniFi Protect sensor installation guide
   - `residents/sensorinstallation.html` — step-by-step installation instructions
36. **Mobile App (iOS & Android)** - Native mobile apps via Capacitor 8
   - App ID: `com.alpacaplayhouse.app`, Capacitor 8 wrapping mobile-first SPA
   - 5 tabs: Cameras, Music, Lights, Climate, Cars (bottom tab bar)
   - Dark theme, inline login (email/password + Google OAuth), no page redirects
   - `mobile/app/` — SPA source (index.html, mobile.css, mobile-app.js, tabs/)
   - `mobile/scripts/copy-web.js` — Build script: web assets → www/, inject capacitor.js
   - `shared/services/` — Data layer modules shared between web and mobile
   - Lazy-loaded tab modules via dynamic `import()` on first tab switch
   - `PollManager` class for visibility-based polling (pauses when backgrounded)
   - OTA updates via `@capgo/capacitor-updater` (no App Store resubmission for code changes)
   - Build: `cd mobile && npm run sync` → open in Xcode/Android Studio → Run
37. **Cloudflare R2 Object Storage** - File storage backend replacing Google Drive
   - Bucket `alpacapps` on Cloudflare (APAC region), public dev URL enabled
   - S3-compatible API with AWS Signature V4 authentication
   - Shared helper: `supabase/functions/_shared/r2-upload.ts` (`uploadToR2`, `deleteFromR2`, `getR2PublicUrl`)
   - DB: `r2_config` (credentials/config), `document_index` (file metadata for PAI lookup)
   - Files stored under `documents/` prefix (manuals, guides)
   - Supabase secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
   - Migrated 2 PDFs from Supabase Storage `instructions-and-manuals` bucket to R2
   - 10 GB free, zero egress fees, $0.015/GB-mo beyond free tier
38. **PAI Email Inbox** - `pai@alpacaplayhouse.com` processes inbound emails
   - Added `pai` to SPECIAL_PREFIXES and loop guard in `resend-inbound-webhook`
   - Gemini classifies emails: question, document, command, or other
   - Questions/commands: forwarded to `alpaca-pai` edge function, PAI reply sent via email
   - Documents: attachments downloaded from Resend, uploaded to R2 (`documents/email-uploads/`), indexed in `document_index` (inactive pending admin review), admin notified
   - Other: forwarded to admin
   - New templates: `pai_email_reply`, `pai_document_received` in send-email
   - New sender: `pai` in SENDER_MAP (`PAI <pai@alpacaplayhouse.com>`)
   - Loop guard prevents feedback loops (self-sent emails to pai@)

39. **Centralized Internal REST API** - Single permissioned edge function for all entity CRUD
   - `supabase/functions/api/index.ts` — main router with 20 resource handlers
   - `supabase/functions/_shared/api-permissions.ts` — permission matrix (5 levels: 0=public → 4=oracle)
   - `supabase/functions/_shared/api-helpers.ts` — auth resolution, response builders, query helpers
   - Endpoint: `POST /functions/v1/api` with `{ resource, action, id?, data?, filters? }`
   - Auth: Bearer JWT, service role key, or future X-API-Key
   - Resources: spaces, people, assignments, tasks, users, profile, vehicles, media, payments, bug_reports, time_entries, events, documents, sms, faq, invitations, password_vault, feature_requests, pai_config, tesla_accounts
   - Smart behaviors: fuzzy name/space resolution on tasks, auto-timestamps, duration computation, role-based vault filtering, rate limiting on feature requests
   - Row-level scoping: residents/associates only see own assignments, time entries, events
   - Soft deletes: spaces (is_archived), documents (is_active), vault (is_active), vehicles (is_active)
   - PAI `manage_data` tool: routes through the API for all data operations, replacing inline query patterns
   - Database schema context added to PAI system prompt
   - API usage logged to `api_usage_log` table
   - Full reference: `API.md`
40. **Brand Style Guide & Email Consistency** - Centralized brand configuration
   - `brand_config` DB table (singleton JSONB) stores all brand tokens: colors, fonts, logos, visual elements, email template specs
   - `shared/brand-config.js` — client-side loader with DB fetch + hardcoded fallback
   - `supabase/functions/_shared/email-brand-wrapper.ts` — branded email shell (header with logo+wordmark, consistent body, footer with address+tagline)
   - `spaces/admin/brand.html` + `brand.js` — visual style guide page showing all brand elements
   - All non-custom emails now wrapped in branded shell (header, footer, button styles, callout boxes)
   - Skip list: `custom`, `staff_invitation`, `pai_email_reply`, `payment_statement` (have their own layouts)
   - Brand page shows: identity, logos, color palette, typography, visual elements, email preview, raw JSON config
   - Colors: warm alpaca palette (cream `#faf9f6`, amber accent `#d4883a`, dark `#1c1618`)
   - Font: DM Sans (300-700 weights)
   - Logos: alpaca head icon + wordmark in dark/light variants (Supabase Storage)
41. **PAI Discord Bot** - Native Discord bot replacing OpenClaw paibot
   - Lightweight Node.js bot (`pai-discord/bot.js`) using discord.js v14
   - Bridges Discord messages → `alpaca-pai` edge function (same as web chat, email, voice)
   - Runs on DO droplet as `pai-discord.service` (systemd, bugfixer user)
   - Auth: service role key with `context.source: "discord"`, user lookup via `app_users.discord_id`
   - Features: per-user conversation history (12 msgs, 30 min TTL), typing indicators, message splitting (2000 char limit)
   - Listens to: configured channel IDs + DMs + @mentions
   - Replaces OpenClaw-based `paibot.service` which had no database/tool access
   - Fixed `alpaca-pai` edge function auth bug: Discord branch was unreachable (caught by email/API condition first)

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
