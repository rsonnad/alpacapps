# External Systems & Integrations

> Reference file for Claude. Read on-demand when working with specific integrations.

## SignWell (E-Signatures)
- API Key: Stored in `signwell_config` table (not hardcoded)
- API Base: `https://www.signwell.com/api/v1`
- **Workflow:** Admin generates PDF from lease template -> Admin clicks "Send for Signature" -> SignWell API creates document -> Tenant receives email, signs -> Webhook notifies system -> downloads signed PDF -> stores in Supabase -> `agreement_status` updated to "signed"

## Resend (Email)
- **Domain**: `alpacaplayhouse.com` (verified, sending + receiving)
- **Outbound**: `send-email` Edge Function (43 templates)
  - From: `notifications@alpacaplayhouse.com` (forwarded) or `noreply@alpacaplayhouse.com` (system)
  - Client service: `shared/email-service.js`
- **Inbound**: `resend-inbound-webhook` Edge Function (`--no-verify-jwt`)
  - Webhook payload doesn't include body -- fetched separately via Resend API
- **DNS** (GoDaddy): MX @ -> `inbound-smtp.us-east-1.amazonaws.com`, SPF/DKIM records
- **Inbound Routing** (`*@alpacaplayhouse.com`):
  - `haydn@` -> `hrsonnad@gmail.com`
  - `rahulio@` -> `rahulioson@gmail.com`
  - `sonia@` -> `sonia245g@gmail.com`
  - `team@` -> `alpacaplayhouse@gmail.com`
  - `herd@` -> stub (future AI processing)
  - `auto@` -> Bug report replies -> new bug report; others -> admin
  - `pai@` -> Gemini classifies -> questions/commands get PAI reply; documents uploaded to R2; other forwarded to admin
  - Everything else -> `alpacaplayhouse@gmail.com`

## Telnyx (SMS)
- Config in `telnyx_config` table (api_key, messaging_profile_id, phone_number, test_mode)
- Outbound: `send-sms` Edge Function
- Inbound: `telnyx-webhook` Edge Function -> `sms_messages` table
- Client: `shared/sms-service.js` (mirrors email-service.js pattern)

## DigitalOcean Droplet
- Runs OpenClaw Discord bot and Bug Scout
- **Workers:** Bug Scout (`bug-fixer.service`), Tesla Poller (`tesla-poller.service`), Image Gen (`image-gen.service`), LG Poller (`lg-poller.service`), Feature Builder (`feature-builder.service`)
- Bug fixer repo is a clone of this repo, used for verification screenshots

## Home Automation (Sonos, UniFi, Cameras)
- Full docs in `HOMEAUTOMATION.md`, credentials in `HOMEAUTOMATION.local.md`
- Alpaca Mac bridges DO droplet to local LAN via Tailscale
- Sonos HTTP API port 5005: play, pause, volume, favorites, TTS (12 zones)
- UniFi Network API on UDM Pro port 443

## Google Nest (Thermostats)
- **API**: Google SDM API, OAuth 2.0 with refresh token in `nest_config`
- **Devices**: 3 thermostats -- Master, Kitchen, Skyloft
- **Edge function**: `nest-control` (token refresh + SDM API proxy)
- **Temp**: SDM uses Celsius, UI shows Fahrenheit, edge function converts
- **Rate limit**: 5 QPS per SDM project
- **OAuth setup**: One-time admin flow via Climate tab Settings

## OpenWeatherMap (Weather)
- One Call API 3.0 (with 2.5 free tier fallback)
- Config in `weather_config` table
- Location: Cedar Creek, TX (30.13, -97.46)
- Client-side only, no edge function needed

## AI Image Generation (Gemini)
- Worker: `/opt/image-gen/worker.js` on DO droplet (`image-gen.service`)
- API: Gemini 2.5 Flash Image, ~$0.039/image
- Storage: `housephotos/ai-gen/` in Supabase Storage
- DB: `image_gen_jobs` table (job queue), results -> `media` table
- Nano Banana MCP in `.mcp.json` for interactive Claude Code sessions

## Tesla Vehicle Data + Commands
- Worker: `/opt/tesla-poller/worker.js` on DO droplet (`tesla-poller.service`)
- API: Tesla Fleet API (`fleet-api.prd.na.vn.cloud.tesla.com`)
- App: "Tespaca" registered at developer.tesla.com
- Polling every 5 min, sleep-aware
- 6 cars: Casper (3 2019), Delphi (Y 2023), Sloop (Y 2026), Cygnus (Y 2026), Kimba (Y 2022), Brisa Branca (3 2022)
- Commands: `tesla-command` edge function (lock, unlock, wake, flash, honk)
- Client: `residents/cars.js` polls Supabase every 30s

## Camera Streaming (go2rtc + Caddy)
- go2rtc v1.9.14 on Alpaca Mac, 3 UniFi G5 PTZ cameras x 3 qualities
- `rtspx://` protocol (RTSP over TLS, no SRTP)
- Caddy proxy: `cam.alpacaplayhouse.com/api/*` -> go2rtc:1984 via Tailscale
- HLS URL: `https://cam.alpacaplayhouse.com/api/stream.m3u8?src={stream_name}&mp4`
- HLS fMP4 mode (`&mp4`) required -- without it, segments contain only audio
- PTZ via UniFi Protect API

## Camera Talkback (Two-Way Audio)
- Relay: `scripts/talkback-relay/talkback-relay.js` on Alpaca Mac
- WebSocket (port 8902) -> FFmpeg -> UDP to camera:7004
- Audio: Browser PCM 48kHz mono -> FFmpeg -> AAC-ADTS 22.05kHz mono 32kbps
- Cameras: Alpacamera (.173), Front Of House (.182), Side Yard (.110)

## LG ThinQ (Washer/Dryer)
- API: LG ThinQ Connect REST API (PAT auth from connect-pat.lgthinq.com)
- API Base: `https://api-aic.lgthinq.com`
- Worker: `lg-poller` on DO droplet, every 30s
- Edge function: `lg-control` (status, control, watch/unwatch, push tokens)
- Devices: Washer (.246), Dryer (.22)
- Washer states: POWER_OFF, INITIAL, DETECTING, RUNNING, RINSING, SPINNING, DRYING, STEAM_SOFTENING, COOL_DOWN, RINSE_HOLD, REFRESHING, PAUSE, RESERVED, END, SLEEP, ERROR
- Dryer states: POWER_OFF, INITIAL, RUNNING, PAUSE, END, ERROR, DIAGNOSIS, RESERVED

## Vapi (AI Voice Calling)
- Server URL pattern: Vapi calls `vapi-server` for assistant config dynamically
- Caller ID matching -> personalized greeting
- Tool integration via PAI (smart home, Q&A, send links via SMS)
- Admin UI: `spaces/admin/voice.html`
- Cost: ~$0.10-$0.30 per call

## PayPal (Associate Payouts)
- Payouts API with OAuth client credentials flow
- Edge functions: `paypal-payout` (send) + `paypal-webhook` (status)
- Sandbox + production mode, gated on identity verification

## Airbnb (iCal Sync)
- Edge functions: `airbnb-sync` (fetch), `ical` (export), `regenerate-ical` (on changes)
- Parent cascade: blocking parent blocks all child spaces

## Cloudflare R2 (Object Storage)
- Bucket: `alpacapps`, S3-compatible API with AWS Sig V4
- Public URL: `https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev`
- Shared helper: `supabase/functions/_shared/r2-upload.ts`
- Key paths: `documents/` (manuals, guides for PAI)
- 10 GB free, zero egress fees

## Square (Payments)
- Client-side tokenization via `shared/square-service.js`
- Edge functions: `process-square-payment`, `refund-square-payment`
- Pricing: 2.6% + $0.10 per transaction
