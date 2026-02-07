# CLAUDE.md - GenAlpaca Project Context

This file provides context for Claude (AI assistant) when working on this codebase.

> **See `CLAUDE.local.md` for credentials, connection strings, and environment-specific configuration.**
> That file is gitignored and contains operator directives, database access details, API keys, and deployment-specific settings.

## Project Overview

GenAlpaca is a property management system for GenAlpaca Residency. It manages rental spaces, tenants, bookings, payments, and photos.

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (no framework)
- Backend: Supabase (PostgreSQL + Storage + Auth)
- Hosting: GitHub Pages (static site)
- Bot: OpenClaw Discord bot (separate DigitalOcean droplet)

## Architecture

```
Browser → GitHub Pages (static HTML/JS) → Supabase (database + storage)
                                       ↗
Discord → OpenClaw Bot (DO Droplet) ──┘
```

No server-side code - all logic runs client-side. Supabase handles data persistence.

## Key Files

### Shared Modules (`/shared/`)
- `supabase.js` - Supabase client singleton (anon key embedded)
- `auth.js` - Authentication module for admin access
- `media-service.js` - Media upload, compression, tagging service
- `rental-service.js` - Rental application workflow management
- `lease-template-service.js` - Lease template parsing and placeholder substitution
- `pdf-service.js` - PDF generation from markdown using jsPDF
- `signwell-service.js` - SignWell e-signature API integration
- `sms-service.js` - SMS sending via Telnyx (mirrors email-service.js pattern)

### Consumer View (`/spaces/`)
- `app.js` - Public listing with real availability from assignments
- Shows only `is_listed=true AND is_secret=false` spaces
- Sorts: available first → highest price → name
- Loads assignment dates (no personal info) for availability display

### Admin View (`/spaces/admin/`)
- `app.js` - Full admin dashboard with all spaces
- `manage.html` - Management tabs (Spaces, Rentals, Media, Users, Settings)
- `media.js` - Media library with tagging and filtering
- Shows occupant info, visibility controls, edit capabilities

### Resident View (`/residents/`)
- `climate.html` / `thermostat.js` - Climate page: Nest thermostats + 48-hour weather forecast
- `playhomeauto.html` / `playhomeauto.js` - Govee lighting control
- `sonos.html` / `sonos.js` - Sonos music control
- `cameras.html` / `cameras.js` - Camera feeds
- `cars.html` / `cars.js` - Vehicle info
- `residents.css` - Shared CSS for all resident pages

### Supabase Edge Functions (`/supabase/functions/`)
- `signwell-webhook/` - Receives SignWell webhook when documents are signed
- `send-sms/` - Outbound SMS via Telnyx API
- `telnyx-webhook/` - Receives inbound SMS from Telnyx
- `send-email/` - Outbound email via Resend API (43 templates)
- `resend-inbound-webhook/` - Receives inbound email via Resend webhook, routes/forwards
- `govee-control/` - Proxies requests to Govee Cloud API (staff+ auth)
- `sonos-control/` - Proxies requests to Sonos HTTP API via Alpaca Mac (resident+ auth)
- `nest-control/` - Proxies requests to Google SDM API with OAuth token management (resident+ auth)

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

```bash
# Make changes, commit, and push
git add <files>
git commit -m "Description"
git push
# Changes are live in 1-2 minutes
# Hard refresh browser (Cmd+Shift+R) to see changes
```

## Important Conventions

1. **Use `media_spaces` not `photo_spaces`** - The old photo system is deprecated
2. **Filter archived spaces** - Always add `.filter(s => !s.is_archived)` client-side
3. **Don't expose personal info in consumer view** - Load assignment dates only, not person details
4. **Toast notifications in admin** - Use `showToast(message, type)` not `alert()`
5. **Lightbox for images** - Use `openLightbox(url)` for full-size image viewing

## Supabase Details

- Anon key is in `shared/supabase.js` (safe to expose, RLS protects data)
- Storage buckets:
  - `housephotos` - Media/photos
  - `lease-documents` - Generated and signed lease PDFs

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
| Everything else | Forward | `alpacaplayhouse@gmail.com` |

### Telnyx (SMS)
- Config stored in `telnyx_config` table (api_key, messaging_profile_id, phone_number, test_mode)
- Outbound: `send-sms` Edge Function calls Telnyx Messages API
- Inbound: `telnyx-webhook` Edge Function receives SMS, stores in `sms_messages` table
- Client service: `shared/sms-service.js` (mirrors email-service.js pattern)
- Admin UI: Settings tab has test mode toggle, compose SMS, bulk SMS, inbound SMS view

### DigitalOcean Droplet
- Runs OpenClaw Discord bot and bug fixer worker
- Bug fixer repo is a clone of this repo, used for verification screenshots
- Uses `SKILL.md` for API knowledge
- Queries Supabase directly for tenant/space info

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

### Google Drive
- Rental agreements stored in a shared folder
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
   - Tailscale mesh VPN connects DO droplet to Alpaca Mac
   - UniFi Network API for firewall/DHCP/WiFi management
   - `HOMEAUTOMATION.md` for full documentation
16. **Govee Lighting Integration** - 63 Govee/AiDot smart lights backed up in Supabase
   - `govee_config` table stores API key, test mode toggle (single row, id=1)
   - `govee_devices` table stores all 63 devices with name, SKU, area, type
   - `govee_devices.parent_group_id` links individual devices to their parent group
   - `govee_devices.display_order` controls group sort order in UI
   - `govee_models` table maps SKU → friendly model name (e.g., H601F → "Recessed Lights Pro")
   - Cloud API base: `https://openapi.api.govee.com/router/api/v1/`
   - `govee_devices.space_id` links devices to spaces table for hierarchy-based UI grouping
   - Lighting page (`residents/playhomeauto.html`) loads groups dynamically from DB
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

## Testing Changes

1. Check both card view and table view in consumer and admin views
2. Test on mobile (responsive breakpoint at 768px)
3. Verify availability badges show correct dates

## Helpful Documentation

- `architecture.md` - Full system documentation
- `API.md` - REST API reference for Supabase
- `SKILL.md` - OpenClaw bot integration guide
- `HOMEAUTOMATION.md` - Home automation system (Sonos, UniFi, cameras)
