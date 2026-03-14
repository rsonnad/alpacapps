#!/usr/bin/env python3
"""AIClaw HomeGraph Controller

Connects to Google HomeGraph API via service account to discover
and query smart home devices at the property.

Usage:
    python homegraph.py                    # List all devices
    python homegraph.py --agent-user USER  # Specify agent user ID
    python homegraph.py --device DEVICE_ID # Query a specific device
"""

import argparse
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# HomeGraph API config
HOMEGRAPH_SCOPES = ["https://www.googleapis.com/auth/homegraph"]
HOMEGRAPH_SERVICE = "homegraph"
HOMEGRAPH_VERSION = "v1"

DEFAULT_KEY_PATH = Path(__file__).parent / "service-account.json"


def load_credentials(key_path: str | Path = DEFAULT_KEY_PATH) -> service_account.Credentials:
    """Load and return scoped service account credentials."""
    key_path = Path(key_path)
    if not key_path.exists():
        print(f"Error: Service account key not found at {key_path}", file=sys.stderr)
        print("Place your GCS JSON key as 'service-account.json' in this directory.", file=sys.stderr)
        sys.exit(1)

    credentials = service_account.Credentials.from_service_account_file(
        str(key_path),
        scopes=HOMEGRAPH_SCOPES,
    )
    return credentials


def get_homegraph_service(credentials: service_account.Credentials):
    """Build and return the HomeGraph API service client."""
    return build(HOMEGRAPH_SERVICE, HOMEGRAPH_VERSION, credentials=credentials)


def sync_devices(service, agent_user_id: str) -> dict:
    """Request a devices.sync to discover all devices for a user.

    The HomeGraph Sync call returns the full list of devices that your
    smart home Action has reported for the given agentUserId.
    """
    body = {"agentUserId": agent_user_id}
    try:
        response = service.devices().sync(body=body).execute()
        return response
    except HttpError as e:
        print(f"HomeGraph Sync failed: {e.status_code} — {e.reason}", file=sys.stderr)
        if e.status_code == 404:
            print(
                "Hint: No devices found. Make sure your smart home Action is linked "
                "and has reported devices for this agentUserId.",
                file=sys.stderr,
            )
        elif e.status_code == 403:
            print(
                "Hint: Permission denied. Verify the service account has the "
                "'Service Account Token Creator' role and HomeGraph API is enabled.",
                file=sys.stderr,
            )
        raise


def query_device(service, agent_user_id: str, device_ids: list[str]) -> dict:
    """Query the current state of specific devices."""
    body = {
        "agentUserId": agent_user_id,
        "inputs": [
            {
                "payload": {
                    "devices": [{"id": did} for did in device_ids],
                }
            }
        ],
    }
    try:
        response = service.devices().query(body=body).execute()
        return response
    except HttpError as e:
        print(f"HomeGraph Query failed: {e.status_code} — {e.reason}", file=sys.stderr)
        raise


def report_state(service, agent_user_id: str, device_id: str, states: dict) -> dict:
    """Report device state back to HomeGraph (for future use)."""
    body = {
        "agentUserId": agent_user_id,
        "payload": {
            "devices": {
                "states": {
                    device_id: states,
                }
            }
        },
    }
    try:
        response = service.devices().reportStateAndNotification(body=body).execute()
        return response
    except HttpError as e:
        print(f"HomeGraph ReportState failed: {e.status_code} — {e.reason}", file=sys.stderr)
        raise


# ── Pretty Printers ──────────────────────────────────────────────


def print_device_list(sync_response: dict) -> None:
    """Print a clean, formatted list of devices from a sync response."""
    payload = sync_response.get("payload", {})
    devices = payload.get("devices", [])

    if not devices:
        print("No devices found.")
        return

    print(f"\n{'='*60}")
    print(f" AIClaw — {len(devices)} Device(s) Discovered")
    print(f"{'='*60}\n")

    for i, device in enumerate(devices, 1):
        device_id = device.get("id", "unknown")
        device_type = device.get("type", "unknown").split(".")[-1]
        name = device.get("name", {})
        display_name = name.get("name", name.get("defaultNames", ["Unnamed"])[0])
        room = device.get("roomHint", "—")
        traits = device.get("traits", [])
        trait_names = [t.split(".")[-1] for t in traits]
        manufacturer = device.get("deviceInfo", {}).get("manufacturer", "—")
        model = device.get("deviceInfo", {}).get("model", "—")

        print(f"  {i}. {display_name}")
        print(f"     Type:         {device_type}")
        print(f"     ID:           {device_id}")
        print(f"     Room:         {room}")
        print(f"     Manufacturer: {manufacturer}")
        print(f"     Model:        {model}")
        print(f"     Traits:       {', '.join(trait_names) if trait_names else '—'}")

        # Show custom data if present
        custom = device.get("customData")
        if custom:
            print(f"     Custom Data:  {json.dumps(custom, indent=2)}")

        print()


def print_device_states(query_response: dict) -> None:
    """Print device states from a query response."""
    payload = query_response.get("payload", {})
    devices = payload.get("devices", {})

    if not devices:
        print("No device states returned.")
        return

    print(f"\n{'='*60}")
    print(f" AIClaw — Device States")
    print(f"{'='*60}\n")

    for device_id, state in devices.items():
        status = state.pop("status", "UNKNOWN")
        online = state.pop("online", None)
        error_code = state.pop("errorCode", None)

        print(f"  Device: {device_id}")
        print(f"  Status: {status}", end="")
        if online is not None:
            print(f"  |  Online: {'Yes' if online else 'No'}", end="")
        if error_code:
            print(f"  |  Error: {error_code}", end="")
        print()

        if state:
            for key, value in state.items():
                print(f"    {key}: {json.dumps(value) if isinstance(value, (dict, list)) else value}")
        print()


# ── CLI ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="AIClaw — HomeGraph smart home device controller",
    )
    parser.add_argument(
        "--key",
        default=str(DEFAULT_KEY_PATH),
        help="Path to service account JSON key (default: ./service-account.json)",
    )
    parser.add_argument(
        "--agent-user",
        default="alpacapps-user-1",
        help="The agentUserId registered with your smart home Action",
    )
    parser.add_argument(
        "--device",
        nargs="+",
        help="Query specific device(s) by ID instead of syncing all",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print raw JSON response instead of formatted output",
    )
    args = parser.parse_args()

    # Initialize
    print("Initializing AIClaw HomeGraph controller...")
    credentials = load_credentials(args.key)
    service = get_homegraph_service(credentials)
    print(f"  Project:    {credentials.project_id}")
    print(f"  Account:    {credentials.service_account_email}")
    print(f"  Agent User: {args.agent_user}")

    try:
        if args.device:
            # Query specific devices
            print(f"\nQuerying {len(args.device)} device(s)...")
            response = query_device(service, args.agent_user, args.device)
            if args.raw:
                print(json.dumps(response, indent=2))
            else:
                print_device_states(response)
        else:
            # Full sync — discover all devices
            print("\nRequesting devices.sync...")
            response = sync_devices(service, args.agent_user)
            if args.raw:
                print(json.dumps(response, indent=2))
            else:
                print_device_list(response)
    except HttpError:
        sys.exit(1)


if __name__ == "__main__":
    main()
