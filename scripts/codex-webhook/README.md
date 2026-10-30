# Alpuca Codex inbox

An authenticated HTTPS webhook delivers external agent messages to a dedicated,
persistent Codex conversation on Alpuca using `codex app-server` over stdio.
The existing desktop chat is on another machine and is not this inbox.

There is also a **desktop task route**. Grokbot submits a job, and a
human-started chat in the real ChatGPT desktop app on Alpuca claims it through
local MCP tools. That chat retains its normal computer-use tools and approvals.
The service does not automate ChatGPT's own UI or expose its private IPC server.
Desktop execution requires starting the worker below; an accepted task can
remain queued while the worker is offline.

For the opposite direction (Codex contacting Prima Donna), use the
[Grok Bot messaging recipe](../../devcontrol/devdocs/GROKBOT-MESSAGING.md).
The supplied Cursor webhook's HTTP success does not establish bot delivery;
Prima Donna's direct desktop chat is the verified contact path.

- Endpoint: `https://codex-inbox.alpacaplayhouse.com/webhook`
- Health: `https://codex-inbox.alpacaplayhouse.com/healthz`
- Authorization: `Bearer <token>` on POST and result GET requests.
- Credential: Bitwarden item **Alpuca ChatGPT — Codex Webhook Bridge**, field `password`.
  Collection: **ALPU.CA → DevOps-shared**.
  Alpuca's protected runtime copy is `/Users/alpuca/.codex-webhook/token` (600).
- Source: `scripts/codex-webhook/`; deployed to `/Users/alpuca/scripts/codex-webhook/`.
- Local bind: `127.0.0.1:8927`; Cloudflare `alpaca-cam` tunnel supplies TLS ingress.
- LaunchAgent: `com.alpacapps.codex-webhook`; auto-login on Alpuca starts it after reboot.
- State: `/Users/alpuca/.codex-webhook/inbox.sqlite3` (600).

## Protocol

```json
{
  "to": "Codex",
  "from": "Prima Donna",
  "type": "job_done",
  "title": "Statement import finished",
  "body": "Imported 42 rows from Schwab Oct export",
  "links": ["https://finleg.net/"]
}
```

Only `body` is required. `to` accepts `Codex` or `Alpuca`. Unknown fields,
non-HTTP(S) links and URLs containing credentials are rejected. Envelope maximum:
64 KiB; body maximum: 32,000 characters. Limit: 60 new messages/hour, 100 pending.
Send a unique `Idempotency-Key` (1–128 ASCII letters/digits or `._:-`) per message.
Identical retries return the same receipt; changed content with the same key is 409.

POST returns 202 with `id` and `status_url`, after durable insertion. GET the
returned `/v1/messages/<id>` with the same bearer token for `queued`, `processing`,
`completed` or `failed`, plus `response`, `thread_id`, `turn_id`, and token usage.
Receipt is not completion. Poll at a reasonable interval (for example 3 seconds).
No arbitrary callback URL is accepted; the sender retrieves its result here.

## Desktop computer-use tasks

- POST `https://codex-inbox.alpacaplayhouse.com/v1/desktop/tasks`.
- Bearer credential: hidden **Desktop Task Key** field in the same shared
  Bitwarden item. The item password still only authenticates notification routes.
- Required `Idempotency-Key`. Envelope fields match the message protocol above.
- Authenticated GET of the returned `/v1/desktop/tasks/<id>` provides status and
  the actual desktop agent's result. States: `queued`, `processing`,
  `needs_approval`, `completed`, `failed`.
- GET `/v1/desktop/health` with the desktop key lists recent worker polls and task
  counts. A transport test's worker is not evidence the real desktop is ready.
- 25 pending tasks, 60 new tasks/hour; one active task across the whole desktop.
- Notifications never become desktop tasks merely because their body says to
  execute something. The distinct endpoint and credential scope are required.

### Start the actual worker on Alpuca

The installer adds the local `grokbot_desktop_tasks` MCP server to Alpuca's
existing `~/.codex/config.toml` without replacing other settings. It supplies
`await_desktop_task`, `update_desktop_task`, and `complete_desktop_task`.
Its protected database is `~/.codex-webhook/desktop-tasks.sqlite3`.

In a **new local chat in the ChatGPT desktop app on Alpuca**, send the
[prepared startup prompt](DESKTOP-WORKER-START.txt). This user action establishes
the delegation and starts the actual desktop worker. The private app-tools API
did not respond during preparation, and computer use explicitly blocks UI
control of ChatGPT itself; do not simulate typing or sending as a workaround.
The worker should verify its host, MCP tools and native computer-use capabilities
before claiming jobs. If tools are missing, resolve that condition in the app
rather than running the job through the notification model.

The receiver long-polls without repeated model inference while idle. MCP
progress notifications keep the waiting state visible. The call is cancellable
and capped at 3300 seconds; configured tool timeout is 3600 seconds. The model
can wait again when that limit is reached. If the desktop app stops or the
human stops the worker, queued tasks remain queued until it is resumed.

An active claim is durable and never automatically replayed after interruptions.
To recover an interrupted task, explicitly resolve the existing claim before
starting another. Approval blockers retain the desktop reservation. Stop the
desktop agent before an operator marks a stuck task failed; otherwise it could
continue interacting with apps. Avoid secrets in task results; claim tokens are
only for the local MCP tools and are never returned by public receipt endpoints.

The prepared real-UI commissioning task is Calculator, `17 × 23`, nonce
`DESKTOP-UI-20261015-01`. Desktop execution is verified only when the actual
worker uses Calculator and reports the displayed result with evidence. The
separate HTTPS → MCP transport smoke test performs no UI action and must not be
reported as a computer-use success.

```bash
# Run on Alpuca, or retrieve the key through the already-authorized SSH route.
# Avoid shell tracing and never paste the token into a chat or commit it.
CODEX_INBOX_KEY=$(cat /Users/alpuca/.codex-webhook/token)
curl -sS --config - <<EOF
url = "https://codex-inbox.alpacaplayhouse.com/webhook"
header = "Authorization: Bearer $CODEX_INBOX_KEY"
header = "Content-Type: application/json"
header = "Idempotency-Key: statement-import-unique-job-id"
data-binary = "@message.json"
EOF
```

Use curl stdin configuration in automated integrations to avoid exposing bearer
tokens in process arguments. Neither bridge HTTP logs nor model environment
include the webhook credential. Do not attach tokens to query strings.

## Behavior and recovery

Messages enter the model as standalone tool output, below human/developer
instructions. The dedicated session acknowledges messages and answers from its
conversation. It does not execute incoming agent requests. Shell, code mode,
multi-agent, web search and MCP integrations are disabled in an isolated Codex
config; sandbox is read-only with no tool network access. Server-initiated tool
and approval requests are rejected. The listener never exposes App Server RPC.

The bridge uses Alpuca's existing Codex ChatGPT login through a protected auth
symlink, not a new API key. Token usage is stored per message in SQLite; no direct
paid API is introduced. The default model follows Alpuca's model at installation.
This uses an experimental App Server interface, pinned in commissioning to CLI
0.154.0. Re-test the real message path after upgrading Codex.

Queued messages survive restart. Processing messages are marked failed after a
bridge restart rather than silently replayed. Generations time out after 180s;
the App Server is terminated and the job fails. Subsequent messages restart and
resume the saved inbox thread. Failed deliveries require a new idempotency key
for an explicit retry. Transcript and receipts remain local until removed by an
operator; back up the protected state directory if they need durable archival.

## Deployment and checks

```bash
python3 -m unittest discover -s scripts/codex-webhook -p 'test_*.py' -v
scp scripts/codex-webhook/{bridge.py,install.py,task_queue.py,desktop_mcp.py,DESKTOP-WORKER-START.txt} alpuca:/Users/alpuca/scripts/codex-webhook/
ssh alpuca '/opt/homebrew/bin/python3 /Users/alpuca/scripts/codex-webhook/install.py'
```

For a new installation, create the deployment directory first. Existing tokens
and stored thread identity are retained by the installer. Save a newly generated
token to the named Bitwarden item before sharing connection instructions.
Cloudflare ingress must map the hostname to `http://127.0.0.1:8927`, with its
proxied CNAME pointing to `7a786e40-359a-44ff-8d0c-59c76354580c.cfargotunnel.com`.

Check unauthenticated POST is 401, authenticated POST is 202, duplicate receipt
is 200, and GET reaches `completed` with the commissioning nonce in the reply.
Check restart retains the conversation and a second message can refer to the
first. Test rejection of inbound instructions to use tools or disclose files.

Stop: `launchctl bootout gui/501/com.alpacapps.codex-webhook` on Alpuca.
Remove only this hostname's ingress and DNS CNAME to withdraw public availability;
leave other tunnel ingress entries untouched. Keep state for recovery.
