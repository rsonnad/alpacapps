# OpenClaw (Alpaclaw) — System Architecture

> **Alpaclaw** is the operational AI agent for AlpacApps Residency, powered by [OpenClaw](https://github.com/openclaw/openclaw) and hosted on a Hostinger KVM 4 VPS.

## Overview

Alpaclaw handles property management automation: resident communications, smart home orchestration, payment processing, maintenance coordination, and multi-agent task delegation. It connects to WhatsApp, Telegram, Discord, and web chat — giving residents and operators a unified AI assistant across all messaging platforms.

```
                          ┌─────────────────────────────────────────────┐
                          │          Hostinger KVM 4 VPS                │
                          │   93.188.164.224 · Ubuntu 24.04 + Docker   │
                          │                                             │
  WhatsApp ──────────┐    │  ┌──────────────────────────────────────┐   │
  Telegram ──────────┤    │  │      OpenClaw Gateway (Docker)       │   │
  Discord  ──────────┼───►│  │         "Alpaclaw" 🦙                │   │
  Web Chat ──────────┘    │  │                                      │   │
                          │  │  SOUL.md · USER.md · AGENTS.md       │   │
                          │  │  Skills · Memory · Cron · Canvas     │   │
                          │  └──────────┬──────────────┬────────────┘   │
                          │             │              │                │
                          └─────────────┼──────────────┼────────────────┘
                                        │              │
                    ┌───────────────────┘              └──────────────────┐
                    ▼                                                     ▼
          ┌─────────────────┐                                  ┌──────────────────┐
          │   Supabase      │                                  │  LLM Providers   │
          │   (Backend)     │                                  │                  │
          │   PostgreSQL    │                                  │  Gemini 2.5 Flash│
          │   Storage       │                                  │  (primary)       │
          │   Edge Functions│                                  │  nexos.ai credits│
          │   Auth          │                                  │  (when active)   │
          └─────────────────┘                                  └──────────────────┘
```

## Infrastructure

| Component | Details |
|-----------|---------|
| **Host** | Hostinger KVM 4 VPS |
| **IP** | `93.188.164.224` |
| **Hostname** | `srv1433869.hstgr.cloud` |
| **OS** | Ubuntu 24.04 LTS + Docker |
| **Resources** | 4 vCPU · 16 GB RAM · 200 GB NVMe · 16 TB bandwidth |
| **Cost** | ~$9.99/mo (intro KVM 4 rate) |
| **Container** | `ghcr.io/hostinger/hvps-openclaw:latest` |
| **OpenClaw Version** | `2026.2.23` |
| **Gateway Port** | `43414` (TCP) |
| **Gateway Token** | Stored in `/docker/openclaw-vnfd/.env` |
| **Data Volume** | `/docker/openclaw-vnfd/data/` → `/data/` in container |

## Agent Identity

| Property | Value |
|----------|-------|
| **Name** | Alpaclaw |
| **Emoji** | 🦙 |
| **Creature** | Alpaca |
| **Role** | Operations orchestrator for AlpacApps Residency |
| **Primary Model** | Gemini 2.5 Flash (via Google AI) |
| **Fallback** | Gemini 2.5 Flash Lite |
| **Deep Reasoning** | Gemini 2.5 Pro (for complex tasks) |

## File Structure

```
/docker/openclaw-vnfd/
├── docker-compose.yml          # Container orchestration
├── .env                        # Environment variables (tokens, keys)
└── data/
    └── .openclaw/
        ├── openclaw.json       # Main gateway configuration
        ├── openclaw.json.bak   # Config backup
        ├── agents/main/
        │   ├── agent/
        │   │   ├── auth-profiles.json
        │   │   ├── auth.json
        │   │   └── models.json
        │   └── sessions/
        │       └── sessions.json
        ├── canvas/
        ├── credentials/
        ├── cron/
        │   └── jobs.json
        ├── logs/
        └── workspace/
            ├── SOUL.md         # Agent personality & boundaries
            ├── USER.md         # User profile (Rahulio)
            ├── IDENTITY.md     # Agent identity (Alpaclaw)
            ├── AGENTS.md       # Multi-agent definitions
            ├── HEARTBEAT.md    # Periodic task schedule
            ├── MEMORY.md       # Persistent memory
            ├── TOOLS.md        # Tool documentation
            ├── BOOT.md         # Boot sequence
            └── skills/         # ClawHub installed skills
```

## Messaging Channels

| Channel | Status | Configuration |
|---------|--------|---------------|
| **WhatsApp** | Enabled | Allowlist mode, self-chat on, number: `424-234-1750` |
| **Telegram** | Enabled | Pairing DM policy (pending bot token) |
| **Discord** | Enabled | Pending bot token configuration |
| **Slack** | Enabled | Unconfigured |
| **Google Chat** | Enabled | Unconfigured |
| **Nostr** | Enabled | Unconfigured |
| **Signal** | Disabled | — |
| **iMessage** | Disabled | — |

### Channel Setup Status

- **WhatsApp**: Pre-configured by Hostinger with number `424-234-1750`. Allowlist mode restricts to approved numbers.
- **Telegram**: Needs bot token from @BotFather. DM policy set to `pairing` (approval codes).
- **Discord**: Can share PAI Discord bot token initially, then split to separate bot later.

## Multi-Agent Hierarchy

```
Alpaclaw (CEO / Orchestrator)
├── Research Sub-Agent     → Gemini 2.5 Pro (deep analysis)
├── Automation Sub-Agent   → Gemini Flash Lite (cheap batch ops)
└── [Future] Smart Home Agent → Direct IoT control
```

### Agent Routing

OpenClaw uses hierarchical first-match-wins routing:
1. **Peer match** — exact DM/group/channel ID (highest priority)
2. **Parent peer match** — thread inheritance
3. **Guild + roles** — Discord guild-level routing
4. **Channel-level** — broad channel matching
5. **Fallback** — default agent (Alpaclaw)

## Security

### Firewall (Hostinger API + UFW)

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | SSH | Remote access |
| 80 | HTTP | Web traffic |
| 443 | HTTPS | Secure web traffic |
| 43414 | TCP | OpenClaw Gateway |

All other ports are denied by default (both Hostinger firewall ID `221167` and UFW).

### Intrusion Prevention

- **fail2ban**: Active on SSHD — 3 max retries, 2-hour ban time
- **UFW**: Default deny incoming, allow outgoing
- **Hostinger Firewall**: API-managed, synced to VPS
- **Gateway Auth**: Token-based authentication (`OPENCLAW_GATEWAY_TOKEN`)

### Security Considerations

The Hostinger default deployment has some permissive flags that should be reviewed:
- `allowInsecureAuth=true` — allows non-TLS auth (OK behind firewall)
- `dangerouslyAllowHostHeaderOriginFallback=true` — relaxed origin checks
- `dangerouslyDisableDeviceAuth=true` — no device-level auth

**Recommendation**: Enable HTTPS via Caddy/nginx reverse proxy and tighten these flags for production.

## Model Routing Strategy

| Task Type | Model | Cost |
|-----------|-------|------|
| **Orchestration** (routing, delegation) | Gemini 2.5 Flash | ~$0.15/$3.50 per 1M tokens |
| **Simple tasks** (status checks, formatting) | Gemini 2.5 Flash Lite | Cheapest |
| **Complex reasoning** (analysis, strategy) | Gemini 2.5 Pro | ~$1.25/$10 per 1M tokens |
| **Image generation** | Gemini 2.5 Flash Image | ~$0.039/image |

### Cost Optimization

- Route 80%+ of requests through Flash/Lite models
- Reserve Pro model for explicit complex reasoning requests
- Cache frequently-accessed data in workspace memory files
- Batch API calls when possible
- One-topic sessions to avoid context bloat

## Relationship to Existing Infrastructure

```
┌──────────────────────────────────────────────────────────┐
│                    AlpacApps Ecosystem                     │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ GitHub Pages │  │  Hostinger   │  │ Oracle Cloud   │  │
│  │ (Static Web) │  │  (Alpaclaw)  │  │ (Workers)      │  │
│  │             │  │              │  │                │  │
│  │ Consumer    │  │ OpenClaw     │  │ Bug Scout      │  │
│  │ Admin       │  │ Gateway      │  │ Feature Builder│  │
│  │ Resident    │  │ Multi-Agent  │  │ Tesla Poller   │  │
│  │ Pay         │  │ Messaging    │  │ LG Poller      │  │
│  │ Associate   │  │ Automations  │  │ Image Gen      │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                │                   │           │
│         └────────────────┼───────────────────┘           │
│                          │                               │
│                 ┌────────▼────────┐                      │
│                 │    Supabase     │                      │
│                 │  (Central Hub)  │                      │
│                 │  PostgreSQL     │                      │
│                 │  Edge Functions │                      │
│                 │  Storage        │                      │
│                 └─────────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

### How Alpaclaw Fits

| System | Role | Relationship to Alpaclaw |
|--------|------|--------------------------|
| **PAI** (Edge Function) | Resident-facing AI assistant | Alpaclaw can delegate to PAI for resident queries |
| **PAI Discord Bot** | Discord ↔ PAI bridge | Alpaclaw uses separate Discord presence (or shared bot) |
| **Bug Scout** (Oracle) | Auto bug fixing | Alpaclaw can trigger bug reports |
| **Feature Builder** (Oracle) | Auto feature implementation | Alpaclaw can submit feature requests |
| **Smart Home** (Edge Functions) | Device control | Alpaclaw orchestrates via Supabase edge functions |

## Workspace Files Reference

### SOUL.md
Defines Alpaclaw's personality, mission, boundaries, operational context, and token economy rules. Key principles:
- Proactive problem-solving (fix errors immediately, don't just report them)
- Spawn sub-agents for complex multi-step tasks
- Never guess at configurations — check sources or ask
- Safeguard private information at all times

### USER.md
User profile for Rahulio (owner/operator):
- Timezone: America/Chicago
- Prefers concise, actionable communication
- Technical background — comfortable with code and APIs

### AGENTS.md
Defines the multi-agent hierarchy:
- **Alpaclaw** (default) — Operations orchestrator
- **Research Sub-Agent** — Deep analysis with Pro model
- **Automation Sub-Agent** — Batch ops with Flash Lite

### HEARTBEAT.md
Periodic monitoring schedule:
- **9 AM CT**: Payment failures, device status, API cost anomalies
- **6 PM CT**: Daily operations summary
- **Monday AM**: Weekly cost report, device health, resident activity

## Administration

### SSH Access
```bash
ssh root@93.188.164.224
# Password in CLAUDE.local.md
```

### Docker Management
```bash
# View container status
docker ps

# View logs
docker logs openclaw-vnfd-openclaw-1 --tail 100 -f

# Restart container
docker restart openclaw-vnfd-openclaw-1

# Access container shell
docker exec -it openclaw-vnfd-openclaw-1 bash
```

### Configuration Updates
```bash
# Edit main config
nano /docker/openclaw-vnfd/data/.openclaw/openclaw.json

# Edit workspace files
nano /docker/openclaw-vnfd/data/.openclaw/workspace/SOUL.md

# Restart after config changes
docker restart openclaw-vnfd-openclaw-1
```

### Hostinger API Management
```bash
# VPS ID: 1433869
# Firewall ID: 221167
# Use Hostinger API tools or hPanel dashboard
```

## ClawHub Skills

Skills are installed to `workspace/skills/` and auto-loaded by the agent. Install via:
```bash
docker exec openclaw-vnfd-openclaw-1 npx clawhub install <skill-slug>
```

### Recommended Skills
- **Calendar** — Google Calendar integration
- **Email** — Email sending/reading
- **Git** — Repository management
- **Notion** — Note-taking and docs
- **Memory/QMD** — Persistent memory management

> **Security Note**: In Feb 2026, 341 malicious ClawHub skills were discovered. Always verify skill sources before installing. ClawHub now uses VirusTotal scanning.

## Future Enhancements

1. **HTTPS**: Add Caddy reverse proxy for TLS termination
2. **Tailscale**: Mesh VPN for secure remote access (link to Alpaca Mac)
3. **nexos.ai**: Activate Hostinger LLM credits for multi-provider routing
4. **Supabase Integration**: Direct database access for operational queries
5. **Smart Home Skills**: Custom skills for Sonos, Govee, Nest, Tesla control
6. **Monitoring Dashboard**: Token usage, cost tracking, session analytics
7. **Backups**: Enable Hostinger automatic weekly backups
