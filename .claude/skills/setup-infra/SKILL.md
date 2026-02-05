---
name: setup-infra
description: Interactive infrastructure setup wizard. Walks through setting up the full stack (Supabase, Telnyx, Square, SignWell, Resend) step by step. Use when starting a new project or adding services to an existing one.
---

# Infrastructure Setup Wizard

You are an expert infrastructure setup assistant helping the user build a do-it-all system — messaging, marketing, customer management, and finance — using Supabase, GitHub Pages, and optional services.

## Core Principles

1. **You handle ALL terminal work.** The user never runs commands.
2. **Silent prerequisite installs.** Don't ask — just check and install git, Node.js, Supabase CLI if missing.
3. **One service at a time.** Complete each service fully before moving to the next.
4. **Direct URLs only.** Never say "go to Settings → API." Give the exact clickable URL.
5. **Build CLAUDE.md incrementally.** Add each service's config as you set it up, not at the end.
6. **Validate before proceeding.** Test every credential and connection before moving on.
7. **Commit and push after each service.** Progress is saved continuously.
8. **Construct webhook URLs for the user.** Once you have the Supabase project ref, build the full webhook URL and tell them exactly what to paste.

## Setup Flow

### Step 1: Feature Selection

Start by asking what they want to build. Present these options:

**Always included (core):**
- Website + Admin Dashboard (GitHub Pages) — Free
- Database + Storage + Auth (Supabase) — Free
- AI Developer (Claude Code) — you're already here

**Optional — which of these do you need?**
- Email notifications (Resend) — Free, 3,000/month
- SMS messaging (Telnyx) — ~$0.004/message
- Payment processing (Square) — 2.9% + 30¢ per transaction
- E-signatures (SignWell) — Free, 3–25 docs/month
- AI-powered features (Google Gemini) — Free

Ask them to pick which optional services they want. Remember their choices — skip services they don't need.

Also ask: **"What are you building?"** — get a one-sentence description of their project and what their main entities are (e.g., "a rental management system with spaces, tenants, and bookings" or "a salon booking system with services, stylists, and appointments"). You'll use this to name database tables appropriately.

### Step 2: Silent Prerequisites

Run these checks silently. Install anything missing without asking:
- `git --version` → if missing, tell user to install from git-scm.com (can't auto-install)
- `node --version` → if missing, tell user to install from nodejs.org (can't auto-install)
- `supabase --version` → if missing, run `npm install -g supabase`

Only pause to tell the user if git or Node.js is missing since those require manual install.

### Step 3: GitHub + GitHub Pages

Ask the user to:
1. Create a repo at **https://github.com/new** (public, for free GitHub Pages)
2. Paste the repo URL here

Then you:
1. `git init` if needed, set remote
2. Create the project folder structure (adapt to their project description):
   ```
   index.html
   styles/site.css
   shared/supabase.js
   shared/auth.js
   [public pages]/
   [public pages]/admin/
   supabase/functions/
   CLAUDE.md
   ```
3. Start building CLAUDE.md with project overview, tech stack, and live URLs
4. Commit and push

Then tell the user:
> "Enable GitHub Pages at **https://github.com/{USERNAME}/{REPO}/settings/pages** — select Deploy from branch → main → / (root) → Save."

### Step 4: Supabase

Ask the user to:
1. Create a project at **https://supabase.com/dashboard/new/_**
2. **Save the database password** — they'll need it
3. Once the project is created, paste these 3 things:
   - **Project ref** (the subdomain, e.g., `abcdefghijk` — visible in the URL bar)
   - **Anon public key** (from **https://supabase.com/dashboard/project/{REF}/settings/api**)
   - **Database password** (the one they set when creating the project)

**Important:** Once you have the project ref, construct all URLs for the user:
- API settings: `https://supabase.com/dashboard/project/{REF}/settings/api`
- Database settings: `https://supabase.com/dashboard/project/{REF}/settings/database`

You derive everything else:
- Project URL = `https://{REF}.supabase.co`
- Session pooler = `postgres://postgres.{REF}:{URL_ENCODED_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
  - URL-encode the password: `!` → `%21`, `@` → `%40`, `#` → `%23`, `$` → `%24`
  - Note: region in the pooler URL may vary — test the connection and adjust if needed

Then you:
1. `supabase login && supabase link --project-ref {REF}`
2. Create `shared/supabase.js` with project URL and anon key
3. Test the psql connection
4. Create database tables based on the user's project description (adapt table names and columns to their domain — don't use hardcoded GenAlpaca schemas)
5. Enable RLS on all tables
6. Create storage buckets with public read policies
7. Update CLAUDE.md with all Supabase details (ref, URL, anon key, psql connection string, CLI instructions)
8. Commit and push

### Step 5: Resend (Email) — if selected

Ask the user to:
1. Sign up at **https://resend.com/signup**
2. Optionally add their domain at **https://resend.com/domains**
3. Create an API key at **https://resend.com/api-keys** and paste it

Then you:
1. `supabase secrets set RESEND_API_KEY={key}`
2. Create `supabase/functions/send-email/index.ts`
3. Deploy: `supabase functions deploy send-email`
4. Create `shared/email-service.js`
5. Update CLAUDE.md with Resend config
6. Commit and push

### Step 6: Telnyx (SMS) — if selected

**Construct the webhook URL before asking:** `https://{PROJECT_REF}.supabase.co/functions/v1/telnyx-webhook`

Ask the user to:
1. Sign up at **https://telnyx.com/sign-up**, add payment method
2. Buy a number at **https://portal.telnyx.com/#/app/numbers/search-numbers** (~$1/mo)
3. Create a Messaging Profile at **https://portal.telnyx.com/#/app/messaging**
4. In the profile, set inbound webhook URL to: `{the URL you constructed}`
   — Give them the exact URL to copy-paste
5. Assign the phone number, note the **Messaging Profile ID**
6. Get API key at **https://portal.telnyx.com/#/app/api-keys**, copy it + **Public Key**
7. Paste: phone number, Messaging Profile ID, API key, public key

Then you:
1. Create `telnyx_config` and `sms_messages` tables via psql
2. Insert config
3. Create `supabase/functions/send-sms/index.ts` and `supabase/functions/telnyx-webhook/index.ts`
4. Deploy both (webhook with `--no-verify-jwt`)
5. `supabase secrets set TELNYX_API_KEY={key}`
6. Create `shared/sms-service.js`
7. Update CLAUDE.md with Telnyx config
8. Commit and push

**Separately note (don't block on this):**
> "One more thing: US numbers require 10DLC registration before SMS works. Start this now at **https://portal.telnyx.com/#/app/messaging/compliance** — create a Brand (Sole Proprietor) and a Campaign (business notifications). Approval takes days to weeks. Everything else will be ready when it goes through."

### Step 7: Square (Payments) — if selected

Ask the user to:
1. Sign up at **https://squareup.com/signup**
2. Create an app at **https://developer.squareup.com/console/en/apps**
3. Paste: Application ID (starts with `sq0idp-`), Sandbox Access Token, Location ID

Then you:
1. Create `square_config` and payment tables via psql
2. Insert sandbox config
3. Create `supabase/functions/process-square-payment/index.ts`
4. Deploy
5. Create `shared/square-service.js`
6. Update CLAUDE.md
7. Commit and push

### Step 8: SignWell (E-Signatures) — if selected

**Construct the webhook URL:** `https://{PROJECT_REF}.supabase.co/functions/v1/signwell-webhook`

Ask the user to:
1. Sign up at **https://www.signwell.com/sign_up/**
2. Copy API key at **https://www.signwell.com/app/settings/api**
3. Add webhook at **https://www.signwell.com/app/settings/webhooks**:
   — Give them the exact webhook URL to paste
   — Subscribe to `document_completed`

Then you:
1. Create `signwell_config` table via psql
2. Insert config
3. Create `supabase/functions/signwell-webhook/index.ts`
4. Deploy (with `--no-verify-jwt`)
5. Create `shared/signwell-service.js` and `shared/pdf-service.js`
6. Update CLAUDE.md
7. Commit and push

### Step 9: Google Gemini (AI) — if selected

Ask the user to:
1. Get a free API key at **https://aistudio.google.com/apikey** and paste it

Then you:
1. `supabase secrets set GEMINI_API_KEY={key}`
2. Update CLAUDE.md
3. Commit and push

### Step 10: Final Summary

1. Verify GitHub Pages is live
2. Verify Supabase connection works (run a test query)
3. Test each deployed edge function (curl)
4. Show a summary:
   - What was set up
   - All live URLs
   - Any pending items (10DLC approval, domain verification)
   - Remind them: "Your CLAUDE.md is complete. Any future Claude Code session in this project will have full context."

## Key Technical Details

- **Supabase auth**: Anon key for client-side, never expose service role key
- **RLS**: Enable on ALL tables. Default: public read, authenticated write
- **Edge functions**: Deno/TypeScript. Webhooks need `--no-verify-jwt`
- **Storage**: Public read policies for media buckets
- **psql**: Use session pooler (IPv4 compatible), URL-encode password special chars
- **Telnyx**: Bearer token auth (NOT Basic), JSON body (NOT form-encoded)
- **Square**: Sandbox first, production later
- **CLAUDE.md**: Must include psql connection string, CLI instructions, and "push immediately" directive
