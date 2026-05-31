# Sponic Tablet Setup — Samsung Galaxy Tab A9+

This is the repeatable setup for the SponichTab / LangBang development tablet.
It is not the old hallway kiosk runbook. The target pattern is:

- Samsung Galaxy tablet on Wi-Fi
- Tailscale installed and signed into the Sponic/AlpacApps tailnet
- Android Developer options enabled
- Wireless debugging kept on by LangBang's dev helper
- Tailscale set as Android's Always-on VPN by LangBang's dev helper
- adb promoted to fixed TCP port `5555` whenever possible
- Mac-side wrapper `~/bin/adb-tab` reconnects over the tablet's Tailscale IP

## Current Reference Device

| Field | Value |
|-------|-------|
| Device name | `samsung-a9-sponich` |
| Model | Samsung Galaxy Tab A9+ Wi-Fi / `SM-X210` |
| Tailscale IP | `100.103.110.7` |
| adb fixed port | `5555` |
| LangBang package | `com.sponic.langbang` |
| Mac wrapper | `~/bin/adb-tab` |
| Screenshot wrapper | `~/bin/adb-tab-screenshot` |

## Tablet Settings

On the tablet:

1. Install and sign into **Tailscale**.
2. In Tailscale, leave the device connected to the Sponic/AlpacApps tailnet.
3. Android Settings -> About tablet -> Software information -> tap **Build number** seven times.
4. Android Settings -> Developer options:
   - **Developer options**: on
   - **USB debugging**: on
   - **Wireless debugging**: on
5. Wireless debugging -> **Pair device with pairing code** when pairing a new Mac.
6. When Android shows an adb authorization dialog, accept it for the Mac.

Samsung/Android may turn Wireless debugging off after Wi-Fi changes, sleep, or
reboot. LangBang now carries a dev helper that can re-enable the global
`adb_wifi_enabled` setting after boot and app launch. The same helper also sets
Tailscale as Android's Always-on VPN by writing `always_on_vpn_app` to
`com.tailscale.ipn` and keeping VPN lockdown disabled. These writes only work
after the one-time secure-settings grant below.

## One-Time Mac Pairing

Use the tablet's Tailscale IP, not the LAN IP. Local LAN pairing has repeatedly
failed from macOS with `No route to host` or adb protocol faults even when ARP
and TCP reachability looked fine.

```bash
# Confirm the tablet is in the tailnet.
tailscale status | grep -i sponich
ping -c 1 100.103.110.7

# On tablet: Wireless debugging -> Pair device with pairing code.
adb pair 100.103.110.7:<PAIRING_PORT> <6_DIGIT_CODE>

# Back out to the main Wireless debugging screen and read "IP address & Port".
adb connect 100.103.110.7:<CONNECT_PORT>
adb devices
```

Pairing and authorization are durable until the tablet revokes the computer's
key. The connect port can rotate; the pairing port and connect port are not the
same.

## Promote adb to Fixed Port 5555

Once the tablet is connected through any adb path:

```bash
adb -s 100.103.110.7:<CONNECT_PORT> tcpip 5555
sleep 2
adb connect 100.103.110.7:5555
adb -s 100.103.110.7:5555 shell getprop service.adb.tcp.port
```

Expected output for the last command:

```text
5555
```

The fixed port avoids Android's rotating Wireless debugging port. It survives
screen off and normal reconnects in testing, but it can be lost after reboot,
adbd restart, developer-options reset, or OS updates.

## Install LangBang Dev Helper

LangBang includes `AdbWifiKeeper`, which does two dev-device repairs on app
start, package replacement, and boot:

1. Re-enables Wireless debugging by setting `settings global adb_wifi_enabled=1`.
2. Sets Tailscale as Android's Always-on VPN:
   - `settings secure always_on_vpn_app=com.tailscale.ipn`
   - `settings secure always_on_vpn_lockdown=0`

Normal Android apps cannot do this unless the permission is granted from adb.

After installing a build that contains the helper, grant it once:

```bash
adb -s 100.103.110.7:5555 install -r \
  /Users/rahulio/Documents/CodingProjects/langbang/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk

adb -s 100.103.110.7:5555 shell pm grant \
  com.sponic.langbang android.permission.WRITE_SECURE_SETTINGS

adb -s 100.103.110.7:5555 shell dumpsys package com.sponic.langbang | \
  grep -E 'WRITE_SECURE_SETTINGS|RECEIVE_BOOT_COMPLETED'
```

Expected grant lines include:

```text
android.permission.WRITE_SECURE_SETTINGS: granted=true
android.permission.RECEIVE_BOOT_COMPLETED: granted=true
```

Manual verification without reboot:

```bash
adb -s 100.103.110.7:5555 shell settings put global adb_wifi_enabled 0
adb -s 100.103.110.7:5555 shell am force-stop com.sponic.langbang
adb -s 100.103.110.7:5555 shell monkey -p com.sponic.langbang 1 >/dev/null
sleep 2
adb -s 100.103.110.7:5555 shell settings get global adb_wifi_enabled
adb -s 100.103.110.7:5555 shell settings get secure always_on_vpn_app
adb -s 100.103.110.7:5555 shell settings get secure always_on_vpn_lockdown
```

Expected output:

```text
1
com.tailscale.ipn
0
```

## Mac Wrapper Behavior

`~/bin/adb-tab` should prefer this order:

1. Ping the tablet Tailscale IP and fail fast if the tailnet path is down.
2. Try `100.103.110.7:5555`.
3. Try the cached rotating Wireless debugging port.
4. Try adb mDNS.
5. Scan high ports as a last resort.
6. If it reaches the tablet through a rotating port, immediately run
   `adb tcpip 5555` and reconnect to fixed `5555`.

That makes recovery automatic once Tailscale is reachable and Wireless debugging
has been restored by the helper.

## Tailscale Reboot Dependency

The 2026-05-31 reboot test proved the LangBang helper can bring Wireless
debugging back. It also showed the next dependency: adb cannot reconnect if
Tailscale does not rejoin the tailnet after boot. LangBang v0.1.8.124 and later
set Tailscale as Android's Always-on VPN, which is Android's built-in mechanism
for starting a VPN after boot. After every new tablet setup, verify Tailscale
separately:

```bash
# From the Mac, after rebooting the tablet:
tailscale ping 100.103.110.7
tailscale status | grep -i sponich
```

If Wi-Fi is up but Tailscale is offline, fix tablet-side Tailscale settings:

1. Android Settings -> Connections -> More connection settings -> VPN.
2. Tap the gear next to Tailscale.
3. Turn on **Always-on VPN**.
4. Leave **Block connections without VPN** off unless this tablet is intentionally
   allowed to lose all non-Tailscale connectivity when Tailscale cannot connect.
5. Open Tailscale on the tablet after boot and confirm it reconnects manually.
6. Android Settings -> Apps -> Tailscale -> Battery:
   - set to **Unrestricted** or equivalent Samsung wording
   - disable **Pause app activity if unused** if shown
7. Android Settings -> Apps -> Tailscale -> Mobile data/Wi-Fi:
   - allow background data if present
8. Android Settings -> Battery -> Background usage limits:
   - ensure Tailscale is not in Sleeping apps or Deep sleeping apps
9. Reboot again and confirm `tailscale ping <tablet-ip>` succeeds without
   opening Tailscale manually.

The adb helper does not replace this. It only restores Android Wireless
debugging; the Mac still needs the Tailscale route to reach the tablet.

## Repeat Recipe For Another Samsung Tablet

1. Install Tailscale and record the new tailnet IP.
2. Enable Developer options, USB debugging, and Wireless debugging.
3. Pair adb over the Tailscale IP.
4. Accept the Android adb authorization prompt.
5. Run `adb tcpip 5555` and verify fixed-port reconnect.
6. Install LangBang or another helper APK with:
   - `WRITE_SECURE_SETTINGS` declared
   - `RECEIVE_BOOT_COMPLETED` declared
   - boot/app-start logic that sets `settings global adb_wifi_enabled=1`
   - boot/app-start logic that sets Tailscale as `always_on_vpn_app`
7. Grant `WRITE_SECURE_SETTINGS` once from adb.
8. Configure Tailscale battery/background settings.
9. Reboot and verify both:
   - `tailscale ping <tablet-ip>` succeeds
   - `adb connect <tablet-ip>:5555` succeeds

## Troubleshooting

| Symptom | Meaning | Fix |
|---------|---------|-----|
| `tailscale ping` fails after reboot | Tailscale did not reconnect | Open Tailscale, then fix battery/background settings |
| `tailscale ping` works but `adb connect :5555` fails | Fixed adb TCP mode was lost | Use `~/bin/adb-tab` to find rotating port and repromote to `5555` |
| No high ports are open, but tablet pings | Wireless debugging is off | Launch LangBang, or toggle Wireless debugging on manually |
| `adb devices` shows `unauthorized` | Android authorization dialog is waiting | Accept it on the tablet |
| LAN IP has ARP but adb says `No route to host` | Known macOS/LAN adb failure mode | Use Tailscale IP instead of LAN IP |
| Screen is blank but adb still works | Display sleep only | No action needed; `5555` survived screen-off testing |
