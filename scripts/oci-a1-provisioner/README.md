# OCI A1 Provisioner

Claims an Oracle Cloud **Always Free Ampere A1** VM (default 4 OCPU / 24 GB / 200 GB,
Ubuntu 24.04 aarch64) by retrying `LaunchInstance` until host capacity frees up.
Runs on **Alpuca** as a launchd agent. It stops by itself once it succeeds, hits an
error that retrying can't fix, or reaches its time limit.

Replaces `scripts/oracle-auto-provision.sh` (an infinite `while true` loop, with
OCIDs hard-coded for Phoenix, started with `nohup` and not managed by anything)
plus the browser-console retry scripts. Those were removed on 2026-10-10.

| Item | Value |
|---|---|
| Code (repo) | `scripts/oci-a1-provisioner/` |
| Code (installed) | `~/scripts/oci-a1-provisioner/provision.py` (copied by `install.sh`) |
| Python env | `~/.venvs/oci-a1-provisioner` (`oci` SDK only) |
| Config | `~/.config/oci-a1-provisioner/config.env` (chmod 600; template: `config.env.example`) |
| OCI credentials | `~/.oci/config` + API signing key (from `oci setup config`) |
| State | `~/.local/state/oci-a1-provisioner/state.json` (the single source of truth) |
| Log | `~/.local/state/oci-a1-provisioner/provisioner.log` (JSON lines, self-trims at 2 MB) |
| launchd job | `~/Library/LaunchAgents/com.alpuca.oci-a1-provisioner.plist`, every 120 s |

## Operating it

```bash
P=~/.venvs/oci-a1-provisioner/bin/python; A=~/scripts/oci-a1-provisioner/provision.py
$P $A status                      # state: active / done / fatal / expired, attempts, last result
$P $A check                       # validate config + OCI access, no launch
$P $A reset                       # resume after fixing a fatal/expired stop (refuses if done)
tail -f ~/.local/state/oci-a1-provisioner/provisioner.log
launchctl print gui/$(id -u)/com.alpuca.oci-a1-provisioner | head -20   # is the job loaded?
./scripts/oci-a1-provisioner/uninstall.sh                               # stop + remove
```

## Architecture

```
launchd (StartInterval 120s)
  └─ provision.py run                 short-lived; flock prevents overlap
       ├─ state.status != active?  → exit (done / fatal / expired are no-ops)
       ├─ MAX_DAYS exceeded?       → expired + notify
       ├─ in backoff window?       → exit
       ├─ instance named DISPLAY_NAME already live?  → done + notify   (idempotency)
       ├─ home region == REGION?   → else fatal (would not be Always Free)
       ├─ resolve image + ADs      (cached 7 days in state.json)
       ├─ LaunchInstance on next AD (round-robin), opc-retry-token per attempt
       └─ classify outcome → update state.json → maybe notify → maybe bootout job
```

### Outcome classification

| Category | Trigger | Action |
|---|---|---|
| `success` | launch returned an instance | Save `done` **before** waiting for RUNNING, then fetch the public IP, notify, unload the job |
| `capacity` | 500 "Out of host capacity" | Expected steady state. Try again next tick, clear any backoff |
| `throttled` | 429 | Exponential backoff, 120 s → 1 h cap |
| `transient` | network errors, 409, other 5xx | Same backoff |
| `unknown` | anything else | Backoff. After 6 in a row → `fatal` |
| `fatal_limit` | `LimitExceeded` / `QuotaExceeded` | Stop + notify. The free A1 quota is already used, or the account isn't eligible |
| `fatal_auth` | 401 | Stop + notify. Fix the API key |
| `fatal_config` | 400 / 404 | Stop + notify. Bad OCID, wrong region, or a subnet in a different region |
| crash | an exception outside the launch call (auth file, list calls) | Counted. After 10 in a row → `fatal` |

### Why it's built this way

- **One attempt per launchd tick, no loop.** The old script was a `nohup` loop: it
  died on reboot, nothing supervised it, and nobody noticed it had been running for
  months. launchd restarts the job after reboots, and since each run is short there's
  no long-lived Python process. That matters on Alpuca, which has a history of runaway
  memory use (see `devcontrol/devdocs/ALPUCA-MACHINE.md`).
- **The retry policy lives in this script, not the SDK.** The SDK's built-in retries
  are disabled (`NoneRetryStrategy`). Otherwise one tick could fire several
  LaunchInstance calls and run into rate limits.
- **Idempotency in three layers.** (1) Before every launch, it checks OCI for a live
  instance named `DISPLAY_NAME`. That covers lost responses, manual console launches,
  and the legacy script. (2) It writes `done` before waiting for RUNNING. (3) It sends
  an `opc-retry-token` per attempt. The default name `alpacapps-workers` matches the
  legacy script, so an instance that script created is detected.
- **Errors that won't fix themselves stop the job.** The old script retried forever
  on `LimitExceeded` and bad OCIDs and only logged them. Now those cases stop the job
  and notify you.
- **Built so it can't be forgotten.** It sends a "still trying" heartbeat every
  `HEARTBEAT_DAYS`, and gives up after `MAX_DAYS` (default 90) with a notification.
- **Checks the home region first.** Always Free A1 exists only in the tenancy's home
  region. The legacy script targeted Phoenix, while the current goal is Montreal. Rather
  than guess which region is home, the script asks OCI and refuses to launch elsewhere.
- **The installed code is a copy, not the repo checkout.** Alpuca's checkouts are
  worktrees that switch branches, so a job running straight from the repo could change
  or vanish without warning. `install.sh` copies the code, which makes upgrades explicit.
- **Python SDK instead of the `oci` CLI.** You get typed `ServiceError(status, code)`
  instead of grepping text output, it's unit-testable with a fake gateway, and each
  call doesn't pay the CLI's ~2 s startup.

## One-time OCI setup

1. **Confirm the home region.** OCI Console → profile menu → Tenancy → *Home Region*.
   Montreal is `ca-montreal-1`, a single-AD region. If home is not Montreal, a Montreal
   A1 VM is billable, not free. Either set `REGION` to the home region, or deliberately
   set `REQUIRE_HOME_REGION=false` on a Pay As You Go account.
2. **API key.** `brew install oci-cli && oci setup config`, then upload
   `~/.oci/oci_api_key_public.pem` under Profile → API keys. Store the key's
   fingerprint and the user/tenancy OCIDs in Bitwarden (see `docs/CREDENTIALS.md`).
3. **Network.** Create a VCN in the region with the *VCN with Internet Connectivity*
   wizard, which creates a public subnet, an internet gateway and a route. Copy the
   **public** subnet OCID into `SUBNET_ID`. `check` fails on a private subnet.
4. **SSH key.** `ssh-keygen -t ed25519 -f ~/.ssh/oracle_key` (or reuse the existing one).
   Back up the private key in Bitwarden. Without it the VM can't be reached.

## Install

```bash
cd ~/path/to/alpacapps
./scripts/oci-a1-provisioner/install.sh   # first run creates the config, then exits
$EDITOR ~/.config/oci-a1-provisioner/config.env
./scripts/oci-a1-provisioner/install.sh   # runs `check`, loads the job only if it passes
```

Upgrade: pull the repo and re-run `install.sh`. It keeps your config and state.

## Retiring the old script

`install.sh` won't install while a legacy provisioner is running, or while
`~/.oracle-provisioned` exists (the old script's success marker). To retire it:

The likely Alpuca setup is the one from `infra/oracle-cloud.html` step 7:
`~/bin/oracle-auto-provision.sh`, started by the LaunchAgent
`com.oracle.arm-provision`, logging to `/tmp/oracle-provision.log`. That plist has a
bug: `WatchPaths` on the success file *starts* the job whenever the file changes, so
a success relaunches the loop instead of stopping it.

```bash
tail -50 /tmp/oracle-provision.log                 # what has it been doing? (/tmp is wiped on reboot)
launchctl bootout gui/$(id -u)/com.oracle.arm-provision 2>/dev/null
rm -f ~/Library/LaunchAgents/com.oracle.arm-provision.plist
pkill -f oracle-auto-provision                     # any nohup copy
ls ~/Library/LaunchAgents | grep -i oracle         # any other label? bootout + rm it too
crontab -l | grep -i oracle                        # remove any cron entry
ls -l ~/.oracle-provisioned /tmp/oracle-instance-details.txt 2>/dev/null   # did it ever succeed?
```

It also ran as the systemd unit `oracle-provision` on the DigitalOcean droplet and on
Hostinger (`docs/plans/do-migration.md`). Make sure it's stopped there too:
`systemctl disable --now oracle-provision`.

## If it never lands

Montreal is a single-AD region, so there's only one capacity pool and no AD rotation
to help. Here's what actually changes the odds, roughly in order of effect:

1. **Upgrade the account to Pay As You Go.** This is widely reported as the most
   effective fix: PAYG tenancies get A1 capacity much more readily, and Always Free
   resources stay $0. The risk is that anything beyond the free limits gets billed.
   Set a budget alert at $1 (Billing → Budgets) at the same time.
2. **Ask for less, then resize.** Smaller shapes (`OCPUS=1`, `MEMORY_GB=6`) land more
   often. You can resize a stopped instance later, though the resize can hit the same
   capacity limit.
3. **Leave it running.** Capacity frees up unpredictably. A 2-minute cadence is
   well within API limits.

Recover from `expired` or `fatal`: fix the cause, then `provision.py check && provision.py reset`.

## After success

- The notification includes the instance OCID, public IP and SSH command. They're also in `status`.
- The launchd job unloads itself. Run `uninstall.sh` to remove the files too.
- Next steps (not automated here): harden SSH, join Tailscale, and record the host in
  `devcontrol/devdocs/INTEGRATIONS.md` and the service-access memory.
- **Idle reclamation:** Oracle may reclaim Always Free instances that stay idle (low
  CPU, network and memory use over 7 days) on free-tier-only accounts. A PAYG account
  avoids this. So does giving the VM real work.

## Tests

```bash
python3 -m venv /tmp/oci-venv && /tmp/oci-venv/bin/pip install -q oci pytest
/tmp/oci-venv/bin/python -m pytest scripts/oci-a1-provisioner/tests -q
```

The tests cover error classification, the state machine (capacity, success,
idempotency, fatal, backoff, expiry, heartbeat, crash counter, reset, corrupt
state) and config parsing. They use a fake gateway, with no network or OCI account.
