# Scheduled Tasks Migration

> **Purpose:** Create these 3 scheduled tasks on this Claude Desktop instance.
> Use the `create_scheduled_task` tool for each one.

---

## Task 1: QuickBooks Token Refresh (Weekly)

```
Task ID: qb-token-refresh
Schedule: Every Monday at 9:17 AM local time
Cron: 17 9 * * 1
```

**Prompt:**

Refresh the QuickBooks OAuth token to prevent 100-day expiry.

1. Read credentials from Bitwarden:
   ```bash
   export BW_SESSION=$(~/bin/bw-unlock)
   ```
2. Get the QuickBooks refresh token from Bitwarden item "QuickBooks OAuth — AlpacApps"
3. Use the refresh token to request a new access token from QuickBooks OAuth endpoint
4. Update the Bitwarden item with the new access and refresh tokens
5. Log the result — if refresh fails, send an alert email to rahulioson@gmail.com via Resend with subject "QB Token Refresh FAILED"

---

## Task 2: Tuya Cloud Trial Renewal Reminder (One-time)

```
Task ID: renew-tuya-cloud-trial
Schedule: One-time — August 28, 2026 at 9:00 AM CDT
fireAt: 2026-08-28T09:00:00-05:00
```

**Prompt:**

Reminder: The Tuya IoT Cloud free trial expires on 2026-09-28. You have 30 days to renew it.

1. Send an email to rahulioson@gmail.com via Resend with:
   - Subject: "ACTION REQUIRED: Tuya IoT Cloud trial expires Sep 28"
   - Body: The Tuya IoT Development Platform free trial expires on September 28, 2026. Log into https://iot.tuya.com and renew the Cloud Development plan before expiry, or all Tuya/Smart Life device API access will stop working (affects BRMesh spotlights and any Smart Life devices). The trial is free to renew.

---

## Task 3: BRMesh ESP32 Setup Reminder (One-time)

```
Task ID: brmesh-esp32-setup
Schedule: One-time — March 29, 2026 at 10:00 AM CDT
fireAt: 2026-03-29T10:00:00-05:00
```

**Prompt:**

Reminder: Set up BRMesh spotlights in Home Assistant via ESP32 MQTT bridge.

The BRMesh spotlights (Skyloft ceiling, outdoor spots) are Bluetooth mesh only — they need an ESP32 running a BRMesh-to-MQTT bridge to be controllable from HAOS.

Steps:
1. Flash the ESP32 with the BRMesh MQTT bridge firmware (see https://github.com/nicola/brmesh-mqtt or similar)
2. Configure it to connect to the Alpuca WiFi network and HAOS MQTT broker (Mosquitto on 192.168.1.39:1883)
3. Pair the ESP32 with the BRMesh spotlight group
4. Add MQTT light entities in HAOS for each spotlight
5. Test on/off, brightness, and color control from HAOS

If this task fires and the ESP32 hasn't arrived yet, create a new reminder for 1 week later.
