# Alpaca Kiosk — Architecture Guide

> Reference doc for modifying the Android kiosk app. Read this before making changes.

## Overview

Native Android app (Kotlin) that wraps the web kiosk (`alpacaplayhouse.com/kioskhall/`) in a fullscreen WebView with hardware access, remote control API, and a photo booth. Runs on a Samsung tablet mounted in the front hallway.

**Package:** `com.alpacaplayhouse.kiosk`
**Min SDK:** 26 (Android 8.0) | **Target SDK:** 36

---

## File Map

```
alpaca-kiosk/
├── app/src/main/
│   ├── AndroidManifest.xml          # App config, permissions, activities, receivers
│   ├── java/com/alpacaplayhouse/kiosk/
│   │   ├── MainActivity.kt          # Entry point — WebView, fullscreen, kiosk lock, crash handler
│   │   ├── KioskPrefs.kt            # SharedPreferences wrapper for all settings
│   │   ├── KioskWebViewClient.kt    # URL handling, offline page, SSL, scrollbar hiding
│   │   ├── HttpApiServer.kt         # NanoHTTPD server on port 2323 — remote control API
│   │   ├── DeviceAdmin.kt           # Device owner receiver (enables LOCK_TASK)
│   │   ├── BootReceiver.kt          # Auto-launch app on device boot
│   │   ├── SettingsActivity.kt      # Hidden settings screen (triple-tap bottom-right)
│   │   ├── JsBridge.kt              # window.AlpacaKiosk JS interface for WebView
│   │   ├── PhotoBoothActivity.kt    # CameraX front camera with countdown
│   │   └── GuestBookManager.kt      # Supabase Storage upload + DB insert (raw HTTP)
│   └── res/
│       ├── layout/activity_main.xml          # WebView + offline overlay
│       ├── layout/activity_photo_booth.xml   # Camera preview + controls
│       ├── mipmap-*/ic_launcher.png          # App icon (alpaca head on green circle)
│       ├── values/strings.xml                # App name: "Alpaca Kiosk"
│       ├── values/styles.xml                 # Theme (dark, Material, fullscreen variant)
│       ├── xml/device_admin.xml              # Device admin policies
│       └── xml/network_security_config.xml   # Allow cleartext for local network
├── build.gradle.kts                 # Root build (AGP + Kotlin plugin versions)
├── app/build.gradle.kts             # App build (deps, SDK versions, proguard)
├── settings.gradle.kts              # Repo config, dependency resolution
├── gradle.properties                # JVM args, AndroidX, SDK suppression
├── proguard-rules.pro               # Keep rules for NanoHTTPD, JS bridge
├── INSTALL.md                       # Step-by-step tablet setup guide
└── ARCHITECTURE.md                  # This file
```

---

## Component Architecture

### 1. MainActivity.kt — The Core

Everything flows through `MainActivity`. It:

- **Creates the WebView** and configures it (JS enabled, DOM storage, no zoom, wide viewport)
- **Attaches KioskWebViewClient** for URL handling and offline detection
- **Attaches JsBridge** as `window.AlpacaKiosk` JavaScript interface
- **Starts HttpApiServer** on the configured port
- **Enters LOCK_TASK mode** if the app is device owner (kiosk lockdown)
- **Registers network callback** to auto-reload when WiFi reconnects
- **Manages screen timeout** and auto-restart timers
- **Detects triple-tap** on bottom-right corner to open SettingsActivity
- **Disables back/home/recents** keys
- **Sets up crash handler** to auto-restart the app

**Key methods for other components:**
```kotlin
activity.reloadWebView()                    // Reload current URL
activity.navigateTo(url)                    // Load a different URL
activity.executeJavaScript(js) { result ->  // Run JS in WebView
    // result is the return value as a string
}
activity.exitKioskMode()                    // Stop LOCK_TASK
activity.restartHttpServer()                // Restart API on new port
```

### 2. HttpApiServer.kt — Remote Control

Lightweight HTTP server (NanoHTTPD) running on port 2323. All endpoints except `/ping` require `?pw=PASSWORD` query parameter.

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/ping` | Health check — `{"ok":true}` (no auth) |
| GET | `/status` | Battery, WiFi, screen, uptime, app version |
| GET | `/screenshot` | Returns JPEG of current WebView content |
| POST | `/reload` | Reload the WebView |
| POST | `/navigate?url=X` | Load a different URL |
| POST | `/screen/on` | Wake the screen |
| POST | `/screen/off` | Lock/turn off screen |
| POST | `/brightness?level=N` | Set brightness (0-255) |
| POST | `/reboot` | Reboot device (requires device owner) |
| POST | `/js` | Execute JS in WebView (body = JS string) |
| POST | `/mode/photobooth` | Launch PhotoBoothActivity |

**To add a new endpoint:** Add a `when` branch in `serve()`, pattern match on `session.method` and `uri`.

### 3. JsBridge.kt — Web ↔ Native Bridge

Exposes `window.AlpacaKiosk` to JavaScript running in the WebView. Any method annotated with `@JavascriptInterface` is callable from the web page.

**Current methods:**
```javascript
window.AlpacaKiosk.openPhotoBooth()     // Launch camera
window.AlpacaKiosk.getDeviceInfo()      // Returns JSON string
window.AlpacaKiosk.setBrightness(200)   // 0-255
window.AlpacaKiosk.vibrate(500)         // milliseconds
window.AlpacaKiosk.playSound('shutter') // 'shutter' or 'focus'
window.AlpacaKiosk.reload()             // Reload WebView
window.AlpacaKiosk.getAppVersion()      // Returns version string
```

**To add a new JS method:** Add a `@JavascriptInterface` annotated method to `JsBridge.kt`. It's immediately available as `window.AlpacaKiosk.yourMethod()` in the web page.

### 4. KioskWebViewClient.kt — WebView Behavior

Handles:
- **All navigation** stays in the WebView (no external browser)
- **Page load complete** injects CSS to hide scrollbars
- **Load errors** show an offline page (alpaca emoji + "No Connection")
- **SSL errors** proceed for known domains (alpacaplayhouse.com, localhost)

### 5. KioskPrefs.kt — Settings Storage

All settings stored in Android SharedPreferences. Properties:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `startUrl` | String | `https://alpacaplayhouse.com/kioskhall/` | URL to load |
| `httpPort` | Int | `2323` | API server port |
| `httpPassword` | String | `alpaca2323` | API authentication |
| `settingsPassword` | String | `1234` | Settings screen password |
| `screenTimeout` | Int | `0` | Minutes before screen off (0=never) |
| `wakeOnMotion` | Boolean | `false` | Use proximity sensor |
| `autoRestartHours` | Int | `0` | Auto-reload interval (0=disabled) |
| `supabaseUrl` | String | `""` | For guest book uploads |
| `supabaseKey` | String | `""` | Supabase anon key |

**To add a new setting:** Add a property to `KioskPrefs.kt` and a field in `SettingsActivity.kt`.

### 6. PhotoBoothActivity.kt — Camera

Uses CameraX (front camera). Flow:
1. Camera preview fills screen
2. User taps "Take Photo"
3. 3-2-1 countdown with pulse animation
4. Flash overlay + shutter sound
5. Photo captured, mirrored (front cam), rotation-corrected
6. Preview shown with Retake / Save buttons
7. Save uploads to Supabase via GuestBookManager

### 7. GuestBookManager.kt — Supabase Integration

Uses raw `HttpURLConnection` (not Supabase SDK) for simplicity:
- `uploadPhoto(jpegBytes, path)` → POST to Supabase Storage (`housephotos` bucket)
- `insertEntry(photoPath, guestName?, message?)` → POST to `guestbook_entries` table

**Requires** `supabaseUrl` and `supabaseKey` to be set in KioskPrefs.

### 8. DeviceAdmin.kt + BootReceiver.kt

- **DeviceAdmin** — Empty receiver that enables `dpm set-device-owner`. Once set, the app can enter LOCK_TASK mode (disable home, back, status bar, recents)
- **BootReceiver** — Listens for `BOOT_COMPLETED` and launches MainActivity

---

## Data Flow

```
┌─────────────────────────────────────────────────┐
│  Samsung Tablet                                  │
│                                                  │
│  ┌─────────────┐    ┌──────────────────────┐    │
│  │ MainActivity │───▶│ WebView              │    │
│  │              │    │ alpacaplayhouse.com/  │    │
│  │  ┌─────────┐│    │ kioskhall/            │    │
│  │  │JsBridge ││◀──▶│                      │    │
│  │  └─────────┘│    │ window.AlpacaKiosk   │    │
│  └──────┬──────┘    └──────────────────────┘    │
│         │                                        │
│  ┌──────▼──────┐    ┌──────────────────────┐    │
│  │HttpApiServer│    │ PhotoBoothActivity   │    │
│  │  :2323      │    │  CameraX → JPEG      │    │
│  │  /status    │    │  → GuestBookManager  │    │
│  │  /reload    │    │  → Supabase Storage  │    │
│  │  /screenshot│    └──────────────────────┘    │
│  │  /js        │                                 │
│  └─────────────┘                                 │
│                                                  │
└─────────────────────────────────────────────────┘
         ▲                        │
         │ HTTP :2323             │ HTTPS
         │                        ▼
    Claude Code /            Supabase
    curl / scripts           (Storage + DB)
```

---

## How To: Common Modifications

### Add a new HTTP API endpoint
1. Edit `HttpApiServer.kt`
2. Add a new `when` branch in `serve()`:
   ```kotlin
   session.method == Method.POST && uri == "/your/endpoint" -> {
       // Your logic here
       jsonResponse("""{"ok":true}""")
   }
   ```

### Add a new JavaScript bridge method
1. Edit `JsBridge.kt`
2. Add method with `@JavascriptInterface`:
   ```kotlin
   @JavascriptInterface
   fun yourMethod(param: String): String {
       return "result"
   }
   ```
3. Call from web: `window.AlpacaKiosk.yourMethod("test")`

### Add a new setting
1. Add property to `KioskPrefs.kt` (with KEY constant and default)
2. Add input field in `SettingsActivity.kt` (in `onCreate`, follow existing pattern)
3. Add save logic in the save button click handler

### Change the start URL
- Via settings screen: triple-tap bottom-right → enter password → change URL
- Via API: `curl -X POST "http://<ip>:2323/navigate?url=https://example.com&pw=alpaca2323"`
- Via code: change `DEFAULT_URL` in `KioskPrefs.kt`

### Update the app on the tablet
```bash
# Rebuild
cd alpaca-kiosk && ./gradlew assembleDebug

# Reinstall (preserves settings)
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Upload to R2 for remote download
wrangler r2 object put alpacapps/downloads/alpaca-kiosk.apk \
  --file=app/build/outputs/apk/debug/app-debug.apk \
  --content-type="application/vnd.android.package-archive" --remote
```

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| NanoHTTPD | 2.3.1 | Lightweight HTTP server for remote control API |
| AndroidX WebKit | 1.12.1 | Modern WebView APIs |
| CameraX | 1.4.1 | Camera preview + image capture (photo booth) |
| Material Components | 1.12.0 | Theming |
| AndroidX AppCompat | 1.7.0 | Backward-compatible activity/fragment |

No Supabase SDK — guest book uses raw HTTP calls to keep the APK small.

---

## Build Requirements

- **Java 17** — required by AGP 8.7.3
- **Android SDK 36** — installed at `~/Library/Android/sdk`
- **Gradle 8.9** — downloaded automatically by wrapper

If building on a new machine:
```bash
# Portable JDK (no sudo needed)
curl -sL "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse" \
  -o /tmp/jdk17.tar.gz && mkdir -p ~/jdk17 && tar -xzf /tmp/jdk17.tar.gz -C ~/jdk17 --strip-components=1

# Build
export JAVA_HOME=~/jdk17/Contents/Home
export ANDROID_SDK_ROOT=~/Library/Android/sdk
cd alpaca-kiosk && ./gradlew assembleDebug
```

---

## Hosting

- **APK:** Cloudflare R2 bucket `alpacapps` → `downloads/alpaca-kiosk.apk`
- **Public URL:** `https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev/downloads/alpaca-kiosk.apk`
- **Source:** `https://github.com/rsonnad/alpacapps/tree/main/alpaca-kiosk`

---

## Device Access & Credentials

### Physical Device
| Detail | Value |
|--------|-------|
| Device | Samsung Galaxy tablet (front hallway) |
| ADB serial | `R95Y301R05A` (USB) |
| ADB WiFi | `192.168.1.245:5555` |
| Android package | `com.alpacaplayhouse.kiosk` |

### App Credentials (configurable via hidden settings)
| Credential | Default | How to change |
|------------|---------|---------------|
| HTTP API password | `alpaca2323` | Settings screen or SharedPreferences |
| Settings screen password | `1234` | Settings screen |
| HTTP API port | `2323` | Settings screen |

### Accessing the Settings Screen
1. Triple-tap the **bottom-right corner** of the kiosk screen
2. Enter the settings password (default: `1234`)

### Remote Control via HTTP API
```bash
# From any device on the same WiFi network:
curl http://192.168.1.245:2323/ping                                    # Health check (no auth)
curl "http://192.168.1.245:2323/status?pw=alpaca2323"                  # Device status
curl -X POST "http://192.168.1.245:2323/reload?pw=alpaca2323"         # Reload page
curl "http://192.168.1.245:2323/screenshot?pw=alpaca2323" -o shot.jpg # Screenshot
curl -X POST "http://192.168.1.245:2323/js?pw=alpaca2323" -d "document.title"  # Run JS
```

### ADB Access
```bash
# USB (cable connected)
adb -s R95Y301R05A shell

# WiFi
adb connect 192.168.1.245:5555
adb -s 192.168.1.245:5555 shell

# Reinstall app
adb -s R95Y301R05A install -r app/build/outputs/apk/debug/app-debug.apk

# Uninstall (escapes kiosk mode)
adb -s R95Y301R05A uninstall com.alpacaplayhouse.kiosk
```

### Device Owner Status
```bash
# Check if device owner is set
adb shell dpm list-owners

# Set device owner (requires no accounts on device)
adb shell dpm set-device-owner com.alpacaplayhouse.kiosk/.DeviceAdmin

# Remove device owner
adb shell dpm remove-active-admin com.alpacaplayhouse.kiosk/.DeviceAdmin
```

---

## Decision Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-03-13 | Custom app over Fully Kiosk Browser | Need native camera, NFC potential, full API access, no license |
| 2026-03-13 | Kotlin + WebView approach | Keep existing web kiosk content, native layer only where needed |
| 2026-03-13 | NanoHTTPD for remote API | Lightweight, well-tested, single dependency |
| 2026-03-13 | Raw HTTP instead of Supabase SDK | Keeps APK small (~6.5MB), only 2 API calls needed |
| 2026-03-13 | Removed category.HOME from manifest | Samsung hides HOME apps from app drawer |
| 2026-03-14 | APK hosted on Cloudflare R2 | Too large for GitHub (6.5MB APK + 130MB Gradle zip) |
