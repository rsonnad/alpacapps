# Claude Code Remote Control — Server Setup Guide

Run Claude Code on a server (DO droplet / Oracle instance), connect from your phone. All code execution stays on the server. Your phone is just a remote terminal.

## Architecture

```
Phone (claude.ai/code) ──→ Anthropic API ──→ Server (claude remote-control)
                                                    ↓
                                              Local filesystem
                                              Git, MCP servers, tools
```

No port forwarding. No VPN. The server makes outbound HTTPS connections to Anthropic's API. Your phone connects through the same API. End-to-end TLS.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Claude Code | v2.1.52+ (`npm i -g @anthropic-ai/claude-code`) |
| Subscription | Claude Max (Pro also works) |
| Auth | Run `claude /login` once on the server |
| SSH | Access to the server |
| Repo | Project cloned to `/opt/{project}/repo` |

## One-Time Setup

### 1. Install / Update Claude Code

```bash
ssh root@<server-ip>
npm install -g @anthropic-ai/claude-code@latest
claude --version  # Should be 2.1.52+
```

### 2. Authenticate

```bash
su - bugfixer
claude /login
# Follow the URL to authenticate with your Max account
```

This links the `bugfixer` user's Claude Code to your Max subscription. Only needed once.

### 3. Clone a Project

```bash
# As root:
mkdir -p /opt/portsie
sudo -u bugfixer git clone git@github.com:rsonnad/portsie.git /opt/portsie/repo
cd /opt/portsie/repo
sudo -u bugfixer git config user.name "Remote Control"
sudo -u bugfixer git config user.email "remote@alpacaplayhouse.com"
chown -R bugfixer:bugfixer /opt/portsie
```

**Deploy key:** Each repo needs a GitHub deploy key with write access for pushing.

```bash
# Generate (as bugfixer)
ssh-keygen -t ed25519 -f ~/.ssh/portsie_deploy -N ""

# Add to GitHub: repo Settings → Deploy Keys → Add (check "Allow write access")
# Then in ~/.ssh/config:
Host github-portsie
  HostName github.com
  IdentityFile ~/.ssh/portsie_deploy
```

## Usage

### Start a Session

```bash
ssh -i ~/.ssh/do_bugfixer root@<server-ip>
su - bugfixer

# Option A: Use the helper script
/opt/bug-fixer/repo/scripts/remote-control.sh alpacapps
/opt/bug-fixer/repo/scripts/remote-control.sh portsie

# Option B: Direct
cd /opt/portsie/repo
claude remote-control
```

You'll see a URL and QR code. Connect from your phone.

### Connect from Phone

1. Open **claude.ai/code** in your phone's browser (or Claude mobile app)
2. Your active sessions show with a green dot
3. Tap to connect — full interactive Claude Code access

### Keep Session Alive (Optional)

If you want the session to survive SSH disconnects, use tmux:

```bash
tmux new-session -s portsie
cd /opt/portsie/repo
claude remote-control
# Detach: Ctrl+B, then D
# Reattach later: tmux attach -t portsie
```

## Current Projects

| Project | Repo | Directory |
|---------|------|-----------|
| AlpacApps | `rsonnad/alpacapps` | `/opt/bug-fixer/repo` |
| Portsie | `rsonnad/portsie` | `/opt/portsie/repo` |

## Adding a New Project

1. Clone repo to `/opt/{name}/repo` (see "Clone a Project" above)
2. Add a deploy key for push access
3. Add an entry to the `case` statement in `scripts/remote-control.sh`
4. Start a session: `scripts/remote-control.sh {name}`

## Relationship to Autonomous Workers

Remote Control is for **interactive** sessions (you're connected from your phone). The autonomous workers run independently:

| Worker | Purpose | Still Active |
|--------|---------|--------------|
| Bug Scout | Auto-fix bug reports | Yes |
| Feature Builder | Auto-implement PAI feature requests | Yes |
| ~~Instruction Runner~~ | ~~Git-branch mobile instructions~~ | **Retired** (replaced by Remote Control) |

The autonomous workers use `claude -p ... --dangerously-skip-permissions` (headless CLI). Remote Control uses `claude remote-control` (interactive). They coexist on the same server.

## Troubleshooting

**"Remote control requires authentication"** — Run `claude /login` and authenticate with your Max account.

**Session disconnects** — Network interruptions up to ~10 minutes are tolerated. If the server process dies, start a new session.

**Can't push from session** — Check that the deploy key has write access and `~/.ssh/config` routes to the correct key.

**Multiple sessions** — Each `claude remote-control` process is one session. Run multiple in separate terminals/tmux panes for different projects.
