# Secrets Management Guide

> Cross-project guide for managing secrets with Bitwarden as source of truth.
> Uses Bitwarden CLI (`bw`) for secret retrieval.
> Replicable across all projects (alpacapps, finleg, portsie, etc.)

## Architecture: 4-Tier Model

```
Bitwarden Vault (source of truth)
    ↓ bw get / bw list
Local Config Files (CREDENTIALS.md, .mcp.json, memory/)
    ↓ bw get / env injection
Supabase Env Vars (runtime secrets for edge functions)
    ↓ RLS / service role
DB Row-Level Secrets (per-account tokens in config tables)
```

**Rule:** Secrets flow DOWN only. Never copy a runtime secret back up.

## Prerequisites

```bash
# Install Bitwarden CLI
npm install -g @bitwarden/cli

# Login and unlock (session token required for all commands)
bw login
export BW_SESSION=$(bw unlock --raw)

# Sync vault before retrieving secrets
bw sync
```

## Collection Naming Convention

Bitwarden uses **Organizations → Collections** (instead of vaults).

| Pattern | Example | Contents |
|---------|---------|----------|
| `DevOps-{project}` | `DevOps-alpacapps` | API keys, OAuth, bot tokens, server access for one project |
| `DevOps-shared` | `DevOps-shared` | Cross-project infra (Cloudflare, R2, domain registrars) |
| `{Person} Financial` | `Rahul Financial` | Banks, cards, loans, investments |
| `{Person} General` | `Rahul General` | Utilities, insurance, shopping, govt, medical |
| `{Business} Internet` | `Alpaca Internet` | Business web accounts (Airbnb, VRBO, social media) |
| `Family Tax` | `Family Tax` | SSNs, security Q&A, identity info |

## Item Structure

### API Credentials (`Secure Note` or `Login` type with custom fields)
```
Name: {Service} — {Purpose}
Custom Fields:
  token        [hidden]
  api_key      [hidden]
  client_id    [text]
  client_secret [hidden]
  refresh_token [hidden]
  supabase_secret_name [text]
  api_base     [text]
Notes: Free tier info, endpoint URLs
```

### Server Access (`Login` type)
```
Name: {Provider} — {Role}
Username: SSH user (e.g. root)
Password: SSH password
URI: ssh://IP-address
Custom Fields:
  auth_method  [text]    (password / key)
  os           [text]
  specs        [text]
  domain       [text]
  docker_token [hidden]
  compose_path [text]
Notes: Dashboard URL, container info
```

### Login Accounts (`Login` type)
```
Name: {Service} — {Context}
Username: login email/username
Password: login password
URI: service login page
Custom Fields:
  account_number [text]
  policy_number  [text]
  due_date       [text]
  webhook_url    [text]
Notes: Billing, coverage, plan details
```

## Reference Format in Config Files

In `CREDENTIALS.md` and memory files, replace plaintext secrets with:

```markdown
- **API Key:** `bw get password "Service Name — Purpose"`
```

For custom fields:

```markdown
- **Client Secret:** `bw get item "Service Name" | jq -r '.fields[] | select(.name=="client_secret") | .value'`
```

In shell commands:

```bash
# Ensure session is active
export BW_SESSION=$(bw unlock --raw)

# Get a password (simplest form)
curl -H "Authorization: Bearer $(bw get password 'Supabase — alpacapps')"

# Get a custom field value
bw get item "Supabase — alpacapps" | jq -r '.fields[] | select(.name=="management_api_token") | .value'

# Password file generation
bw get password "Hostinger VPS — Root" > ~/.ssh/service.pass && chmod 600 ~/.ssh/service.pass

# sshpass integration
sshpass -p "$(bw get password 'Hostinger VPS — Root')" ssh root@host

# Get username
bw get username "Service Name"

# Get TOTP code
bw get totp "Service Name"
```

## Setting Up a New Project

1. **Create collection:** `DevOps-{project}` in Bitwarden (requires an Organization)
2. **Add items:** Follow the structure patterns above, assign to the collection
3. **Create CREDENTIALS.md:** Use `bw get` references (never plaintext)
4. **Supabase secrets:** `supabase secrets set KEY=$(bw get password 'Item Name')`
5. **MCP config:** Reference via env vars in `.mcp.json`

## Tag Taxonomy

| Tag | Usage |
|-----|-------|
| `core` | Critical infrastructure (Supabase, Cloudflare) |
| `ai` | LLM/AI services (Gemini, OpenRouter) |
| `iot` | Device APIs (Nest, Tesla, Govee) |
| `bot` | Chat bots (Discord, Telegram) |
| `ssh` | Server access |
| `banking` | Financial institutions |
| `insurance` | Insurance policies |
| `utility` | Utilities (electric, water, internet) |
| `austin` / `washington` / `california` | Geographic location |

## Multi-Collaborator Setup

Bitwarden Organizations let multiple people access shared project secrets without passing credentials through Slack, email, or chat.

### Initial Setup (Project Owner)

1. **Create a Bitwarden Organization** at https://vault.bitwarden.com (free for up to 2 users, or Teams plan for more)
2. **Create a Collection** per project: `DevOps-alpacapps`, `DevOps-finleg`, etc.
3. **Invite collaborators** by email — they'll create their own Bitwarden account if needed
4. **Assign Collections** to collaborators with appropriate access:
   - **Admin** — can add/edit/delete items in the collection
   - **User** — can view and use items (read-only)

### Collaborator Onboarding

Each new collaborator runs these steps once:

```bash
# 1. Install Bitwarden CLI
npm install -g @bitwarden/cli

# 2. Login with their own account
bw login

# 3. Unlock and export session
export BW_SESSION=$(bw unlock --raw)

# 4. Sync to pull shared collections
bw sync

# 5. Verify access — should see project items
bw list items --collectionid $(bw list collections | jq -r '.[] | select(.name=="DevOps-alpacapps") | .id')
```

Add this to their shell profile (`.bashrc` / `.zshrc`) for convenience:
```bash
# Bitwarden session helper
bw-unlock() { export BW_SESSION=$(bw unlock --raw); }
```

### Access Control Rules

| Role | Can view secrets | Can add/edit secrets | Can invite others |
|------|:---:|:---:|:---:|
| Owner | Yes | Yes | Yes |
| Admin | Yes | Yes | No |
| User  | Yes | No  | No  |

### What Goes Where

| Location | Contains | Who sees it |
|----------|----------|-------------|
| Bitwarden Organization Collection | Actual secret values | Org members with collection access |
| `docs/CREDENTIALS.md` (gitignored) | `bw get` references only | Anyone who clones the repo (but no actual values) |
| Supabase env vars | Runtime copies of secrets | Edge functions at runtime |
| `.env` files | Never used — use `bw get` instead | N/A |

### Rules for Teams

1. **Never share secrets outside Bitwarden.** No Slack DMs, no email, no shared docs.
2. **One item per service.** Don't split a service's credentials across multiple items.
3. **Use hidden custom fields** for API keys and tokens — they're masked in the UI by default.
4. **Rotate via Bitwarden.** Update the item in Bitwarden first, then update Supabase env vars. Old values are preserved in item history.
5. **Offboard by removing from Organization.** When someone leaves, remove them from the org — all shared access revokes instantly.

## Rotation Checklist

When rotating secrets:
1. Generate new secret in the service dashboard
2. Update the Bitwarden item (`bw edit item` or via the app — old values are in item history)
3. Update Supabase env vars: `supabase secrets set KEY=new_value`
4. Restart affected edge functions: `supabase functions deploy <name>`
5. Verify with a test request
6. No need to update CREDENTIALS.md — `bw get` references use item names, not values
