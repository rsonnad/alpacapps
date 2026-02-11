# Feature: AlpacApps Internal REST API

**Status:** Planned  
**Priority:** P1  
**Created:** 2026-02-12  

---

## Summary

A single, permissioned REST API layer that exposes get/set operations for every entity in the system. This replaces ad-hoc Supabase queries scattered across PAI tools and frontend code with a centralized gateway that enforces role-based access control.

**Consumers:**
- PAI (chat, email, voice, Discord) — uses API tools instead of inline Supabase queries
- Third-party applets and automations (future)
- Internal admin scripts and workers
- Frontend pages (optional migration path)

---

## Architecture

```
Client (PAI, applet, frontend, worker)
  → POST /functions/v1/api
  → Body: { "resource": "tasks", "action": "create", "data": {...} }
  → Auth: Bearer <user JWT or service role key>
  → Response: { "data": {...}, "error": null }
```

### Edge Function

Create `supabase/functions/api/index.ts` — a single edge function that acts as a RESTful router.

Deploy with: `supabase functions deploy api --no-verify-jwt`

### Request Format

```json
{
  "resource": "tasks",
  "action": "list | get | create | update | delete",
  "id": "uuid (for get/update/delete)",
  "data": { "...fields..." },
  "filters": { "status": "open", "assigned_name": "Jon" },
  "limit": 50,
  "offset": 0,
  "order_by": "created_at",
  "order_dir": "desc"
}
```

### Response Format

```json
{
  "data": [...] | {...} | null,
  "count": 42,
  "error": null
}
```

Error responses:
```json
{ "data": null, "error": "Not found", "code": 404 }
{ "data": null, "error": "Forbidden", "code": 403 }
{ "data": null, "error": "Validation: title is required", "code": 400 }
```

---

## Auth & Permission Model

Every request resolves the caller to a role level via JWT or service role key:

| Level | Roles | Access |
|-------|-------|--------|
| 0 | unauthenticated / demo | Read-only public data (listed spaces, amenities, FAQ) |
| 1 | resident / associate | Read own data + limited writes (create tasks, update own profile, report bugs) |
| 2 | staff | Read/write most operational data (tasks, people, assignments, payments, work entries) |
| 3 | admin | Full CRUD on everything except system config |
| 4 | oracle | Full CRUD + system config tables (pai_config, vapi_config, etc.) |

### Permission Check Flow

```typescript
const { appUser, userLevel } = await resolveAuth(req, supabase);
const permission = PERMISSIONS[resource][action];
if (userLevel < permission.minLevel) return forbidden();
// For row-scoped resources, handler applies additional filtering
```

### Row-Level Scoping

Some resources restrict which rows a caller can see/modify based on identity:

- **Residents** listing `assignments`: only their own (via `person_id` match)
- **Associates** listing `time_entries`: only their own (via `associate_id` match)
- **Residents** creating `tasks`: `assigned_to` defaults to self
- **Staff+** see all rows for all resources

---

## Resources — Complete Reference

### `spaces` — Rental Units & Amenity Spaces

**Table:** `spaces`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Level 0-1: only `is_listed=true AND is_secret=false`. Level 2+: all non-archived. |
| get | 0 | Same visibility rules. Includes `media_spaces`, `space_amenities` joins. |
| create | 3 | Admin only |
| update | 2 | Staff can update operational fields. Admin for visibility/archival. |
| delete | 3 | Soft delete (`is_archived = true`) |

**Key columns:** `id`, `name`, `description`, `parent_id`, `type`, `monthly_rate`, `weekly_rate`, `nightly_rate`, `beds_king`, `beds_queen`, `beds_double`, `beds_twin`, `beds_folding`, `bath_privacy`, `bath_fixture`, `sq_footage`, `can_be_dwelling`, `can_be_event`, `is_listed`, `is_secret`, `is_archived`, `access_code`, `airbnb_ical_url`, `airbnb_link`, `airbnb_rate`

**Related tables:** `media_spaces` (photos), `space_amenities` (amenities), `assignment_spaces` (bookings)

---

### `people` — Contact Records

**Table:** `people`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ only |
| get | 2 | Staff+ only |
| create | 2 | Staff+ |
| update | 2 | Staff+ |
| delete | 3 | Admin only |

**Key columns:** `id`, `first_name`, `last_name`, `email`, `phone`, `phone2`, `type` (owner/staff/tenant/airbnb_guest/prospect/associate/event_client/house_guest), `voice_greeting`, `notes`

**Lookup helpers:**
- Search by name: fuzzy match on `first_name || ' ' || last_name`
- Search by phone: normalize digits, match last 10
- Search by email: case-insensitive `ilike`

---

### `assignments` — Bookings & Occupancy

**Tables:** `assignments`, `assignment_spaces`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Residents: own only. Staff+: all. Includes assignment_spaces + space names. |
| get | 1 | Same scoping |
| create | 2 | Staff+ |
| update | 2 | Staff+ |
| delete | 3 | Admin only |

**Key columns (assignments):** `id`, `person_id` (FK→people), `start_date`, `end_date`, `desired_departure_date`, `desired_departure_listed`, `status` (active/pending_contract/contract_sent/completed/cancelled), `monthly_rate`, `weekly_rate`, `nightly_rate`, `notes`

**Key columns (assignment_spaces):** `id`, `assignment_id`, `space_id`

**Computed fields returned:**
- `is_current`: boolean (active + dates encompass today)
- `available_date`: when space becomes available (from `desired_departure_date` if listed, else `end_date`)

---

### `tasks` — Projects Board

**Table:** `tasks`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | All users see all tasks. Supports filters: status, priority, assigned_name, space_id, search. |
| get | 1 | |
| create | 1 | Anyone can create. Resolve `assigned_name` → person lookup. |
| update | 1 | Anyone can update status. Staff+ can reassign. |
| delete | 2 | Staff+ only |

**Key columns:** `id`, `title`, `notes`, `priority` (1=urgent, 2=high, 3=medium, 4=low), `space_id` (FK→spaces), `location_label`, `assigned_to` (FK→app_users), `assigned_name`, `status` (open/in_progress/done), `created_at`, `updated_at`, `completed_at`

**Smart behaviors:**
- Setting `status = 'done'` auto-sets `completed_at`
- Setting `status` to anything else clears `completed_at`
- `assigned_name` accepts free text (e.g., "Jon") — API does fuzzy lookup on `people` table to resolve full name
- `space_id` can be resolved from space name (e.g., "outhouse" → lookup `spaces` where name ilike '%outhouse%')
- Default `status = 'open'`

---

### `users` — App User Accounts

**Table:** `app_users`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff sees basic info. Admin sees full. |
| get | 2 | |
| create | 3 | Admin only (use invitations for normal flow) |
| update | 3 | Admin only. Self-update for profile fields at level 1 (see `profile` resource). |
| delete | 4 | Oracle only |

**Key columns:** `id`, `supabase_auth_id`, `email`, `role` (admin/staff/resident/associate/demo), `display_name`, `first_name`, `last_name`, `phone`, `phone2`, `avatar_url`, `bio`, `person_id` (FK→people), `nationality`, `location_base`, `gender`, `privacy_phone`, `privacy_email`, `privacy_bio` (public/residents/private), `facebook_url`, `instagram_url`, `linkedin_url`, `x_url`, `discord_id`, `created_at`, `last_sign_in_at`

---

### `profile` — Self-Service Profile (Current User)

**Table:** `app_users` (scoped to self)

| Action | Min Level | Notes |
|--------|-----------|-------|
| get | 1 | Returns own profile only |
| update | 1 | Can only update allowed fields: display_name, first_name, last_name, phone, phone2, bio, avatar_url, nationality, location_base, gender, privacy_*, social URLs |

---

### `vehicles` — Vehicle Fleet

**Table:** `vehicles`, `vehicle_drivers`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | All residents see all vehicles |
| get | 1 | Includes last_state JSONB |
| create | 3 | Admin only |
| update | 2 | Staff can update state. Admin for config. |
| delete | 3 | Admin only |

**Key columns:** `id`, `account_id` (FK→tesla_accounts), `vehicle_api_id`, `vin`, `name`, `make`, `model`, `year`, `color`, `color_hex`, `svg_key`, `image_url`, `owner_name`, `display_order`, `is_active`, `vehicle_state` (online/asleep/offline/unknown), `last_state` (JSONB), `last_synced_at`

**last_state JSONB includes:** `battery_level`, `range_miles`, `charging_state`, `locked`, `latitude`, `longitude`, `speed_mph`, `odometer_miles`, `inside_temp_f`, `outside_temp_f`, `tire_pressure_fl/fr/rl/rr`

---

### `media` — Photos & Media Library

**Tables:** `media`, `media_spaces`, `media_tags`, `media_tag_assignments`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Public access (marketing photos). Supports tag/space filters. |
| get | 0 | |
| create | 2 | Upload with category, caption. Link to space. |
| update | 2 | Update caption, tags, space links, display_order |
| delete | 2 | Staff+ |

**Key columns (media):** `id`, `url`, `width`, `height`, `caption`, `category` (mktg/property/maintenance/ai-gen), `file_size_bytes`, `created_at`

---

### `payments` — Accounting Ledger

**Table:** accounting/payments tables

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | |
| create | 2 | Record payment (Zelle, check, cash, Square, etc.) |
| update | 3 | Admin only |
| delete | 4 | Oracle only |

---

### `bug_reports` — Bug Tracking

**Table:** `bug_reports`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ see all |
| get | 2 | |
| create | 1 | Anyone can report bugs |
| update | 2 | Staff+ (diagnosis, status) |
| delete | 3 | Admin only |

**Key columns:** `id`, `title`, `description`, `page_url`, `severity`, `status` (pending/in_progress/fixed/wontfix), `reported_by`, `diagnosis`, `notes`, `screenshot_url`, `user_agent`, `browser_name`, `created_at`

---

### `time_entries` — Associate Work Hours

**Tables:** `time_entries`, `work_photos`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Associates: own only. Staff+: all. |
| get | 1 | Same scoping |
| create | 1 | Associates clock in/out. Staff can create manual entries. |
| update | 1 | Own entries only (level 1). Staff+ any. |
| delete | 2 | Staff+ |

**Key columns:** `id`, `associate_id` (FK→associate_profiles), `space_id` (FK→spaces), `clock_in`, `clock_out`, `duration_minutes`, `is_manual`, `manual_reason`, `notes`, `latitude`, `longitude`, `status` (active/completed/paid), `paid_at`, `payout_id`

---

### `events` — Event Hosting Requests

**Table:** `event_requests` (or rental_applications with event type)

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Residents see own. Staff+ see all. |
| get | 1 | |
| create | 1 | Anyone can submit event request |
| update | 2 | Staff+ manage pipeline |
| delete | 3 | Admin only |

---

### `documents` — Document Library

**Table:** `document_index`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 1 | Browse available documents |
| get | 1 | Returns content_text or download URL |
| create | 2 | Staff+ upload documents |
| update | 2 | Staff+ |
| delete | 3 | Admin only |

**Key columns:** `id`, `slug`, `title`, `description`, `keywords` (text[]), `source_url`, `file_type`, `file_size_bytes`, `storage_backend` (supabase/r2), `storage_bucket`, `storage_path`, `content_text`, `is_active`, `uploaded_by`, `created_at`

---

### `sms` — SMS Messages

**Table:** `sms_messages`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ view conversation threads |
| get | 2 | Single message |
| create | 2 | Send SMS (calls send-sms edge function) |

**Key columns:** `id`, `person_id` (FK→people), `direction` (inbound/outbound), `from_number`, `to_number`, `body`, `sms_type`, `telnyx_id`, `status`, `created_at`

---

### `faq` — PAI Knowledge Base

**Table:** `faq_context_entries`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 0 | Public FAQ content |
| get | 0 | |
| create | 3 | Admin only |
| update | 3 | Admin only |
| delete | 3 | Admin only |

**Key columns:** `id`, `title`, `content`, `display_order`, `is_active`

---

### `invitations` — User Invitations

**Table:** `user_invitations`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | |
| create | 2 | Staff+ send invitations |
| update | 3 | Admin only |
| delete | 3 | Admin only |

**Key columns:** `id`, `email`, `role`, `invited_by`, `expires_at`, `accepted_at`

---

### `password_vault` — Credentials Store

**Table:** `password_vault`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff see house+platform+service categories. Admin sees all. Residents see only house category for their spaces. |
| get | 2 | |
| create | 3 | Admin only |
| update | 3 | Admin only |
| delete | 3 | Admin only |

**Key columns:** `id`, `service`, `username`, `password`, `category` (house/platform/service/vendor), `space_id` (FK→spaces), `notes`, `is_active`

---

### `feature_requests` — PAI Feature Builder Queue

**Table:** `feature_requests`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 2 | Staff+ |
| get | 2 | |
| create | 2 | Staff+ submit feature requests |
| update | 2 | Status updates |
| delete | 3 | Admin only |

---

### `pai_config` — PAI System Configuration

**Table:** `pai_config`

| Action | Min Level | Notes |
|--------|-----------|-------|
| get | 3 | Admin only |
| update | 3 | Admin only (identity, property_info, amenities, addenda) |

---

### `tesla_accounts` — Tesla Fleet API Credentials

**Table:** `tesla_accounts`

| Action | Min Level | Notes |
|--------|-----------|-------|
| list | 3 | Admin only |
| get | 3 | |
| update | 3 | Token refresh, credentials |

---

## PAI Integration

### Phase 1: Add Database Schema to System Prompt

Add a compact `DATABASE SCHEMA` section to `buildSystemPrompt()` in `alpaca-pai/index.ts` that lists all resources, their key fields, and relationships. Keep it token-efficient — table name, purpose, key columns only.

### Phase 2: Add `manage_data` Tool

Add a single generic tool to PAI that delegates to the API:

```typescript
{
  name: "manage_data",
  description: "Create, read, update, or delete data in the property management system. Use this for tasks, people, assignments, bug reports, and other operational data.",
  parameters: {
    type: "object",
    properties: {
      resource: {
        type: "string",
        enum: ["tasks", "people", "assignments", "bug_reports", "time_entries", "events", "documents", "sms", "vehicles"],
        description: "The data resource to operate on"
      },
      action: {
        type: "string",
        enum: ["list", "get", "create", "update", "delete"],
        description: "The operation to perform"
      },
      id: {
        type: "string",
        description: "Record ID (for get/update/delete)"
      },
      data: {
        type: "object",
        description: "Fields to set (for create/update)"
      },
      filters: {
        type: "object",
        description: "Filter criteria (for list)"
      }
    },
    required: ["resource", "action"]
  }
}
```

### Phase 3: API Key Support (Future)

For third-party applets, add `X-API-Key` header auth that maps to an `api_keys` table:

```sql
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL,
  role_level integer NOT NULL DEFAULT 1,
  app_user_id uuid REFERENCES app_users(id),
  scopes text[] DEFAULT '{}',
  rate_limit_per_minute integer DEFAULT 60,
  is_active boolean DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## Implementation Plan

### Step 1: Create the API Edge Function

- `supabase/functions/api/index.ts` — router + auth middleware
- `supabase/functions/_shared/api-permissions.ts` — permission matrix
- `supabase/functions/_shared/api-helpers.ts` — common query builders, response formatters

### Step 2: Implement Resource Handlers

Start with the most impactful resources:
1. `tasks` (PAI can create project items)
2. `people` (PAI can look up contacts)
3. `spaces` (unified space queries)
4. `assignments` (occupancy queries)
5. `bug_reports` (anyone can file bugs)

Then add remaining resources iteratively.

### Step 3: Update PAI

- Add database schema to system prompt
- Add `manage_data` tool declaration
- Implement tool execution that calls the API edge function
- Deploy both `api` and `alpaca-pai`

### Step 4: Cost Tracking

Log all API calls to `api_usage_log`:
```typescript
await supabase.from('api_usage_log').insert({
  vendor: 'alpacapps_api',
  category: `api_${resource}_${action}`,
  endpoint: `${resource}/${action}`,
  units: 1,
  unit_type: 'api_calls',
  estimated_cost_usd: 0,
  metadata: { caller: appUser.display_name, role: appUser.role },
  app_user_id: appUser.id
});
```

---

## Test Scenarios

1. **Email to PAI:** "Add this to the projects list and assign to Jon, for outhouse"  
   → PAI classifies as command → calls `manage_data` with `resource: "tasks"`, `action: "create"`, resolves "Jon" to person, "outhouse" to space

2. **Chat to PAI:** "What tasks are assigned to Donny?"  
   → PAI calls `manage_data` with `resource: "tasks"`, `action: "list"`, `filters: { assigned_name: "Donny" }`

3. **Voice to PAI:** "Who's living in the Spartan right now?"  
   → PAI calls `manage_data` with `resource: "assignments"`, `action: "list"`, resolves Spartan to space_id, filters active

4. **Third-party applet:** Automation that creates a task when a sensor triggers  
   → `POST /functions/v1/api` with API key, `resource: "tasks"`, `action: "create"`

---

## Files to Read Before Implementing

- `supabase/functions/alpaca-pai/index.ts` — current PAI (system prompt, tools, executeToolCall, all channels)
- `supabase/functions/_shared/permissions.ts` — existing permission helper (`getAppUserWithPermission`)
- `shared/project-service.js` — tasks table CRUD patterns
- `shared/hours-service.js` — time entries CRUD patterns
- `CLAUDE.md` — complete database schema reference
- `associates/projects.js` — GUI operations PAI should match
- `spaces/admin/projects.js` — admin GUI for tasks

---

## Deploy Commands

```bash
# New API function
supabase functions deploy api --no-verify-jwt

# Updated PAI function
supabase functions deploy alpaca-pai --no-verify-jwt

# Then commit and push
git add -A && git commit -m "Add internal REST API + PAI data tools" && git push origin main
```
