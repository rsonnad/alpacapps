# Infrastructure Replication Guide

How to set up a super low cost do-it-all system from scratch — messaging, marketing, customer management, and finance. This guide covers every vendor account, configuration step, and how to wire it all together with Claude Code as your AI developer.

**$0/month for the infrastructure.** Claude Code is free to start, or $20/month (Pro) for more usage — $100/$200 plans available for intensive development. SMS and payments are pay-as-you-go.

**The philosophy:** You set up the (mostly free) vendor accounts and gather credentials. Then tell Claude Code what you have and what you want — it handles all the terminal work: database migrations, CLI setup, edge function deployment, git pushes. You never need to touch the command line yourself.

---

## What can you build with this?

Pick the capabilities you need. The core platform is always included — everything else is optional.

### Core (always included)
| Capability | What it does | Service | Cost |
|-----------|-------------|---------|------|
| **Website + Admin Dashboard** | Public-facing site and private admin panel | GitHub Pages | Free |
| **Database + Storage + Auth** | PostgreSQL, file storage, user auth, serverless functions | Supabase | Free |
| **AI Developer** | Claude Code builds your app, deploys changes, manages the database | Claude Code | Free–$200/mo |

### Optional (add what you need)
| Capability | What it does | Service | Cost |
|-----------|-------------|---------|------|
| **Email Notifications** | Reminders, confirmations, receipts, announcements | Resend | Free (3,000/mo) |
| **SMS Messaging** | Outbound/inbound SMS, notifications, two-way conversations | Telnyx | ~$0.004/msg |
| **Payment Processing** | Accept credit cards online, invoicing, receipts, refunds | Square | 2.9% + 30¢ |
| **E-Signatures** | Generate contracts from templates, send for digital signature | SignWell | Free (3–25 docs/mo) |
| **AI-Powered Features** | Fuzzy matching, smart categorization, natural language search | Google Gemini | Free |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Install Claude Code First](#2-install-claude-code-first)
3. [GitHub + GitHub Pages (Hosting)](#3-github--github-pages-hosting)
4. [Supabase (Database + Storage + Edge Functions)](#4-supabase-database--storage--edge-functions)
5. [Resend (Email)](#5-resend-email)
6. [Telnyx (SMS)](#6-telnyx-sms)
7. [Square (Payments)](#7-square-payments)
8. [SignWell (E-Signatures)](#8-signwell-e-signatures)
9. [Google Gemini (AI Matching — Optional)](#9-google-gemini-ai-matching--optional)
10. [Discord Bot — Optional](#10-discord-bot--optional)
11. [Custom Domain — Optional](#11-custom-domain--optional)
12. [CLAUDE.md Template](#12-claudemd-template)
13. [Day-One Checklist](#13-day-one-checklist)

---

## 1. Architecture Overview

```
Browser → GitHub Pages (static HTML/CSS/JS) → Supabase (PostgreSQL + Storage + Auth)
                                             ↗
Optional: Discord Bot (DigitalOcean) ───────┘
```

**Key principle:** No backend server. All application logic runs client-side in the browser. Supabase provides the database, file storage, authentication, and serverless functions (Edge Functions). GitHub Pages serves the static files for free.

**Services used:**

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| GitHub Pages | Static site hosting | Unlimited |
| Supabase | Database, storage, auth, edge functions | 500 MB DB, 1 GB storage, 500K edge function invocations |
| Resend | Transactional email | 3,000 emails/month |
| Telnyx | SMS notifications | Pay-as-you-go (~$0.004/SMS) |
| Square | Payment processing | Free until you process payments (2.9% + 30¢ per transaction) |
| SignWell | E-signatures | 3 free documents/month (25/month with card on file) |
| Google Gemini | AI-powered matching | Free tier available |

---

## 2. Install Claude Code First

Claude Code is your AI developer. Install it before anything else — for every service in this guide, you'll create accounts and copy credentials in your browser, then Claude Code handles all the terminal work.

> **Recommended: Claude Pro ($20/month) or higher.** The free tier works, but you'll hit usage limits quickly when setting up infrastructure. The [Pro plan ($20/month)](https://claude.ai/upgrade) gives you significantly more usage. For intensive development, consider Max ($100) or Max+ ($200).

### You do (one time):

1. Sign up for [Claude Pro](https://claude.ai) ($20/month recommended)
2. Download the [Claude desktop app](https://claude.ai/download) — Claude Code is built in
3. Open the app, click the **terminal icon** or press `Ctrl+`` to open Claude Code
4. Point it at your project folder and create a `CLAUDE.md` file in the root (see [Section 12](#12-claudemd-template) for the full template)

> **Prefer the command line?** You can also install Claude Code as a CLI tool:
> ```bash
> npm install -g @anthropic-ai/claude-code
> ```
> Then run `claude` in your project directory. Same features, same skills — just a terminal interface instead of the desktop app.

### The easy way: use the setup skill

This repo includes a built-in skill that walks you through the entire setup interactively. Just type:

```
/setup-alpacapps-infra
```

Claude will ask you for credentials one service at a time, validate each one, build everything out, and push. You don't need to read the rest of this guide — the skill covers it all.

### How it works (if doing it manually)

For every service below, the pattern is:
1. **You** create the account and copy credentials (browser)
2. **You** paste credentials into your `CLAUDE.md` file
3. **You** tell Claude what to do in plain English
4. **Claude** handles the rest — installs CLIs, creates database tables, writes edge functions, deploys, pushes code

Example conversation:
```
You: "Set up the Supabase database with tables for spaces, people, and bookings.
      Here are my credentials: [already in CLAUDE.md]"

Claude: *installs Supabase CLI, links project, creates tables with RLS,
         creates storage buckets, commits and pushes*
```

---

## 3. GitHub + GitHub Pages (Hosting)

### You do (in your browser):

1. Create a free account at [github.com/join](https://github.com/join)
2. Create a new repository at [github.com/new](https://github.com/new) (public repos get free GitHub Pages)
3. Name it whatever you want (e.g., `my-app`)
4. Go to Pages settings: `https://github.com/USERNAME/REPO/settings/pages`
5. Under "Source," select **Deploy from a branch** → **main** → **/ (root)** → **Save**
6. Your site is live at `https://<username>.github.io/<repo-name>/`

### Paste into CLAUDE.md:

```markdown
**Live URLs:**
- Public view: https://USERNAME.github.io/REPO/
- Admin view: https://USERNAME.github.io/REPO/admin/
- Repository: https://github.com/USERNAME/REPO
```

### Then tell Claude:

> "Set up the project folder structure with index.html, styles.css, shared modules folder, and admin pages."

Claude will create the folder structure, scaffold the initial files, commit, and push — your site goes live automatically.

**Project structure Claude will create:**
```
your-repo/
├── index.html              # Landing page
├── styles.css              # Global styles
├── shared/                 # Shared JavaScript modules
│   ├── supabase.js         # Supabase client singleton
│   ├── auth.js             # Authentication
│   └── ...                 # Other services
├── spaces/                 # Public-facing pages
│   ├── index.html
│   ├── app.js
│   └── admin/              # Admin dashboard
│       ├── index.html
│       ├── app.js
│       └── manage.html
└── supabase/               # Edge functions (deployed via CLI, not served by Pages)
    └── functions/
        └── ...
```

---

## 4. Supabase (Database + Storage + Edge Functions)

### You do (in your browser):

1. Sign up at [supabase.com/dashboard](https://supabase.com/dashboard) (GitHub login works)
2. Create a new project at [supabase.com/dashboard/new](https://supabase.com/dashboard/new/_)
3. Set a **database password** — save this securely
4. Choose a region close to your users, click **Create new project**
5. Go to **API settings**: `supabase.com/dashboard/project/YOUR_REF/settings/api` and copy:
   - **Project URL** (e.g., `https://abcdefghijk.supabase.co`)
   - **Anon public key** (safe to embed in frontend — RLS protects your data)
   - **Project ref** (the `abcdefghijk` part of the URL)
6. Go to **Database settings**: `supabase.com/dashboard/project/YOUR_REF/settings/database` → **Connection string** → **Session pooler** tab and copy it

### Paste into CLAUDE.md:

```markdown
## Supabase Details

- Project ID: `YOUR_PROJECT_REF`
- URL: `https://YOUR_PROJECT_REF.supabase.co`
- Anon key: `your-anon-key-here`

### Direct Database Access (for Claude)

Claude can run SQL directly against the database using `psql`:

psql "postgres://postgres.YOUR_REF:YOUR_URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" -c "SQL HERE"

**Important:** URL-encode special characters in the password (e.g., `!` → `%21`, `@` → `%40`).

### Supabase CLI Access (for Claude)

supabase functions deploy <function-name>
supabase functions logs <function-name>
supabase secrets set KEY=value

**For Claude:** Install the Supabase CLI if not present, login, and link to the project.
Run these commands directly — don't ask the user to run them manually.
```

### Then tell Claude:

> "Set up my Supabase project. Install the CLI, link it, create the core database tables for [your domain], enable RLS on all tables, and create storage buckets for photos and documents."

**Claude will:**
- Install the Supabase CLI (`npm install -g supabase`)
- Login and link to your project (`supabase login && supabase link --project-ref YOUR_REF`)
- Create `shared/supabase.js` with your credentials
- Run SQL to create tables, enable RLS, set up storage policies
- Commit and push

### What Claude sets up (RLS example):
```sql
-- Enable RLS on a table
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anon key can read)
CREATE POLICY "Public read access" ON your_table FOR SELECT USING (true);
```

### What Claude sets up (storage example):
```sql
CREATE POLICY "Allow public reads" ON storage.objects
  FOR SELECT USING (bucket_id = 'photos');
CREATE POLICY "Allow public uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'photos');
```

---

## 5. Resend (Email)

### You do (in your browser):

1. Sign up at [resend.com/signup](https://resend.com/signup) (free: 3,000 emails/month)
2. **Recommended:** Add your domain at [resend.com/domains](https://resend.com/domains) and set up DNS records. Without this, you can only send from `onboarding@resend.dev`.
3. Create an API key at [resend.com/api-keys](https://resend.com/api-keys) and copy it

### Paste into CLAUDE.md:

```markdown
### Email (Resend)
- API key: `re_your_key_here` (store as Supabase secret: RESEND_API_KEY)
- From address: notifications@yourdomain.com (or onboarding@resend.dev)
```

### Then tell Claude:

> "Set up email sending with Resend. Store the API key as a Supabase secret and create a send-email edge function."

**Claude will:**
- Run `supabase secrets set RESEND_API_KEY=re_your_key_here`
- Create `supabase/functions/send-email/index.ts` with the Resend API integration
- Deploy the edge function
- Commit and push

---

## 6. Telnyx (SMS)

### You do (in your browser):

1. Sign up at [telnyx.com/sign-up](https://telnyx.com/sign-up) and add a payment method
2. Buy an SMS-capable number at [portal.telnyx.com → Numbers](https://portal.telnyx.com/#/app/numbers/search-numbers) (~$1/month)
3. Note the phone number in E.164 format (e.g., `+12125551234`)
4. Create a Messaging Profile at [portal.telnyx.com → Messaging](https://portal.telnyx.com/#/app/messaging)
5. Set inbound webhook URL:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/telnyx-webhook
   ```
6. Assign your phone number to this profile, note the **Messaging Profile ID**
7. Get your API key at [portal.telnyx.com → API Keys](https://portal.telnyx.com/#/app/api-keys), copy it + the **Public Key**

**⚠️ 10DLC Registration (Required for US) — Do this now, it takes time:**
1. Go to [portal.telnyx.com → Compliance](https://portal.telnyx.com/#/app/messaging/compliance)
2. Create a **Brand** (Sole Proprietor is simplest)
3. Create a **Campaign** (use case: business notifications)
4. Assign your phone number to the campaign
5. Wait for approval (can take days to weeks — SMS won't work without it)

### Paste into CLAUDE.md:

```markdown
### SMS (Telnyx)
- API key: `KEY_your_key_here`
- Messaging Profile ID: `your-profile-id`
- Phone number: `+12125551234`
- Public key: `your-public-key-here`
- Webhook URL: https://YOUR_PROJECT_REF.supabase.co/functions/v1/telnyx-webhook
- Config stored in `telnyx_config` table
- Edge functions: `send-sms` (outbound), `telnyx-webhook` (inbound)
- Deploy webhook with `--no-verify-jwt` (Telnyx can't send Supabase JWT)

Key Telnyx API details:
- Auth: Bearer token (NOT Basic auth like Twilio)
- Outbound format: JSON body (not form-encoded)
- Inbound webhook: JSON (not form-encoded like Twilio), no TwiML response
- API endpoint: https://api.telnyx.com/v2/messages
```

### Then tell Claude:

> "Set up Telnyx SMS. Create the telnyx_config table, the sms_messages log table, and the send-sms and telnyx-webhook edge functions. Deploy the webhook with --no-verify-jwt."

**Claude will:**
- Run SQL to create `telnyx_config` and `sms_messages` tables
- Insert your config into `telnyx_config`
- Create `supabase/functions/send-sms/index.ts` (outbound SMS)
- Create `supabase/functions/telnyx-webhook/index.ts` (inbound SMS)
- Deploy both functions (webhook with `--no-verify-jwt`)
- Create `shared/sms-service.js` client module
- Commit and push

---

## 7. Square (Payments)

### You do (in your browser):

1. Sign up at [squareup.com/signup](https://squareup.com/signup)
2. Create an app at [developer.squareup.com/console → Apps](https://developer.squareup.com/console/en/apps)
3. From the app's credentials page, copy:
   - **Application ID** (starts with `sq0idp-`)
   - **Access Token** — use Sandbox for testing, Production for real charges
   - **Location ID** — go to Square Dashboard → **Locations**
5. Note the environment URLs:
   - Sandbox: `https://connect.squareupsandbox.com/v2`
   - Production: `https://connect.squareup.com/v2`

### Paste into CLAUDE.md:

```markdown
### Payments (Square)
- Application ID: `sq0idp-your-app-id`
- Sandbox Access Token: `your-sandbox-token`
- Location ID: `your-location-id`
- Environment: sandbox (switch to production when ready)
- Config stored in `square_config` table
- Edge function: `process-square-payment`
- Client SDK: https://sandbox.web.squarecdn.com/v1/square.js (sandbox)
  or https://web.squarecdn.com/v1/square.js (production)
```

### Then tell Claude:

> "Set up Square payment processing. Create the square_config table, the square_payments log table, a process-square-payment edge function, and a client-side square-service.js module."

**Claude will:**
- Run SQL to create `square_config` and `square_payments` tables
- Insert your sandbox config
- Create `supabase/functions/process-square-payment/index.ts`
- Deploy the edge function
- Create `shared/square-service.js` (client-side card tokenization)
- Add the Square SDK script tag to payment pages
- Commit and push

---

## 8. SignWell (E-Signatures)

### You do (in your browser):

1. Sign up at [signwell.com/sign_up](https://www.signwell.com/sign_up/) (free: 3 docs/month, 25 with credit card)
2. Copy your API key at [signwell.com → Settings → API](https://www.signwell.com/app/settings/api)
3. Add a webhook at [signwell.com → Settings → Webhooks](https://www.signwell.com/app/settings/webhooks):
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/signwell-webhook
   ```
6. Subscribe to the `document_completed` event

### Paste into CLAUDE.md:

```markdown
### E-Signatures (SignWell)
- API key: `your-signwell-api-key`
- API base: https://www.signwell.com/api/v1
- Auth header: X-Api-Key: your_api_key
- Webhook URL: https://YOUR_PROJECT_REF.supabase.co/functions/v1/signwell-webhook
- Config stored in `signwell_config` table
- Deploy webhook with `--no-verify-jwt`
```

### Then tell Claude:

> "Set up SignWell for e-signatures. Create the signwell_config table, a signwell-webhook edge function, and a client-side signwell-service.js module."

**Claude will:**
- Run SQL to create `signwell_config` table
- Insert your API key config
- Create `supabase/functions/signwell-webhook/index.ts`
- Deploy the webhook edge function (with `--no-verify-jwt`)
- Create `shared/signwell-service.js` and `shared/pdf-service.js`
- Commit and push

---

## 9. Google Gemini (AI Matching — Optional)

Useful for fuzzy matching (e.g., matching bank transaction sender names to tenants).

### You do (in your browser):

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Paste into CLAUDE.md:

```markdown
### AI Matching (Google Gemini — Optional)
- API key: `your-gemini-key` (store as Supabase secret: GEMINI_API_KEY)
```

### Then tell Claude:

> "Store my Gemini API key as a Supabase secret."

Claude will run: `supabase secrets set GEMINI_API_KEY=your_key_here`

---

## 10. Discord Bot — Optional

If you want a Discord bot that queries your database:

### You do (in your browser):

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a **New Application**
3. Go to **Bot** → **Add Bot**
4. Copy the bot token
5. Host the bot on a $4/month DigitalOcean droplet (or free tier on Railway / Render)
6. The bot queries Supabase directly using the REST API

---

## 11. Custom Domain — Optional

### You do (in your browser):

1. Buy a domain from any registrar (Namecheap, Cloudflare, Google Domains)
2. In your repo **Settings** → **Pages** → **Custom domain**, enter your domain
3. Add DNS records:
   - **A records** pointing to GitHub's IPs:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - **CNAME** for `www` pointing to `<username>.github.io`
4. Check **Enforce HTTPS**

---

## 12. CLAUDE.md Template

Copy this starter template into a file called `CLAUDE.md` in your project root. Fill in the placeholders with your actual credentials from the steps above.

```markdown
# CLAUDE.md - [Your Project Name]

This file provides context for Claude (AI assistant) when working on this codebase.

> **IMPORTANT: You have direct database access!**
> See "Direct Database Access" section below.
> Always run SQL migrations directly using `psql` - never ask the user to run SQL manually.

> **IMPORTANT: Push changes immediately!**
> This is a GitHub Pages site - changes only go live after pushing.
> Always `git push` as soon as changes are ready.

> **IMPORTANT: First-time setup!**
> If the Supabase CLI is not installed or linked, run:
> `npm install -g supabase && supabase login && supabase link --project-ref YOUR_PROJECT_REF`

## Project Overview

[Your project] is a [type of system] for [purpose]. It manages [core entities].

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (no framework)
- Backend: Supabase (PostgreSQL + Storage + Auth)
- Hosting: GitHub Pages (static site)

**Live URLs:**
- Public view: https://USERNAME.github.io/REPO/
- Admin view: https://USERNAME.github.io/REPO/admin/
- Repository: https://github.com/USERNAME/REPO

## Architecture

\```
Browser → GitHub Pages (static HTML/JS) → Supabase (database + storage)
\```

No server-side code - all logic runs client-side. Supabase handles data persistence.

## Database Schema (Supabase)

### Core Tables
[List all your tables, columns, and relationships]

## Common Patterns

### Fetching Data
\```javascript
const { data } = await supabase
  .from('your_table')
  .select('*')
  .order('created_at', { ascending: false });
\```

## Deployment

This site deploys directly to GitHub Pages from the `main` branch. No build step, no PR process — just push to main and it's live.

\```bash
git add <files>
git commit -m "Description"
git push
# Changes are live in 1-2 minutes
\```

**For Claude:** Always push changes immediately after making them. Don't wait for user confirmation.

## Supabase Details

- Project ID: `YOUR_PROJECT_REF`
- URL: `https://YOUR_PROJECT_REF.supabase.co`
- Anon key is in `shared/supabase.js` (safe to expose, RLS protects data)

### Direct Database Access (for Claude)

\```bash
psql "postgres://postgres.YOUR_REF:YOUR_URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" -c "SQL HERE"
\```

- URL-encode special characters in the password (e.g., `!` → `%21`)
- Always use this for database migrations — don't ask the user to run SQL manually

### Supabase CLI Access (for Claude)

\```bash
# Deploy edge functions
supabase functions deploy <function-name>

# View function logs
supabase functions logs <function-name>

# Set secrets
supabase secrets set KEY=value
\```

**For Claude:** Run these commands directly — don't ask the user to run them manually.
If the CLI is not yet installed/linked, install and link it first.

## External Services

### Email (Resend)
- API key stored as Supabase secret: `RESEND_API_KEY`
- From address: notifications@yourdomain.com
- Edge function: `send-email`

### SMS (Telnyx)
- Config in `telnyx_config` table (api_key, messaging_profile_id, phone_number, test_mode)
- Edge functions: `send-sms` (outbound), `telnyx-webhook` (inbound)
- Deploy webhooks with `--no-verify-jwt`
- Auth: Bearer token (NOT Basic auth)
- API endpoint: https://api.telnyx.com/v2/messages

### Payments (Square)
- Config in `square_config` table (application_id, access_token, location_id, environment)
- Edge function: `process-square-payment`
- Client SDK: square-service.js (card tokenization)

### E-Signatures (SignWell)
- Config in `signwell_config` table (api_key, webhook_secret, test_mode)
- Edge function: `signwell-webhook` (deploy with `--no-verify-jwt`)
- API base: https://www.signwell.com/api/v1

## Conventions

1. Use toast notifications, not `alert()`
2. Filter archived/deleted items client-side
3. Don't expose personal info in public views
4. Client-side image compression for files > 500KB
```

---

## 13. Day-One Checklist

### You do (in your browser)

**Core Stack — Free:**
- [ ] Create GitHub account and repository
- [ ] Enable GitHub Pages on the repo
- [ ] Create Supabase account and project
- [ ] Copy: Supabase URL, anon key, project ref, DB password, session pooler string

**Email — Free (Resend):**
- [ ] Create Resend account
- [ ] Verify your domain (or use `onboarding@resend.dev` for testing)
- [ ] Copy: API key

**SMS — Pay-as-you-go (Telnyx):**
- [ ] Create Telnyx account, add payment method
- [ ] Buy a phone number (~$1/month)
- [ ] Create a Messaging Profile, assign number, set webhook URL
- [ ] Register for 10DLC (mandatory for US SMS — do this early, approval takes time)
- [ ] Copy: API key, Messaging Profile ID, phone number, public key

**Payments — Free until you process (Square):**
- [ ] Create Square developer account and application
- [ ] Copy: Application ID, sandbox access token, location ID

**E-Signatures — Free tier (SignWell):**
- [ ] Create SignWell account
- [ ] Set up webhook URL in Settings
- [ ] Copy: API key

**Optional:**
- [ ] Custom domain for GitHub Pages
- [ ] Google Gemini API key (aistudio.google.com)
- [ ] Discord developer application + bot token

### Then tell Claude (in your terminal)

Once you've pasted all credentials into your `CLAUDE.md`, open Claude Code in your project folder and say:

> "I've set up all my vendor accounts and put the credentials in CLAUDE.md. Please:
> 1. Set up the project structure and push to GitHub
> 2. Install and link the Supabase CLI
> 3. Create the database tables I need for [your domain]
> 4. Set up email sending with Resend
> 5. Set up SMS with Telnyx
> 6. Set up payment processing with Square
> 7. Set up e-signatures with SignWell
> 8. Deploy all edge functions and store API keys as secrets"

Claude will handle everything from there — creating tables, writing edge functions, deploying, setting secrets, committing, and pushing. You never need to touch the terminal yourself.

---

## Cost Summary

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| GitHub Pages | $0 | Unlimited for public repos |
| Supabase | $0 | Free tier: 500 MB DB, 1 GB storage |
| Resend | $0 | 3,000 emails/month free |
| Telnyx | ~$1 + $0.004/SMS | Phone number + per-message |
| Square | 2.9% + 30¢ per transaction | No monthly fee |
| SignWell | $0 | 3–25 docs/month free |
| Google Gemini | $0 | Free tier available |
| Custom domain | ~$10/year | Optional |
| **Claude Code** | $0–$200 | Free tier available. Pro $20, Max $100, Max+ $200 for intensive development |

**$0/month for the infrastructure.** Claude Code is free to start, or $20/month (Pro) for more usage. For intensive development, the $100 or $200 plans are available. SMS and payments are pay-as-you-go with no minimums.
