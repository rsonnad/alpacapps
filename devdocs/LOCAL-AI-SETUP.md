# Local AI Setup Guide

> For installing Atomic Chat + Ollama on any Apple Silicon Mac.
> Alpuca (Mac mini M4 24GB) is already set up — this guide is for additional machines.

## What's Installed on Alpuca (192.168.1.200)

| Component | Version | Location |
|-----------|---------|----------|
| Atomic Chat | v1.1.6 | `/Applications/Atomic Chat.app` |
| Ollama | v0.18.3 | `brew services` (auto-starts on boot) |
| Qwen 3.5 9B (Q8) | 10 GB | Default model — best for tool-calling, coding, structured output |
| Qwen 3 14B (Q4) | 9.3 GB | Heavy reasoning — use for complex logic/math |

Ollama API: `http://192.168.1.200:11434` (accessible from LAN)
Atomic Chat API: `http://localhost:1337` (local only, when app is open)

---

## Install on MacBook Air (or any Mac)

### Step 1: Install Atomic Chat

```bash
# Download DMG from Alpuca over LAN (faster than GitHub)
scp alpuca@192.168.1.200:/tmp/AtomicChat.dmg /tmp/AtomicChat.dmg

# If that file is gone, download from GitHub:
# curl -L -o /tmp/AtomicChat.dmg "https://github.com/AtomicBot-ai/Atomic-Chat/releases/download/v1.1.6/Atomic.Chat_1.1.6_universal.dmg"

# Mount, install, eject
hdiutil attach /tmp/AtomicChat.dmg -nobrowse
cp -R "/Volumes/Atomic Chat/Atomic Chat.app" /Applications/
hdiutil detach "/Volumes/Atomic Chat"
rm /tmp/AtomicChat.dmg
```

### Step 2: Install Ollama

```bash
brew install ollama
brew services start ollama
```

### Step 3: Pull Models

For **16GB RAM** MacBook Air — use Q4 quantization (not Q8) to leave room for macOS:

```bash
# Primary model — fast, great for daily use (5.6 GB)
ollama pull qwen3.5:9b

# Optional: reasoning model at smaller quant (9.3 GB — tight on 16GB, skip if unsure)
# ollama pull qwen3:14b
```

For **24GB+ RAM** — match Alpuca's setup:

```bash
ollama pull qwen3.5:9b-q8_0    # 10 GB — higher fidelity
ollama pull qwen3:14b           # 9.3 GB — reasoning
```

### Step 4: Verify

```bash
ollama list
ollama run qwen3.5:9b "Hello, what model are you?"
```

---

## Model Comparison

| | Qwen 3.5 9B (Q8) | Qwen 3.5 9B (Q4) | Qwen 3 14B (Q4) |
|---|---|---|---|
| **Size** | 10 GB | 5.6 GB | 9.3 GB |
| **Min RAM** | 24 GB | 16 GB | 24 GB |
| **Speed** | ~18-22 tok/s | ~22+ tok/s | ~10 tok/s |
| **Accuracy** | Highest (8-bit) | Good (4-bit) | Good brain, fuzzy quant |
| **Best for** | Tool-calling, coding, API backend | Daily chat, language learning, offline use | Complex reasoning, math, logic |
| **Multimodal** | Yes (text + image + video) | Yes | Text only |
| **Languages** | 201 | 201 | Fewer |

---

## Use Cases

### As OpenClaw Backend (Alpuca)
Point OpenClaw edge functions at `http://192.168.1.200:11434/v1/chat/completions` (OpenAI-compatible endpoint). Zero token cost.

### Claude Max Overflow
When you hit your Claude subscription cap, use Atomic Chat or `ollama run qwen3.5:9b` as a fallback.

### Airplane / Offline (MacBook Air)
Works fully offline after model download. Great for language lessons, writing, code review.

### Big File Processing
Feed large docs into the 50K context window for summarization, analysis, extraction.

---

## Ollama Useful Commands

```bash
ollama list                     # Show installed models
ollama run qwen3.5:9b-q8_0     # Interactive chat
ollama run qwen3:14b            # Switch to reasoning model
ollama ps                       # Show loaded models (RAM usage)
ollama stop qwen3.5:9b-q8_0    # Unload from RAM
brew services stop ollama       # Stop background service
brew services start ollama      # Start background service
```

## Ollama API Examples

```bash
# Simple completion
curl http://localhost:11434/api/generate -d '{
  "model": "qwen3.5:9b-q8_0",
  "prompt": "Explain recursion in one sentence",
  "stream": false
}'

# OpenAI-compatible chat endpoint (for app integrations)
curl http://localhost:11434/v1/chat/completions -d '{
  "model": "qwen3.5:9b-q8_0",
  "messages": [{"role": "user", "content": "Hello"}]
}'
```

---

## Network Access (Alpuca as LAN AI Server)

By default, ollama binds to `localhost`. To serve other machines on LAN:

```bash
# Set in ~/.zshrc or launchctl env:
export OLLAMA_HOST=0.0.0.0

# Then restart:
brew services restart ollama
```

After this, any device on the network can use `http://192.168.1.200:11434` as an AI API.

---

*Installed 2026-03-27. Atomic Chat v1.1.6, Ollama v0.18.3.*
