# alexa-room-guard

Voice control of lights is one room at a time. If one Alexa (or Google) command changes
lights in more than one room ("Alexa, turn off all the lights", "make the lights red"),
this service puts every light it touched back the way it was and posts an HA notification
("Voice command undone").

Added 2026-10-30 after Alexa turned ~170 lights red at 1:34 AM on Oct 28 and Oct 30
(see `devcontrol/devdocs/LIGHTINGAUTOMATION.md`, audit log section).

## How it works

- Subscribes to HAOS `state_changed` over the websocket API.
- Keeps only `light.*` changes whose context user is `Home Assistant Cloud`
  (`62f35793…`), which is every Alexa/Google command, routine and group.
- Groups them into a burst that ends after 3 s with no new change. It saves each
  light's state from before the burst.
- Rooms: HA area of the entity or its device. A light group takes its members' rooms.
  Lights with no area fall back to Supabase `lighting_devices.room`, or else don't count.
- More than one room: restore each light (on/off, brightness, color temp or hue) and
  post a notification. Restores go through the `Alpaca Admin` token, so they show in
  `light_change_log` as `alpaca_admin_api` and don't trigger the guard again.

Lights change for a second or two before they are put back. The guard can't stop
Alexa sending the command; it can only undo it.

## Install / update on Alpuca

```bash
mkdir -p ~/alexa-room-guard ~/logs
# Apple's /usr/bin/python3, not Homebrew: under launchd only it can reach the LAN
# (Homebrew python gets "No route to host" from the Local Network permission).
/usr/bin/python3 -m pip install --user websocket-client
cp alexa_room_guard.py ~/alexa-room-guard/
cp com.alpacapps.alexa-room-guard.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.alpacapps.alexa-room-guard 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alpacapps.alexa-room-guard.plist
tail -f ~/logs/alexa-room-guard.log
```

Settings (env vars in the plist): `GUARD_MAX_ROOMS` (default 1), `GUARD_QUIET_SECONDS`
(3), `GUARD_DRY_RUN=1` to log without restoring. The HA token is read from `~/lights.sh`
unless `HA_TOKEN` is set.

To turn it off: `launchctl bootout gui/$(id -u)/com.alpacapps.alexa-room-guard`.

## Room assignment matters

A light with no HA area and no `lighting_devices.room` doesn't count toward the room
total. To make the guard catch it, give it an area in HA (Settings → Devices).
