#!/usr/bin/env python3
"""
sonos-weekly-report.py — weekly digest over public.sonos_health_samples.

sonos-health.py samples every 15 min and alerts on acute problems. This reads a
week of those samples and answers the slower questions that a single sample
cannot:

  1. Did the UDM reboot, and did the kernel multicast fix survive it?
     This is the whole point of udm-boot.service. A reboot is the only real
     test of persistence, and it may be weeks between reboots.
  2. Does retry rate actually worsen as more zones are grouped?
     This decides whether the channel-1 rebalance is worth doing. If retry
     stays flat as group size grows, congestion was never the constraint.
  3. Which speakers are trending worse, and is SonosNet interference growing?

Emails the digest via Resend. Intended for Monday 08:00 America/Chicago cron on
Alpuca. Reads SUPA_TOKEN from ~/.unifi-snapshot.env via the wrapper.

Usage:
    ./scripts/sonos-weekly-report.sh              # email it
    python3 scripts/sonos-weekly-report.py --print  # stdout only, no email
    python3 scripts/sonos-weekly-report.py --days 14
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

PROJ_REF = "aphrrfprbixmhissnjfn"
SQL_URL = f"https://api.supabase.com/v1/projects/{PROJ_REF}/database/query"
RESEND_KEY_FILE = os.path.expanduser("~/.config/resend/key")
ALERT_FROM = "notifications@alpacaplayhouse.com"
ALERT_TO = "rahulioson@gmail.com"

# Cloudflare fronts both APIs and 403s urllib's default agent.
UA = "alpacapps-sonos-weekly/1.0"


def sql(token: str, query: str):
    req = urllib.request.Request(
        SQL_URL, data=json.dumps({"query": query}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase error {e.code}: {e.read()[:400].decode(errors='replace')}")


def num(v, default=0):
    """Postgres numeric/bigint arrive as JSON strings — coerce before comparing."""
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return int(f) if f == int(f) else f


def section(title):
    return f"\n{title}\n{'-' * len(title)}"


def build_report(token: str, days: int) -> tuple[str, bool]:
    """Returns (report_text, any_problem)."""
    L = [f"Sonos health — last {days} days", "=" * 40]
    problem = False

    # -- Coverage. If the collector stopped, everything below is misleading.
    cov = sql(token, f"""
        select count(*) n,
               min(sampled_at) first_at,
               max(sampled_at) last_at,
               count(*) filter (where not rules_ok) bad_n,
               round(extract(epoch from (now() - max(sampled_at)))/60) mins_stale
        from public.sonos_health_samples
        where sampled_at > now() - interval '{days} days'
    """)[0]

    expected = days * 24 * 4  # 15-min cadence
    n = num(cov["n"])
    L.append(section("Collector coverage"))
    L.append(f"  samples: {n} of ~{expected} expected ({100*n//expected if expected else 0}%)")
    L.append(f"  last sample: {cov['last_at']} ({num(cov['mins_stale'])} min ago)")
    if n == 0:
        L.append("  ✗ NO SAMPLES — the 15-min cron is not running. Nothing below is valid.")
        return "\n".join(L), True
    if num(cov["mins_stale"]) > 60:
        L.append("  ✗ collector appears stalled (last sample over an hour old)")
        problem = True
    if n < expected * 0.8:
        L.append(f"  ⚠ coverage below 80% — {expected - n} samples missing")

    # -- Persistence. A reboot is the only genuine test of udm-boot.service.
    L.append(section("Reboot / persistence check"))
    reboots = sql(token, f"""
        select sampled_at, udm_uptime_seconds,
               kernel_multicast_snooping snoop, kernel_multicast_querier quer,
               udm_boot_service,
               detail->>'udm_firmware' fw,
               jsonb_typeof(detail->'remediation') = 'object' remediated
        from public.sonos_health_samples
        where sampled_at > now() - interval '{days} days'
          and udm_uptime_seconds < 3600
        order by sampled_at
    """)
    if not reboots:
        cur = sql(token, """
            select udm_uptime_seconds, kernel_multicast_snooping snoop,
                   kernel_multicast_querier quer, udm_boot_service
            from public.sonos_health_samples order by sampled_at desc limit 1
        """)[0]
        up_days = num(cur["udm_uptime_seconds"]) / 86400
        L.append(f"  No reboot this window (UDM up {up_days:.1f} days).")
        L.append(f"  Persistence therefore UNPROVEN — kernel is correct only because")
        L.append(f"  nothing reset it. udm-boot.service = {cur['udm_boot_service']!r}")
        if cur["udm_boot_service"] != "enabled":
            L.append("  ✗ udm-boot.service is NOT enabled. The next reboot WILL")
            L.append("    reintroduce the dropouts. This is the top open item.")
            problem = True
    else:
        L.append(f"  {len(reboots)} post-reboot sample(s) captured:")
        for r in reboots[:6]:
            ok = "OK" if (num(r["snoop"], -1) == 0 and num(r["quer"], -1) == 0) else "BROKEN"
            fixed = "  → AUTO-FIXED by collector" if r.get("remediated") else ""
            L.append(f"   {r['sampled_at']}  uptime {r['udm_uptime_seconds']}s  fw {r.get('fw') or '?'}  "
                     f"snoop={r['snoop']} quer={r['quer']}  udm-boot={r['udm_boot_service']}  [{ok}]{fixed}")
        broke = [r for r in reboots if num(r["snoop"], -1) != 0 or num(r["quer"], -1) != 0]
        if broke:
            L.append("  ✗ Kernel came up WRONG after a reboot — persistence is not working.")
            problem = True
        else:
            L.append("  ✓ Kernel survived reboot with snooping/querier at 0 — persistence CONFIRMED.")

    # -- Self-healing activity + firmware. A reinstalled udm-boot unit almost
    #    always means a firmware upgrade wiped /etc/systemd/system.
    L.append(section("Auto-remediations & firmware"))
    rem = sql(token, f"""
        select count(*) filter (where jsonb_typeof(detail->'remediation') = 'object') fixes,
               count(*) filter (where (detail->'remediation'->'post'->>'reinstalled_unit')::boolean) reinstalls,
               array_agg(distinct detail->>'udm_firmware')
                 filter (where detail->>'udm_firmware' is not null) firmwares
        from public.sonos_health_samples
        where sampled_at > now() - interval '{days} days'
    """)[0]
    fixes, reinstalls = num(rem["fixes"]), num(rem["reinstalls"])
    fws = rem["firmwares"] or []
    if isinstance(fws, str):  # API may return a pg array literal like {5.1.31}
        fws = [x for x in fws.strip("{}").split(",") if x]
    L.append(f"  kernel auto-fixes: {fixes}   udm-boot.service reinstalls: {reinstalls}")
    L.append(f"  firmware seen: {', '.join(fws) if fws else 'n/a'}")
    if fixes:
        L.append("  ⚠ the collector had to correct the kernel this week — find out what reset it")
        problem = True
    if len(fws) > 1:
        L.append("  ⚠ firmware changed this window — /etc/systemd/system was likely wiped")

    # -- The channel-1 question.
    L.append(section("Does grouping drive retry rate? (channel-1 decision)"))
    grp = sql(token, f"""
        select largest_group_size gs, count(*) n,
               round(avg(max_retry_pct)::numeric, 1) avg_worst,
               round(max(max_retry_pct)::numeric, 1) peak
        from public.sonos_health_samples
        where sampled_at > now() - interval '{days} days'
          and largest_group_size is not null and max_retry_pct is not null
        group by largest_group_size order by largest_group_size
    """)
    if len(grp) < 2:
        L.append("  Not enough variation in group size yet — play 3-5 grouped zones")
        L.append("  during the week so this comparison becomes meaningful.")
        for g in grp:
            L.append(f"   group size {g['gs']}: {g['n']} samples, avg worst retry {g['avg_worst']}%")
    else:
        for g in grp:
            L.append(f"   group size {g['gs']:>2}: {g['n']:>4} samples, "
                     f"avg worst retry {g['avg_worst']:>5}%, peak {g['peak']}%")
        solo = next((g for g in grp if num(g["gs"]) == 1), None)
        big = max(grp, key=lambda g: num(g["gs"]))
        if solo and num(big["gs"]) > 1 and solo["avg_worst"] is not None:
            delta = num(big["avg_worst"]) - num(solo["avg_worst"])
            L.append("")
            L.append(f"  Grouped ({big['gs']} zones) vs solo: {delta:+.1f} pct-pt on worst retry.")
            if delta >= 8:
                L.append("  → Grouping clearly degrades RF. The ch1 rebalance is JUSTIFIED:")
                L.append("    move the Garage Mahal AP from 2.4GHz ch1 to ch6 and re-measure.")
            elif delta <= 3:
                L.append("  → Retry barely moves with group size. Congestion is NOT the")
                L.append("    binding constraint; skip the rebalance and leave channels alone.")
            else:
                L.append("  → Inconclusive. Keep collecting.")

    # -- Per-speaker trend.
    L.append(section("Per-speaker retry (worst first)"))
    sp = sql(token, f"""
        select sp->>'room' room, sp->>'channel' ch, sp->>'ap' ap,
               count(*) n,
               round(avg((sp->>'retry_pct')::numeric), 1) avg_retry,
               round(max((sp->>'retry_pct')::numeric), 1) max_retry,
               round(avg((sp->>'rssi')::numeric), 0) avg_rssi
        from public.sonos_health_samples,
             lateral jsonb_array_elements(detail->'speakers') sp
        where sampled_at > now() - interval '{days} days'
          and sp->>'retry_pct' is not null
        group by 1,2,3 order by avg_retry desc nulls last limit 14
    """)
    for s in sp:
        flag = " ✗" if num(s["avg_retry"]) >= 15 else ""
        L.append(f"   {(s['room'] or '?')[:24]:24s} ch{s['ch'] or '?':<2} "
                 f"avg {s['avg_retry']:>5}%  peak {s['max_retry']:>5}%  "
                 f"{s['avg_rssi']} dBm  via {(s['ap'] or '?')[:22]}{flag}")

    # -- SonosNet interference, only over valid intervals.
    L.append(section("SonosNet PHY errors (valid intervals only)"))
    phy = sql(token, f"""
        select sp->>'room' room,
               round(avg((sp->>'phy_errors')::numeric)) avg_phy,
               count(*) n
        from public.sonos_health_samples,
             lateral jsonb_array_elements(detail->'speakers') sp
        where sampled_at > now() - interval '{days} days'
          and (detail->>'phy_threshold_evaluated')::boolean is true
          and sp->>'phy_errors' is not null
        group by 1 order by avg_phy desc nulls last limit 8
    """)
    if not phy:
        L.append("  No valid-interval samples yet (needs consecutive 15-min runs).")
    else:
        for p in phy:
            L.append(f"   {(p['room'] or '?')[:24]:24s} avg {int(num(p['avg_phy'])):>12,} per 15 min")
        L.append("  Reference: the 2026-05-06 incident peaked at 12.8M on the mesh root.")

    # -- Open violations.
    L.append(section("Rule violations this window"))
    viol = sql(token, f"""
        select v, count(*) n, max(sampled_at) last_seen
        from public.sonos_health_samples, lateral unnest(rule_violations) v
        where sampled_at > now() - interval '{days} days'
        group by v order by n desc limit 10
    """)
    if not viol:
        L.append("  ✓ none — all rules passed all week.")
    else:
        problem = True
        for v in viol:
            L.append(f"   [{v['n']}x, last {v['last_seen']}] {v['v'][:150]}")

    L.append("\nDocs: devcontrol/devdocs/SONOSAUTOMATION.md")
    return "\n".join(L), problem


def send(subject: str, text: str) -> bool:
    try:
        key = open(RESEND_KEY_FILE).read().strip()
    except Exception as e:
        print(f"WARN: no Resend key ({e})")
        return False
    body = json.dumps({"from": ALERT_FROM, "to": [ALERT_TO],
                       "subject": subject, "text": text}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json",
                                          "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return "id" in json.loads(r.read())
    except Exception as e:
        print(f"WARN: Resend failed: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--print", dest="only_print", action="store_true",
                    help="print to stdout instead of emailing")
    args = ap.parse_args()

    token = os.environ.get("SUPA_TOKEN")
    if not token:
        sys.exit("Missing SUPA_TOKEN (use wrapper sonos-weekly-report.sh)")

    report, problem = build_report(token, args.days)
    print(report)

    if not args.only_print:
        subject = ("⚠️ Sonos weekly — action needed" if problem
                   else "✅ Sonos weekly — all clear")
        print("\n→ emailed" if send(subject, report) else "\n→ email FAILED")


if __name__ == "__main__":
    main()
