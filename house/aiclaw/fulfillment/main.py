"""AIClaw Smart Home Fulfillment — Google Cloud Function

Handles SYNC, QUERY, and EXECUTE intents from Google Home / HomeGraph.
Reads device state from Supabase and translates to Google Smart Home format.

Deploy:
    gcloud functions deploy aiclaw-fulfillment \
        --runtime python312 \
        --trigger-http \
        --allow-unauthenticated \
        --entry-point fulfillment \
        --project aiclaw-486101 \
        --region us-central1 \
        --set-env-vars SUPABASE_URL=https://aphrrfprbixmhissnjfn.supabase.co,SUPABASE_KEY=<anon-key>
"""

import json
import os
import logging
from typing import Any

import functions_framework
from flask import Request, jsonify
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aiclaw")

# ── Config ───────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://aphrrfprbixmhissnjfn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
AGENT_USER_ID = os.environ.get("AGENT_USER_ID", "alpacapps-user-1")


def supabase_get(table: str, params: dict | None = None) -> list[dict]:
    """Fetch rows from a Supabase table via REST API."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.get(url, headers=headers, params=params or {}, timeout=10)
    resp.raise_for_status()
    return resp.json()


# ── Device Mappers ───────────────────────────────────────────────
# Each mapper returns a list of Google Smart Home device dicts.


def map_nest_devices() -> list[dict]:
    """Map Nest thermostats → action.devices.types.THERMOSTAT"""
    rows = supabase_get("nest_devices", {"is_active": "eq.true"})
    devices = []
    for row in rows:
        device = {
            "id": f"nest-{row['id']}",
            "type": "action.devices.types.THERMOSTAT",
            "traits": [
                "action.devices.traits.TemperatureSetting",
            ],
            "name": {"name": row.get("room_name", "Thermostat")},
            "roomHint": row.get("room_name", ""),
            "willReportState": False,
            "deviceInfo": {
                "manufacturer": "Google Nest",
                "model": row.get("device_type", "Thermostat"),
            },
            "attributes": {
                "availableThermostatModes": ["off", "heat", "cool", "heatcool"],
                "thermostatTemperatureUnit": "F",
            },
        }
        devices.append(device)
    return devices


def map_govee_devices() -> list[dict]:
    """Map Govee smart lights → action.devices.types.LIGHT"""
    rows = supabase_get("govee_devices", {
        "is_active": "eq.true",
        "is_group": "eq.true",
    })
    devices = []
    for row in rows:
        device = {
            "id": f"govee-{row['id']}",
            "type": "action.devices.types.LIGHT",
            "traits": [
                "action.devices.traits.OnOff",
                "action.devices.traits.Brightness",
                "action.devices.traits.ColorSetting",
            ],
            "name": {"name": row.get("name", "Light")},
            "roomHint": row.get("area", ""),
            "willReportState": False,
            "deviceInfo": {
                "manufacturer": "Govee",
                "model": row.get("sku", ""),
            },
            "attributes": {
                "colorModel": "rgb",
            },
        }
        devices.append(device)
    return devices


def map_lg_appliances() -> list[dict]:
    """Map LG washer/dryer → action.devices.types.WASHER / DRYER"""
    rows = supabase_get("lg_appliances", {"is_active": "eq.true"})
    devices = []
    for row in rows:
        device_type = row.get("device_type", "washer")
        google_type = (
            "action.devices.types.WASHER"
            if device_type == "washer"
            else "action.devices.types.DRYER"
        )
        device = {
            "id": f"lg-{row['id']}",
            "type": google_type,
            "traits": [
                "action.devices.traits.OnOff",
                "action.devices.traits.RunCycle",
            ],
            "name": {"name": row.get("name", device_type.title())},
            "roomHint": "Laundry",
            "willReportState": False,
            "deviceInfo": {
                "manufacturer": "LG",
                "model": row.get("model", ""),
            },
        }
        devices.append(device)
    return devices


def map_camera_streams() -> list[dict]:
    """Map Ubiquiti cameras → action.devices.types.CAMERA (unique cameras only)"""
    rows = supabase_get("camera_streams", {
        "is_active": "eq.true",
        "quality": "eq.high",
    })
    devices = []
    seen = set()
    for row in rows:
        name = row.get("camera_name", "Camera")
        if name in seen:
            continue
        seen.add(name)
        device = {
            "id": f"camera-{row['id']}",
            "type": "action.devices.types.CAMERA",
            "traits": [
                "action.devices.traits.CameraStream",
            ],
            "name": {"name": name},
            "roomHint": row.get("location", ""),
            "willReportState": False,
            "deviceInfo": {
                "manufacturer": "Ubiquiti",
                "model": "UniFi Protect",
            },
            "attributes": {
                "cameraStreamSupportedProtocols": ["hls"],
                "cameraStreamNeedAuthToken": False,
            },
        }
        devices.append(device)
    return devices


# ── Intent Handlers ──────────────────────────────────────────────


def handle_sync(request_id: str) -> dict:
    """Return all devices for this agent user."""
    all_devices = []
    for mapper in [map_nest_devices, map_govee_devices, map_lg_appliances, map_camera_streams]:
        try:
            all_devices.extend(mapper())
        except Exception as e:
            logger.error(f"Mapper {mapper.__name__} failed: {e}")

    logger.info(f"SYNC returning {len(all_devices)} devices")
    return {
        "requestId": request_id,
        "payload": {
            "agentUserId": AGENT_USER_ID,
            "devices": all_devices,
        },
    }


def handle_query(request_id: str, inputs: list[dict]) -> dict:
    """Return current state for requested devices."""
    device_states = {}

    requested = []
    for inp in inputs:
        for dev in inp.get("payload", {}).get("devices", []):
            requested.append(dev["id"])

    # Build a lookup of current states from Supabase
    state_cache = _build_state_cache()

    for device_id in requested:
        if device_id in state_cache:
            device_states[device_id] = {
                "status": "SUCCESS",
                "online": True,
                **state_cache[device_id],
            }
        else:
            device_states[device_id] = {
                "status": "ERROR",
                "errorCode": "deviceNotFound",
            }

    return {
        "requestId": request_id,
        "payload": {"devices": device_states},
    }


def _build_state_cache() -> dict[str, dict]:
    """Fetch latest device states from Supabase and map to Google format."""
    cache: dict[str, dict] = {}

    # Nest thermostats
    try:
        for row in supabase_get("nest_devices", {"is_active": "eq.true"}):
            state = row.get("last_state") or {}
            thermostat_mode = "off"
            hvac_status = state.get("hvac_status", "")
            if "HEATING" in hvac_status.upper():
                thermostat_mode = "heat"
            elif "COOLING" in hvac_status.upper():
                thermostat_mode = "cool"

            cache[f"nest-{row['id']}"] = {
                "thermostatMode": thermostat_mode,
                "thermostatTemperatureAmbient": state.get("ambient_temp_f", 70),
                "thermostatTemperatureSetpoint": state.get("target_temp_f", 70),
            }
    except Exception as e:
        logger.error(f"Nest state fetch failed: {e}")

    # Govee lights
    try:
        for row in supabase_get("govee_devices", {"is_active": "eq.true", "is_group": "eq.true"}):
            state = row.get("last_state") or {}
            cache[f"govee-{row['id']}"] = {
                "on": state.get("powerState") == "on" or state.get("on", False),
                "brightness": state.get("brightness", 100),
            }
    except Exception as e:
        logger.error(f"Govee state fetch failed: {e}")

    # LG appliances
    try:
        for row in supabase_get("lg_appliances", {"is_active": "eq.true"}):
            state = row.get("last_state") or {}
            is_running = state.get("run_state", "").upper() in ("RUNNING", "RINSING", "SPINNING", "DRYING")
            cache[f"lg-{row['id']}"] = {
                "on": is_running,
                "currentRunCycle": [{"currentCycle": state.get("current_course", "unknown")}] if is_running else [],
                "currentTotalRemainingTime": state.get("remain_time_minute", 0) * 60,
            }
    except Exception as e:
        logger.error(f"LG state fetch failed: {e}")

    return cache


def handle_execute(request_id: str, inputs: list[dict]) -> dict:
    """Execute commands on devices. Currently read-only — returns status only."""
    results = []

    for inp in inputs:
        for command in inp.get("payload", {}).get("commands", []):
            device_ids = [d["id"] for d in command.get("devices", [])]
            # For now, report that execution is not supported
            # Future: integrate with Govee API, Nest SDM, etc.
            results.append({
                "ids": device_ids,
                "status": "ERROR",
                "errorCode": "notSupported",
                "debugString": "AIClaw is currently read-only. Execute support coming soon.",
            })

    return {
        "requestId": request_id,
        "payload": {"commands": results},
    }


def handle_disconnect(request_id: str) -> dict:
    """Handle account unlinking."""
    logger.info("DISCONNECT received")
    return {"requestId": request_id}


# ── Entry Point ──────────────────────────────────────────────────


INTENT_HANDLERS = {
    "action.devices.SYNC": lambda rid, _: handle_sync(rid),
    "action.devices.QUERY": lambda rid, inputs: handle_query(rid, inputs),
    "action.devices.EXECUTE": lambda rid, inputs: handle_execute(rid, inputs),
    "action.devices.DISCONNECT": lambda rid, _: handle_disconnect(rid),
}


@functions_framework.http
def fulfillment(request: Request):
    """Main Cloud Function entry point for Smart Home fulfillment."""
    body = request.get_json(silent=True) or {}
    request_id = body.get("requestId", "unknown")
    inputs = body.get("inputs", [])

    if not inputs:
        return jsonify({"requestId": request_id, "payload": {}}), 400

    intent = inputs[0].get("intent", "")
    logger.info(f"Intent: {intent} | RequestId: {request_id}")

    handler = INTENT_HANDLERS.get(intent)
    if not handler:
        logger.warning(f"Unknown intent: {intent}")
        return jsonify({"requestId": request_id, "payload": {}}), 400

    result = handler(request_id, inputs)
    return jsonify(result)
