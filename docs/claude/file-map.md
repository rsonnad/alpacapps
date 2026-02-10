# File Map

> Reference file for Claude. Read on-demand to locate files in the codebase.

## Shared Modules (`/shared/`)
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
- `sms-service.js` - SMS sending via Telnyx (mirrors email-service.js pattern)
- `square-service.js` - Square payment processing (client-side tokenization)
- `hours-service.js` - Associate hours tracking (clock in/out, time entries)
- `identity-service.js` - Identity verification (upload tokens, DL verification)
- `payout-service.js` - PayPal payouts for associate payments
- `accounting-service.js` - Accounting/ledger service (Zelle auto-recording, payment tracking)
- `voice-service.js` - Vapi voice assistant configuration
- `pai-widget.js` - PAI floating chat widget (injected on all resident pages)
- `chat-widget.js` - Chat widget component
- `error-logger.js` - Client-side error capture and reporting
- `site-components.js` - Shared site UI components
- `version-info.js` - Version badge click handler
- `timezone.js` - Timezone utilities (Austin/Chicago)

## Shared Data Services (`/shared/services/`)
- `poll-manager.js` - Reusable polling class with visibility-based pause/resume
- `camera-data.js` - Camera stream config from `camera_streams` table
- `sonos-data.js` - Sonos zone state + control via `sonos-control` edge function
- `lighting-data.js` - Govee device groups + control via `govee-control` edge function
- `climate-data.js` - Nest thermostat state + control via `nest-control` edge function
- `cars-data.js` - Tesla vehicle data + commands via `tesla-command` edge function
- `laundry-data.js` - LG washer/dryer state + control via `lg-control` edge function

## Mobile App (`/mobile/`)
- `capacitor.config.ts` - App config (ID: `com.alpacaplayhouse.app`)
- `scripts/copy-web.js` - Build script: web assets -> www/, inject capacitor.js
- `app/index.html` - App shell (loading, login, tab sections, bottom nav)
- `app/mobile.css` - Dark theme stylesheet
- `app/mobile-app.js` - Orchestrator (auth, tabs, lazy loading)
- `app/tabs/cameras-tab.js` - HLS camera feeds
- `app/tabs/music-tab.js` - Sonos zones
- `app/tabs/lights-tab.js` - Govee groups
- `app/tabs/climate-tab.js` - Nest thermostats
- `app/tabs/cars-tab.js` - Tesla vehicles

## Consumer View (`/spaces/`)
- `app.js` - Public listing with real availability from assignments
- Shows only `is_listed=true AND is_secret=false` spaces

## Admin View (`/spaces/admin/`)
- `app.js` - Full admin dashboard
- `manage.html` - Management tabs (Spaces, Rentals, Media, Users, Settings)
- `media.js` - Media library with tagging and filtering
- `rentals.html` / `rentals.js` - Rental application pipeline (Kanban)
- `events.html` / `events.js` - Event hosting request pipeline
- `accounting.html` / `accounting.js` - Accounting/ledger dashboard
- `voice.html` / `voice.js` - Voice assistant config + call logs
- `faq.html` / `faq.js` - FAQ/AI configuration page
- `worktracking.html` / `worktracking.js` - Admin hours management
- `sms-messages.html` / `sms-messages.js` - SMS conversation viewer
- `templates.html` / `templates.js` - Lease/event template editor
- `settings.html` / `settings.js` - System settings
- `users.html` / `users.js` - User management + invitations

## Resident View (`/residents/`)
- `climate.html` / `thermostat.js` - Nest thermostats + weather forecast
- `lighting.html` / `lighting.js` - Govee lighting control
- `sonos.html` / `sonos.js` - Sonos music control
- `cameras.html` / `cameras.js` - Camera feeds + talkback audio
- `laundry.html` / `laundry.js` - LG washer/dryer monitoring
- `cars.html` / `cars.js` - Vehicle info + Tesla commands
- `profile.html` / `profile.js` - User profile (avatar, bio, social, privacy)
- `sensorinstallation.html` - UP-SENSE smart sensor guide
- `residents.css` - Shared CSS for resident pages

## Associate View (`/associates/`)
- `worktracking.html` / `worktracking.js` - Clock in/out, timesheets, work photos, payment prefs

## Other Documentation
- `architecture.md` - Full system documentation
- `API.md` - REST API reference for Supabase
- `SKILL.md` - OpenClaw bot integration guide
- `HOMEAUTOMATION.md` - Home automation system (Sonos, UniFi, cameras)
