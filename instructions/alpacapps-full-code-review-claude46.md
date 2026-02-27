# AlpacApps Full Code Review Implementation Brief (for Claude 4.6)

## Objective

Review and implement improvements across the project in four areas:

1. Bugs
2. Design problems
3. Performance opportunities
4. Isolation of property-specific behavior from cloneable infra (including `docs/alpacappsinfra.html`)

This document is intended as an actionable implementation backlog.

## Scope

- Included: whole repo except `mistiq/`
- Reviewed surfaces:
  - Client/UI code in `shared/`, `residents/`, `spaces/`, `associates/`, `mobile/`
  - Edge functions in `supabase/functions/`
  - Infra/scripts/docs in `scripts/`, `docs/`, template/seed SQL

---

## P0 - Critical Findings

## 1) Missing API usage cost logging in multiple edge functions

### Why this matters
- Project standards require logging external API usage to `api_usage_log`.
- Missing logs block cost visibility and category-level accounting.

### Affected files (high confidence)
- `supabase/functions/nest-control/index.ts`
- `supabase/functions/govee-control/index.ts`
- `supabase/functions/tesla-command/index.ts`
- `supabase/functions/lg-control/index.ts`
- `supabase/functions/sonos-control/index.ts`

### Required implementation pattern

```ts
await supabaseAdmin.from('api_usage_log').insert({
  vendor: 'google_sdm',
  category: 'nest_climate_control',
  endpoint: 'devices.executeCommand',
  units: 1,
  unit_type: 'api_calls',
  estimated_cost_usd: 0,
  metadata: { command: 'SetMode', success: true },
  app_user_id: user?.id ?? null
});
```

### Notes
- Use exact vendor/category strings from repo standards.
- Log success and failure paths (attach error summary in `metadata`).

## 2) Hardcoded property/domain/email values across runtime paths

### Why this matters
- Prevents easy cloning for new properties.
- Creates brittle environment coupling and repeated edits.

### Confirmed hotspots
- `supabase/functions/alpaca-pai/index.ts` (address, email, wifi, camera domain)
- `supabase/functions/send-email/index.ts` (hardcoded URLs/domains)
- `supabase/functions/stripe-webhook/index.ts` (property email/domain/address)
- `supabase/functions/nest-control/index.ts` (hardcoded redirect URL)
- `shared/worktrade-template-service.js`, `shared/lease-template-service.js`, `shared/event-template-service.js`
- `residents/cars.js`, `residents/profile.js`, `shared/site-components.js`
- `scripts/seed-email-templates.sql`

### Target refactor
- Centralize property-specific values into config loader(s):
  - Client: `shared/config-loader.js`
  - Edge: `supabase/functions/_shared/config.ts`
- Source of truth:
  - Preferred: DB-backed singleton (`brand_config` + optional `property_config`)
  - Fallback: env vars

```ts
// supabase/functions/_shared/config.ts
export async function getPropertyConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin.from('property_config').select('*').single();
  return data ?? {
    domain: Deno.env.get('PROPERTY_DOMAIN') ?? '',
    base_url: Deno.env.get('PROPERTY_BASE_URL') ?? '',
    contact_email: Deno.env.get('PROPERTY_CONTACT_EMAIL') ?? ''
  };
}
```

---

## P1 - High Findings

## 3) Non-atomic multi-table operations in API function

### Why this matters
- Partial failures can leave inconsistent state across linked tables.

### Affected area
- `supabase/functions/api/index.ts` (assignment + related records flows, media linking flows)

### Improvement
- Move multi-step writes into SQL RPC transaction wrappers.

```sql
create or replace function create_assignment_with_spaces(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  assignment_row assignments;
begin
  insert into assignments (...) values (...) returning * into assignment_row;
  insert into assignment_spaces (assignment_id, space_id)
  select assignment_row.id, (value::uuid)
  from jsonb_array_elements_text(payload->'space_ids');
  return to_jsonb(assignment_row);
exception when others then
  raise;
end;
$$;
```

## 4) Shell duplication and divergence risk

### Why this matters
- `shared/admin-shell.js` and `shared/resident-shell.js` duplicate significant behavior (user menu, toast, lightbox, shell wiring), causing drift bugs.

### Improvement
- Extract common modules:
  - `shared/ui/toast.js`
  - `shared/ui/lightbox.js`
  - `shared/ui/user-menu.js`
  - optional `shared/base-shell.js`

```js
// shared/ui/toast.js
export function showToast(message, type = 'info') {
  const el = document.getElementById('globalToast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2600);
}
```

## 5) Risky DOM replacement pattern in thermostat UI

### Why this matters
- `outerHTML` or full-card replacement removes listeners and transient state.

### Affected area
- `residents/thermostat.js`

### Improvement
- Update child nodes in place.

```js
function patchCard(card, state) {
  card.querySelector('[data-current-temp]').textContent = `${Math.round(state.tempF)}F`;
  card.querySelector('[data-mode]').textContent = state.mode || 'Off';
  card.classList.toggle('is-offline', !state.online);
}
```

---

## P2 - Medium Findings

## 6) Polling and listener cleanup inconsistencies

### Why this matters
- Potential memory leaks and unnecessary background work.

### Affected pages
- `residents/laundry.js`
- `residents/cars.js`
- `residents/thermostat.js`
- `residents/sonos.js`

### Improvement
- Standardize lifecycle with `PollManager`.
- Ensure every `addEventListener` has teardown in module destroy/unload.

```js
let cleanupFns = [];

function on(el, event, handler, opts) {
  el.addEventListener(event, handler, opts);
  cleanupFns.push(() => el.removeEventListener(event, handler, opts));
}

export function dispose() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  poll?.stop();
}
```

## 7) Missing request cancellation for rapid UI actions

### Why this matters
- User can trigger overlapping requests, causing stale overwrites.

### Improvement
- Use `AbortController` per request type.

```js
let pendingController = null;

async function refreshData() {
  pendingController?.abort();
  pendingController = new AbortController();
  const response = await fetch(url, { signal: pendingController.signal });
  return response.json();
}
```

## 8) N+1 query pattern in API filtering paths

### Why this matters
- Extra DB round trips increase latency under load.

### Affected area
- `supabase/functions/api/index.ts` assignment filtering by linked spaces

### Improvement
- Replace prefetch + filter with join/subquery or RPC endpoint that handles filtering server-side.

---

## P3 - Low/Medium Findings (Infra cloning + docs/scripts)

## 9) `docs/alpacappsinfra.html` contains property/user-specific template references

### Why this matters
- Should be clone-ready for new property onboarding without manual edits.

### Improvement
- Convert hardcoded repo/user links to placeholders and generated values.

```html
<!-- before -->
https://github.com/rsonnad/alpacapps-infra

<!-- after -->
https://github.com/{{GITHUB_USERNAME}}/{{INFRA_TEMPLATE_REPO}}
```

## 10) Property-specific mappings and domains hardcoded in scripts

### Affected files
- `scripts/generate-ical.js` (name/slug mapping, UID domain)
- `scripts/ptz-proxy/ptz-proxy.js` (default allowed origins)
- `mobile/scripts/copy-web.js` (hardcoded copy set may be property-specific)

### Improvement
- Add central script config:
  - `scripts/lib/config.js`
  - `scripts/config.example.json`

```js
// scripts/lib/config.js
export function getConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    propertyDomain: process.env.PROPERTY_DOMAIN,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
  };
}
```

## 11) Seeded email templates embed property-specific URLs/emails

### Affected file
- `scripts/seed-email-templates.sql`

### Improvement
- Replace literals with template tokens:
  - `{{base_url}}`
  - `{{team_email}}`
  - `{{support_email}}`
  - `{{github_commit_url}}`

---

## Consolidated Property Isolation Plan

Implement these in order:

1. **Config schema**
   - Add `property_config` table (or expand `brand_config`) with:
     - `domain`, `base_url`, `contact_email`, `address`, `camera_base_url`, `wifi_name`
2. **Loaders**
   - Create `shared/config-loader.js`
   - Create `supabase/functions/_shared/config.ts`
3. **Runtime refactor**
   - Replace hardcoded domains/emails/addresses in runtime files with loader usage
4. **Docs/scripts templating**
   - Convert `docs/alpacappsinfra.html` and seed/template scripts to placeholder-driven generation
5. **Validation**
   - Add startup/runtime checks to fail fast when required property config is missing

---

## Suggested Task Breakdown for Claude 4.6

## Phase A (fast wins, low risk)
- Add missing `api_usage_log` inserts for all external API edge calls.
- Remove obvious hardcoded URLs in edge functions and client files where simple config replacement is straightforward.

## Phase B (stability and maintainability)
- Extract shared shell UI utilities (toast/lightbox/user menu).
- Replace thermostat DOM replacement patterns with in-place patching.
- Add AbortController and listener teardown in resident pages.

## Phase C (infra cloning readiness)
- Implement centralized property config model and loaders.
- Refactor `docs/alpacappsinfra.html` placeholders and script/template config.
- Update seed SQL templates to tokenized URLs/emails.

---

## Acceptance Criteria

- [ ] All external API edge integrations log usage to `api_usage_log` with correct vendor/category.
- [ ] No hardcoded `alpacaplayhouse.com`, property address, or property-specific email in runtime code paths where config can be used.
- [ ] Shell duplication reduced via shared modules; behavior parity retained.
- [ ] Polling/listener lifecycle is leak-safe on resident pages.
- [ ] `docs/alpacappsinfra.html` and related setup guidance are template-friendly for new property clones.
- [ ] Regression checks pass for resident pages (cameras, climate, lighting, sonos, laundry, cars) and admin shell navigation.

---

## Quick File Checklist (start here)

- `docs/alpacappsinfra.html`
- `supabase/functions/alpaca-pai/index.ts`
- `supabase/functions/send-email/index.ts`
- `supabase/functions/nest-control/index.ts`
- `supabase/functions/govee-control/index.ts`
- `supabase/functions/tesla-command/index.ts`
- `supabase/functions/lg-control/index.ts`
- `supabase/functions/sonos-control/index.ts`
- `supabase/functions/api/index.ts`
- `shared/admin-shell.js`
- `shared/resident-shell.js`
- `residents/thermostat.js`
- `residents/cameras.js`
- `scripts/generate-ical.js`
- `scripts/seed-email-templates.sql`

