# Secrets Management Guide

> Cross-project guide for managing secrets with Bitwarden as source of truth.
> Replicable across all projects (alpacapps, finleg, portsie, etc.)

## Architecture: 4-Tier Model

```
Bitwarden Vaults (source of truth)
    ↓ bw-read references
Local Config Files (CREDENTIALS.md, .mcp.json, memory/)
    ↓ bw-read / env injection
Supabase Env Vars (runtime secrets for edge functions)
    ↓ RLS / service role
DB Row-Level Secrets (per-account tokens in config tables)
```

**Rule:** Secrets flow DOWN only. Never copy a runtime secret back up.

## Folder Naming Convention

| Pattern | Example | Contents |
|---------|---------|----------|
| `DevOps-{project}` | `DevOps-alpacapps` | API keys, OAuth, bot tokens, server access for one project |
| `DevOps-shared` | `DevOps-shared` | Cross-project infra (Cloudflare, R2, domain registrars) |
| `{Person} Financial` | `Rahul Financial` | Banks, cards, loans, investments |
| `{Person} General` | `Rahul General` | Utilities, insurance, shopping, govt, medical |
| `{Business} Internet` | `Alpaca Internet` | Business web accounts (Airbnb, VRBO, social media) |
| `Family Tax` | `Family Tax` | SSNs, security Q&A, identity info |

## Item Structure

### API Credentials (`Login` or `Secure Note` type)
```
Title: {Service} — {Purpose}
Folder: DevOps-{project}
Fields:
  token       → API key (hidden)
  client_id   → OAuth Client ID
  secret      → OAuth Client Secret (hidden)
  refresh     → OAuth Refresh Token (hidden)
  base_url    → API Base URL
  webhook_url → Webhook URL
Notes: Free tier info, Supabase secret name, etc.
```

### Server Access (`Login` type)
```
Title: {Provider} — {Role}
Folder: DevOps-{project}
Username: SSH user
Password: SSH password
URI: ssh://ip-address
Fields:
  ip          → Server IP
  auth_method → password / key
  ssh_command → Full SSH command
  os          → OS info
  specs       → Server specs
  domain      → Domain name
Notes: Docker paths, container names, etc.
```

### Login Accounts (`Login` type)
```
Title: {Service} — {Context}
Folder: appropriate folder
Username: login username
Password: login password
URI: service login page
Fields:
  account_number → Account/policy number
  due_date       → Billing due date
Notes: Plan details, coverage info, etc.
```

## Reference Format in Config Files

In `CREDENTIALS.md` and memory files, replace plaintext secrets with:

```markdown
- **API Key:** `bw-read "Service Name" "Field Name"`
```

In shell commands:
```bash
# Inline substitution (item title only — returns password field)
curl -H "Authorization: Bearer $(bw-read "Supabase — AlpacApps Project" "Management API Token")"

# sshpass integration
sshpass -p "$(bw-read "Hostinger VPS — OpenClaw Server")" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@host
```

## Setting Up a New Project

1. **Create folder:** `DevOps-{project}` in Bitwarden
2. **Add items:** Follow the structure patterns above
3. **Create CREDENTIALS.md:** Use `bw-read` references (never plaintext)
4. **Supabase secrets:** `supabase secrets set KEY=$(bw-read "Item" "Field")`
5. **MCP config:** Reference via env vars or `bw-read` in `.mcp.json`

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
2. Update Bitwarden item (old value can be noted before overwriting)
3. Update Supabase env vars: `supabase secrets set KEY=new_value`
4. Restart affected edge functions: `supabase functions deploy <name>`
5. Verify with a test request
6. No need to update CREDENTIALS.md — `bw-read` references stay the same
