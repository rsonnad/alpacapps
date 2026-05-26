# Service Access Recipes

Verified copy-paste recipes for external services and machines. Prefer these before rediscovering credentials or hostnames.

## Almaca SSH and Tailscale

Use when checking the legacy ALMACA MacBook Pro 16, including mounted local volumes such as `SW-SDCAM`.

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

### Sender domain

`notifications@alpacaplayhouse.com` is the verified sender. Do not change the
`from:` without verifying a new domain in the Resend dashboard.

### Live consumers

- `~/bin/memory-pressure-guard.sh` — alerts on Python > 8 GB
- `~/bin/rvault-backup-status.sh` — daily backup status to rahulioson@gmail.com
- `~/bin/lights-healthcheck.sh`
- `~/bin/oracle-montreal-provision.sh`

### Do NOT use

- `mail` / `sendmail` / `postfix` on macOS — they accept input but silently
  fail to deliver to Gmail (residential IP block + unauthenticated SMTP).
  Verified broken 2026-05-25: `mailq` reports "mail system is down".
