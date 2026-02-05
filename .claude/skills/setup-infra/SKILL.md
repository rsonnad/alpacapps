---
name: setup-infra
description: Walk through setting up the full infrastructure stack (Supabase, Telnyx, Square, SignWell, Resend). Guides the user through creating accounts and gathering credentials, then builds everything out automatically.
---

# Infrastructure Setup Wizard

You are helping the user set up a complete do-it-all system from scratch — messaging, marketing, customer management, and finance. The stack uses Supabase, GitHub Pages, Resend, Telnyx, Square, and SignWell.

## Important Rules

- **You handle all terminal work.** The user should never need to run commands themselves.
- **Ask for credentials one service at a time.** Don't overwhelm them with everything at once.
- **Give direct URLs for every step.** Never say "go to Settings → API" — give the exact clickable URL.
- **Validate each credential before moving on** (e.g., test a Supabase connection before setting up tables).
- **Commit and push after each major step** so progress is saved.
- **Store API keys as Supabase secrets**, never hardcode them.
- **Always create a CLAUDE.md** in the project root with all configuration details so future Claude sessions have full context.

## Setup Flow

### Step 1: Prerequisites Check

Ask the user:
- Do you already have a GitHub account? If not: **https://github.com/join**
- Do you already have a Supabase account? If not: **https://supabase.com/dashboard** (sign up with GitHub)

Check locally:
- Is git installed? (`git --version`)
- Is Node.js installed? (`node --version`)
- Is the Supabase CLI installed? (`supabase --version`) — if not, install it: `npm install -g supabase`

### Step 2: GitHub + GitHub Pages

Ask the user to:
1. Create a new repo at **https://github.com/new** (public, for free GitHub Pages)
2. Give you the repo URL (e.g., `https://github.com/username/repo`)

Then you:
1. Initialize the project folder if needed (`git init`)
2. Set the remote (`git remote add origin <url>`)
3. Create the folder structure:
   ```
   index.html
   styles/site.css
   shared/supabase.js
   shared/auth.js
   spaces/index.html
   spaces/app.js
   spaces/admin/index.html
   spaces/admin/app.js
   spaces/admin/manage.html
   supabase/functions/
   ```
4. Tell the user to enable GitHub Pages at: **https://github.com/{USERNAME}/{REPO}/settings/pages**
   - Select "Deploy from a branch" → main → / (root) → Save
5. Commit and push

### Step 3: Supabase

Ask the user to:
1. Create a new project at **https://supabase.com/dashboard/new/_**
2. Set a **database password** — tell them to save this securely
3. Choose a region close to their users, click Create
4. Once the project is ready, tell them to go to these pages and copy the values:
   - **API page** → `https://supabase.com/dashboard/project/{PROJECT_REF}/settings/api`
     - Copy: **Project URL** and **anon public key**
     - The project ref is the subdomain part of the URL (e.g., `abcdefghijk`)
   - **Database page** → `https://supabase.com/dashboard/project/{PROJECT_REF}/settings/database`
     - Copy: **Session pooler connection string** (under Connection string → Session pooler tab)

Note: Once you have the project ref, construct the direct URLs for the user so they can click straight to the right page.

Then you:
1. Login and link the Supabase CLI (`supabase login && supabase link --project-ref <ref>`)
2. Create `shared/supabase.js` with the project URL and anon key
3. Test the database connection via psql (URL-encode special chars in password: `!` → `%21`, `@` → `%40`)
4. Create core database tables via psql:
   - `spaces` (name, type, rates, beds, baths, description, visibility flags)
   - `people` (name, email, phone, type)
   - `assignments` (person_id, space_id, dates, rate, status)
   - `media` (url, dimensions, caption, category)
   - `media_spaces` (media_id, space_id, display_order, is_primary)
5. Enable RLS on all tables with appropriate policies
6. Create storage buckets (`housephotos`, `lease-documents`) with public read policies
7. Commit and push

### Step 4: Resend (Email)

Ask the user to:
1. Sign up at **https://resend.com/signup**
2. Optionally add their domain at **https://resend.com/domains** (without this, they can only send from `onboarding@resend.dev`)
3. Create an API key at **https://resend.com/api-keys** and paste it

Then you:
1. Store the API key: `supabase secrets set RESEND_API_KEY=<key>`
2. Create `supabase/functions/send-email/index.ts`
3. Deploy: `supabase functions deploy send-email`
4. Create `shared/email-service.js` client module
5. Commit and push

### Step 5: Telnyx (SMS) — Optional

Ask the user if they want SMS. If yes:

Ask them to:
1. Sign up at **https://telnyx.com/sign-up** and add a payment method
2. Buy an SMS-capable number at **https://portal.telnyx.com/#/app/numbers/search-numbers** (~$1/month)
3. Note the phone number in E.164 format (e.g., `+12125551234`)
4. Create a Messaging Profile at **https://portal.telnyx.com/#/app/messaging**
   - Set inbound webhook URL: `https://{PROJECT_REF}.supabase.co/functions/v1/telnyx-webhook`
   - Assign the phone number to this profile
   - Note the **Messaging Profile ID**
5. Get API key at **https://portal.telnyx.com/#/app/api-keys** — copy the key + **Public Key**
6. Start 10DLC registration at **https://portal.telnyx.com/#/app/messaging/compliance**
   - Create a Brand (Sole Proprietor), then a Campaign (business notifications)
   - Assign the number — warn them this takes days/weeks for approval

Then you:
1. Create `telnyx_config` and `sms_messages` tables via psql
2. Insert config into `telnyx_config`
3. Create `supabase/functions/send-sms/index.ts`
4. Create `supabase/functions/telnyx-webhook/index.ts`
5. Deploy both (webhook with `--no-verify-jwt`)
6. Store secrets: `supabase secrets set TELNYX_API_KEY=<key>`
7. Create `shared/sms-service.js` client module
8. Commit and push

### Step 6: Square (Payments) — Optional

Ask the user if they want payment processing. If yes:

Ask them to:
1. Sign up at **https://squareup.com/signup**
2. Go to the developer console at **https://developer.squareup.com/console/en/apps**
3. Click **+** or **New Application** to create an app
4. Copy from the app's credentials page:
   - **Application ID** (starts with `sq0idp-`)
   - **Sandbox Access Token**
   - **Location ID** — find in the Square Dashboard under Locations

Then you:
1. Create `square_config` and `square_payments` tables via psql
2. Insert sandbox config
3. Create `supabase/functions/process-square-payment/index.ts`
4. Deploy the function
5. Create `shared/square-service.js` client module
6. Commit and push

### Step 7: SignWell (E-Signatures) — Optional

Ask the user if they want e-signatures. If yes:

Ask them to:
1. Sign up at **https://www.signwell.com/sign_up/**
2. Copy their API key from **https://www.signwell.com/app/settings/api**
3. Add webhook at **https://www.signwell.com/app/settings/webhooks**:
   - URL: `https://{PROJECT_REF}.supabase.co/functions/v1/signwell-webhook`
   - Subscribe to the `document_completed` event

Then you:
1. Create `signwell_config` table via psql
2. Insert config
3. Create `supabase/functions/signwell-webhook/index.ts`
4. Deploy (with `--no-verify-jwt`)
5. Create `shared/signwell-service.js` and `shared/pdf-service.js`
6. Commit and push

### Step 8: Google Gemini (AI) — Optional

Ask the user if they want AI-powered features. If yes:

Ask them to:
1. Get a free API key at **https://aistudio.google.com/apikey**

Then you:
1. Store it: `supabase secrets set GEMINI_API_KEY=<key>`

### Step 9: Generate CLAUDE.md

After all services are configured, generate a complete `CLAUDE.md` file in the project root containing:
- Project overview and tech stack
- All Supabase connection details (project ref, URL, anon key, psql connection string)
- CLI instructions for Claude
- All external service configurations
- Database schema documentation
- Deployment instructions (push to main)
- Coding conventions

This file ensures any future Claude Code session has full context about the project.

### Step 10: Final Verification

1. Verify GitHub Pages is live (check the URL)
2. Verify Supabase connection works (run a test query)
3. Verify each deployed edge function responds (curl test)
4. Show the user a summary of everything that was set up
5. Remind them about any pending items (10DLC approval, domain verification, etc.)

## Key Technical Details

- **Supabase auth**: Use anon key for client-side, never expose service role key
- **RLS**: Enable on ALL tables. Default policy: public read, authenticated write
- **Edge functions**: Deno/TypeScript. Webhooks need `--no-verify-jwt` since external services can't send Supabase JWTs
- **Storage**: Public read policies for media buckets
- **psql connection**: Use session pooler (IPv4 compatible), URL-encode password special chars
- **Telnyx**: Bearer token auth (NOT Basic auth), JSON body (NOT form-encoded)
- **Square**: Use sandbox environment first, switch to production later
