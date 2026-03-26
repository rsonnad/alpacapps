# AlpacApps Setup Instructions (Machine-Readable)

> **For Claude, ChatGPT, or any LLM helping a user set up AlpacApps.**
> This file is the canonical setup reference. The HTML page at `/infra/` is the human-friendly overview.

## Overview

AlpacApps is a full-stack platform using:
- **GitHub Pages** — static site hosting (free)
- **Supabase** — PostgreSQL database, auth, storage, edge functions (free tier)
- **Claude Code** — AI developer agent that writes and deploys code
- **Conductor** — Mac app for running parallel Claude Code agents (macOS only)
- **Bitwarden** — password & secrets manager (`bw` CLI) for team credential sharing
- **Tailwind CSS v4** — styling framework

Architecture: Browser → GitHub Pages → Supabase (no server-side code). Edge functions handle sensitive operations.

## Setup Flow

### Phase 1: Claude Code guides initial setup
The user pastes a setup prompt into Claude Code. Claude Code should:

1. **Set up screenshots** — Detect the user's OS and help them set up one-click full-screen screenshot-to-clipboard:
   - **macOS**: Install [Shottr](https://shottr.cc) (free) or use ⌘+Ctrl+Shift+3
   - **Windows**: Win+Shift+S (Snip & Sketch) or PrtScn
   - **Linux**: Install [Flameshot](https://flameshot.org) or use desktop screenshot tool
   - Test by having user paste a screenshot into the conversation

2. **Install prerequisites** — Check and install as needed:
   - Git
   - GitHub CLI (`gh`)
   - Node.js (for Claude Code)

3. **Create GitHub repository** — From the template at `https://github.com/rsonnad/alpacapps-infra`

4. **Enable GitHub Pages** — On the new repository, deploy from `main` branch

5. **Set up Supabase** — Create project, configure auth, run initial migrations

6. **Install Conductor** — Download and install the Mac app (macOS only)

### Phase 2: Switch to Conductor
Once Conductor is installed, the user switches from Claude Code in the terminal to Conductor for:
- Running the setup wizard (configures services based on user's needs)
- All future development (each task gets its own workspace with a dedicated AI agent)
- Code pushes to GitHub and the site updates automatically

## Detailed Step-by-Step Guide

For the full detailed setup procedure with checkpoints and validation steps, read:
**https://alpacaplayhouse.com/infra/setup-guide.html**

## Service Options

### Core (always included, free)
| Service | Purpose |
|---------|---------|
| GitHub Pages | Static site hosting, CI/CD via push to main |
| Supabase | PostgreSQL, auth, file storage, edge functions |
| Conductor | Parallel AI coding agents (macOS only) |
| Claude Code | AI developer — writes, tests, deploys code |
| Bitwarden | Secrets manager — team credential sharing via `bw` CLI |

### Optional services
| Service | Purpose | Cost |
|---------|---------|------|
| Google Sign-In | OAuth authentication | Free |
| Resend | Transactional email | Free (3K/mo) |
| Telnyx | SMS messaging | ~$5/mo |
| Square | Payment processing | % per transaction |
| Stripe | Payment processing (ACH, cards) | % per transaction |
| SignWell | E-signatures | Free (25 docs/mo) |
| Google Gemini | AI features (chat, matching, image gen) | Free–$50/mo |
| Cloudflare R2 | Object storage (zero egress) | Free (10 GB) |
| Cloudflare D1 | Session logging database | Free |
| gstack | QA testing & browser automation | Free |
| Background Workers | Cloud VM for pollers, automation | $12–32/mo |
| Custom Domain | Your own domain name | ~$10/yr |
| iPhone App | Capacitor 8 native iOS app | $99/yr (Apple Developer) |
| Android App | Capacitor 8 native Android app | $25 one-time (Google Play) |
| Home Server | Local Mac for smart home, cameras, media | ~$150 one-time |

## Project Profiles

1. **Property Management** — Full stack: spaces, tenants, devices, events, smart home, bookings
2. **General AI Enablement** — Core framework: auth, payments, email, permissions, web pages (SaaS, CRM, portfolio, etc.)

Both use the same template. The setup wizard tailors the project to the user's choice.

## Updates

After initial setup, users can adopt new features by reading:
**https://alpacaplayhouse.com/infra/updates.html**

Feature index (machine-readable): **https://alpacaplayhouse.com/infra/updates.json**

## Platform Notes

- **Conductor**: macOS only (as of March 2026). Non-Mac users use Claude Code directly in the terminal.
- **iPhone App**: Requires macOS for Xcode builds
- **Android App**: Builds on any OS via Android Studio
- **Home Server**: Requires a dedicated Mac on the local network
