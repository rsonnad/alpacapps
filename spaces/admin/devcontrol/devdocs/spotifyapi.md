# Spotify API — Playlist Creation Guide

## Quick Reference

| What | How |
|------|-----|
| **Auth type** | OAuth Authorization Code Flow (user-level tokens) |
| **Token storage** | `spotify_config` table (id=1) — client_id, client_secret, refresh_token, access_token |
| **Edge function** | `sonos-control` — handles all Spotify actions |
| **Callback URL** | `https://alpacaplayhouse.com/auth/spotify/callback.html` |
| **Scopes** | `playlist-modify-public playlist-modify-private user-read-private` |
| **Dev mode limit** | Creating playlists works; **adding tracks returns 403** until Extended Quota Mode is approved |

## Architecture

```
Browser (sonos.html)
  → Supabase Edge Function (sonos-control)
    → Spotify Web API (api.spotify.com)
      ← Token refresh via accounts.spotify.com/api/token
```

Tokens auto-refresh: `getSpotifyUserToken()` in the edge function reads the refresh_token from `spotify_config`, calls Spotify's token endpoint, and updates the DB with fresh tokens.

## Creating Playlists — Fastest Path

### Method 1: Edge Function (API)

**Works now:** playlist creation. **Blocked:** adding tracks (Dev Mode 403).

```bash
# Create empty playlist
curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{
    "action": "spotify-create-playlist",
    "name": "My Playlist",
    "description": "Created via AlpacApps",
    "tracks": ["spotify:track:XXXXX", "spotify:track:YYYYY"]
  }'
```

Once Extended Quota Mode is approved, tracks will be added automatically in batches of 100.

### Method 2: Direct Spotify API (requires valid user token)

```bash
# Get fresh token from DB
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

# Add tracks (use /items not /tracks — Feb 2026 API change)
curl -s -X POST "https://api.spotify.com/v1/playlists/{playlist_id}/items" \
  -H "Authorization: Bearer $SPOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uris":["spotify:track:XXXXX"]}'
```

### Method 3: Search + Bulk Add via UI (workaround for Dev Mode)

When the API can't add tracks, use search to find URIs, then paste them into the Spotify desktop app:

```bash
# Search for a track
curl -s -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/sonos-control" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{"action":"spotify-search","query":"Dire Wolf Grateful Dead Reckoning","type":"track"}'
```

Then in the Spotify desktop app: right-click a song → "Add to Playlist" → select your playlist.

**Bulk shortcut:** In the Spotify desktop app, you can paste Spotify URIs directly into a playlist. Copy a URI like `spotify:track:7rLRoUv0PMTcHz0lOfpnti` and Cmd+V into the playlist view.

### Method 4: spotipy (Python, for scripting)

```bash
pip install spotipy
```

```python
import spotipy
from spotipy.oauth2 import SpotifyOAuth

sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",
    redirect_uri="https://alpacaplayhouse.com/auth/spotify/callback.html",
    scope="playlist-modify-public playlist-modify-private"
))

# Create and populate in one go
playlist = sp.user_playlist_create(sp.me()['id'], "My Playlist", public=True)
track_uris = ["spotify:track:XXXXX", ...]
sp.playlist_add_items(playlist['id'], track_uris)
```

Note: spotipy is subject to the same Dev Mode restrictions as direct API calls.

## Available Edge Function Actions

| Action | Auth bypass | Purpose |
|--------|-------------|---------|
| `spotify-auth-url` | Yes | Returns Spotify OAuth URL for user to authorize |
| `spotify-exchange-code` | Yes | Exchanges OAuth code for tokens, stores in DB |
| `spotify-status` | Yes | Returns connection status + user info |
| `spotify-create-playlist` | Yes | Creates playlist, adds tracks (if permitted) |
| `spotify-search` | No | Searches Spotify catalog (uses client credentials) |

## Token Refresh Flow

1. Edge function reads `refresh_token` from `spotify_config` (id=1)
2. POSTs to `https://accounts.spotify.com/api/token` with `grant_type=refresh_token`
3. Spotify returns new `access_token` (and optionally new `refresh_token`)
4. Both are saved back to `spotify_config`
5. Access tokens expire after 1 hour; refresh tokens are long-lived

## February 2026 API Changes (IMPORTANT)

Spotify renamed several endpoints in Feb 2026. Key change for playlists:

| Old endpoint | New endpoint |
|-------------|-------------|
| `POST /playlists/{id}/tracks` | `POST /playlists/{id}/items` |
| `GET /playlists/{id}/tracks` | `GET /playlists/{id}/items` |
| `DELETE /playlists/{id}/tracks` | `DELETE /playlists/{id}/items` |

Other changes: search limit reduced to 10, batch endpoints removed, `popularity`/`followers` fields removed. See [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).

## Dev Mode Limits

| Feature | Dev Mode |
|---------|----------|
| Search tracks | Yes (max 10 results) |
| Get user profile | Yes |
| Create playlists | Yes |
| Add items to playlists | Yes (via `/items` endpoint) |
| Max users | 25 |
| Batch endpoints | Removed |

## Credentials

All stored in Bitwarden item **"Spotify — AlpacApps"**:
- `Client ID`
- `Client Secret`

OAuth tokens stored in Supabase `spotify_config` table (auto-refreshed by edge function).

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/sonos-control/index.ts` | Edge function with all Spotify actions |
| `residents/sonos.html` | UI with Spotify search + connect button |
| `residents/sonos.js` | Client-side Spotify functions |
| `auth/spotify/callback.html` | OAuth callback page |
