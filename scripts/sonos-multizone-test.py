#!/usr/bin/env python3
"""
sonos-multizone-test.py — actively provoke the 3-5 zone dropout and measure it.

The passive collector waits for someone to group zones. This creates the load on
purpose, in escalating phases (3 -> 4 -> 5 zones), and samples densely throughout.

Two things it produces that nothing else does:

  1. REAL dropout detection. Retry rate is a proxy; this watches the coordinator's
     elapsedTime. If playbackState says PLAYING but the position stops advancing,
     the audio has actually stalled — that is the symptom the household hears.
     It also catches members silently falling out of the group.
  2. Group-size variation. Phases are 15 min so each spans one */15 collector
     tick, giving sonos_health_samples rows at largest_group_size 3, 4 and 5 —
     exactly what the weekly report's channel-1 verdict needs.

Safety:
  * EXCLUDE list is honoured absolutely (Pequeno + MasterBlaster by default).
  * Original volume and grouping are captured up front and restored on exit,
    including on Ctrl-C or crash.
  * Test volume is deliberately low. Volume does not affect network load at all
    (same stream bitrate either way), so this costs nothing analytically.

Usage (on Alpuca):
    python3 sonos-multizone-test.py --dry-run          # show plan, touch nothing
    nohup python3 sonos-multizone-test.py > test.log 2>&1 &
    python3 sonos-multizone-test.py --phase-minutes 5  # quick smoke test
"""

import argparse
import datetime
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SONOS_API = os.environ.get("SONOS_API", "http://127.0.0.1:5005")
UDM_HOST = "192.168.1.1"
UA = "alpacapps-sonos-multizone/1.0"

# Never touch these. Pequeno was actively playing when this test was designed;
# MasterBlaster is the main listening zone.
EXCLUDE = {"Pequeno", "MasterBlaster"}

# Escalating phases. Living Sound is the wired SonosNet root, so making it the
# coordinator exercises the wired->wireless multicast path that was failing.
# The additions are chosen to mix channels and known-good/known-bad speakers:
#   Dining     ch1, worst retry (~26%)     Skyloft     ch1, best retry (~3.5%)
#   Backyard   ch1, mid (~15%)             SkyBalcony  ch6, high (~20%)
# Each config runs every size in SIZES. A phase of size N is the coordinator
# plus additions[:N-1], so group membership grows incrementally within a config
# and the only variable between configs is WHICH speakers and WHICH coordinator.
SIZES = [3, 4, 5, 6]

CONFIGS = [
    {
        "name": "A-wired-root",
        "why": "Living Sound is the wired SonosNet root, so this exercises the "
               "wired->wireless multicast path that was actually failing. Baseline; "
               "extends the 2026-09-02 run from 5 zones to 6.",
        "coordinator": "Living Sound",
        "additions": ["Dining Sound", "Skyloft Sound", "Backyard Sound",
                      "SkyBalcony Sound", "Front Outside Sound"],
    },
    {
        "name": "B-wireless-root",
        "why": "All-wireless coordinator (Skyloft: best retry, on the Skyloft AP). No "
               "wired speaker in the group at all, so the stream never crosses the "
               "wired->wireless boundary. Isolates whether the wired root matters.",
        "coordinator": "Skyloft Sound",
        "additions": ["Dining Sound", "DJ", "Front Outside Sound",
                      "Outhouse", "Backyard Sound"],
    },
    {
        "name": "C-rf-worst",
        "why": "Deliberate stress case: the speakers with genuinely bad current interval "
               "retry (garage outdoors, SkyBalcony) plus the distant outdoor ones, and "
               "four members sharing the Garage Mahal AP. If grouping breaks anywhere, here.",
        "coordinator": "Living Sound",
        "additions": ["garage outdoors", "SkyBalcony Sound", "Backyard Sound",
                      "Outhouse", "Garage Bridge - no sound"],
    },
]


def phases_for(cfg):
    """[(size, [members]) ...] — members exclude the coordinator."""
    return [(n, cfg["additions"][:n - 1]) for n in SIZES
            if n - 1 <= len(cfg["additions"])]

TEST_VOLUME = 8
# No "handpan" anywhere in favorites or playlists (checked 2026-09-02), so this
# falls back to an existing ambient playlist. Repeat is switched on because a
# playlist is finite and the run is ~45 min — the stream must not simply end,
# or the stall detector would report a false dropout.
PLAYLIST = "Ambient Music"
SAMPLE_SECONDS = 30
STALL_STRIKES = 2  # consecutive frozen-position samples before calling it a dropout

RESEND_KEY_FILE = os.path.expanduser("~/.config/resend/key")
ALERT_FROM = "notifications@alpacaplayhouse.com"
ALERT_TO = "rahulioson@gmail.com"


def log(msg):
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ------------------------------------------------------------------ Sonos API

def sonos(path: str, timeout: int = 12):
    url = f"{SONOS_API}/{urllib.parse.quote(path)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode(errors="replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}


def get_zones():
    return sonos("zones")


def snapshot_state():
    """Capture volume + grouping so we can put the house back exactly as found."""
    state = {}
    for z in get_zones():
        members = [m["roomName"] for m in z.get("members", [])]
        coord = z["coordinator"]
        for m in z.get("members", []):
            state[m["roomName"]] = {
                "volume": (m.get("state") or {}).get("volume"),
                "coordinator": coord["roomName"],
                "group_members": members,
                "playback": (coord.get("state") or {}).get("playbackState"),
            }
    return state


def restore_state(original: dict, touched: set):
    """Ungroup everything we grouped, then put volumes back."""
    log("restoring original state...")
    for room in sorted(touched):
        try:
            sonos(f"{room}/pause")
        except Exception:
            pass
    # Everything we touched leaves first, so no test grouping survives.
    for room in sorted(touched):
        try:
            sonos(f"{room}/leave")
        except Exception as e:
            log(f"  WARN: {room} leave failed: {e}")
    time.sleep(3)
    # Then rooms that were originally group MEMBERS rejoin their old coordinator.
    # Previously only standalone rooms were handled, so a room found already
    # grouped was silently left standalone — the docstring's "grouping restored"
    # claim was false. Harmless on 2026-09-02 (all 12 zones were standalone) but
    # wrong the first time anyone leaves a group running.
    for room in sorted(touched):
        was = original.get(room, {})
        coord = was.get("coordinator")
        if coord and coord != room and coord not in (None, ""):
            try:
                sonos(f"{room}/join/{coord}")
                time.sleep(0.5)
            except Exception as e:
                log(f"  WARN: {room} rejoin to {coord} failed: {e}")
    time.sleep(2)
    for room in sorted(touched):
        vol = (original.get(room) or {}).get("volume")
        if vol is not None:
            try:
                sonos(f"{room}/volume/{vol}")
            except Exception as e:
                log(f"  WARN: {room} volume restore failed: {e}")
    log("restore complete")


# -------------------------------------------------------------- UDM retry data

class UDM:
    """Controller session for per-speaker retry rates. Reachable from Alpuca."""

    # Must match sonos-health.py's SONOS_OUIS or the two disagree about which
    # clients are Sonos. Today every speaker here is 00:0e:58 / b8:e9:37, but a
    # newer unit would be invisible to the test while the collector saw it.
    SONOS_OUIS = ("00:0e:58", "b8:e9:37", "5c:aa:fd", "94:9f:3e",
                  "48:a6:b8", "34:7e:5c", "54:2a:1b")

    def __init__(self, password):
        self.password = password
        self.cookie = None
        self.ok = False
        try:
            self._login()
            self.ok = True
        except Exception as e:
            log(f"  WARN: UDM login failed ({e}) — retry rates unavailable")

    def _opener(self):
        import http.cookiejar
        self.jar = getattr(self, "jar", None) or http.cookiejar.CookieJar()
        ctx = __import__("ssl")._create_unverified_context()
        return urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx),
            urllib.request.HTTPCookieProcessor(self.jar))

    def _login(self):
        op = self._opener()
        body = json.dumps({"username": "alpacaauto", "password": self.password,
                           "remember": True}).encode()
        req = urllib.request.Request(f"https://{UDM_HOST}/api/auth/login", data=body,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": UA})
        op.open(req, timeout=15).read()
        self.opener = op

    def counters(self):
        """{mac: (tx_retries, tx_packets)} for wireless Sonos clients.

        RAW counters, not a ratio. These are cumulative since association, so
        their ratio is a lifetime average that barely moves and stays poisoned by
        pre-fix history (verified 2026-09-02: Dining read 25.4% lifetime vs 9.1%
        actual). run_phase differences consecutive samples to get a real rate.
        """
        if not self.ok:
            return {}
        try:
            req = urllib.request.Request(
                f"https://{UDM_HOST}/proxy/network/api/s/default/stat/sta",
                headers={"User-Agent": UA})
            data = json.loads(self.opener.open(req, timeout=15).read())["data"]
        except Exception:
            return {}
        out = {}
        for s in data:
            mac = (s.get("mac") or "").lower()
            if not mac.startswith(self.SONOS_OUIS) or s.get("is_wired"):
                continue
            out[mac] = (s.get("tx_retries", 0) or 0, s.get("tx_packets", 0) or 0)
        return out


# ------------------------------------------------------------------- the test

def ungroup(rooms):
    """Break every room out to standalone. Needed between configs, which have
    different coordinators — otherwise the previous group persists."""
    for room in rooms:
        try:
            sonos(f"{room}/leave")
        except Exception:
            pass
        time.sleep(0.4)


def run_phase(cfg_name: str, coordinator: str, members: list, minutes: int, udm) -> dict:
    """Group, play, and watch. Returns per-phase findings."""
    group = [coordinator] + members
    log(f"--- [{cfg_name}] {len(group)} zones -> {', '.join(group)}")

    setup_errors = []
    for room in members:
        try:
            sonos(f"{room}/join/{coordinator}")
        except Exception as e:
            setup_errors.append(f"{room} join failed: {e}")
        time.sleep(1)
    for room in group:
        try:
            sonos(f"{room}/volume/{TEST_VOLUME}")
        except Exception as e:
            setup_errors.append(f"{room} volume failed: {e}")
    for msg in setup_errors:
        log(f"  WARN: {msg}")
    time.sleep(2)

    try:
        sonos(f"{coordinator}/playlist/{PLAYLIST}")
        time.sleep(2)
        sonos(f"{coordinator}/repeat/on")
    except Exception as e:
        log(f"  WARN: playlist {PLAYLIST!r} failed ({e}) — trying plain play")
        sonos(f"{coordinator}/play")
    time.sleep(6)

    events = [{"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "kind": "api_error", "detail": m} for m in setup_errors]
    samples = []
    prev_counters = udm.counters()   # baseline so sample 1 already has a delta
    prev_pstate, prev_missing = "PLAYING", set()
    last_elapsed, stall_strikes = None, 0
    deadline = time.time() + minutes * 60

    while time.time() < deadline:
        t = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            zones = get_zones()
        except Exception as e:
            events.append({"at": t, "kind": "api_error", "detail": str(e)})
            time.sleep(SAMPLE_SECONDS)
            continue

        # Find our group by coordinator name.
        z = next((z for z in zones if z["coordinator"]["roomName"] == coordinator), None)
        if z is None:
            events.append({"at": t, "kind": "group_vanished",
                           "detail": f"{coordinator} is no longer a coordinator"})
            time.sleep(SAMPLE_SECONDS)
            continue

        present = {m["roomName"] for m in z.get("members", [])}

        # EXCLUDE is a runtime invariant, not just a plan-time check. If someone
        # groups Pequeno/MasterBlaster onto our coordinator mid-test they would
        # play the test playlist and never be volume-restored (they are not in
        # `touched`). Eject immediately and record it.
        intruders = present & EXCLUDE
        for room in sorted(intruders):
            try:
                sonos(f"{room}/leave")
                events.append({"at": t, "kind": "excluded_room_ejected",
                               "detail": f"{room} was grouped into the test; removed"})
                log(f"  WARN: ejected excluded room {room}")
            except Exception as e:
                log(f"  WARN: could not eject {room}: {e}")
        present -= intruders
        missing = set(group) - present
        if missing and missing != prev_missing:
            events.append({"at": t, "kind": "member_dropped",
                           "detail": f"left the group: {sorted(missing)}"})
        prev_missing = missing

        st = z["coordinator"].get("state") or {}
        pstate = st.get("playbackState")
        elapsed = st.get("elapsedTime")

        # The real dropout signal: says PLAYING, position frozen.
        if pstate == "PLAYING":
            if last_elapsed is not None and elapsed == last_elapsed:
                stall_strikes += 1
                if stall_strikes >= STALL_STRIKES:
                    events.append({"at": t, "kind": "audio_stalled",
                                   "detail": f"position frozen at {elapsed}s for "
                                             f"{stall_strikes * SAMPLE_SECONDS}s while PLAYING"})
                    stall_strikes = 0
            else:
                stall_strikes = 0
        elif pstate != prev_pstate:
            # Edge-triggered: without this a single 5-minute stall appended an
            # event every 30s and reported as 10 separate dropouts, inflating
            # the count the email subject keys off.
            events.append({"at": t, "kind": "playback_stopped",
                           "detail": f"playbackState={pstate}"})
        prev_pstate = pstate
        last_elapsed = elapsed

        # Interval retry: difference this sample's counters against the last.
        # The first sample of a phase has no baseline, so it reports None.
        counters = udm.counters()
        retries = {}
        for mac, (r2, p2) in counters.items():
            if mac not in prev_counters:
                continue
            r1, p1 = prev_counters[mac]
            d_r, d_p = r2 - r1, p2 - p1
            if d_r >= 0 and d_p >= 0 and (d_r + d_p) > 0:
                retries[mac] = round(100.0 * d_r / (d_r + d_p), 1)
        prev_counters = counters
        worst = max(retries.values(), default=None)
        samples.append({"at": t, "members_present": len(present),
                        "playback": pstate, "elapsed": elapsed,
                        "worst_retry_pct": worst, "retries": retries})

        if len(samples) % 4 == 0:
            log(f"  [{len(samples):>2}] {len(present)}/{len(group)} zones  "
                f"{pstate}  pos={elapsed}s  worst_retry={worst}%")

        time.sleep(SAMPLE_SECONDS)

    worsts = [s["worst_retry_pct"] for s in samples if s["worst_retry_pct"] is not None]
    result = {
        "config": cfg_name,
        "zone_count": len(group),
        "rooms": group,
        "samples": len(samples),
        "events": events,
        "dropouts": len([e for e in events if e["kind"] in
                         ("audio_stalled", "member_dropped", "playback_stopped", "group_vanished")]),
        "avg_worst_retry": round(sum(worsts) / len(worsts), 1) if worsts else None,
        "max_worst_retry": max(worsts) if worsts else None,
        "detail_samples": samples,
    }
    log(f"  [{cfg_name}] {len(group)} zones done: {result['dropouts']} dropout event(s), "
        f"avg worst retry {result['avg_worst_retry']}%, peak {result['max_worst_retry']}%")
    return result


def send_email(subject, text):
    try:
        key = open(RESEND_KEY_FILE).read().strip()
    except Exception:
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
    except Exception:
        return False


def summarize(results, started, failure=None, expected_phases=None):
    L = ["Sonos multi-zone dropout test", "=" * 46,
         f"started {started:%Y-%m-%d %H:%M %Z}",
         "retry = INTERVAL rate (delta between samples), not lifetime average", ""]
    if failure or (expected_phases and len(results) < expected_phases):
        L += ["*** RESULT IS INCOMPLETE — DO NOT READ AS A PASS ***",
              f"ran {len(results)} of {expected_phases} phases",
              f"failure: {failure}" if failure else "phases missing without an exception",
              ""]

    by_cfg = {}
    for r in results:
        by_cfg.setdefault(r["config"], []).append(r)

    for name, rows in by_cfg.items():
        cfg = next((c for c in CONFIGS if c["name"] == name), {})
        L.append(f"{name} — coordinator {rows[0]['rooms'][0]}")
        if cfg.get("why"):
            L.append(f"  rationale: {cfg['why']}")
        for r in rows:
            L.append(f"    {r['zone_count']} zones: {r['dropouts']} dropout(s), "
                     f"avg worst retry {r['avg_worst_retry']}%, peak {r['max_worst_retry']}% "
                     f"({r['samples']} samples)")
            L.append(f"      + {', '.join(r['rooms'][1:])}")
        L.append("")

    total = sum(r["dropouts"] for r in results)
    if not results:
        L.append("VERDICT: none — no phase completed. Nothing was measured.")
    elif total == 0:
        L.append(f"VERDICT: zero dropouts across {len(results)} phases / "
                 f"{len(by_cfg)} configurations, sizes {min(SIZES)}-{max(SIZES)}.")
        L.append("Multi-zone playback is reliable regardless of coordinator or speaker mix.")
    else:
        L.append(f"VERDICT: {total} dropout event(s). Detail:")
        for r in results:
            for e in r["events"]:
                L.append(f"  [{r['config']} {r['zone_count']}z] {e['at'][11:19]} "
                         f"{e['kind']}: {e['detail']}")
    L.append("")

    # Does group size drive retry? Compare within each config, then overall.
    L.append("Retry vs group size (does grouping load the RF?):")
    deltas = []
    for name, rows in by_cfg.items():
        v = [r for r in rows if r["avg_worst_retry"] is not None]
        if len(v) >= 2:
            d = v[-1]["avg_worst_retry"] - v[0]["avg_worst_retry"]
            deltas.append(d)
            L.append(f"  {name}: {v[0]['zone_count']}z {v[0]['avg_worst_retry']}% -> "
                     f"{v[-1]['zone_count']}z {v[-1]['avg_worst_retry']}%  ({d:+.1f} pct-pt)")
    if deltas:
        mean = sum(deltas) / len(deltas)
        L.append(f"  mean across configs: {mean:+.1f} pct-pt")
        L.append("  -> grouping clearly loads the RF; the ch1 rebalance is justified."
                 if mean >= 8 else
                 "  -> retry barely tracks group size; congestion is not the constraint, "
                 "leave AP channels alone." if mean <= 3 else
                 "  -> inconclusive; let the weekly report accumulate more.")

    L += ["", "Docs: devcontrol/devdocs/SONOSAUTOMATION.md"]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase-minutes", type=int, default=15,
                    help="minutes per phase; 15 makes each phase span one */15 collector tick")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    ap.add_argument("--out", default=os.path.expanduser("~/logs/sonos-multizone-test.json"))
    ap.add_argument("--config", action="append",
                    help="run only these config names (repeatable); default all")
    args = ap.parse_args()

    configs = CONFIGS
    if args.config:
        want = set(args.config)
        configs = [c for c in CONFIGS if c["name"] in want]
        if not configs:
            sys.exit(f"no config matched {sorted(want)}; have "
                     f"{[c['name'] for c in CONFIGS]}")

    all_rooms = {r for c in configs for r in [c["coordinator"], *c["additions"]]}
    bad = all_rooms & EXCLUDE
    if bad:
        sys.exit(f"REFUSING: phase plan includes excluded rooms {bad}")

    live = {z["coordinator"]["roomName"] for z in get_zones()}
    missing = all_rooms - live
    if missing:
        log(f"WARN: rooms not currently visible: {sorted(missing)}")

    total_phases = sum(len(phases_for(c)) for c in configs)
    if args.dry_run:
        log(f"PLAN — volume {TEST_VOLUME}, {args.phase_minutes} min/phase, "
            f"playlist {PLAYLIST!r}")
        for c in configs:
            log(f"  {c['name']} — coordinator {c['coordinator']}")
            log(f"     {c['why']}")
            for n, members in phases_for(c):
                log(f"     {n} zones -> {', '.join([c['coordinator']] + members)}")
        log(f"excluded (never touched): {sorted(EXCLUDE)}")
        log(f"{total_phases} phases, total runtime "
            f"~{args.phase_minutes * total_phases} min "
            f"({args.phase_minutes * total_phases / 60:.1f} h)")
        return

    original = snapshot_state()
    touched = all_rooms
    log(f"captured original state for {len(original)} rooms")

    restored = {"done": False}

    def cleanup(*_):
        if not restored["done"]:
            restored["done"] = True
            restore_state(original, touched)

    signal.signal(signal.SIGINT, lambda *a: (cleanup(), sys.exit(130)))
    signal.signal(signal.SIGTERM, lambda *a: (cleanup(), sys.exit(143)))

    udm = UDM(os.environ.get("UDM_WEB_PASS", ""))
    started = datetime.datetime.now().astimezone()
    results = []
    failure = None
    try:
        for ci, c in enumerate(configs, 1):
            # Different configs use different coordinators, so tear the previous
            # group down first or the old grouping persists into the new phase.
            if ci > 1:
                log(f"ungrouping before {c['name']}")
                ungroup(sorted(all_rooms))
                time.sleep(3)
            for n, members in phases_for(c):
                results.append(run_phase(c["name"], c["coordinator"], members,
                                         args.phase_minutes, udm))
    except Exception as e:
        failure = f"{type(e).__name__}: {e}"
        log(f"ERROR during test: {failure}")
    finally:
        cleanup()

    report = summarize(results, started, failure, total_phases)
    print("\n" + report)
    try:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w") as f:
            json.dump({"started": started.isoformat(), "results": results}, f, indent=1)
        log(f"raw data -> {args.out}")
    except Exception as e:
        log(f"WARN: could not write {args.out}: {e}")

    if not args.no_email:
        total = sum(r["dropouts"] for r in results)
        # A crash, or phases that never ran, must NEVER read as a green result:
        # results=[] makes total==0, which would otherwise email "no dropouts"
        # from the very script whose job is to report the truth.
        if failure or len(results) < total_phases:
            subj = (f"🛑 Sonos multi-zone test INCOMPLETE "
                    f"({len(results)}/{total_phases} phases)")
        elif total:
            subj = f"⚠️ Sonos multi-zone test: {total} dropout event(s)"
        else:
            subj = "✅ Sonos multi-zone test: no dropouts"
        log("emailed" if send_email(subj, report) else "email failed")

    if failure or len(results) < total_phases:
        sys.exit(1)


if __name__ == "__main__":
    main()
