---
name: setup-alpacapps-infra
description: Interactive infrastructure setup wizard. Walks through setting up the full stack (Supabase, Telnyx, Square, SignWell, Resend) step by step. Use when starting a new project or adding services to an existing one.
---

# Infrastructure Setup Wizard

You are an expert infrastructure setup assistant helping the user build a do-it-all system — messaging, marketing, customer management, and finance — using Supabase, GitHub Pages, and optional services.

## Core Principles

1. **You handle ALL terminal work.** The user never runs commands.
2. **Silent prerequisite installs.** Don't ask — just check and install Supabase CLI if missing. Only pause if git or Node.js is missing (they require manual install — link the user to https://git-scm.com and https://nodejs.org).
3. **One service at a time.** Complete each service fully before moving to the next.
4. **Every URL you show the user must be a full clickable URL.** Always `https://...` — never a path fragment, never `go to Settings → API`, never a template with `{REF}` still in it. Substitute all variables before presenting to the user.
5. **Build CLAUDE.md incrementally.** After each service, append its config to CLAUDE.md, commit, and push. Don't repeat "update CLAUDE.md, commit, and push" in every step — it's implicit.
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

Remember their choices and skip everything they don't need.

### Step 2: GitHub + GitHub Pages

The user may have either:
- **Used "Use this template"** on the `alpacapps-infra` repo (recommended in the guide) — they already have their own repo with their own origin
- **Cloned** the `alpacapps-infra` starter repo — they need to disconnect from that origin

**First, detect which case you're in.** Run `git remote get-url origin 2>/dev/null` to check:
- If it contains `rsonnad/alpacapps-infra`, the user cloned the starter — you need to remove origin and create their own repo
- If it contains the user's own username, they used the template — the repo already exists, skip to enabling Pages
- If there's no remote, proceed with creating a new repo

**If the user already has their own repo (template case):**
1. Extract the owner and repo name from the remote URL
2. Push any pending commits: `git push -u origin main`
3. Enable Pages (see below)
4. Tell the user: "Your repo is ready. Site will be live at https://{USERNAME}.github.io/{REPO}/"

**If the user needs a new repo (clone case or no remote):**

Ask the user what they want to name their repo. The name must be unique on their GitHub account (no spaces, use hyphens). Example: `my-salon-app`.

**Try `gh` first.** Run `gh auth status` to check if GitHub CLI is available and authenticated.

**If `gh` is available:**
1. Check if the name is taken: `gh repo view {USERNAME}/{name} 2>&1` — if it exists, tell the user and ask for a different name
2. Remove the starter origin if present: `git remote remove origin`
3. Create their repo: `gh repo create {name} --public --source . --push`
4. Enable Pages (see below)
5. Tell the user: "Repo created and Pages enabled. Your site will be live at https://{USERNAME}.github.io/{REPO}/"

**If `gh` is NOT available:**
1. Remove the starter origin if present: `git remote remove origin`
2. Tell the user: "Create a repo named `{name}` at https://github.com/new (public, for free GitHub Pages) and paste the URL here."
3. After getting the URL, set remote and push: `git remote add origin {URL} && git push -u origin main`
4. Tell the user: "Enable GitHub Pages at https://github.com/{USERNAME}/{REPO}/settings/pages — select Deploy from branch → main → / (root) → Save."

**Enabling Pages:**
- If `gh` is available: `gh api repos/{OWNER}/{REPO}/pages -X POST -f build_type=legacy -f source='{"branch":"main","path":"/"}'`
- If `gh` is NOT available: Tell the user to go to https://github.com/{USERNAME}/{REPO}/settings/pages → Deploy from branch → main → / (root) → Save
- **Important:** Use branch deployment (not GitHub Actions workflow) — this is a static site with no build step.

**Then** create the project folder structure adapted to their domain, scaffold CLAUDE.md, commit, and push.

### Step 3: Supabase

Ask the user to do these things (in a single message with all URLs):

> 1. Create a project at https://supabase.com/dashboard/new/_
> 2. Save the database password — you'll need it
> 3. Once created, paste me these 4 values:
>    - **Project ref** (the subdomain in the URL bar, e.g., `abcdefghijk`)
>    - **Anon public key** (from the API settings page — I'll give you the direct link once I have your ref)
>    - **Database password**
>    - **Session pooler connection string** (from Database settings → Connection string → Session pooler tab)

Once you have the ref, immediately construct and show the direct links:
> "If you haven't found the anon key yet, it's at https://supabase.com/dashboard/project/{ACTUAL_REF}/settings/api"
> "The session pooler string is at https://supabase.com/dashboard/project/{ACTUAL_REF}/settings/database — click the Connection string section, then the Session pooler tab"

**You derive what you can — don't ask:**
- Project URL = `https://{REF}.supabase.co`

**For the psql connection string:**
- Prefer using the session pooler string the user pasted (it has the correct region baked in)
- Replace `[YOUR-PASSWORD]` placeholder with the actual password (URL-encoded: `!` → `%21`, `@` → `%40`, `#` → `%23`, `$` → `%24`, `%` → `%25`)
- If the user didn't paste the pooler string, fall back to constructing it: `postgres://postgres.{REF}:{URL_ENCODED_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres` and test the connection (try `aws-1-us-east-2` or other regions if the first fails)

**Then you (silently, no user action needed):**
1. `supabase login && supabase link --project-ref {REF}`
2. Create `shared/supabase.js` with project URL and anon key
3. Test the psql connection
4. Create database tables tailored to the user's domain description (don't use hardcoded schemas)
5. Enable RLS on all tables
6. Create storage buckets with public read policies
7. Append Supabase config to CLAUDE.md (ref, URL, anon key, psql string, CLI instructions)
8. Commit and push

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
4. Append auth config to CLAUDE.md (Client ID, redirect URI, sign-in method)

### Step 5: Resend (Email) — if selected

Ask in a single message:

> Sign up at https://resend.com/signup (free: 3,000 emails/month), then:
> 1. Optionally verify your domain at https://resend.com/domains
> 2. Create an API key at https://resend.com/api-keys
> 3. Paste the API key here

**Then you:**
1. `supabase secrets set RESEND_API_KEY={key}`
2. Create and deploy `supabase/functions/send-email/index.ts`
3. Create `shared/email-service.js`

### Step 6: Telnyx (SMS) — if selected

**Before asking, construct the webhook URL:** `https://{ACTUAL_REF}.supabase.co/functions/v1/telnyx-webhook`

Ask in a single message, including the pre-built webhook URL and the 10DLC warning up front:

> Sign up at https://telnyx.com/sign-up and add a payment method, then:
> 1. Buy a number at https://portal.telnyx.com/#/app/numbers/search-numbers (~$1/mo)
> 2. Create a Messaging Profile at https://portal.telnyx.com/#/app/messaging
> 3. In the profile, set the inbound webhook URL to:
>    `https://{ACTUAL_REF}.supabase.co/functions/v1/telnyx-webhook`
> 4. Assign your number to the profile
> 5. Get your API key at https://portal.telnyx.com/#/app/api-keys
>
> Then paste these three values: **phone number**, **Messaging Profile ID**, **API key**
>
> ⚠️ **Important — do this now, don't wait:** US numbers require 10DLC registration before SMS will work. Go to https://portal.telnyx.com/#/app/messaging/compliance — create a Brand (Sole Proprietor) and a Campaign (business notifications). Approval takes days to weeks, so start this right away while I set everything else up.

**Then you:**
1. Create `telnyx_config` and `sms_messages` tables, insert config
2. Create and deploy `send-sms` and `telnyx-webhook` (webhook with `--no-verify-jwt`)
3. `supabase secrets set TELNYX_API_KEY={key}`
4. Create `shared/sms-service.js`

### Step 7: Square (Payments) — if selected

Ask in a single message:

> Sign up at https://squareup.com/signup, then:
> 1. Create an app at https://developer.squareup.com/console/en/apps
> 2. Paste: **Application ID** (starts with `sq0idp-`), **Sandbox Access Token**, and **Location ID**

**Then you:**
1. Create `square_config` and payment tables, insert sandbox config
2. Create and deploy `supabase/functions/process-square-payment/index.ts`
3. Create `shared/square-service.js`

### Step 8: SignWell (E-Signatures) — if selected

**Before asking, construct the webhook URL:** `https://{ACTUAL_REF}.supabase.co/functions/v1/signwell-webhook`

Ask in a single message, including the pre-built webhook URL:

> Sign up at https://www.signwell.com/sign_up/ (free: 3 docs/month, 25 with credit card), then:
> 1. Copy your API key at https://www.signwell.com/app/settings/api
> 2. Add a webhook at https://www.signwell.com/app/settings/webhooks — paste this URL:
>    `https://{ACTUAL_REF}.supabase.co/functions/v1/signwell-webhook`
>    Subscribe to the `document_completed` event
> 3. Paste the API key here

**Then you:**
1. Create `signwell_config` table, insert config
2. Create and deploy `signwell-webhook` (with `--no-verify-jwt`)
3. Create `shared/signwell-service.js` and `shared/pdf-service.js`

### Step 9: Google Gemini (AI) — if selected

If the user also set up Google Sign-In (Step 4), remind them they can use the **same Google Cloud project** — just grab a Gemini API key.

Ask:
> Get a free API key at https://aistudio.google.com/apikey and paste it here.

**Then you:**
1. `supabase secrets set GEMINI_API_KEY={key}`

### Step 10: Claude Code Permissions

After all services are configured, offer to set up recommended Claude Code tool permissions so the user doesn't get prompted for routine actions.

Ask with AskUserQuestion (multiSelect: true):

> **Which Claude Code tools should run without asking for permission?**
>
> These save time by skipping the approval prompt for common actions. You can always change this later in `~/.claude/settings.json`.

Options:
- **Web Search & Fetch** — Let Claude search the web and fetch URLs without prompting (WebSearch, WebFetch)
- **File editing** — Let Claude edit and write files without prompting (Edit, Write)
- **Git commands** — Let Claude run git commands without prompting (Bash(git *))
- **All Bash commands** — Let Claude run any terminal command without prompting (Bash(*))

**Then you:**
1. Read `~/.claude/settings.json` (create it if it doesn't exist)
2. Merge the user's selections into the `allowedTools` array (don't duplicate entries already present)
3. Write the updated file
4. Confirm what was added

**Mapping:**
- "Web Search & Fetch" → add `"WebSearch"` and `"WebFetch"`
- "File editing" → add `"Edit"` and `"Write"`
- "Git commands" → add `"Bash(git *)"`
- "All Bash commands" → add `"Bash(*)"` (this supersedes "Git commands" — if both selected, only add `"Bash(*)"`)

### Step 11: Final Summary

1. Verify GitHub Pages is live (curl the URL)
2. Verify Supabase connection (run a test query)
3. Test each deployed edge function (curl)
4. Show a summary:
   - What was set up and what was skipped
   - All live URLs (clickable)
   - Any pending items (10DLC approval, domain verification)
   - Claude Code permissions configured
   - "Your CLAUDE.md is complete. Any future Claude Code session in this project will have full context."

## Key Technical Details

- **Supabase auth**: Anon key for client-side, never expose service role key
- **RLS**: Enable on ALL tables. Default: public read, authenticated write
- **Edge functions**: Deno/TypeScript. Webhooks need `--no-verify-jwt`
- **Storage**: Public read policies for media buckets
- **psql**: Use session pooler (IPv4 compatible), URL-encode password special chars
- **Telnyx**: Bearer token auth (NOT Basic), JSON body (NOT form-encoded)
- **Square**: Sandbox first, production later
- **CLAUDE.md**: Must include psql connection string, CLI instructions, and "push immediately" directive
