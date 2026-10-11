"""Unit tests for provision.py — no network, no OCI account.

Run: ~/.venvs/oci-a1-provisioner/bin/python -m pytest scripts/oci-a1-provisioner/tests -q
"""
import datetime as dt
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from oci.exceptions import RequestException, ServiceError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import provision as p  # noqa: E402


def svc(status, code, msg=""):
    return ServiceError(status, code, {}, msg)


class FakeGateway:
    def __init__(self, launch_results, existing=(), home="ca-montreal-1"):
        self.launch_results = list(launch_results)
        self.existing = list(existing)
        self.home = home
        self.launch_calls = []

    def __call__(self, cfg):  # acts as gw_factory
        return self

    def home_region(self):
        return self.home

    def availability_domains(self, _):
        return ["xyz:CA-MONTREAL-1-AD-1"]

    def latest_ubuntu_image(self, *_):
        return "ocid1.image.test", "Canonical-Ubuntu-24.04-aarch64"

    def live_instances(self, *_):
        return self.existing

    def launch(self, cfg, ad, image_id, ssh_key):
        self.launch_calls.append(ad)
        r = self.launch_results.pop(0)
        if isinstance(r, BaseException):
            raise r
        return r

    def wait_running_and_ip(self, *_):
        return "203.0.113.7"


@pytest.fixture
def env(tmp_path, monkeypatch):
    key = tmp_path / "k.pub"
    key.write_text("ssh-ed25519 AAAA test")
    cfg = dict(p.DEFAULTS, REGION="ca-montreal-1", COMPARTMENT_ID="ocid1.tenancy.x",
               SUBNET_ID="ocid1.subnet.x", SSH_PUBLIC_KEY_FILE=str(key))
    store = p.Store(tmp_path / "state")
    notes = []
    monkeypatch.setattr(p, "notify", lambda c, s, title, body: notes.append(title))
    monkeypatch.setattr(p, "unload_launchd_job", lambda s: None)
    return cfg, store, notes


@pytest.mark.parametrize("exc,expected", [
    (svc(500, "InternalError", "Out of host capacity."), p.CAPACITY),
    (svc(429, "TooManyRequests"), p.THROTTLED),
    (svc(400, "LimitExceeded", "standard-a1-core-count"), p.FATAL_LIMIT),
    (svc(400, "QuotaExceeded"), p.FATAL_LIMIT),
    (svc(401, "NotAuthenticated"), p.FATAL_AUTH),
    (svc(404, "NotAuthorizedOrNotFound"), p.FATAL_CONFIG),
    (svc(400, "InvalidParameter"), p.FATAL_CONFIG),
    (svc(409, "IncorrectState"), p.TRANSIENT),
    (svc(503, "ServiceUnavailable"), p.TRANSIENT),
    (RequestException("conn reset"), p.TRANSIENT),
    (ConnectionError("dns"), p.TRANSIENT),
    (ValueError("weird"), p.UNKNOWN),
])
def test_classify(exc, expected):
    assert p.classify(exc)[0] == expected


def test_capacity_keeps_trying(env):
    cfg, store, notes = env
    gw = FakeGateway([svc(500, "InternalError", "Out of host capacity.")] * 3)
    for _ in range(3):
        assert p.run_once(cfg, store, gw) == p.CAPACITY
    s = store.load()
    assert s["status"] == "active" and s["attempts"] == 3 and "next_attempt_after" not in s
    assert notes == []


def test_success_marks_done_and_stops(env):
    cfg, store, notes = env
    gw = FakeGateway([SimpleNamespace(id="ocid1.instance.new")])
    assert p.run_once(cfg, store, gw) == "done"
    s = store.load()
    assert s["status"] == "done" and s["instance"]["public_ip"] == "203.0.113.7"
    assert notes == ["A1 instance created"]
    # Subsequent ticks are no-ops: no further launch calls.
    assert p.run_once(cfg, store, gw) == "done"
    assert len(gw.launch_calls) == 1


def test_existing_instance_is_idempotent(env):
    cfg, store, notes = env
    gw = FakeGateway([], existing=[SimpleNamespace(id="ocid1.instance.old", lifecycle_state="RUNNING")])
    assert p.run_once(cfg, store, gw) == "done"
    assert gw.launch_calls == []
    assert store.load()["instance"]["found_existing"] is True


def test_limit_exceeded_is_fatal(env):
    cfg, store, notes = env
    gw = FakeGateway([svc(400, "LimitExceeded")])
    assert p.run_once(cfg, store, gw) == "fatal"
    assert store.load()["fatal"]["category"] == p.FATAL_LIMIT
    assert p.run_once(cfg, store, gw) == "fatal"  # stays stopped
    assert len(gw.launch_calls) == 1


def test_wrong_home_region_is_fatal_before_launch(env):
    cfg, store, notes = env
    gw = FakeGateway([], home="us-phoenix-1")
    assert p.run_once(cfg, store, gw) == "fatal"
    assert gw.launch_calls == [] and notes == ["Wrong region"]


def test_home_region_check_can_be_disabled(env):
    cfg, store, notes = env
    cfg["REQUIRE_HOME_REGION"] = "false"
    gw = FakeGateway([svc(500, "InternalError", "Out of host capacity.")], home="us-phoenix-1")
    assert p.run_once(cfg, store, gw) == p.CAPACITY


def test_throttle_backs_off_then_skips(env):
    cfg, store, notes = env
    gw = FakeGateway([svc(429, "TooManyRequests")])
    assert p.run_once(cfg, store, gw) == p.THROTTLED
    assert store.load()["next_attempt_after"]
    assert p.run_once(cfg, store, gw) == "backoff"
    assert len(gw.launch_calls) == 1


def test_backoff_growth():
    assert [p.backoff_seconds(n) for n in (1, 2, 3, 10)] == [120, 240, 480, 3600]


def test_repeated_unknown_becomes_fatal(env, monkeypatch):
    cfg, store, notes = env
    gw = FakeGateway([ValueError("?")] * p.MAX_CONSECUTIVE_UNKNOWN)
    for i in range(p.MAX_CONSECUTIVE_UNKNOWN):
        s = store.load()
        s.pop("next_attempt_after", None)  # simulate backoff elapsing
        store.save(s)
        result = p.run_once(cfg, store, gw)
    assert result == "fatal"


def test_max_days_expires(env):
    cfg, store, notes = env
    old = p.iso(p.now() - dt.timedelta(days=91))
    store.save({"status": "active", "attempts": 5, "counts": {}, "cache": {}, "first_attempt_at": old})
    gw = FakeGateway([])
    assert p.run_once(cfg, store, gw) == "expired"
    assert gw.launch_calls == []


def test_heartbeat_after_interval(env):
    cfg, store, notes = env
    old = p.iso(p.now() - dt.timedelta(days=8))
    store.save({"status": "active", "attempts": 5, "counts": {}, "cache": {}, "first_attempt_at": old})
    gw = FakeGateway([svc(500, "InternalError", "Out of host capacity.")] * 2)
    p.run_once(cfg, store, gw)
    p.run_once(cfg, store, gw)
    assert notes == ["Still trying"]  # once, not every tick


def test_reset_refuses_when_done(env):
    cfg, store, notes = env
    store.save({"status": "done", "attempts": 1, "counts": {}, "cache": {}})
    assert p.run_reset(store) == 1
    store.save({"status": "fatal", "fatal": {}, "attempts": 1, "counts": {}, "cache": {}})
    assert p.run_reset(store) == 0 and store.load()["status"] == "active"


def test_repeated_crashes_become_fatal(env):
    cfg, store, notes = env
    for _ in range(p.MAX_CONSECUTIVE_CRASHES):
        p.record_crash(cfg, store, FileNotFoundError("~/.oci/config"))
    assert store.load()["status"] == "fatal"
    assert notes == ["Stopped: run keeps crashing"]


def test_network_crashes_back_off_but_never_go_fatal(env):
    cfg, store, notes = env
    for _ in range(p.MAX_CONSECUTIVE_CRASHES * 3):
        p.record_crash(cfg, store, RequestException("no route to host"))
    s = store.load()
    assert s["status"] == "active" and s["next_attempt_after"]
    assert not s.get("consecutive_crashes") and notes == []


def test_config_parsing(tmp_path):
    f = tmp_path / "c.env"
    f.write_text('# c\nREGION=ca-montreal-1  # home\nCOMPARTMENT_ID="ocid1.t"\n'
                 "SUBNET_ID=ocid1.s\nSSH_PUBLIC_KEY_FILE=~/k.pub\nOCPUS=2\n")
    c = p.load_config(f)
    assert c["REGION"] == "ca-montreal-1" and c["COMPARTMENT_ID"] == "ocid1.t"
    assert c["OCPUS"] == "2" and c["MEMORY_GB"] == "24"
    assert not c["SSH_PUBLIC_KEY_FILE"].startswith("~")


def test_corrupt_state_recovers(env):
    cfg, store, notes = env
    store.state_path.write_text("{not json")
    assert store.load()["status"] == "active"
    assert list(store.dir.glob("state.corrupt-*"))
