#!/usr/bin/env python3
"""
Archive a PDF copy of every executed e-signature document to Cloudflare R2.

Why this runs on Alpuca and not in an edge function: rendering the executed
agreement faithfully — its CSS, page breaks, and the signature PNGs — needs a
real browser engine, and Supabase edge functions are Deno with no browser.
Alpuca has Chrome, so it does the rendering.

Why it's a sweeper rather than part of the signing request: a signer must never
be blocked because a renderer is offline. `process-signature` still treats the
HTML archive as fatal (that's the legal record), while the PDF is produced out
of band. Anything missed — Alpuca asleep, network down — is simply still in the
queue on the next pass, so a document cannot end up permanently without a PDF.

The document itself is fetched from the `archival-document` edge function, not
assembled here, so the PDF can never drift from the HTML the parties signed.

Covers every document type in signature_audit_log: rental leases, event
agreements, and waivers.

Config: ~/.signed-pdf-archiver.env (chmod 600). Keychain/Bitwarden are not
reachable from cron on macOS, hence a plaintext env file — same convention as
the other Alpuca cron jobs.
"""

import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ENV_FILE = os.path.expanduser("~/.signed-pdf-archiver.env")
MAX_ATTEMPTS = 5          # stop hammering a row that is structurally broken
BATCH = int(os.environ.get("ARCHIVER_BATCH", "25"))
RENDER_TIMEOUT = 180      # seconds; big leases are ~18 pages


def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def load_env():
    cfg = {}
    with open(ENV_FILE) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip("'\"")
    return cfg


# ── Supabase REST ────────────────────────────────────────────────────────────

def sb_request(cfg, method, path, body=None, prefer=None):
    url = f"{cfg['SUPABASE_URL']}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", cfg["SUPABASE_SERVICE_KEY"])
    req.add_header("Authorization", f"Bearer {cfg['SUPABASE_SERVICE_KEY']}")
    req.add_header("Content-Type", "application/json")
    # api.supabase.co sits behind Cloudflare, which 403s the default
    # Python-urllib User-Agent (error code 1010).
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AlpacApps-PDF-Archiver")
    if prefer:
        req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def fetch_queue(cfg):
    """Signings that have retained HTML but no PDF yet."""
    q = (
        "signature_audit_log"
        "?select=id,document_type,rental_application_id,event_hosting_request_id,"
        "signing_version,signed_at,signer_name,archival_pdf_attempts"
        "&archival_pdf_url=is.null"
        "&signer_role=eq.tenant"
        "&document_html=not.is.null"
        f"&archival_pdf_attempts=lt.{MAX_ATTEMPTS}"
        "&order=signed_at.asc"
        f"&limit={BATCH}"
    )
    return sb_request(cfg, "GET", q)


def fetch_archival_html(cfg, audit_id):
    url = f"{cfg['SUPABASE_URL']}/functions/v1/archival-document?audit_id={audit_id}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {cfg['SUPABASE_SERVICE_KEY']}")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AlpacApps-PDF-Archiver")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def mark_success(cfg, audit_id, url):
    sb_request(cfg, "PATCH", f"signature_audit_log?id=eq.{audit_id}", {
        "archival_pdf_url": url,
        "archival_pdf_generated_at": datetime.now(timezone.utc).isoformat(),
        "archival_pdf_error": None,
    }, prefer="return=minimal")


def mark_failure(cfg, audit_id, attempts, err):
    sb_request(cfg, "PATCH", f"signature_audit_log?id=eq.{audit_id}", {
        "archival_pdf_error": str(err)[:500],
        "archival_pdf_attempts": attempts + 1,
    }, prefer="return=minimal")


# ── Rendering ────────────────────────────────────────────────────────────────

def render_pdf(html_bytes):
    """Headless Chrome HTML -> PDF. Returns PDF bytes.

    Waits on the *output file*, not on process exit. With a private
    --user-data-dir, Chrome on macOS writes the PDF correctly and then lingers
    (its updater/crash-handler children keep the process alive), so waiting for
    exit throws away a perfectly good render. A private profile is still worth
    keeping: it isolates this job from the Chrome the GUI user has open.
    """
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "doc.html")
        out = os.path.join(td, "doc.pdf")
        with open(src, "wb") as fh:
            fh.write(html_bytes)
        # --virtual-time-budget gives the remote signature images time to load;
        # without it Chrome can print before they arrive and silently drop the
        # signatures from a legal document.
        proc = subprocess.Popen([
            CHROME,
            "--headless", "--disable-gpu", "--no-sandbox",
            "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-component-update",
            "--no-pdf-header-footer",
            "--virtual-time-budget=20000",
            "--run-all-compositor-stages-before-draw",
            f"--user-data-dir={os.path.join(td, 'profile')}",
            f"--print-to-pdf={out}",
            f"file://{src}",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        try:
            deadline = time.monotonic() + RENDER_TIMEOUT
            last_size, stable = -1, 0
            while time.monotonic() < deadline:
                if proc.poll() is not None and not os.path.exists(out):
                    err = (proc.stderr.read() or b"").decode()[-300:]
                    raise RuntimeError(f"Chrome exited without a PDF: {err}")
                if os.path.exists(out):
                    size = os.path.getsize(out)
                    # Two consecutive identical non-zero sizes means Chrome has
                    # finished streaming the file out.
                    stable = stable + 1 if size == last_size and size > 0 else 0
                    last_size = size
                    if stable >= 2:
                        break
                time.sleep(0.5)
            else:
                raise RuntimeError(f"Chrome did not produce a PDF within {RENDER_TIMEOUT}s")
        finally:
            # Chrome may never exit on its own; don't leak it.
            if proc.poll() is None:
                proc.kill()
                try:
                    proc.wait(timeout=15)
                except Exception:
                    pass

        with open(out, "rb") as fh:
            pdf = fh.read()
        if not pdf.startswith(b"%PDF"):
            raise RuntimeError("Output is not a PDF")
        # A signed lease that rendered to a blank/near-empty page is a silent
        # data-loss bug; refuse it so the row stays queued and visible.
        if len(pdf) < 5000:
            raise RuntimeError(f"PDF suspiciously small ({len(pdf)} bytes)")
        return pdf


# ── R2 upload (S3 SigV4) ─────────────────────────────────────────────────────

def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def upload_r2(cfg, key, body, content_type="application/pdf"):
    account = cfg["R2_ACCOUNT_ID"]
    bucket = cfg["R2_BUCKET"]
    host = f"{account}.r2.cloudflarestorage.com"
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    canonical_uri = "/" + bucket + "/" + "/".join(
        urllib.parse.quote(seg, safe="") for seg in key.split("/")
    )
    payload_hash = hashlib.sha256(body).hexdigest()
    headers = {
        "content-type": content_type,
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = "\n".join(
        ["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    k_date = _sign(("AWS4" + cfg["R2_SECRET_ACCESS_KEY"]).encode(), date_stamp)
    k_region = _sign(k_date, "auto")
    k_service = _sign(k_region, "s3")
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={cfg['R2_ACCESS_KEY_ID']}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req = urllib.request.Request(f"https://{host}{canonical_uri}", data=body, method="PUT")
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header("Authorization", auth)
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status not in (200, 201):
            raise RuntimeError(f"R2 upload returned {resp.status}")
    return f"{cfg['R2_PUBLIC_URL'].rstrip('/')}/{key}"


def object_key(row):
    app_id = row.get("rental_application_id") or row.get("event_hosting_request_id") or row["id"]
    doc_type = row.get("document_type") or "document"
    version = row.get("signing_version") or 1
    day = (row.get("signed_at") or "")[:10] or "undated"
    return f"signed-documents/{doc_type}/{day}-{app_id}-v{version}.pdf"


def main():
    if not os.path.exists(CHROME):
        log(f"FATAL: Chrome not found at {CHROME}")
        return 1
    cfg = load_env()

    try:
        queue = fetch_queue(cfg)
    except Exception as e:
        log(f"FATAL: could not read queue: {e}")
        return 1

    if not queue:
        log("nothing to archive")
        return 0

    log(f"{len(queue)} document(s) to archive")
    ok = failed = 0
    for row in queue:
        rid = row["id"]
        label = f"{row.get('document_type')} {row.get('signer_name')} v{row.get('signing_version')}"
        try:
            html = fetch_archival_html(cfg, rid)
            pdf = render_pdf(html)
            key = object_key(row)
            url = upload_r2(cfg, key, pdf)
            mark_success(cfg, rid, url)
            ok += 1
            log(f"  OK   {label} -> {key} ({len(pdf)} bytes)")
        except Exception as e:
            failed += 1
            log(f"  FAIL {label} ({rid}): {e}")
            try:
                mark_failure(cfg, rid, row.get("archival_pdf_attempts") or 0, e)
            except Exception as e2:
                log(f"       could not record failure: {e2}")

    log(f"done: {ok} archived, {failed} failed")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
