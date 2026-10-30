#!/usr/bin/env python3
"""alexa-room-guard — undo any Alexa/Google voice command that spans more than one room.

Listens to the HAOS event stream. Light changes made by the HA Cloud user (Alexa and
Google voice, routines, groups) are collected into bursts: one voice command fans out
to one service call per light within a second or two. When a burst goes quiet, the
guard works out which rooms it touched. If more than one, it puts every touched light
back to the state it had before the burst and posts an HA notification.

Rooms come from the HA area of the entity or its device. A light group (has an
`entity_id` attribute) takes the rooms of its members. Lights with no known room
fall back to Supabase lighting_devices.room, otherwise they don't count.

Runs on Alpuca under launchd (com.alpacapps.alexa-room-guard). See README.md.
"""
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import websocket  # websocket-client

HA_HOST = os.environ.get("HA_HOST", "192.168.1.39:8123")
CLOUD_USER = os.environ.get("GUARD_USER_ID", "62f35793d4e647fc9d0100fb3e37ca61")  # "Home Assistant Cloud"
MAX_ROOMS = int(os.environ.get("GUARD_MAX_ROOMS", "1"))
QUIET_SECONDS = float(os.environ.get("GUARD_QUIET_SECONDS", "3"))
DRY_RUN = os.environ.get("GUARD_DRY_RUN") == "1"
SUPABASE_URL = "https://aphrrfprbixmhissnjfn.supabase.co"

# Sub-rooms that count as one room, and placeholder names that count as no room.
ROOM_ALIASES = {
    "Spartan Tea Lounge": "Spartan Trailer",
    "Spartan Fishbowl": "Spartan Trailer",
    "Spartan Cedar Chamber": "Spartan Trailer",
    "Master Pasture Suite": "Master Pasture",
    "Unknown": None,
    "Unnamed Room": None,
}


def room_name(name):
    return ROOM_ALIASES.get(name, name) if name else None


def log(*a):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def ha_token():
    if os.environ.get("HA_TOKEN"):
        return os.environ["HA_TOKEN"]
    text = open(os.path.expanduser("~/lights.sh")).read()
    return re.search(r'^TOKEN="([^"]+)"', text, re.M).group(1)


TOKEN = ha_token()


def rest(path, data=None):
    req = urllib.request.Request(
        f"http://{HA_HOST}/api/{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    body = urllib.request.urlopen(req, timeout=30).read()
    return json.loads(body) if body else None


def ws_call(ws, msg_id, payload):
    payload["id"] = msg_id
    ws.send(json.dumps(payload))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == msg_id:
            return r.get("result")


def supabase_rooms():
    try:
        key = open(os.path.expanduser("~/.sb_service_key")).read().strip()
        q = urllib.parse.urlencode({"select": "ha_entity_id,room", "ha_entity_id": "not.is.null"})
        req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/lighting_devices?{q}",
                                     headers={"apikey": key, "Authorization": "Bearer " + key})
        return {r["ha_entity_id"]: r["room"] for r in json.load(urllib.request.urlopen(req, timeout=20)) if r["room"]}
    except Exception as e:
        log("supabase room lookup failed:", e)
        return {}


class RoomMap:
    """entity_id -> room name, refreshed every 10 minutes."""

    def __init__(self):
        self.rooms, self.members, self.loaded = {}, {}, 0

    def refresh(self):
        ws = websocket.create_connection(f"ws://{HA_HOST}/api/websocket", timeout=30)
        try:
            ws.recv()
            ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
            ws.recv()
            ents = ws_call(ws, 1, {"type": "config/entity_registry/list"})
            devs = {d["id"]: d for d in ws_call(ws, 2, {"type": "config/device_registry/list"})}
            areas = {a["area_id"]: a["name"] for a in ws_call(ws, 3, {"type": "config/area_registry/list"})}
        finally:
            ws.close()
        fallback = supabase_rooms()
        rooms = {}
        for e in ents:
            eid = e["entity_id"]
            if not eid.startswith("light."):
                continue
            area = e.get("area_id") or (devs.get(e.get("device_id")) or {}).get("area_id")
            rooms[eid] = room_name(areas.get(area)) or room_name(fallback.get(eid))
        self.members = {s["entity_id"]: s["attributes"]["entity_id"] for s in rest("states")
                        if s["entity_id"].startswith("light.") and s["attributes"].get("entity_id")}
        self.rooms, self.loaded = rooms, time.time()
        log(f"room map: {sum(1 for v in rooms.values() if v)} of {len(rooms)} lights have a room, {len(self.members)} groups")

    def rooms_of(self, eid, depth=0):
        if time.time() - self.loaded > 600:
            try:
                self.refresh()
            except Exception as e:
                log("room map refresh failed:", e)
        if self.rooms.get(eid):
            return {self.rooms[eid]}
        if eid in self.members and depth < 3:
            out = set()
            for m in self.members[eid]:
                out |= self.rooms_of(m, depth + 1)
            return out
        return set()


ROOMS = RoomMap()


def restore_call(state):
    """Service call that puts a light back to a saved state, or None to skip."""
    eid, st, a = state["entity_id"], state["state"], state.get("attributes") or {}
    if st == "off":
        return "turn_off", {"entity_id": eid}
    if st != "on":
        return None  # unavailable / unknown: nothing to restore
    data = {"entity_id": eid}
    if a.get("brightness") is not None:
        data["brightness"] = a["brightness"]
    mode = a.get("color_mode")
    if mode == "color_temp" and a.get("color_temp_kelvin"):
        data["color_temp_kelvin"] = a["color_temp_kelvin"]
    elif mode in ("hs", "rgb", "rgbw", "rgbww", "xy") and a.get("hs_color"):
        data["hs_color"] = a["hs_color"]
    return "turn_on", data


class Guard:
    def __init__(self):
        self.lock = threading.Lock()
        self.burst = None  # {"start": ts, "last": ts, "old": {eid: old_state}}
        self.ignore_until = 0  # skip the echo of our own restores

    def on_change(self, ev):
        data = ev["data"]
        eid = data.get("entity_id", "")
        if not eid.startswith("light.") or ev["context"].get("user_id") != CLOUD_USER:
            return
        if time.time() < self.ignore_until:
            return
        with self.lock:
            if self.burst is None:
                self.burst = {"start": time.time(), "old": {}}
                threading.Thread(target=self.close_when_quiet, daemon=True).start()
            self.burst["last"] = time.time()
            if eid not in self.burst["old"] and data.get("old_state"):
                self.burst["old"][eid] = data["old_state"]

    def close_when_quiet(self):
        while True:
            time.sleep(0.5)
            with self.lock:
                if time.time() - self.burst["last"] >= QUIET_SECONDS:
                    burst, self.burst = self.burst, None
                    break
        self.judge(burst)

    def judge(self, burst):
        old = burst["old"]
        rooms = set()
        for eid in old:
            rooms |= ROOMS.rooms_of(eid)
        if len(rooms) <= MAX_ROOMS:
            log(f"ok: voice command on {len(old)} lights in {sorted(rooms) or ['(no room)']}")
            return
        # Restore real lights first; groups only if none of their members were touched.
        calls = []
        for eid, st in old.items():
            members = ROOMS.members.get(eid)
            if members and any(m in old for m in members):
                continue
            c = restore_call(st)
            if c:
                calls.append(c)
        log(f"BLOCKED: voice command on {len(old)} lights across {len(rooms)} rooms "
            f"{sorted(rooms)}; restoring {len(calls)}{' (dry run)' if DRY_RUN else ''}")
        if not DRY_RUN:
            self.ignore_until = time.time() + 120

            def send(c):
                try:
                    rest(f"services/light/{c[0]}", c[1])
                except Exception as e:
                    log("restore failed", c[1]["entity_id"], e)
            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(send, calls))
            self.ignore_until = time.time() + 5
        try:
            rest("services/persistent_notification/create", {
                "notification_id": "alexa_room_guard",
                "title": "Voice command undone",
                "message": (f"{datetime.now():%b %d %H:%M}: Alexa tried to change {len(old)} lights in "
                            f"{len(rooms)} rooms ({', '.join(sorted(rooms))}). Voice control is one room "
                            f"at a time, so the lights were put back."),
            })
        except Exception as e:
            log("notify failed:", e)


def main():
    ROOMS.refresh()
    guard = Guard()
    while True:
        try:
            ws = websocket.create_connection(f"ws://{HA_HOST}/api/websocket", timeout=60)
            ws.recv()
            ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
            if json.loads(ws.recv()).get("type") != "auth_ok":
                log("auth failed")
                sys.exit(1)
            ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
            ws.settimeout(None)
            log(f"listening (max rooms per voice command: {MAX_ROOMS}{', dry run' if DRY_RUN else ''})")
            while True:
                msg = json.loads(ws.recv())
                if msg.get("type") == "event":
                    guard.on_change(msg["event"])
        except Exception as e:
            log("connection lost:", e, "- reconnecting in 10s")
            time.sleep(10)


if __name__ == "__main__":
    main()
