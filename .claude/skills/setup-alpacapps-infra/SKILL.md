---
name: setup-alpacapps-infra
description: Interactive infrastructure setup wizard. Walks through setting up the full stack (Supabase, Telnyx, Square, SignWell, Resend, Cloudflare R2, DigitalOcean) step by step. Use when starting a new project or adding services to an existing one.
---

# Infrastructure Setup Wizard

You are an expert infrastructure setup assistant helping the user build a do-it-all system — messaging, marketing, customer management, and finance — using Supabase, GitHub Pages, and optional services.

## Core Principles

1. **You handle ALL terminal work.** The user never runs commands.
2. **Silent prerequisite installs.** Don't ask — just check and install Supabase CLI if missing. Only pause if git or Node.js is missing (they require manual install — link the user to https://git-scm.com and https://nodejs.org).
3. **One service at a time.** Complete each service fully before moving to the next.
4. **Every URL you show the user must be a full clickable URL.** Always `https://...` — never a path fragment, never `go to Settings → API`, never a template with `{REF}` still in it. Substitute all variables before presenting to the user.
5. **Build CLAUDE.md and CLAUDE.local.md incrementally.** Two files: `CLAUDE.md` (checked into repo) has shareable project context — architecture, schema, patterns, conventions. `CLAUDE.local.md` (gitignored) has credentials, connection strings, and operator directives. After each service, append shareable details to CLAUDE.md and credentials/secrets to CLAUDE.local.md, commit, and push. Don't repeat "update files, commit, and push" in every step — it's implicit. Make sure `.gitignore` includes `CLAUDE.local.md` (not `CLAUDE.md`).
6. **Validate before proceeding.** Test every credential and connection before moving on.
7. **Construct webhook URLs yourself.** Once you have the Supabase project ref, build all webhook URLs and present them as copy-paste-ready values.
8. **Derive everything you can.** Don't ask the user for things you can compute (project URL from ref, pooler connection string from ref + password, etc.).
9. **Use `gh` CLI when available.** If `gh` is installed and authenticated, use it to create repos and enable GitHub Pages — don't make the user do it manually.

## Setup Flow

### Step 1: Feature Selection

Ask two things in a single message:

1. **"What are you building?"** — Get a one-sentence description and their main entities (e.g., "a salon booking system with services, stylists, and appointments").

2. **"Which optional capabilities do you need?"** — Present as a simple list:

**Always included (core):**
- Website + Admin Dashboard (GitHub Pages) — Free
- Database + Storage + Auth (Supabase) — Free
- AI Developer (Claude Code) — you're already here

**Pick any you need:**
- User login / Google Sign-In (Google OAuth via Supabase) — Free
- Email notifications (Resend) — Free, 3,000/month
- SMS messaging (Telnyx) — ~$0.004/message
- Payment processing (Square) — 2.9% + 30¢ per transaction
- E-signatures (SignWell) — Free, 3–25 docs/month
- AI-powered features (Google Gemini) — Free
- Object storage / file hosting (Cloudflare R2) — Free, 10 GB
- DigitalOcean Droplet (server for bots, workers, automation) — ~$12/mo

Remember their choices and skip everything they don't need.

### Step 2: GitHub + GitHub Pages

**First, detect the current state:**
1. Check git remote: `git remote get-url origin 2>/dev/null`
2. Check if `gh` CLI is available and authenticated: `gh auth status 2>/dev/null`
3. If `gh` is available, get the current username: `gh api user --jq .login`

**Determine which case:**
- **Template case:** Remote URL contains the user's own username (not `rsonnad/alpacapps-infra`) → they used "Use this template" on GitHub
- **Clone case:** Remote URL contains `rsonnad/alpacapps-infra` → they cloned the starter repo
- **No remote:** No origin configured → fresh init or detached repo

**If the user already has their own repo (template case):**
1. Extract the owner and repo name from the remote URL (parse from `https://github.com/OWNER/REPO.git` or `git@github.com:OWNER/REPO.git`)
2. Validate the repo exists: `gh repo view {OWNER}/{REPO} 2>&1` (if `gh` available)
3. Check if Pages is already enabled: `gh api repos/{OWNER}/{REPO}/pages 2>&1` — look for HTTP 200 (enabled) or 404 (not enabled)
4. Push any pending commits: `git push -u origin main`
5. If Pages not enabled, enable it (see below)
6. Validate Pages deployment: `curl -I https://{OWNER}.github.io/{REPO}/ | head -n 1` (wait up to 60s for first deploy)
7. Tell the user: "✓ Your repo is ready. Site will be live at https://{OWNER}.github.io/{REPO}/ (deploying now, may take 60 seconds)"

**If the user needs a new repo (clone case or no remote):**

**Option A: Use GitHub Template API (preferred if `gh` available):**
1. Ask the user what they want to name their repo. The name must be unique on their GitHub account (no spaces, use hyphens). Example: `my-salon-app`.
2. Check if `gh` is available and authenticated: `gh auth status`
3. Get the user's GitHub username: `gh api user --jq .login`
4. **Validate name availability:** `gh repo view {USERNAME}/{name} 2>&1` — if it exists (exit code 0), tell the user and ask for a different name
5. **Use template API instead of clone+push:**
   ```bash
   gh api repos/rsonnad/alpacapps-infra/generate \
     -f name={name} \
     -f owner={USERNAME} \
     -f include_all_branches=false \
     -f private=false
   ```
6. Wait for repo creation (API returns immediately, but repo may take a few seconds): `sleep 3`
7. Update local remote to point to new repo: `git remote remove origin 2>/dev/null; git remote add origin https://github.com/{USERNAME}/{name}.git`
8. Push local commits: `git push -u origin main`
9. Enable Pages (see below)
10. Validate (see below)
11. Tell the user: "✓ Repo created from template. Site will be live at https://{USERNAME}.github.io/{name}/"

**Option B: Manual repo creation (fallback if `gh` not available):**
1. Remove the starter origin if present: `git remote remove origin 2>/dev/null || true`
2. Tell the user: "Create a repo named `{name}` at https://github.com/new (public, for free GitHub Pages) and paste the URL here."
3. After getting the URL, validate it matches expected format (https://github.com/OWNER/REPO or git@github.com:OWNER/REPO.git)
4. Set remote and push: `git remote add origin {URL} && git push -u origin main`
5. Tell the user: "Enable GitHub Pages at https://github.com/{OWNER}/{REPO}/settings/pages — select Deploy from branch → main → / (root) → Save. Then type 'done'."
6. Wait for user confirmation, then validate

**Enabling Pages:**
- If `gh` is available:
  1. Try to enable via API: `gh api repos/{OWNER}/{REPO}/pages -X POST -f build_type=legacy -f source='{"branch":"main","path":"/"}' 2>&1`
  2. If you get HTTP 409 "Page already exists", that's fine — it's already enabled
  3. If you get HTTP 404, the repo might not exist yet — wait 5 seconds and retry once
- If `gh` is NOT available: Tell the user to go to https://github.com/{OWNER}/{REPO}/settings/pages → Deploy from branch → main → / (root) → Save
- **Important:** Use branch deployment (not GitHub Actions workflow) — this is a static site with no build step.

**Validating deployment:**
After enabling Pages, wait up to 60 seconds for first deployment:
```bash
for i in {1..12}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" https://{OWNER}.github.io/{REPO}/)
  if [ "$status" = "200" ]; then
    echo "✓ Site is live"
    break
  fi
  echo "Waiting for Pages deployment... ($i/12)"
  sleep 5
done
```

**Then** create the project folder structure adapted to their domain, scaffold both `CLAUDE.md` (shareable context, checked in) and `CLAUDE.local.md` (credentials/operator directives, gitignored). Add `CLAUDE.local.md` to `.gitignore` if not already present. Add a note at the top of `CLAUDE.md` saying "See `CLAUDE.local.md` for credentials and environment-specific configuration." Commit and push.

### Step 3: Supabase

**Check if a Supabase project already exists locally:**
1. Check for existing Supabase link: `supabase status 2>/dev/null`
2. If linked, extract project ref from `.supabase/` config or status output
3. If already linked, skip project creation and just validate credentials

**Option A: Automated project creation via Management API (preferred):**

Check if we have a Management API token in CLAUDE.local.md (look for `SUPABASE_MGMT_TOKEN` or similar).

**If Management API token is available:**
1. List the user's organizations: `curl -s https://api.supabase.com/v1/organizations -H "Authorization: Bearer {MGMT_TOKEN}"`
2. Get the first org ID from the response (most users have only one)
3. **Ask the user for project name and database password only:**
   > I can create your Supabase project automatically. I just need:
   > 1. **Project name** (e.g., "My Salon App") — alphanumeric and hyphens only
   > 2. **Database password** — save this securely, you'll need it later
   > 3. **Region** (optional, defaults to us-east-1) — choose from: us-east-1, us-west-1, eu-west-1, ap-southeast-1, ap-northeast-1
4. **Create the project via API:**
   ```bash
   curl -X POST https://api.supabase.com/v1/projects \
     -H "Authorization: Bearer {MGMT_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "{PROJECT_NAME}",
       "organization_id": "{ORG_ID}",
       "region": "{REGION}",
       "plan": "free",
       "db_pass": "{DB_PASSWORD}"
     }'
   ```
5. Wait for project creation (API returns project ref immediately, but project may take 1-2 minutes to provision): Poll status every 10s for up to 2 minutes
6. Extract from API response: `project_ref`, `anon_key`, `service_role_key`, `database.host`
7. Construct webhook URLs immediately (no need to ask user)
8. Skip to "Then you (silently)" below

**Option B: Manual project creation (if no Management API token):**

Ask the user to do these things (in a single message with all URLs):

> Create a Supabase project manually:
> 1. Go to https://supabase.com/dashboard/new/_
> 2. Fill in project name, database password (save it!), and region
> 3. Click **Create new project** and wait for provisioning (1-2 minutes)
> 4. Once created, paste me these values:
>    - **Project ref** (the subdomain in the URL bar, e.g., `abcdefghijk`)
>    - **Database password** (the one you just set)
>
> I'll construct the rest automatically.

Once you have the ref, **immediately construct and validate these URLs** before asking for more:
1. Project URL: `https://{REF}.supabase.co`
2. API settings page: `https://supabase.com/dashboard/project/{REF}/settings/api`
3. Database settings page: `https://supabase.com/dashboard/project/{REF}/settings/database`

**Fetch the anon key automatically via API:**
```bash
# If we have Management API token, fetch via API instead of asking user
curl -s https://api.supabase.com/v1/projects/{REF}/api-keys \
  -H "Authorization: Bearer {MGMT_TOKEN}"
```

If API fetch fails or no token, give the user the direct link:
> "Get your **anon key** from https://supabase.com/dashboard/project/{REF}/settings/api (under Project API keys → anon public)"

**Construct the session pooler string automatically:**
1. Fetch project details via Management API (if available): `curl https://api.supabase.com/v1/projects/{REF} -H "Authorization: Bearer {MGMT_TOKEN}"`
2. Extract region from response (e.g., `us-east-1`)
3. Build pooler string: `postgres://postgres.{REF}:{URL_ENCODED_PASSWORD}@aws-0-{REGION}.pooler.supabase.com:5432/postgres`
4. URL-encode password special chars: `!` → `%21`, `@` → `%40`, `#` → `%23`, `$` → `%24`, `%` → `%25`, `&` → `%26`

**Validate the connection immediately:**
```bash
/opt/homebrew/opt/libpq/bin/psql "{POOLER_STRING}" -c "SELECT 1" 2>&1
```
If connection fails, try alternative regions: `aws-1-us-east-2`, `aws-0-us-west-1`, etc.

**Pre-construct all webhook URLs** (before asking user to configure external services):
- Telnyx: `https://{REF}.supabase.co/functions/v1/telnyx-webhook`
- SignWell: `https://{REF}.supabase.co/functions/v1/signwell-webhook`
- Resend inbound: `https://{REF}.supabase.co/functions/v1/resend-inbound-webhook`
- PayPal: `https://{REF}.supabase.co/functions/v1/paypal-webhook`
- Vapi: `https://{REF}.supabase.co/functions/v1/vapi-webhook`

Store these in a variable so they can be used in later steps without re-construction.

**Then you (silently, no user action needed):**
1. Check if Supabase CLI is installed: `which supabase` — if not, install it: `npm install -g supabase`
2. Check if already logged in: `supabase projects list 2>&1` — if "Not logged in", run `supabase login` (this opens browser)
3. Link to the project: `supabase link --project-ref {REF}`
4. Validate the link: `supabase status` — should show project ref and API URL
5. Create `shared/supabase.js` with project URL and anon key
6. Test the psql connection: `/opt/homebrew/opt/libpq/bin/psql "{POOLER_STRING}" -c "SELECT version()"`
7. Create database tables tailored to the user's domain description (don't use hardcoded schemas) — use psql directly
8. Enable RLS on all tables: `ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;`
9. Create storage buckets with public read policies (via psql or Supabase SQL editor API)
10. Validate each table was created: `psql ... -c "\dt"`
11. Validate RLS is enabled: `psql ... -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true"`
12. Append shareable Supabase details to CLAUDE.md (project ref, URL, storage buckets, webhook URLs, CLI commands reference)
13. Append credentials to CLAUDE.local.md (project ref, URL, anon key, psql connection string with password, Management API token if available, CLI access instructions, operator directives for direct DB access)
14. Commit and push

### Step 4: Google Sign-In (Google OAuth) — if selected

This step uses Supabase's built-in Google OAuth support. The user needs to create a Google Cloud project and OAuth credentials, then enable Google as a provider in Supabase.

**Note:** If the user also selected Google Gemini, mention that they can use the **same Google Cloud project** for both — no need to create two.

Ask in a single message with all URLs:

> Set up Google Sign-In for your app:
> 1. Create a Google Cloud project at https://console.cloud.google.com/projectcreate (name it anything, e.g., "My Salon App")
> 2. Set up the OAuth consent screen at https://console.cloud.google.com/apis/credentials/consent — choose **External**, fill in app name and your email, click through the remaining steps with defaults
> 3. Create OAuth credentials at https://console.cloud.google.com/apis/credentials — click **+ Create Credentials → OAuth client ID → Web application**
> 4. Under **Authorized redirect URIs**, add: `https://{ACTUAL_REF}.supabase.co/auth/v1/callback`
> 5. Copy the **Client ID** and **Client Secret**
> 6. Enable Google as a provider in Supabase at https://supabase.com/dashboard/project/{ACTUAL_REF}/auth/providers — toggle Google on, paste Client ID and Client Secret, Save
> 7. Paste the **Client ID** here (I don't need the secret — it's already saved in Supabase)

**Important reminder for the user:** The OAuth consent screen starts in "Testing" mode (only manually-added test users can sign in). When they're ready to go live, they need to click **Publish App** on the consent screen page. Basic sign-in (email/profile) doesn't require Google verification.

**Then you:**
1. Create `shared/auth.js` with Google OAuth sign-in using `supabase.auth.signInWithOAuth({ provider: 'google' })`
2. Add login/logout UI to the app
3. Add auth guards to admin pages
4. Append auth patterns to CLAUDE.md (sign-in method, redirect URI pattern). Append Client ID to CLAUDE.local.md

### Step 5: Resend (Email) — if selected

**Pre-construct webhook URL:** `https://{REF}.supabase.co/functions/v1/resend-inbound-webhook` (use the ref from Step 3)

Ask in a single message, including the pre-built webhook URL:

> Sign up at https://resend.com/signup (free: 3,000 emails/month), then:
> 1. Create an API key at https://resend.com/api-keys (select **Sending access** permission)
> 2. **Optional but recommended:** Verify your domain at https://resend.com/domains
>    - Add the DNS records shown (MX, TXT for SPF/DKIM)
>    - Without this, you can only send from `onboarding@resend.dev`
> 3. **Optional — Inbound email:** To receive emails, add a webhook at https://resend.com/webhooks
>    - Webhook URL: `https://{REF}.supabase.co/functions/v1/resend-inbound-webhook`
>    - Event: `email.received`
>    - You'll also need MX records pointing to `inbound-smtp.us-east-1.amazonaws.com`
> 4. Paste the **API key** here

**Validate the API key immediately:**
```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer {API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "onboarding@resend.dev",
    "to": ["delivered@resend.dev"],
    "subject": "Test from setup wizard",
    "html": "<p>API key validated successfully</p>"
  }' 2>&1
```
If you get HTTP 200, the key is valid. If you get HTTP 401/403, the key is invalid — ask the user to double-check.

**Then you:**
1. Set secret: `supabase secrets set RESEND_API_KEY={key}`
2. Validate secret was set: `supabase secrets list` (should show RESEND_API_KEY)
3. Create and deploy `supabase/functions/send-email/index.ts` with the validated API key pattern
4. Test the deployed function: `curl https://{REF}.supabase.co/functions/v1/send-email` (should return method not allowed or auth required, not 404)
5. Create `shared/email-service.js` client module
6. Append to CLAUDE.md: API key location (secrets), from address, webhook URL (if configured), templates pattern
7. Append to CLAUDE.local.md: API key, domain verification status, webhook secret (if applicable)

### Step 6: Telnyx (SMS) — if selected

**Pre-construct the webhook URL:** `https://{REF}.supabase.co/functions/v1/telnyx-webhook` (use the ref from Step 3)

Ask in a single message, including the pre-built webhook URL and the 10DLC warning up front:

> Sign up at https://telnyx.com/sign-up and add a payment method, then:
> 1. Buy a number at https://portal.telnyx.com/#/app/numbers/search-numbers (~$1/mo)
> 2. Create a Messaging Profile at https://portal.telnyx.com/#/app/messaging
> 3. In the profile, set the inbound webhook URL to:
>    `https://{REF}.supabase.co/functions/v1/telnyx-webhook`
>    Set **Webhook API Version** to **V2**, HTTP method to **POST**
> 4. Assign your number to the profile (click the profile → Numbers tab → Assign)
> 5. Get your API key at https://portal.telnyx.com/#/app/api-keys (create one with **Full Access**)
>
> Then paste these values: **phone number** (E.164 format, e.g., +12125551234), **Messaging Profile ID**, **API key**
>
> ⚠️ **Important — do this now, don't wait:** US numbers require 10DLC registration before SMS will work. Go to https://portal.telnyx.com/#/app/messaging/compliance — create a Brand (Sole Proprietor) and a Campaign (business notifications). Approval takes days to weeks, so start this right away while I set everything else up.

**Validate the API key immediately:**
```bash
curl -X GET https://api.telnyx.com/v2/phone_numbers \
  -H "Authorization: Bearer {API_KEY}" 2>&1
```
If you get HTTP 200, the key is valid. If you get HTTP 401, the key is invalid — ask the user to double-check.

**Validate the phone number and profile:**
```bash
# Check if the number exists and is assigned to a messaging profile
curl -X GET "https://api.telnyx.com/v2/phone_numbers/{PHONE_NUMBER}" \
  -H "Authorization: Bearer {API_KEY}" 2>&1 | jq '.data.messaging_profile_id'
```
Should return the Messaging Profile ID the user provided. If it doesn't match, warn the user.

**Then you:**
1. Create tables:
   ```sql
   CREATE TABLE telnyx_config (
     id INT PRIMARY KEY DEFAULT 1,
     api_key TEXT NOT NULL,
     messaging_profile_id TEXT NOT NULL,
     phone_number TEXT NOT NULL,
     is_active BOOLEAN DEFAULT true,
     test_mode BOOLEAN DEFAULT false,
     CHECK (id = 1)
   );
   CREATE TABLE sms_messages (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     person_id UUID REFERENCES people(id),
     direction TEXT CHECK (direction IN ('inbound', 'outbound')),
     from_number TEXT,
     to_number TEXT,
     body TEXT,
     sms_type TEXT,
     telnyx_id TEXT UNIQUE,
     status TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
2. Insert config: `INSERT INTO telnyx_config (api_key, messaging_profile_id, phone_number) VALUES (...)`
3. Validate insert: `SELECT * FROM telnyx_config WHERE id = 1`
4. Set secret: `supabase secrets set TELNYX_API_KEY={key}`
5. Create and deploy `supabase/functions/send-sms/index.ts` (outbound SMS via Telnyx API)
6. Create and deploy `supabase/functions/telnyx-webhook/index.ts` (inbound SMS receiver) with `--no-verify-jwt`
7. Test webhook function is reachable: `curl https://{REF}.supabase.co/functions/v1/telnyx-webhook` (should return 400 or method not allowed, not 404)
8. Create `shared/sms-service.js` client module
9. Append to CLAUDE.md: webhook URL, API patterns (Bearer auth, JSON body), tables, edge functions
10. Append to CLAUDE.local.md: API key, phone number, Messaging Profile ID, 10DLC status

### Step 7: Square (Payments) — if selected

Ask in a single message:

> Sign up at https://squareup.com/signup, then:
> 1. Create an app at https://developer.squareup.com/console/en/apps
> 2. Go to your app's **Credentials** page (left sidebar)
> 3. Copy these values from the **Sandbox** section:
>    - **Application ID** (starts with `sandbox-sq0idb-` or `sq0idp-`)
>    - **Access Token** (sandbox token for testing)
> 4. Go to the **Locations** tab (or https://developer.squareup.com/console/en/apps → your app → Locations)
> 5. Copy the **Location ID** for your sandbox location (usually named "Default Test Account")
>
> Paste: **Application ID**, **Sandbox Access Token**, **Location ID**

**Validate the credentials immediately:**
```bash
# Test the access token
curl -X GET https://connect.squareupsandbox.com/v2/locations \
  -H "Square-Version: 2024-02-14" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" 2>&1
```
Should return HTTP 200 with a list of locations. Extract the first location ID and compare to what the user provided.

**Validate the Application ID format:**
Check that it starts with `sandbox-sq0idb-` or `sq0idp-` — if not, warn the user.

**Then you:**
1. Create tables:
   ```sql
   CREATE TABLE square_config (
     id INT PRIMARY KEY DEFAULT 1,
     application_id TEXT NOT NULL,
     access_token TEXT NOT NULL,
     location_id TEXT NOT NULL,
     environment TEXT CHECK (environment IN ('sandbox', 'production')) DEFAULT 'sandbox',
     is_active BOOLEAN DEFAULT true,
     CHECK (id = 1)
   );
   CREATE TABLE square_payments (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     person_id UUID REFERENCES people(id),
     amount_cents INT NOT NULL,
     currency TEXT DEFAULT 'USD',
     square_payment_id TEXT UNIQUE,
     status TEXT,
     receipt_url TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
2. Insert config: `INSERT INTO square_config (application_id, access_token, location_id, environment) VALUES (..., 'sandbox')`
3. Validate insert: `SELECT * FROM square_config WHERE id = 1`
4. Set secrets: `supabase secrets set SQUARE_ACCESS_TOKEN={token}`
5. Create and deploy `supabase/functions/process-square-payment/index.ts`
6. Test deployed function: `curl https://{REF}.supabase.co/functions/v1/process-square-payment` (should return 400 or auth required, not 404)
7. Create `shared/square-service.js` with Web Payments SDK integration (https://sandbox.web.squarecdn.com/v1/square.js)
8. Append to CLAUDE.md: sandbox vs production environments, SDK URLs, tables, edge functions
9. Append to CLAUDE.local.md: Application ID, sandbox access token, location ID, environment status

### Step 8: SignWell (E-Signatures) — if selected

**Pre-construct the webhook URL:** `https://{REF}.supabase.co/functions/v1/signwell-webhook` (use the ref from Step 3)

Ask in a single message, including the pre-built webhook URL:

> Sign up at https://www.signwell.com/sign_up/ (free: 3 docs/month, 25 with credit card), then:
> 1. Copy your API key at https://www.signwell.com/app/settings/api
> 2. **Optional but recommended:** Add a webhook at https://www.signwell.com/app/settings/webhooks
>    - Webhook URL: `https://{REF}.supabase.co/functions/v1/signwell-webhook`
>    - Subscribe to the `document_completed` event
>    - Copy the **Webhook Secret** shown after creating the webhook
> 3. Paste the **API key** here (and the **Webhook Secret** if you set one up)

**Validate the API key immediately:**
```bash
curl -X GET https://www.signwell.com/api/v1/templates \
  -H "X-Api-Key: {API_KEY}" 2>&1
```
Should return HTTP 200 (even if templates array is empty). If you get HTTP 401, the key is invalid — ask the user to double-check.

**Then you:**
1. Create table:
   ```sql
   CREATE TABLE signwell_config (
     id INT PRIMARY KEY DEFAULT 1,
     api_key TEXT NOT NULL,
     webhook_secret TEXT,
     test_mode BOOLEAN DEFAULT false,
     is_active BOOLEAN DEFAULT true,
     CHECK (id = 1)
   );
   ```
2. Insert config: `INSERT INTO signwell_config (api_key, webhook_secret, test_mode) VALUES (...)`
3. Validate insert: `SELECT * FROM signwell_config WHERE id = 1`
4. Set secrets: `supabase secrets set SIGNWELL_API_KEY={key}` and optionally `SIGNWELL_WEBHOOK_SECRET={secret}`
5. Create and deploy `supabase/functions/signwell-webhook/index.ts` (with `--no-verify-jwt`) — include HMAC signature verification if webhook secret was provided
6. Test deployed function: `curl https://{REF}.supabase.co/functions/v1/signwell-webhook` (should return 400 or signature mismatch, not 404)
7. Create `shared/signwell-service.js` (API wrapper for creating documents, sending for signature)
8. Create `shared/pdf-service.js` (jsPDF-based PDF generation from markdown templates)
9. Append to CLAUDE.md: API base URL, webhook URL, webhook signature verification pattern, tables
10. Append to CLAUDE.local.md: API key, webhook secret, test vs production mode

### Step 9: Google Gemini (AI) — if selected

If the user also set up Google Sign-In (Step 4), remind them they can use the **same Google Cloud project** — just grab a Gemini API key.

Ask:
> Get a free API key at https://aistudio.google.com/apikey and paste it here.

**Validate the API key immediately:**
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{"text": "test"}]
    }]
  }' 2>&1
```
Should return HTTP 200 with a response containing generated text. If you get HTTP 400 with "API_KEY_INVALID", the key is invalid — ask the user to double-check.

**Then you:**
1. Set secret: `supabase secrets set GEMINI_API_KEY={key}`
2. Validate secret was set: `supabase secrets list` (should show GEMINI_API_KEY)
3. Create a test edge function or add to existing function to demonstrate Gemini usage (e.g., fuzzy matching helper)
4. Append to CLAUDE.md: Gemini API endpoint, model names (gemini-2.0-flash, gemini-2.5-flash), pricing reference, usage examples
5. Append to CLAUDE.local.md: API key, free tier limits (15 RPM, 1500 RPD)

### Step 10: Cloudflare R2 (Object Storage) — if selected

Ask in a single message:

> Sign up at https://dash.cloudflare.com/sign-up (free, no credit card needed), then:
> 1. Go to **R2 Object Storage** in the left sidebar → **Create bucket**
> 2. Name your bucket (lowercase, hyphens, e.g., your project name), choose a region (APAC, EEUR, ENAM, WNAM), click **Create bucket**
> 3. In bucket **Settings**, enable **Public Development URL** (gives you a `pub-*.r2.dev` URL for public access)
> 4. Go to **R2 Object Storage** → **Manage R2 API Tokens** → **Create API token**
> 5. Token name: "AlpacApps Upload", Permissions: **Object Read & Write**, apply to **specific bucket** → select your bucket
> 6. Click **Create API Token** and copy the **Access Key ID** and **Secret Access Key** (shown only once!)
> 7. Note your **Account ID** (visible in the URL: `dash.cloudflare.com/{ACCOUNT_ID}/r2/...` or in R2 Overview)
>
> Paste: **Account ID**, **bucket name**, **public dev URL** (e.g., `https://pub-abc123.r2.dev`), **Access Key ID**, **Secret Access Key**

**Validate the credentials immediately:**
```bash
# Test S3-compatible list buckets endpoint
# Construct endpoint: https://{ACCOUNT_ID}.r2.cloudflarestorage.com
# Use AWS Signature V4 (you may need to use a temporary script or library)
# For now, trust the credentials and validate on first upload
```

**Then you:**
1. Set Supabase secrets:
   ```bash
   supabase secrets set \
     R2_ACCOUNT_ID="{ACCOUNT_ID}" \
     R2_ACCESS_KEY_ID="{ACCESS_KEY}" \
     R2_SECRET_ACCESS_KEY="{SECRET_KEY}" \
     R2_BUCKET_NAME="{BUCKET}" \
     R2_PUBLIC_URL="{PUBLIC_URL}"
   ```
2. Validate secrets were set: `supabase secrets list` (should show all 5)
3. Create tables:
   ```sql
   CREATE TABLE r2_config (
     id INT PRIMARY KEY DEFAULT 1,
     account_id TEXT NOT NULL,
     bucket_name TEXT NOT NULL,
     public_url TEXT NOT NULL,
     is_active BOOLEAN DEFAULT true,
     CHECK (id = 1)
   );
   CREATE TABLE document_index (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     title TEXT NOT NULL,
     description TEXT,
     keywords TEXT[],
     source_url TEXT,
     file_type TEXT,
     file_size_bytes INT,
     storage_backend TEXT CHECK (storage_backend IN ('supabase', 'r2')) DEFAULT 'r2',
     is_active BOOLEAN DEFAULT true,
     uploaded_by UUID REFERENCES app_users(id),
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
4. Insert config: `INSERT INTO r2_config (account_id, bucket_name, public_url) VALUES (...)`
5. Validate insert: `SELECT * FROM r2_config WHERE id = 1`
6. Create `supabase/functions/_shared/r2-upload.ts` with S3-compatible upload using AWS Signature V4:
   - `uploadToR2(key: string, body: Uint8Array | string, contentType: string): Promise<string>` → returns public URL
   - `deleteFromR2(key: string): Promise<void>` → deletes object
   - `getR2PublicUrl(key: string): string` → constructs public URL from config
7. Test the helper with a dummy upload (create a small test file, upload, verify public URL returns 200, delete)
8. Append to CLAUDE.md: S3 API endpoint pattern, public URL pattern, helper functions, tables, pricing (10GB free, $0.015/GB-mo)
9. Append to CLAUDE.local.md: account ID, access keys, bucket name, dashboard URL

### Step 11: DigitalOcean Droplet — if selected

Ask in a single message:

> If you already have a DigitalOcean droplet:
> 1. Paste the **droplet IPv4 address**
> 2. Paste the **SSH key path** on your local machine (e.g., `~/.ssh/id_rsa` or `~/.ssh/do_key`)
> 3. What **SSH user** do you connect as? (e.g., `root`)
>
> If you need a new droplet, create one at https://cloud.digitalocean.com/droplets/new
> — recommended: Ubuntu 22.04, Basic plan, $12/mo (2 GB / 1 vCPU)

**Then you:**
1. Test SSH connectivity: `ssh -o ConnectTimeout=5 -i {KEY_PATH} {USER}@{IP} "echo connected"`
2. If running services that clone this repo (e.g., bug fixer, bots), configure git permissions:
   ```bash
   ssh -i {KEY_PATH} {USER}@{IP} "cd /path/to/repo && git config core.sharedRepository group"
   ```
3. Ensure the repo clone is owned by the correct service user (not root):
   ```bash
   ssh -i {KEY_PATH} {USER}@{IP} "chown -R {SERVICE_USER}:{SERVICE_USER} /path/to/repo/.git"
   ```
4. Append DigitalOcean overview to CLAUDE.md (runs bot + worker, repo clone for screenshots, uses SKILL.md)
5. Append credentials to CLAUDE.local.md:
   - Droplet IP, SSH command, OS/specs
   - Service users and their working directories
   - Repo paths with git `core.sharedRepository=group` note
   - Troubleshooting: ownership fix command for `.git/objects`

### Step 12: Claude Code Permissions

After all services are configured, set up Claude Code tool permissions so the user doesn't get prompted for routine actions.

**Important:** The correct settings key is `permissions.allow` (NOT `allowedTools` which is deprecated and doesn't work).

**First, silently (no user action needed):**
1. Read `~/.claude/settings.json` (create it with `{"permissions":{"allow":[]}}` if it doesn't exist)
2. Always add these to the `permissions.allow` array (don't duplicate entries already present):
   - `"Edit"` — file editing
   - `"Write"` — file writing
   - `"Read"` — file reading
3. Write the updated file

**Then ask** with AskUserQuestion (multiSelect: true):

> **I've enabled file access by default. Want to also allow any of these without prompting?**
>
> You can always change this later in `~/.claude/settings.json`.

Options:
- **Web Search & Fetch** — Let Claude search the web and fetch URLs without prompting (WebSearch, WebFetch)
- **Git commands** — Let Claude run git commands without prompting (Bash(git *))
- **All Bash commands** — Let Claude run any terminal command without prompting (Bash(*))

**Then you:**
1. Merge the user's selections into the `permissions.allow` array (don't duplicate entries already present)
2. Write the updated file
3. Confirm what was added (including the defaults)

**Mapping:**
- "Web Search & Fetch" → add `"WebSearch"` and `"WebFetch"`
- "Git commands" → add `"Bash(git *)"`
- "All Bash commands" → add `"Bash(*)"` (this supersedes "Git commands" — if both selected, only add `"Bash(*)"`)
- `"Edit"`, `"Write"`, `"Read"` → always added (defaults, not optional)

### Step 13: Final Validation & Summary

**Run comprehensive validation checks:**

1. **GitHub Pages:**
   ```bash
   # Check if site is live
   curl -I https://{OWNER}.github.io/{REPO}/ | head -n 1
   # Should return HTTP 200

   # Validate HTML is being served
   curl -s https://{OWNER}.github.io/{REPO}/ | head -n 5
   # Should return HTML with <!DOCTYPE html>
   ```

2. **Supabase:**
   ```bash
   # Test database connection
   /opt/homebrew/opt/libpq/bin/psql "{POOLER_STRING}" -c "SELECT version(), current_database(), current_user"

   # Verify CLI is linked
   supabase status

   # List all tables
   psql "{POOLER_STRING}" -c "\dt"

   # Verify RLS is enabled on all tables
   psql "{POOLER_STRING}" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true"

   # List secrets
   supabase secrets list
   ```

3. **Edge Functions:**
   ```bash
   # List deployed functions
   supabase functions list

   # Test each function endpoint (expect auth error or 400, NOT 404)
   for func in send-email send-sms telnyx-webhook signwell-webhook process-square-payment resend-inbound-webhook; do
     echo "Testing $func..."
     curl -I https://{REF}.supabase.co/functions/v1/$func 2>&1 | head -n 1
   done
   ```

4. **Service Integrations (where applicable):**
   ```bash
   # Resend: Test API key
   curl -X GET https://api.resend.com/domains -H "Authorization: Bearer {RESEND_KEY}" | jq '.data | length'

   # Telnyx: Verify phone number
   curl -X GET https://api.telnyx.com/v2/phone_numbers/{PHONE} -H "Authorization: Bearer {TELNYX_KEY}" | jq '.data.messaging_profile_id'

   # Square: List locations
   curl -X GET https://connect.squareupsandbox.com/v2/locations -H "Square-Version: 2024-02-14" -H "Authorization: Bearer {SQUARE_TOKEN}" | jq '.locations | length'

   # SignWell: List templates
   curl -X GET https://www.signwell.com/api/v1/templates -H "X-Api-Key: {SIGNWELL_KEY}" | jq '. | length'

   # Gemini: Test generation
   curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}" -H "Content-Type: application/json" -d '{"contents":[{"parts":[{"text":"Hi"}]}]}' | jq '.candidates[0].content.parts[0].text'
   ```

5. **Storage Buckets:**
   ```bash
   # List Supabase storage buckets
   psql "{POOLER_STRING}" -c "SELECT name, public FROM storage.buckets"

   # Verify public policies exist
   psql "{POOLER_STRING}" -c "SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'"
   ```

6. **CLAUDE.md Files:**
   ```bash
   # Verify both files exist
   ls -lh CLAUDE.md CLAUDE.local.md

   # Verify CLAUDE.local.md is gitignored
   git check-ignore CLAUDE.local.md
   # Should output: CLAUDE.local.md

   # Verify CLAUDE.md is tracked
   git ls-files | grep CLAUDE.md
   # Should output: CLAUDE.md
   ```

**Show final summary:**

✓ **Setup Complete!** Your infrastructure is ready.

**Core Stack:**
- ✓ GitHub repo: https://github.com/{OWNER}/{REPO}
- ✓ GitHub Pages: https://{OWNER}.github.io/{REPO}/ (live)
- ✓ Supabase project: https://{REF}.supabase.co
- ✓ Database: {N} tables with RLS enabled
- ✓ Storage: {N} buckets configured

**Services Configured:**
{List each service that was set up, with validation status}
- ✓ Resend (email): API key validated, {N} domains verified
- ✓ Telnyx (SMS): Phone {PHONE} active, webhook configured
- ✓ Square (payments): Sandbox environment, {N} locations
- ✓ SignWell (e-signatures): API key validated, webhook configured
- ✓ Gemini (AI): API key validated, ready for use
- ✓ Cloudflare R2: Bucket {BUCKET} created, 10 GB free storage

**Edge Functions Deployed:**
{List each deployed function with URL}
- ✓ send-email: https://{REF}.supabase.co/functions/v1/send-email
- ✓ send-sms: https://{REF}.supabase.co/functions/v1/send-sms
- ✓ telnyx-webhook: https://{REF}.supabase.co/functions/v1/telnyx-webhook
{...etc}

**Pending Actions:**
{List any manual steps the user still needs to complete}
- ⏳ Telnyx 10DLC registration (required for US SMS) — approval takes 1-2 weeks
- ⏳ Resend domain verification (optional, improves deliverability)
- ⏳ Square production credentials (when ready to accept real payments)

**Claude Code Permissions:**
- ✓ File access enabled (Read, Write, Edit)
{List user's optional selections}
- ✓ Web Search & Fetch (WebSearch, WebFetch)
- ✓ Git commands (Bash(git *))

**Context Files:**
- ✓ `CLAUDE.md` — checked into repo (shareable project context)
- ✓ `CLAUDE.local.md` — gitignored (private credentials)

**Your CLAUDE.md and CLAUDE.local.md are complete.** Any future Claude Code session in this project will have full context automatically. CLAUDE.md is version-controlled (shareable with team). CLAUDE.local.md stays local (private credentials).

**Next steps:**
1. Build your first feature: "Create a landing page with a contact form"
2. Deploy with: `git add -A && git commit -m "Add landing page" && git push`
3. Your site updates automatically on GitHub Pages (30-60 seconds)

## Key Technical Details

- **Supabase auth**: Anon key for client-side, never expose service role key
- **RLS**: Enable on ALL tables. Default: public read, authenticated write
- **Edge functions**: Deno/TypeScript. Webhooks need `--no-verify-jwt`
- **Storage**: Public read policies for media buckets
- **psql**: Use session pooler (IPv4 compatible), URL-encode password special chars
- **Telnyx**: Bearer token auth (NOT Basic), JSON body (NOT form-encoded)
- **Square**: Sandbox first, production later
- **Two context files**: `CLAUDE.md` (checked in) has architecture, schema, patterns, conventions. `CLAUDE.local.md` (gitignored) has psql connection string, CLI instructions, credentials, and operator directives like "push immediately"
