---
name: setup-infra
description: Walk through setting up the full infrastructure stack (Supabase, Telnyx, Square, SignWell, Resend). Guides the user through creating accounts and gathering credentials, then builds everything out automatically.
---

# Infrastructure Setup Wizard

You are helping the user set up a complete do-it-all system from scratch — messaging, marketing, customer management, and finance. The stack uses Supabase, GitHub Pages, Resend, Telnyx, Square, and SignWell.

## Important Rules

- **You handle all terminal work.** The user should never need to run commands themselves.
- **Ask for credentials one service at a time.** Don't overwhelm them with everything at once.
- **Validate each credential before moving on** (e.g., test a Supabase connection before setting up tables).
- **Commit and push after each major step** so progress is saved.
- **Store API keys as Supabase secrets**, never hardcode them.
- **Always create a CLAUDE.md** in the project root with all configuration details so future Claude sessions have full context.

## Setup Flow

### Step 1: Prerequisites Check

Ask the user:
- Do you already have a GitHub account? If not, guide them to github.com to create one.
- Do you already have a Supabase account? If not, guide them to supabase.com.

Check locally:
- Is git installed? (`git --version`)
- Is Node.js installed? (`node --version`)
- Is the Supabase CLI installed? (`supabase --version`) — if not, install it: `npm install -g supabase`

### Step 2: GitHub + GitHub Pages

Ask the user to:
1. Create a new GitHub repository (public, for free GitHub Pages)
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
4. Enable GitHub Pages: tell the user to go to Settings → Pages → Deploy from branch → main → / (root) → Save
5. Commit and push

### Step 3: Supabase

Ask the user to:
1. Create a new Supabase project at supabase.com
2. Copy and paste to you:
   - **Project URL** (e.g., `https://abcdefghijk.supabase.co`)
   - **Anon public key**
   - **Project ref** (the `abcdefghijk` part)
   - **Database password**
   - **Session pooler connection string** (Settings → Database → Connection string → Session pooler)

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
1. Sign up at resend.com
2. Optionally verify their domain (Domains → Add Domain)
3. Create an API key and paste it

Then you:
1. Store the API key: `supabase secrets set RESEND_API_KEY=<key>`
2. Create `supabase/functions/send-email/index.ts`
3. Deploy: `supabase functions deploy send-email`
4. Create `shared/email-service.js` client module
5. Commit and push

### Step 5: Telnyx (SMS) — Optional

Ask the user if they want SMS. If yes:

Ask them to:
1. Sign up at telnyx.com, add payment method
2. Buy a phone number with SMS capability
3. Create a Messaging Profile, set inbound webhook URL:
   `https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-webhook`
4. Assign the phone number to the profile
5. Start 10DLC registration (Messaging → Compliance) — warn them this takes days/weeks
6. Copy and paste: API key, Messaging Profile ID, phone number, public key

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
1. Create a developer account at developer.squareup.com
2. Create an Application
3. Copy: Application ID, Sandbox Access Token, Location ID

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
1. Sign up at signwell.com
2. Copy their API key from Settings → API
3. Add webhook URL in Settings → Webhooks:
   `https://<PROJECT_REF>.supabase.co/functions/v1/signwell-webhook`
4. Subscribe to `document_completed` event

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
1. Get a free API key at aistudio.google.com

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
