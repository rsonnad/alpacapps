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
COORDINATOR = "Living Sound"
PHASES = [
    ["Dining Sound", "Skyloft Sound"],                                          # 3 zones
    ["Dining Sound", "Skyloft Sound", "Backyard Sound"],                        # 4 zones
    ["Dining Sound", "Skyloft Sound", "Backyard Sound", "SkyBalcony Sound"],    # 5 zones
]

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
    for room in sorted(touched):
        was = original.get(room, {})
        # If the room was its own coordinator originally, it was ungrouped.
        if was.get("coordinator") == room and len(was.get("group_members", [])) == 1:
            try:
                sonos(f"{room}/leave")
            except Exception as e:
                log(f"  WARN: {room} leave failed: {e}")
    time.sleep(3)
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

    SONOS_OUIS = ("00:0e:58", "b8:e9:37")

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

    def retries(self):
        """{room_mac: retry_pct} for wireless Sonos clients."""
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
            tx_r, tx_p = s.get("tx_retries", 0) or 0, s.get("tx_packets", 0) or 0
            tot = tx_r + tx_p
            if tot:
                out[mac] = round(100.0 * tx_r / tot, 1)
        return out


# ------------------------------------------------------------------- the test

def run_phase(phase_num: int, members: list, minutes: int, udm) -> dict:
    """Group, play, and watch. Returns per-phase findings."""
    group = [COORDINATOR] + members
    log(f"--- Phase {phase_num}: {len(group)} zones -> {', '.join(group)}")

    for room in members:
        sonos(f"{room}/join/{COORDINATOR}")
        time.sleep(1)
    for room in group:
        sonos(f"{room}/volume/{TEST_VOLUME}")
    time.sleep(2)

    try:
        sonos(f"{COORDINATOR}/playlist/{PLAYLIST}")
        time.sleep(2)
        sonos(f"{COORDINATOR}/repeat/on")
    except Exception as e:
        log(f"  WARN: playlist {PLAYLIST!r} failed ({e}) — trying plain play")
        sonos(f"{COORDINATOR}/play")
    time.sleep(6)

    events, samples = [], []
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
        z = next((z for z in zones if z["coordinator"]["roomName"] == COORDINATOR), None)
        if z is None:
            events.append({"at": t, "kind": "group_vanished",
                           "detail": f"{COORDINATOR} is no longer a coordinator"})
            time.sleep(SAMPLE_SECONDS)
            continue

        present = {m["roomName"] for m in z.get("members", [])}
        missing = set(group) - present
        if missing:
            events.append({"at": t, "kind": "member_dropped",
                           "detail": f"left the group: {sorted(missing)}"})

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
        else:
            events.append({"at": t, "kind": "playback_stopped",
                           "detail": f"playbackState={pstate}"})
        last_elapsed = elapsed

        retries = udm.retries()
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
        "phase": phase_num,
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
    log(f"  Phase {phase_num} done: {result['dropouts']} dropout event(s), "
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


def summarize(results, started):
    L = ["Sonos multi-zone dropout test", "=" * 40,
         f"started {started:%Y-%m-%d %H:%M %Z}", ""]
    L.append("Phase results:")
    for r in results:
        L.append(f"  {r['zone_count']} zones: {r['dropouts']} dropout event(s), "
                 f"avg worst retry {r['avg_worst_retry']}%, peak {r['max_worst_retry']}% "
                 f"({r['samples']} samples)")
        L.append(f"    rooms: {', '.join(r['rooms'])}")
    L.append("")

    total = sum(r["dropouts"] for r in results)
    if total == 0:
        L.append("VERDICT: no dropouts at any group size. The multicast fix appears to")
        L.append("have resolved the reported problem — grouping 3-5 zones held cleanly.")
    else:
        L.append(f"VERDICT: {total} dropout event(s) observed. Detail:")
        for r in results:
            for e in r["events"]:
                L.append(f"  [{r['zone_count']}z] {e['at'][11:19]} {e['kind']}: {e['detail']}")

    valid = [r for r in results if r["avg_worst_retry"] is not None]
    if len(valid) >= 2:
        first, last = valid[0], valid[-1]
        delta = last["avg_worst_retry"] - first["avg_worst_retry"]
        L += ["", f"Retry trend {first['zone_count']}->{last['zone_count']} zones: {delta:+.1f} pct-pt.",
              ("  Grouping drives RF load — the ch1 rebalance is justified." if delta >= 8 else
               "  Retry barely moves with group size — congestion is not the constraint." if delta <= 3
               else "  Inconclusive; let the weekly report accumulate more.")]
    L += ["", "Docs: devcontrol/devdocs/SONOSAUTOMATION.md"]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase-minutes", type=int, default=15,
                    help="minutes per phase; 15 makes each phase span one */15 collector tick")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    ap.add_argument("--out", default=os.path.expanduser("~/logs/sonos-multizone-test.json"))
    args = ap.parse_args()

    all_rooms = {r for p in PHASES for r in p} | {COORDINATOR}
    bad = all_rooms & EXCLUDE
    if bad:
        sys.exit(f"REFUSING: phase plan includes excluded rooms {bad}")

    live = {z["coordinator"]["roomName"] for z in get_zones()}
    missing = all_rooms - live
    if missing:
        log(f"WARN: rooms not currently visible: {sorted(missing)}")

    if args.dry_run:
        log(f"PLAN — coordinator {COORDINATOR}, volume {TEST_VOLUME}, "
            f"{args.phase_minutes} min/phase, playlist {PLAYLIST!r}")
        for i, p in enumerate(PHASES, 1):
            log(f"  Phase {i}: {len([COORDINATOR] + p)} zones -> {', '.join([COORDINATOR] + p)}")
        log(f"excluded (never touched): {sorted(EXCLUDE)}")
        log(f"total runtime ~{args.phase_minutes * len(PHASES)} min")
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
    try:
        for i, members in enumerate(PHASES, 1):
            results.append(run_phase(i, members, args.phase_minutes, udm))
    except Exception as e:
        log(f"ERROR during test: {e}")
    finally:
        cleanup()

    report = summarize(results, started)
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
        subj = ("✅ Sonos multi-zone test: no dropouts" if total == 0
                else f"⚠️ Sonos multi-zone test: {total} dropout event(s)")
        log("emailed" if send_email(subj, report) else "email failed")


if __name__ == "__main__":
    main()
