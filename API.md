# AlpacApps API Reference

Centralized REST API for the AlpacApps property management system. All entity CRUD operations route through a single permissioned endpoint.

---

## Endpoint

```
POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api
Content-Type: application/json
```

All operations use POST with a JSON body — the `resource` and `action` fields determine the operation.

---

## Authentication

Every request is resolved to a role level. Include one of these auth methods:

| Method | Header | Level | Use Case |
|--------|--------|-------|----------|
| User JWT | `Authorization: Bearer <jwt>` | Depends on user role | Frontend, PAI chat, mobile app |
| Service Role Key | `Authorization: Bearer <service_role_key>` | 4 (oracle) | Edge functions, workers, internal services |
| API Key | `X-API-Key: <key>` | Depends on key config | Third-party applets (future) |
| None | — | 0 (public) | Public data only |

When using a JWT, also include the Supabase anon key:
```
apikey: <SUPABASE_ANON_KEY>
```

### Role Levels

| Level | Roles | Access |
|-------|-------|--------|
| 0 | unauthenticated, demo | Read-only public data (listed spaces, FAQ, media) |
| 1 | resident, associate | Own data + limited writes (tasks, bugs, profile) |
| 2 | staff | Read/write most operational data |
| 3 | admin | Full CRUD on everything except system config |
| 4 | oracle, service key | Full CRUD + system config tables |

---

## Request Format

```json
{
  "resource": "tasks",
  "action": "list",
  "id": "uuid",
  "data": { "title": "Fix door", "priority": 2 },
  "filters": { "status": "open", "assigned_name": "Jon" },
  "limit": 50,
  "offset": 0,
  "order_by": "created_at",
  "order_dir": "desc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resource` | string | Yes | Resource name (see table below) |
| `action` | string | Yes | `list`, `get`, `create`, `update`, or `delete` |
| `id` | uuid | For get/update/delete | Record identifier |
| `data` | object | For create/update | Fields to set |
| `filters` | object | For list | Filter criteria |
| `limit` | integer | No | Max rows (default 100, max 500) |
| `offset` | integer | No | Skip rows for pagination |
| `order_by` | string | No | Column to sort by |
| `order_dir` | string | No | `asc` or `desc` |

## Response Format

**Success:**
```json
{
  "data": [ ... ] | { ... },
  "count": 42,
  "error": null
}
```

**Error:**
```json
{
  "data": null,
  "error": "Not found",
  "code": 404
}
```

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request / validation error |
| 401 | Invalid or missing auth token |
| 403 | Insufficient permissions |
| 404 | Record not found |
| 405 | Method not allowed (must use POST) |
| 429 | Rate limited |
| 500 | Internal server error |
| 501 | Resource handler not implemented |

---

## Resources

### `spaces` — Rental Units & Amenity Spaces

**Table:** `spaces`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Level 0–1: only `is_listed=true AND is_secret=false`. Level 2+: all non-archived. |
| get | 0 | Same visibility rules. Includes `media_spaces` join. |
| create | 3 | Admin only |
| update | 2 | Staff limited to: description, rates, access_code, airbnb fields. Admin: all fields. |
| delete | 3 | Soft delete (sets `is_archived = true`) |

**Key columns:** `id`, `name`, `description`, `parent_id`, `type`, `monthly_rate`, `weekly_rate`, `nightly_rate`, `beds_king`, `beds_queen`, `beds_double`, `beds_twin`, `beds_folding`, `bath_privacy`, `bath_fixture`, `sq_footage`, `can_be_dwelling`, `can_be_event`, `is_listed`, `is_secret`, `is_archived`, `access_code`, `airbnb_ical_url`, `airbnb_link`, `airbnb_rate`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `type` | string | Space type (e.g., "Dwelling", "Amenity") |
| `can_be_dwelling` | boolean | Filter dwelling spaces |
| `can_be_event` | boolean | Filter event spaces |
| `parent_id` | uuid | Filter by parent area |
| `search` | string | Search by name (case-insensitive) |

**Example — List all dwelling spaces:**
```json
{
  "resource": "spaces",
  "action": "list",
  "filters": { "can_be_dwelling": true },
  "order_by": "monthly_rate",
  "order_dir": "desc"
}
```

**Example — Get space with photos:**
```json
{
  "resource": "spaces",
  "action": "get",
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `people` — Contact Records

**Table:** `people`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ only |
| get | 2 | Staff+ only |
| create | 2 | Requires first_name or last_name |
| update | 2 | Staff+ |
| delete | 3 | Admin only. Hard delete. |

**Key columns:** `id`, `first_name`, `last_name`, `email`, `phone`, `phone2`, `type` (owner/staff/tenant/airbnb_guest/prospect/associate/event_client/house_guest), `voice_greeting`, `notes`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `type` | string | Person type |
| `search` | string | Fuzzy match on first_name, last_name, or email |
| `phone` | string | Normalized phone digit search (last 10 digits) |
| `email` | string | Case-insensitive email match |

**Example — Search for a person:**
```json
{
  "resource": "people",
  "action": "list",
  "filters": { "search": "Jon" }
}
```

**Example — Create a tenant:**
```json
{
  "resource": "people",
  "action": "create",
  "data": {
    "first_name": "John",
    "last_name": "Doe",
    "type": "tenant",
    "email": "john@example.com",
    "phone": "+15551234567"
  }
}
```

---

### `assignments` — Bookings & Occupancy

**Tables:** `assignments`, `assignment_spaces`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Residents: own only (via `person_id`). Staff+: all. |
| get | 1 | Same scoping. |
| create | 2 | Pass `space_ids: [uuid, ...]` to link spaces in one call. |
| update | 2 | Pass `space_ids` to replace linked spaces. |
| delete | 3 | Removes junction records then assignment. |

**Key columns (assignments):** `id`, `person_id` (FK→people), `start_date`, `end_date`, `desired_departure_date`, `desired_departure_listed`, `status` (active/pending_contract/contract_sent/completed/cancelled), `monthly_rate`, `weekly_rate`, `nightly_rate`, `notes`

**Computed fields (returned with list/get):**
- `is_current` — boolean: active + today falls within date range
- `available_date` — when space becomes available (`desired_departure_date` if listed, else `end_date`)

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `status` | string | Assignment status |
| `person_id` | uuid | Filter by person |
| `space_id` | uuid | Filter by space (via junction table) |
| `active` | boolean | Shorthand: status in (active, pending_contract, contract_sent) |

**Example — List active assignments:**
```json
{
  "resource": "assignments",
  "action": "list",
  "filters": { "active": true },
  "order_by": "start_date",
  "order_dir": "desc"
}
```

**Example — Create assignment with spaces:**
```json
{
  "resource": "assignments",
  "action": "create",
  "data": {
    "person_id": "person-uuid",
    "start_date": "2026-03-01",
    "end_date": "2026-06-01",
    "status": "active",
    "monthly_rate": 800,
    "space_ids": ["space-uuid-1", "space-uuid-2"]
  }
}
```

---

### `tasks` — Projects Board

**Table:** `tasks`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Everyone sees all tasks. Full filter support. |
| get | 1 | |
| create | 1 | Anyone can create. Smart name/space resolution. |
| update | 1 | Anyone can update status. Staff+ can reassign. |
| delete | 2 | Staff+ only |

**Key columns:** `id`, `title`, `notes`, `priority` (1=urgent, 2=high, 3=medium, 4=low), `space_id` (FK→spaces), `location_label`, `assigned_to` (FK→app_users), `assigned_name`, `status` (open/in_progress/done), `created_at`, `updated_at`, `completed_at`

**Smart behaviors:**
- `assigned_name: "Jon"` → fuzzy-matches against app_users display_name, links `assigned_to` if found
- `space_name: "outhouse"` → fuzzy-matches against spaces, sets `space_id`
- Setting `status: "done"` → auto-sets `completed_at` to now
- Setting status to anything else → clears `completed_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `status` | string | `open`, `in_progress`, `done`, or `all` |
| `priority` | integer | 1–4 |
| `assigned_to` | uuid | App user ID |
| `assigned_name` | string | Fuzzy match on assignee name |
| `space_id` | uuid | Filter by space |
| `space_name` | string | Fuzzy match on space name |
| `search` | string | Search title and notes |

**Example — Create a task with name resolution:**
```json
{
  "resource": "tasks",
  "action": "create",
  "data": {
    "title": "Fix bathroom door handle",
    "priority": 2,
    "assigned_name": "Jon",
    "space_name": "outhouse",
    "notes": "Handle is loose, needs tightening"
  }
}
```

**Example — List open tasks for a person:**
```json
{
  "resource": "tasks",
  "action": "list",
  "filters": { "status": "open", "assigned_name": "Donny" }
}
```

**Example — Mark task done:**
```json
{
  "resource": "tasks",
  "action": "update",
  "id": "task-uuid",
  "data": { "status": "done" }
}
```

---

### `users` — App User Accounts

**Table:** `app_users`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff sees basic info. Admin sees full record. |
| get | 2 | |
| create | 3 | Admin only |
| update | 3 | Admin only |
| delete | 4 | Oracle only |

**Staff-visible columns:** `id`, `email`, `role`, `display_name`, `first_name`, `last_name`, `avatar_url`, `created_at`, `last_sign_in_at`

**Admin-visible (all columns):** Above plus `phone`, `phone2`, `bio`, `person_id`, `nationality`, `location_base`, `gender`, `privacy_*`, social URLs, `discord_id`, `auth_user_id`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `role` | string | admin, staff, resident, associate |
| `search` | string | Search display_name, email, first/last name |

---

### `profile` — Self-Service Profile (Current User)

**Table:** `app_users` (scoped to authenticated caller)

| Action | Min Level | Notes |
|--------|-----------|-------|
| get | 1 | Returns own full profile |
| update | 1 | Can only update allowed fields |

**Editable fields:** `display_name`, `first_name`, `last_name`, `phone`, `phone2`, `bio`, `avatar_url`, `nationality`, `location_base`, `gender`, `privacy_phone`, `privacy_email`, `privacy_bio`, `facebook_url`, `instagram_url`, `linkedin_url`, `x_url`

**Example — Update own profile:**
```json
{
  "resource": "profile",
  "action": "update",
  "data": {
    "display_name": "Jon D.",
    "bio": "Enjoys hiking and cooking.",
    "privacy_phone": "residents"
  }
}
```

---

### `vehicles` — Vehicle Fleet

**Table:** `vehicles`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | All residents can see active vehicles. Ordered by display_order. |
| get | 1 | Includes full `last_state` JSONB. |
| create | 3 | Admin only |
| update | 2 | Staff can update state. Admin for config. |
| delete | 3 | Soft delete (sets `is_active = false`) |

**Key columns:** `id`, `name`, `make`, `model`, `year`, `color`, `color_hex`, `vin`, `owner_name`, `vehicle_state` (online/asleep/offline/unknown), `display_order`, `is_active`, `last_state` (JSONB), `last_synced_at`

**`last_state` JSONB includes:** `battery_level`, `range_miles`, `charging_state`, `locked`, `latitude`, `longitude`, `speed_mph`, `odometer_miles`, `inside_temp_f`, `outside_temp_f`, `tire_pressure_fl/fr/rl/rr`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `make` | string | Filter by manufacturer |
| `search` | string | Search by vehicle name |

**Example — List all vehicles:**
```json
{
  "resource": "vehicles",
  "action": "list"
}
```

---

### `media` — Photos & Media Library

**Tables:** `media`, `media_spaces`, `media_tags`, `media_tag_assignments`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Public access. Supports tag/space/category filters. |
| get | 0 | Includes space links and tags. |
| create | 2 | Pass `space_id` and `tag_ids` to link in one call. |
| update | 2 | Update caption, tags, space links. |
| delete | 2 | Removes junction records then media record. |

**Key columns (media):** `id`, `url`, `width`, `height`, `caption`, `category` (mktg/property/maintenance/ai-gen), `file_size_bytes`, `created_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `category` | string | mktg, property, maintenance, ai-gen |
| `space_id` | uuid | Filter by linked space |
| `tag_name` | string | Filter by tag name |
| `search` | string | Search captions |

**Example — List marketing photos for a space:**
```json
{
  "resource": "media",
  "action": "list",
  "filters": { "category": "mktg", "space_id": "space-uuid" }
}
```

---

### `payments` — Accounting Ledger

**Table:** `ledger`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | Includes person join. |
| create | 2 | Record a payment entry. |
| update | 3 | Admin only |
| delete | 4 | Oracle only |

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `person_id` | uuid | Filter by person |
| `type` | string | Payment type |
| `payment_method` | string | Method of payment |
| `start_date` | date | Payment date >= |
| `end_date` | date | Payment date <= |

**Example — List payments for a person:**
```json
{
  "resource": "payments",
  "action": "list",
  "filters": { "person_id": "person-uuid" },
  "order_by": "payment_date",
  "order_dir": "desc"
}
```

---

### `bug_reports` — Bug Tracking

**Table:** `bug_reports`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ see all |
| get | 2 | |
| create | 1 | Anyone can report. Auto-sets `reported_by` from caller. |
| update | 2 | Staff+ (diagnosis, status) |
| delete | 3 | Admin only |

**Key columns:** `id`, `title`, `description`, `page_url`, `severity`, `status` (pending/in_progress/fixed/wontfix), `reported_by`, `diagnosis`, `notes`, `screenshot_url`, `user_agent`, `browser_name`, `created_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `status` | string | pending, in_progress, fixed, wontfix |
| `severity` | string | Severity level |
| `search` | string | Search title and description |

**Example — Report a bug:**
```json
{
  "resource": "bug_reports",
  "action": "create",
  "data": {
    "title": "Laundry page shows wrong status",
    "description": "Washer shows 'running' but it finished 10 mins ago",
    "page_url": "https://alpacaplayhouse.com/residents/laundry.html",
    "severity": "medium"
  }
}
```

---

### `time_entries` — Associate Work Hours

**Tables:** `time_entries`, `work_photos`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Associates: own only. Staff+: all. Includes associate/space joins. |
| get | 1 | Same scoping. Includes work_photos. |
| create | 1 | Auto-computes `duration_minutes` if both clock times provided. |
| update | 1 | Own entries only (level 1). Staff+ any. Recomputes duration. |
| delete | 2 | Staff+ |

**Key columns:** `id`, `associate_id` (FK→associate_profiles), `space_id` (FK→spaces), `clock_in`, `clock_out`, `duration_minutes`, `is_manual`, `manual_reason`, `notes`, `latitude`, `longitude`, `status` (active/completed/paid), `paid_at`, `payout_id`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `associate_id` | uuid | Filter by associate |
| `space_id` | uuid | Filter by space |
| `status` | string | active, completed, paid |
| `start_date` | date | clock_in >= |
| `end_date` | date | clock_in <= |

**Example — Clock in:**
```json
{
  "resource": "time_entries",
  "action": "create",
  "data": {
    "associate_id": "assoc-uuid",
    "space_id": "space-uuid",
    "clock_in": "2026-02-12T09:00:00Z",
    "status": "active"
  }
}
```

**Example — Clock out (auto-computes duration):**
```json
{
  "resource": "time_entries",
  "action": "update",
  "id": "entry-uuid",
  "data": {
    "clock_out": "2026-02-12T13:30:00Z",
    "status": "completed"
  }
}
```

---

### `events` — Event Hosting Requests

**Table:** `event_hosting_requests`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Residents: own events only (by email). Staff+: all. |
| get | 1 | |
| create | 1 | Submit event hosting request. |
| update | 2 | Staff+ manage pipeline. |
| delete | 3 | Admin only |

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `status` | string | Pipeline status |
| `search` | string | Search event_name and host_name |

---

### `documents` — Document Library

**Table:** `document_index`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Only active documents. |
| get | 1 | Returns full record including `content_text` or download URL. |
| create | 2 | Requires `title`. Auto-sets `uploaded_by`. |
| update | 2 | Staff+ |
| delete | 3 | Soft delete (sets `is_active = false`) |

**Key columns:** `id`, `title`, `description`, `keywords` (text[]), `source_url`, `file_type`, `file_size_bytes`, `storage_backend` (supabase/r2), `content_text`, `is_active`, `uploaded_by`, `created_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `search` | string | Search title and description |
| `file_type` | string | e.g., "pdf", "txt" |
| `storage_backend` | string | "supabase" or "r2" |

---

### `sms` — SMS Messages

**Table:** `sms_messages`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ view conversation threads. |
| get | 2 | Single message with person join. |
| create | 2 | Delegates to `send-sms` edge function. Requires `to_number` and `body`. |

**Key columns:** `id`, `person_id`, `direction` (inbound/outbound), `from_number`, `to_number`, `body`, `sms_type`, `telnyx_id`, `status`, `created_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `person_id` | uuid | Conversation for a person |
| `direction` | string | "inbound" or "outbound" |
| `sms_type` | string | Message type |
| `search` | string | Search message body |

**Example — Send an SMS:**
```json
{
  "resource": "sms",
  "action": "create",
  "data": {
    "to_number": "+15551234567",
    "body": "Your package arrived at the front desk.",
    "person_id": "person-uuid",
    "sms_type": "general"
  }
}
```

---

### `faq` — PAI Knowledge Base

**Table:** `faq_context_entries`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Public. Non-admin only sees active entries. Ordered by `display_order`. |
| get | 0 | |
| create | 3 | Requires `title` and `content`. |
| update | 3 | |
| delete | 3 | Hard delete. |

**Key columns:** `id`, `title`, `content`, `display_order`, `is_active`

---

### `invitations` — User Invitations

**Table:** `user_invitations`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | |
| create | 2 | Requires `email` and `role`. Auto-sets `invited_by` and 7-day expiry. |
| update | 3 | Admin only |
| delete | 3 | Admin only |

**Key columns:** `id`, `email`, `role`, `invited_by`, `expires_at`, `accepted_at`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `role` | string | Filter by invited role |
| `search` | string | Search by email |

**Example — Invite a resident:**
```json
{
  "resource": "invitations",
  "action": "create",
  "data": {
    "email": "newresident@example.com",
    "role": "resident"
  }
}
```

---

### `password_vault` — Credentials Store

**Table:** `password_vault`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Role-based filtering (see below). |
| get | 1 | |
| create | 3 | Requires `service`. |
| update | 3 | |
| delete | 3 | Soft delete (sets `is_active = false`) |

**Role-based access:**
- **Admin (3+):** sees all categories
- **Staff (2):** sees `house`, `platform`, `service` categories
- **Resident (1):** sees only `house` category, filtered to their assigned spaces + shared (null space_id)

**Key columns:** `id`, `service`, `username`, `password`, `category` (house/platform/service/vendor), `space_id` (FK→spaces), `notes`, `is_active`

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `category` | string | house, platform, service, vendor |
| `search` | string | Search service name and notes |

**Example — Look up house codes:**
```json
{
  "resource": "password_vault",
  "action": "list",
  "filters": { "category": "house", "search": "wifi" }
}
```

---

### `feature_requests` — PAI Feature Builder Queue

**Table:** `feature_requests`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | |
| create | 2 | Rate limited: max 3 active builds, max 10/day. |
| update | 2 | Status updates. |
| delete | 3 | Admin only |

**Filters:**
| Filter | Type | Description |
|--------|------|-------------|
| `status` | string | pending, building, completed, failed, etc. |
| `search` | string | Search description |

---

### `pai_config` — PAI System Configuration

**Table:** `pai_config` (single row, id=1)

| Action | Min Level | Notes |
|--------|-----------|-------|
| get | 3 | Admin only |
| update | 3 | Admin only |

**Example — Update PAI identity:**
```json
{
  "resource": "pai_config",
  "action": "update",
  "data": {
    "identity": "You are PAI, the Property AI assistant..."
  }
}
```

---

### `tesla_accounts` — Tesla Fleet API Credentials

**Table:** `tesla_accounts`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 3 | Admin only. Sensitive tokens excluded from response. |
| get | 3 | |
| update | 3 | Token refresh, credentials. |

**Returned columns (safe subset):** `id`, `owner_name`, `tesla_email`, `is_active`, `last_error`, `last_token_refresh_at`, `fleet_api_base`, `created_at`, `updated_at`

---

## Smart Behaviors

### Fuzzy Name Resolution

When creating or updating **tasks**, you can pass natural names instead of UUIDs:

```json
{
  "resource": "tasks",
  "action": "create",
  "data": {
    "title": "Repair kitchen faucet",
    "assigned_name": "Jon",
    "space_name": "outhouse"
  }
}
```

The API will:
1. Fuzzy-match `"Jon"` against `app_users.display_name` → set `assigned_to` + `assigned_name`
2. Fuzzy-match `"outhouse"` against `spaces.name` → set `space_id`
3. Fall back to name-only assignment if no user match found

### Auto-Timestamps

- **Tasks:** Setting `status: "done"` auto-sets `completed_at`. Any other status clears it.
- **Time entries:** If both `clock_in` and `clock_out` are present (create or update), `duration_minutes` is auto-computed.

### Soft Deletes

These resources use soft deletes (not destroyed):
- `spaces` → `is_archived = true`
- `documents` → `is_active = false`
- `password_vault` → `is_active = false`
- `vehicles` → `is_active = false`

### Row-Level Scoping

Residents and associates only see their own data for scoped resources:
- **assignments:** filtered by `person_id` matching the caller's linked person
- **time_entries:** filtered by `associate_id` matching the caller's associate profile
- **events:** filtered by `contact_email` matching the caller's email
- **password_vault:** filtered to `house` category + own assigned spaces

Staff+ see all rows.

---

## Usage Logging

All API calls are logged to `api_usage_log` with:
- Vendor: `alpacapps_api`
- Category: `api_{resource}_{action}` (e.g., `api_tasks_create`)
- Caller name and role in metadata

---

## Standalone Edge Functions

These edge functions remain separate from the centralized API because they contain specialized business logic:

### Smart Payment Recording

```
POST /functions/v1/record-payment
```

AI-powered payment matching (Gemini) with learned sender mappings. See request format:

```json
{
  "name": "KYMBERLY DELIOU",
  "payment_string": "02/02/2026\nCREDIT\nZELLE FROM KYMBERLY DELIOU$1,195.00",
  "source": "openclaw",
  "force_gemini": false
}
```

### Resolve Pending Payment

```
POST /functions/v1/resolve-payment
```

```json
{
  "pending_id": "uuid",
  "person_id": "person-uuid",
  "assignment_id": "assignment-uuid",
  "action": "match",
  "save_mapping": true
}
```

### Send SMS

```
POST /functions/v1/send-sms
```

Direct SMS sending via Telnyx (also available via `sms.create` in the API).

### Send Email

```
POST /functions/v1/send-email
```

Email sending via Resend with 45+ templates.

### Tesla Command

```
POST /functions/v1/tesla-command
```

Vehicle commands (lock, unlock, flash, honk) with wake-up handling.

### Device Control

| Endpoint | Devices | Auth |
|----------|---------|------|
| `/functions/v1/govee-control` | Govee lights | resident+ |
| `/functions/v1/nest-control` | Nest thermostats | resident+ |
| `/functions/v1/sonos-control` | Sonos speakers | resident+ |
| `/functions/v1/lg-control` | LG washer/dryer | resident+ |

### PAI Chat

```
POST /functions/v1/alpaca-pai
```

```json
{
  "message": "What tasks are assigned to Donny?",
  "conversationHistory": []
}
```

PAI uses the centralized API internally via its `manage_data` tool.

---

## Code Examples

### JavaScript (Frontend)

```javascript
import { supabase } from './shared/supabase.js';

async function listOpenTasks() {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const resp = await fetch(
    'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        resource: 'tasks',
        action: 'list',
        filters: { status: 'open' },
        order_by: 'priority',
        order_dir: 'asc',
        limit: 25,
      }),
    }
  );

  const { data, count, error } = await resp.json();
  if (error) throw new Error(error);
  return { tasks: data, total: count };
}
```

### cURL (Service Role)

```bash
curl -X POST \
  'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -d '{
    "resource": "tasks",
    "action": "create",
    "data": {
      "title": "Replace AC filter",
      "priority": 3,
      "assigned_name": "Jon",
      "space_name": "skyloft"
    }
  }'
```

### Python (Worker/Script)

```python
import requests

API_URL = "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api"
SERVICE_KEY = "your-service-role-key"

resp = requests.post(API_URL, json={
    "resource": "people",
    "action": "list",
    "filters": {"type": "tenant"},
    "limit": 100,
}, headers={
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
})

data = resp.json()
print(f"Found {data['count']} tenants")
for person in data["data"]:
    print(f"  {person['first_name']} {person['last_name']}")
```

---

## Configuration

```
SUPABASE_URL: https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk
API_ENDPOINT: https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api
```

---

## Future: API Key Authentication (Phase 3)

For third-party applets and external integrations, API key auth via `X-API-Key` header will be supported. Keys will map to an `api_keys` table with configurable role level, scopes, and rate limits.
