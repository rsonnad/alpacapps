# Core Services Setup

These services are always configured (GitHub Pages + Supabase + optional Auth).

## GitHub + GitHub Pages

### Detect Current State

```bash
# Check git remote
git remote get-url origin 2>/dev/null

# Check gh CLI
gh auth status 2>/dev/null

# Get current user
gh api user --jq .login
```

### Determine Case

- **Template case:** Remote URL contains user's own username (not `rsonnad/alpacapps-infra`)
- **Clone case:** Remote URL contains `rsonnad/alpacapps-infra`
- **No remote:** No origin configured

### Template Case (User Already Has Repo)

1. Extract owner/repo from remote URL
2. Validate repo exists: `gh repo view {OWNER}/{REPO}`
3. Check Pages: `gh api repos/{OWNER}/{REPO}/pages` — HTTP 200 = enabled, 404 = not
4. Push pending commits: `git push -u origin main`
5. Enable Pages if not enabled (see below)
6. Validate deployment

### New Repo Needed

**Option A: GitHub Template API (preferred if `gh` available):**

1. Ask user for repo name (no spaces, use hyphens)
2. Validate name: `gh repo view {USERNAME}/{name}` — exit code 0 means name taken
3. Use template API:
   ```bash
   gh api repos/rsonnad/alpacapps-infra/generate \
     -f name={name} \
     -f owner={USERNAME} \
     -f include_all_branches=false \
     -f private=false
   ```
4. Wait: `sleep 3`
5. Update remote: `git remote remove origin 2>/dev/null; git remote add origin https://github.com/{USERNAME}/{name}.git`
6. Push: `git push -u origin main`

**Option B: Manual (fallback if no `gh`):**

1. Remove starter origin: `git remote remove origin 2>/dev/null || true`
2. Tell user: "Create a repo at https://github.com/new (public) and paste the URL"
3. Set remote and push: `git remote add origin {URL} && git push -u origin main`
4. Tell user to enable Pages manually

### Enabling Pages

**With `gh`:**
```bash
gh api repos/{OWNER}/{REPO}/pages -X POST \
  -f build_type=legacy \
  -f source='{"branch":"main","path":"/"}'
```
- HTTP 409 = already enabled (fine)
- HTTP 404 = repo not ready, wait 5s and retry

**Without `gh`:** Tell user: Go to `https://github.com/{OWNER}/{REPO}/settings/pages` → Deploy from branch → main → / (root) → Save

**Important:** Use branch deployment, NOT GitHub Actions — this is a static site with no build step.

### Validating Deployment

```bash
for i in {1..12}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" https://{OWNER}.github.io/{REPO}/)
  if [ "$status" = "200" ]; then
    echo "Site is live"
    break
  fi
  echo "Waiting for Pages deployment... ($i/12)"
  sleep 5
done
```

### Then

- Create project folder structure adapted to user's domain
- Scaffold `CLAUDE.md` (shareable context) and `CLAUDE.local.md` (private credentials)
- Add `CLAUDE.local.md` to `.gitignore`
- Add note at top of `CLAUDE.md`: "See `CLAUDE.local.md` for credentials and environment-specific configuration."
- Commit and push

---

## Supabase

### Check Existing Link

```bash
supabase status 2>/dev/null
```
If linked, extract project ref and skip creation.

### Option A: Management API (Preferred)

Check for Management API token in CLAUDE.local.md (`SUPABASE_MGMT_TOKEN`).

**If token available:**

1. List orgs: `curl -s https://api.supabase.com/v1/organizations -H "Authorization: Bearer {MGMT_TOKEN}"`
2. Get first org ID
3. Ask user for: **project name**, **database password**, **region** (optional, default us-east-1)
4. Create project:
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
5. Poll for provisioning (up to 2 min)
6. Extract: `project_ref`, `anon_key`, `service_role_key`, `database.host`

### Option B: Manual Creation

Ask user in a single message:

> Create a Supabase project:
> 1. Go to https://supabase.com/dashboard/new/_
> 2. Fill in project name, database password (save it!), region
> 3. Click Create and wait 1-2 minutes
> 4. Paste me: **Project ref** (subdomain in URL bar) and **Database password**

### After Getting Project Ref

**Fetch anon key via API (if Management API token available):**
```bash
curl -s https://api.supabase.com/v1/projects/{REF}/api-keys \
  -H "Authorization: Bearer {MGMT_TOKEN}"
```
Otherwise, tell user: "Get your anon key from https://supabase.com/dashboard/project/{REF}/settings/api"

**Construct session pooler string:**
1. Get region from Management API or user
2. Build: `postgres://postgres.{REF}:{URL_ENCODED_PASSWORD}@aws-0-{REGION}.pooler.supabase.com:5432/postgres`
3. URL-encode password special chars: `!` → `%21`, `@` → `%40`, `#` → `%23`, `$` → `%24`, `%` → `%25`, `&` → `%26`

**Validate connection:**
```bash
/opt/homebrew/opt/libpq/bin/psql "{POOLER_STRING}" -c "SELECT 1"
```
If fails, try alternate regions: `aws-1-us-east-2`, `aws-0-us-west-1`

**Pre-construct ALL webhook URLs:**
- Telnyx: `https://{REF}.supabase.co/functions/v1/telnyx-webhook`
- SignWell: `https://{REF}.supabase.co/functions/v1/signwell-webhook`
- Resend inbound: `https://{REF}.supabase.co/functions/v1/resend-inbound-webhook`
- PayPal: `https://{REF}.supabase.co/functions/v1/paypal-webhook`
- Vapi: `https://{REF}.supabase.co/functions/v1/vapi-webhook`
- Square: `https://{REF}.supabase.co/functions/v1/square-webhook`
- Stripe: `https://{REF}.supabase.co/functions/v1/stripe-webhook`

Store these for later steps.

### Then (Silently)

1. Install Supabase CLI if missing: `npm install -g supabase`
2. Login if needed: `supabase login` (opens browser)
3. Link: `supabase link --project-ref {REF}`
4. Validate: `supabase status`
5. Create `shared/supabase.js` with project URL and anon key
6. Test psql: `/opt/homebrew/opt/libpq/bin/psql "{POOLER_STRING}" -c "SELECT version()"`
7. Create domain-specific tables via psql (tailored to user's description, NOT hardcoded)
8. Enable RLS: `ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;`
9. Create storage buckets with public read policies
10. Validate tables: `\dt`
11. Validate RLS: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true`
12. Append to CLAUDE.md: project ref, URL, storage buckets, webhook URLs, CLI reference
13. Append to CLAUDE.local.md: project ref, URL, anon key, psql string, Management API token, operator directives

---

## Google Sign-In (Google OAuth via Supabase)

**Note:** If user also selected Gemini, mention they can use the same Google Cloud project.

### Ask User (Single Message)

> Set up Google Sign-In:
> 1. Create a Google Cloud project at https://console.cloud.google.com/projectcreate
> 2. Set up OAuth consent screen at https://console.cloud.google.com/apis/credentials/consent — choose External, fill in app name and email, click through defaults
> 3. Create OAuth credentials at https://console.cloud.google.com/apis/credentials — Create Credentials → OAuth client ID → Web application
> 4. Under Authorized redirect URIs, add: `https://{REF}.supabase.co/auth/v1/callback`
> 5. Copy the Client ID and Client Secret
> 6. Enable Google provider in Supabase at https://supabase.com/dashboard/project/{REF}/auth/providers — toggle Google on, paste Client ID and Secret, Save
> 7. Paste the Client ID here (I don't need the secret — it's saved in Supabase)

**Important reminder:** OAuth consent screen starts in "Testing" mode (only test users can sign in). To go live, user must click "Publish App" on the consent screen page. Basic sign-in doesn't require Google verification.

### Then

1. Create `shared/auth.js` with `supabase.auth.signInWithOAuth({ provider: 'google' })`
2. Add login/logout UI
3. Add auth guards to admin pages
4. Append to CLAUDE.md: sign-in method, redirect URI pattern
5. Append to CLAUDE.local.md: Client ID
