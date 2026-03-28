# Light Control Performance Optimization

> Baseline: ~57s to turn on 2 grill lights and confirm state (2026-03-27).
> Goal: Under 5 seconds for any room, including confirmation.

## Current Bottlenecks

| Bottleneck | Impact | Fix |
|------------|--------|-----|
| Sequential API calls (token → command → verify) | ~20s overhead per backend | Pipeline and cache tokens |
| Python interpreter cold-start per invocation | ~2-3s each | Persistent process or edge function |
| Devices commanded one-at-a-time | Linear scaling with device count | Parallel requests |
| Token fetched every single invocation | Extra round-trip every time | Cache with TTL |
| Three separate bash invocations from CLI | ~5-10s of shell overhead | Single script or edge function |

## Optimizations by Priority

### 1. Cache Tuya Access Tokens (saves ~2s per call)

Tuya tokens are valid for 7200 seconds (2 hours). Cache them instead of fetching every time.

```python
import json, os, time

TOKEN_CACHE = "/tmp/tuya_token.json"

def get_cached_token():
    if os.path.exists(TOKEN_CACHE):
        with open(TOKEN_CACHE) as f:
            cache = json.load(f)
        if cache["expires_at"] > time.time() + 60:  # 60s buffer
            return cache["access_token"]
    token, expires_in = fetch_new_token()
    with open(TOKEN_CACHE, "w") as f:
        json.dump({"access_token": token, "expires_at": time.time() + expires_in}, f)
    return token
```

Same pattern applies to Govee and any other cloud API with long-lived tokens.

### 2. Parallel Device Commands (saves ~1s per additional device)

Send commands to all devices concurrently instead of sequentially.

```python
import asyncio, aiohttp

async def turn_on_devices(device_ids, token):
    async with aiohttp.ClientSession() as session:
        tasks = [send_command(session, dev_id, token) for dev_id in device_ids]
        return await asyncio.gather(*tasks)
```

For the WiZ Proxy, the `/group/power` endpoint already handles multiple IPs in one call — no change needed there.

### 3. Build a Tuya Edge Function (saves ~10-20s total)

Move Tuya control into a Supabase edge function like `govee-control`. This eliminates:
- Python cold-start
- Local signing overhead
- Token caching is server-side and shared across calls

The `home-assistant-control` edge function already routes by backend. Adding `tuya_cloud` as a handler would unify all light control into one endpoint:

```
POST /home-assistant-control
{ "action": "set_power", "group_key": "grill", "power": true }
```

Backend routing already exists for `home_assistant`, `wiz_proxy`, `govee_cloud`. The `tuya_cloud` case just needs a handler.

### 4. Skip Confirmation for Fire-and-Forget (saves ~3-5s)

Most light commands don't need verification. The Tuya API returns `success: true` on the command itself — that's sufficient confirmation. Only verify when debugging or when the user asks.

If confirmation is needed, do it async:
```
command → return "sent" immediately → verify in background → notify if failed
```

### 5. Precompute Signing (saves ~0.5s)

The HMAC-SHA256 signing for Tuya is cheap but adds up. Pre-build the signing function once and reuse it:

```python
import hmac, hashlib
from functools import partial

signer = partial(hmac.new, CLIENT_SECRET.encode(), digestmod=hashlib.sha256)
```

### 6. Use WiZ Proxy for Everything on LAN (saves network hops)

WiZ bulbs on the LAN respond in ~50-100ms via UDP. The WiZ Proxy on Almaca (port 8902) already handles group operations. For any WiZ room, a single HTTP call controls all bulbs:

```bash
# One call, 7 bulbs, ~200ms total
curl -s -X POST http://192.168.1.74:8902/group/power \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ips":[...all IPs...],"on":true}'
```

Tuya and Govee must go through cloud APIs (no local protocol), so they'll always be slower than WiZ.

## Target Architecture

```
CLI / UI
  ↓
home-assistant-control (edge function)
  ↓ routes by backend
  ├── home_assistant → HAOS API (LAN via SSH)
  ├── wiz_proxy     → Almaca:8902 (LAN, ~200ms)
  ├── govee_cloud   → Govee API (cloud, ~1-2s)
  └── tuya_cloud    → Tuya API (cloud, ~1-2s)  ← NOT YET BUILT
```

All backends return a unified response. Token caching and parallel dispatch happen inside the edge function.

## Expected Performance After Optimization

| Scenario | Current | Optimized |
|----------|---------|-----------|
| WiZ room (any size) | ~3-5s | ~1s (already fast) |
| Tuya grill (2 devices) | ~57s | ~2-3s |
| Govee group | ~5-10s | ~2-3s |
| All lights, all backends | N/A | ~3-5s (parallel) |
| With confirmation | +3-5s | +0s (fire-and-forget) or +1s (async verify) |

## Implementation Order

1. **Token caching** — quick win, no infra changes
2. **Parallel commands** — asyncio in existing scripts
3. **Tuya edge function handler** — add `tuya_cloud` case to `home-assistant-control`
4. **Skip confirmation by default** — trust command response
5. **Unified CLI wrapper** — single `lights grill on` command that hits the edge function
