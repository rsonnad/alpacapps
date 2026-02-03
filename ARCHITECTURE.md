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
| Admin UI | GitHub Pages | https://rsonnad.github.io/alpacapps/ |
| Source Code | GitHub | https://github.com/rsonnad/alpacapps |
| Database | Supabase | https://aphrrfprbixmhissnjfn.supabase.co |
| Photo Storage | Supabase Storage | bucket: `housephotos` |
| Lease Documents | Supabase Storage | bucket: `lease-documents` |
| OpenClaw Bot | DigitalOcean | Droplet (separate system) |
| E-Signatures | SignWell | API: signwell.com/api |
| Email Delivery | Resend | API key stored in Supabase secrets |
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
│   ├── lease-template-service.js  # Lease template parsing
│   ├── pdf-service.js      # PDF generation (jsPDF)
│   ├── signwell-service.js # SignWell e-signature API
│   ├── email-service.js    # Email sending via Resend
│   └── error-logger.js     # Client-side error capture and reporting
│
├── supabase/               # Supabase Edge Functions
│   └── functions/
│       ├── signwell-webhook/  # E-signature completion webhook
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
│       └── contact-form/      # Contact form submission handler
│           └── index.ts
│
├── login/                  # Login page
│   ├── index.html
│   └── app.js
│
├── spaces/                 # Consumer-facing spaces view
│   ├── index.html
│   └── app.js              # Public space listing (filtered)
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

**rental_applications** additions:
- `generated_pdf_url` - Supabase storage URL of generated lease
- `signwell_document_id` - SignWell document tracking ID
- `signed_pdf_url` - URL of signed lease after e-signature

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

**Template Placeholders:**
- `{{tenant_name}}`, `{{tenant_email}}`, `{{tenant_phone}}`
- `{{signing_date}}`, `{{lease_start_date}}`, `{{lease_end_date}}`
- `{{dwelling_description}}`, `{{dwelling_location}}`
- `{{rate_display}}`, `{{security_deposit}}`, `{{move_in_deposit}}`
- `{{notice_period_display}}`, `{{additional_terms}}`

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

### Lease Agreement System
Database-driven lease generation replacing manual Claude Skill workflow:
1. Templates stored in `lease_templates` table (Markdown with `{{placeholders}}`)
2. Active template loaded when viewing application Documents tab
3. Client-side PDF generation using jsPDF
4. PDFs stored in `lease-documents` Supabase storage bucket
5. SignWell integration for e-signatures (API + webhook)
6. Signed PDFs stored back in Supabase, linked to application

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

# Set secrets (one-time)
npx supabase secrets set GEMINI_API_KEY=your_key_here --project-ref aphrrfprbixmhissnjfn
```

## Related Documentation

- `README.md` - Quick setup
- `API.md` - Full REST API reference (includes Edge Function docs)
- `SKILL.md` - OpenClaw integration
- Supabase Dashboard - https://supabase.com/dashboard/project/aphrrfprbixmhissnjfn
