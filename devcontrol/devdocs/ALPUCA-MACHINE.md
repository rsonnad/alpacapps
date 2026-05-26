# Alpuca Machine Configuration & Operational Notes

> **Canonical location.** Other repos (finleg, etc.) link here. If you update,
> update once — here.
>
> Cross-refs:
> - finleg pointer: `~/Documents/codingprojects/finleg/docs/ALPUCA-MACHINE.md`

Living reference for the primary Mac (`Alpuca.local`, user `alpuca`). Anything
learned about long-running processes, gotchas, or non-obvious config lives
here so future sessions don't have to rediscover it.

## Hardware & OS

- **Hostname:** `Alpuca` (tailnet MagicDNS: `alpuca@alpuca`)
- **Physical RAM:** 24 GB
- **Swap file:** typically 9 GB allocated (grows under pressure)
- **Page size:** 16 KB (Apple Silicon)
- **macOS:** macOS 26.5 / Darwin 25.5.0 (arm64)
- **Shell:** zsh
- **Passwordless sudo:** **enabled** for user `alpuca`. Test with `sudo -n true`.
- **TCC Full Disk Access granted to:** `/usr/bin/eslogger` (for ES client use)
- **FileVault:** off.
- **Auto-login:** `alpuca` enabled, so user LaunchAgents come back after a
  power-loss boot without a physical login.
- **Power recovery:** restart after power failure and restart after freeze are
  both on; system/display/disk sleep are off; Wake-on-LAN and TCP keepalive
  are on.

## Update Posture

Checked 2026-05-25 20:44 CDT.

- **macOS:** automatic check/download is on; automatic macOS install is off.
  `softwareupdate -l` reported no pending macOS updates.
- **App Store:** automatic app updates are on.
- **Tailscale:** version 1.98.2, backend running, health empty, key expiry
  2026-09-19. The app checks for updates, but verify manually before travel.
  CLI wrapper installed at `/opt/homebrew/bin/tailscale` for runbooks.
- **Homebrew:** 84 outdated packages/casks at last audit. Do not run a blind
  `brew upgrade` right before departure; schedule a maintenance window,
  upgrade, reboot, and verify remote access afterward.

## Python Installations

- **Primary:** `/opt/homebrew/Cellar/python@3.14/3.14.4/...` (Homebrew, 3.14)
- **Secondary:** `/opt/homebrew/Cellar/python@3.12/...` (3.12, used by music-assistant)
- **Xcode:** `/Applications/Xcode.app/.../Python3.framework/.../3.9/...` (3.9, used by `alpuca-monitor-http.py`, `light-api/server.py`)
- **Notable venvs:**
  - `~/gme-env` — GME/Qwen embedding model env (used by `moondream-indexer`)
  - `~/.hermes/hermes-agent/venv` — Hermes gateway
  - `~/music-assistant-venv-312` — Music Assistant

## Standing Background Services

These run continuously and are expected. Don't kill them blindly during cleanup.

| Service | Path | Port / Purpose |
|---|---|---|
| Hermes gateway (×2) | `~/.hermes/hermes-agent/` | tailnet agent |
| Music Assistant | `~/music-assistant-venv-312/bin/mass` | music server |
| Reclip | `~/reclip/app.py` | clipboard sync |
| Blink poller | `~/blink-poller/blink_snapshot.py` | camera snapshots |
| Light API | `~/light-api/server.py` | smart-light control |
| Alpuca monitor | `~/bin/alpuca-monitor-http.py` | machine telemetry |
| Ollama | `homebrew.mxcl.ollama` | local LLM server, port 11434 |
| `server_custom.py` | unknown | check before killing |
| Home Assistant VM | `qemu-system-aarch64`, `~/homeassistant-vm/` | ~1.8 GB RSS, normal |
| Claude.app + helpers | various | desktop app |
| Claude Code CLIs | several concurrent sessions | per worktree |

If you see something not on this list eating memory, investigate before killing.

## Known Memory Hazard: `moondream-indexer`

**Location:** `~/moondream-indexer/`
**Trigger script:** `run_gme.sh`
**Python entry:** `embed_gme.py`
**Watchdog:** `watch_gme.sh`
**Embedding model:** GME / Qwen-class (≈7–14 GB resident on its own)
**HF cache:** `/Volumes/RVAULT20/hf-cache` (external)

### What it does wrong

Under sustained batch runs the Python process grows past 26 GB on a 24 GB
machine, dragging the OS into swap thrash (Swap Used: 8+ GB, memory pressure
red). The wrapper's OOM detection only fires on explicit OOM strings; macOS
unified memory swaps silently instead of OOM-killing, so the wrapper never
catches it. The job keeps running and the machine becomes unusable.

### Three restart vectors — kill ALL of them

Killing only Python brings it back. Killing only the wrapper brings it back.
You must take down the chain in order:

```bash
pkill -9 -f watch_gme.sh     # watchdog: re-launches wrapper every 2 min if missing
pkill -9 -f run_gme.sh       # wrapper: internal retry loop (MAX_RETRIES=100)
pkill -9 -f embed_gme.py     # python worker
sleep 2
pgrep -fl 'watch_gme.sh|run_gme.sh|embed_gme.py'   # must be empty
```

Note: detached wrappers reparent to PID 1 (launchd) via `nohup &`, but are
NOT actually managed by launchd. `launchctl list` will not show them.

### The fix — applied as of 2026-05-25

Defense in depth, because `ulimit -v` alone was insufficient:

1. **`run_gme.sh` wrapper:** `ulimit -v 12582912` (12 GB) before the python line.
   Helps when the indexer is launched via the wrapper, but macOS often ignores
   `RLIMIT_AS` for `mmap` allocations (which is how PyTorch/MPS allocate
   everything), so this alone is not enough.

2. **Inside `embed_gme.py`:** background watchdog thread polls own RSS every
   30s via `resource.getrusage()` and `SIGKILL`s self if > 12 GB. Plus
   `gc.collect()` + `torch.mps.empty_cache()` between every batch.

3. **`gme-sniffer.sh`:** 2-second polling agent auto-kills any
   `watch_gme.sh|run_gme.sh|embed_gme.py` chain it detects, even if launched
   correctly. Indexer should NEVER run unsupervised on this machine.

4. **`memory-pressure-guard.sh`:** 15-minute launchd agent that catches ANY
   Python > 8 GB RSS (not just the indexer), kills it, sends a macOS
   notification and emails `rahulioson@gmail.com` via Resend. Under global
   memory pressure it can also kill the biggest high-risk local AI/Python
   process over 2 GB, including an `ollama runner`.

Together these mean: even if a buggy script launches `embed_gme.py` directly
(bypassing the wrapper), the sniffer kills it within 2 seconds. Even if some
other Python process runs away, the memory-pressure-guard catches it within
15 minutes. Even if both watchdogs are unloaded, the in-script watchdog
SIGKILLs at 12 GB. Even if the script is deleted, machine pressure thresholds
trigger the guard.

Optional defense-in-depth inside `embed_gme.py`:

```python
import gc, torch, resource
resource.setrlimit(resource.RLIMIT_AS, (12 * 1024**3, 12 * 1024**3))

# after each batch:
gc.collect()
if torch.backends.mps.is_available():
    torch.mps.empty_cache()
```

### Tripwire: persistent monitoring

**Polling sniffer (primary, survives reboot):**

| Component | Path |
|---|---|
| Script | `~/bin/gme-sniffer.sh` |
| LaunchAgent | `~/Library/LaunchAgents/com.alpuca.gme-sniffer.plist` |
| Log | `~/gme-sniffer.log` |

Polls `pgrep` every 2s, logs PID/PPID/grandparent on detection. Loaded
automatically at login via launchd. Inspect with `tail -f ~/gme-sniffer.log`.

**eslogger exec tap (secondary, manual restart after reboot):**

| Component | Path |
|---|---|
| Script | `~/bin/gme-eslogger.sh` |
| Log | `/var/log/gme-eslogger.log` |

> ⚠️ **Cannot run as a LaunchDaemon.** macOS Endpoint Security requires the
> "responsible process" to have TCC Full Disk Access. Terminal.app has FDA,
> but `launchd` does not — so a system daemon spawn always fails with
> `ES_NEW_CLIENT_RESULT_ERR_NOT_PERMITTED`. Granting FDA to `/bin/bash` or
> `/sbin/launchd` would work but is too broad. So this tool is **manually
> launched from Terminal.app only**, and does not survive reboot.

After every reboot, run from **Terminal.app** (not from a Claude Code shell,
which also lacks FDA):

```bash
sudo nohup /Users/alpuca/bin/gme-eslogger.sh >/dev/null 2>&1 &
```

Verify: `pgrep -fl 'eslogger exec'`.

**Disable the sniffer temporarily:**

```bash
launchctl unload ~/Library/LaunchAgents/com.alpuca.gme-sniffer.plist
```

**Permanently remove:** `launchctl unload`, then `rm` the plist and scripts.

## Memory Pressure Guard (failsafe for unattended runs)

Catches ANY oversized Python process — not just the indexer. Added
2026-05-25 so the machine doesn't lock up while the user is abroad and can't
physically reboot.

| Component | Path |
|---|---|
| Script | `~/bin/memory-pressure-guard.sh` |
| LaunchAgent | `~/Library/LaunchAgents/com.alpuca.memory-pressure-guard.plist` |
| Trigger log | `~/memory-emergency.log` |
| Heartbeat log | `~/memory-emergency.log.heartbeat` |
| Cadence | every 15 minutes |

Kill conditions (any of):
- Any indexer chain process detected → kill chain (always wrong)
- Any Python process > 8 GB RSS → kill it
- Swap > 8 GB or (compressor > 10 GB AND free < 80 MB) → kill biggest
  high-risk Python/local-AI process > 2 GB

On kill: writes to `~/memory-emergency.log`, sends macOS notification with
sound, emails `rahulioson@gmail.com` through Resend using the recipe in
`memory/service-access.md`.

Inspect: `tail -f ~/memory-emergency.log` or `tail ~/memory-emergency.log.heartbeat`.

## SSH-From-Abroad Recovery Playbook

If the memory guard fires while the user is traveling, they receive an email at
`rahulioson@gmail.com` from `notifications@alpacaplayhouse.com`. To check on
the machine remotely:

### 1. Reach the machine
```bash
# Via Tailscale MagicDNS
ssh alpuca@alpuca

# Or via LAN IP if on the same network
ssh alpuca@192.168.1.200
```
If SSH itself hangs, the machine is unreachable — see "If the machine is
locked up" below.

### 2. Quick triage (paste as one block)
```bash
echo "=== indexer ===" && pgrep -fl 'watch_gme|run_gme|embed_gme' || echo "down"
echo "=== guard heartbeat (last 3) ===" && tail -3 ~/memory-emergency.log.heartbeat
echo "=== kills (last 5) ===" && tail -5 ~/memory-emergency.log
echo "=== current top 5 RSS ===" && ps -axo rss,pid,comm | sort -rn | head -6
echo "=== memory ===" && sysctl vm.swapusage && vm_stat | awk '/page size/{ps=$8} /Pages free/{printf "free %.0f MB\n", $3*ps/1024/1024} /occupied by compressor/{printf "comp %.0f MB\n", $5*ps/1024/1024}'
```

### 3. Manual nuke
```bash
# Indexer chain
pkill -9 -f watch_gme.sh; pkill -9 -f run_gme.sh; pkill -9 -f embed_gme.py

# Any oversized python (manual override of the guard threshold)
ps -axo pid,rss,command | awk '/[Pp]ython/ && $2 > 4000000 {print $1}' | xargs -I{} kill -9 {}

# Ollama model runners if local AI is wedged
ollama ps
ollama stop <model>
pkill -f 'ollama runner'

# Photo search if it somehow reappeared
sudo launchctl bootout system /Library/LaunchDaemons/com.alpacapps.photo-search-api.plist 2>/dev/null
pkill -f 'photo-search-api|uvicorn.*8210|uvicorn.*8767'
```

### 4. Confirm watchers are still alive
```bash
launchctl list | grep -E 'gme-sniffer|memory-watch|memory-pressure-guard'
# expect: all three listed with PIDs
```
If any is missing, reload its plist:
```bash
launchctl load ~/Library/LaunchAgents/com.alpuca.<name>.plist
```

### 5. If the machine is locked up (SSH won't connect)
Options, in order of preference:
1. **Tailscale SSH from phone** — Tailscale app on iOS/Android can SSH to
   `alpuca` via MagicDNS. If the machine has any responsiveness, this works.
2. **UDM Pro web UI / SSH** — `ssh admin@<udm-ip>` then power-cycle Alpuca's
   wall outlet if it's on a smart plug.
3. **Ask someone physically present** to hold the power button (last resort).

### 6. After recovery, before re-enabling anything
1. Check the email/log to understand WHAT fired and WHY.
2. If `embed_gme.py` reappeared, find the launch vector via
   `tail ~/gme-sniffer.log` — should show the PPID chain.
3. If a new scheduled task is at fault, disable it in `~/.claude/scheduled-tasks/`.
4. Only after confirming the source is gone, optionally re-enable any parked
   services using the exact launchd notes below.

## Auto-Relaunch Vectors — Past Incidents

| Date | Vector | Resolution |
|---|---|---|
| 2026-05-18 | Another Claude Code session ran `ssh ... nohup bash run_gme.sh &` | Session is one-off, no fix needed |
| 2026-05-24 to 05-25 | Scheduled task `oracle-upload-monitor` fired twice daily, Step 5 bypassed the wrapper and ran `python3 embed_gme.py` directly. Caused multiple 26 GB runaway incidents. | Task disabled + Step 5 prompt rewritten to never restart. See `~/.claude/scheduled-tasks/oracle-upload-monitor/SKILL.md`. |

## Ollama (local AI) Launchd Contract

State after 2026-05-25 audit:

| Item | State |
|---|---|
| Canonical service | `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist` |
| Duplicate disabled | `~/Library/LaunchAgents/com.ollama.serve.plist.disabled` |
| Binding | `OLLAMA_HOST=0.0.0.0`, listens on `*:11434` |
| Memory controls | `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_KEEP_ALIVE=2m`, `OLLAMA_KV_CACHE_TYPE=q8_0` |
| Cron conflict fixed | `@reboot ... ollama serve ...` commented out on 2026-05-25 |
| Watchdog behavior | `~/scripts/hermes-watchdog.sh` now kicks `homebrew.mxcl.ollama` via launchd instead of starting a second manual server |

Why this matters: before the audit, two LaunchAgents plus an orphaned manual
`ollama serve` process were fighting for port 11434, both agents logged
`bind: address already in use`, and two runners could stay loaded at once.
That is unsafe on a 24 GB headless machine.

Verify:
```bash
launchctl list | grep -i ollama
lsof -nP -iTCP:11434 -sTCP:LISTEN
ollama ps
curl -sS http://127.0.0.1:11434/api/tags | jq '.models | length'
curl -sS http://192.168.1.200:11434/api/tags | jq '.models | length'
```

If the duplicate comes back:
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ollama.serve.plist 2>/dev/null
launchctl disable gui/$(id -u)/com.ollama.serve
mv ~/Library/LaunchAgents/com.ollama.serve.plist ~/Library/LaunchAgents/com.ollama.serve.plist.disabled
launchctl kickstart -k gui/$(id -u)/homebrew.mxcl.ollama
```

If a runner keeps respawning after `ollama stop`, look for an active benchmark
or agent loop. On 2026-05-25, this exact process repeatedly reloaded
`qwen2.5-coder:14b` and left a 10 GB runner stuck in `Stopping...`:

```bash
ps -axo pid,ppid,rss,etime,command | grep -E 'benchmark-researcher|hermes-bench|ollama runner'
tail -80 /tmp/hermes-bench-ollama.log
pkill -f 'benchmark-researcher.py'
pkill -f 'sleep 600 && tail -15 /tmp/hermes-bench-ollama.log'
ollama stop qwen2.5-coder:14b
pkill -f 'ollama runner'
```

The benchmark cron line
`/Users/alpuca/sponic/infra/hermes/scripts/benchmark-researcher-daily.sh` is
also commented out as of 2026-05-25 because it deliberately loads local models
for multi-day comparisons.

## Photo Search / Indexing — DISABLED (2026-05-25)

User decision: photo indexing/search is OFF and stays off until explicitly
re-enabled. Disabling launchctl jobs alone was not enough because a system
LaunchDaemon can restart the backend on reboot.

### What's parked / disabled

| Plist | Was | Why disabled |
|---|---|---|
| `/Library/LaunchDaemons/com.alpacapps.photo-search-api.plist.disabled` | uvicorn on :8210, `0.0.0.0` | Photo search backend, previously 2-5 GB |
| `~/Library/LaunchAgents/disabled/com.alpacapps.cloudflared-finleg-photos.plist` | cloudflared tunnel | Parked outside active LaunchAgents |
| `~/Library/LaunchAgents/com.alpuca.photosearch.plist` | older uvicorn on :8767 | No longer present/loaded after audit |

Also fixed: `~/scripts/cloudflared-keepalive.sh` used to restart
`finleg-photos` every 2 minutes from cron. That stanza is now removed/commented
so killing the tunnel actually sticks.

If port 8210 or 8767 shows a listener again, treat it as unexpected:
```bash
lsof -nP -iTCP:8210 -iTCP:8767 -sTCP:LISTEN
ps -axo pid,rss,command | grep -E 'photo-search|photosearch|uvicorn.*8210|uvicorn.*8767'
```

### What's scheduled-task-disabled

| Task | State | Action taken |
|---|---|---|
| `oracle-upload-monitor` | disabled + Step 5 prompt rewritten | Was the auto-relaunch culprit |
| `launch-gme-embeddings` | disabled (one-time, fired Apr 22) | Original launch task |
| `photo-upload-status` | disabled | Was for rsync uploads (not memory risk) |

### To re-enable (do NOT do this lightly)

Each layer has to be intentionally restored:
```bash
# 1. Move the backend plist back to the active load path
sudo mv /Library/LaunchDaemons/com.alpacapps.photo-search-api.plist.disabled \
  /Library/LaunchDaemons/com.alpacapps.photo-search-api.plist

# 2. Load it
sudo launchctl bootstrap system /Library/LaunchDaemons/com.alpacapps.photo-search-api.plist

# 3. If you want the embedding job to resume, ALSO audit run_gme.sh first
#    so the in-process memory watchdog is in place. See "The fix" section above.

# 4. Re-enable scheduled tasks ONLY if you've fixed the underlying restart bug
#    in oracle-upload-monitor's Step 5 (it currently won't restart, which is
#    the desired safe state).
```

### What survived (kept by design)

- `~/Library/LaunchAgents/com.alpuca.gme-sniffer.plist` — the auto-killer.
  Kept enabled as a tripwire: if anything ever launches the indexer chain
  again (human, script, or scheduled task), it dies within 2 seconds.
- `~/bin/memory-pressure-guard.sh` (15-min launchd) — failsafe for ANY
  oversized Python.
- `~/moondream-indexer/` and `~/photo-search-api/` source dirs — untouched.
  Re-enabling is plist + launchctl, not reinstall.

### ⚠️ launchctl unload does NOT kill the running process

`launchctl bootout`/`unload` prevents future restarts. It does NOT always
terminate an already-running child process. On 2026-05-25 the
photo-search-api uvicorn kept running after the user agent was unloaded.

**Correct takedown for any launchd service:**
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/<name>.plist
pkill -f <distinctive-process-name>     # actually kill the existing process
```

For photo-search specifically:
```bash
sudo launchctl bootout system /Library/LaunchDaemons/com.alpacapps.photo-search-api.plist 2>/dev/null
pkill -f 'photo-search-api|photosearch|uvicorn.*8210|uvicorn.*8767'
```

## TTRAN Channel (cross-machine file transfer)

- **Wrapper:** `infra/bin/ttran` (in any AlpacApps-style project)
- **Storage:** `alpuca@alpuca:/Volumes/PortoSams2T/ttran` (this machine, ext drive)
- Don't put secrets / durable records there. See per-project `docs/TTRAN.md`.

## Notable Volumes

- `/Volumes/PortoSams2T/` — external SSD, hosts TTRAN channel
- `/Volumes/RVAULT20/` — external, hosts HF model cache for indexer

If either is unmounted, indexer and TTRAN both break — check `df -h` first
when those tools error mysteriously.

## Related Docs

- `devcontrol/devdocs/REMOTE-ACCESS.md` — SSH/Tailscale into this machine from outside
- `devcontrol/devdocs/SECRETS-GUIDE.md` — Bitwarden CLI, secrets management
- `devcontrol/devdocs/LOCAL-AI-SETUP.md` — local AI models / Ollama on this box

## Quick-Reference Memory Diagnostic

```bash
# Top RSS hogs
ps -axo pid,rss,user,command -r | head -15

# Memory pressure (pages × 16384 = bytes)
memory_pressure | head -20

# Swap state
sysctl vm.swapusage
```

A 26 GB Python process on this machine is the indexer until proven otherwise.
