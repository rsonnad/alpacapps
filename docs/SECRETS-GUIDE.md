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

## Rotation Checklist

When rotating secrets:
1. Generate new secret in the service dashboard
2. Update the Bitwarden item (`bw edit item` or via the app — old values are in item history)
3. Update Supabase env vars: `supabase secrets set KEY=new_value`
4. Restart affected edge functions: `supabase functions deploy <name>`
5. Verify with a test request
6. No need to update CREDENTIALS.md — `bw get` references use item names, not values
