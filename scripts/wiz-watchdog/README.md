# wiz-watchdog

Auto-recovery for "WiZ bulbs stuck unavailable in Home Assistant."

## The problem

WiZ Wi-Fi bulbs frequently drop "unavailable" in HA. When a bulb in a group
(e.g. `light.master_bathroom_lights`) is unavailable, Alexa group commands
("Alexa, turn off the master bath lights") hang or partially fail. The bulb's
HA config entry stays in `loaded` state but the bulb itself isn't responding
to polls, so HA never re-attempts setup on its own.

## What this does

Every 5 minutes:
1. Query HA for `light.smart_*` entities in state=unavailable
2. Call `homeassistant.reload_config_entry` on each one
3. HA tears down + re-initializes the bulb's config entry; transient failures
   recover within ~30s
4. Write metrics to Supabase `system_commands` (target=alpuca, command=wiz_watchdog)

## What this does NOT do

A reload only helps for **transient** failures (HA integration glitch, brief
network blip). For **hard** failures it can't recover the bulb:

- Bulb powered off at the wall switch
- Bulb dropped off Wi-Fi entirely
- DHCP IP collision (bulb's old IP is now used by a different device — common
  cause: WiZ entry shows `setup_retry` with reason `Connection refused`)

For hard failures, the metrics in `system_commands` reveal the pattern (same
bulbs unavailable across many runs) so a physical fix is clearly needed.

## Deployment

### Primary: launchd on Alpuca

```bash
cp scripts/wiz-watchdog/wiz-watchdog.sh ~/scripts/
chmod +x ~/scripts/wiz-watchdog.sh
cp scripts/wiz-watchdog/com.alpacapps.wiz-watchdog.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alpacapps.wiz-watchdog.plist
```

`StartInterval=300` runs it every 5 min; `RunAtLoad=true` fires it immediately.

### Alternative: Cloudflare Worker (cron-triggered)

See `cloudflare/wiz-watchdog/` for a Worker version that runs in CF
infrastructure instead of on Alpuca. Useful if you want the watchdog to
survive Alpuca outages.

Requires `wrangler login` for the alpacapps CF account before deploy.

## Tokens / secrets

- **HA long-lived access token:** the script reads `~/.ha_llat` (one line),
  falling back to the hardcoded `TOKEN=...` in `~/ha-cmd.sh`. Same token used
  by the `~/bin/alpuca` light wrapper.
- **Supabase service-role key:** read from `~/.env-alpacapps`
  (`SUPABASE_SERVICE_ROLE_KEY=`). Metrics are best-effort — failure to write
  never blocks recovery.

## Query metrics

```sql
SELECT
  completed_at,
  result->>'unavailable_count' AS unavailable,
  result->>'reloads_attempted' AS reloads,
  result->>'reload_failures' AS failures
FROM system_commands
WHERE command = 'wiz_watchdog'
ORDER BY completed_at DESC
LIMIT 20;
```

Persistent unavailable bulbs across many runs → physical/network fix needed.
