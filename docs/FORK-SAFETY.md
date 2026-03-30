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
Audit this repo's GitHub Actions workflows for GitHub TOS violations.

Check every file in .github/workflows/ for:
1. Direct database connections: psql, mysql, mongo, redis-cli, or any raw TCP database protocol
2. SSH connections to external servers
3. Any use of SUPABASE_DB_URL, DATABASE_URL, or similar connection strings with psql/pg_dump
4. Missing fork safety guards (should have `if: github.repository == 'owner/repo'`)

For each violation found:
- Replace direct DB connections (psql) with HTTPS REST API calls (curl to Supabase REST, PostgREST, etc.)
- Add `github.repository == 'OWNER/REPO'` to job-level `if:` conditions
- Remove `apt-get install postgresql-client` steps
- Update env vars from DB connection strings to API URL + API key

Show me the changes before committing.
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
| Secret | Value | Example |
|--------|-------|---------|
| `SUPABASE_URL` | Project URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT | `eyJhbGciOiJIUzI1NiI...` |

You can remove `SUPABASE_DB_URL` after migrating.
