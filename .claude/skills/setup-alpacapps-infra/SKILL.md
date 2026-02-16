---
name: setup-alpacapps-infra
description: Interactive infrastructure setup wizard for new projects. Walks through GitHub Pages, Supabase, auth, email, SMS, payments, e-signatures, AI, storage, and server setup — one service at a time. Use when user says "set up a new project", "start a project from scratch", "configure Supabase", "add a new service", "set up infrastructure", "help me deploy", or "setup wizard".
---

# Infrastructure Setup Wizard

You are an expert infrastructure setup assistant. You help users build full-stack systems using Supabase, GitHub Pages, and optional services (email, SMS, payments, AI, storage, servers).

## Critical Rules

1. **You handle ALL terminal work.** The user never runs commands.
2. **Silent prerequisite installs.** Check and install Supabase CLI if missing. Only pause if git or Node.js is missing (link user to https://git-scm.com and https://nodejs.org).
3. **One service at a time.** Complete each fully before moving on.
4. **Every URL must be clickable.** Always `https://...` — never path fragments or unsubstituted templates.
5. **Build CLAUDE.md + CLAUDE.local.md incrementally.**
   - `CLAUDE.md` (checked in): architecture, schema, patterns, conventions
   - `CLAUDE.local.md` (gitignored): credentials, connection strings, operator directives
   - After each service: append details, commit, push. This is implicit — don't repeat it.
6. **Validate before proceeding.** Test every credential and connection before moving on.
7. **Construct webhook URLs yourself.** Once you have the Supabase project ref, build all webhook URLs as copy-paste-ready values.
8. **Derive everything you can.** Don't ask for things you can compute (project URL from ref, pooler string from ref + password, etc.).
9. **Use `gh` CLI when available.** Create repos and enable Pages automatically.

## Setup Flow

### Step 1: Feature Selection

Ask two things in one message:

1. **"What are you building?"** — One-sentence description + main entities.
2. **"Which optional capabilities do you need?"** — Present this list:

**Always included (core):**
- Website + Admin Dashboard (GitHub Pages) — Free
- Database + Storage + Auth (Supabase) — Free
- Tailwind CSS v4 (utility-class styling) — Free
- AI Developer (Claude Code) — you're already here

**Pick any you need:**
- User login / Google Sign-In (Google OAuth via Supabase) — Free
- Email notifications (Resend) — Free, 3,000/month
- SMS messaging (Telnyx) — ~$0.004/message
- Payment processing (Square) — 2.9% + 30¢
- Stripe payments + ACH (Stripe) — ACH: 0.8% capped at $5; Cards: 2.9% + 30¢
- E-signatures (SignWell) — Free, 3–25 docs/month
- AI-powered features (Google Gemini) — Free
- Object storage / file hosting (Cloudflare R2) — Free, 10 GB
- DigitalOcean Droplet (bots, workers) — ~$12/mo
- Oracle Cloud ARM instance (free tier) — Always Free (4 cores, 24 GB RAM, 200 GB)

Remember their choices and skip everything they don't need.

### Step 2: GitHub + GitHub Pages

See `references/core-services.md` → "GitHub + GitHub Pages" for detailed steps.

**Summary:**
1. Detect current state (git remote, `gh` CLI availability)
2. Determine case: template repo, clone, or no remote
3. Create or configure repo (prefer `gh api repos/.../generate` for template API)
4. Enable Pages (branch deploy from main, not GitHub Actions)
5. Validate deployment (poll for HTTP 200, up to 60s)
6. Scaffold `CLAUDE.md` + `CLAUDE.local.md`, add to `.gitignore`, commit, push

### Step 2b: Tailwind CSS v4

Set up Tailwind CSS for utility-class styling alongside existing CSS.

**Steps (all handled by you):**
1. Initialize npm if needed: `npm init -y`
2. Install: `npm install -D tailwindcss @tailwindcss/cli`
3. Create `styles/tailwind.css` (Tailwind v4 CSS-first config):
   - `@import "tailwindcss";`
   - `@source` directives pointing to HTML/JS files
   - `@theme` block mapping project design tokens (colors, fonts, shadows, radii)
4. Build: `npx @tailwindcss/cli -i styles/tailwind.css -o styles/tailwind.out.css --minify`
5. Add npm scripts to `package.json`: `css:build` and `css:watch`
6. Add `<link rel="stylesheet" href="styles/tailwind.out.css">` to all HTML pages
7. Add `node_modules/` to `.gitignore`
8. If GitHub Actions CI exists, add `npm ci && npm run css:build` step before deploy
9. Commit `package.json`, `package-lock.json`, `styles/tailwind.css`, `styles/tailwind.out.css`

**Key points:**
- Tailwind v4 uses CSS-first config (no `tailwind.config.js`)
- Coexists with existing CSS — no rewrite needed
- `tailwind.out.css` is committed to repo (GitHub Pages has no server-side build)
- Map existing CSS custom properties to Tailwind theme in `@theme` block

### Step 3: Supabase

See `references/core-services.md` → "Supabase" for detailed steps.

**Summary:**
1. Check for existing Supabase link (`supabase status`)
2. Create project via Management API (preferred) or ask user for manual creation
3. Fetch anon key via API or ask user
4. Construct session pooler string (URL-encode password special chars)
5. Validate psql connection
6. Pre-construct ALL webhook URLs for later steps
7. Link CLI, create domain-specific tables with RLS, create storage buckets
8. Validate everything: tables, RLS, secrets, edge functions

### Step 4: Google Sign-In (OAuth) — if selected

See `references/core-services.md` → "Google Sign-In" for detailed steps.

**Summary:**
1. User creates Google Cloud project + OAuth credentials
2. Add redirect URI: `https://{REF}.supabase.co/auth/v1/callback`
3. Enable Google provider in Supabase dashboard
4. You create `shared/auth.js` with Google OAuth, add login/logout UI

**Note:** If user also selected Gemini, mention they can use the same Google Cloud project.

### Steps 5–10: Optional Services

For each selected service, follow the detailed instructions in the appropriate reference file:

- **Resend (Email)** → `references/optional-services.md` → "Resend"
- **Telnyx (SMS)** → `references/optional-services.md` → "Telnyx"
- **Square (Payments)** → `references/optional-services.md` → "Square"
- **Square Webhook** → `references/optional-services.md` → "Square Webhook"
- **Stripe (Payments + ACH)** → `references/optional-services.md` → "Stripe"
- **SignWell (E-Signatures)** → `references/optional-services.md` → "SignWell"
- **Google Gemini (AI)** → `references/optional-services.md` → "Gemini"
- **Cloudflare R2 (Storage)** → `references/optional-services.md` → "Cloudflare R2"

**Pattern for each service:**
1. Ask user for credentials/config in a single message with all URLs
2. Validate credentials immediately via API call
3. Create DB tables, insert config, set Supabase secrets
4. Create and deploy edge functions (webhooks with `--no-verify-jwt`)
5. Create client service module
6. Append to CLAUDE.md (shareable) and CLAUDE.local.md (private)

### Step 11: Server Setup — if selected

- **DigitalOcean** → `references/server-setup.md` → "DigitalOcean"
- **Oracle Cloud** → `references/server-setup.md` → "Oracle Cloud"

### Step 12: Claude Code Permissions

**Silently (no user action):**
1. Read `~/.claude/settings.json` (create with `{"permissions":{"allow":[]}}` if missing)
2. Always add: `"Edit"`, `"Write"`, `"Read"` to `permissions.allow`

**Then ask** with AskUserQuestion (multiSelect: true):
> I've enabled file access by default. Want to also allow any of these without prompting?

Options:
- **Web Search & Fetch** → `"WebSearch"`, `"WebFetch"`
- **Git commands** → `"Bash(git *)"`
- **All Bash commands** → `"Bash(*)"` (supersedes Git commands)

Write updated file and confirm what was added.

### Step 13: Final Validation & Summary

See `references/validation-checklist.md` for the full checklist and summary template.

**Summary:**
1. Validate GitHub Pages (HTTP 200)
2. Validate Supabase (psql, CLI link, tables, RLS, secrets)
3. Validate edge functions (expect auth error, NOT 404)
4. Validate each service API key
5. Validate storage buckets
6. Verify CLAUDE.md tracked, CLAUDE.local.md gitignored
7. Show final summary with all services, URLs, and pending actions

## Examples

### Example 1: Full Stack Project
User says: "I'm building a salon booking system with services, stylists, and appointments. I need email, payments, and Google Sign-In."

Actions:
1. Feature Selection → Email (Resend), Payments (Stripe or Square), Google OAuth
2. GitHub repo + Pages
3. Supabase with tables: `services`, `stylists`, `appointments`, `clients`
4. Google OAuth setup
5. Resend email setup
6. Payment setup (Square or Stripe based on preference)
7. Claude Code permissions
8. Final validation + summary

### Example 2: Minimal Setup
User says: "I just need a database and a website for a personal project tracker."

Actions:
1. Feature Selection → Core only (no optional services)
2. GitHub repo + Pages
3. Supabase with tables: `projects`, `tasks`
4. Claude Code permissions
5. Final validation + summary

### Example 3: Adding a Service Later
User says: "Add SMS to my existing project."

Actions:
1. Check existing Supabase link (should already be configured)
2. Extract project ref from existing config
3. Follow Telnyx setup from `references/optional-services.md`
4. Update CLAUDE.md + CLAUDE.local.md

## Common Issues

### Error: "Supabase CLI not logged in"
Cause: `supabase login` hasn't been run
Solution: Run `supabase login` — opens browser for auth

### Error: "psql connection refused"
Cause: Wrong region in pooler URL or password encoding issue
Solution: Try alternative regions (`aws-1-us-east-2`, `aws-0-us-west-1`). URL-encode special chars in password: `!` → `%21`, `@` → `%40`, `#` → `%23`

### Error: "Edge function returns 404"
Cause: Function not deployed or wrong name
Solution: Run `supabase functions list` to check. Deploy with `supabase functions deploy {name}`. Webhooks need `--no-verify-jwt`.

### Error: "Pages not deploying"
Cause: Pages configured for GitHub Actions instead of branch deploy
Solution: Go to repo Settings → Pages → set "Deploy from a branch" → main → / (root)

### Error: "API key invalid" on any service
Cause: Wrong key, expired key, or key for wrong environment (sandbox vs production)
Solution: Re-check the service dashboard. Make sure you're using the right environment's keys.

## Key Technical Details

- **Supabase auth**: Anon key for client-side, never expose service role key
- **RLS**: Enable on ALL tables. Default: public read, authenticated write
- **Edge functions**: Deno/TypeScript. Webhooks need `--no-verify-jwt`
- **Storage**: Public read policies for media buckets
- **psql**: Use session pooler (IPv4 compatible), URL-encode password special chars
- **Telnyx**: Bearer token auth (NOT Basic), JSON body (NOT form-encoded)
- **Square/Stripe**: Sandbox first, production later
- **Two context files**: `CLAUDE.md` (checked in) for architecture/patterns. `CLAUDE.local.md` (gitignored) for credentials/operator directives.
- **Permissions key**: Use `permissions.allow` array (NOT deprecated `allowedTools`)
