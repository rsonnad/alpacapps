# Fork Safety: GitHub Actions & External Services

## The Problem

GitHub will **ban your account** if your GitHub Actions workflows connect directly to external databases (e.g. via `psql`, `mysql`, `mongo`). This is a Terms of Service violation — GitHub Actions should not be used as a compute platform to interact with 3rd party services via raw database protocols.

**What's allowed:** Standard HTTPS API calls (REST, GraphQL) are fine. The issue is specifically raw TCP database connections.

## If You Forked This Repo

This repo's CI workflow is guarded with `github.repository == 'rsonnad/alpacapps'` so it **will not run on forks**. But if you forked an older version, you may have the unguarded workflow.

**Fix (10 seconds):**
```bash
git rm .github/workflows/bump-version-on-push.yml
git commit -m "remove upstream version-bump workflow"
git push
```

## If Your Account Was Banned

Contact [GitHub Support](https://support.github.com/) and explain:
1. The workflow was inherited from a fork
2. You've deleted the offending workflow
3. Ask for account reinstatement

They typically reinstate accounts quickly once the workflow is removed.

## Claude Prompt: Audit & Fix Any Repo

Paste this into Claude Code to audit and fix any project:

```
Read https://github.com/rsonnad/alpacapps/blob/main/docs/FORK-SAFETY.md for the full problem description and correct architecture patterns.

Audit this repo's GitHub Actions workflows for GitHub TOS violations.

Check every file in .github/workflows/ for:
1. Direct database connections: psql, mysql, mongo, redis-cli, or any raw TCP database protocol
2. SSH connections to external servers
3. Any use of SUPABASE_DB_URL, DATABASE_URL, or similar connection strings with psql/pg_dump
4. Missing fork safety guards (should have `if: github.repository == 'owner/repo'`)

For each violation found:
- Replace direct DB connections (psql) with HTTPS REST API calls (curl to Supabase REST/PostgREST)
- Add `github.repository == 'OWNER/REPO'` to job-level `if:` conditions (detect owner/repo from `git remote -v`)
- Remove `apt-get install postgresql-client` steps
- Update env vars from DB connection strings to API URL + API key
- Remove the sql_esc() helper if present — no more raw SQL string building

After making code changes, also handle the GitHub secrets migration:
- Detect which secrets the updated workflow needs (typically SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
- Check existing secrets: `gh secret list`
- If `gh` CLI is available and authenticated, set the new secrets directly:
  - `echo "https://XXXX.supabase.co" | gh secret set SUPABASE_URL` (get the project URL from the codebase, env files, or ask the user)
  - For the service role key: check if the user has it in their environment, Bitwarden, or Supabase dashboard — then `echo "$KEY" | gh secret set SUPABASE_SERVICE_ROLE_KEY`
- If the old SUPABASE_DB_URL secret exists, tell the user they can remove it after verifying CI works: link them to https://github.com/{owner}/{repo}/settings/secrets/actions
- If `gh` is not available or not authenticated, provide the direct GitHub URL for manual secret setup: https://github.com/{owner}/{repo}/settings/secrets/actions/new

Commit the code changes, push, and verify the CI run passes. If CI fails, diagnose and fix.
```

## Architecture: Right Way vs Wrong Way

### Wrong (gets you banned)
```yaml
# CI workflow
- run: sudo apt-get install -y postgresql-client
- run: psql $SUPABASE_DB_URL -c "INSERT INTO releases ..."
  env:
    SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
```

### Right (standard HTTPS, no issues)
```yaml
# CI workflow — no psql needed
- run: |
    curl -X POST "$SUPABASE_URL/rest/v1/rpc/my_function" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"param": "value"}'
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

### Required secrets for REST approach
| Secret | Value | Where to find it |
|--------|-------|------------------|
| `SUPABASE_URL` | Project URL (e.g. `https://xxxxx.supabase.co`) | Supabase dashboard > Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT (starts with `eyJ...`) | Supabase dashboard > Project Settings > API > service_role key |

Set them at: `https://github.com/{owner}/{repo}/settings/secrets/actions/new`

You can remove `SUPABASE_DB_URL` after verifying CI works with the new secrets.
