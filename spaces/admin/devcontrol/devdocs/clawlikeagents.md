# AI Agents — Alpaca Playhouse

> All AI agents serving Alpaca Playhouse operations, resident experience, and personal use.

---

## Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │         Cloud (Hostinger VPS)    │
                    │    93.188.164.224 · Port 43414   │
                    │                                  │
                    │  ┌───────────┐  ┌────────────┐  │
                    │  │ AlpaClaw  │  │    PAI      │  │
                    │  │ (Kuntur)  │  │ (Pakucha)  │  │
                    │  │ OpenClaw  │  │ Edge Fn +   │  │
                    │  │ Gateway   │  │ Web Chat    │  │
                    │  └─────┬─────┘  └─────┬──────┘  │
                    │        │              │          │
                    │   Gemini Flash    Gemini Pro     │
                    └────────┼──────────────┼──────────┘
                             │              │
         ┌───────────────────┼──────────────┼───────────────────┐
         │                   │   Supabase   │                   │
         │              Edge Functions + DB                     │
         │         ask-question (Flash Lite)                    │
         └─────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │     Local (Alpuca · Mac Mini M4) │
                    │       192.168.1.200 · 24GB RAM   │
                    │                                  │
                    │  ┌───────────┐  ┌────────────┐  │
                    │  │  Hermes   │  │  Hermes    │  │
                    │  │  (Rahul)  │  │  (Sonia)   │  │
                    │  │ @Herpuca  │  │  @Sonia's  │  │
                    │  │   Bot     │  │   Bot      │  │
                    │  └─────┬─────┘  └─────┬──────┘  │
                    │        │              │          │
                    │     Ollama · Gemma 4 26B (MoE)   │
                    │     + Qwen 2.5 Coder 14B         │
                    └─────────────────────────────────┘
```

---

## 1. AlpaClaw (Kuntur)

| | |
|---|---|
| **Type** | OpenClaw Gateway agent |
| **Spirit Name** | AlpaClaw / Kuntur |
| **Domain** | Exterior — operations, orchestration, action |
| **Host** | Hostinger KVM 4 VPS (`93.188.164.224`) |
| **Container** | `ghcr.io/hostinger/hvps-openclaw:latest` (v2026.2.23) |
| **Port** | 43414 (TCP) |
| **Config** | `/docker/openclaw-vnfd/data/.openclaw/openclaw.json` |
| **Workspace** | `/docker/openclaw-vnfd/data/.openclaw/workspace/` |
| **Personality** | Playful, protective, action-oriented, builder energy |

### Models

| Model | Use | Cost |
|-------|-----|------|
| **Gemini 2.5 Flash** | Routing, delegation, general tasks (80%+ of requests) | ~$0.15/$3.50 per 1M tokens |
| **Gemini 2.5 Flash Lite** | Simple tasks, cheap batch operations | Cheapest |
| **Gemini 2.5 Pro** | Complex reasoning, deep analysis (reserved) | ~$1.25/$10 per 1M tokens |
| **Gemini 2.5 Flash Image** | Image generation | ~$0.039/image |

### Channels

- Discord: `#alpaclaw`
- WhatsApp: `424-234-1750`
- Telegram: pending
- Signal: supported

### Sub-Agents

| Sub-Agent | Model | Purpose |
|-----------|-------|---------|
| **Research** | Gemini 2.5 Pro | Deep analysis, strategic planning |
| **Automation** | Gemini 2.5 Flash Lite | Batch operations, formatting |
| **Smart Home** | Planned | Direct IoT device control |

### Capabilities

- Multi-channel messaging gateway
- Property management automation
- Smart home orchestration (via HAOS)
- Payment processing coordination
- Maintenance tracking and dispatch
- Multi-agent task delegation

---

## 2. PAI (Pakucha)

| | |
|---|---|
| **Type** | Edge Function + Voice + Web Chat |
| **Spirit Name** | PAI / Pakucha (Quechua: little alpaca) |
| **Domain** | Interior — smart home, web chat, voice, email, comfort, well-being |
| **Edge Function** | `supabase/functions/alpaca-pai/index.ts` |
| **Personality** | Warm, nurturing, concierge energy, poetic Andean wisdom |

### Models

| Model | Use |
|-------|-----|
| **Gemini 2.5 Pro** | Primary — all interactions |

### Channels

- Discord: `#pai-in-the-sky`
- Web chat widget (resident pages)
- Voice calls (Vapi phone integration)
- Email: `pai@alpacaplayhouse.com`

### Capabilities

- House concierge (spaces, amenities, rules, tips)
- Smart home status monitoring (63 Govee lights, 12 Sonos zones, 3 Nest thermostats)
- Smart home control (lights, thermostats, music, cameras)
- Friendly reminders (departure checklists, events, laundry)
- Encouragement and inspiration
- Handoff to AlpaClaw for operations tasks

### PAI vs AlpaClaw

| | PAI | AlpaClaw |
|---|---|---|
| **Orientation** | Responsive — tends and nurtures | Proactive — takes action |
| **Tone** | "I'm here. Take your time." | "Done. What's next?" |
| **Domain** | House knowledge, comfort | Operations, tasks, coordination |

---

## 3. ask-question

| | |
|---|---|
| **Type** | Supabase Edge Function |
| **File** | `supabase/functions/ask-question/index.ts` |
| **Model** | Gemini 2.5 Flash Lite |
| **Purpose** | Resident-facing Q&A for space info, FAQs, event hosting |

### Capabilities

- Loads context from site-content storage
- Confidence assessment (HIGH/LOW)
- Logs questions to `faq_entries` for admin review
- Rate-limit retry logic (3 attempts, exponential backoff)
- Cannot control devices — redirects to resident portal

---

## 4. Hermes Agent — Rahul

| | |
|---|---|
| **Type** | Hermes Agent (Nous Research) v0.7.0+ |
| **Host** | Alpuca (Mac Mini M4, 24GB RAM) — `192.168.1.200` |
| **Install Dir** | `~/.hermes/` |
| **Config** | `~/.hermes/config.yaml` |
| **Service** | LaunchAgent `com.hermes-agent` (PID auto-restarts) |
| **Telegram** | @HerpucaBot |
| **Allowed Users** | `1384425631` (Rahul) |

### Models

| Model | Size | Config Key | Use |
|-------|------|------------|-----|
| **hermes-gemma4** | 17 GB | `model.default` | Default — Gemma 4 26B MoE + 32K context. ~4 min responses |
| **hermes-gemma4-fast** | 9.6 GB | Switch via `/model` | Quick tasks — Gemma 4 E4B + 32K context. ~1-2 min responses |
| **qwen2.5-coder:14b** | 9.0 GB | Switch via `/model` | Coding tasks |

### Disabled Telegram Tools

browser, image_gen, moa, tts, vision, code_execution, delegation — disabled to reduce prompt size and speed up inference on local models.

### Known Issues

1. **UnboundLocalError in gateway/run.py** — Python closure scoping bug. Patched by capturing `_user_message = message` before `run_sync()`. Patch lost on `hermes update`.
2. **Message interruption** — Sending multiple messages while bot is typing cancels inference. Send one message and wait.

---

## 5. Hermes Agent — Sonia

| | |
|---|---|
| **Type** | Hermes Agent (Nous Research) v0.7.0+ |
| **Host** | Alpuca (Mac Mini M4) — same machine, separate config |
| **Install Dir** | `~/.hermes-guest/` (uses `HERMES_HOME` env var) |
| **Config** | `~/.hermes-guest/config.yaml` |
| **Service** | LaunchAgent `com.hermes-agent-guest` |
| **Telegram** | Sonia's bot |
| **Allowed Users** | `6058336570` (Sonia Wendorff) |

### Models

Same as Rahul's instance — shares Ollama on localhost:11434.

### Capabilities

- Coding, research, writing, creative tasks
- Claude CLI access (terminal tool enabled)
- File read/write on Alpuca
- Home automation (lights, music, cameras, thermostats)
- Same disabled Telegram tools as Rahul's instance

---

## 6. Claude Code (CLI)

| | |
|---|---|
| **Type** | Anthropic CLI agent |
| **Model** | Claude Opus 4.6 (via Max subscription) |
| **Host** | Alpuca + MacBook Air (local CLI) |
| **Access** | Subscription only — no `ANTHROPIC_API_KEY` exists |

### Use

- Primary development agent for AlpacApps codebase
- Runs as subprocess from Hermes when needed
- Full codebase access, git, deploy capabilities
- Not a messaging bot — invoked from terminal only

---

## Model Provider Summary

| Provider | Models | Used By | Cost |
|----------|--------|---------|------|
| **Ollama (local)** | Gemma 4 26B, Gemma 4 E4B, Qwen 2.5 Coder 14B | Hermes (both instances) | Free |
| **Google AI** | Gemini 2.5 Flash, Flash Lite, Pro, Flash Image | AlpaClaw, PAI, ask-question | Pay-per-token |
| **Anthropic** | Claude Opus 4.6 | Claude Code CLI | Max subscription ($) |

---

## Adding a New Hermes Instance

To add a new person with their own Hermes bot:

1. **Create config directory:** `cp -R ~/.hermes ~/.hermes-{name}`
2. **Create Telegram bot** via @BotFather, get token
3. **Get user's Telegram ID** via @userinfobot
4. **Edit `.env`:** Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USERS`
5. **Edit `SOUL.md`:** Customize identity and permissions
6. **Disable heavy tools:** `HERMES_HOME=~/.hermes-{name} hermes tools disable browser image_gen moa tts vision code_execution delegation --platform telegram`
7. **Create LaunchAgent** `com.hermes-agent-{name}.plist` with `HERMES_HOME` env var and PID cleanup wrapper
8. **Load:** `launchctl load ~/Library/LaunchAgents/com.hermes-agent-{name}.plist`

---

## Changing Hermes Models

Hermes supports any OpenAI-compatible LLM provider. Configuration methods:

### Via config.yaml

```yaml
model:
  default: hermes-gemma4       # Model name (Ollama, OpenRouter, etc.)
  provider: custom             # Provider type
  base_url: http://localhost:11434/v1  # OpenAI-compatible endpoint
```

### Via CLI

```bash
hermes model                    # Show current model
hermes config set model.default "modelname"
```

### Via Telegram

Send `/model` in chat to switch between available models.

### Supported Providers

| Provider | Config `provider` | Requires |
|----------|-------------------|----------|
| Ollama (local) | `custom` | `base_url` pointing to Ollama |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` in `.env` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` in `.env` |
| OpenAI | `openai` | `OPENAI_API_KEY` in `.env` |
| Any OpenAI-compatible | `custom` | `base_url` in config |
| MiniMax | `minimax` | `MINIMAX_API_KEY` in `.env` |
| Kimi / Moonshot | `kimi` | `KIMI_API_KEY` in `.env` |
| GLM / z.ai | `glm` | `GLM_API_KEY` in `.env` |
| Hugging Face | `huggingface` | `HF_TOKEN` in `.env` |

### Creating Custom Ollama Models

Bake in parameters (like context length) with Ollama modelfiles:

```bash
ollama create my-model -f- <<EOF
FROM gemma4:26b
PARAMETER num_ctx 32768
PARAMETER temperature 0.7
EOF
```

Then set `model.default: my-model` in config.yaml.

---

*Updated 2026-04-05.*
