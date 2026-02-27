# Property Config Centralization — Implementation Brief for Claude 4.6

## Objective

Eliminate all hardcoded property-specific values from runtime code by creating a centralized configuration system. This enables cloning the codebase for new properties without manual find-and-replace across 20+ files and 100+ references.

## Why This Matters

The codebase is actively being cloned for other property owners and for reuse of core software features. Every hardcoded `alpacaplayhouse.com`, property address, and brand name is a friction point that requires manual editing per clone. This refactor makes cloning a config-only operation.

## Current State

- **No `property_config` table exists** — needs to be created
- **No `shared/config-loader.js` exists** — needs to be created
- **No `supabase/functions/_shared/config.ts` exists** — needs to be created
- **`brand_config` table exists** (singleton, id=1) with brand tokens (colors, fonts, logos, email styling)
- **`shared/brand-config.js` exists** — client-side loader with DB fetch + 5-min cache + hardcoded fallback
- **102+ hardcoded property-specific values** found across 20+ runtime files

## Architecture

### New Config Table: `property_config`

Create a singleton table (id=1) alongside the existing `brand_config`:

```sql
CREATE TABLE property_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES app_users(id)
);

-- RLS: readable by all (anon), writable by admin only
ALTER TABLE property_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read property_config" ON property_config FOR SELECT USING (true);
CREATE POLICY "Admin can update property_config" ON property_config FOR UPDATE USING (
  EXISTS (SELECT 1 FROM app_users WHERE supabase_auth_id = auth.uid() AND role IN ('admin', 'oracle'))
);
CREATE POLICY "Admin can insert property_config" ON property_config FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM app_users WHERE supabase_auth_id = auth.uid() AND role IN ('admin', 'oracle'))
);
```

### Config Schema (JSONB)

```json
{
  "property": {
    "name": "Alpaca Playhouse",
    "short_name": "AlpacApps",
    "tagline": "We put the AI into Alpacas",
    "address": "160 Still Forest Dr, Cedar Creek, TX 78612",
    "city": "Cedar Creek",
    "state": "TX",
    "zip": "78612",
    "country": "US",
    "latitude": 30.13,
    "longitude": -97.46,
    "timezone": "America/Chicago"
  },
  "domain": {
    "primary": "alpacaplayhouse.com",
    "github_pages": "rsonnad.github.io/alpacapps",
    "camera_proxy": "cam.alpacaplayhouse.com"
  },
  "email": {
    "team": "team@alpacaplayhouse.com",
    "admin_gmail": "alpacaplayhouse@gmail.com",
    "notifications_from": "notifications@alpacaplayhouse.com",
    "noreply_from": "noreply@alpacaplayhouse.com",
    "automation": "alpacaautomatic@gmail.com",
    "forwarding_rules": {
      "haydn": "hrsonnad@gmail.com",
      "rahulio": "rahulioson@gmail.com",
      "sonia": "sonia245g@gmail.com",
      "team": "alpacaplayhouse@gmail.com"
    }
  },
  "payment": {
    "zelle_email": "alpacaplayhouse@gmail.com",
    "venmo_handle": "@AlpacaPlayhouse"
  },
  "ai_assistant": {
    "name": "PAI",
    "full_name": "Prompt Alpaca Intelligence",
    "personality": "the AI assistant for the property",
    "email_from": "pai@alpacaplayhouse.com"
  },
  "wifi": {
    "network_name": "Black Rock City"
  },
  "mobile_app": {
    "name": "Alpaca Playhouse",
    "id": "com.alpacaplayhouse.app",
    "scheme": "Alpaca Playhouse"
  }
}
```

### Client-Side Loader: `shared/config-loader.js`

Follow the exact same pattern as `shared/brand-config.js`:

```javascript
// shared/config-loader.js
import { getSupabase } from './supabase.js';

let cachedConfig = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const FALLBACK_CONFIG = {
  // Full copy of the JSON schema above with AlpacApps defaults
  // This ensures the app works even if DB is unreachable
};

export async function getPropertyConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('property_config')
      .select('config')
      .eq('id', 1)
      .single();
    if (!error && data?.config) {
      cachedConfig = data.config;
      cacheTimestamp = now;
      return cachedConfig;
    }
  } catch (e) {
    console.warn('Failed to load property config, using fallback:', e.message);
  }
  return FALLBACK_CONFIG;
}

export function getPropertyConfigSync() {
  return cachedConfig || FALLBACK_CONFIG;
}

export function invalidatePropertyCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
}
```

### Edge Function Loader: `supabase/functions/_shared/property-config.ts`

```typescript
// supabase/functions/_shared/property-config.ts

interface PropertyConfig {
  property: { name: string; short_name: string; address: string; city: string; state: string; zip: string; timezone: string; latitude: number; longitude: number; };
  domain: { primary: string; github_pages: string; camera_proxy: string; };
  email: { team: string; admin_gmail: string; notifications_from: string; noreply_from: string; automation: string; forwarding_rules: Record<string, string>; };
  payment: { zelle_email: string; venmo_handle: string; };
  ai_assistant: { name: string; full_name: string; personality: string; email_from: string; };
  wifi: { network_name: string; };
  mobile_app: { name: string; id: string; scheme: string; };
}

const FALLBACK: PropertyConfig = {
  // Same fallback as client-side
};

let cached: PropertyConfig | null = null;

export async function getPropertyConfig(supabase: any): Promise<PropertyConfig> {
  if (cached) return cached;
  try {
    const { data } = await supabase.from('property_config').select('config').eq('id', 1).single();
    if (data?.config) {
      cached = data.config as PropertyConfig;
      return cached;
    }
  } catch (_) {}
  return FALLBACK;
}

// For short-lived edge functions, reset cache between invocations if needed
export function resetPropertyConfigCache() {
  cached = null;
}
```

---

## Hardcoded Values Audit — Complete Reference

### Category 1: Domain URLs (8 references)

| File | Line(s) | Current Value | Replace With |
|------|---------|---------------|-------------|
| `shared/services/camera-data.js` | 9-10 | `https://cam.alpacaplayhouse.com/ptz`, `/camera` | `config.domain.camera_proxy` |
| `residents/cameras.js` | 24-26 | `https://cam.alpacaplayhouse.com/ptz`, `/camera`, `/sensors` | `config.domain.camera_proxy` |
| `scripts/ptz-proxy/ptz-proxy.js` | 30 | `https://rsonnad.github.io,https://alpacaplayhouse.com,...` in ALLOWED_ORIGINS | `config.domain.github_pages`, `config.domain.primary` |
| `supabase/functions/alpaca-pai/index.ts` | 357 | `alpacaplayhouse.com/residents/` in system prompt | `config.domain.primary` |

### Category 2: Email Addresses (40+ references)

**`supabase/functions/send-email/index.ts`** (7 refs):
- Lines 340, 367, 499, 567: `alpacaplayhouse@gmail.com` (Zelle) → `config.payment.zelle_email`
- Lines 828, 938-951, 983-984, 1004: Brand names + address in email footers/templates → `config.property.*`

**`supabase/functions/send-sms/index.ts`** (2 refs):
- Lines 36, 45: `@AlpacaPlayhouse` and `alpacaplayhouse@gmail.com` → `config.payment.*`

**`supabase/functions/send-whatsapp/index.ts`** (2 refs):
- Lines 229, 235: Same payment info → `config.payment.*`

**`supabase/functions/signwell-webhook/index.ts`** (7 refs):
- Lines 271, 474, 476, 513, 588, 590, 717, 719: `alpacaplayhouse@gmail.com` and `team@alpacaplayhouse.com` → `config.email.*`

**`supabase/functions/resend-inbound-webhook/index.ts`** (8 refs):
- Lines 50, 55, 585, 696, 1160, 1457, 2225, 2387: forwarding rules and fallback emails → `config.email.*`

**`supabase/functions/stripe-webhook/index.ts`** (2 refs):
- Lines 358, 360: `team@alpacaplayhouse.com` → `config.email.team`

**`supabase/functions/event-payment-reminder/index.ts`** (3 refs):
- Lines 200, 202, 241: `team@alpacaplayhouse.com` → `config.email.team`

**`supabase/functions/payment-overdue-check/index.ts`** (3 refs):
- Lines 20, 781, 784: `team@alpacaplayhouse.com` → `config.email.team`

**`supabase/functions/confirm-deposit-payment/index.ts`** (1 ref):
- Line 262: `team@alpacaplayhouse.com` → `config.email.team`

**`supabase/functions/paypal-webhook/index.ts`** (1 ref):
- Line 610: `alpacaplayhouse@gmail.com` → `config.email.admin_gmail`

**`supabase/functions/ask-question/index.ts`** (1 ref):
- Line 37: `team@alpacaplayhouse.com` in system prompt → `config.email.team`

**`supabase/functions/_shared/template-engine.ts`** (4 refs):
- Lines 53, 54, 62, 66: `team@alpacaplayhouse.com` and from addresses → `config.email.*`

**`supabase/functions/_shared/email-brand-wrapper.ts`** (1 ref):
- Line 27: `AlpacApps` platform_name → `config.property.short_name`

### Category 3: Property Address (12 references)

| File | Line(s) | Replace With |
|------|---------|-------------|
| `supabase/functions/alpaca-pai/index.ts` | 349, 353, 1219 | `config.property.address`, `config.property.city` |
| `supabase/functions/ask-question/index.ts` | 36 | `config.property.address` |
| `supabase/functions/send-email/index.ts` | 939, 983, 1004 | `config.property.*` |
| `supabase/functions/payment-overdue-check/index.ts` | 261, 735 | `config.property.address` |
| `supabase/functions/stripe-webhook/index.ts` | 333 | `config.property.address` |
| `supabase/functions/_shared/email-brand-wrapper.ts` | 29 | `config.property.address` |
| `supabase/functions/generate-whispers/index.ts` | 32 | `config.property.name`, `config.property.city` |

### Category 4: Brand Names (30+ references)

Brand names appear in system prompts, email templates, email footers, iCal PRODID, and the mobile app config. These are spread across:

- `supabase/functions/alpaca-pai/index.ts` (system prompt, sign-offs)
- `supabase/functions/send-email/index.ts` (email footers, welcome template)
- `supabase/functions/error-report/index.ts` (email subjects)
- `supabase/functions/ical/index.ts` + `regenerate-ical/index.ts` (PRODID)
- `supabase/functions/resend-inbound-webhook/index.ts` (auto-reply text)
- `supabase/functions/generate-whispers/index.ts` (system prompt)
- `supabase/functions/_shared/email-brand-wrapper.ts` (platform name)
- `supabase/functions/_shared/template-engine.ts` (from addresses)
- `mobile/capacitor.config.ts` (app name and scheme) — **NOTE: This requires a full app rebuild + store resubmission, so it should use a build-time config, not runtime DB lookup**

### Category 5: GitHub Username (6 references)

| File | Line | Current Value | Replace With |
|------|------|---------------|-------------|
| `spaces/admin/rentals.js` | 2774, 2934 | `rsonnad.github.io/alpacapps/spaces/verify.html` | `config.domain.github_pages` |
| `shared/rental-service.js` | 1394 | `rsonnad.github.io/alpacapps/spaces/apply/` | `config.domain.github_pages` |
| `shared/identity-service.js` | 32 | `rsonnad.github.io/alpacapps/spaces/verify.html` | `config.domain.github_pages` |
| `bug-fixer/bug_scout.js` | 325 | `rsonnad.github.io` | `config.domain.github_pages` |
| `scripts/ptz-proxy/ptz-proxy.js` | 30 | `rsonnad.github.io` in ALLOWED_ORIGINS | `config.domain.github_pages` |

### Category 6: Other (4 references)

| File | Line | Value | Replace With |
|------|------|-------|-------------|
| `bug-fixer/bug_scout.js` | 445 | `alpacaautomatic@gmail.com` | `config.email.automation` |
| `supabase/functions/alpaca-pai/index.ts` | 557, 2227 | `Cedar Creek, TX` in weather context | `config.property.city + ', ' + config.property.state` |
| `supabase/functions/ask-question/index.ts` | 557 | `Cedar Creek, TX` in weather tool description | Same |

---

## Implementation Plan

### Phase 1: Foundation (do first)

1. **Create `property_config` table** with the JSON schema above, seed with AlpacApps defaults
2. **Create `shared/config-loader.js`** (client-side, mirrors brand-config.js pattern)
3. **Create `supabase/functions/_shared/property-config.ts`** (edge function loader)
4. **Run the SQL migration** to create the table and seed data

### Phase 2: Edge Functions (highest density of hardcoded values)

Refactor in this order (highest reference count first):

1. **`_shared/email-brand-wrapper.ts`** — This is the email shell used by all branded emails. Changing it here propagates to many templates automatically. Currently has hardcoded `full_name`, `platform_name`, `address`. Load from `property_config` instead.

2. **`_shared/template-engine.ts`** — Default `from` and `reply_to` addresses. Replace with config lookups.

3. **`send-email/index.ts`** — Email footers, welcome template, Zelle references. Some of these may already be sourced from `email-brand-wrapper.ts` after step 1.

4. **`resend-inbound-webhook/index.ts`** — Forwarding rules, fallback emails, auto-reply text. The `FORWARDING_RULES` map and `DEFAULT_FORWARD_TO` should come from config.

5. **`alpaca-pai/index.ts`** — System prompt, sign-offs, weather location. The system prompt should interpolate config values.

6. **`signwell-webhook/index.ts`** — From addresses and reply-to in post-signature emails.

7. **`stripe-webhook/index.ts`** — From address and property address in confirmation emails.

8. **`send-sms/index.ts`** + **`send-whatsapp/index.ts`** — Payment info in SMS/WhatsApp templates.

9. **`ask-question/index.ts`** — System prompt with property details.

10. **`event-payment-reminder/index.ts`**, **`payment-overdue-check/index.ts`**, **`confirm-deposit-payment/index.ts`**, **`paypal-webhook/index.ts`** — From addresses and property address in payment emails.

11. **`error-report/index.ts`** — Email subjects with brand name.

12. **`ical/index.ts`** + **`regenerate-ical/index.ts`** — PRODID string.

13. **`generate-whispers/index.ts`** — System prompt with property name/location.

### Phase 3: Client-Side Code

1. **`shared/services/camera-data.js`** + **`residents/cameras.js`** — Camera proxy base URLs. Load from config or pass as parameter.

2. **`shared/rental-service.js`** + **`shared/identity-service.js`** + **`spaces/admin/rentals.js`** — GitHub Pages URLs for verify/apply pages.

### Phase 4: Scripts & Workers

1. **`scripts/ptz-proxy/ptz-proxy.js`** — ALLOWED_ORIGINS from env/config.
2. **`bug-fixer/bug_scout.js`** — Admin email and GitHub Pages domain.

### Phase 5: Mobile (separate concern)

- **`mobile/capacitor.config.ts`** — App name, ID, and scheme are build-time values. These should be sourced from a local config file (e.g., `mobile/app-config.json`) that is gitignored and populated per clone. Do NOT make these runtime DB lookups.

---

## Important Constraints

1. **Every edge function that loads `property_config` adds one DB query per invocation.** This is acceptable (same pattern as `brand_config`), but consider caching within the function scope. For functions called in tight loops, pass the config object rather than re-fetching.

2. **The fallback config MUST contain working defaults.** If the DB is unreachable, the app should still function with the fallback values. This means the fallback is always the "primary" property (AlpacApps).

3. **`brand_config` and `property_config` are separate concerns.** Brand config = visual styling (colors, fonts, logos). Property config = identity and infrastructure (domain, email, address, payment handles). Do not merge them.

4. **Email `from` addresses are tied to DNS/domain verification.** Changing `noreply@alpacaplayhouse.com` requires the clone to have their own domain verified in Resend. The config makes this easy to change, but the clone operator must also configure Resend.

5. **The `resend-inbound-webhook` forwarding rules are the most property-specific.** Each property has different people with different forwarding addresses. The config schema handles this via `email.forwarding_rules`.

6. **Deploy edge functions after changes.** Every modified edge function needs redeployment. Functions with `--no-verify-jwt` flag (see CLAUDE.md) must keep that flag. Deploy in batch after all changes.

7. **Don't touch `CLAUDE.md` or `CLAUDE.local.md`** — those are documentation, not runtime code. They should continue to document the specific property for context.

8. **Don't touch `mobile/capacitor.config.ts` in this pass** — mobile app identity is a build-time concern that requires App Store resubmission. Handle separately.

9. **Test the email brand wrapper first** — since it's the base layer for all branded emails, get it right before touching individual email templates.

10. **Run `npm run css:build` if any HTML files are modified** with new Tailwind classes.

---

## Acceptance Criteria

- [ ] `property_config` table exists with seeded AlpacApps defaults
- [ ] `shared/config-loader.js` loads config client-side (DB fetch + cache + fallback)
- [ ] `supabase/functions/_shared/property-config.ts` loads config in edge functions
- [ ] Zero hardcoded `alpacaplayhouse.com` in edge function runtime paths (comments OK)
- [ ] Zero hardcoded `alpacaplayhouse@gmail.com` or `team@alpacaplayhouse.com` in runtime paths
- [ ] Zero hardcoded `160 Still Forest` or `Cedar Creek` in runtime paths
- [ ] Zero hardcoded `rsonnad.github.io` in runtime paths
- [ ] All brand names in runtime code come from config (comments/file headers OK to keep)
- [ ] Email `from`/`reply_to` addresses come from config in all edge functions
- [ ] PAI system prompt interpolates property details from config
- [ ] All modified edge functions deployed successfully
- [ ] Existing functionality unchanged (emails send, PAI responds, cameras load, payments process)
- [ ] PRODUCTDESIGN.md updated with this architectural decision

## Verification

After implementation, run this grep to confirm no remaining hardcoded values in runtime code:

```bash
# Should return zero results in .ts and .js files (excluding docs, CLAUDE files, instructions, node_modules)
grep -rn "alpacaplayhouse\.com\|alpacaplayhouse@gmail\|team@alpacaplayhouse\|160 Still Forest\|Cedar Creek.*TX\|rsonnad\.github\.io" \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=instructions --exclude-dir=.git \
  supabase/functions/ shared/ residents/ spaces/ scripts/ bug-fixer/ associates/ mobile/app/ \
  | grep -v "CLAUDE\|README\|\.md\|// " | head -50
```

Zero matches = done.
