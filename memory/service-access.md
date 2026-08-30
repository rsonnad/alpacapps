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
ssh -F /dev/null -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o StrictHostKeyChecking=accept-new \
  alpuca@100.74.59.97
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

## alpu.ca Cloudflare Short Links

Use when adding or debugging `https://alpu.ca/...` short links. The zone lives
in Rahul's separate Cloudflare account, not the main Wingsiebird account.

### Credentials

- **Bitwarden item:** `"Cloudflare — Rah Hul Account (alpu.ca)"`
- **Token field:** `"Cloudflare-D1"`
- **Zone ID:** `5258bd9d21828c4a66c318a5d085fa0c`

If `bw-read` is not defined in a noninteractive shell, source the shared profile
first:

```bash
source ~/Documents/CodingProjects/portsie/scripts/bw-profile.sh >/dev/null
```

### List Current Page Rules

```bash
source ~/Documents/CodingProjects/portsie/scripts/bw-profile.sh >/dev/null
TOKEN=$(bw-read "Cloudflare — Rah Hul Account (alpu.ca)" "Cloudflare-D1")
ZONE=5258bd9d21828c4a66c318a5d085fa0c
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE/pagerules?status=active&per_page=100" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  | jq -r '.result[] | [.priority, .id, .targets[0].constraint.value, .actions[0].value.url] | @tsv'
```

### Add a Short Link

```bash
source ~/Documents/CodingProjects/portsie/scripts/bw-profile.sh >/dev/null
TOKEN=$(bw-read "Cloudflare — Rah Hul Account (alpu.ca)" "Cloudflare-D1")
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

`sshpass` and the `bw-read` helper exist on **Alpuca only**. On the MacBook Pro M5 neither is
installed and `bw-unlock` cannot prompt in a non-interactive shell, so any recipe in
SONOSAUTOMATION.md that starts with `sshpass -p "$(bw-read ...)"` **fails on the laptop and
works on Alpuca**. Verified 2026-08-30 (`zsh: command not found: bw-read`).

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
