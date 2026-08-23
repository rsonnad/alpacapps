# DO Droplet → Hostinger VPS Migration Plan

> **Status:** Planned | **Savings:** $24/month ($288/year)
> **DO Droplet:** 159.89.157.120 (2 CPU, 4GB RAM, 120GB SSD, Ubuntu 24.04)
> **Hostinger VPS:** 93.188.164.224 (4 CPU, 15GB RAM, 200GB SSD, Ubuntu 24.04)

---

## DO Droplet Inventory

### Workers (all Node.js, stateless, poll Supabase)

| Service | Path | Description |
|---|---|---|
| `bug-fixer` | `/opt/bug-fixer/bug_scout.js` | Bug Scout — scans for issues |
| `tesla-poller` | `/opt/tesla-poller/worker.js` | Tesla Fleet API → DB |
| `image-gen` | `/opt/image-gen/worker.js` | AI image generation |
| `lg-poller` | `/opt/lg-poller/worker.js` | LG appliance data |
| `feature-builder` | `/opt/feature-builder/feature_builder.js` | PAI Feature Builder |
| `pai-discord` | `/opt/pai-discord/bot.js` | PAI Discord bot |
| `spirit-whisper` | `/opt/spirit-whisper/worker.js` | Spirit Whisper worker |
| `portsie-cli` | `/opt/portsie-cli/server.js` | Claude Code HTTP endpoint (ports 8910/8911) |
| `project-inquiry` | `/opt/project-inquiry/worker.js` | Project Inquiry worker |
| `oracle-provision` | `/opt/bug-fixer/repo/scripts/oracle-auto-provision.sh` | Oracle ARM auto-provisioner |

All run as `bugfixer` user via systemd.

### Web/Proxy (Caddy + nginx)

| Domain | Backend | Purpose |
|---|---|---|
| `cam.alpacaplayhouse.com` | Caddy → ptz-proxy (:8901) + Tailscale → Alpaca Mac | Camera streams, PTZ, sensors, Protect events, WiZ lights, network clients |
| `mistiq.alpacaplayhouse.com` | Caddy → static files | Mistiq app (may be excluded per CLAUDE.md) |
| `app.alpacaplayhouse.com` | Caddy → static files | AlpacApps preview |
| nginx :8055 | → Alpaca Mac Sonos HTTP API | Sonos proxy (legacy — Hostinger already has `/sonos/*`) |

### Cron Jobs

| Schedule | Script | Purpose |
|---|---|---|
| `0 4 * * *` | `/usr/local/bin/do-backup.sh` | Daily backup |
| `* * * * *` | `/opt/sonos-scheduler/scheduler.sh` | Sonos music scheduling |

### Other Infrastructure
- **Tailscale** node `openclawzd` (100.77.128.27) — direct peer to Alpaca Mac
- **Docker** — stopped `clawdbot-sandbox` container (stale, can delete)
- **Claude CLI** — running (already on Hostinger too)

---

## Phase 1: Prepare Hostinger (no downtime)

```bash
# 1. Create bugfixer user
useradd -m -s /bin/bash bugfixer

# 2. Install Node.js (check DO version first: ssh root@159.89.157.120 "node --version")
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install sshpass (for oracle-provision script)
apt-get install -y sshpass

# 4. Copy OCI CLI config (from local machine)
scp -r ~/.oci root@93.188.164.224:/root/.oci
scp ~/.ssh/oracle_key* root@93.188.164.224:/root/.ssh/
```

## Phase 2: Move Workers (zero downtime — can overlap)

All workers are stateless poll loops. Safe to run on both servers briefly.

```bash
# 1. rsync all worker directories from DO → Hostinger (from local machine)
for dir in bug-fixer tesla-poller image-gen lg-poller feature-builder pai-discord spirit-whisper portsie-cli project-inquiry sonos-scheduler; do
  ssh -i ~/.ssh/do_bugfixer root@159.89.157.120 "tar czf - /opt/$dir" | \
    ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@93.188.164.224 "tar xzf - -C /" # retrieve password from Bitwarden
done

# 2. Copy systemd unit files
for svc in bug-fixer tesla-poller image-gen lg-poller feature-builder pai-discord spirit-whisper portsie-cli project-inquiry oracle-provision; do
  scp -i ~/.ssh/do_bugfixer root@159.89.157.120:/etc/systemd/system/$svc.service /tmp/
done
# Then scp to Hostinger: /etc/systemd/system/

# 3. Copy environment files
ssh -i ~/.ssh/do_bugfixer root@159.89.157.120 "find /opt -name '.env' -o -name 'config.json' | head -20"

# 4. Install npm dependencies on Hostinger
for dir in /opt/bug-fixer /opt/tesla-poller /opt/image-gen /opt/lg-poller /opt/feature-builder /opt/pai-discord /opt/spirit-whisper /opt/portsie-cli /opt/project-inquiry; do
  cd $dir && npm install
done

# 5. Set ownership
chown -R bugfixer:bugfixer /opt/*/

# 6. Enable and start on Hostinger
systemctl daemon-reload
for svc in bug-fixer tesla-poller image-gen lg-poller feature-builder pai-discord spirit-whisper portsie-cli project-inquiry oracle-provision; do
  systemctl enable $svc && systemctl start $svc && systemctl status $svc --no-pager
done

# 7. Verify each worker
for svc in bug-fixer tesla-poller image-gen lg-poller feature-builder pai-discord spirit-whisper portsie-cli project-inquiry; do
  echo "=== $svc ===" && journalctl -u $svc -n 5 --no-pager
done

# 8. Stop on DO once all healthy on Hostinger
ssh -i ~/.ssh/do_bugfixer root@159.89.157.120 "for svc in bug-fixer tesla-poller image-gen lg-poller feature-builder pai-discord spirit-whisper portsie-cli project-inquiry oracle-provision; do systemctl stop \$svc; systemctl disable \$svc; done"
```

## Phase 3: Move Camera/Proxy Infrastructure

This is the highest-risk phase — `cam.alpacaplayhouse.com` serves live camera streams.

### 3a. Copy ptz-proxy
```bash
# rsync the ptz-proxy Node app (port 8901) to Hostinger
# Install deps, create systemd unit, start it
# Test: curl http://localhost:8901/sensors
```

### 3b. Verify Tailscale connectivity
```bash
# On Hostinger, test latency to Alpaca Mac
tailscale ping alpacamac
```

**If DERP-only (>100ms):** Consider moving camera proxy to Alpaca Mac itself (direct LAN to cameras). Or accept DERP latency for admin-only use.

### 3c. Update Hostinger Caddyfile

Add the full `cam.alpacaplayhouse.com` block from DO's Caddyfile with all routes:
- `/ptz/*`, `/camera/*`, `/clients*`, `/sensors`, `/sensor/*`
- `/protect/*`, `/api/*`, `/talkback/*`, `/wiz/*`

**Important fix:** The HLS streaming proxy (`/api/*`) points to `100.102.122.65:1984` (stale `alpacaopenmac-2`). Update to `100.68.30.98` (`alpacamac`).

### 3d. DNS cutover
1. Lower TTL on `cam.alpacaplayhouse.com` to 300s (5 min)
2. Wait for old TTL to expire
3. Update A record: `159.89.157.120` → `93.188.164.224`
4. Test camera page on live site
5. Monitor for 24 hours

## Phase 4: Move Static Sites

### Mistiq
CLAUDE.md says "Exclude `/mistiq/` from all AlpacApps work." Decide: migrate or let it die.

### app.alpacaplayhouse.com
1. rsync static files to Hostinger
2. Add Caddy block to Hostinger Caddyfile
3. Update DNS A record → Hostinger IP

## Phase 5: Move Remaining Infrastructure

### Sonos scheduler cron
```bash
# Copy scheduler to Hostinger
# Add crontab: * * * * * /opt/sonos-scheduler/scheduler.sh
```

### Sonos proxy (nginx)
Already on Hostinger Caddy (`/sonos/*` route). Verify nothing still uses DO's nginx :8055, then skip.

### Backup cron
Review `do-backup.sh` — likely DO-specific. May not need on Hostinger.

## Phase 6: Decommission DO Droplet

### Pre-flight checklist
- [ ] All 10 workers running healthy on Hostinger for 48+ hours
- [ ] `cam.alpacaplayhouse.com` serving from Hostinger, cameras working
- [ ] `app.alpacaplayhouse.com` serving from Hostinger (if migrated)
- [ ] Sonos scheduler running on Hostinger
- [ ] No DNS records still pointing to 159.89.157.120
- [ ] Tailscale fallback route to Alpaca Mac updated in `service-access.md`

### Decommission steps
1. Stop all services on DO
2. Remove DO Tailscale node: `tailscale logout`, delete `openclawzd` from admin panel
3. Take final snapshot ($0.05/GB ≈ $1.15 for 23GB used)
4. **Destroy the droplet** via DO console
5. Update docs: `memory/service-access.md`, `docs/CREDENTIALS.md`

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tailscale DERP relay latency | Camera streams lag/timeout | Test latency; if bad, run camera proxy on Alpaca Mac directly |
| PAI Discord bot token conflict | Bot goes offline | Stop on DO before starting on Hostinger (single instance) |
| Missing env vars / secrets | Workers crash on start | Diff `.env` files before cutover; check `journalctl` immediately |
| DNS propagation delay | Brief camera outage | Lower TTL to 5min 24h before; keep DO running during propagation |
| Mistiq site ownership | Site goes down | Clarify before decommission |
