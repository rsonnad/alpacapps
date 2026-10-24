# Claude Sessions Archive

Auto-saves every Claude Code session transcript to Cloudflare D1 (serverless SQLite). Each time a Claude Code session ends, a hook reads the JSONL transcript from disk and posts it to a Cloudflare Worker that stores it in D1.

## Setup

### 1. Create the D1 database

```bash
npx wrangler d1 create claude-sessions
```

Copy the `database_id` from the output and paste it into `wrangler.jsonc`.

### 2. Run the schema

```bash
npx wrangler d1 execute claude-sessions --file=schema.sql --remote
```

### 3. Set your auth token

Store it as a Worker secret, never in `src/index.js` (this repo is public):

```bash
openssl rand -hex 32 | npx wrangler secret put AUTH_TOKEN
# the public Supabase anon key, used to verify dashboard users' JWTs
grep -o "eyJ[^']*" ../../shared/supabase.js | head -1 | npx wrangler secret put SUPABASE_ANON_KEY
```

The dashboards (DevControl, clauded/sessions.html) don't use this token. They
send the signed-in user's Supabase access token, and the Worker allows `GET`
for `staff`/`admin`/`oracle` app_users.

### 4. Deploy the Worker

```bash
npx wrangler deploy
```

Note the Worker URL from the output (e.g., `https://claude-sessions.YOUR-SUBDOMAIN.workers.dev`).

### 5. Install the hook

```bash
cp hooks/save-session.sh ~/.claude/hooks/save-session.sh
chmod +x ~/.claude/hooks/save-session.sh
```

Edit `~/.claude/hooks/save-session.sh` and set:
- `API_URL` to your Worker URL + `/sessions`
- export `CLAUDE_SESSIONS_AUTH_TOKEN` (the step 3 value) in your shell profile

Then add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "bash ~/.claude/hooks/save-session.sh"
      }
    ]
  }
}
```

Use the `Stop` event, not `SessionEnd` — `SessionEnd` does not fire for worktree/subagent sessions.

### 6. Verify

Start and end a Claude Code session, then check:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://YOUR-WORKER.workers.dev/stats
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Save a session |
| `GET` | `/sessions` | List sessions (supports `?limit=`, `?offset=`, `?search=`, `?from=`, `?to=`, `?project=`) |
| `GET` | `/sessions/:id` | Get full session with transcript |
| `GET` | `/stats` | Aggregate stats (total sessions, tokens, hours) |

All endpoints require `Authorization: Bearer YOUR_TOKEN` header.

## Cost

Cloudflare D1 free tier: 5M reads/day, 100K writes/day, 5GB storage. More than enough for personal use.
