# Plan: Discord PAI Channel

## Goal
Make the Discord bot ("Pai") another channel of the `alpaca-pai` edge function — just like voice (Vapi), email, and web chat already are. This gives Discord Pai full access to Tesla status, lights, Sonos, thermostats, codes, spaces, documents, announcements — everything.

## Architecture

```
Discord User sends message in server/DM
  → pai-discord bot (Node.js on DO droplet)
    → POST to alpaca-pai edge function (source: "discord")
      → Gemini with all tools (lights, Tesla, Sonos, etc.)
    ← Response with reply + actions_taken
  → Bot posts reply back to Discord channel
```

## Changes

### 1. Database: Add `discord_addendum` column to `pai_config`
```sql
ALTER TABLE pai_config ADD COLUMN discord_addendum text DEFAULT '';
```
Insert Discord-specific prompt instructions (formatting for Discord markdown, multi-user channel behavior, etc.)

### 2. Edge Function: `alpaca-pai/index.ts` — Add Discord channel support
- Detect `context.source === "discord"` (same pattern as email)
- Apply `discord_addendum` from `pai_config` when source is discord
- Load `pai_config` with new column: add `discord_addendum` to SELECT
- Auth: Discord channel uses service role key + `context.discord_user_name` (same pattern as email channel using `context.sender`)
- Look up app_user by matching Discord username/ID to `app_users` table (add `discord_id` column to `app_users`, or match by display name)
- Log interactions with `source: 'discord'`

### 3. Database: Add `discord_id` column to `app_users`
```sql
ALTER TABLE app_users ADD COLUMN discord_id text;
```
This maps Discord user IDs to app users for permission resolution.

### 4. New service: `pai-discord/` bot on DO droplet
A lightweight Node.js Discord bot (discord.js) that:
- Listens for messages in configured channels + DMs
- Maintains per-user conversation history (in-memory, last 12 messages)
- Forwards messages to `alpaca-pai` edge function with:
  ```json
  {
    "message": "user's message",
    "conversationHistory": [...],
    "context": {
      "source": "discord",
      "discord_user_id": "213385376432259072",
      "discord_user_name": "Rahulio",
      "discord_channel": "general"
    }
  }
  ```
- Posts PAI's response back to Discord
- Handles typing indicators while waiting
- Runs as systemd service (`pai-discord.service`)

### 5. Discord bot token
- Reuse the existing SentaClawz bot token from Clawdbot config, OR
- Create a new Discord application for PAI specifically
- **Recommendation:** Create a new "Pai" bot so it has its own identity/avatar, separate from Clawdbot

### 6. SOUL.md → PAI identity (all channels)
The personality from SOUL.md gets absorbed into PAI's identity prompt in `pai_config.identity`. This ensures consistent personality across web chat, voice, email, and Discord. The `discord_addendum` handles only Discord-specific formatting rules.

## Files to create/modify

| File | Action |
|------|--------|
| `supabase/functions/alpaca-pai/index.ts` | Add Discord channel detection + discord_addendum |
| `pai-discord/bot.js` | New — lightweight Discord→PAI bridge |
| `pai-discord/package.json` | New — discord.js dependency |
| `pai-discord/pai-discord.service` | New — systemd unit file |
| Database migration | Add `discord_addendum` to `pai_config`, `discord_id` to `app_users` |

## What this enables
- "Which Teslas are charging?" → PAI calls `get_device_status(vehicle)` → shows battery/charging status
- "Turn on the kitchen lights" → PAI calls `control_lights` → lights turn on
- "Play jazz in the living room" → PAI calls `control_sonos` → music plays
- "What's the temperature inside?" → PAI calls `get_device_status(thermostat)` → shows temps
- All existing PAI capabilities, instantly available on Discord
