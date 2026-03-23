# OldMacKiosk — Architecture

Native macOS kiosk app for the pacBook (2015 MacBook Pro) in the dining room at Alpaca Playhouse.
macOS equivalent of the Android `alpaca-kiosk` app running on the Galaxy tablet.

## Stack

- **Language:** Swift 5.7+
- **Target:** macOS 12.0+ (Monterey via OpenCore Legacy Patcher)
- **UI:** AppKit (NSWindow + WKWebView)
- **Build:** Swift Package Manager (`swift build`)
- **Dependencies:** None (all Apple frameworks)

## Components

| File | Purpose |
|------|---------|
| `App.swift` | Entry point, wires up window + server + lockdown |
| `KioskWindow.swift` | Borderless fullscreen NSWindow |
| `WebViewController.swift` | WKWebView loading kioskhall, offline fallback, network monitor |
| `HttpApiServer.swift` | HTTP API on port 2323 (Network.framework) |
| `JsBridge.swift` | `window.OldMacKiosk` JS bridge via WKScriptMessageHandler |
| `CameraManager.swift` | AVFoundation photo capture with countdown |
| `AudioManager.swift` | Microphone recording (M4A, max 60s) |
| `ScreenManager.swift` | Brightness, sleep/wake, volume, battery, WiFi info |
| `LockdownManager.swift` | Block Cmd+Q/Tab/W, hide dock/menu, triple-tap escape |
| `KioskPrefs.swift` | UserDefaults config (URL, port, password, timeouts) |
| `SettingsPanel.swift` | Hidden settings UI (password-protected) |

## HTTP API (port 2323)

All endpoints except `/ping` require `?pw=alpaca2323`.

```
GET  /ping                        → health check
GET  /status                      → device info JSON
GET  /screenshot                  → JPEG capture
POST /reload                      → reload WebView
POST /navigate?url=X              → load URL
POST /screen/on                   → wake display
POST /screen/off                  → sleep display
POST /brightness?level=0-100      → set brightness
POST /volume?level=0-100          → set volume
POST /js (body=code)              → execute JS
POST /mode/photobooth             → camera mode
POST /mode/dashboard              → tv.html dashboard
POST /mode/cameras                → tv.html cameras
POST /mode/signage?title=X        → tv.html signage
POST /say?text=X                  → text-to-speech
POST /reboot                      → reboot Mac
POST /settings                    → show settings panel
```

## JS Bridge (`window.OldMacKiosk`)

Available in any page loaded in the WebView:

```javascript
OldMacKiosk.platform              // "macos"
OldMacKiosk.isOldMacKiosk         // true
OldMacKiosk.getDeviceInfo(cb)     // battery, WiFi, uptime
OldMacKiosk.openPhotoBooth(cb)    // camera capture → base64 JPEG
OldMacKiosk.startAudioRecording() // mic capture
OldMacKiosk.stopAudioRecording(cb)// → base64 M4A
OldMacKiosk.setBrightness(0-100)
OldMacKiosk.setVolume(0-100)
OldMacKiosk.speak("text")
OldMacKiosk.reload()
```

Web code can detect the bridge via:
```javascript
window.addEventListener('OldMacKioskReady', () => { ... });
```

## Build & Deploy

```bash
cd oldmackiosk
swift build -c release

# Copy to pacBook
scp -r .build/release/OldMacKiosk alpaca@192.168.1.61:/Applications/OldMacKiosk.app/Contents/MacOS/

# Install LaunchAgent
scp LaunchAgent/com.alpacaplayhouse.oldmackiosk.plist \
    alpaca@192.168.1.61:~/Library/LaunchAgents/

# On pacBook: load the agent
launchctl load ~/Library/LaunchAgents/com.alpacaplayhouse.oldmackiosk.plist
```

## Lockdown

- Menu bar + Dock hidden
- Cmd+Q, Cmd+W, Cmd+Tab, Cmd+Space, Cmd+H, Cmd+M blocked
- Process switching disabled
- Triple-tap bottom-right corner (80px) → password prompt → settings
- Settings password default: `1234`

## Auto-Start

LaunchAgent runs the app on login with `KeepAlive` (auto-restart on crash).
Configure macOS auto-login for the `alpaca` user.
