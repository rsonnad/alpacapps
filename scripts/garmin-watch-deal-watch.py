#!/usr/bin/env python3
"""
Garmin Forerunner 145/245 deal watcher — Grok searches the stores, this script emails the result.

Runs on Alpuca. Morning (8:00am Eastern / 7:00am Central) always emails a digest.
Evening (6:00pm Eastern / 5:00pm Central) emails only when listings or prices changed.

Grok does the live search via grok-delegate ask (web-aware). This process:
  1. calls grok-delegate
  2. parses EMAIL_BODY + JSON
  3. diffs against ~/.garmin-watch-deal-watch/state.json so the same deal is not re-hyped
  4. sends mail through Resend (macOS mail/postfix will not reach Gmail)
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
HOME = Path(os.path.expanduser("~"))
STATE_DIR = Path(os.environ.get("GARMIN_WATCH_DIR", str(HOME / ".garmin-watch-deal-watch")))
STATE_FILE = STATE_DIR / "state.json"
LAST_GROK_FILE = STATE_DIR / "last-grok.md"
RESEND_KEY_FILE = Path(
    os.environ.get("RESEND_KEY_FILE", str(HOME / ".config/resend/key"))
)
def _find_grok_delegate() -> str:
    candidates = [
        os.environ.get("GROK_DELEGATE"),
        "/Users/alpuca/sponic/infra/bin/grok-delegate",
        str(HOME / "Documents/codingprojects/sponic/infra/bin/grok-delegate"),
        str(HOME / "Documents/CodingProjects/sponic/infra/bin/grok-delegate"),
        "/Users/otter/Documents/codingprojects/sponic/infra/bin/grok-delegate",
    ]
    for path in candidates:
        if path and os.access(path, os.X_OK):
            return path
    return "/Users/alpuca/sponic/infra/bin/grok-delegate"


GROK_DELEGATE = _find_grok_delegate()
PROMPT_FILE = Path(
    os.environ.get(
        "GARMIN_WATCH_PROMPT",
        str(Path(__file__).resolve().parent / "garmin-watch-deal-watch-prompt.md"),
    )
)
TO_EMAIL = os.environ.get("GARMIN_WATCH_TO", "rahulioson@gmail.com")
FROM_EMAIL = os.environ.get("GARMIN_WATCH_FROM", "notifications@alpacaplayhouse.com")
GROK_TIMEOUT_SEC = int(os.environ.get("GARMIN_WATCH_GROK_TIMEOUT", "1320"))  # 22 min
RESEND_URL = "https://api.resend.com/emails"

TIER_ORDER = {"excellent": 0, "good": 1, "acceptable": 2, "over_budget": 3}


def log(msg: str) -> None:
    now = datetime.now(EASTERN).strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"[{now}] {msg}", flush=True)


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"seen": {}, "last_fingerprint": None, "last_run": None}
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return {"seen": {}, "last_fingerprint": None, "last_run": None}


def save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    tmp.replace(STATE_FILE)


def listing_id(item: dict[str, Any]) -> str:
    raw = str(item.get("id") or item.get("url") or item.get("title") or "").strip()
    if raw:
        return raw
    blob = json.dumps(item, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def fingerprint(listings: list[dict[str, Any]]) -> str:
    rows = []
    for item in listings:
        total = item.get("total") if item.get("total") not in (None, "") else item.get("price")
        rows.append([listing_id(item), _num(total), str(item.get("url") or "")])
    rows.sort()
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def run_grok(prompt_file: Path) -> str:
    if not prompt_file.is_file():
        raise FileNotFoundError(f"prompt file not found: {prompt_file}")
    if not os.access(GROK_DELEGATE, os.X_OK):
        raise FileNotFoundError(f"grok-delegate not executable: {GROK_DELEGATE}")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    grok_log_dir = STATE_DIR / "grok-logs"
    grok_log_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("GROK_DELEGATE_LOG_DIR", str(grok_log_dir))
    env.setdefault("GROK_DELEGATE_LOG_KEEP", "20")
    env.setdefault("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")

    cmd = [
        GROK_DELEGATE,
        "ask",
        "--prompt-file",
        str(prompt_file),
        "--effort",
        "high",
        "--out",
        str(LAST_GROK_FILE),
    ]
    log("calling grok-delegate ask (web-aware, effort=high)")
    proc = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        timeout=GROK_TIMEOUT_SEC,
    )
    if proc.stderr:
        for line in proc.stderr.strip().splitlines()[-20:]:
            log(f"grok-stderr: {line}")
    if proc.returncode != 0:
        raise RuntimeError(
            f"grok-delegate exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr[-4000:]}\n"
            f"stdout:\n{proc.stdout[-2000:]}"
        )
    text = LAST_GROK_FILE.read_text() if LAST_GROK_FILE.exists() else proc.stdout
    if not text.strip():
        raise RuntimeError("grok-delegate returned empty output")
    return text


def parse_grok(text: str) -> tuple[str, dict[str, Any]]:
    """Split EMAIL_BODY prose from the trailing JSON object."""
    payload: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "listings": [],
        "near_misses": [],
        "source_notes": [],
    }

    json_blob = None
    fenced = re.findall(r"```json\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        json_blob = fenced[-1]
    else:
        # Last top-level object in the text.
        match = re.search(r"\{[\s\S]*\}\s*$", text)
        if match:
            json_blob = match.group(0)

    if json_blob:
        try:
            parsed = json.loads(json_blob)
            if isinstance(parsed, dict):
                payload.update(parsed)
        except json.JSONDecodeError as exc:
            log(f"WARN: could not parse Grok JSON ({exc}); mailing prose only")

    body = text
    m = re.search(r"##\s*EMAIL_BODY\b(.*?)(?:##\s*JSON\b|```json)", text, flags=re.DOTALL | re.IGNORECASE)
    if m:
        body = m.group(1).strip()
    else:
        body = re.sub(r"```json[\s\S]*```", "", text).strip()
        body = re.sub(r"##\s*JSON\b[\s\S]*$", "", body, flags=re.IGNORECASE).strip()

    if not body:
        body = text.strip()
    return body, payload


def _total_of(item: dict[str, Any]) -> float | None:
    return _num(item.get("total") if item.get("total") not in (None, "") else item.get("price"))


def classify_changes(
    listings: list[dict[str, Any]], seen: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    now = datetime.now(timezone.utc).isoformat()
    current_ids: set[str] = set()
    new: list[dict[str, Any]] = []
    price_changes: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []

    previously_present = {
        lid for lid, rec in seen.items() if rec.get("still_present")
    }

    for item in listings:
        lid = listing_id(item)
        current_ids.add(lid)
        total = _total_of(item)
        row = dict(item)
        row["_id"] = lid
        row["_total"] = total
        prev = seen.get(lid)
        if prev is None:
            row["_change"] = "new"
            new.append(row)
        else:
            old = _num(prev.get("total"))
            if old is not None and total is not None and abs(old - total) >= 1:
                row["_change"] = "price"
                row["_old_total"] = old
                price_changes.append(row)
            else:
                row["_change"] = "same"
                unchanged.append(row)

    gone = [seen[lid] for lid in previously_present if lid not in current_ids]

    for lid, rec in seen.items():
        rec["still_present"] = lid in current_ids

    for item in listings:
        lid = listing_id(item)
        rec = seen.get(lid, {})
        rec.update(
            {
                "id": lid,
                "title": item.get("title"),
                "url": item.get("url"),
                "source": item.get("source"),
                "total": _total_of(item),
                "tier": item.get("tier"),
                "last_seen": now,
                "still_present": True,
            }
        )
        rec.setdefault("first_seen", now)
        seen[lid] = rec

    return {
        "new": new,
        "price_changes": price_changes,
        "unchanged": unchanged,
        "gone": gone,
    }


def money(v: Any) -> str:
    n = _num(v)
    if n is None:
        return "?"
    return f"${n:,.0f}" if n == int(n) else f"${n:,.2f}"


def subject_line(mode: str, listings: list[dict[str, Any]], changes: dict[str, list] | None) -> str:
    stamp = datetime.now(EASTERN).strftime("%a %-I:%M%p").replace("AM", "am").replace("PM", "pm")
    n = len(listings)
    best = None
    for item in listings:
        total = _num(item.get("total") if item.get("total") not in (None, "") else item.get("price"))
        if total is None:
            continue
        if best is None or total < best:
            best = total
    best_bit = f", lowest {money(best)}" if best is not None else ""

    if mode == "evening" and changes:
        n_new = len(changes["new"])
        n_px = len(changes["price_changes"])
        n_gone = len(changes["gone"])
        bits = []
        if n_new:
            bits.append(f"{n_new} new")
        if n_px:
            bits.append(f"{n_px} price change{'s' if n_px != 1 else ''}")
        if n_gone:
            bits.append(f"{n_gone} gone")
        summary = ", ".join(bits) or "changes"
        return f"Garmin Forerunner deals — {summary} ({stamp})"
    return f"Garmin Forerunner deals — morning digest, {n} match{'es' if n != 1 else ''}{best_bit} ({stamp})"


def build_email(
    mode: str,
    grok_body: str,
    payload: dict[str, Any],
    changes: dict[str, list],
) -> tuple[str, str]:
    listings = list(payload.get("listings") or [])
    listings.sort(
        key=lambda x: (
            TIER_ORDER.get(str(x.get("tier") or ""), 9),
            _num(x.get("total") if x.get("total") not in (None, "") else x.get("price")) or 9e9,
        )
    )

    header_bits = []
    if mode == "evening":
        header_bits.append(
            f"Change vs last run: {len(changes['new'])} new, "
            f"{len(changes['price_changes'])} price changes, "
            f"{len(changes['gone'])} disappeared, "
            f"{len(changes['unchanged'])} unchanged."
        )
        if changes["new"]:
            header_bits.append("NEW:")
            for item in changes["new"]:
                header_bits.append(
                    f"  + {money(item.get('_total'))} | {item.get('source')} | {item.get('title')} | {item.get('url')}"
                )
        if changes["price_changes"]:
            header_bits.append("PRICE CHANGES:")
            for item in changes["price_changes"]:
                header_bits.append(
                    f"  ~ {money(item.get('_old_total'))} → {money(item.get('_total'))} | {item.get('title')} | {item.get('url')}"
                )
        if changes["gone"]:
            header_bits.append("NO LONGER LISTED:")
            for item in changes["gone"]:
                header_bits.append(
                    f"  - {money(item.get('total'))} | {item.get('title')} | {item.get('url')}"
                )
        header_bits.append("")

    text = "\n".join(header_bits) + grok_body.strip() + "\n"
    text += (
        "\n—\n"
        "Watcher: Alpuca cron · search by grok-delegate ask\n"
        "Targets: Forerunner 145 / 145 Music / 245 / 245 Music · used or refurbished only\n"
        "145: excellent <$70 · good $70–100 · acceptable $100–120\n"
        "245: excellent <$110 · good $110–150 · acceptable $150–180\n"
    )

    rows = []
    for item in listings:
        total = item.get("_total", _total_of(item))
        spec = f"{item.get('model') or '?'} · {item.get('color') or '?'}"
        url = html.escape(str(item.get("url") or ""))
        title = html.escape(str(item.get("title") or "(no title)"))
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(item.get('tier') or ''))}</td>"
            f"<td>{html.escape(money(total))}</td>"
            f"<td>{html.escape(str(item.get('source') or ''))}</td>"
            f"<td>{html.escape(spec)}</td>"
            f"<td>{html.escape(str(item.get('condition') or ''))}</td>"
            f"<td><a href=\"{url}\">{title}</a></td>"
            "</tr>"
        )
    table = (
        "<table border='1' cellpadding='6' cellspacing='0'>"
        "<tr><th>Tier</th><th>Price</th><th>Source</th><th>Model</th><th>Condition</th><th>Listing</th></tr>"
        + "".join(rows)
        + "</table>"
        if rows
        else "<p>No spec-matching listings this run.</p>"
    )
    pre = html.escape(text)
    html_body = (
        "<html><body>"
        f"{table}"
        "<hr>"
        f"<pre style='font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap'>{pre}</pre>"
        "</body></html>"
    )
    return text, html_body


def send_email(subject: str, text: str, html_body: str) -> str:
    key = RESEND_KEY_FILE.read_text().strip()
    if not key:
        raise RuntimeError(f"empty Resend key at {RESEND_KEY_FILE}")
    body = json.dumps(
        {
            "from": FROM_EMAIL,
            "to": [TO_EMAIL],
            "subject": subject,
            "text": text,
            "html": html_body,
        }
    ).encode()
    req = urllib.request.Request(RESEND_URL, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "AlpacApps-Garmin-Deal-Watch/1")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Resend HTTP {exc.code}: {detail}") from exc
    log(f"resend ok: {raw}")
    return raw


def send_failure(mode: str, err: str) -> None:
    subject = f"Garmin Forerunner watcher FAILED ({mode})"
    text = (
        f"The {mode} Garmin Forerunner deal watch run failed.\n\n"
        f"{err}\n\n"
        "Log: /Users/alpuca/logs/garmin-watch-deal-watch.log\n"
    )
    html_body = f"<pre>{html.escape(text)}</pre>"
    try:
        send_email(subject, text, html_body)
    except Exception as mail_exc:
        log(f"also failed to send failure email: {mail_exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Garmin Forerunner deal watcher")
    parser.add_argument("mode", choices=["morning", "evening"], nargs="?", default="morning")
    parser.add_argument("--dry-run", action="store_true", help="search and print, do not email")
    parser.add_argument(
        "--reuse-last",
        action="store_true",
        help="skip Grok and reuse ~/.garmin-watch-deal-watch/last-grok.md",
    )
    args = parser.parse_args()
    mode = args.mode

    log(f"start mode={mode} dry_run={args.dry_run}")
    try:
        if args.reuse_last:
            if not LAST_GROK_FILE.exists():
                raise FileNotFoundError(f"no cached Grok output at {LAST_GROK_FILE}")
            grok_text = LAST_GROK_FILE.read_text()
            log(f"reusing {LAST_GROK_FILE}")
        else:
            grok_text = run_grok(PROMPT_FILE)

        grok_body, payload = parse_grok(grok_text)
        listings = list(payload.get("listings") or [])
        log(
            f"parsed {len(listings)} matches, "
            f"{len(payload.get('near_misses') or [])} near-misses, "
            f"{len(payload.get('source_notes') or [])} source notes"
        )

        state = load_state()
        seen = state.setdefault("seen", {})
        fp = fingerprint(listings)
        changes = classify_changes(listings, seen)

        changed = fp != state.get("last_fingerprint")
        log(
            f"fingerprint={fp[:12]} last={str(state.get('last_fingerprint') or '')[:12]} "
            f"changed={changed} new={len(changes['new'])} "
            f"price={len(changes['price_changes'])} gone={len(changes['gone'])}"
        )

        should_mail = True
        if mode == "evening" and not changed:
            should_mail = False
            log("evening run unchanged — skipping email")

        text, html_body = build_email(mode, grok_body, payload, changes)
        subject = subject_line(mode, listings, changes)

        if args.dry_run:
            print("\n===== SUBJECT =====")
            print(subject)
            print("\n===== BODY =====")
            print(text)
            should_mail = False

        if should_mail:
            send_email(subject, text, html_body)
        else:
            log("no email sent")

        state["last_fingerprint"] = fp
        state["last_run"] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "mode": mode,
            "match_count": len(listings),
            "emailed": bool(should_mail and not args.dry_run),
            "subject": subject if should_mail else None,
        }
        # Drop listings not seen in 30 days to keep state small.
        cutoff_keep = 200
        if len(seen) > cutoff_keep:
            ordered = sorted(seen.items(), key=lambda kv: kv[1].get("last_seen") or "")
            for lid, _ in ordered[: len(seen) - cutoff_keep]:
                seen.pop(lid, None)
        save_state(state)
        log("done")
        return 0
    except subprocess.TimeoutExpired:
        err = f"grok-delegate timed out after {GROK_TIMEOUT_SEC}s"
        log(err)
        if not args.dry_run:
            send_failure(mode, err)
        return 2
    except Exception as exc:
        log(f"ERROR: {exc}")
        if not args.dry_run:
            send_failure(mode, str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
