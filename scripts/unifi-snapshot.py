#!/usr/bin/env python3
"""
unifi-snapshot.py — capture current UniFi config to public.network_config_snapshots
                    in Supabase for history/rollback. ONE table, jsonb config column.

Usage:
    ./scripts/unifi-snapshot.sh "snapshot name" [--notes "free text"] [--stable] [--tags tag1,tag2]

Schema (existing table public.network_config_snapshots):
    id, snapshot_name, snapshot_date, device_type, device_ip, notes, is_stable,
    tags text[], config jsonb, created_by, created_at

The `config` jsonb keys (matching the 2026-03-06 baseline):
    captured_at, snapshot_version, networks, wifi_networks, access_points,
    switches, sonos_devices_confirmed, critical_rules_for_sonos,
    troubleshooting_notes
"""

import argparse, json, os, subprocess, sys, datetime, urllib.request, urllib.error, getpass, socket

PROJ_REF = "aphrrfprbixmhissnjfn"
SQL_URL  = f"https://api.supabase.com/v1/projects/{PROJ_REF}/database/query"
UDM_HOST = "192.168.1.1"

# Documented Sonos-compatible rules (see 2026-03-06 baseline snapshot id a9d45377-fef8-480c-9526-1caa7fd1b72d)
SONOS_RULES = [
    "1. IGMP snooping MUST be disabled on the Default LAN network",
    "2. mDNS MUST be enabled on the Default LAN network",
    "3. 2.4GHz minimum data rate on Sonos WiFi (Black Rock City) must be <= 6 Mbps (6000 kbps). Setting it to 9 Mbps breaks some speakers.",
    "4. Multicast enhancement MUST be disabled on the Sonos WiFi network (Black Rock City)",
    "5. BSS Transition should be OFF on Sonos WiFi to prevent connection drops during AP roaming",
    "6. Fast Roaming (802.11r) should be OFF on Sonos WiFi — Sonos does not support 802.11r",
    "7. L2 isolation MUST be OFF on Sonos WiFi — speakers need to see each other on the same L2 segment",
    "8. NO UniFi 2.4 GHz AP may use channel 11 if SonosNet is on channel 11 (verified 2026-05-06: ch11 conflict caused PHY errors >12M on the SonosNet root)",
    "9. The wired SonosNet root (Sonos Boost) sits at the worst RF spot in this house (garage). Keep ch1+ch6 split for UniFi 2.4 GHz.",
]


def ssh_pull_udm(ssh_pass: str, web_pass: str) -> dict:
    remote = f'''
WP="{web_pass}"
curl -sk -c /tmp/uc.txt -X POST 'https://localhost/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d "{{\\"username\\":\\"alpacaauto\\",\\"password\\":\\"$WP\\",\\"remember\\":true}}" > /dev/null
echo "===DEVICES==="
curl -sk -b /tmp/uc.txt 'https://localhost/proxy/network/api/s/default/stat/device'
echo ""
echo "===WLANS==="
curl -sk -b /tmp/uc.txt 'https://localhost/proxy/network/api/s/default/rest/wlanconf'
echo ""
echo "===NETWORKS==="
curl -sk -b /tmp/uc.txt 'https://localhost/proxy/network/api/s/default/rest/networkconf'
'''
    cmd = [
        "sshpass", "-p", ssh_pass,
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "PubkeyAuthentication=no", "-o", "ConnectTimeout=10",
        f"root@{UDM_HOST}", "bash -s",
    ]
    proc = subprocess.run(cmd, input=remote, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        sys.exit(f"SSH/UDM API failed: {proc.stderr[:500]}")
    parts = proc.stdout.split("===DEVICES===")[1]
    devices_raw, rest = parts.split("===WLANS===", 1)
    wlans_raw, networks_raw = rest.split("===NETWORKS===", 1)
    return {
        "devices":  json.loads(devices_raw.strip()).get("data", []),
        "wlans":    json.loads(wlans_raw.strip()).get("data", []),
        "networks": json.loads(networks_raw.strip()).get("data", []),
    }


def supa_sql(token: str, sql: str) -> dict:
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(SQL_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "alpacapps-unifi-snapshot/2.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()[:800].decode(errors="replace")
        sys.exit(f"Supabase error {e.code}: {body}\n  SQL: {sql[:300]}")


def slug(s: str) -> str:
    return "".join(c.lower() if c.isalnum() else "_" for c in (s or "")).strip("_") or "unknown"


def shape_config(state: dict) -> dict:
    """Reshape live UDM dump into the network_config_snapshots.config jsonb format."""
    devices = state["devices"]
    aps      = [d for d in devices if d.get("type") == "uap"]
    switches = [d for d in devices if d.get("type") == "usw"]

    networks = {}
    for n in state["networks"]:
        if n.get("purpose") == "corporate":
            key = slug(n.get("name", ""))
            networks[key + "_lan" if not key.endswith("_lan") else key] = {
                "_id": n.get("_id"),
                "name": n.get("name"),
                "purpose": n.get("purpose"),
                "ip_subnet": n.get("ip_subnet"),
                "vlan": n.get("vlan"),
                "vlan_enabled": n.get("vlan_enabled"),
                "dhcpd_enabled": n.get("dhcpd_enabled"),
                "dhcpd_start": n.get("dhcpd_start"),
                "dhcpd_stop": n.get("dhcpd_stop"),
                "igmp_snooping": n.get("igmp_snooping"),
                "mdns_enabled": n.get("mdns_enabled"),
            }

    wifi_networks = {}
    for w in state["wlans"]:
        wifi_networks[slug(w.get("name", ""))] = {
            "_id": w.get("_id"),
            "name": w.get("name"),
            "enabled": w.get("enabled"),
            "wlan_band": w.get("wlan_band"),
            "security": w.get("security"),
            "wpa_mode": w.get("wpa_mode"),
            "pmf_mode": w.get("pmf_mode"),
            "no2ghz_oui": w.get("no2ghz_oui"),
            "l2_isolation": w.get("l2_isolation"),
            "bss_transition": w.get("bss_transition"),
            "fast_roaming_enabled": w.get("fast_roaming_enabled"),
            "uapsd_enabled": w.get("uapsd_enabled"),
            "mcastenhance_enabled": w.get("mcastenhance_enabled"),
            "minrate_ng_enabled": w.get("minrate_ng_enabled"),
            "minrate_ng_data_rate_kbps": w.get("minrate_ng_data_rate_kbps"),
            "minrate_na_enabled": w.get("minrate_na_enabled"),
            "minrate_na_data_rate_kbps": w.get("minrate_na_data_rate_kbps"),
            "dtim_ng": w.get("dtim_ng"),
            "dtim_na": w.get("dtim_na"),
            "group_rekey": w.get("group_rekey"),
        }

    access_points = {}
    for d in aps:
        rt = d.get("radio_table", []) or []
        ng = next((r for r in rt if r.get("radio") == "ng"), {})
        na = next((r for r in rt if r.get("radio") == "na"), {})
        access_points[slug(d.get("name", ""))] = {
            "_id": d.get("_id"),
            "name": d.get("name"),
            "model": d.get("model"),
            "ip": d.get("ip"),
            "mac": d.get("mac"),
            "ng_channel": ng.get("channel"),
            "ng_ht": ng.get("ht"),
            "ng_tx_power_mode": ng.get("tx_power_mode"),
            "ng_min_rssi_enabled": ng.get("min_rssi_enabled"),
            "ng_min_rssi": ng.get("min_rssi"),
            "na_channel": na.get("channel"),
            "na_ht": na.get("ht"),
            "na_tx_power_mode": na.get("tx_power_mode"),
        }

    switches_out = {}
    for d in switches:
        switches_out[slug(d.get("name", ""))] = {
            "_id": d.get("_id"),
            "name": d.get("name"),
            "model": d.get("model"),
            "ip": d.get("ip"),
            "mac": d.get("mac"),
            "stp_version": d.get("stp_version"),
            "stp_priority": d.get("stp_priority"),
        }

    return {
        "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "snapshot_version": "2.0",
        "networks": networks,
        "wifi_networks": wifi_networks,
        "access_points": access_points,
        "switches": switches_out,
        "critical_rules_for_sonos": SONOS_RULES,
    }


def insert_snapshot(token: str, name: str, notes: str, is_stable: bool, tags: list[str], config: dict, created_by: str) -> str:
    def s(v):
        return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"
    tags_arr = "ARRAY[" + ",".join(s(t) for t in tags) + "]::text[]" if tags else "ARRAY[]::text[]"
    config_json = json.dumps(config, ensure_ascii=True).replace("'", "''")
    sql = (
        "INSERT INTO public.network_config_snapshots "
        "(snapshot_name, snapshot_date, device_type, device_ip, notes, is_stable, tags, config, created_by) "
        f"VALUES ({s(name)}, now(), 'UDM Pro', '192.168.1.1', {s(notes)}, {str(is_stable).lower()}, "
        f"{tags_arr}, '{config_json}'::jsonb, {s(created_by)}) "
        "RETURNING id;"
    )
    res = supa_sql(token, sql)
    return res[0]["id"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", help="Snapshot name (e.g. 'POST sonos channel + igmp fix 2026-05-06')")
    ap.add_argument("--notes", default="", help="Free-text notes")
    ap.add_argument("--stable", action="store_true", help="Mark this snapshot as a known-good baseline")
    ap.add_argument("--tags", default="", help="Comma-separated tags, e.g. sonos,wifi,working")
    args = ap.parse_args()

    ssh_pass = os.environ.get("UDM_SSH_PASS")
    web_pass = os.environ.get("UDM_WEB_PASS")
    token    = os.environ.get("SUPA_TOKEN")
    if not all([ssh_pass, web_pass, token]):
        sys.exit("Missing UDM_SSH_PASS / UDM_WEB_PASS / SUPA_TOKEN env vars (use wrapper unifi-snapshot.sh)")

    created_by = f"{getpass.getuser()}@{socket.gethostname().split('.')[0]}"
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]

    print(f"→ Pulling live UniFi state from {UDM_HOST}...")
    state = shape_config(ssh_pull_udm(ssh_pass, web_pass))
    print(f"  {len(state['access_points'])} APs, {len(state['switches'])} switches, "
          f"{len(state['wifi_networks'])} WLANs, {len(state['networks'])} networks")

    print(f"→ Inserting into public.network_config_snapshots (name={args.name!r})...")
    snap_id = insert_snapshot(token, args.name, args.notes, args.stable, tags, state, created_by)
    print(f"  ✓ id={snap_id}")
    print(f"\n  Verify:  SELECT snapshot_name, is_stable, tags, jsonb_pretty(config -> 'networks') FROM public.network_config_snapshots WHERE id='{snap_id}';")


if __name__ == "__main__":
    main()
