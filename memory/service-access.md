# Service Access Recipes

Verified copy-paste recipes for external services and machines. Prefer these before rediscovering credentials or hostnames.

## Supabase Management API and Edge Deploy

Use for AlpacApps Supabase project `aphrrfprbixmhissnjfn`.

### Get Management Token

Preferred Bitwarden item:

```bash
MGMT_TOKEN=$(bw get item "fd5b3ae7-d6a7-4e57-8475-b410007ea3a7" 2>/dev/null \
  | python3 -c "import sys,json; item=json.load(sys.stdin); [print(f['value'], end='') for f in item.get('fields', []) if f['name'] == 'Management API Token']")
```

If Bitwarden is locked, unlock first:

```bash
export BW_SESSION=$(~/bin/bw-unlock)
```

### Run SQL

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn/database/query" \
  -H "Authorization: Bearer $MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select now()"}'
```

**Use curl, not Python `urllib`.** `api.supabase.com` sits behind Cloudflare, which
bans the `Python-urllib/*` User-Agent: every request comes back `403` with body
`error code: 1010` regardless of the SQL. This looks exactly like a permissions or
bad-SQL failure and is neither. Either use curl, or set a normal `User-Agent` header.
`requests` is fine. Verified 2026-09-03.

For multi-statement DDL, build the JSON payload with Python and hand the file to curl,
so quoting and `$$`-blocks survive intact:

```bash
python3 -c "import json;print(json.dumps({'query':open('migrations/FILE.sql').read()}))" > /tmp/mig.json
curl -sS -X POST "$URL" -H "Authorization: Bearer $MGMT_TOKEN" \
  -H "Content-Type: application/json" --data-binary @/tmp/mig.json
```

The endpoint returns `201` with `[]` on success for a write-only migration.

### Bitwarden Is Per-Machine

`bw-read` / `~/bin/bw-unlock` unlock headlessly only where the master password is in
that machine's Keychain. Keychains do not sync between BlackbookPro16 and Alpuca, so
storing it on one does nothing for the other:

```bash
security add-generic-password -U -s bw-master -a "$USER" -w
```

As of 2026-09-03 this is present on **Alpuca** and absent on **BlackbookPro16**, so
run Supabase management calls from Alpuca over `ssh alpuca 'bash -s' < script.sh`.

### Deploy Telnyx Webhook

`telnyx-webhook` must allow external Telnyx POSTs through Supabase's gateway.

```bash
SUPABASE_ACCESS_TOKEN="$MGMT_TOKEN" \
  supabase functions deploy telnyx-webhook --no-verify-jwt --project-ref aphrrfprbixmhissnjfn
```

Verified 2026-06-11: redeploying with `--no-verify-jwt` changed unsigned probes from Supabase gateway `401 UNAUTHORIZED_NO_AUTH_HEADER` to handler-level `403 Missing signature`, confirming the function is reachable while Telnyx signature verification remains enforced.

### Pass Telnyx Debug Credentials To Another Codebase

Use the helper to print shell exports without committing secrets:

```bash
cd "/Users/soniawendorff/Coding repos/alpacapps"
eval "$(MGMT_TOKEN="$MGMT_TOKEN" ./scripts/telnyx-debug-env.sh exports)"
cd "/path/to/other/project"
```

The target shell will have:

```text
ALPACAPPS_SUPABASE_PROJECT_REF
ALPACAPPS_SUPABASE_URL
ALPACAPPS_SUPABASE_MGMT_TOKEN
TELNYX_API_KEY
TELNYX_PHONE_NUMBER
TELNYX_MESSAGING_PROFILE_ID
TELNYX_WEBHOOK_URL
```

To verify recent inbound Telnyx webhook deliveries from any project:

```bash
cd "/Users/soniawendorff/Coding repos/alpacapps"
MGMT_TOKEN="$MGMT_TOKEN" ./scripts/telnyx-debug-env.sh deliveries
```

## Almaca SSH and Tailscale

Use when checking the legacy ALMACA MacBook Pro 16, including mounted local volumes such as `SW-SDCAM`.

> **⚠ Stale IP — corrected 2026-08-27.** The `100.115.27.43` address below is the
> `almaca-macbookpro16` Tailscale node, which has been **offline since ~2026-05-24**.
> The live node is **`almaca-2` = `100.77.207.31`** (LAN `192.168.1.74`). Confirm the
> current node before trusting any address here:
>
> ```bash
> tailscale status | grep -i almaca
> ```
>
> **Key auth from Alpuca does not work** — `alpaca@` on both the LAN and Tailscale
> addresses returns `Permission denied (publickey,password,keyboard-interactive)`, and
> Tailscale SSH is not enabled for this node. Almaca currently needs an interactive
> password or a pushed public key; there is no unattended recipe yet.

### Tailscale SSH

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43
```

### LAN SSH Fallback

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@192.168.1.74
```

### Verify `SW-SDCAM` on Almaca

```bash
ssh -o StrictHostKeyChecking=accept-new alpaca@100.115.27.43 \
  'hostname; scutil --get ComputerName 2>/dev/null || true; ls -la /Volumes; test -d /Volumes/SW-SDCAM && df -h /Volumes/SW-SDCAM && mount | grep -i SW-SDCAM'
```

If the Tailscale IP has a stale host key in local `known_hosts`, use a temporary known-hosts file instead of changing the user's SSH config:

```bash
ssh -o UserKnownHostsFile=/tmp/almaca-known-hosts \
  -o StrictHostKeyChecking=accept-new \
  alpaca@100.115.27.43 \
  'hostname; ls -la /Volumes; df -h /Volumes/SW-SDCAM 2>/dev/null || true'
```

Verified 2026-05-11:

```text
ComputerName: Almaca
Tailscale IP: 100.115.27.43
LAN IP: 192.168.1.74
SW-SDCAM: /Volumes/SW-SDCAM
Filesystem: exfat
Observed capacity: 231Gi total, 40Gi used, 191Gi available
```

## Alpuca SSH and Printer Proxy

Use when checking the primary home server, LAN devices, or the FlashForge printer proxy.

### Tailscale SSH

```bash
ssh alpuca
```

`~/.ssh/config` has a `Host alpuca` block pointing at `~/.ssh/alpuca_ed25519`, and the
hostname resolves over Tailscale MagicDNS, so the shorthand is enough. Explicit form:

```bash
ssh -i ~/.ssh/alpuca_ed25519 -o IdentitiesOnly=yes alpuca@100.74.59.97
```

The key is **`alpuca_ed25519`**, not `id_ed25519` — there is no `id_ed25519` on
BlackbookPro16, and using that name fails with `Permission denied (publickey)`.
Verified 2026-09-03 from BlackbookPro16.

To run something there non-interactively, pipe a script over stdin:

```bash
ssh alpuca 'bash -s' < /path/to/local-script.sh
```

### Printer Proxy Health

```bash
ssh -F /dev/null -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new \
  alpuca@100.74.59.97 \
  'curl -sS http://127.0.0.1:8914/health'
```

Verified 2026-05-11:

```text
ComputerName: Alpuca.local
Tailscale IP: 100.74.59.97
LAN IP: 192.168.1.200
Printer proxy: com.printer-proxy on port 8913, health on 8914
```

### Verify Music Assistant, Sonos API, and HAOS

```bash
ssh -F /dev/null -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new \
  alpuca@100.74.59.97 \
  'hostname;
   curl -sS -m 5 -o /dev/null -w "MA:%{http_code}\n" http://127.0.0.1:8095/;
   curl -sS -m 5 -o /dev/null -w "Sonos:%{http_code}\n" http://127.0.0.1:5005/zones;
   curl -sS -m 5 -o /dev/null -w "HAOS:%{http_code}\n" http://192.168.1.39:8123/'
```

Verified 2026-05-15:

```text
Music Assistant: com.music-assistant.server, Python listening on :8095, HTTP 200
Sonos HTTP API: com.sonos.httpapi, node listening on :5005, /zones returned 13 zones
HAOS: QEMU VM running haos_generic-aarch64-17.1.img, HTTP 200 from Alpuca
Home Assistant API: 1,352 states, 37 media_player entities with local token
Music Assistant API: players/all returns Sonos S1 players; playlist library command is music/playlists/library_items
```

Proxy follow-up from 2026-05-15 10:15a:

```text
Alpuca local checks still pass from this machine over Tailscale:
- http://127.0.0.1:8095/ on Alpuca -> 200
- http://127.0.0.1:5005/zones on Alpuca -> 200, 12 zones
- http://192.168.1.39:8123/ from Alpuca -> 200

Production resident page still reported sonos-control getZones timeout.
Public proxy probes:
- https://alpaclaw.cloud/sonos/zones -> 403 without the X-Sonos-Secret header, so the route exists and auth is enforced.
- https://alpaclaw.cloud/ma-api -> 502 for GET and POST players/all probe, so the Music Assistant proxy path is broken or removed.

Hostinger SSH follow-up needed:
- ~/.ssh/alpacapps-hostinger.pass was missing on this machine.
- Bitwarden was locked, so Hostinger password could not be retrieved during the check.
```

## Resend (transactional email from Alpuca)

Used for alerts that need to reach the user while away — memory-pressure-guard,
backup status, lights healthcheck, etc. macOS sendmail/postfix does NOT deliver
to Gmail; always use Resend.

### Recipe (verified 2026-05-25)

```bash
RESEND_KEY=$(cat ~/.config/resend/key | tr -d '\n')
curl -s -X POST 'https://api.resend.com/emails' \
  -H "Authorization: Bearer $RESEND_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n \
    --arg from "notifications@alpacaplayhouse.com" \
    --arg to   "rahulioson@gmail.com" \
    --arg subject "your subject" \
    --arg text    "your body" \
    '{from: $from, to: [$to], subject: $subject, text: $text}')"
```

Success returns `{"id":"<uuid>"}`. Failure returns `{"name":"...","message":"..."}`.

### Key location

`~/.config/resend/key` — 36-byte API key, no newline. (Also at
`/Users/alpuca/.config/rvault-backup/resend-key.txt` for older scripts.)

### Bitwarden fallback

If checking Resend delivery from this Mac, use Bitwarden item id
`4ddf12ff-f86d-4fca-a681-b410007ea3a7`, field `Alpacabe MCP Key`.
There is a duplicate `Resend — Email API` item with no fields, so name-only
lookups can select the empty duplicate and fail.

### Sender domain

`notifications@alpacaplayhouse.com` is the verified sender. Do not change the
`from:` without verifying a new domain in the Resend dashboard.

### Live consumers

- `~/bin/memory-pressure-guard.sh` — alerts on Python > 8 GB
- `~/bin/rvault-backup-status.sh` — daily backup status to rahulioson@gmail.com
- `~/bin/lights-healthcheck.sh`
- `~/bin/oracle-montreal-provision.sh`
- `/Users/alpuca/scripts/garmin-watch-deal-watch.py` — 8:00am Eastern digest + 6:00pm Eastern change-only email of used/refurbished Garmin Forerunner 145/245 deals (Grok search via `grok-delegate ask`); replaced the MacBook Pro deal watcher 2026-08-28
- Oracle Phoenix `/home/ubuntu/.alpuca-health/alpuca_health_check.py` — daily
  Alpuca machine-health email and `alpuca_health_history` update. The Phoenix
  crontab runs at `5 5,6 * * *` UTC with a `TZ=America/Chicago date +\%H`
  guard because `CRON_TZ=America/Chicago` was observed sending at `00:05 UTC`,
  not midnight Central.

### Do NOT use

- `mail` / `sendmail` / `postfix` on macOS — they accept input but silently
  fail to deliver to Gmail (residential IP block + unauthenticated SMTP).
  Verified broken 2026-05-25: `mailq` reports "mail system is down".

## Cloudflare Accounts — THREE of them, do not mix up

Verified 2026-09-02. Confusing them cost an afternoon; check the account ID
before running any wrangler or API command.

| Account | ID | workers.dev | Login |
|---|---|---|---|
| **AlpacApps** (main) | `9cd3a280a54ce2a5b382602f0247b577` | `alpacapps` | wingsiebird@gmail.com |
| **Sponic Garden** | `394b5de665bbfdea54cdd57be9094762` | `sponicgarden` | accounts@sponicgardens.com |
| Rahul / alpu.ca | see section below | — | separate |

**AlpacApps** holds: `claude-sessions` D1 `98d0e680-8abe-4ce3-a941-70cb391adbf8`,
`alpacapps-tesla-telemetry` (testel), download-worker + R2, wiz-watchdog, and the
`alpacaplayhouse.com` zone. An existing token `claude-sessions-d1-migration`
(Account.D1 + Account.Workers Scripts) covers the D1 work — its value can't be
re-read, so **Roll** it in the dashboard to get a fresh one.

**Sponic Garden** is NOT the AlpacApps account. It holds the `sponic-*` workers
and a **forked copy** of the claude-sessions stack: worker `claude-sessions` plus
D1 `37ba42be-b8cf-4e33-bb9e-268aca325978` (132 MB, ~3.7k rows), whose schema has
diverged from this repo (extra `user`/`machine` indexes). The 2026-09-01 D1
rows_read quota alert was against **this** copy, not AlpacApps'. Its caller lives
in the sponic repo, not here.

Do not assume a shared `workers.dev` subdomain implies a shared account — that
inference is what sent us wrong. Verify with `npx wrangler whoami`.

### Recipe

```bash
export CLOUDFLARE_API_TOKEN=<token>   # or read from a chmod-600 file, never echo it
npx wrangler whoami                   # ALWAYS confirm the account ID first
npx wrangler d1 list
```

### Bitwarden helper

Use `~/bin/bw-read "<item name>" "<field name>"` directly. It reads an exported
`BW_SESSION`, or the chmod-600 `~/.bw-session` created by the standard unlock flow.

## alpu.ca Cloudflare Short Links

Use when adding or debugging `https://alpu.ca/...` short links. The zone lives
in Rahul's separate Cloudflare account, not the main Wingsiebird account.

### Credentials

- **Bitwarden item:** `"Cloudflare — Rah Hul Account (alpu.ca)"`
- **Token field:** `"Cloudflare-D1"`
- **Zone ID:** `5258bd9d21828c4a66c318a5d085fa0c`

Use `~/bin/bw-read` directly in noninteractive shells.

### List Current Page Rules

```bash
TOKEN=$(~/bin/bw-read "Cloudflare — Rah Hul Account (alpu.ca)" "Cloudflare-D1")
ZONE=5258bd9d21828c4a66c318a5d085fa0c
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE/pagerules?status=active&per_page=100" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  | jq -r '.result[] | [.priority, .id, .targets[0].constraint.value, .actions[0].value.url] | @tsv'
```

### Add a Short Link

```bash
TOKEN=$(~/bin/bw-read "Cloudflare — Rah Hul Account (alpu.ca)" "Cloudflare-D1")
ZONE=5258bd9d21828c4a66c318a5d085fa0c
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/pagerules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "targets": [{"target":"url","constraint":{"operator":"matches","value":"alpu.ca/example*"}}],
    "actions": [{"id":"forwarding_url","value":{"url":"https://alpacaplayhouse.com/target.html","status_code":301}}],
    "priority": 3,
    "status": "active"
  }'
```

### Priority Gotcha

For these Page Rules, the higher priority number wins. Keep specific short links
above the catchall rule and the catchall (`alpu.ca/*`) at the lowest priority.
Verified 2026-06-10 while adding `alpu.ca/mfknotes`: the catchall at priority 3
swallowed `kidsaudio` and `mfknotes`; changing order to specific links at higher
numbers and catchall at priority 1 fixed both.

## UDM Pro (UniFi Dream Machine Pro) — 192.168.1.1

### Run UDM commands FROM ALPUCA, not from a laptop

`sshpass` exists on **Alpuca only**. On the MacBook Pro M5, use `~/bin/bw-read` directly;
the helper reads the saved Bitwarden session in a non-interactive shell. Any recipe that
also requires `sshpass` still runs on Alpuca only.

Two credential paths on Alpuca, both fine:

```bash
# (a) Bitwarden helper — interactive shells
sshpass -p "$(bw-read 'UniFi Dream Machine Pro — Network Gateway' 'SSH Password')" \
  ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1 'COMMAND'

# (b) Env file — what cron uses (UDM_SSH_PASS, UDM_WEB_PASS, SUPA_TOKEN)
source ~/.unifi-snapshot.env
sshpass -p "$UDM_SSH_PASS" ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1 'COMMAND'
```

`-o PubkeyAuthentication=no` is mandatory — without it pubkey fails silently and the password
is never offered.

### Driving the UDM from a laptop (two hops)

```bash
ssh -F /dev/null -i ~/.ssh/alpuca_ed25519 -o IdentitiesOnly=yes -o IdentityAgent=none \
  -o PreferredAuthentications=publickey -o StrictHostKeyChecking=accept-new \
  alpuca@192.168.1.200 'source ~/.unifi-snapshot.env; sshpass -p "$UDM_SSH_PASS" ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1 "COMMAND"'
```

Note the laptop key is `~/.ssh/alpuca_ed25519` (there is no `~/.ssh/id_ed25519`). Tailscale
(`100.74.59.97`) was unreachable on 2026-08-30 while LAN `192.168.1.200` worked — try LAN first
at home.

### Controller REST — works DIRECTLY from the laptop (no Alpuca hop)

Verified 2026-09-02 from the MacBook Pro M5: the REST API needs no `sshpass`, so the
"run it from Alpuca" rule above applies to SSH only. Read-only calls need no CSRF token.

`bw-read` CANNOT fetch `login.password` on this item (the item's own notes say so) — pull it
with the `bw list items` JSON pattern instead:

```python
items = json.loads(subprocess.run(["/Users/otter/bin/agent-access","bw","list","items"],
                                  capture_output=True, text=True).stdout)
it = next(i for i in items if i["name"].startswith("UniFi Dream Machine Pro"))
user, pw = it["login"]["username"], it["login"]["password"]
```

Then POST `/api/auth/login` and GET `/proxy/network/api/s/default/stat/device` with a
`CookieJar`. Requires an open access window (`bwaccesser` / `agent-access status`).

AP WiFi generation lives in `radio_table[]`: `is_11ax: true` = WiFi 6, `is_11ac` only =
WiFi 5. Device-level `support_wifi6e` flags 6 GHz. Do NOT infer generation from the model
code — `U7PG2` is the AC Pro (WiFi 5), the "7" is a board rev, not WiFi 7.

### Controller REST (no SSH needed, from Alpuca)

CSRF lives in the **`x-csrf-token` response header** on login, not in the cookie jar. Nested
quoting through two SSH hops breaks easily — pull raw JSON back and parse it locally rather than
embedding Python in the remote command.

```bash
source ~/.unifi-snapshot.env
curl -sk -c /tmp/uc.txt -D /tmp/uh.txt -X POST 'https://192.168.1.1/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"alpacaauto\",\"password\":\"$UDM_WEB_PASS\",\"remember\":true}" >/dev/null
CSRF=$(grep -i '^x-csrf-token:' /tmp/uh.txt | tr -d '\r' | awk '{print $2}')
curl -sk -b /tmp/uc.txt 'https://192.168.1.1/proxy/network/api/s/default/rest/user'
```

Endpoints: `rest/networkconf`, `rest/wlanconf`, `rest/user` (DHCP reservations),
`stat/device` (APs/switches), `stat/sta` (live clients incl. retry counters).
`alpacaauto` is Super Admin — PUT works with the CSRF header.

## rclone Google Drive remotes on Alpuca (Drive -> rvault20/RVbackup transfers)

Alpuca already has rclone configured with three remotes in
`/Users/alpuca/.config/rclone/rclone.conf`: `[gdrive]`, `[gphotos]`, and
`[tesloop]`.

> **⚠ 2026-09-02 correction.** `[gdrive]` is **rahulioson@gmail.com**, NOT
> alpacaplayhouse@gmail.com — confirmed wrong by the user after a mistaken
> inference from folder names alone ("Alpaca Playhouse Large Files" etc. are
> just business folders stored in Rahul's personal 5TB Drive, not proof of
> account ownership). `[gphotos]` is presumably the same account's Photos.
> The disabled LaunchAgent `com.alpuca.rclone-rahulioson.plist.disabled` also
> points at `[gdrive]` — consistent with it being rahulioson's remote, output
> to `googledrivesync-rahulioson`.
>
> **Do NOT infer a Drive/Photos remote's owning account from folder names.**
> Verify via the OAuth consent screen itself (the account chosen during
> `rclone authorize`/`rclone config` login) before trusting a remote's identity
> for anything account-specific.
>
> **alpacaplayhouse@gmail.com has no rclone remote configured yet** as of
> 2026-09-02. It's a genuine 15 GB **free-tier** account, 15.13/15 GB used,
> "ran out of storage" per the Drive UI storage banner — this is the account
> that actually needs the Drive-to-rvault20 migration. Needs fresh headless
> `rclone authorize "drive"` OAuth (see the SSH-tunnel recipe used 2026-09-02:
> `ssh -L 53682:localhost:53682 ... 'rclone authorize "drive" --auth-no-open-browser'`,
> open the printed URL in a browser logged into alpacaplayhouse@gmail.com).
>
> A stray mistaken pull of ~12 GiB of rahulioson's Drive landed in
> `/Volumes/rvault20/googledrivesync-gdrive/` before this was caught — redundant
> with the pre-existing `googledrivesync-rahulioson/`, needs cleanup decision.

**Gotcha (hit 2026-09-02):** the config file was owned `root:staff` mode 600,
unreadable by `alpuca` — every plain `rclone` command failed with
`CRITICAL: Failed to load config file ... permission denied`. Fix:
```bash
sudo -n chown alpuca:staff /Users/alpuca/.config/rclone/rclone.conf
sudo -n chmod 600 /Users/alpuca/.config/rclone/rclone.conf
```
(passwordless sudo is enabled for `alpuca`, see `ALPUCA-MACHINE.md`). If it's
locked again, `sudo -n rclone ...` works as a read-only workaround but breaks
any cron/nohup job running as `alpuca` (no root there).

**Established convention:** prior Drive pulls landed in
`/Volumes/rvault20/googledrivesync-<accountname>/` (see `googledrivesync-tesloop`,
`googledrivesync-rahulioson`, both already also mirrored onto `/Volumes/RVbackup/`).
Follow the same naming for new pulls. The referenced `sync-gdrive-to-rvault.sh`
in the `tesloop` weekly cron job (`7 3 * * 0 ... tesloop`) is **missing on disk**
— that cron entry has been silently failing (check
`/Users/alpuca/logs/gdrive-sync.log` for the "No such file or directory" spam)
and needs a real fix/investigation separately.

`[gdrive]` has no `export_formats` set, so native Google Docs/Sheets/Slides are
skipped by a bare `rclone copy` — pass `--drive-export-formats docx,xlsx,pptx,svg`
on the command line per-run rather than writing it into the shared remote config
(other jobs use the same `[gdrive]` stanza).

Reach Alpuca for these transfers via:
```bash
ssh -F /dev/null -i ~/.ssh/alpuca_ed25519 -o IdentitiesOnly=yes -o IdentityAgent=none \
  -o PreferredAuthentications=publickey -o StrictHostKeyChecking=accept-new paca@100.74.59.97
```
(`paca` is a login alias for the `alpuca` user, uid 501 — confirmed via `whoami`/`id`.)

The `rvault20 -> RVbackup` full-volume mirror script (`rvault-rsync.sh`) is stale
(references the old `/Volumes/RVaultBack1` name, pre-rename to `RVbackup`) and
isn't in the current crontab — don't invoke it as-is. For adding one new folder,
scope a plain `rsync -avh --stats` to just that subfolder instead of mirroring
the whole 9TB+ volume.

## Rahul M2 Airtop SSH (MacBook Air M2)

Tailscale node name `rahul-m4-airtop` is STALE — the machine was renamed to
"Rahul M2 Airtop" and the rename propagated to Bonjour/AirPlay but not Tailscale.
Hardware is genuinely a MacBook Air M2 (Mac14,15, 15-inch, 8 GB).

Username is `rahulio` — not `rahul`, `alpaca`, or `otter`.

```bash
ssh -i ~/.ssh/alpuca_ed25519 -o IdentitiesOnly=yes rahulio@100.114.248.79
```

Verified 2026-08-18. Remote Login was already enabled; the only missing piece was
`~/.ssh/authorized_keys` on the Air. Six username guesses failed before `rahulio`
— ask for `whoami` rather than guessing.

Local LAN: 192.168.1.21 (this MacBook Pro M5 is 192.168.1.19, same /24).
