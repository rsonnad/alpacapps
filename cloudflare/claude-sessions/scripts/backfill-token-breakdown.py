#!/usr/bin/env python3
"""Backfill input/output/cache token breakdown + cost for existing sessions
by re-parsing every JSONL under ~/.claude/projects/ and POSTing to the
claude-sessions Worker. Skips sessions that already have input_tokens set.

Run: ./backfill-token-breakdown.py [--all] [--limit N]
"""
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API_URL = "https://claude-sessions.alpacapps.workers.dev"
API_TOKEN = "alpaca-sessions-2026"
PROJECTS_DIR = Path.home() / ".claude" / "projects"

PRICING = {
    "opus":   {"in": 15.00, "out": 75.00, "cr": 1.50,  "cw": 18.75},
    "sonnet": {"in":  3.00, "out": 15.00, "cr": 0.30,  "cw":  3.75},
    "haiku":  {"in":  0.80, "out":  4.00, "cr": 0.08,  "cw":  1.00},
}

def price_for(model_name):
    if not model_name: return PRICING["sonnet"]
    m = model_name.lower()
    if "opus" in m: return PRICING["opus"]
    if "haiku" in m: return PRICING["haiku"]
    return PRICING["sonnet"]

def parse_jsonl(path):
    model = None
    started_at = ended_at = None
    it = ot = cr = cw = 0
    cost = 0.0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: e = json.loads(line)
            except json.JSONDecodeError: continue
            ts = e.get("timestamp")
            if ts and not started_at: started_at = ts
            if ts: ended_at = ts
            if e.get("type") == "assistant":
                msg = e.get("message", {}) or {}
                if msg.get("model"): model = msg["model"]
                u = msg.get("usage", {}) or {}
                i = u.get("input_tokens", 0) or 0
                o = u.get("output_tokens", 0) or 0
                r = u.get("cache_read_input_tokens", 0) or 0
                w = u.get("cache_creation_input_tokens", 0) or 0
                it += i; ot += o; cr += r; cw += w
                p = price_for(msg.get("model") or model)
                cost += (i*p["in"] + o*p["out"] + r*p["cr"] + w*p["cw"]) / 1_000_000
    return {
        "model": model,
        "started_at": started_at,
        "ended_at": ended_at,
        "input_tokens": it or None,
        "output_tokens": ot or None,
        "cache_read_tokens": cr or None,
        "cache_creation_tokens": cw or None,
        "token_count": (it+ot+cr+cw) or None,
        "cost_usd": round(cost, 6) if cost else None,
    }

CANONICAL_PROJECTS = [
    ("genalpaca-admin", "genalpaca"),
    ("sponic-garden",   "sponic"),
    ("finleg",          "finleg"),
    ("portsie",         "portsie"),
    ("mistiq",          "mistiq"),
    ("Khangtsen",       "khangtsen"),
]

def project_name(jsonl_path):
    d = jsonl_path.parent.name
    for needle, canonical in CANONICAL_PROJECTS:
        if needle in d:
            return canonical
    if d.startswith("-Users-"):
        parts = d.split("-")
        return "/".join(parts[3:]) if len(parts) > 3 else d
    return d

def post(payload):
    req = urllib.request.Request(
        f"{API_URL}/sessions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json", "User-Agent": "claude-sessions-backfill/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception as e:
        return False

def process(jsonl):
    sid = jsonl.stem
    data = parse_jsonl(jsonl)
    if not data["token_count"]:
        return ("skip", sid)
    payload = {"id": sid, "project": project_name(jsonl), **data}
    ok = post(payload)
    return ("ok" if ok else "fail", sid)

def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit")+1])
    files = sorted(PROJECTS_DIR.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if limit: files = files[:limit]
    print(f"Processing {len(files)} JSONL files...", flush=True)
    ok = fail = skip = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(process, f) for f in files]
        for i, fut in enumerate(as_completed(futures), 1):
            status, sid = fut.result()
            if status == "ok": ok += 1
            elif status == "skip": skip += 1
            else: fail += 1
            if i % 50 == 0:
                print(f"  {i}/{len(files)}  ok={ok} skip={skip} fail={fail}", flush=True)
    print(f"Done. ok={ok} skip={skip} fail={fail}")

if __name__ == "__main__":
    main()
