# Alpaca Playhouse — Custom Android Kiosk App

## Overview

Build a native Android app for the Samsung tablet mounted in the front hallway of Alpaca Playhouse. The app replaces the current browser-based kiosk (`/kioskhall/`) with a native WebView wrapper that adds hardware access, remote control, and future extensibility (photo booth, NFC, etc.).

**Device:** Samsung tablet (Android), mounted in front hall
**Current solution:** Samsung browser loading `https://alpacaplayhouse.com/kioskhall/`
**Target:** Native Android app (Kotlin) with WebView + native features

---

## Why Custom App Instead of Fully Kiosk Browser

- **Full Android API access** — camera, NFC, Bluetooth, sensors, background services
- **Photo booth / guest book** — planned feature requiring native camera control
- **No license fee** — Fully Kiosk is $7/device, custom is free
- **Tighter integration** — can talk to Supabase natively, not just via browser JS
- **Future-proof** — any native feature we want, we can add

---

## Phase 1: Core Kiosk (MVP)

### 1.1 WebView Container
- Full-screen WebView loading `https://alpacaplayhouse.com/kioskhall/`
- No browser chrome (no URL bar, no back button, no nav)
- Hardware back button disabled
- WebView settings: JavaScript enabled, DOM storage, media playback without gesture
- Handle offline gracefully (show cached page or "No connection" message)
- Auto-reload page on network reconnect

### 1.2 Kiosk Lockdown
- Use Android's `LOCK_TASK` mode (screen pinning) to prevent users from leaving the app
- The app should be set as the device owner (via ADB `dpm set-device-owner`) so LOCK_TASK works without user confirmation
- Disable: status bar pull-down, recent apps, home button
- Auto-launch on boot (BOOT_COMPLETED receiver)
- Auto-restart if the app crashes (use `Thread.setDefaultUncaughtExceptionHandler`)

### 1.3 Built-in HTTP Server for Remote Control
Run a lightweight HTTP server (e.g., NanoHTTPD or Ktor) on port `2323` so Claude Code and other tools can control the tablet remotely.

**Required endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Device info: battery %, charging, WiFi SSID, signal strength, screen on/off, uptime, app version |
| GET | `/screenshot` | Returns current screen as JPEG |
| POST | `/reload` | Reload the WebView URL |
| POST | `/navigate?url=X` | Load a different URL in the WebView |
| POST | `/screen/on` | Wake screen |
| POST | `/screen/off` | Turn screen off |
| POST | `/brightness?level=N` | Set screen brightness (0-255) |
| POST | `/reboot` | Reboot the device (requires device owner) |
| POST | `/js` | Execute JavaScript in the WebView, body = JS string, returns result |
| GET | `/ping` | Simple health check, returns `{"ok":true}` |

**Security:** Simple password query param (e.g., `?pw=SECRET`). The tablet is on a local network behind a router, so this is adequate. Store password in app SharedPreferences, configurable via a hidden settings screen.

### 1.4 Hidden Settings Screen
- Triple-tap the bottom-right corner of the screen to open settings
- Password-protected (separate from the HTTP API password)
- Settings:
  - Start URL (default: `https://alpacaplayhouse.com/kioskhall/`)
  - HTTP API port (default: 2323)
  - HTTP API password
  - Screen timeout (minutes, 0 = always on)
  - Wake on motion (use proximity sensor)
  - Auto-restart interval (hours, 0 = disabled)
  - Exit kiosk mode (returns to normal Android, requires password)

---

## Phase 2: Photo Booth / Guest Book

### 2.1 Photo Booth Mode
- Triggered via the HTTP API (`POST /mode/photobooth`) or from the kiosk webpage via a JavaScript bridge
- Opens the front-facing camera full-screen
- Countdown timer (3, 2, 1) with visual overlay
- Snap photo
- Optional: fun overlays/frames (alpaca ears, Alpaca Playhouse branding)
- Preview the photo with "Retake" / "Save" buttons

### 2.2 Guest Book Integration
- Saved photos upload to Supabase Storage (`housephotos/guestbook/YYYY-MM-DD_HHmmss.jpg`)
- Insert a row into a `guestbook_entries` table:
  - `id` (UUID)
  - `photo_url` (text)
  - `guest_name` (text, optional — typed on a soft keyboard overlay)
  - `message` (text, optional)
  - `created_at` (timestamptz)
- Guest book gallery viewable on the kiosk itself and on the admin site

### 2.3 JavaScript Bridge
Expose a `window.AlpacaKiosk` object to the WebView so the kiosk webpage can trigger native features:

```javascript
window.AlpacaKiosk.openPhotoBoooth()     // launch camera
window.AlpacaKiosk.getDeviceInfo()        // battery, wifi, etc.
window.AlpacaKiosk.setBrightness(200)     // adjust screen
window.AlpacaKiosk.vibrate(500)           // haptic feedback
window.AlpacaKiosk.playSound('shutter')   // play a sound
```

---

## Phase 3: Future Features (Not in Scope Yet)

These are documented for context but should NOT be built yet:

- **NFC check-in** — Guest taps phone to tablet, records arrival in Supabase
- **Bluetooth proximity** — Detect nearby devices, auto-greet returning guests
- **Intercom** — Two-way audio to other tablets or a phone
- **Local notifications** — Alerts for events, maintenance reminders
- **Supabase Realtime** — Replace 60-second polling with instant push updates via native Supabase SDK

---

## Technical Details

### Project Structure
```
alpaca-kiosk/                    # Separate repo or subfolder — TBD
├── app/
│   ├── src/main/
│   │   ├── java/com/alpacaplayhouse/kiosk/
│   │   │   ├── MainActivity.kt          # WebView + kiosk lock
│   │   │   ├── KioskWebViewClient.kt    # URL handling, error pages
│   │   │   ├── HttpApiServer.kt         # NanoHTTPD remote control
│   │   │   ├── DeviceAdmin.kt           # Device owner receiver
│   │   │   ├── BootReceiver.kt          # Auto-start on boot
│   │   │   ├── SettingsActivity.kt      # Hidden settings screen
│   │   │   └── JsBridge.kt              # window.AlpacaKiosk interface
│   │   ├── res/
│   │   │   ├── layout/
│   │   │   ├── values/
│   │   │   └── xml/device_admin.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
└── settings.gradle.kts
```

### Dependencies
- **NanoHTTPD** (`org.nanohttpd:nanohttpd:2.3.1`) — lightweight HTTP server
- **AndroidX WebKit** — modern WebView APIs
- **Supabase Android SDK** (Phase 2 only) — for storage uploads

### Min SDK & Target
- `minSdk`: 26 (Android 8.0 — covers all Samsung tablets from 2018+)
- `targetSdk`: 34 (Android 14)

### Building
- Gradle build produces an APK
- Side-load via ADB: `adb install alpaca-kiosk.apk`
- No Play Store distribution needed

### Device Setup (One-Time via ADB)
```bash
# Connect via USB or WiFi ADB
adb connect <tablet-ip>:5555

# Install the app
adb install alpaca-kiosk.apk

# Set as device owner (enables LOCK_TASK without prompts)
adb shell dpm set-device-owner com.alpacaplayhouse.kiosk/.DeviceAdmin

# Verify
adb shell dpm list-owners
```

---

## Existing Kiosk Web Content

The app loads the existing web kiosk at `https://alpacaplayhouse.com/kioskhall/`. This page displays:

- **Current Herd** — active occupants with names, room assignments, "new" badges
- **Upcoming Events** — next 3 approved events with dates and times
- **Weather** — live Austin weather via OpenWeatherMap (10-min cache)
- **Alpaca Fact of the Day** — generated daily via Supabase edge function
- **PAI Query Count** — AI interactions in the last 24 hours
- **Live Clock** — Austin timezone (America/Chicago)
- Auto-refreshes every 60 seconds

The web content stays on GitHub Pages — the Android app is just the container. All data changes happen by editing the web files in the `kioskhall/` folder of the main repo.

There is also a TV variant (`/kioskhall/tv.html`) used for larger displays with modes: dashboard, cameras, signage, slideshow. The Android app should be able to load any URL, but defaults to the tablet view.

---

## Existing Display Infrastructure

The `displays` database table tracks registered displays:
- Garage Mahal TV — dashboard mode
- Dining Room Hisense TV — cameras mode (Alpacamera, Front Of House, Side Yard)

The front hall tablet should be added to this table once the app is deployed:
```sql
INSERT INTO displays (name, display_type, mode, config, is_active)
VALUES ('Front Hall Tablet', 'tablet', 'dashboard',
        '{"url": "https://alpacaplayhouse.com/kioskhall/"}', true);
```

---

## Integration with Claude Code

Once deployed, add the tablet's API to `memory/service-access.md` so any Claude Code session can control it:

```bash
# Health check
curl http://<tablet-ip>:2323/ping?pw=SECRET

# Screenshot
curl http://<tablet-ip>:2323/screenshot?pw=SECRET -o tablet.jpg

# Reload page
curl -X POST http://<tablet-ip>:2323/reload?pw=SECRET

# Check battery
curl http://<tablet-ip>:2323/status?pw=SECRET
```

If Tailscale is installed on the tablet, use the Tailscale IP for access from anywhere.

---

## Decision Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-03-13 | Custom app over Fully Kiosk Browser | Need native camera for photo booth, NFC potential, full Android API access, no license cost |
| 2026-03-13 | Kotlin + WebView approach | Keeps existing web kiosk content, adds native layer only where needed |
| 2026-03-13 | NanoHTTPD for remote API | Lightweight, well-tested, no external dependencies |
| 2026-03-13 | Phase 1 first, photo booth later | Get the kiosk locked down and remotely controllable before adding camera features |
