# GenAlpaca System Architecture

Comprehensive documentation for the GenAlpaca property management system.

## Overview

GenAlpaca manages rental spaces at GenAlpaca Residency (160 Still Forest Drive, Cedar Creek, TX). The system tracks spaces, tenants, bookings, payments, and photos.

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS                                   │
│                           │                                     │
│              ┌────────────┼────────────┐                        │
│              ▼            ▼            ▼                        │
│         Browser       Discord      Mobile                       │
│              │            │            │                        │
└──────────────┼────────────┼────────────┼────────────────────────┘
               │            │            │
               ▼            ▼            │
┌──────────────────┐  ┌──────────────┐   │
│  GitHub Pages    │  │  OpenClaw    │   │
│  (Admin UI)      │  │  (Discord)   │   │
│                  │  │              │   │
│  HTML/CSS/JS     │  │  DO Droplet  │   │
│  No backend      │  │              │   │
└────────┬─────────┘  └──────┬───────┘   │
         │                   │           │
         └─────────┬─────────┘           │
                   ▼                     ▼
         ┌─────────────────────────────────┐
         │           SUPABASE              │
         │                                 │
         │  ┌───────────┐ ┌─────────────┐  │
         │  │ PostgreSQL│ │   Storage   │  │
         │  │ Database  │ │ (housephotos)│  │
         │  └───────────┘ └─────────────┘  │
         │                                 │
         │  Project: aphrrfprbixmhissnjfn  │
         └─────────────────────────────────┘
```

## Hosting Locations

| Component | Host | URL/Location |
|-----------|------|--------------|
| Admin UI | GitHub Pages | https://alpacaplayhouse.com/ |
| Source Code | GitHub | https://github.com/rsonnad/alpacapps |
| Database | Supabase | https://aphrrfprbixmhissnjfn.supabase.co |
| Photo Storage | Supabase Storage | bucket: `housephotos` |
| Lease Documents | Supabase Storage | bucket: `lease-documents` |
| OpenClaw Bot | DigitalOcean | Droplet (separate system) |
| E-Signatures | SignWell | API: signwell.com/api |
| Payments | Square | API: connect.squareup.com |
| Email Delivery | Resend | API key stored in Supabase secrets |
| SMS Notifications | Telnyx | Phone: +17377474737, config in `telnyx_config` table |
| Error Monitoring | Custom | Daily digest emails via Resend |
| Rental Agreements | Google Drive | Folder ID: 1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ (legacy) |

## Repository Structure

```
alpacapps/
├── index.html              # Landing page (redirects to spaces)
├── styles.css              # Global styling
├── app.js                  # Legacy (redirects)
├── 404.html                # GitHub Pages 404 handler
│
├── shared/                 # Shared modules
│   ├── supabase.js         # Supabase client singleton
│   ├── auth.js             # Authentication module
│   ├── media-service.js    # Media upload/management service
│   ├── rental-service.js   # Rental application workflow
│   ├── event-service.js    # Event hosting request workflow
│   ├── lease-template-service.js  # Lease template parsing
│   ├── event-template-service.js  # Event agreement template parsing
│   ├── pdf-service.js      # PDF generation (jsPDF)
│   ├── signwell-service.js # SignWell e-signature API
│   ├── square-service.js   # Square payment processing (client-side)
│   ├── email-service.js    # Email sending via Resend
│   ├── sms-service.js      # SMS sending via Telnyx
│   └── error-logger.js     # Client-side error capture and reporting
│
├── supabase/               # Supabase Edge Functions
│   └── functions/
│       ├── signwell-webhook/  # E-signature completion webhook
│       │   └── index.ts
│       ├── event-payment-reminder/  # Daily cron: 10-day payment reminders
│       │   └── index.ts
│       ├── process-square-payment/  # Square payment processing (server-side)
│       │   └── index.ts
│       ├── record-payment/    # Smart payment recording with AI matching
│       │   ├── index.ts           # Main handler
│       │   ├── payment-parser.ts  # Bank string parsing
│       │   ├── tenant-matcher.ts  # Matching logic (cache → exact → AI)
│       │   └── gemini-client.ts   # Google Gemini API integration
│       ├── resolve-payment/   # Manual payment resolution
│       │   └── index.ts
│       ├── error-report/      # Error logging and daily digest emails
│       │   └── index.ts
│       ├── send-email/        # Generic email sending
│       │   └── index.ts
│       ├── send-sms/          # Outbound SMS via Telnyx
│       │   └── index.ts
│       ├── telnyx-webhook/    # Inbound SMS receiver
│       │   └── index.ts
│       └── contact-form/      # Contact form submission handler
│           └── index.ts
│
├── login/                  # Login page
│   ├── index.html
│   └── app.js
│
├── spaces/                 # Consumer-facing spaces view
│   ├── index.html
│   ├── app.js              # Public space listing (filtered)
│   │
│   ├── apply/              # Rental application form
│   │   └── index.html      # Multi-section form with Square payment
│   │
│   └── events/             # Event hosting request form
│       └── index.html      # Event form with policies & acknowledgments
│
└── spaces/admin/           # Admin dashboard
    ├── index.html          # Admin spaces view
    ├── app.js              # Admin spaces logic
    ├── manage.html         # Management dashboard (tabs)
    ├── media.html          # Media library page
    ├── media.js            # Media library logic
    ├── users.html          # User management
    └── users.js            # User management logic
```

## Database Schema

### Core Tables

**spaces** - Rental units and event spaces
- `id` (uuid, PK)
- `name`, `description`, `location`
- `type` (free-form text: "Dwelling", "Amenity", "Event", etc.)
- `monthly_rate`, `weekly_rate`, `nightly_rate`
- `sq_footage`, `bath_privacy` (private/shared), `bath_fixture`
- `beds_king`, `beds_queen`, `beds_double`, `beds_twin`, `beds_folding`
- `min_residents`, `max_residents`, `gender_restriction`
- `is_listed`, `is_secret`, `can_be_dwelling`, `can_be_event`, `is_archived`
- `parent_id` (self-reference for nested spaces)

**people** - Tenants, staff, guests
- `id` (uuid, PK)
- `first_name`, `last_name` (nullable)
- `type` (tenant, staff, airbnb_guest, house_guest)
- `email`, `phone`, `forwarding_address`

**assignments** - Bookings and leases
- `id` (uuid, PK)
- `person_id` (FK → people)
- `type` (dwelling, event)
- `status` (active, completed, cancelled, pending_contract, contract_sent)
- `start_date`, `end_date`
- `desired_departure_date` (early exit: when tenant wants to leave)
- `desired_departure_listed` (boolean: when true, early exit date affects consumer availability)
- `rate_amount`, `rate_term` (monthly, weekly, nightly, flat)
- `deposit_amount`, `is_free`

**assignment_spaces** - Junction: assignments ↔ spaces
- `assignment_id` (FK), `space_id` (FK)

### Media System (New)

The system has migrated from the legacy `photos` table to a unified `media` system with tagging support.

**media** - All media assets (images, videos, documents)
- `id` (uuid, PK)
- `url` (Supabase storage URL)
- `storage_path` (path in storage bucket)
- `mime_type`, `file_size`
- `width`, `height` (for images)
- `title`, `caption`
- `category` (mktg, projects, archive)
- `uploaded_by`, `created_at`, `updated_at`

**media_spaces** - Junction: media ↔ spaces
- `media_id` (FK), `space_id` (FK)
- `display_order` (integer for ordering)
- `is_primary` (boolean, primary image for space)

**media_tags** - Tag definitions
- `id` (uuid, PK)
- `name` (unique tag name)
- `color` (hex color for display)

**media_tag_assignments** - Junction: media ↔ tags
- `media_id` (FK), `tag_id` (FK)

### Legacy Photo System (Deprecated)

**photos** - Photo metadata (legacy, still used by consumer view)
- `id` (uuid, PK)
- `url` (Supabase storage URL)
- `caption`, `uploaded_by`

**photo_spaces** - Junction: photos ↔ spaces (legacy)
- `photo_id` (FK), `space_id` (FK)

**photo_requests** - Pending photo requests
- `id` (uuid, PK)
- `space_id` (FK)
- `description`, `status` (pending, submitted, approved, rejected)
- `requested_by`, `requested_at`
- `submitted_photo_url`, `submitted_by`, `submitted_at`
- `reviewed_at`, `rejection_reason`
- `fulfilled_by_photo_id` (FK → photos)

### Lease Agreement System

**lease_templates** - Markdown templates with placeholders
- `id` (uuid, PK)
- `name` - Template name
- `content` - Markdown with `{{placeholder}}` syntax
- `version` - Version number (auto-incremented)
- `is_active` - Only one template active at a time
- `created_at`, `updated_at`, `created_by`

**signwell_config** - SignWell API configuration (single row)
- `id` (integer, always 1)
- `api_key` - SignWell API key
- `webhook_secret` - For webhook verification
- `test_mode` - Boolean for test vs production

**rental_applications** - Full application tracking
- `id` (uuid, PK)
- `person_id` (FK → people)
- `application_status` - submitted, approved, denied, delayed, withdrawn
- `agreement_status` - pending, generated, sent, signed
- `deposit_status` - pending, requested, partial, received, confirmed

Application details:
- `desired_space_id`, `desired_move_in`, `desired_term`
- `application_fee_paid`, `application_fee_amount`, `application_fee_code`

Approved terms:
- `approved_space_id`, `approved_rate`, `approved_rate_term`
- `approved_move_in`, `approved_lease_end`
- `notice_period` - none, 1_day, 1_week, 30_days, 60_days
- `security_deposit_amount`
- `reservation_deposit_amount` - Due after lease signing, credited to first month
- `move_in_deposit_amount` - Always equal to one period's rent
- `additional_terms`

Lease documents:
- `generated_pdf_url` - Supabase storage URL of generated lease
- `signwell_document_id` - SignWell document tracking ID
- `signed_pdf_url` - URL of signed lease after e-signature
- `agreement_signed_at` - Timestamp when both parties signed

Deposit tracking:
- `reservation_deposit_paid`, `reservation_deposit_paid_at`, `reservation_deposit_method`
- `move_in_deposit_paid`, `move_in_deposit_paid_at`, `move_in_deposit_method`
- `security_deposit_paid`, `security_deposit_paid_at`, `security_deposit_method`

**event_hosting_requests** - Event booking applications
- `id` (uuid, PK)
- `person_id` (FK → people)
- `request_status` - submitted, under_review, approved, denied, delayed, withdrawn
- `agreement_status` - pending, generated, sent, signed
- `deposit_status` - pending, requested, partial, received, confirmed

Event details:
- `event_name`, `event_description`, `event_type`
- `event_date`, `event_start_time`, `event_end_time`
- `expected_guests`, `is_ticketed`, `ticket_price_range`
- `organization_name`, `has_hosted_before`

Staffing contacts:
- `setup_staff_name`, `setup_staff_phone`
- `cleanup_staff_name`, `cleanup_staff_phone`
- `parking_manager_name`, `parking_manager_phone`

Fees:
- `rental_fee` - Default $295, due 7 days before event
- `reservation_fee` - Default $95, collected at application time via Square, refundable
- `cleaning_deposit` - Default $195, due 7 days before event, refundable
- `{fee}_paid`, `{fee}_paid_at`, `{fee}_method` for each
- `payment_reminder_sent_at` - Timestamp when 10-day payment reminder email was sent

Lease documents (same as rental):
- `agreement_document_url`, `signwell_document_id`, `signed_pdf_url`, `agreement_signed_at`

Acknowledgments (boolean flags for each policy):
- `ack_no_address_posting`, `ack_parking_management`, `ack_noise_curfew`
- `ack_no_alcohol_inside`, `ack_no_meat_inside`, `ack_no_rvs`
- `ack_no_animals_inside`, `ack_cleaning_responsibility`
- `ack_linens_furniture`, `ack_propane_reimbursement`

**event_request_spaces** - Junction: event requests ↔ spaces
- `event_request_id` (FK), `space_id` (FK)
- `space_type` - requested, approved, excluded

**payment_methods** - Available payment options
- `id` (uuid, PK)
- `name` - Display name (Venmo, Zelle, PayPal, Bank Transfer)
- `method_type` - venmo, zelle, paypal, bank_ach
- `account_identifier` - @username, email, phone
- `instructions` - Custom instructions for tenants
- `display_order`, `is_active`

### Square Payment System

**square_config** - Square API configuration (single row)
- `id` (integer, always 1)
- `application_id` - Square application ID
- `access_token` - Square API access token
- `location_id` - Square business location ID
- `environment` - 'sandbox' or 'production'
- `is_active` - Whether Square payments are enabled

**fee_settings** - Configurable default fees
- `id` (uuid, PK)
- `fee_type` - 'rental_application', 'event_cleaning_deposit', 'event_reservation_deposit'
- `default_amount` - Default fee amount in dollars
- `description` - Admin description
- `is_active` - Whether this fee type is enabled

**fee_codes** - Discount/promo codes that set specific prices
- `id` (uuid, PK)
- `code` - The code string (e.g., "FRIEND50")
- `fee_type` - Which fee this code applies to (FK → fee_settings.fee_type)
- `price` - The actual price when this code is used (0 = free)
- `description` - Internal note for admin
- `usage_limit` - Max uses (null = unlimited)
- `times_used` - Current usage count
- `expires_at` - Expiration timestamp (null = never)
- `is_active` - Whether code can be used

**square_payments** - Record of all Square transactions
- `id` (uuid, PK)
- `payment_type` - 'rental_application', 'event_deposit'
- `reference_type` - 'rental_application', 'event_hosting_request'
- `reference_id` - UUID of the related application/request
- `square_payment_id` - Square's payment ID
- `square_order_id` - Square's order ID
- `amount` - Amount charged
- `fee_code_used` - Code used (if any)
- `original_amount` - Original fee before code
- `status` - 'pending', 'completed', 'failed', 'refunded'
- `receipt_url` - Square receipt URL
- `created_at`

### Telnyx SMS System

**telnyx_config** - Telnyx API configuration (single row)
- `id` (integer, always 1)
- `api_key` - Telnyx API Key v2 (Bearer token for `Authorization: Bearer <key>`)
- `messaging_profile_id` - Telnyx Messaging Profile ID (numbers must be assigned to a profile)
- `phone_number` - Telnyx phone number in E.164 format (+17377474737)
- `public_key` - Ed25519 public key for webhook signature verification (Base64-encoded)
- `is_active` - Whether SMS sending is enabled
- `test_mode` - When true, messages are logged but not sent via Telnyx

**sms_messages** - Log of all SMS messages sent and received
- `id` (uuid, PK)
- `person_id` (FK → people, nullable) - Linked tenant/person
- `direction` - 'outbound' or 'inbound'
- `from_number`, `to_number` - E.164 phone numbers
- `body` - Message text content
- `sms_type` - Template type: payment_reminder, deposit_requested, general, bulk_announcement, inbound, etc.
- `telnyx_id` - Telnyx Message ID for tracking
- `status` - queued, sent, delivered, failed, received, test
- `error_code`, `error_message` - For failed messages
- `num_media` - Number of media attachments (inbound MMS)
- `media_urls` (jsonb) - Array of media URLs (inbound MMS)
- `created_at`, `updated_at`

### Supporting Tables

**amenities** - Available amenities (A/C, HiFi Sound, etc.)
- `id` (uuid, PK), `name`, `description`

**space_amenities** - Junction: spaces ↔ amenities
- `space_id` (FK), `amenity_id` (FK)

**payments** - Rent payments
- `id` (uuid, PK)
- `assignment_id` (FK)
- `amount`, `payment_date`, `payment_method`
- `period_start`, `period_end`, `notes`

### Payment Processing System (AI-Assisted)

**payment_sender_mappings** - Cached sender name → tenant mappings (for auto-matching)
- `id` (uuid, PK)
- `sender_name` - Original name (e.g., "KYMBERLY DELIOU")
- `sender_name_normalized` - Lowercase, trimmed (unique)
- `person_id` (FK → people)
- `confidence_score` - 0.00-1.00, from AI matching
- `match_source` - 'gemini', 'manual', 'exact'
- `created_at`, `updated_at`

**payment_processing_log** - Audit trail for all payment processing
- `id` (uuid, PK)
- `raw_payment_string` - Original bank transaction text
- `sender_name`, `parsed_amount`, `parsed_date`, `parsed_method`
- `matched_person_id` (FK), `matched_assignment_id` (FK)
- `match_method` - 'cached', 'gemini', 'exact', 'failed'
- `gemini_response` (JSONB) - Full AI response for debugging
- `payment_id` (FK → payments) - If payment was created
- `status` - 'success', 'pending_review', 'failed'
- `error_message`, `created_at`

**pending_payments** - Queue for payments needing manual review
- `id` (uuid, PK)
- `raw_payment_string`, `sender_name`
- `parsed_amount`, `parsed_date`, `parsed_method`
- `gemini_suggestions` (JSONB) - Array of {person_id, confidence, reasoning}
- `processing_log_id` (FK)
- `resolved_at`, `resolved_by`, `resolution` ('matched', 'ignored')
- `created_at`

## Authentication & Security

### API Keys

**Supabase Anon Key** (safe to expose in frontend):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk
```

This key is embedded in `app.js` and `SKILL.md`. It's protected by Row Level Security (RLS).

### Row Level Security Policies

All tables have RLS enabled with public read access:
```sql
create policy "Public read access" on {table} for select using (true);
```

Storage bucket `housephotos` has public read/write:
```sql
create policy "Allow public uploads" on storage.objects for insert with check (bucket_id = 'housephotos');
create policy "Allow public reads" on storage.objects for select using (bucket_id = 'housephotos');
create policy "Allow public deletes" on storage.objects for delete using (bucket_id = 'housephotos');
```

### Media Upload Pipeline

Images are processed client-side before upload via `shared/media-service.js`:
1. **Validation**: Check file type and size limits
2. **Compression**: Images > 500KB are compressed (max 1920x1920, 85% quality)
3. **Upload**: Stored in Supabase Storage with path `{category}/{timestamp}-{randomId}.{ext}`
4. **Metadata**: Dimensions extracted and stored in `media` table
5. **Linking**: Associated with spaces via `media_spaces` junction table

### Access Control (Application Level)

The UI has two modes controlled by JavaScript:
- **Consumer mode**: Shows only `is_listed = true AND is_secret = false` spaces
- **Admin mode**: Shows all spaces, occupancy details, upload features

This is UI-level only, not enforced at database level. For true security, implement Supabase Auth.

## Current Spaces

| Space | Location | Rate | Status |
|-------|----------|------|--------|
| Skyloft | The House | $1,600/mo | Occupied until Mar 3 |
| Master Pasture Suite | The House | $1,395/mo | Occupied |
| Pequneo Largo Suite | The House | $1,095/mo | Occupied |
| Fuego Trailer | Front Yard | $875/mo | Occupied |
| Big Room (Spartan) | Front Yard | $695/mo | Available |
| Little Room (Spartan) | Front Yard | $595/mo | Occupied |
| Magic Bus | Front Yard | $600/mo | Occupied until Mar 4 |
| Cabin East | Back Pasture | $500/mo | Available |
| Cabin West | Back Pasture | $500/mo | Available |
| Odyssey Static Van | Front Yard | $350/mo | Available |
| Skyloft Beds 1-5 | The House | $300/mo each | Part of Skyloft |

## Key Workflows

### Consumer Views Available Space
1. Browser loads GitHub Pages
2. JS fetches spaces from Supabase
3. Filters to `is_listed=true, is_secret=false`
4. Shows availability based on assignment end dates

### Admin Uploads Media
1. Navigate to admin view or Media Library
2. Click "Add images" or upload button
3. Select file(s), add caption/tags
4. Client compresses image if > 500KB
5. Uploads to Supabase Storage (`housephotos` bucket)
6. Creates record in `media` table with dimensions
7. Links to space via `media_spaces` junction
8. Supports drag-and-drop reordering of photos

### OpenClaw Answers "Who lives in Skyloft?"
1. Discord user asks question
2. OpenClaw uses SKILL.md for API reference
3. Queries: `GET /rest/v1/spaces?name=ilike.*Skyloft*`
4. Gets space_id, queries assignments
5. Returns tenant info

### New Booking Created
1. Add person to `people` table
2. Create assignment with dates, rate
3. Link via `assignment_spaces`
4. UI automatically shows updated availability

## Deployment

### Making UI Changes
```bash
cd ~/Downloads/genalpaca-admin
# edit files
git add .
git commit -m "Description"
git push
# Wait 1-2 min, hard refresh browser
```

### Database Changes
1. Go to Supabase Dashboard → SQL Editor
2. Run migrations
3. UI reflects changes immediately (no redeploy needed)

### Adding New Spaces
```sql
insert into spaces (name, monthly_rate, can_be_dwelling, is_listed, ...)
values ('New Space', 500, true, true, ...);
```

## External Integrations

### SignWell (E-Signatures)
- API: `https://www.signwell.com/api/v1`
- Account: wingsiebird@gmail.com
- API key stored in `signwell_config` table
- Webhook: Supabase Edge Function at `/functions/v1/signwell-webhook`

**Lease Generation Workflow:**
1. Admin opens rental application → Documents tab
2. Click "Preview Agreement" to see populated template
3. Click "Generate PDF" → jsPDF creates PDF → uploads to `lease-documents` bucket
4. Click "Send for Signature" → SignWell API creates document, emails tenant
5. Tenant signs in SignWell
6. SignWell webhook → downloads signed PDF → stores in Supabase → updates status

**Lease Template Placeholders:**
- Tenant: `{{tenant_name}}`, `{{tenant_email}}`, `{{tenant_phone}}`
- Dates: `{{signing_date}}`, `{{lease_start_date}}`, `{{lease_end_date}}`
- Space: `{{dwelling_description}}`, `{{dwelling_location}}`
- Rates: `{{rate}}`, `{{rate_term}}`, `{{rate_display}}`
- Deposits: `{{security_deposit}}`, `{{move_in_deposit}}`, `{{reservation_deposit}}`
- Credits: `{{application_fee_paid}}`, `{{application_fee_credit}}`
- Credits: `{{reservation_deposit_credit}}`, `{{total_credits}}`, `{{first_month_due}}`
- Terms: `{{notice_period}}`, `{{notice_period_display}}`, `{{additional_terms}}`

**Credit Calculation:**
When generating lease agreements, the system calculates credits toward first month's rent:
- Application fee (if paid) is credited
- Reservation deposit (paid after signing) is credited
- `{{first_month_due}}` = Monthly rate - Application fee - Reservation deposit

### Square (Payment Processing)
- API: `https://connect.squareup.com/v2` (production) or `https://connect.squareupsandbox.com/v2` (sandbox)
- Configuration stored in `square_config` table (not hardcoded)
- Client-side: Uses Square Web Payments SDK for card tokenization
- Server-side: Edge Function `process-square-payment` creates actual charges

**Payment Flows:**

1. **Rental Application Fee** (`/spaces/apply/`):
   - Default fee set in `fee_settings` table (e.g., $35)
   - Applicant can enter discount code to reduce or waive fee
   - Fee codes set actual prices (code with $0 = free)
   - Square card form appears if fee > $0
   - Payment processed during form submission
   - Fee credited toward first month's rent (shown in lease agreement)

2. **Event Deposits** (`/spaces/events/`):
   - Two deposit types: Cleaning Deposit + Reservation Deposit
   - Each has separate default amounts and codes
   - Combined total shown to user
   - Single Square payment for both deposits
   - Reservation deposit credited toward rental fee (shown in agreement)

**Fee Code System:**
- Codes are NOT discounts but actual price setters
- Code with price $0 = completely waives the fee
- Code with price $20 = charges $20 regardless of default
- Admin configures codes in Settings → Fee Codes
- Codes can have usage limits and expiration dates

**Client-Side Flow:**
1. `square-service.js` loads Square Web Payments SDK
2. Creates card payment form element
3. On submit, tokenizes card (never sends raw card data)
4. Sends token to `process-square-payment` Edge Function
5. Edge Function creates payment via Square API
6. Returns payment ID, receipt URL on success

**Server-Side Edge Function:**
```typescript
// process-square-payment/index.ts
// - Reads Square config from database
// - Validates payment request
// - Creates payment via Square Payments API
// - Records transaction in square_payments table
```

### Google Drive (Legacy)
- Rental agreements previously stored in Drive
- Folder: `1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ`
- Now superseded by Supabase storage + SignWell

### OpenClaw (Discord Bot)
- Separate system on DigitalOcean
- Uses SKILL.md for API knowledge
- Can query/update Supabase directly
- Sends bank transaction text to `record-payment` Edge Function for AI-matched payment recording

### Google Gemini (AI Matching)
- Used by `record-payment` Edge Function
- Matches payment sender names to tenants using fuzzy matching
- Considers name variations, typos, and payment amounts
- API key stored as Supabase secret: `GEMINI_API_KEY`
- Model: `gemini-1.5-flash` (low temperature for consistency)

### Media Library
- Centralized media management at `/spaces/admin/manage.html`
- Supports tagging, filtering, and bulk operations
- Images stored in Supabase Storage with automatic compression

### Resend (Email Delivery)
- API: `https://api.resend.com`
- API key stored as Supabase secret: `RESEND_API_KEY`
- Used for:
  - Error digest emails (daily summary of client-side errors)
  - Contact form submissions
  - General email notifications
- From address: `errors@genalpaca.com` (for error digests)

### Telnyx (SMS Notifications)
- **Portal**: https://portal.telnyx.com (account: wingsiebird@gmail.com)
- **API Base**: `https://api.telnyx.com/v2/messages`
- **Auth**: Bearer token — `Authorization: Bearer <api_key>` (NOT Basic auth like Twilio)
- **Phone Number**: +17377474737
- **Messaging Profile ID**: `40019c2b-034b-4d3f-9eae-e00a13122927`
- **API Key**: Stored in `telnyx_config.api_key` (generated in Telnyx Portal > API Keys)
- **Public Key**: Stored in `telnyx_config.public_key` (from Telnyx Portal > API Keys > Public Key)
- **Webhook URL**: `https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/telnyx-webhook`

**10DLC Requirement (IMPORTANT):**
US long code numbers require 10DLC registration to send/receive SMS. Without it, messages won't deliver and webhooks won't fire. Register in Telnyx Portal > Messaging > Compliance:
1. Create a **Brand** (Sole Proprietor is simplest)
2. Create a **Campaign** (use case: property management notifications)
3. Assign phone number +17377474737 to the campaign
4. Wait for approval before testing

**Telnyx API Reference:**

Outbound request format:
```
POST https://api.telnyx.com/v2/messages
Headers: Authorization: Bearer <api_key>, Content-Type: application/json
Body: { "from": "+17377474737", "to": "+1XXXXXXXXXX", "text": "message", "type": "SMS", "messaging_profile_id": "40019c2b-..." }
Response: { "data": { "id": "msg-uuid", "to": [{"status": "queued"}], ... } }
```

Inbound webhook format (JSON POST, NOT form-encoded like Twilio):
```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "msg-uuid",
      "from": { "phone_number": "+1XXXXXXXXXX", "carrier": "...", "line_type": "..." },
      "to": [{ "phone_number": "+17377474737" }],
      "text": "message body",
      "media": [],
      "type": "SMS"
    }
  }
}
```

Webhook signature verification (Ed25519):
- Headers: `telnyx-signature-ed25519` (Base64 signature), `telnyx-timestamp` (Unix timestamp)
- Signed payload: `${timestamp}|${rawBody}`
- Verify using Ed25519 with public key from `telnyx_config.public_key`
- Currently disabled in deployed function pending 10DLC approval and testing

**Key differences from Twilio (for future provider swaps):**
- Auth: Bearer token (Twilio uses Basic auth with AccountSID:AuthToken)
- Outbound: JSON body (Twilio uses form-encoded)
- Inbound: JSON webhook (Twilio uses form-encoded + expects TwiML XML response)
- Concept: Messaging Profile — numbers must be assigned to a profile that has the webhook URL
- Edge function deployed with `--no-verify-jwt` (Telnyx can't send Supabase JWT)

**Outbound SMS Flow:**
1. Admin triggers notification (pipeline action, manual compose, or bulk)
2. Client-side `sms-service.js` calls `send-sms` Edge Function
3. Edge Function reads Telnyx config from `telnyx_config` table
4. If `test_mode=true`: logs message to `sms_messages` with status `test`, skips Telnyx API
5. Otherwise: calls Telnyx Messages API with Bearer token auth
6. Logs message to `sms_messages` table with Telnyx message ID and status
7. Returns `{success, id}` to client

**Inbound SMS Flow:**
1. Tenant sends SMS to +17377474737
2. Telnyx forwards to `telnyx-webhook` Edge Function (JSON POST)
3. Edge Function parses `data.payload.from.phone_number`, `data.payload.text`, `data.payload.id`, media
4. Looks up sender phone number in `people` table (last 10 digits comparison)
5. Stores message in `sms_messages` with `direction='inbound'`
6. Returns `200 OK` with `{ok: true}` JSON (no auto-reply)
7. Admin sees inbound message in Settings → Inbound SMS section

**SMS Types (templates in send-sms Edge Function):**
- `payment_reminder` - Friendly rent reminder with amount and due date
- `payment_overdue` - Overdue notice with days overdue and late fee
- `payment_received` - Payment confirmation
- `deposit_requested` - Deposit request with total due
- `deposit_received` - Deposit payment confirmation
- `lease_sent` - Lease sent for e-signature notification
- `lease_signed` - Lease signed confirmation
- `move_in_confirmed` - Welcome message with rental details
- `general` - Ad-hoc message from admin compose
- `bulk_announcement` - Broadcast to all active tenants

**SMS Service Usage (client-side):**
```javascript
import { smsService } from '../shared/sms-service.js';

// Send to individual tenant
await smsService.sendPaymentReminder(tenant, amount, dueDate, period);

// Send ad-hoc message
await smsService.sendGeneral(tenant, "Your package has arrived at the front office.");

// Send bulk announcement
await smsService.sendBulk('bulk_announcement', recipients, { message: "Community event tonight at 6pm!" });

// Get conversation thread
const messages = await smsService.getConversation(personId);

// Get recent inbound messages
const inbound = await smsService.getRecentInbound(50);
```

**Admin UI:**
- Settings tab: Telnyx test/live mode toggle, phone number display, compose + bulk SMS buttons
- Compose SMS modal: Recipient dropdown (active tenants), message textarea with char counter, conversation thread
- Bulk SMS modal: Message textarea, recipient preview list, send-to-all with progress
- Inbound SMS section: List of recent inbound messages with sender name and timestamp

**Telnyx Portal Configuration:**
- Phone Number: +17377474737
- Messaging Profile: "AlpacApps" (ID: `40019c2b-034b-4d3f-9eae-e00a13122927`)
- Profile > Inbound tab > Webhook URL: `https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/telnyx-webhook`
- Numbers > My Numbers > +17377474737 must be assigned to "AlpacApps" messaging profile
- 10DLC: Must be registered in Messaging > Compliance before SMS works

### Error Monitoring
- Client-side errors captured via `shared/error-logger.js`
- Errors stored in `error_logs` table for analysis
- Daily digest email sent via `error-report` Edge Function
- Triggered automatically when users visit the consumer spaces page
- Recipient: `alpacaplayhouse@gmail.com`

**Error Categories Tracked:**
- `upload`: File upload failures (timeouts, network errors, DB errors)
- `media`: Delete, unlink, and reorder failures
- `global`: Uncaught exceptions and unhandled promise rejections

**Querying Errors:**
```sql
-- Recent errors
SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 50;

-- Errors by category
SELECT category, code, COUNT(*) as count
FROM error_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY category, code
ORDER BY count DESC;
```

## Contacts & Accounts

| Service | Account |
|---------|---------|
| GitHub | rsonnad |
| Supabase | (Rahul's account) |
| DigitalOcean | (Rahul's account) |

## Recent Features

### Space Archiving
Spaces can be soft-deleted via archive/unarchive. Archived spaces have `is_archived = true` and are filtered out of all views.

### Admin UI Improvements
- **Lightbox**: Click any photo to view full-size in overlay
- **Drag-and-drop**: Reorder photos by dragging
- **Toast notifications**: Non-blocking success/error messages
- **Table view**: Alternative list view with thumbnails
- **Inline tag editing**: Add tags directly in the UI

### Management Dashboard
Located at `/spaces/admin/manage.html` with tabs for:
- **Spaces**: Space management with archive/unarchive
  - Filters: Search text, Parent Area dropdown, Dwelling/Non-dwelling checkboxes
  - Shows thumbnails, type badge, and Edit button for each space
  - Edit button links to main admin page with `?edit=<id>` to auto-open modal
- **Rentals**: Kanban-style rental application pipeline
  - Stages: Applications → Approved → Contract → Deposit → Ready
  - Click card to open detail modal with tabs: Applicant, Terms, Documents, Deposits, Rent, History
  - Documents tab: Preview/Generate lease PDF, send for signature, track signing status
- **Media**: Full media library with tagging and filtering
- **Users**: User management (future)
- **Settings**: System configuration
  - Lease Template Editor: Markdown with {{placeholders}}, validation, version history
  - SignWell Configuration: API key, test mode toggle

### Smart Payment Recording (AI-Assisted)
Intelligent payment matching using Google Gemini AI:
1. OpenClaw receives bank notification text (e.g., "ZELLE FROM KYMBERLY DELIOU$1,195.00")
2. Sends to `record-payment` Edge Function
3. System checks cached sender mappings first (instant lookup)
4. If no cache hit, tries exact name match against tenants
5. If no exact match, calls Gemini AI for fuzzy matching:
   - Handles name variations (Kym = Kymberly, Bob = Robert)
   - Considers payment amount vs rent/deposit amounts
   - Returns confidence score (0.00-1.00)
6. High confidence (≥85%) → auto-records payment, saves mapping for future
7. Low confidence → creates `pending_payment` for admin review
8. Admin can manually match via `resolve-payment` Edge Function
9. Manual matches are cached, so future payments auto-match

**Key benefit:** First payment from a sender may need AI/manual matching. All subsequent payments from the same sender are instant (cached lookup, no AI cost).

### Rental Application Flow

**Application Submission** (`/spaces/apply/`):
1. Applicant fills out form with personal info, desired space, move-in date, term
2. Application fee section shows default amount (from `fee_settings` table)
3. Optional: Enter discount code to reduce/waive fee
   - Code validation happens via Supabase query
   - If code sets price to $0, Square form is hidden
4. If fee > $0, Square card form appears
5. On submit: Card tokenized client-side → Edge Function processes payment
6. Application created with fee tracking columns:
   - `application_fee_paid` (boolean)
   - `application_fee_amount` (actual amount charged)
   - `application_fee_code` (code used, if any)
7. Success screen shows application summary
8. Admin notification email sent

**Admin Pipeline** (`/spaces/admin/manage.html` → Rentals tab):
1. **Applications**: Review submitted applications
   - Application fee status shown in Deposits tab
   - Green banner shows fee amount and credit calculation
2. **Approved**: Set terms (space, rate, move-in, deposits)
   - Security deposit: Optional, due at move-in
   - Reservation deposit: Defaults to one month's rent, due after signing, credited to first month
3. **Contract**: Generate lease PDF, send for signature via SignWell
   - Lease shows application fee credit if paid
   - `{{application_fee_credit}}` placeholder populated with credit text
   - `{{first_month_due}}` = Monthly rate - Application fee
4. **Deposit**: Track reservation deposit payment
5. **Ready**: All deposits received, ready for move-in

**Post-Signature Email** (via SignWell webhook):
When tenant signs lease, automated email sent with:
- Congratulations message with space name
- Reservation deposit amount due
- Payment options (Venmo, Zelle, etc. from `payment_methods` table)
- Move-in date and monthly rent summary
- Instructions to include name and "Reservation Deposit" in memo

### Event Hosting Flow

**Event Request Submission** (`/spaces/events/`):
1. Host fills out form with event details, staffing contacts, space requests
2. Acknowledges all venue policies (10 checkboxes)
3. Deposit section shows only the Reservation Deposit:
   - Reservation Deposit (default from `fee_settings`, e.g., $95)
   - Note displayed: Cleaning deposit ($195) and rental fee ($295) are due 7 days before event
4. Optional: Enter partner code for reservation deposit
   - Codes set actual prices (code with $0 = waived)
5. If reservation deposit > $0, Square card form appears
6. On submit: Square payment for reservation deposit only
7. Event request created with deposit tracking columns:
   - `reservation_deposit_amount`, `reservation_deposit_code`
   - `deposit_status` ('pending', 'paid', 'waived', 'failed')
   - `square_payment_id`, `square_receipt_url`
8. Success screen shows request summary with note about outstanding fees

**Fee Timing:**
- **At application**: Reservation deposit ($95) collected via Square
- **7 days before event**: Cleaning deposit ($195) + Rental fee ($295) due via Venmo/Zelle/etc.
- **10 days before event**: Automated email reminder sent for outstanding fees
- **After event**: Cleaning deposit and reservation deposit refunded if venue is clean

**Admin Pipeline** (`/spaces/admin/manage.html` → Events tab):
1. **Submitted**: Review event requests
   - Click card to open detail modal with tabs: Event Info, Terms, Documents, Deposits
2. **Approved**: Confirm spaces, adjust fees if needed
   - Terms tab: Set rental fee, reservation fee, cleaning deposit
3. **Contract**: Generate event agreement PDF, send for signature
   - Documents tab: Preview Agreement → Generate PDF → Send for Signature
   - Agreement shows reservation deposit credit if paid via Square
   - `{{rental_fee}}` = Full rental amount (e.g., $295)
   - `{{reservation_fee_credit}}` = Credit text if deposit paid
   - `{{rental_fee_due}}` = Rental fee - Reservation deposit
4. **Deposit**: Track all fee payments (cleaning deposit + rental fee due 7 days before event)
   - Deposits tab shows all payment statuses
5. **Confirmed**: All payments received, event confirmed

**Post-Signature Email** (via SignWell webhook):
When host signs event agreement, automated email sent with:
- Congratulations message with event name
- Outstanding fees: cleaning deposit + rental fee amounts
- Total due with payment due date (7 days before event)
- Note about cleaning deposit refundability
- Payment options from database
- Event details summary
- Reminders about setup crew, directions page, cleanup deadline

**Payment Reminder Email** (via `event-payment-reminder` Edge Function):
Automated daily cron job (2 PM UTC / 9 AM CT) checks for events 10 days out:
- Queries `event_hosting_requests` for events with `event_date` = today + 10 days
- Filters for approved, non-archived events with unpaid cleaning deposit or rental fee
- Sends reminder email with outstanding fee breakdown and payment options
- Records `payment_reminder_sent_at` timestamp on the event request

### Lease Agreement System
Database-driven lease generation replacing manual Claude Skill workflow:
1. Templates stored in `lease_templates` table (Markdown with `{{placeholders}}`)
2. Active template loaded when viewing application Documents tab
3. Client-side PDF generation using jsPDF
4. PDFs stored in `lease-documents` Supabase storage bucket
5. SignWell integration for e-signatures (API + webhook)
6. Signed PDFs stored back in Supabase, linked to application

### SignWell Webhook

The webhook (`/functions/v1/signwell-webhook`) handles both rental and event agreements:

**When document is signed:**
1. Receives `document_completed` event from SignWell
2. Checks both `rental_applications` and `event_hosting_requests` for matching document ID
3. Downloads signed PDF from SignWell API
4. Uploads to Supabase storage (`lease-documents/signed/`)
5. Updates application status to "signed"
6. Fetches payment methods from database
7. Sends appropriate email based on document type:
   - Rental: Reservation deposit request with move-in details
   - Event: Outstanding fees (cleaning deposit + rental fee) with payment deadline (7 days before event)

### Early Exit Feature
When a tenant wants to leave before their assignment ends:
1. Admin sets `desired_departure_date` in the space detail modal
2. Date is saved but NOT yet visible to consumers
3. Admin clicks "List" button to publish the early exit
4. Only when `desired_departure_listed=true` does the date affect consumer availability
5. Changing the date resets `desired_departure_listed` to false (requires re-listing)

### Edge Function Deployment

To deploy Supabase Edge Functions:
```bash
# Login (one-time)
npx supabase login

# Deploy functions
npx supabase functions deploy record-payment --project-ref aphrrfprbixmhissnjfn
npx supabase functions deploy resolve-payment --project-ref aphrrfprbixmhissnjfn
npx supabase functions deploy signwell-webhook --project-ref aphrrfprbixmhissnjfn
npx supabase functions deploy event-payment-reminder --project-ref aphrrfprbixmhissnjfn

# Set secrets (one-time)
npx supabase secrets set GEMINI_API_KEY=your_key_here --project-ref aphrrfprbixmhissnjfn
```

## Related Documentation

- `README.md` - Quick setup
- `API.md` - Full REST API reference (includes Edge Function docs)
- `SKILL.md` - OpenClaw integration
- Supabase Dashboard - https://supabase.com/dashboard/project/aphrrfprbixmhissnjfn
