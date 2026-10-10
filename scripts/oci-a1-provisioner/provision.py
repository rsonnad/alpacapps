#!/usr/bin/env python3
"""
OCI Always Free A1 provisioner — one launch attempt per invocation.

launchd (com.alpuca.oci-a1-provisioner) runs `provision.py run` every
StartInterval seconds. Each run is short-lived: it checks state, makes at most
one LaunchInstance call, records the outcome, and exits. There is no long-lived
loop, so a crash, reboot or sleep simply means the next tick picks up again.

Subcommands:
  run      one attempt (what launchd calls)
  check    validate config, auth, home region, subnet, image, ADs — no launch
  status   print the state file in human-readable form
  reset    clear a fatal/expired/backoff state so `run` resumes

Full docs: scripts/oci-a1-provisioner/README.md
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import platform
import subprocess
import sys
import urllib.request
import uuid
from pathlib import Path

SHAPE = "VM.Standard.A1.Flex"
DEFAULT_CONFIG = Path("~/.config/oci-a1-provisioner/config.env").expanduser()
DEFAULT_STATE_DIR = Path("~/.local/state/oci-a1-provisioner").expanduser()
LOG_MAX_BYTES = 2 * 1024 * 1024
CACHE_TTL_DAYS = 7
MAX_CONSECUTIVE_UNKNOWN = 6
MAX_CONSECUTIVE_CRASHES = 10
BACKOFF_BASE_S = 120
BACKOFF_MAX_S = 3600
LEGACY_MARKER = Path("~/.oracle-provisioned").expanduser()

# Outcome categories. Anything FATAL_* stops the job until `reset`.
SUCCESS = "success"
CAPACITY = "capacity"          # "Out of host capacity" — the expected steady state
THROTTLED = "throttled"        # 429
TRANSIENT = "transient"        # network / other 5xx / 409
UNKNOWN = "unknown"
FATAL_LIMIT = "fatal_limit"    # LimitExceeded / QuotaExceeded — free quota already used
FATAL_AUTH = "fatal_auth"      # 401
FATAL_CONFIG = "fatal_config"  # 400 / 404 — bad OCID, wrong region, bad params

FATAL = {FATAL_LIMIT, FATAL_AUTH, FATAL_CONFIG}


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

REQUIRED_KEYS = ("REGION", "COMPARTMENT_ID", "SUBNET_ID", "SSH_PUBLIC_KEY_FILE")
DEFAULTS = {
    "OCI_CONFIG_FILE": "~/.oci/config",
    "OCI_PROFILE": "DEFAULT",
    "DISPLAY_NAME": "alpacapps-workers",
    "OCPUS": "4",
    "MEMORY_GB": "24",
    "BOOT_VOLUME_GB": "200",
    "IMAGE_ID": "",
    "UBUNTU_VERSION": "24.04",
    "REQUIRE_HOME_REGION": "true",
    "MAX_DAYS": "90",
    "HEARTBEAT_DAYS": "7",
    "RESEND_API_KEY": "",
    "NOTIFY_EMAIL": "",
    "NOTIFY_FROM": "noreply@alpacaplayhouse.com",
}


def load_config(path: Path) -> dict:
    """Parse a shell-style KEY=VALUE file. Inline `# comments` are stripped."""
    cfg = dict(DEFAULTS)
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        val = val.split(" #", 1)[0].strip().strip('"').strip("'")
        cfg[key.strip()] = val
    missing = [k for k in REQUIRED_KEYS if not cfg.get(k)]
    if missing:
        raise SystemExit(f"config {path}: missing {', '.join(missing)}")
    for k in ("OCI_CONFIG_FILE", "SSH_PUBLIC_KEY_FILE"):
        cfg[k] = str(Path(cfg[k]).expanduser())
    return cfg


def truthy(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------
# State + log (single source of truth: state.json)
# --------------------------------------------------------------------------

class Store:
    def __init__(self, state_dir: Path):
        self.dir = state_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.dir / "state.json"
        self.log_path = self.dir / "provisioner.log"

    def load(self) -> dict:
        if not self.state_path.exists():
            return {"status": "active", "attempts": 0, "counts": {}, "cache": {}}
        try:
            return json.loads(self.state_path.read_text())
        except ValueError:
            # Corrupt state: keep it for forensics, start fresh. The idempotency
            # check against OCI still prevents a duplicate launch.
            self.state_path.rename(self.state_path.with_suffix(f".corrupt-{int(now().timestamp())}"))
            self.log({"event": "state_corrupt_reset"})
            return {"status": "active", "attempts": 0, "counts": {}, "cache": {}}

    def save(self, state: dict) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
        os.replace(tmp, self.state_path)

    def log(self, entry: dict) -> None:
        entry = {"ts": iso(now()), **entry}
        line = json.dumps(entry, sort_keys=True)
        print(line, flush=True)
        with open(self.log_path, "a") as f:
            f.write(line + "\n")
        if self.log_path.stat().st_size > LOG_MAX_BYTES:
            data = self.log_path.read_bytes()[-LOG_MAX_BYTES // 2:]
            self.log_path.write_bytes(data[data.find(b"\n") + 1:])


# --------------------------------------------------------------------------
# Error classification
# --------------------------------------------------------------------------

def classify(exc: BaseException) -> tuple[str, str]:
    """Map an exception from a LaunchInstance call to an outcome category."""
    import oci  # local import: keeps `status` fast and tests patchable

    if isinstance(exc, oci.exceptions.ServiceError):
        status, code, msg = exc.status, exc.code or "", exc.message or ""
        detail = f"{status} {code}: {msg}"[:300]
        if "out of host capacity" in msg.lower() or "out of capacity" in msg.lower():
            return CAPACITY, detail
        if status == 429:
            return THROTTLED, detail
        if code in ("LimitExceeded", "QuotaExceeded"):
            return FATAL_LIMIT, detail
        if status == 401:
            return FATAL_AUTH, detail
        if status in (400, 404):
            return FATAL_CONFIG, detail
        if status == 409 or status >= 500:
            return TRANSIENT, detail
        return UNKNOWN, detail

    transient_types: tuple = (oci.exceptions.RequestException, ConnectionError, TimeoutError)
    try:
        import requests
        transient_types += (requests.exceptions.RequestException,)
    except ImportError:
        pass
    if isinstance(exc, transient_types):
        return TRANSIENT, f"{type(exc).__name__}: {exc}"[:300]
    return UNKNOWN, f"{type(exc).__name__}: {exc}"[:300]


def backoff_seconds(consecutive_failures: int) -> int:
    return min(BACKOFF_BASE_S * (2 ** max(consecutive_failures - 1, 0)), BACKOFF_MAX_S)


# --------------------------------------------------------------------------
# OCI access (thin wrapper so tests can inject a fake)
# --------------------------------------------------------------------------

class OciGateway:
    def __init__(self, cfg: dict):
        import oci

        self.oci = oci
        conf = oci.config.from_file(cfg["OCI_CONFIG_FILE"], cfg["OCI_PROFILE"])
        conf["region"] = cfg["REGION"]
        self.tenancy = conf["tenancy"]
        # No SDK-level retries: retry policy lives in this script's state machine,
        # one launch per tick, so the SDK must not multiply calls.
        kw = {"retry_strategy": oci.retry.NoneRetryStrategy(), "timeout": (10, 60)}
        self.compute = oci.core.ComputeClient(conf, **kw)
        self.network = oci.core.VirtualNetworkClient(conf, **kw)
        self.identity = oci.identity.IdentityClient(conf, **kw)

    def _all(self, fn, *args, **kwargs):
        return self.oci.pagination.list_call_get_all_results(fn, *args, **kwargs).data

    def home_region(self) -> str:
        subs = self.identity.list_region_subscriptions(self.tenancy).data
        return next(s.region_name for s in subs if s.is_home_region)

    def availability_domains(self, compartment_id: str) -> list[str]:
        return [ad.name for ad in self.identity.list_availability_domains(compartment_id).data]

    def subnet(self, subnet_id: str):
        return self.network.get_subnet(subnet_id).data

    def latest_ubuntu_image(self, compartment_id: str, version: str) -> tuple[str, str]:
        images = self._all(
            self.compute.list_images, compartment_id,
            operating_system="Canonical Ubuntu", operating_system_version=version,
            shape=SHAPE, lifecycle_state="AVAILABLE",
            sort_by="TIMECREATED", sort_order="DESC",
        )
        if not images:
            raise RuntimeError(f"no Canonical Ubuntu {version} image compatible with {SHAPE}")
        return images[0].id, images[0].display_name

    def live_instances(self, compartment_id: str, display_name: str) -> list:
        insts = self._all(self.compute.list_instances, compartment_id, display_name=display_name)
        return [i for i in insts if i.lifecycle_state not in ("TERMINATED", "TERMINATING")]

    def launch(self, cfg: dict, ad: str, image_id: str, ssh_key: str):
        m = self.oci.core.models
        details = m.LaunchInstanceDetails(
            availability_domain=ad,
            compartment_id=cfg["COMPARTMENT_ID"],
            shape=SHAPE,
            shape_config=m.LaunchInstanceShapeConfigDetails(
                ocpus=float(cfg["OCPUS"]), memory_in_gbs=float(cfg["MEMORY_GB"])),
            display_name=cfg["DISPLAY_NAME"],
            source_details=m.InstanceSourceViaImageDetails(
                image_id=image_id, boot_volume_size_in_gbs=int(cfg["BOOT_VOLUME_GB"])),
            create_vnic_details=m.CreateVnicDetails(subnet_id=cfg["SUBNET_ID"], assign_public_ip=True),
            metadata={"ssh_authorized_keys": ssh_key},
            freeform_tags={"managed-by": "oci-a1-provisioner"},
        )
        return self.compute.launch_instance(details, opc_retry_token=uuid.uuid4().hex).data

    def wait_running_and_ip(self, compartment_id: str, instance_id: str) -> str | None:
        self.oci.wait_until(
            self.compute, self.compute.get_instance(instance_id),
            "lifecycle_state", "RUNNING", max_wait_seconds=600, max_interval_seconds=15)
        atts = self.compute.list_vnic_attachments(compartment_id, instance_id=instance_id).data
        if not atts:
            return None
        return self.network.get_vnic(atts[0].vnic_id).data.public_ip


# --------------------------------------------------------------------------
# Notifications (best-effort; never fail a run)
# --------------------------------------------------------------------------

def notify(cfg: dict, store: Store, title: str, body: str) -> None:
    store.log({"event": "notify", "title": title, "body": body})
    if platform.system() == "Darwin":
        safe = lambda s: s.replace('"', "'")
        subprocess.run(
            ["osascript", "-e", f'display notification "{safe(body)}" with title "{safe(title)}" sound name "Glass"'],
            check=False, capture_output=True)
    if cfg.get("RESEND_API_KEY") and cfg.get("NOTIFY_EMAIL"):
        payload = json.dumps({
            "from": cfg["NOTIFY_FROM"], "to": [cfg["NOTIFY_EMAIL"]],
            "subject": f"[oci-a1-provisioner] {title}", "text": body,
        }).encode()
        req = urllib.request.Request(
            "https://api.resend.com/emails", data=payload, method="POST",
            headers={"Authorization": f"Bearer {cfg['RESEND_API_KEY']}", "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=15).read()
        except Exception as e:  # noqa: BLE001 — notification is best-effort
            store.log({"event": "notify_failed", "error": str(e)[:200]})


def unload_launchd_job(store: Store) -> None:
    """After a terminal outcome, stop launchd from waking us every tick."""
    label = os.environ.get("PROVISIONER_LAUNCHD_LABEL")
    if not label or platform.system() != "Darwin":
        return
    store.log({"event": "launchd_bootout", "label": label})
    # Detached: bootout terminates this process's job; state is already saved.
    subprocess.Popen(["launchctl", "bootout", f"gui/{os.getuid()}/{label}"], start_new_session=True)


# --------------------------------------------------------------------------
# Core: one attempt
# --------------------------------------------------------------------------

def cached(state: dict, key: str, fetch):
    entry = state.setdefault("cache", {}).get(key)
    fresh_until = parse_iso(entry["at"]) + dt.timedelta(days=CACHE_TTL_DAYS) if entry else None
    if entry and fresh_until > now():
        return entry["value"]
    value = fetch()
    state["cache"][key] = {"value": value, "at": iso(now())}
    return value


def finish(cfg, store, state, status, title, body):
    state["status"] = status
    state["finished_at"] = iso(now())
    store.save(state)
    notify(cfg, store, title, body)
    unload_launchd_job(store)


def run_once(cfg: dict, store: Store, gw_factory=OciGateway) -> str:
    state = store.load()
    t = now()

    if state["status"] != "active":
        return state["status"]  # done / fatal / expired: silent no-op until reset

    started = parse_iso(state.get("first_attempt_at"))
    if started and int(cfg["MAX_DAYS"]) > 0 and t - started > dt.timedelta(days=int(cfg["MAX_DAYS"])):
        finish(cfg, store, state, "expired", "Gave up",
               f"No A1 capacity in {cfg['REGION']} after {cfg['MAX_DAYS']} days, "
               f"{state['attempts']} attempts. See README 'If it never lands'. "
               f"Resume with: provision.py reset")
        return "expired"

    next_after = parse_iso(state.get("next_attempt_after"))
    if next_after and t < next_after:
        return "backoff"

    gw = gw_factory(cfg)

    # Idempotency: an instance with our name already exists (earlier success whose
    # response we lost, a manual console launch, or the legacy script) -> done.
    existing = gw.live_instances(cfg["COMPARTMENT_ID"], cfg["DISPLAY_NAME"])
    if existing:
        inst = existing[0]
        state["instance"] = {"id": inst.id, "state": inst.lifecycle_state, "found_existing": True}
        store.log({"event": "existing_instance", "id": inst.id, "state": inst.lifecycle_state})
        finish(cfg, store, state, "done", "Instance already exists",
               f"{cfg['DISPLAY_NAME']} ({inst.lifecycle_state}) {inst.id}. Provisioner stopped.")
        return "done"

    if truthy(cfg["REQUIRE_HOME_REGION"]):
        home = cached(state, "home_region", gw.home_region)
        if home != cfg["REGION"]:
            finish(cfg, store, state, "fatal", "Wrong region",
                   f"Tenancy home region is {home}; Always Free A1 only exists there, not in "
                   f"{cfg['REGION']}. Fix REGION/SUBNET_ID or set REQUIRE_HOME_REGION=false.")
            return "fatal"

    image_id = cfg["IMAGE_ID"] or cached(
        state, f"image:{cfg['REGION']}:{cfg['UBUNTU_VERSION']}",
        lambda: gw.latest_ubuntu_image(cfg["COMPARTMENT_ID"], cfg["UBUNTU_VERSION"])[0])
    ads = cached(state, f"ads:{cfg['REGION']}", lambda: gw.availability_domains(cfg["COMPARTMENT_ID"]))
    ad = ads[state.get("ad_index", 0) % len(ads)]
    state["ad_index"] = (state.get("ad_index", 0) + 1) % len(ads)
    ssh_key = Path(cfg["SSH_PUBLIC_KEY_FILE"]).read_text().strip()

    state["attempts"] = state.get("attempts", 0) + 1
    state.setdefault("first_attempt_at", iso(t))
    state["last_attempt_at"] = iso(t)

    try:
        inst = gw.launch(cfg, ad, image_id, ssh_key)
    except Exception as exc:  # noqa: BLE001 — classified below
        category, detail = classify(exc)
    else:
        category, detail = SUCCESS, inst.id

    counts = state.setdefault("counts", {})
    counts[category] = counts.get(category, 0) + 1
    state["last_result"] = {"at": iso(t), "category": category, "detail": detail, "ad": ad}
    store.log({"event": "attempt", "n": state["attempts"], "ad": ad, "category": category, "detail": detail})

    if category == SUCCESS:
        # Persist "done" before waiting, so a crash mid-wait can never relaunch.
        state["status"] = "done"
        state["instance"] = {"id": inst.id, "ad": ad, "launched_at": iso(t)}
        store.save(state)
        try:
            ip = gw.wait_running_and_ip(cfg["COMPARTMENT_ID"], inst.id)
        except Exception as e:  # noqa: BLE001
            ip = None
            store.log({"event": "post_launch_wait_failed", "error": str(e)[:200]})
        state["instance"]["public_ip"] = ip
        finish(cfg, store, state, "done", "A1 instance created",
               f"{cfg['DISPLAY_NAME']} in {cfg['REGION']} {ad}\nID: {inst.id}\nIP: {ip or 'pending'}\n"
               f"SSH: ssh -i {cfg['SSH_PUBLIC_KEY_FILE'].removesuffix('.pub')} ubuntu@{ip or '<ip>'}\n"
               f"After {state['attempts']} attempts.")
        return "done"

    if category in FATAL:
        state["fatal"] = {"category": category, "detail": detail}
        finish(cfg, store, state, "fatal", f"Stopped: {category}",
               f"{detail}\nFix the cause, then: provision.py check && provision.py reset")
        return "fatal"

    if category == CAPACITY:
        state["consecutive_failures"] = 0
        state["consecutive_unknown"] = 0
        state.pop("next_attempt_after", None)
    else:
        state["consecutive_failures"] = state.get("consecutive_failures", 0) + 1
        if category == UNKNOWN:
            state["consecutive_unknown"] = state.get("consecutive_unknown", 0) + 1
            if state["consecutive_unknown"] >= MAX_CONSECUTIVE_UNKNOWN:
                state["fatal"] = {"category": UNKNOWN, "detail": detail}
                finish(cfg, store, state, "fatal", "Stopped: repeated unknown errors",
                       f"{MAX_CONSECUTIVE_UNKNOWN} unclassified errors in a row. Last: {detail}")
                return "fatal"
        wait = backoff_seconds(state["consecutive_failures"])
        state["next_attempt_after"] = iso(t + dt.timedelta(seconds=wait))

    # Heartbeat so a months-long retry loop is never forgotten.
    last_hb = parse_iso(state.get("last_heartbeat_at")) or parse_iso(state["first_attempt_at"])
    if t - last_hb >= dt.timedelta(days=int(cfg["HEARTBEAT_DAYS"])):
        state["last_heartbeat_at"] = iso(t)
        store.save(state)
        notify(cfg, store, "Still trying",
               f"{state['attempts']} attempts since {state['first_attempt_at']} in {cfg['REGION']}. "
               f"Outcomes: {json.dumps(counts, sort_keys=True)}")
    store.save(state)
    return category


# --------------------------------------------------------------------------
# check / status / reset
# --------------------------------------------------------------------------

def run_check(cfg: dict, store: Store, gw_factory=OciGateway) -> int:
    ok = True

    def report(good: bool, label: str, info: str = "") -> None:
        nonlocal ok
        ok &= good
        print(f"  [{'ok' if good else 'FAIL'}] {label}{(' — ' + info) if info else ''}")

    print(f"Checking config for {cfg['DISPLAY_NAME']} in {cfg['REGION']}")
    key = Path(cfg["SSH_PUBLIC_KEY_FILE"])
    report(key.is_file() and key.read_text().startswith(("ssh-", "ecdsa-")), "SSH public key", str(key))
    if LEGACY_MARKER.exists():
        report(False, "legacy marker",
               f"{LEGACY_MARKER} exists: the old script reported success. Check the OCI console "
               "for an existing A1 instance, then delete the marker.")
    try:
        gw = gw_factory(cfg)
        report(True, "OCI auth", f"profile {cfg['OCI_PROFILE']}")
    except Exception as e:  # noqa: BLE001
        report(False, "OCI auth", str(e)[:200])
        return 1

    steps = [
        ("home region", lambda: gw.home_region(),
         lambda v: (v == cfg["REGION"] or not truthy(cfg["REQUIRE_HOME_REGION"]),
                    f"{v}" + ("" if v == cfg["REGION"] else f" ≠ {cfg['REGION']} (Always Free A1 needs home region)"))),
        ("availability domains", lambda: gw.availability_domains(cfg["COMPARTMENT_ID"]),
         lambda v: (bool(v), ", ".join(v))),
        ("subnet", lambda: gw.subnet(cfg["SUBNET_ID"]),
         lambda v: (not v.prohibit_public_ip_on_vnic,
                    f"{v.display_name} {v.cidr_block}" + (" — PRIVATE subnet, no public IP" if v.prohibit_public_ip_on_vnic else ""))),
        ("image", lambda: (cfg["IMAGE_ID"], "pinned") if cfg["IMAGE_ID"]
         else gw.latest_ubuntu_image(cfg["COMPARTMENT_ID"], cfg["UBUNTU_VERSION"]),
         lambda v: (True, f"{v[1]} {v[0]}")),
        ("no existing instance", lambda: gw.live_instances(cfg["COMPARTMENT_ID"], cfg["DISPLAY_NAME"]),
         lambda v: (not v, "none" if not v else f"{v[0].id} {v[0].lifecycle_state} — run would mark done")),
    ]
    for label, fetch, judge in steps:
        try:
            good, info = judge(fetch())
        except Exception as e:  # noqa: BLE001
            good, info = False, str(e)[:200]
        report(good, label, info)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


def run_status(store: Store) -> int:
    s = store.load()
    print(json.dumps({k: v for k, v in s.items() if k != "cache"}, indent=2, sort_keys=True))
    return 0


def run_reset(store: Store) -> int:
    s = store.load()
    if s.get("status") == "done":
        print("State is 'done' (an instance exists). Not resetting; delete state.json deliberately if you mean it.")
        return 1
    for k in ("fatal", "next_attempt_after", "finished_at"):
        s.pop(k, None)
    s.update(status="active", consecutive_failures=0, consecutive_unknown=0)
    if s.get("first_attempt_at"):
        s["first_attempt_at"] = iso(now())  # restart the MAX_DAYS window
    store.save(s)
    store.log({"event": "reset"})
    print("Reset to active.")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["run", "check", "status", "reset"])
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    p.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    a = p.parse_args(argv)
    store = Store(a.state_dir)

    if a.command == "status":
        return run_status(store)
    if a.command == "reset":
        return run_reset(store)

    cfg = load_config(a.config)
    if a.command == "check":
        return run_check(cfg, store)

    lock = open(store.dir / "run.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return 0  # previous tick still running
    try:
        run_once(cfg, store)
    except Exception as e:  # noqa: BLE001 — never crash-loop launchd silently
        record_crash(cfg, store, e)
        return 1
    s = store.load()
    if s.get("consecutive_crashes"):
        s["consecutive_crashes"] = 0
        store.save(s)
    return 0


def record_crash(cfg: dict, store: Store, exc: BaseException) -> None:
    """Failures outside the launch call (auth, list calls, bad key file).
    Network blips/throttling back off like launch errors; anything else is counted
    so a broken setup stops and notifies instead of failing silently forever."""
    category, error = classify(exc)
    store.log({"event": "run_crashed", "category": category, "error": error})
    s = store.load()
    if s.get("status") != "active":
        return
    if category in (TRANSIENT, THROTTLED):
        s["consecutive_failures"] = s.get("consecutive_failures", 0) + 1
        wait = backoff_seconds(s["consecutive_failures"])
        s["next_attempt_after"] = iso(now() + dt.timedelta(seconds=wait))
        store.save(s)
        return
    s["consecutive_crashes"] = s.get("consecutive_crashes", 0) + 1
    if s["consecutive_crashes"] >= MAX_CONSECUTIVE_CRASHES:
        s["fatal"] = {"category": "crash", "detail": error}
        finish(cfg, store, s, "fatal", "Stopped: run keeps crashing",
               f"{MAX_CONSECUTIVE_CRASHES} crashed runs in a row. Last: {error}\n"
               "Run: provision.py check")
    else:
        store.save(s)


if __name__ == "__main__":
    sys.exit(main())
