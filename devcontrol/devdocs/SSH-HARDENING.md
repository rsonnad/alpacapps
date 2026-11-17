# SSH Hardening — Decision & Pointers

Short doc. **The canonical server docs live in the sponic repo** (`sponicgarden/sponic`), not here.
This file records one evaluated-and-rejected idea and tells you where to look.

No secrets in this file.

---

## Where the real docs are (sponic repo)

| What | Path in `sponicgarden/sponic` |
|---|---|
| SSH host registry (aliases for Phoenix, Hostinger, ALPUCA, Otto, UDM, Oracle Daniel) | `infra/ssh/sponic.sshconfig` (install: `infra/bin/install-ssh-config`) |
| Networking runbook: Tailscale tailnet, SSH login watchdog, Mac recovery (`mac-ssh-recover blackbookpro16` / `otto`) | `infra/runbook/networking.md` |
| **Open hardening work: public SSH on Phoenix + Hostinger → Tailscale-only, fail2ban, Hostinger survey** | `docs/devtasks/edge-and-server-hardening-2026-11.md` §4 |
| Key-theft incident: per-machine keys, Hostinger root password locked | `docs/incidents/2026-10-18-blackbookpro16-infostealer.md` |
| Oracle Frankie / Oracle Daniel setup | `docs/sop/setup-oracle-frankie.md`, `docs/sop/setup-oracle-daniel.md` |
| CI runner hosts (Phoenix, Hostinger, ALPUCA, Otto, Frankie, Hetzner `hetzner-ci-01..04`) | `infra/untrusted-runner-sites.json`, `infra/runbook/devtools.md` |
| Hostinger VPS services and backups | `infra/hostinger/README.md` |

## Rollout tool

`sponicgardens/sponic` → `infra/bin/install-ssh-hardening` (keys only, fail2ban, and `--tailscale-only`), with an automatic undo if the confirming login fails. Runbook: sponic `infra/runbook/networking.md` → "SSH hardening". Plan and status: sponic `docs/devtasks/edge-and-server-hardening-2026-11.md` §6.

## Fleet summary (from sponic, 2026-11-17, before rollout)

| Host | Public SSH? | Auth | Notes |
|---|---|---|---|
| Alpuca (Mac mini) | No (NAT). Cloudflare Access tunnel; UDM port 2222 forward only as a temporary last resort | keys | `REMOTE-ACCESS.md` here |
| BlackBook Pro 16 | No (NAT) | keys | Infostealer incident 2026-10-18; its runner was deleted |
| Otto MacBook Pro | No (NAT). Cloudflare `otto-cf` recovery route | keys | |
| Oracle Phoenix `144.24.51.48` (tailnet 100.121.109.91) | **Yes, 22** — ~1,400 failed logins/day | key-only | fail2ban not running |
| Hostinger `93.188.164.224` (tailnet 100.64.206.71) | **Yes, 22** (+80/443 Caddy) | root by key; root password **locked** since 2026-10-18, but `PasswordAuthentication yes` still set | fail2ban running |
| Oracle Frankie (tailnet 100.66.63.38) | No — tailnet only | key-only | PR runners `frankie-pr-01/02` |
| Oracle Daniel | Yes, allowlisted to 2 IPs | key-only | |
| Hetzner | TBD | TBD | CI runners `hetzner-ci-01..04` |
| boat.ai | — | — | **Not found in either repo.** Needs documenting |

---

## Decision: no "high port + port-22 trap that auto-blocks IPs"

Source: X post by @CyberRacheal, 2026-11-16 — *"Move your real SSH service to a random high port, then set up a listener on port 22 that logs every IP attempting to connect and automatically adds them to your firewall blocklist."*

**Rejected.** The target remains the one in the sponic hardening devtask: **no public SSH port; SSH over Tailscale only; keys only.**

| Problem with the trap | Detail |
|---|---|
| Doesn't reduce real risk | Our servers are already key-only. Password-guessing bots can't win; blocking them removes log noise, not risk. A targeted attacker port-scans and finds the high port in seconds. |
| Blocks the wrong things | Scanner IPs rotate (botnets, cloud VMs, residential proxies). The list grows forever. On Hostinger, which also serves web traffic, a blanket block can cut off real users behind shared/CGNAT addresses. |
| Self-lockout | One connection to 22 by habit or by a tool's default bans your own IP — including CI and the Phoenix↔Hostinger SSH login watchdog. |
| Ports > 1024 are unprivileged | If sshd is down, any local user can bind the high port and impersonate it. Only root can bind 22. |
| Another custom service per host | Something to persist, monitor and debug, on top of the existing watchdog. |
| Irrelevant for the Macs | They sit behind NAT; nothing on the internet reaches their port 22. |

**What to use instead, in order:**

1. **No public port** — Tailscale-only (Tailscale needs no inbound port). Break-glass via the provider web console.
2. Where a public port must stay: **cloud-firewall allowlist** of source IPs (as Oracle Daniel already does).
3. **fail2ban or CrowdSec** — the maintained version of "block IPs that knock". Interim step for Phoenix until (1) is done.
4. Port changes only as noise reduction, below 1024, never as the control.

**Risk of Tailscale-only to plan for:** a Tailscale outage or an expired node key locks out every server at once. Disable key expiry on server nodes, and record each host's provider-console path before closing 22.

---

## Client-side rule

Use `StrictHostKeyChecking accept-new`, never `no` (the sponic registry already does this). `accept-new` trusts a host on first contact and refuses if its key later changes, which is the only signal of a man-in-the-middle. If a host is rebuilt, run `ssh-keygen -R <host>` rather than turning the check off. The UDM is the one documented exception (UniFi OS regenerates its host key).
