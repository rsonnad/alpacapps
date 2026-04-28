# Spotify API — Playlist Creation Guide

## Quick Reference

| What | How |
|------|-----|
| **Auth type** | OAuth Authorization Code Flow (user-level tokens) |
| **Token storage** | `spotify_config` table (id=1) — client_id, client_secret, refresh_token, access_token |
| **Edge function** | `sonos-control` — handles all Spotify actions |
| **Callback URL** | `https://alpacaplayhouse.com/auth/spotify/callback.html` |
| **Scopes** | `playlist-modify-public playlist-modify-private user-read-private` |
| **Connected account** | Rahul Lio (user ID: sonnad, Spotify Premium) |

## Architecture

```
Browser (sonos.html)
  → Supabase Edge Function (sonos-control)
    → Spotify Web API (api.spotify.com)
      ← Token refresh via accounts.spotify.com/api/token
```

Tokens auto-refresh: `getSpotifyUserToken()` in the edge function reads the refresh_token from `spotify_config`, calls Spotify's token endpoint, and updates the DB with fresh tokens.

## Creating Playlists — Fastest Path

### Method 1: Edge Function (RECOMMENDED — fully working)

This is the simplest and most reliable method. Creates playlist AND adds tracks in one call.

```bash
# Get anon key (or set SUPABASE_ANON_KEY env var)
export BW_SESSION=$(~/bin/bw-unlock 2>/dev/null)
SUPABASE_ANON_KEY=$(bw get item "Supabase — Dashboard" --session "$BW_SESSION" 2>/dev/null \
  | python3 -c "import sys,json; fields=json.load(sys.stdin).get('fields',[]); print(next((f['value'] for f in fields if f['name']=='Anon Key'),''))")

# Create playlist with tracks (all in one call)
curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{
    "action": "spotify-create-playlist",
    "name": "My Playlist Name",
    "description": "Optional description",
    "tracks": ["spotify:track:XXXXX", "spotify:track:YYYYY"]
  }' | python3 -m json.tool
```

**Response:**
```json
{
    "success": true,
    "playlist_id": "4ORErLxPFoX06n75HdmOSy",
    "playlist_url": "https://open.spotify.com/playlist/4ORErLxPFoX06n75HdmOSy",
    "track_count": 36
}
```

**Key field:** `tracks` (array of `spotify:track:` URIs). NOT `trackUris`.

### Finding Track URIs

Search via the edge function:

```bash
curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{"action":"spotify-search","query":"Dire Wolf Grateful Dead Reckoning","type":"track"}' \
  | python3 -m json.tool
```

**Note:** Dev Mode limits search to **10 results max**. Use specific queries (artist + song + album) for best results.

### Method 2: Direct Spotify API

For cases where you need more control (e.g., modifying existing playlists):

```bash
# Get fresh token — refresh via edge function first, then read from DB
curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{"action":"spotify-status"}' > /dev/null

SPOTIFY_TOKEN=$(curl -s -X POST \
  -H "Authorization: Bearer $MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT access_token FROM spotify_config WHERE id = 1"}' \
  "https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn/database/query" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['access_token'])")

# Create playlist
curl -s -X POST "https://api.spotify.com/v1/me/playlists" \
  -H "Authorization: Bearer $SPOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Playlist","description":"...","public":true}'

# Add tracks — MUST use /items (not /tracks, renamed Feb 2026)
curl -s -X POST "https://api.spotify.com/v1/playlists/{playlist_id}/items" \
  -H "Authorization: Bearer $SPOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uris":["spotify:track:XXXXX","spotify:track:YYYYY"]}'

# Delete a playlist (unfollow)
curl -s -X DELETE "https://api.spotify.com/v1/playlists/{playlist_id}/followers" \
  -H "Authorization: Bearer $SPOTIFY_TOKEN"
```

## Workflow: Bulk Playlist Creation (proven recipe)

This is the exact workflow used to create the Reckoning Show playlists (36 tracks each):

1. **Search for tracks** — use `spotify-search` action via edge function. Search one song at a time, pick the best URI from results.
2. **Collect URIs** — gather all `spotify:track:` URIs into an array.
3. **Create playlist** — single `spotify-create-playlist` call with all URIs. The edge function handles batching (100 tracks per API call).
4. **Verify** — check the response's `track_count` matches your input array length.

**Gotcha:** The edge function silently logs (but doesn't fail) if individual track batches error. Always verify `track_count` in the response.

## Available Edge Function Actions

| Action | Auth bypass | Purpose |
|--------|-------------|---------|
| `spotify-auth-url` | Yes | Returns Spotify OAuth URL for user to authorize |
| `spotify-exchange-code` | Yes | Exchanges OAuth code for tokens, stores in DB |
| `spotify-status` | Yes | Returns connection status + user info |
| `spotify-create-playlist` | Yes | Creates playlist + adds tracks in one call |
| `spotify-search` | No | Searches Spotify catalog (requires user JWT) |

**Auth bypass** means the action works with just the Supabase anon key — no user JWT session needed. This is critical for CLI/scripting use.

## Token Refresh Flow

1. Edge function reads `refresh_token` from `spotify_config` (id=1)
2. POSTs to `https://accounts.spotify.com/api/token` with `grant_type=refresh_token`
3. Spotify returns new `access_token` (and optionally new `refresh_token`)
4. Both are saved back to `spotify_config`
5. Access tokens expire after **1 hour**; refresh tokens are long-lived

## February 2026 API Changes (CRITICAL)

Spotify renamed several endpoints in Feb 2026. **Using old endpoints returns 403.**

| Old endpoint (BROKEN) | New endpoint (USE THIS) |
|----------------------|------------------------|
| `POST /playlists/{id}/tracks` | `POST /playlists/{id}/items` |
| `GET /playlists/{id}/tracks` | `GET /playlists/{id}/items` |
| `DELETE /playlists/{id}/tracks` | `DELETE /playlists/{id}/items` |
| `GET /playlists/{id}` → `tracks` field | Now returns `items` field |

Other changes:
- Search limit reduced from 50 to **10 results max**
- Batch endpoints removed (`GET /tracks`, `/albums`, `/artists`)
- `popularity`, `followers`, `external_ids` fields removed
- `GET /users/{id}` removed — use `GET /me` instead
- Playlist creation: use `POST /me/playlists` (not `/users/{id}/playlists`)

See [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).

## Dev Mode Limits

| Feature | Works in Dev Mode? |
|---------|--------------------|
| Search tracks | Yes (max 10 results) |
| Get user profile (`/me`) | Yes |
| Create playlists (`/me/playlists`) | Yes |
| Add items to playlists (`/items`) | Yes |
| Delete/unfollow playlists | Yes |
| Max registered users | 25 |
| Batch endpoints | Removed entirely |

**Dev Mode is sufficient** for our use case. Extended Quota Mode is only needed for >25 users or removed batch endpoints.

## Credentials

| Item | Location |
|------|----------|
| Client ID, Client Secret | Bitwarden: **"Spotify — AlpacApps"** |
| OAuth tokens | Supabase `spotify_config` table (auto-refreshed) |
| Supabase Anon Key | Bitwarden: **"Supabase — Dashboard"** → `Anon Key` field |

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/sonos-control/index.ts` | Edge function with all Spotify actions |
| `residents/sonos.html` | UI with Spotify search + connect button |
| `residents/sonos.js` | Client-side Spotify functions |
| `auth/spotify/callback.html` | OAuth callback page |

## Playlists Created

| Playlist | ID | Tracks |
|----------|-----|--------|
| Gillian Welch and Dave Rawlings Reckoning Show Songs | `4ORErLxPFoX06n75HdmOSy` | 36 (GD originals, Reckoning album bias) |
| Reckoning Show Songs — Cover Versions | `7MQ3uhiq5UQTYyFpDLwEaS` | 36 (cover artists, tribute bands, original songwriters) |
