# Alpaca Kiosk — Installation Guide

## Prerequisites

- **Android Studio** (or Gradle CLI) on your dev machine for building the APK
- **ADB** (Android Debug Bridge) installed — comes with Android Studio or standalone SDK Platform Tools
- **Samsung tablet** with USB debugging enabled

---

## Step 1: Enable Developer Options on the Tablet

1. Go to **Settings → About tablet**
2. Tap **Build number** 7 times until you see "Developer mode enabled"
3. Go to **Settings → Developer options**
4. Enable **USB debugging**
5. (Optional) Enable **Wireless debugging** for cable-free ADB

---

## Step 2: Build the APK

### Option A: Android Studio
1. Open the `alpaca-kiosk/` folder in Android Studio
2. Wait for Gradle sync to complete
3. Select **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. APK will be at `app/build/outputs/apk/debug/app-debug.apk`

### Option B: Command Line
```bash
cd alpaca-kiosk
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk

# For release build:
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## Step 3: Connect via ADB

### USB Connection
```bash
# Plug in USB cable, then:
adb devices
# Should show your tablet's serial number
```

### Wireless Connection
```bash
# On the tablet: Settings → Developer options → Wireless debugging
# Note the IP and port shown

adb pair <ip>:<pair-port>
# Enter the pairing code shown on the tablet

adb connect <ip>:<connect-port>
```

---

## Step 4: Remove Existing Accounts (Required for Device Owner)

**IMPORTANT:** `dpm set-device-owner` will fail if there are any accounts on the device. You must remove all Google/Samsung accounts first.

1. Go to **Settings → Accounts**
2. Remove ALL accounts (Google, Samsung, etc.)
   - You can re-add them after setting device owner

Or via ADB:
```bash
# List accounts
adb shell dumpsys account | grep -i "Account {"

# If accounts exist, remove them from Settings UI first
```

---

## Step 5: Install the App

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Step 6: Set as Device Owner

This is the critical step that enables kiosk lockdown (LOCK_TASK mode without user prompts).

```bash
adb shell dpm set-device-owner com.alpacaplayhouse.kiosk/.DeviceAdmin
```

Verify it worked:
```bash
adb shell dpm list-owners
# Should show: Device owner: ComponentInfo{com.alpacaplayhouse.kiosk/com.alpacaplayhouse.kiosk.DeviceAdmin}
```

**Troubleshooting:**
- "Not allowed to set the device owner because there are already some accounts on the device" → Remove all accounts (Step 4)
- "Not allowed to set the device owner because there are already several users on the device" → Remove secondary users from Settings

---

## Step 7: Launch the App

```bash
adb shell am start -n com.alpacaplayhouse.kiosk/.MainActivity
```

The app will:
- Load `https://alpacaplayhouse.com/kioskhall/` in fullscreen
- Enter LOCK_TASK mode (kiosk lockdown)
- Start the HTTP API server on port 2323
- Auto-launch on every boot going forward

---

## Step 8: Verify Remote Control

From any machine on the same network:

```bash
# Health check
curl http://<tablet-ip>:2323/ping

# Full status
curl "http://<tablet-ip>:2323/status?pw=alpaca2323"

# Reload the page
curl -X POST "http://<tablet-ip>:2323/reload?pw=alpaca2323"

# Take a screenshot
curl "http://<tablet-ip>:2323/screenshot?pw=alpaca2323" -o screenshot.jpg

# Execute JavaScript
curl -X POST "http://<tablet-ip>:2323/js?pw=alpaca2323" -d "document.title"
```

---

## Step 9: Configure Settings (Optional)

1. Triple-tap the **bottom-right corner** of the screen
2. Enter the settings password (default: `1234`)
3. Configure:
   - Start URL
   - HTTP API port and password
   - Screen timeout
   - Auto-restart interval
   - Supabase credentials (for guest book / photo booth)

---

## Step 10: Set Up Photo Booth (Phase 2)

1. Open the hidden settings (triple-tap bottom-right)
2. Enter your Supabase URL: `https://aphrrfprbixmhissnjfn.supabase.co`
3. Enter your Supabase anon key
4. The `guestbook_entries` table must exist in your database:

```sql
CREATE TABLE guestbook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_url TEXT NOT NULL,
    guest_name TEXT,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE guestbook_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert" ON guestbook_entries
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon select" ON guestbook_entries
    FOR SELECT USING (true);
```

5. Ensure the `housephotos` storage bucket exists and allows uploads

Trigger photo booth:
- From the web page: `window.AlpacaKiosk.openPhotoBooth()`
- Via HTTP API: `curl -X POST "http://<tablet-ip>:2323/mode/photobooth?pw=alpaca2323"`

---

## Default Credentials

| Setting | Default Value |
|---------|---------------|
| HTTP API password | `alpaca2323` |
| Settings password | `1234` |
| HTTP API port | `2323` |
| Start URL | `https://alpacaplayhouse.com/kioskhall/` |

**Change these via the hidden settings screen after installation.**

---

## Updating the App

```bash
# Build new APK, then:
adb install -r app/build/outputs/apk/debug/app-debug.apk

# The app will restart automatically
# Device owner status persists across updates
```

---

## Removing Device Owner (if needed)

To fully remove kiosk mode and device owner:

```bash
adb shell dpm remove-active-admin com.alpacaplayhouse.kiosk/.DeviceAdmin
```

Or from the hidden settings screen: tap "Exit Kiosk Mode".

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| App won't enter lock task | Verify device owner: `adb shell dpm list-owners` |
| HTTP API not reachable | Check tablet IP, ensure port 2323 isn't firewalled, verify WiFi |
| WebView shows blank | Check network, try `/reload` via API |
| Camera doesn't work in photo booth | Grant camera permission: Settings → Apps → Alpaca Kiosk → Permissions |
| Tablet stuck in kiosk mode | Connect ADB, uninstall: `adb uninstall com.alpacaplayhouse.kiosk` |
| Can't set device owner | Remove ALL accounts from the tablet first |
