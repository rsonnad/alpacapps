# Kiosk Tablet Setup — Runbook

> **Run from Alpuca** (this machine, `100.74.59.97`). Alpuca is on Tailscale and can reach the tablet directly.

## Target: entry-alpaca-tablet

| Field | Value |
|-------|-------|
| **Tailscale Hostname** | `entry-alpaca-tablet` |
| **Tailscale IP** | `100.103.110.7` |
| **Model** | Samsung Galaxy Tab A9 (SM-X210) |
| **ADB Serial** | `R95Y301R05A` |
| **Fully Kiosk API** | port `2323`, password `alpaca2323` |
| **Kiosk Exit Password** | `1234` (triple-tap bottom-right) |
| **Kiosk URL** | `https://alpacaplayhouse.com/kiosks/hall/` |

## Prompt

Paste this into a Claude Code session running directly on Alpuca (not the web sandbox):

---

The hallway kiosk tablet is **entry-alpaca-tablet** at Tailscale IP `100.103.110.7`. It runs Fully Kiosk Browser displaying the hall kiosk page. The kiosk rotates through 3 views every 15 seconds: guestbook, UniFi network dashboard (popup), and AI alpaca slideshow. The UniFi dashboard needs a logged-in session to show useful data.

### Step 1 — Verify connectivity

```bash
# Confirm tablet is reachable via Tailscale
tailscale ping 100.103.110.7

# Try the Fully Kiosk Browser REST API
curl -s "http://100.103.110.7:2323/?cmd=getDeviceInfo&password=alpaca2323" | head -30
```

### Step 2 — If Fully Kiosk API fails, use ADB

```bash
# Make sure wireless debugging is on: tablet Settings → Developer Options → Wireless Debugging → ON
adb connect 100.103.110.7:5555
adb devices
# If pairing is needed: adb pair 100.103.110.7:<pair-port>  (use code shown on tablet)
```

### Step 3 — Load UniFi dashboard on the tablet

```bash
# Via Fully Kiosk API (preferred)
curl "http://100.103.110.7:2323/?cmd=loadUrl&url=https%3A%2F%2F192.168.1.1%2Fnetwork%2Fdefault%2Fdashboard&password=alpaca2323"

# Via ADB (fallback)
adb shell am start -a android.intent.action.VIEW -d 'https://192.168.1.1/network/default/dashboard'
```

### Step 4 — Log in on the tablet screen

- **Username:** `alpacaauto`
- **Password:** check `HOMEAUTOMATION.local.md` (gitignored) or Bitwarden
- **Check "Remember me"** so the session persists ~24 hours

### Step 5 — Return the tablet to the kiosk

```bash
curl "http://100.103.110.7:2323/?cmd=loadUrl&url=https%3A%2F%2Falpacaplayhouse.com%2Fkiosks%2Fhall%2F&password=alpaca2323"
```

### Step 6 — Verify rotation

Wait ~45 seconds and watch the tablet cycle through:
1. Guestbook/occupants/alpaca facts (15s)
2. UniFi dashboard popup showing logged-in network stats (15s)
3. AI alpaca slideshow (15s)

## Useful Fully Kiosk API Commands

```bash
# Screenshot (JPEG)
curl -o /tmp/kiosk.jpg "http://100.103.110.7:2323/?cmd=getScreenshot&password=alpaca2323"

# Wake screen
curl "http://100.103.110.7:2323/?cmd=screenOn&password=alpaca2323"

# Restart kiosk app
curl "http://100.103.110.7:2323/?cmd=restartApp&password=alpaca2323"

# Reload current page
curl "http://100.103.110.7:2323/?cmd=reload&password=alpaca2323"

# Device info (battery, wifi, screen state)
curl -s "http://100.103.110.7:2323/?cmd=getDeviceInfo&password=alpaca2323" | python3 -m json.tool
```

## Persist Tablet Settings After Samsung OS Updates

```bash
adb connect 100.103.110.7:5555
adb shell dumpsys deviceidle whitelist +com.tailscale.ipn
adb shell cmd appops set com.tailscale.ipn RUN_IN_BACKGROUND allow
adb shell settings put global auto_update 0
adb shell pm disable-user --user 0 com.sec.android.soagent
adb shell pm disable-user --user 0 com.sec.android.app.samsungapps
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `tailscale ping` fails | Check Tailscale is up on Alpuca: `tailscale status`. Restart if needed. |
| Fully Kiosk API not responding | Exit kiosk (triple-tap bottom-right, pw `1234`) → Fully Kiosk settings → Remote Administration → Enable, port `2323`, pw `alpaca2323`. |
| ADB refuses connection | Enable Wireless Debugging on tablet (Settings → Developer Options). Pair first if needed. |
| UniFi popup blocked | Allow popups for `alpacaplayhouse.com` in tablet browser settings. |
| UniFi session expired | Repeat steps 3-4 to log in again. |
| Blank kiosk screen | Run the Step 5 reload command. |

Full setup instructions page: `alpacaplayhouse.com/kiosks/hall/setup.html`
