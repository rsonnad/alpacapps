#!/usr/bin/env python3
"""
sonos-health.py — periodic Sonos + network health telemetry with alerting.

Complements unifi-snapshot.py. That script records CONFIG nightly so drift is
bisectable. This one records SYMPTOMS every few minutes and shouts when the
system enters a known-bad state.

It exists because of the 2026-08-30 incident: the UDM rebooted, the kernel came
up with multicast_snooping=1 / multicast_querier=0 (the documented-fatal pair),
and nothing noticed for 10 hours. The nightly config snapshot could never have
caught it — the kernel bridge lives a layer below the controller API.

What it samples:
  * Kernel tripwire   — br0 multicast_snooping / multicast_querier, and whether
                        udm-boot.service is enabled (the thing that actually runs
                        /data/on_boot.d/*, missing since April 2026)
  * Controller rules  — the Sonos-critical settings from SONOSAUTOMATION.md
  * Per-speaker RF    — tx retry %, RSSI, channel, associated AP
  * Speaker-side RF   — SonosNet PHY error rate (counter resets on read, so each
                        sample is errors-per-interval)
  * Playback context  — zone count and how many zones are grouped, so dropouts
                        can be correlated with group size

Usage:
    ./scripts/sonos-health-cron.sh              # normal (cron) run
    python3 scripts/sonos-health.py --dry-run   # print, don't write or alert
    python3 scripts/sonos-health.py --no-alert  # write to Supabase, stay quiet

Env (supplied by the wrapper): UDM_SSH_PASS, UDM_WEB_PASS, SUPA_TOKEN
"""

import argparse
import datetime
import getpass
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PROJ_REF = "aphrrfprbixmhissnjfn"
SQL_URL = f"https://api.supabase.com/v1/projects/{PROJ_REF}/database/query"
UDM_HOST = "192.168.1.1"
# Local on Alpuca; override to test from another machine:
#   SONOS_API=http://192.168.1.200:5005 python3 scripts/sonos-health.py --dry-run
SONOS_API = os.environ.get("SONOS_API", "http://127.0.0.1:5005")

# SonosNet's home channel. Rule #8: no UniFi 2.4 GHz AP may sit on it.
SONOSNET_CHANNEL = 11

# Retry-rate thresholds. The docs note >5% is audible, but 5% is currently the
# steady state for most speakers, so alerting there would be pure noise. These
# fire on genuinely actionable degradation instead.
RETRY_CRIT_PCT = 25.0
RETRY_WARN_PCT = 15.0
RETRY_WARN_COUNT = 3

# SonosNet PHY errors, counted per sample interval (the counter resets on read,
# so at */15 cron this is errors-per-15-min). For scale: the 2026-05-06 incident
# peaked at 12.8M on the mesh root and was called "severe co-channel interference".
PHY_ERR_CRIT = 5_000_000

REALERT_HOURS = 6

STATE_FILE = os.path.expanduser("~/.sonos-health-state.json")
RESEND_KEY_FILE = os.path.expanduser("~/.config/resend/key")
ALERT_FROM = "notifications@alpacaplayhouse.com"
ALERT_TO = "rahulioson@gmail.com"

SONOS_OUIS = ("00:0e:58", "b8:e9:37", "5c:aa:fd", "94:9f:3e", "48:a6:b8", "34:7e:5c", "54:2a:1b")


# ---------------------------------------------------------------- collection

REMOTE_SCRIPT = """
WP="__WEBPASS__"
echo "===KERNEL==="
echo "snooping=$(cat /sys/devices/virtual/net/br0/bridge/multicast_snooping 2>/dev/null)"
echo "querier=$(cat /sys/devices/virtual/net/br0/bridge/multicast_querier 2>/dev/null)"
echo "udm_boot=$(systemctl is-enabled udm-boot.service 2>&1 | head -1)"
echo "uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
echo "firmware=$(ubnt-device-info firmware 2>/dev/null || cat /etc/unifi-os/version 2>/dev/null)"
curl -sk -c /tmp/sh.txt -X POST 'https://localhost/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d "{\\"username\\":\\"alpacaauto\\",\\"password\\":\\"$WP\\",\\"remember\\":true}" > /dev/null
echo "===NETWORKS==="
curl -sk -b /tmp/sh.txt 'https://localhost/proxy/network/api/s/default/rest/networkconf'
echo ""
echo "===WLANS==="
curl -sk -b /tmp/sh.txt 'https://localhost/proxy/network/api/s/default/rest/wlanconf'
echo ""
echo "===DEVICES==="
curl -sk -b /tmp/sh.txt 'https://localhost/proxy/network/api/s/default/stat/device'
echo ""
echo "===STA==="
curl -sk -b /tmp/sh.txt 'https://localhost/proxy/network/api/s/default/stat/sta'
rm -f /tmp/sh.txt
"""


def pull_udm(ssh_pass: str, web_pass: str) -> dict:
    remote = REMOTE_SCRIPT.replace("__WEBPASS__", web_pass)
    cmd = [
        "sshpass", "-p", ssh_pass,
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "PubkeyAuthentication=no",
        "-o", "ConnectTimeout=10", f"root@{UDM_HOST}", "bash -s",
    ]
    proc = subprocess.run(cmd, input=remote, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        sys.exit(f"SSH/UDM failed: {proc.stderr[:400]}")

    out = proc.stdout
    kernel_raw, rest = out.split("===NETWORKS===", 1)
    networks_raw, rest = rest.split("===WLANS===", 1)
    wlans_raw, rest = rest.split("===DEVICES===", 1)
    devices_raw, sta_raw = rest.split("===STA===", 1)

    kernel = {}
    for line in kernel_raw.splitlines():
        if "=" in line and not line.startswith("==="):
            k, _, v = line.partition("=")
            kernel[k.strip()] = v.strip()

    def data(raw):
        return json.loads(raw.strip()).get("data", [])

    return {
        "kernel": kernel,
        "networks": data(networks_raw),
        "wlans": data(wlans_raw),
        "devices": data(devices_raw),
        "sta": data(sta_raw),
    }


# Applied by --remediate when the kernel tripwire fails. The two echo lines are
# the documented working baseline (SONOSAUTOMATION.md §Kernel vs Controller);
# the unit file is the runner /data/on_boot.d/ has needed since April 2026 and
# that UniFi OS firmware upgrades wipe from /etc/systemd/system.
REMEDIATE_SCRIPT = """
echo 0 > /sys/devices/virtual/net/br0/bridge/multicast_snooping
echo 0 > /sys/devices/virtual/net/br0/bridge/multicast_querier
if ! systemctl is-enabled udm-boot.service >/dev/null 2>&1; then
  cat > /etc/systemd/system/udm-boot.service <<'EOF'
[Unit]
Description=Run /data/on_boot.d scripts at boot
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "for f in /data/on_boot.d/*.sh; do [ -x $f ] && $f; done"
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable udm-boot.service >/dev/null 2>&1
  echo "reinstalled_unit=yes"
fi
echo "snooping=$(cat /sys/devices/virtual/net/br0/bridge/multicast_snooping)"
echo "querier=$(cat /sys/devices/virtual/net/br0/bridge/multicast_querier)"
echo "udm_boot=$(systemctl is-enabled udm-boot.service 2>&1 | head -1)"
"""


def remediate(ssh_pass: str) -> dict:
    """Force the kernel baseline and (re)install udm-boot.service. Returns post-state."""
    cmd = [
        "sshpass", "-p", ssh_pass,
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "PubkeyAuthentication=no",
        "-o", "ConnectTimeout=10", f"root@{UDM_HOST}", "bash -s",
    ]
    proc = subprocess.run(cmd, input=REMEDIATE_SCRIPT, capture_output=True, text=True, timeout=60)
    post = {"ok": proc.returncode == 0, "reinstalled_unit": False}
    for line in proc.stdout.splitlines():
        k, _, v = line.partition("=")
        if k == "reinstalled_unit":
            post["reinstalled_unit"] = (v == "yes")
        elif k in ("snooping", "querier", "udm_boot"):
            post[k] = v.strip()
    if proc.returncode != 0:
        post["error"] = proc.stderr[:300]
    return post


def http_json(url: str, timeout: int = 8):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def uuid_to_mac(uuid: str):
    """RINCON_000E5821E8E001400 -> 00:0e:58:21:e8:e0"""
    m = re.match(r"RINCON_([0-9A-Fa-f]{12})", uuid or "")
    if not m:
        return None
    h = m.group(1).lower()
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def pull_zones():
    """Returns (speakers_by_mac, zone_count, grouped_zone_count, largest_group)."""
    try:
        zones = http_json(f"{SONOS_API}/zones")
    except Exception as e:
        return {}, None, None, None, f"zones unavailable: {e}"

    by_mac, grouped, largest = {}, 0, 0
    for z in zones:
        members = z.get("members", []) or []
        largest = max(largest, len(members))
        if len(members) > 1:
            grouped += 1
        for m in members:
            mac = uuid_to_mac(m.get("uuid", ""))
            if mac:
                by_mac[mac] = {
                    "room": m.get("roomName"),
                    "group_size": len(members),
                    "playback": (z.get("coordinator", {}).get("state", {}) or {}).get("playbackState"),
                }
    return by_mac, len(zones), grouped, largest, None


PHY_RE = re.compile(r"PHY errors since last reading/reset:\s*(\d+)")
NOISE_RE = re.compile(r"Noise Floor:\s*(-?\d+)")
HOMECH_RE = re.compile(r"Home channel is (\d+)")


def probe_speaker(ip: str):
    """SonosNet radio stats. Reading resets the PHY counter, so this is a rate."""
    try:
        req = urllib.request.Request(f"http://{ip}:1400/status/proc/ath_rincon/status")
        with urllib.request.urlopen(req, timeout=4) as r:
            body = r.read().decode(errors="replace")
    except Exception:
        return {}
    phy = PHY_RE.search(body)
    noise = NOISE_RE.search(body)
    home = HOMECH_RE.search(body)
    return {
        "phy_errors": int(phy.group(1)) if phy else None,
        "noise_floor": int(noise.group(1)) if noise else None,
        "sonosnet_home_mhz": int(home.group(1)) if home else None,
    }


# ------------------------------------------------------------------ analysis

def evaluate(state: dict, zones_by_mac: dict, probe: bool, phy_window_ok: bool = False) -> dict:
    kernel = state["kernel"]
    violations = []

    # --- Kernel tripwire. This is the one that would have caught 2026-08-30.
    snooping = kernel.get("snooping")
    querier = kernel.get("querier")
    if snooping != "0":
        violations.append(
            f"CRITICAL: kernel br0 multicast_snooping={snooping} (must be 0). "
            "With querier off this kills multicast to Sonos after ~260s."
        )
    if querier != "0":
        violations.append(f"kernel br0 multicast_querier={querier} (must be 0 while snooping is 0)")

    # systemctl prints a multi-word error when the unit is absent; normalise so the
    # stored value and the alert text stay readable.
    udm_boot_raw = kernel.get("udm_boot", "")
    if "No such file" in udm_boot_raw or "could not be found" in udm_boot_raw:
        udm_boot = "missing"
    elif udm_boot_raw in ("enabled", "disabled", "static", "masked"):
        udm_boot = udm_boot_raw
    else:
        udm_boot = (udm_boot_raw or "unknown")[:60]

    if udm_boot != "enabled":
        violations.append(
            f"CRITICAL: udm-boot.service is '{udm_boot}' (must be 'enabled'). "
            "Without it /data/on_boot.d/ never runs and the kernel fix does not survive reboot."
        )

    # --- Controller rules
    default_lan = next((n for n in state["networks"] if n.get("name") == "Default"), {})
    if default_lan.get("igmp_snooping") is not False:
        violations.append("controller igmp_snooping on Default LAN must be false")
    if default_lan.get("mdns_enabled") is not True:
        violations.append("mDNS on Default LAN must be true")

    brc = next((w for w in state["wlans"] if w.get("name") == "Black Rock City"), {})
    if brc:
        checks = [
            ("mcastenhance_enabled", False, "multicast enhancement must be off"),
            ("bss_transition", False, "BSS transition must be off"),
            ("fast_roaming_enabled", False, "fast roaming (802.11r) must be off"),
            ("l2_isolation", False, "L2 isolation must be off"),
            ("uapsd_enabled", False, "UAPSD must be off"),
            ("wpa3_support", False, "WPA3 must be off"),
        ]
        for key, want, msg in checks:
            if brc.get(key) is not want:
                violations.append(f"Black Rock City: {msg} (is {brc.get(key)})")
        if brc.get("wpa_mode") != "wpa2":
            violations.append(f"Black Rock City: wpa_mode must be wpa2 (is {brc.get('wpa_mode')})")
        if brc.get("pmf_mode") != "disabled":
            violations.append(f"Black Rock City: pmf_mode must be disabled (is {brc.get('pmf_mode')})")
        minrate = brc.get("minrate_ng_data_rate_kbps")
        if minrate and float(minrate) > 6000:
            violations.append(f"Black Rock City: 2.4GHz min rate {minrate} kbps exceeds 6000")

    # --- AP channels (rule #8: nothing may share SonosNet's channel)
    ap_names, ap_channels = {}, {}
    for d in state["devices"]:
        if d.get("type") != "uap":
            continue
        ap_names[d.get("mac")] = d.get("name")
        for r in d.get("radio_table_stats", []) or []:
            if r.get("radio") == "ng":
                ch = r.get("channel")
                ap_channels[d.get("name")] = ch
                if str(ch) == str(SONOSNET_CHANNEL):
                    violations.append(
                        f"AP '{d.get('name')}' is on 2.4GHz ch{ch}, colliding with SonosNet"
                    )

    # --- Per-speaker RF
    speakers = []
    for s in state["sta"]:
        mac = (s.get("mac") or "").lower()
        if not mac.startswith(SONOS_OUIS):
            continue
        zinfo = zones_by_mac.get(mac, {})
        rec = {
            "mac": mac,
            "ip": s.get("ip"),
            "room": zinfo.get("room"),
            "group_size": zinfo.get("group_size"),
            "wired": bool(s.get("is_wired")),
        }
        if s.get("is_wired"):
            rec["sw_port"] = s.get("sw_port")
        else:
            tx_r, tx_p = s.get("tx_retries", 0) or 0, s.get("tx_packets", 0) or 0
            total = tx_r + tx_p
            rec.update({
                "channel": s.get("channel"),
                "rssi": s.get("signal"),
                "retry_pct": round(100.0 * tx_r / total, 1) if total else None,
                "tx_rate_mbps": (s.get("tx_rate") or 0) // 1000,
                "ap": ap_names.get(s.get("ap_mac"), s.get("ap_mac")),
            })
        speakers.append(rec)

    # --- Speaker-side SonosNet probe
    if probe:
        targets = [(sp["ip"], sp) for sp in speakers if sp.get("ip") and not sp["wired"]]
        if targets:
            with ThreadPoolExecutor(max_workers=8) as pool:
                for (ip, sp), res in zip(targets, pool.map(lambda t: probe_speaker(t[0]), targets)):
                    sp.update(res)

    wireless = [s for s in speakers if not s["wired"] and s.get("retry_pct") is not None]
    over_warn = [s for s in wireless if s["retry_pct"] >= RETRY_WARN_PCT]
    worst = max(wireless, key=lambda s: s["retry_pct"], default=None)

    if worst and worst["retry_pct"] >= RETRY_CRIT_PCT:
        violations.append(
            f"{worst.get('room') or worst['ip']} retry rate {worst['retry_pct']}% "
            f"(>= {RETRY_CRIT_PCT}%) on ch{worst.get('channel')} at {worst.get('rssi')} dBm"
        )
    if len(over_warn) >= RETRY_WARN_COUNT:
        names = ", ".join(f"{s.get('room') or s['ip']} {s['retry_pct']}%" for s in over_warn)
        violations.append(f"{len(over_warn)} speakers above {RETRY_WARN_PCT}% retry: {names}")

    # SonosNet interference. The counter resets on read, so the value is errors
    # accumulated since the LAST read — not an absolute. A first run, or a run
    # after the cron has been down, covers hours or days and would trip any
    # threshold. Only judge it when the preceding sample was one cron tick ago.
    phy_bad = [s for s in speakers if (s.get("phy_errors") or 0) >= PHY_ERR_CRIT]
    if phy_bad and phy_window_ok:
        names = ", ".join(f"{s.get('room') or s['ip']} {s['phy_errors']:,}" for s in phy_bad)
        violations.append(
            f"SonosNet PHY errors above {PHY_ERR_CRIT:,} this interval: {names} "
            "(ch11 interference — check for non-UniFi sources)"
        )

    uptime = kernel.get("uptime")
    return {
        "kernel_multicast_snooping": int(snooping) if (snooping or "").isdigit() else None,
        "kernel_multicast_querier": int(querier) if (querier or "").isdigit() else None,
        "udm_boot_service": udm_boot,
        "udm_firmware": kernel.get("firmware") or None,
        "udm_uptime_seconds": int(float(uptime)) if uptime else None,
        "violations": violations,
        "speakers": speakers,
        "ap_channels": ap_channels,
        "speakers_over_retry_threshold": len(over_warn),
        "max_retry_pct": worst["retry_pct"] if worst else None,
        "worst_speaker": (worst.get("room") or worst.get("ip")) if worst else None,
    }


# ------------------------------------------------------------------ delivery

def supa_sql(token: str, sql: str):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(SQL_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "alpacapps-sonos-health/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase error {e.code}: {e.read()[:600].decode(errors='replace')}")


def insert_sample(token: str, r: dict, zone_count, grouped, largest, detail, alerted) -> str:
    def s(v):
        return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"

    def n(v):
        return "NULL" if v is None else str(v)

    viol = r["violations"]
    viol_arr = ("ARRAY[" + ",".join(s(v) for v in viol) + "]::text[]") if viol else "ARRAY[]::text[]"
    detail_json = json.dumps(detail, ensure_ascii=True).replace("'", "''")

    sql = (
        "INSERT INTO public.sonos_health_samples ("
        "sampled_at, kernel_multicast_snooping, kernel_multicast_querier, udm_boot_service, "
        "udm_uptime_seconds, rules_ok, rule_violations, speakers_online, "
        "speakers_over_retry_threshold, max_retry_pct, worst_speaker, zone_count, "
        "grouped_zone_count, largest_group_size, detail, alerted, created_by) VALUES ("
        f"now(), {n(r['kernel_multicast_snooping'])}, {n(r['kernel_multicast_querier'])}, "
        f"{s(r['udm_boot_service'])}, {n(r['udm_uptime_seconds'])}, {str(not viol).lower()}, "
        f"{viol_arr}, {n(len(r['speakers']))}, {n(r['speakers_over_retry_threshold'])}, "
        f"{n(r['max_retry_pct'])}, {s(r['worst_speaker'])}, {n(zone_count)}, {n(grouped)}, "
        f"{n(largest)}, '{detail_json}'::jsonb, {str(alerted).lower()}, "
        f"{s(getpass.getuser() + '@' + socket.gethostname().split('.')[0])}) RETURNING id;"
    )
    return supa_sql(token, sql)[0]["id"]


def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(d: dict):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(d, f)
        os.chmod(STATE_FILE, 0o600)
    except Exception as e:
        print(f"  WARN: could not persist state: {e}")


def send_email(subject: str, text: str) -> bool:
    try:
        with open(RESEND_KEY_FILE) as f:
            key = f.read().strip()
    except Exception as e:
        print(f"  WARN: no Resend key ({e}) — cannot alert")
        return False
    body = json.dumps({
        "from": ALERT_FROM, "to": [ALERT_TO], "subject": subject, "text": text,
    }).encode("utf-8")
    # User-Agent is mandatory: Cloudflare fronts both Resend and the Supabase
    # Management API and answers urllib's default agent with 403 / error 1010.
    req = urllib.request.Request("https://api.resend.com/emails", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json",
                                          "User-Agent": "alpacapps-sonos-health/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return "id" in json.loads(resp.read())
    except Exception as e:
        print(f"  WARN: Resend failed: {e}")
        return False


def maybe_alert(r: dict, zone_count, grouped) -> bool:
    """Alert on entering a bad state, on recovery, or every REALERT_HOURS while bad."""
    now = datetime.datetime.now(datetime.timezone.utc)
    prev = load_state()
    was_bad = prev.get("bad", False)
    is_bad = bool(r["violations"])

    last_alert = prev.get("last_alert")
    hours_since = None
    if last_alert:
        try:
            hours_since = (now - datetime.datetime.fromisoformat(last_alert)).total_seconds() / 3600
        except Exception:
            pass

    remediated_now = any(v.startswith("REMEDIATED") for v in r["violations"])

    should = False
    if remediated_now:
        # The router just self-healed — that is worth knowing immediately, even
        # if the debounce would otherwise hold because retry-rate warnings
        # already had us in a "bad" state.
        should = True
    elif is_bad and not was_bad:
        should = True
    elif is_bad and (hours_since is None or hours_since >= REALERT_HOURS):
        should = True
    elif was_bad and not is_bad:
        should = True

    if not should:
        save_state({**prev, "bad": is_bad, "last_alert": last_alert})
        return False

    if is_bad:
        crit = [v for v in r["violations"] if v.startswith("CRITICAL")]
        subject = ("🔴 Sonos: %d critical issue(s)" % len(crit)) if crit else "⚠️ Sonos health degraded"
        lines = ["Sonos health check found problems.", ""]
        for v in r["violations"]:
            lines.append(f"  • {v}")
        lines += ["", "Kernel state:",
                  f"  multicast_snooping = {r['kernel_multicast_snooping']} (want 0)",
                  f"  multicast_querier  = {r['kernel_multicast_querier']} (want 0)",
                  f"  udm-boot.service   = {r['udm_boot_service']} (want enabled)",
                  "", f"Zones: {zone_count} ({grouped} grouped)", "", "Wireless speakers:"]
        for sp in sorted((s for s in r["speakers"] if not s["wired"]),
                         key=lambda s: -(s.get("retry_pct") or 0)):
            lines.append(f"  {sp.get('room') or sp.get('ip'):26s} ch{sp.get('channel'):<3} "
                         f"{sp.get('rssi')} dBm  retry {sp.get('retry_pct')}%  via {sp.get('ap')}")
        lines += ["", "Fix recipes: devcontrol/devdocs/SONOSAUTOMATION.md"]
        text = "\n".join(lines)
    else:
        subject = "✅ Sonos health recovered"
        text = "All Sonos health rules pass again.\n\n" \
               f"multicast_snooping={r['kernel_multicast_snooping']}, " \
               f"multicast_querier={r['kernel_multicast_querier']}, " \
               f"udm-boot={r['udm_boot_service']}\n" \
               f"Worst retry rate: {r['max_retry_pct']}% ({r['worst_speaker']})"

    sent = send_email(subject, text)
    save_state({**prev, "bad": is_bad, "last_alert": now.isoformat() if sent else last_alert})
    return sent


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print only; no DB write, no alert")
    ap.add_argument("--no-alert", action="store_true", help="write to Supabase but never email")
    ap.add_argument("--no-probe", action="store_true", help="skip per-speaker SonosNet probe")
    ap.add_argument("--remediate", action="store_true",
                    help="if the kernel tripwire fails, apply the documented fix and reinstall "
                         "udm-boot.service, then alert; the sample still records the state as "
                         "FOUND so reboot-survival history stays honest")
    args = ap.parse_args()

    ssh_pass = os.environ.get("UDM_SSH_PASS")
    web_pass = os.environ.get("UDM_WEB_PASS")
    token = os.environ.get("SUPA_TOKEN")
    if not (ssh_pass and web_pass):
        sys.exit("Missing UDM_SSH_PASS / UDM_WEB_PASS (use wrapper sonos-health-cron.sh)")
    if not token and not args.dry_run:
        sys.exit("Missing SUPA_TOKEN (or pass --dry-run)")

    state = pull_udm(ssh_pass, web_pass)

    # Self-heal. The sample below still records what was FOUND, so the weekly
    # reboot-survival check sees the failure; only the live router is corrected.
    remediation = None
    k = state["kernel"]
    boot_bad = k.get("udm_boot", "") != "enabled"
    if args.remediate and not args.dry_run and (
            k.get("snooping") != "0" or k.get("querier") != "0" or boot_bad):
        found = {"snooping": k.get("snooping"), "querier": k.get("querier"),
                 "udm_boot": "missing" if boot_bad else "enabled"}
        remediation = {"found": found, "post": remediate(ssh_pass)}
        post = remediation["post"]
        print(f"  ⚠ REMEDIATED: found {found} → now snooping={post.get('snooping')} "
              f"querier={post.get('querier')} udm-boot={post.get('udm_boot')}")

    zones_by_mac, zone_count, grouped, largest, zerr = pull_zones()
    if zerr:
        print(f"  WARN: {zerr}")

    # PHY error counts are only comparable to the threshold when the previous
    # read was roughly one cron tick ago (see evaluate()).
    now = datetime.datetime.now(datetime.timezone.utc)
    last_sample = load_state().get("last_sample")
    mins = None
    if last_sample:
        try:
            mins = (now - datetime.datetime.fromisoformat(last_sample)).total_seconds() / 60
        except Exception:
            pass
    phy_window_ok = mins is not None and 5 <= mins <= 45

    r = evaluate(state, zones_by_mac, probe=not args.no_probe, phy_window_ok=phy_window_ok)
    if remediation:
        post = remediation["post"]
        r["violations"].append(
            "REMEDIATED automatically: kernel/boot state was wrong (see CRITICAL lines) and has "
            f"been reset — now snooping={post.get('snooping')} querier={post.get('querier')} "
            f"udm-boot={post.get('udm_boot')}"
            + (" (udm-boot.service was reinstalled — check for a firmware upgrade)"
               if post.get("reinstalled_unit") else "")
        )

    status = "OK" if not r["violations"] else f"{len(r['violations'])} VIOLATION(S)"
    print(f"→ Sonos health: {status}")
    print(f"  kernel snooping={r['kernel_multicast_snooping']} "
          f"querier={r['kernel_multicast_querier']} udm-boot={r['udm_boot_service']} "
          f"fw={r.get('udm_firmware')}")
    print(f"  zones={zone_count} grouped={grouped} largest_group={largest}")
    print(f"  worst retry: {r['max_retry_pct']}% ({r['worst_speaker']}), "
          f"{r['speakers_over_retry_threshold']} above {RETRY_WARN_PCT}%")
    for v in r["violations"]:
        print(f"  ✗ {v}")

    if not phy_window_ok:
        gap = f"{mins:.0f} min" if mins is not None else "no prior sample"
        print(f"  (PHY-error threshold not evaluated — interval {gap}, needs 5-45 min)")

    if args.dry_run:
        print("\n(dry run — nothing written)")
        print(json.dumps(r["speakers"], indent=1))
        return

    alerted = False
    if not args.no_alert:
        alerted = maybe_alert(r, zone_count, grouped)
        if alerted:
            print("  → alert email sent")

    detail = {
        "speakers": r["speakers"],
        "ap_channels": r["ap_channels"],
        "interval_minutes": round(mins, 1) if mins is not None else None,
        "phy_threshold_evaluated": phy_window_ok,
        "udm_firmware": r.get("udm_firmware"),
        "remediation": remediation,
        "thresholds": {
            "retry_crit_pct": RETRY_CRIT_PCT,
            "retry_warn_pct": RETRY_WARN_PCT,
            "retry_warn_count": RETRY_WARN_COUNT,
            "phy_err_crit": PHY_ERR_CRIT,
        },
    }
    sid = insert_sample(token, r, zone_count, grouped, largest, detail, alerted)
    print(f"  ✓ sample id={sid}")

    st = load_state()
    st["last_sample"] = now.isoformat()
    save_state(st)


if __name__ == "__main__":
    main()
