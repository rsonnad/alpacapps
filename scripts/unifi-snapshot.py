#!/usr/bin/env python3
"""
unifi-snapshot.py — capture current UniFi config to Supabase for history/rollback.

Usage:
    ./scripts/unifi-snapshot.py "reason for snapshot"
    ./scripts/unifi-snapshot.py "pre channel fix" --source pre-restore

Env (auto-populated by wrapper unifi-snapshot.sh):
    UDM_SSH_PASS   — root SSH password for UDM Pro (BW: UniFi Dream Machine Pro — Network Gateway / SSH Password)
    UDM_WEB_PASS   — alpacaauto web/API password
    SUPA_TOKEN     — Supabase Dashboard Access Token (BW item 4febf188 / Access Token)

Tables: public.unifi_config_snapshots + per-device rows in unifi_{ap,switch,wlan,network}_states
"""

import argparse, json, os, subprocess, sys, uuid, urllib.request, urllib.error, getpass, socket

PROJ_REF = "aphrrfprbixmhissnjfn"
SQL_URL  = f"https://api.supabase.com/v1/projects/{PROJ_REF}/database/query"
UDM_HOST = "192.168.1.1"


def ssh_pull_udm(ssh_pass: str, web_pass: str) -> dict:
    """SSH to UDM Pro, login to API, dump devices/wlans/networks."""
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
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-o", "PubkeyAuthentication=no",
        "-o", "ConnectTimeout=10",
        f"root@{UDM_HOST}",
        f"bash -s",
    ]
    proc = subprocess.run(cmd, input=remote, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        sys.exit(f"SSH/UDM API failed: {proc.stderr[:500]}")

    parts = proc.stdout.split("===DEVICES===")[1]
    devices_raw, rest = parts.split("===WLANS===", 1)
    wlans_raw,   networks_raw = rest.split("===NETWORKS===", 1)

    devices  = json.loads(devices_raw.strip()).get("data", [])
    wlans    = json.loads(wlans_raw.strip()).get("data", [])
    networks = json.loads(networks_raw.strip()).get("data", [])
    return {"devices": devices, "wlans": wlans, "networks": networks}


def supa_sql(token: str, sql: str) -> dict:
    """Run one SQL statement via Supabase Management API."""
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(SQL_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "alpacapps-unifi-snapshot/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()[:800].decode(errors="replace")
        sys.exit(f"Supabase error {e.code}: {body}\n  SQL was: {sql[:200]}")


def insert_snapshot(token: str, state: dict, reason: str, source: str, taken_by: str,
                    override_taken_at: str | None = None) -> str:
    """Build and execute INSERTs. Returns snapshot UUID."""
    aps      = [d for d in state["devices"] if d.get("type") == "uap"]
    switches = [d for d in state["devices"] if d.get("type") == "usw"]
    wlans    = state["wlans"]
    networks = state["networks"]

    snap_id = str(uuid.uuid4())

    def js(o):
        return json.dumps(o, ensure_ascii=True).replace("'", "''")
    def s(v):
        if v is None: return "NULL"
        return "'" + str(v).replace("'", "''") + "'"
    def i(v):
        if v is None or v == "": return "NULL"
        try: return str(int(v))
        except (TypeError, ValueError): return "NULL"
    def b(v):
        if v is None: return "NULL"
        return "true" if v else "false"

    taken_at_clause = f", taken_at" if override_taken_at else ""
    taken_at_value  = f", '{override_taken_at}'::timestamptz" if override_taken_at else ""

    # 1. snapshot row
    snap_sql = (
        "INSERT INTO public.unifi_config_snapshots "
        f"(id, taken_by, reason, source, ap_count, switch_count, wlan_count, network_count, raw_dump{taken_at_clause}) "
        f"VALUES ('{snap_id}', {s(taken_by)}, {s(reason)}, {s(source)}, {len(aps)}, {len(switches)}, "
        f"{len(wlans)}, {len(networks)}, '{js(state)}'::jsonb{taken_at_value});"
    )
    supa_sql(token, snap_sql)

    # 2. per-AP rows
    for d in aps:
        rt = d.get("radio_table", []) or []
        ng = next((r for r in rt if r.get("radio") == "ng"), {})
        na = next((r for r in rt if r.get("radio") == "na"), {})
        sql = (
            "INSERT INTO public.unifi_ap_states "
            f"(snapshot_id, device_id, name, model, ip, mac, state, "
            f"ng_channel, ng_ht, ng_tx_power_mode, ng_min_rssi_enabled, ng_min_rssi, "
            f"na_channel, na_ht, na_tx_power_mode, radio_table{taken_at_clause}) "
            f"VALUES ('{snap_id}', {s(d.get('_id'))}, {s(d.get('name'))}, {s(d.get('model'))}, "
            f"{s(d.get('ip'))}, {s(d.get('mac'))}, {i(d.get('state'))}, "
            f"{s(ng.get('channel'))}, {s(ng.get('ht'))}, {s(ng.get('tx_power_mode'))}, "
            f"{b(ng.get('min_rssi_enabled'))}, {i(ng.get('min_rssi'))}, "
            f"{s(na.get('channel'))}, {s(na.get('ht'))}, {s(na.get('tx_power_mode'))}, "
            f"'{js(rt)}'::jsonb{taken_at_value});"
        )
        supa_sql(token, sql)

    # 3. per-switch rows
    for d in switches:
        sql = (
            "INSERT INTO public.unifi_switch_states "
            f"(snapshot_id, device_id, name, model, ip, mac, state, stp_version, stp_priority, port_overrides{taken_at_clause}) "
            f"VALUES ('{snap_id}', {s(d.get('_id'))}, {s(d.get('name'))}, {s(d.get('model'))}, "
            f"{s(d.get('ip'))}, {s(d.get('mac'))}, {i(d.get('state'))}, "
            f"{s(d.get('stp_version'))}, {s(d.get('stp_priority'))}, "
            f"'{js(d.get('port_overrides', []))}'::jsonb{taken_at_value});"
        )
        supa_sql(token, sql)

    # 4. per-WLAN rows
    for w in wlans:
        sql = (
            "INSERT INTO public.unifi_wlan_states "
            f"(snapshot_id, wlan_id, name, enabled, wlan_band, bss_transition, fast_roaming_enabled, "
            f"uapsd_enabled, pmf_mode, l2_isolation, minrate_setting_preference, minrate_ng_data_rate_kbps, "
            f"multicast_enhancement_enabled, proxy_arp, full_config{taken_at_clause}) "
            f"VALUES ('{snap_id}', {s(w.get('_id'))}, {s(w.get('name'))}, {b(w.get('enabled'))}, "
            f"{s(w.get('wlan_band'))}, {b(w.get('bss_transition'))}, {b(w.get('fast_roaming_enabled'))}, "
            f"{b(w.get('uapsd_enabled'))}, {s(w.get('pmf_mode'))}, {b(w.get('l2_isolation'))}, "
            f"{s(w.get('minrate_setting_preference'))}, {i(w.get('minrate_ng_data_rate_kbps'))}, "
            f"{b(w.get('multicast_enhancement_enabled'))}, {b(w.get('proxy_arp'))}, "
            f"'{js(w)}'::jsonb{taken_at_value});"
        )
        supa_sql(token, sql)

    # 5. per-network rows
    for n in networks:
        sql = (
            "INSERT INTO public.unifi_network_states "
            f"(snapshot_id, network_id, name, purpose, vlan, vlan_enabled, igmp_snooping, mdns_enabled, full_config{taken_at_clause}) "
            f"VALUES ('{snap_id}', {s(n.get('_id'))}, {s(n.get('name'))}, {s(n.get('purpose'))}, "
            f"{i(n.get('vlan'))}, {b(n.get('vlan_enabled'))}, {b(n.get('igmp_snooping'))}, "
            f"{b(n.get('mdns_enabled'))}, '{js(n)}'::jsonb{taken_at_value});"
        )
        supa_sql(token, sql)

    return snap_id


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reason", nargs="?", default="manual snapshot",
                    help="Why this snapshot is being taken")
    ap.add_argument("--source", default="manual",
                    help="manual | scheduled | pre-change | post-change | restore")
    ap.add_argument("--taken-at", default=None,
                    help="Override taken_at (ISO8601). Use to backfill historical snapshots.")
    args = ap.parse_args()

    ssh_pass = os.environ.get("UDM_SSH_PASS")
    web_pass = os.environ.get("UDM_WEB_PASS")
    token    = os.environ.get("SUPA_TOKEN")
    if not all([ssh_pass, web_pass, token]):
        sys.exit("Missing UDM_SSH_PASS / UDM_WEB_PASS / SUPA_TOKEN env vars (see wrapper unifi-snapshot.sh)")

    taken_by = f"{getpass.getuser()}@{socket.gethostname().split('.')[0]}"
    print(f"→ Pulling live UniFi state from {UDM_HOST}...")
    state = ssh_pull_udm(ssh_pass, web_pass)
    n_aps = sum(1 for d in state['devices'] if d.get('type') == 'uap')
    n_sw  = sum(1 for d in state['devices'] if d.get('type') == 'usw')
    print(f"  pulled: {n_aps} APs, {n_sw} switches, {len(state['wlans'])} WLANs, {len(state['networks'])} networks")

    print(f"→ Inserting snapshot (reason={args.reason!r}, source={args.source})...")
    snap_id = insert_snapshot(token, state, args.reason, args.source, taken_by, args.taken_at)
    print(f"  ✓ snapshot_id={snap_id}")
    print(f"\n  Query:")
    print(f"    SELECT name, ng_channel FROM public.unifi_ap_states WHERE snapshot_id='{snap_id}';")


if __name__ == "__main__":
    main()
