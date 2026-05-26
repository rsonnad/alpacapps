# Local AI Setup Guide

> Operational reference for the local LLM stack on Alpuca (Mac mini M4, 24GB
> RAM). When you bring up a new Apple-Silicon Mac, this is the recipe.
>
> Cross-refs:
> - `clawlikeagents.md` — agent routing (AlpaClaw, PAI, Hermes), when to call which model
> - `ALPUCA-MACHINE.md` — hardware, background services, the runaway-process tripwire

## Where models live

Models are stored on the external NVMe **PortoSams2T**, symlinked from the
canonical home Ollama looks for. This was done because the internal 228 GB SSD
was at 97 % when models accumulated locally — and the external Samsung NVMe
benchmarks faster than the internal in both reads and writes.

```
~/.ollama  →  /Volumes/PortoSams2T/alpuca-offload/ollama  (symlink)
```

**Implication:** if `/Volumes/PortoSams2T` is ever unmounted, Ollama can't
load models. Reads from the launchd Ollama service will fail until the drive
is back. The drive is set up as a permanent mount.

To verify the symlink:

```bash
ls -la ~/.ollama   # should show "-> /Volumes/PortoSams2T/alpuca-offload/ollama"
```

## Active model lineup

Pulled from the public Ollama registry. All "up to date" as of last review.

| Model | Size | Role | RAM at load | When to use |
|---|---|---|---|---|
| `qwen3:30b-a3b` | 18 GB | General / reasoning (MoE, 3B active) | ~14 GB | Default chat, planning, summarization. Has built-in `/think` mode. |
| `qwen3-coder:30b` | 18 GB | Coding | ~14 GB | Code generation, refactors, tool calling, structured JSON output. |
| `qwen3-vl:30b-a3b` | 19 GB | Vision + reasoning (MoE) | ~14 GB | Screenshots, photo content, OCR-lite, image-grounded Q&A. |
| `deepseek-r1:32b` | 19 GB | Reasoning specialist | ~17 GB | Chain-of-thought for math, multi-step debugging, test edge-case enumeration. Slow. |
| `qwen2.5-coder:14b` | 9 GB | Lighter coding | ~9 GB | Fast pass for small coding tasks when 30b is overkill. |
| `glm-ocr` | 2.2 GB | OCR | ~3 GB | Pure text extraction from images / scanned docs. |

**RAM math (24 GB Alpuca):** only one large model should load at a time.
Alpuca's LaunchAgent sets `OLLAMA_MAX_LOADED_MODELS=1`,
`OLLAMA_NUM_PARALLEL=1`, and `OLLAMA_KEEP_ALIVE=2m` so inactive models unload
quickly. Switching models incurs a ~15–30 s warm-up.

### MoE (mixture of experts) — why the 30 B Qwen 3s are fast

`qwen3:30b-a3b`, `qwen3-coder:30b`, `qwen3-vl:30b-a3b` all use a MoE
architecture: the model has 30 B total parameters but only ~3 B activate per
token. Disk footprint = 30 B; runtime cost ≈ 3 B. They feel as fast as a
small dense model.

`deepseek-r1:32b` is dense — slower per token, plus it generates many "thinking" tokens before answering.

## Custom modelfiles (legacy, scheduled for removal)

These are tag aliases of Gemma 4 26 B / e4b with custom system prompts.
Created before the Qwen 3 lineup arrived. They are superseded by
`qwen3:30b-a3b` and `qwen3-coder:30b`.

| Tag | Base | Purpose | Action |
|---|---|---|---|
| `g4f` | `gemma4:26b` | Fast Gemma alias | delete — Qwen 3 supersedes |
| `hermes-gemma4` | `gemma4:26b` | Hermes Agent default, `num_ctx 32768` | retained until Hermes config switches to Qwen |
| `hermes-gemma4-fast` | `gemma4:e4b` | Hermes faster alias | delete — Qwen 3 supersedes |
| `gemma4-opencode` | `gemma4:26b` | Coding system prompt | delete — `qwen3-coder:30b` supersedes |
| `gemma4-e4b-opencode` | `gemma4:e4b` | Lighter coding alias | delete — supersedes |
| `gemma4:26b` | (base) | Gemma 4 26B | delete once aliases gone |
| `gemma4:e4b` | (base) | Gemma 4 e4b | delete once aliases gone |

To reproduce one if you ever need it again, the original Modelfiles all
follow this shape:

```
FROM <base>
TEMPLATE {{ .Prompt }}
RENDERER gemma4
PARSER gemma4
PARAMETER num_ctx 32768
SYSTEM <optional system prompt>
```

## Quick invocation

### CLI

```bash
ollama list                          # what's available
ollama ps                            # what's loaded in RAM right now
ollama run qwen3:30b-a3b             # interactive chat
ollama stop qwen3:30b-a3b            # unload from RAM immediately
```

### HTTP API (recommended for scripts / edge functions)

Ollama exposes both a native API and an OpenAI-compatible one at port 11434.

```bash
# Native API — single-shot completion
curl -s http://localhost:11434/api/generate -d '{
  "model": "qwen3:30b-a3b",
  "prompt": "Summarize git rebase in one sentence.",
  "stream": false,
  "options": {"num_predict": 200, "temperature": 0.3}
}' | jq -r .response

# OpenAI-compatible chat endpoint — drop-in for any OpenAI SDK
curl -s http://localhost:11434/v1/chat/completions -d '{
  "model": "qwen3-coder:30b",
  "messages": [{"role":"user","content":"Write a TS isEmail()."}],
  "temperature": 0.2
}' | jq -r '.choices[0].message.content'

# Vision — pass base64-encoded image
B64=$(base64 -i screenshot.png | tr -d '\n')
curl -s http://localhost:11434/api/generate -d "$(jq -n \
  --arg img "$B64" \
  '{model:"qwen3-vl:30b-a3b",
    prompt:"Describe this screenshot.",
    images:[$img], stream:false}')" | jq -r .response
```

### Toggling Qwen 3's thinking mode

`qwen3:30b-a3b` supports a `/think` and `/no_think` prefix:

- `/think Solve: 17 * 24` → emits reasoning, slower, often more accurate.
- `/no_think Hi` → direct response, no chain of thought.

Default is `/no_think`. Use `/think` only when you actually need the
reasoning trace — `deepseek-r1:32b` is the dedicated alternative.

## Network access (Alpuca as LAN AI server)

Ollama binds to `localhost` by default, but Alpuca is intentionally configured
as a LAN/tailnet AI server. The canonical service is:

```text
~/Library/LaunchAgents/homebrew.mxcl.ollama.plist
```

Important environment in that plist:

```text
OLLAMA_HOST=0.0.0.0
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_KEEP_ALIVE=2m
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
```

There should be no manual `ollama serve` process. The old crontab `@reboot`
line that launched Ollama by hand is disabled, and `~/scripts/hermes-watchdog.sh`
kicks `homebrew.mxcl.ollama` through launchd instead of starting a second
server.

Verify:

```bash
launchctl list | grep -i ollama
lsof -nP -iTCP:11434 -sTCP:LISTEN
ollama ps
curl -sS http://127.0.0.1:11434/api/tags | jq '.models | length'
curl -sS http://192.168.1.200:11434/api/tags | jq '.models | length'
```

Any device on the LAN or tailnet can use `http://192.168.1.200:11434`.
Do not port-forward this service to the public internet; Ollama does not
provide authentication by itself.

## Integrations

### Hermes Agent

- Install dir: `~/.hermes/` (config, skills, memory, logs)
- Default model: currently `hermes-gemma4` (Gemma 4 26B + 32K context)
- Coding model: `qwen2.5-coder:14b` (switch with `/model` in Hermes)
- Service: LaunchAgent `com.hermes-agent` (auto-restarts)
- Messaging: Telegram bot (allowlisted to Rahul only)
- Skills: 74 bundled + auto-created from experience (`~/.hermes/skills/`)

**Migration TODO**: when ready, switch Hermes default to `qwen3:30b-a3b` and
coding to `qwen3-coder:30b`. Then the Gemma 4 lineage can be deleted entirely.

### msty (desktop chat UI)

- Install: download from [msty.app](https://msty.app) (free, native macOS)
- Settings → Providers → add Ollama → auto-detects `http://localhost:11434`
- Pulled models appear in the model picker automatically
- Good for: quick chat, conversation branching, knowledge bases (drag
  folders in), prompt templates, mid-conversation provider switching

### Edge functions / OpenClaw backend

Edge functions can point at `http://192.168.1.200:11434/v1/chat/completions`
(OpenAI-compatible endpoint) when on LAN, or via Tailscale from anywhere.
Zero token cost.

## Maintenance

### Checking for upgrades

The registry doesn't publish a stable "tags list" API, but you can compare
local manifest digests against remote:

```bash
# For each installed model, compare local vs remote weights digest
for tag_file in ~/.ollama/models/manifests/registry.ollama.ai/library/*/*; do
  name=$(basename "$(dirname "$tag_file")")
  tag=$(basename "$tag_file")
  local_d=$(jq -r '.layers[] | select(.mediaType|test("model")) | .digest' "$tag_file" | head -1)
  remote_d=$(curl -s -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    "https://registry.ollama.ai/v2/library/$name/manifests/$tag" \
    | jq -r '.layers[]? | select(.mediaType|test("model")) | .digest' | head -1)
  [ "$local_d" = "$remote_d" ] && echo "✓ $name:$tag" || echo "⬆ $name:$tag UPDATE AVAILABLE"
done
```

Custom modelfile tags (no `:` in the name like `g4f`, `hermes-gemma4`) won't
appear in the registry — that's expected.

### Removing models

```bash
ollama rm <model-name>           # removes the tag, garbage-collects blobs
                                  # that no other tag references
```

Blobs live in `~/.ollama/models/blobs/` (i.e., on PortoSams2T via the
symlink). Multiple tags can share a blob — e.g., `g4f` and
`hermes-gemma4-fast` both pointed at the same gemma4:e4b blob.

### Adding a new model

```bash
ollama pull <model>:<tag>        # downloads to ~/.ollama (→ PortoSams2T)
```

Inspect first:

```bash
# Check it exists and see size before pulling
curl -s -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  https://registry.ollama.ai/v2/library/<model>/manifests/<tag> \
  | jq '[.layers[].size] | add / 1024 / 1024 / 1024'
```

## Local vs cloud Claude — when to use which

| Task | Use |
|---|---|
| Anything you care about being correct | Cloud Claude (Opus / Sonnet) |
| Hard reasoning, design judgment | Cloud Claude |
| Offline / on a flight | `qwen3:30b-a3b` + `/think` |
| Image content extraction at the property | `qwen3-vl:30b-a3b` |
| Bulk text classification, no per-call cost concern | Any local model |
| Auto test edge-case enumeration in a CI script | `deepseek-r1:32b` |
| Pure OCR | `glm-ocr` |
| Burning through Claude Max quota mid-week | Switch msty to local for the rest of the day |

The local stack exists to be useful, not to replace cloud Claude. Treat them
as different tools.

---

*Last updated: 2026-05-02. PortoSams2T-backed Ollama, Qwen 3 + DeepSeek R1
lineup. Gemma 4 family pending removal once Hermes default is switched.*
