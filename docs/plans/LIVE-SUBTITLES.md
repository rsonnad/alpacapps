# Alpaca Playhouse — Live Translation Subtitles

## Overview

Real-time speech-to-text + translation system that lets guests follow conversations and events in their own language on their phone. A central microphone captures speech, a server transcribes and translates, and each guest's mobile app displays rolling subtitles in their chosen language.

**Primary use cases:**
- Events with multilingual guests (speaker in English, subtitles in Polish/Spanish/etc.)
- Property tours and house rules walkthrough
- Casual conversation between guests who don't share a language

**Target languages:** English, Polish, Spanish, French, German, Portuguese, Italian, Hindi, Arabic

---

## Architecture

```
┌─────────────────┐
│  Room Microphone │  USB mic, Jabra Speak, or conference mic
└────────┬────────┘
         │ audio stream (WebSocket or chunked PCM)
         ▼
┌─────────────────────────────────────────────┐
│           Subtitle Server (Alpuca)          │
│                                             │
│  ┌───────────┐   ┌──────────────────────┐   │
│  │  STT      │──▶│  Translation Fan-Out │   │
│  │  Engine   │   │  (per requested lang) │   │
│  └───────────┘   └──────────┬───────────┘   │
│                             │               │
│  ┌──────────────────────────▼────────────┐  │
│  │  WebSocket Server                     │  │
│  │  /ws/subtitles?lang=pl                │  │
│  │  /ws/subtitles?lang=en (transcript)   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │ WebSocket push
         ▼
┌─────────────────────────┐
│  Guest Phones            │
│  (AlpacApps native app)  │
│                          │
│  ┌────────────────────┐  │
│  │ Language picker     │  │
│  │ Rolling subtitles   │  │
│  │ Font size control   │  │
│  └────────────────────┘  │
└─────────────────────────┘
```

---

## Components

### 1. Mic Input Capture

**Hardware options (pick one):**
| Option | Price | Notes |
|--------|-------|-------|
| Jabra Speak 510 | ~$100 | Conference speakerphone, USB, good pickup radius |
| Blue Yeti | ~$100 | Studio quality, USB, better for single-speaker events |
| Rode Wireless GO II | ~$250 | Clip-on wireless, best for mobile speaker |
| Existing USB mic | $0 | Test with whatever's available first |

**Software:** PyAudio or `arecord` capturing 16kHz mono PCM, streamed to STT engine via local pipe or WebSocket.

### 2. Speech-to-Text (STT) Engine

**Option A — Self-hosted on Alpuca (free, ~3s latency):**
- Whisper.cpp with `medium` or `large-v3` model
- M4 Mac Mini handles real-time transcription easily
- ~1.5GB RAM for medium, ~3GB for large
- Chunked processing: 5-second audio windows with 1-second overlap
- Output: timestamped text segments

**Option B — Cloud STT (cheap, ~1.5s latency):**
- Deepgram Nova-2 streaming API ($0.0043/min)
- Native WebSocket streaming — no chunking needed
- Better accuracy, especially for accented speech
- Polish language support included

**Recommendation:** Start with Deepgram for quality/latency, fall back to local Whisper if cost matters at scale.

### 3. Translation Engine

**Option A — Cloud translation (best quality):**
| Service | Polish support | Cost per 1M chars | Notes |
|---------|---------------|-------------------|-------|
| DeepL API | Excellent | $5.49 (Pro) | Best Polish quality |
| Google Translate | Good | $20 | Widest language coverage |
| Azure Translator | Good | $10 | Free 2M chars/month |

**Option B — Self-hosted on Alpuca (free):**
- Helsinki-NLP/opus-mt models (one per language pair)
- ~500MB per model, fast inference on M4
- Quality: good for common phrases, weaker on idioms
- Run via Ollama or direct HuggingFace transformers

**Translation caching:**
- Cache translated segments by source hash + target language
- If 3 guests want Polish, translate once, broadcast to all
- Typical cache hit rate: 0% (real-time speech is unique) — cache is mainly for repeated phrases

**Recommendation:** DeepL for Polish (their standout language), Azure free tier for others.

### 4. WebSocket Server

**Tech:** Node.js with `ws` library (matches existing edge function patterns) or Python FastAPI with `websockets`.

**Endpoints:**
```
ws://alpuca.local:8910/subtitles?lang=en    # Original transcript
ws://alpuca.local:8910/subtitles?lang=pl    # Polish translation
ws://alpuca.local:8910/subtitles?lang=es    # Spanish translation
```

**Message format:**
```json
{
  "id": "seg_001",
  "text": "Witamy w Alpaca Playhouse",
  "lang": "pl",
  "source_lang": "en",
  "source_text": "Welcome to Alpaca Playhouse",
  "timestamp": 1711800000,
  "is_partial": false
}
```

- `is_partial: true` for interim results (updates in-place on client)
- `is_partial: false` for finalized segments (appended to history)

**Connection management:**
- Track connected clients per language
- Only translate to languages with active listeners
- Heartbeat ping every 30s, auto-reconnect on client side

### 5. Mobile App — Subtitle View

**New screen in both iOS (Swift) and Android (Kotlin) apps.**

#### UI Layout
```
┌──────────────────────────────┐
│  Live Subtitles    [EN ▼] 🔤 │  ← language picker + font size
│──────────────────────────────│
│                              │
│  Welcome to Alpaca Playhouse │
│                              │
│  The WiFi password is on the │
│  card in your room           │
│                              │
│  ░░░░░░░░░░░░░░░            │  ← partial/incoming text (dimmed)
│                              │
│                              │
│                              │
└──────────────────────────────┘
```

#### Features
- **Language picker:** Dropdown at top, defaults to phone locale
- **Font size:** A/🔤 button cycles Small → Medium → Large → Extra Large
- **Auto-scroll:** New text appears at bottom, auto-scrolls (pause on manual scroll-up)
- **Partial results:** Show interim STT in gray, replace with final in white
- **Dark mode:** Dark background by default (easier to read in event settings)
- **History:** Keep last 50 segments, scrollable
- **Connection status:** Green dot = live, yellow = reconnecting, red = disconnected

#### iOS (SwiftUI)
```swift
// New files:
// Views/SubtitleView.swift       — main UI
// Services/SubtitleService.swift — WebSocket client + reconnect logic
// Models/SubtitleSegment.swift   — data model

// SubtitleService connects to ws://alpuca.local:8910/subtitles?lang={lang}
// Uses URLSessionWebSocketTask (native, no dependencies)
// Reconnect with exponential backoff (1s, 2s, 4s, max 30s)
```

#### Android (Kotlin/Compose)
```kotlin
// New files:
// ui/subtitles/SubtitleScreen.kt       — Compose UI
// services/SubtitleService.kt          — WebSocket client
// models/SubtitleSegment.kt            — data model

// Uses OkHttp WebSocket (already in dependency tree)
// Same reconnect strategy as iOS
```

#### Entry point
- New tab/button in the app's home screen: "Live Subtitles" (icon: speech bubble with translate symbol)
- Only visible when subtitle server is broadcasting (check via HTTP health endpoint)

---

## Network & Connectivity

**On-premise (LAN):**
- Guests on Alpaca Playhouse WiFi connect directly to `alpuca.local:8910`
- Lowest latency (~1.5s), no internet needed for self-hosted STT+translation
- mDNS resolution for `.local` domain

**Remote / Tailscale:**
- Expose via Tailscale: `100.74.59.97:8910`
- Or tunnel through Hostinger with Caddy reverse proxy: `wss://subtitles.alpaclaw.cloud`

**Fallback:** If WebSocket blocked, fall back to SSE (Server-Sent Events) over HTTPS.

---

## Cost Analysis

### Per-hour cost (50% speaking time = 30 min audio, ~27K chars)

| Setup | STT | Translation | Total/hr |
|-------|-----|-------------|----------|
| **All cloud** | Deepgram: $0.13 | DeepL: $0.15 | **$0.28** |
| **Hybrid** (cloud STT, local translate) | $0.13 | $0 | **$0.13** |
| **All local** (Alpuca) | $0 | $0 | **$0.00** |

### Monthly estimates

| Usage | All cloud | Hybrid | All local |
|-------|-----------|--------|-----------|
| 2 events/week, 2 hrs each | $4.48 | $2.08 | $0 |
| Daily use, 4 hrs/day | $33.60 | $15.60 | $0 |
| Always-on ambient (12 hrs/day) | $100.80 | $46.80 | $0 |

### One-time costs
- Conference mic: $0–250 (may already have one)
- No additional server hardware (Alpuca M4 handles everything)

---

## Implementation Phases

### Phase 1: Server MVP (1-2 days)
- [ ] Python/Node server: mic capture → Deepgram streaming STT → WebSocket broadcast (English transcript only)
- [ ] Health endpoint: `GET /subtitles/status` returns `{ "active": true, "listeners": 3, "languages": ["en","pl"] }`
- [ ] Test with browser client (simple HTML page with WebSocket listener)
- [ ] Deploy on Alpuca as systemd service

### Phase 2: Translation (1 day)
- [ ] Add DeepL integration for Polish + Spanish
- [ ] Add Helsinki-NLP local models as fallback
- [ ] Language-based fan-out: only translate to languages with active listeners
- [ ] Cache layer for repeated phrases

### Phase 3: Mobile App Integration (2-3 days)
- [ ] iOS SubtitleView + SubtitleService
- [ ] Android SubtitleScreen + SubtitleService
- [ ] Language picker with phone locale default
- [ ] Font size control
- [ ] Auto-scroll with manual override
- [ ] Connection status indicator
- [ ] Conditional visibility (only show when server is broadcasting)

### Phase 4: Polish & Production (1-2 days)
- [ ] Partial result rendering (interim gray text)
- [ ] Reconnect logic with exponential backoff
- [ ] Dark mode optimized for event lighting
- [ ] Tailscale / Caddy tunnel for remote access
- [ ] Logging: session duration, languages requested, character counts → `api_usage_log`

### Phase 5: Enhancements (future)
- [ ] Speaker diarization (label "Speaker 1", "Speaker 2")
- [ ] TTS output: read translations aloud via ElevenLabs/Voxtral (for accessibility)
- [ ] Kiosk/TV display mode (large text, auto-scroll, no controls)
- [ ] Saved transcripts: export event transcript to PDF/email
- [ ] Whisper local fallback: auto-switch if Deepgram is down or budget exceeded

---

## Dependencies & API Keys

| Service | Key location | Free tier |
|---------|-------------|-----------|
| Deepgram | Bitwarden (to be created) | $200 free credit on signup |
| DeepL | Bitwarden (to be created) | 500K chars/month |
| Azure Translator | Bitwarden (to be created) | 2M chars/month |
| Helsinki-NLP models | Local on Alpuca | Unlimited (open source) |
| Whisper.cpp | Local on Alpuca | Unlimited (open source) |

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| High ambient noise reduces STT accuracy | Use directional mic; Deepgram has noise suppression; test mic placement |
| Multiple simultaneous speakers | Deepgram supports multichannel; consider lapel mics for structured events |
| Polish translation quality | DeepL is best-in-class for Polish; test with native speaker |
| WiFi congestion during events | WebSocket is lightweight (~1KB/s per client); not a concern |
| Alpuca CPU load | Whisper medium uses ~30% of M4; translation models are tiny; plenty of headroom |
| Guest app adoption | Show QR code on event screen linking to app download + subtitle page |
