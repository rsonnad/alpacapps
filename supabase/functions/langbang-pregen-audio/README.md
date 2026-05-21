# langbang-pregen-audio

Pre-generate Azure TTS audio for langbang phrases and store the mp3s in Cloudflare R2 so the
Android app can pull them with a single GET (no Azure key on device, no re-synth per install).

## Deploy

```bash
cd /Users/rahulio/Documents/CodingProjects/genalpaca-admin
supabase functions deploy langbang-pregen-audio --no-verify-jwt
```

The `--no-verify-jwt` flag lets the langbang Android client call the function with just the
anon key (no logged-in Supabase user). Authorisation comes from the project anon key.

## Required project secrets

Set once via the Supabase dashboard or CLI:

```bash
export BW_SESSION=$(~/bin/bw-unlock)
AZURE_KEY=$(bw-read "Azure Speech — langbang-speech (TTS)" "key1")
R2_ACCOUNT=$(bw-read "Cloudflare R2 — Object Storage" "Account ID")
R2_KEY=$(bw-read "Cloudflare R2 — Object Storage" "Access Key ID")
R2_SECRET=$(bw-read "Cloudflare R2 — Object Storage" "Secret Access Key")

supabase secrets set \
  AZURE_SPEECH_KEY="$AZURE_KEY" \
  AZURE_SPEECH_REGION=eastus \
  R2_ACCOUNT_ID="$R2_ACCOUNT" \
  R2_ACCESS_KEY_ID="$R2_KEY" \
  R2_SECRET_ACCESS_KEY="$R2_SECRET" \
  R2_BUCKET_NAME=alpacapps \
  R2_PUBLIC_URL=https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev
```

## Invocation

POST `https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/langbang-pregen-audio`

Headers:
- `Authorization: Bearer <ANON_KEY>` (the langbang app's `SUPABASE_ANON_KEY`)
- `Content-Type: application/json`

Body:
```json
{
  "phrases": [
    {"text": "ja jestem", "voice": "pl-PL-ZofiaNeural", "locale": "pl-PL"},
    {"text": "ja jestem", "voice": "pl-PL-ZofiaNeural|slow60v1", "locale": "pl-PL"}
  ]
}
```

Voice suffix conventions match the Android client:
- bare voice (`pl-PL-ZofiaNeural`) → normal rate
- `|slow50v3` → -50% rate (legacy; existing cached mp3s on device use this key)
- `|slow60v1` → -60% rate (current default for all newly generated content)

Response:
```json
{
  "summary": {"requested": 2, "synthesized": 2, "cached": 0, "failed": 0},
  "manifest": [
    {
      "text": "ja jestem", "voice": "pl-PL-ZofiaNeural", "locale": "pl-PL",
      "sha1": "abc...123", "url": "https://pub-5a7344.../langbang/audio/abc...123.mp3",
      "uploaded": true
    },
    ...
  ]
}
```

The Android app uses the `url` for each entry to download the mp3 and save it to its
local AudioCache at the same path it would have used for on-device synthesis (so all
existing playback code paths work unchanged after the first download).

## Test from terminal

```bash
ANON=$(grep ^SUPABASE_ANON_KEY ~/Documents/CodingProjects/langbang/local.properties | cut -d= -f2)
curl -X POST "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/langbang-pregen-audio" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"phrases":[{"text":"ja jestem","voice":"pl-PL-ZofiaNeural","locale":"pl-PL"}]}' \
  | jq
```
