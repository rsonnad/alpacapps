# Template Architecture & Deprecation Rationalization Brief

## Objective

Use this document as an implementation and evaluation brief for a follow-on agent.

Goals:

1. Make the codebase easier to reuse as a template/starter for other properties or organizations.
2. Make future upstream enhancements easier for adopters to pull back in.
3. Rationalize deprecated, transitional, or duplicate structures in both code and database.
4. Reduce architecture drift between frontend, edge functions, workers, docs, and schema.

This is not just a code cleanup exercise. The core product question is:

> How do we turn "one very capable custom deployment" into "a reusable platform with property-specific extensions"?

---

## North Star

The target end state should have these properties:

- Core business domains are reusable: spaces, people, assignments, media, payments, auth, invites, documents.
- Property-specific behavior is isolated behind config, feature flags, adapters, or extension packages.
- Backend contracts are stable and typed enough that adopters can extend safely.
- Deprecated structures have a clear migration path and are either removed, archived, or compatibility-wrapped.
- A future adopter can enable only the modules they need and still accept upstream improvements without deep manual merge work.

---

## Live Findings Summary

These findings were confirmed from the repo and, where noted, from the live database.

### Confirmed live DB signals

- `photos` still has `4` rows.
- `photo_spaces` still has `4` rows.
- `tesla_vehicles` does not exist in the live database.
- `app_users` contains one user with role `demon`, while the centralized API expects `demo`.

### Confirmed repo signals

- `app.js` still writes to `photos` and `photo_spaces`.
- `spaces/app.js` already uses `media` and `media_spaces`.
- Tesla helper scripts still reference `tesla_vehicles`.
- `shared/chat-widget.js` and `spaces/verify.html` still call `functions/v1/ask-question`.
- `shared/pai-widget.js` calls `functions/v1/alpaca-pai`.
- `supabase/functions/pai-api/index.ts` forwards to `alpaca-pai`, suggesting overlapping PAI entrypoints.
- `supabase/functions/_shared/api-permissions.ts` defines `demo`, while migrations still reference `demon`.
- `supabase/functions/api/index.ts` contains inline auth, permissions, row scoping, validation, resource handlers, and multi-table writes in one file.
- Many config tables still follow the singleton `id = 1` pattern.
- Migration history is split across `migrations/` and `supabase/migrations/`.

---

## Recommended Priority Order

### P0: Foundational architecture for template-ability

1. Introduce a first-class `org` or `tenant` boundary.
2. Centralize runtime property/platform configuration.
3. Unify auth and permission models.
4. Break up the centralized API and move multi-table mutations into transactional SQL/RPC.
5. Separate reusable product modules from property-specific extensions.

### P1: High-value cleanup and deprecation rationalization

6. Complete the `photos` -> `media` migration.
7. Remove `tesla_vehicles` leftovers.
8. Consolidate PAI entrypoints.
9. Finish the unified lighting control migration and retire vendor-specific fallbacks where possible.
10. Remove legacy internal auth env aliases after verifying callers.
11. Consolidate migrations and schema bootstrap.
12. Consolidate stale docs, temp files, and reference-only artifacts.

### P2: Developer ergonomics and adoption tooling

13. Create a shared frontend API client and shell core.
14. Create a feature registry so adopters can enable only selected modules.
15. Add import/export/bootstrap tooling for adoption and upgrade paths.

---

## P0 Recommendations

## 1) Make `org_id` the root of the platform

### Why this matters

- The repo is still structurally single-tenant.
- A template product cannot depend on singleton rows, one property identity, one domain, and one set of device integrations.
- Without an org boundary, "reusable" means cloning a custom app, not adopting a platform.

### Current issues

- Many tables and edge functions assume one deployment.
- Storage buckets are not org-prefixed.
- Config tables are mostly one-row singleton tables.
- Frontend shells and docs assume one property and one app identity.

### Recommended end state

- Add `orgs`.
- Add `org_id` to tenant-owned tables.
- Add `org_features` or `orgs.features`.
- Add org-scoped config rows instead of `id = 1` singletons.
- Resolve org from auth context for normal requests and deterministic lookup rules for webhooks.

### Example schema direction

```sql
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'core',
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_users add column if not exists org_id uuid references orgs(id);
alter table spaces add column if not exists org_id uuid references orgs(id);
alter table people add column if not exists org_id uuid references orgs(id);
alter table assignments add column if not exists org_id uuid references orgs(id);
alter table media add column if not exists org_id uuid references orgs(id);
alter table sms_messages add column if not exists org_id uuid references orgs(id);
alter table document_index add column if not exists org_id uuid references orgs(id);
```

### Implementation notes

- Start with one default org representing the current AlpacApps deployment.
- Backfill all existing data into that org.
- Do not attempt full multi-tenant feature completion in one pass; establish the data model first.

---

## 2) Centralize property/platform configuration

### Why this matters

- Reuse currently depends on editing hardcoded names, domains, addresses, email senders, payment handles, and mobile app identity in many places.
- This makes cloning fragile and upstream sync painful.

### Current issues

- Property-specific values are spread across frontend files, edge functions, workers, docs, and app config.
- Existing `brand_config` is useful but only covers visual identity, not operational identity.
- The repo already contains a good start in `instructions/property-config-centralization.md`.

### Recommended end state

- Add `property_config` for runtime property identity and operational settings.
- Keep `brand_config` for visual tokens only.
- Add a shared client loader and shared edge-function loader.
- For truly build-time items like mobile bundle ID, use build manifests instead of DB runtime config.

### Example config split

```json
{
  "property": {
    "name": "Alpaca Playhouse",
    "short_name": "AlpacApps",
    "address": "160 Still Forest Dr, Cedar Creek, TX 78612",
    "timezone": "America/Chicago"
  },
  "domain": {
    "primary": "alpacaplayhouse.com",
    "github_pages": "rsonnad.github.io/alpacapps",
    "camera_proxy": "cam.alpacaplayhouse.com"
  },
  "email": {
    "team": "team@alpacaplayhouse.com",
    "notifications_from": "notifications@alpacaplayhouse.com",
    "noreply_from": "noreply@alpacaplayhouse.com"
  },
  "payment": {
    "zelle_email": "alpacaplayhouse@gmail.com",
    "venmo_handle": "@AlpacaPlayhouse"
  }
}
```

### Example client pattern

```javascript
// shared/config-loader.js
import { getSupabase } from './supabase.js';

let cachedConfig = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getPropertyConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) return cachedConfig;

  const supabase = getSupabase();
  const { data } = await supabase
    .from('property_config')
    .select('config')
    .eq('id', 1)
    .single();

  cachedConfig = data?.config ?? {};
  cacheTimestamp = now;
  return cachedConfig;
}
```

### Example edge-function pattern

```ts
// supabase/functions/_shared/property-config.ts
export async function getPropertyConfig(supabase: any) {
  const { data } = await supabase
    .from('property_config')
    .select('config')
    .eq('id', 1)
    .single();

  return data?.config ?? {};
}
```

---

## 3) Unify permissions and auth semantics

### Why this matters

- There are two overlapping authorization systems:
  - centralized API role levels
  - permission-key-based logic in other functions
- This invites drift and creates real inconsistencies.

### Confirmed problem

- The API permission map expects `demo`.
- Existing migration data uses `demon`.
- The live DB has one `demon` user.

### Recommended end state

- Pick one canonical role vocabulary.
- Pick one canonical source of truth for permissions.
- Prefer DB-backed permission resolution or generate static code from DB definitions.
- Normalize internal service authentication to one path.

### Immediate fix

Pick one of:

- Standardize on `demo`
- Standardize on `demon`

and then update both DB constraints and code accordingly.

### Example migration

```sql
update app_users
set role = 'demo'
where role = 'demon';

update user_invitations
set role = 'demo'
where role = 'demon';

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public'));

alter table user_invitations drop constraint if exists user_invitations_role_check;
alter table user_invitations add constraint user_invitations_role_check
  check (role in ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public'));
```

### Follow-up improvement

Create one shared auth helper for edge functions:

```ts
export interface RequestAuthContext {
  appUserId: string | null;
  orgId: string | null;
  role: string | null;
  userLevel: number;
  isServiceRole: boolean;
}
```

---

## 4) Break up the centralized API and move write orchestration into SQL/RPC

### Why this matters

- `supabase/functions/api/index.ts` is doing too much.
- Inline row scoping is easy to miss.
- Multi-table writes are non-atomic.
- The larger this file gets, the harder it will be for adopters to safely extend it.

### Current issues

- Resource logic, auth, validation, joins, writes, and logging are all mixed together.
- Some row-scope behavior appears inconsistent across `list` vs `get`.
- Junction-table operations can partially fail.

### Recommended end state

- Split the API into resource modules.
- Move multi-table writes to DB functions or RPC wrappers.
- Make resource behavior declarative where possible.

### Example target shape

```text
supabase/functions/api/
  index.ts
  resources/
    spaces.ts
    people.ts
    assignments.ts
    tasks.ts
    media.ts
  lib/
    auth.ts
    validation.ts
    responses.ts
    usage.ts
```

### Example resource spec

```ts
export const assignmentResource = {
  name: 'assignments',
  allowedFilters: ['status', 'person_id', 'space_id', 'active'],
  allowedSorts: ['start_date', 'end_date', 'created_at'],
  minLevels: {
    list: 1,
    get: 1,
    create: 2,
    update: 2,
    delete: 3,
  },
  rowScope: 'person_id',
};
```

### Example transactional RPC

```sql
create or replace function api_upsert_assignment(
  p_assignment_id uuid,
  p_assignment jsonb,
  p_space_ids uuid[]
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  if p_assignment_id is null then
    insert into assignments (person_id, start_date, end_date, status, monthly_rate)
    values (
      (p_assignment->>'person_id')::uuid,
      (p_assignment->>'start_date')::date,
      (p_assignment->>'end_date')::date,
      p_assignment->>'status',
      nullif(p_assignment->>'monthly_rate', '')::numeric
    )
    returning id into v_id;
  else
    update assignments
    set
      person_id = coalesce((p_assignment->>'person_id')::uuid, person_id),
      start_date = coalesce((p_assignment->>'start_date')::date, start_date),
      end_date = coalesce((p_assignment->>'end_date')::date, end_date),
      status = coalesce(p_assignment->>'status', status)
    where id = p_assignment_id
    returning id into v_id;
  end if;

  delete from assignment_spaces where assignment_id = v_id;

  insert into assignment_spaces (assignment_id, space_id)
  select v_id, unnest(p_space_ids);

  return v_id;
end;
$$;
```

---

## 5) Separate reusable product modules from property-specific extensions

### Why this matters

- A future adopter may want rentals, documents, messaging, and admin tools, but not Tesla, Alexa, WiZ, Glowforge, or Sonos.
- Without modular boundaries, every adopter inherits all assumptions and complexity.

### Recommended end state

- Define "core platform" vs "optional feature packages".
- Drive nav visibility, backend access, and docs through a feature registry.

### Example target structure

```text
apps/
  web/
  mobile/
  workers/
packages/
  platform-config/
  contracts/
  api-client/
  shell-core/
  features/
    core-rentals/
    core-media/
    core-documents/
    core-payments/
    smart-home/
    voice/
    vehicles/
tools/
  bootstrap-org/
  seed-demo/
  export-import/
```

### Example feature registry

```ts
export const FEATURES = {
  rentals: { label: 'Rentals', defaultEnabled: true },
  media: { label: 'Media', defaultEnabled: true },
  lighting: { label: 'Lighting', defaultEnabled: false },
  cameras: { label: 'Cameras', defaultEnabled: false },
  music: { label: 'Music', defaultEnabled: false },
  climate: { label: 'Climate', defaultEnabled: false },
  cars: { label: 'Cars', defaultEnabled: false },
  laundry: { label: 'Laundry', defaultEnabled: false },
  pai: { label: 'PAI', defaultEnabled: false }
};
```

---

## P1 Rationalization Recommendations

## 6) Complete the `photos` -> `media` migration

### Why this matters

- This is the clearest confirmed deprecated structure still alive in both repo and DB.
- Keeping both models increases confusion and blocks a clean template story for media.

### Confirmed state

- `spaces/app.js` already uses `media` and `media_spaces`.
- `app.js` still writes to `photos` and `photo_spaces`.
- Live DB still has `4` rows in `photos` and `4` rows in `photo_spaces`.

### Recommended end state

- `media` and `media_spaces` become the only supported image model.
- Either retire the legacy root `app.js` path or migrate it fully.
- If compatibility is needed temporarily, use a short-lived compatibility view or shim.

### Example migration approach

```sql
insert into media (id, url, caption, created_at)
select gen_random_uuid(), p.url, p.caption, now()
from photos p
where not exists (
  select 1
  from media m
  where m.url = p.url
);
```

Then backfill `media_spaces` from `photo_spaces`, update code paths, validate, and only then drop the legacy tables.

### Follow-up tasks

- Search for all writes to `photos` and `photo_spaces`.
- Determine whether legacy UI routes are still active.
- Move any surviving workflows, including admin upload flows, to `media-service.js`.

---

## 7) Remove `tesla_vehicles` leftovers

### Why this matters

- The runtime model is `vehicles`, but scripts and docs still mention `tesla_vehicles`.
- This creates wrong guidance for future agents and adopters.

### Confirmed state

- Live DB does not have `tesla_vehicles`.
- `scripts/update-tesla-images.js`
- `scripts/generate-tesla-photos.js`
- `scripts/README-tesla-images.md`

still reference `tesla_vehicles`.

### Recommended end state

- Either update those scripts to `vehicles` and keep them as supported maintenance tools,
- or archive/remove them if they were only used for a one-time migration.

### Suggested rule

- If a script references a dead table, it should either be fixed immediately or moved to an archive location with an explicit "historical only" label.

---

## 8) Consolidate PAI entrypoints

### Why this matters

- Multiple assistant entrypoints create prompt drift, logging drift, and feature inconsistency.
- Template adopters need one obvious assistant backend.

### Confirmed state

- `alpaca-pai` appears to be the canonical assistant.
- `ask-question` is still actively called by some public-facing flows.
- `pai-api` forwards to `alpaca-pai`.

### Recommended end state

- Use `alpaca-pai` as the canonical assistant engine.
- Keep thin wrappers only where policy differs, such as public-safe mode vs authenticated mode.
- Remove `pai-api` if it has no external consumers.

### Example pattern

```ts
// Wrapper example
return invokePai({
  mode: 'public_faq',
  message,
  caller: authContext,
  limits: { tools: ['faq', 'documents'], maxTokens: 1200 }
});
```

### Follow-up tasks

- Verify whether any external integrations call `pai-api` directly.
- Compare prompts, logging, and tool access between `ask-question` and `alpaca-pai`.
- Consolidate only after confirming no external breakage.

---

## 9) Finish unified lighting architecture and retire transitional fallbacks

### Why this matters

- Lighting control is still in a transition from vendor-specific logic to unified grouping.
- That is exactly the kind of temporary architecture that becomes permanent if not closed out.

### Current issues

- `home-assistant-control` still allows fallbacks.
- `alexa-room-control` remains present.
- Some docs still describe incomplete Home Assistant setup.
- WiZ/Govee assumptions remain in parts of the stack.

### Recommended end state

- One canonical room-lighting control plane.
- One mapping model from room/group -> targets.
- Vendor adapters only behind the canonical service, not in user-facing logic.

### Example abstraction

```ts
export interface LightingAdapter {
  getState(groupId: string): Promise<LightingState>;
  setPower(groupId: string, on: boolean): Promise<void>;
  setBrightness(groupId: string, percent: number): Promise<void>;
  setColor(groupId: string, color: LightingColor): Promise<void>;
}
```

### Sequencing

1. Complete HA config and entity sync.
2. Validate parity with current lighting behavior.
3. Turn off fallbacks in non-test mode.
4. Remove or archive vendor-direct escape hatches.

---

## 10) Remove legacy service auth aliases

### Why this matters

- Accepting multiple internal service-key env names creates ambiguous trust boundaries and deployment drift.

### Confirmed examples

- `LEGACY_SERVICE_ROLE_KEY`
- `SERVICE_ROLE_JWT`
- `SUPABASE_SECRET_KEY`

### Recommended end state

- One canonical internal auth path.
- One canonical env var: `SUPABASE_SERVICE_ROLE_KEY`.

### Migration note

- Inventory callers before removal.
- Update workers, scripts, and external callers first.
- Then remove fallback env handling from code.

---

## 11) Consolidate migrations and schema bootstrap

### Why this matters

- Reusability depends on reproducible schema setup.
- Split migration histories increase bootstrap uncertainty.

### Current issues

- Both `migrations/` and `supabase/migrations/` exist.
- Naming styles are mixed.
- Some important tables do not appear to have obvious tracked creation migrations in the checked directories.

### Recommended end state

- One authoritative schema migration directory.
- Clear separation of schema, backfill, and seed concerns.
- A documented bootstrap flow that can recreate the entire database from repo state.

### Example convention

```text
supabase/migrations/
  20260310_001_core_schema.sql
  20260310_002_rls.sql
  20260310_003_backfill_default_org.sql
  20260310_004_seed_defaults.sql
```

### Follow-up tasks

- Inventory all live tables.
- Map each table to a migration.
- Create catch-up migrations for missing schema history.

---

## 12) Consolidate stale docs, temp files, and historical artifacts

### Why this matters

- Stale docs push future work toward deprecated patterns.
- Temp files confuse future agents and adopters about what is current and supported.

### Likely candidates

- stale references to `photos` and `tesla_vehicles`
- temporary `tmp-*` files
- reference-only configs that are not actively used
- duplicated architecture/schema explanations

### Recommended end state

- One canonical architecture doc.
- One canonical schema/bootstrap doc.
- One canonical "how to extend the platform" doc.
- Historical material moved to an explicit archive area.

### Suggested structure

```text
docs/
  architecture/
    current-state.md
    target-state.md
    extension-model.md
  schema/
    current-schema.md
    migration-guide.md
  archive/
    legacy-photos-system.md
    old-tesla-image-migration.md
```

---

## P2 Platform Packaging Recommendations

## 13) Introduce a shared API client and contracts layer

### Why this matters

- Today the frontend still mixes direct table queries and ad hoc edge function calls.
- That makes backend evolution difficult and encourages contract drift.

### Recommended end state

- Shared request/response contracts.
- One frontend API client for business operations.
- Direct table reads allowed only for well-defined cache/public cases.

### Example client

```ts
export async function apiRequest<T>(token: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || 'API request failed');
  return json.data as T;
}
```

---

## 14) Unify shell behavior into a shell core

### Why this matters

- `admin-shell.js` and `resident-shell.js` duplicate shell concerns.
- Template adopters will need new shells or nav variants; duplication does not scale.

### Recommended end state

- One shell core.
- Role/feature-aware nav providers.
- Shared lightbox, toast, auth guard, and user-menu modules.

### Example

```js
createShell({
  role: 'resident',
  features,
  tabs: buildResidentTabs(features, permissions),
  services: { auth, toast, lightbox }
});
```

---

## 15) Add adoption tooling

### Why this matters

- Reusable architecture is not enough; adopters need bootstrap and upgrade paths.

### Recommended additions

- `bootstrap-org`
- demo seed data
- export/import format
- feature preset templates such as `core-only`, `hospitality`, `smart-home`
- compatibility and upgrade notes for downstream adopters

### Example preset model

```json
{
  "preset": "core-only",
  "features": {
    "rentals": true,
    "media": true,
    "documents": true,
    "payments": true,
    "lighting": false,
    "cameras": false,
    "cars": false
  }
}
```

---

## Proposed Implementation Sequence

## Phase 0: Decision capture

- Confirm target direction:
  - single-tenant-but-cloneable first, or
  - true multi-tenant platform
- Confirm canonical role vocabulary.
- Confirm whether `alpaca-pai` will become the single assistant engine.

## Phase 1: Foundation

- Add `property_config`.
- Normalize role naming.
- Define feature registry.
- Create shared auth/context model.

## Phase 2: Backend boundaries

- Split `supabase/functions/api/index.ts`.
- Add transactional RPC for multi-table writes.
- Introduce shared usage logger and shared edge-function scaffolding.

## Phase 3: Deprecation closure

- Migrate `photos` to `media`.
- Remove `tesla_vehicles` leftovers.
- Archive or delete dead endpoints/scripts after validation.

## Phase 4: Frontend modularization

- Add `api-client`.
- Add `shell-core`.
- Move direct business logic access behind clients/services.

## Phase 5: Packaging

- Move optional features behind feature flags and extension boundaries.
- Add starter presets and bootstrap tooling.

## Phase 6: Documentation cleanup

- Update canonical docs.
- Archive stale or historical material.
- Document extension rules for adopters.

---

## Acceptance Criteria

The follow-on agent should consider this effort successful when:

- There is one clear path for property/platform configuration.
- There is one clear path for auth and role resolution.
- There is one clear media model.
- Dead table references are gone from supported runtime and scripts.
- PAI entrypoints are clearly intentional, not accidental duplicates.
- Multi-table writes in the centralized API are transactional.
- Migration/bootstrap history can recreate the platform reliably.
- Optional features are describable as modules rather than hardcoded assumptions.
- Docs tell a consistent story about the current architecture and supported extension points.

---

## Good First Tasks for the Next Agent

If the next agent needs a concrete starting backlog, use this order:

1. Fix the `demo` vs `demon` mismatch in code and DB.
2. Write and apply the `property_config` migration and loaders.
3. Inventory and migrate all `photos` / `photo_spaces` code paths to `media`.
4. Split the centralized API into resource modules without changing behavior.
5. Add one transactional RPC for `assignments` + `assignment_spaces`.
6. Decide the fate of `ask-question` and `pai-api`.
7. Remove `tesla_vehicles` references from supported scripts/docs.
8. Create a canonical migration/bootstrap inventory document.

---

## Final Guidance

Do not optimize for elegance alone. Optimize for:

- upgradeability
- adoption by downstream users
- reduction of architecture drift
- deletion of transitional layers
- explicit extension seams

When in doubt, prefer:

- one canonical path over two convenient paths
- data-driven configuration over hardcoded assumptions
- adapters over vendor-specific UI logic
- transactional DB boundaries over multi-step application writes
- a smaller supported surface over many half-supported legacy surfaces


Summary of Changes
8 items from the architecture review implemented in one pass:

demo vs demon role mismatch fixed — DB constraints updated, role_permissions migrated, 12 code files standardized to demo. The silent auth failures for demo users are resolved.

property_config table + loaders created — New singleton table seeded with AlpacApps operational identity (property name, domain, email senders, payment handles, timezone, WiFi, mobile app). Client loader (shared/config-loader.js) and edge function loader (supabase/functions/_shared/property-config.ts) both follow the same 5-min-cache-with-fallback pattern as brand-config.js.

photos → media migration completed — 4 remaining rows migrated from photos/photo_spaces to media/media_spaces. Orphaned root app.js (only consumer of legacy tables, loaded by no HTML page) deleted.

tesla_vehicles references cleaned up — Scripts updated to use vehicles table. Docs updated to drop "renamed from tesla_vehicles" notes.

PAI entrypoint consolidated — pai-api edge function deleted (zero callers, dead proxy). ask-question kept as the intentional anonymous public Q&A endpoint.

Legacy service auth aliases removed — LEGACY_SERVICE_ROLE_KEY, SERVICE_ROLE_JWT, SUPABASE_SECRET_KEY fallbacks removed from home-assistant-control, api-helpers.ts, and alpaca-pai. Single canonical path: SUPABASE_SERVICE_ROLE_KEY.

Temp files and stale artifacts cleaned — 3 tmp-* files deleted, 3 WiZ proxy Python scripts removed.

Feature registry created — shared/feature-registry.js defines 8 core (always-on) and 13 optional (config-driven) modules, with isFeatureEnabled() API for future nav filtering and backend gating.

Edge functions deployed: home-assistant-control, alpaca-pai, api

What was NOT implemented (requires larger design decisions or separate phasing):

P0.1: org_id multi-tenancy (too large for this pass — the brief recommends data model first)
P0.4: API split into resource modules (large refactor, behavior-preserving)
P1.9: Lighting architecture unification (HA transition still in progress)
P1.11: Migration consolidation (inventory effort)
P2: API client, shell core, adoption tooling (forward-looking)
Version: v260306.25 9:51p Machine: runnervm0kj6c Model: o4.6 Links: Admin | Residents