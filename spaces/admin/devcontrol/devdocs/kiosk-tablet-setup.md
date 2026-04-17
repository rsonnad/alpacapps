# Kiosk Tablet Setup — Runbook

> **Run from any Tailscale-connected machine** (rahul-m4-airtop, alpuca, or almaca).
> The Claude Code web sandbox cannot reach the tablet — Tailscale traffic is blocked by the proxy.

## Tailscale Network Reference

| Device | Tailscale IP | Status |
|--------|-------------|--------|
| **entry-alpaca-tablet** (kiosk) | `100.103.110.7` | Usually online |
| **alpuca** (Mac mini M4, home server) | `100.74.59.97` | Always online |
| **rahul-m4-airtop** (M4 MacBook Air) | `100.114.248.79` | When in use |
| **almaca-macbookpro16** (legacy) | `100.115.27.43` | Usually online |

## Claude Code Prompt

Paste this into a Claude Code session on a Tailscale-connected machine:

---

The hallway kiosk tablet (**entry-alpaca-tablet**) is a Samsung Galaxy Tab A9 (SM-X210) wall-mounted in the hallway. It runs Fully Kiosk Browser displaying `alpacaplayhouse.com/kioskhall/`.

### Device Info

- **Tailscale Hostname:** `entry-alpaca-tablet`
- **Tailscale IP:** `100.103.110.7`
- **LAN IP:** DHCP (check UniFi for current lease)
- **ADB Serial:** `R95Y301R05A`
- **Fully Kiosk API:** port `2323`, password `alpaca2323`
- **Kiosk Settings Password:** `1234` (triple-tap bottom-right to exit kiosk mode)
- **WiFi:** Black Rock City

### Task: Set up UniFi dashboard rotation

The kiosk rotates 3 views every 15 seconds: guestbook, UniFi network dashboard (popup), and AI alpaca slideshow. The UniFi dashboard needs to be logged in once so the session cookie persists.

**Step 1 — Verify connectivity:**

```bash
# Test if tablet is reachable
ping -c 2 100.103.110.7

# Try the Fully Kiosk Browser REST API
curl -s "http://100.103.110.7:2323/?cmd=getDeviceInfo&password=alpaca2323" | head -20

# If Fully Kiosk API fails, try ADB wireless debugging
adb connect 100.103.110.7:5555
adb devices
```

**Step 2 — Load UniFi dashboard on the tablet:**

```bash
# Via Fully Kiosk API (preferred — no ADB pairing needed)
curl "http://100.103.110.7:2323/?cmd=loadUrl&url=https%3A%2F%2F192.168.1.1%2Fnetwork%2Fdefault%2Fdashboard&password=alpaca2323"

# Or via ADB (fallback — requires wireless debugging enabled on tablet)
adb shell am start -a android.intent.action.VIEW -d 'https://192.168.1.1/network/default/dashboard'
```

**Step 3 — Log in manually on the tablet screen:**

- **Username:** `alpacaauto`
- **Password:** check `HOMEAUTOMATION.local.md` (gitignored) or Bitwarden
- **Check "Remember me"** so the session persists (~24 hours)

**Step 4 — Return to kiosk:**

```bash
curl "http://100.103.110.7:2323/?cmd=loadUrl&url=https%3A%2F%2Falpacaplayhouse.com%2Fkioskhall%2F&password=alpaca2323"
```

**Step 5 — Verify rotation is working:**

Wait ~45 seconds. The kiosk should cycle through:
1. Guestbook/occupants/alpaca facts (15s)
2. UniFi network dashboard popup (15s)
3. AI alpaca slideshow (15s)

### Other Fully Kiosk API Commands

```bash
# Screenshot (returns JPEG)
curl -o screenshot.jpg "http://100.103.110.7:2323/?cmd=getScreenshot&password=alpaca2323"

# Wake screen
curl "http://100.103.110.7:2323/?cmd=screenOn&password=alpaca2323"

# Restart kiosk app
curl "http://100.103.110.7:2323/?cmd=restartApp&password=alpaca2323"

# Get battery/wifi/screen info
curl -s "http://100.103.110.7:2323/?cmd=getDeviceInfo&password=alpaca2323" | python3 -m json.tool
```

### Persist Tablet Settings After OS Updates

Samsung OS updates reset developer options and battery optimization. Run via ADB:

```bash
adb connect 100.103.110.7:5555
adb shell dumpsys deviceidle whitelist +com.tailscale.ipn
adb shell cmd appops set com.tailscale.ipn RUN_IN_BACKGROUND allow
adb shell settings put global auto_update 0
adb shell pm disable-user --user 0 com.sec.android.soagent
adb shell pm disable-user --user 0 com.sec.android.app.samsungapps
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| **Can't reach tablet** | Check Tailscale is running on both machines: `tailscale status`. Try LAN IP if Tailscale is down. |
| **Fully Kiosk API not responding** | API may be disabled. Exit kiosk (triple-tap bottom-right, pw `1234`), open Fully Kiosk settings → Remote Administration → Enable, port `2323`, pw `alpaca2323`. |
| **ADB not connecting** | Wireless debugging needs re-enabling. Exit kiosk → Settings → Developer Options → Wireless Debugging → ON. Then `adb pair <ip>:<pair-port>` with the code shown. |
| **UniFi popup blocked** | In tablet browser settings, allow popups for `alpacaplayhouse.com`. |
| **UniFi session expired** | Repeat steps 2-4 to log in again. Sessions last ~24 hours. |
| **Blank kiosk screen** | `curl "http://100.103.110.7:2323/?cmd=loadUrl&url=https%3A%2F%2Falpacaplayhouse.com%2Fkioskhall%2F&password=alpaca2323"` |
| **Full setup guide** | `alpacaplayhouse.com/kioskhall/setup.html` |

### Why Claude Code Web Can't Do This

The Claude Code web sandbox runs behind an Envoy proxy that blocks Tailscale CGNAT traffic (`100.x.x.x`). TCP connections appear to succeed but return `503 upstream connect error`. ADB and Fully Kiosk API calls must come from a machine that's actually on the Tailscale network.
