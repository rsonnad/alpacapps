# UniFi MCP bridge (UDM Pro → Claude Duet / claude.ai)

Lets a hosted chat client (Claude Duet, claude.ai custom connectors, any MCP client) read and change the
UDM Pro through a fixed set of tools. The UDM password never leaves ALPUCA.

```
Claude Duet ──OAuth/MCP──► https://unifi-mcp.alpacaplayhouse.com/mcp
                             │ Cloudflare tunnel "unifi-mcp" (own tunnel, not alpaca-cam)
                             ▼
                    ALPUCA 127.0.0.1:8941  server.mjs  (LaunchDaemon com.alpacapps.unifi-mcp)
                             │ cookie login as codingagent
                             ▼
                    UDM Pro 192.168.1.1
```

## Connect Claude Duet (or claude.ai)

1. Open https://claude.ai/customize/connectors?modal=add-custom-connector
2. **Name** `Alpaca UniFi`, **MCP server URL** `https://unifi-mcp.alpacaplayhouse.com/mcp`.
   Leave Authentication on **Sign in now** and OAuth client on **Use Claude's published identity**
   (CIMD; "Register automatically" also works). Click **Continue**.
3. On the "Connect … · Alpaca UniFi" page, paste the password of the Bitwarden item
   **"Alpaca UniFi MCP bridge — Duet/claude.ai connector key"** (DevOps-alpacapps) and click **Allow**.

Alternative without OAuth: Authentication **No sign-in**, then **Add header**
`Authorization` = `Bearer <that key>`. Headless MCP clients send the same header.

## Tools

| Read | Write |
|---|---|
| `unifi_health` | `unifi_port_forward_create` / `_update` / `_delete` |
| `unifi_list_clients` (search, include_offline) | `unifi_client_block` / `_unblock` / `_reconnect` |
| `unifi_list_devices` | `unifi_client_update` (alias, note, fixed IP) |
| `unifi_list_port_forwards` | `unifi_device_restart` (switches/APs; refuses the gateway) |
| `unifi_list_firewall` | `unifi_firewall_upsert` / `unifi_firewall_delete` |
| `unifi_list_networks` (passphrases redacted) | |
| `unifi_get` (read-only GET under the Network API; plain paths only) | |

Not exposed on purpose: UniFi OS users/admins, firmware, backup/restore, reset, controller settings
(SSH, remote access, management), Wi-Fi passphrases. Every read redacts `x_*` fields.
Every write is appended to `~/Library/Logs/unifi-mcp-audit.log` on ALPUCA.

## Files on ALPUCA

| Path | What |
|---|---|
| `~/unifi-mcp/server.mjs` | this server (copy of `scripts/unifi-mcp/server.mjs`) |
| `/Library/LaunchDaemons/com.alpacapps.unifi-mcp.plist` | the service (LaunchDaemon with UserName=alpuca, so it can reach the LAN) |
| `~/Library/LaunchAgents/com.alpacapps.cloudflared-unifi-mcp.plist` | the tunnel |
| `~/.cloudflared/config-unifi-mcp.yml` | tunnel ingress (tunnel id `7aa7f078-c9ae-4936-9b4a-f198167c219e`) |
| `~/.unifi-mcp/owner_key`, `signing_key` | bridge key and token-signing key (chmod 600; canonical in Bitwarden item above) |
| `~/.unifi-mcp/udm.json` | `{"username":"codingagent","password":…}` — same password as `~/.udm_pass` (ptz-proxy) |
| `~/Library/Logs/unifi-mcp.log`, `unifi-mcp-audit.log` | service log, write audit log |

## Operate

```bash
# deploy a new server.mjs
scp -F /dev/null -i ~/.ssh/alpuca_ed25519 -o IdentitiesOnly=yes scripts/unifi-mcp/server.mjs alpuca@100.74.59.97:unifi-mcp/
ssh alpuca 'sudo launchctl kickstart -k system/com.alpacapps.unifi-mcp'

# health (public)
curl -s https://unifi-mcp.alpacaplayhouse.com/health
```

- **Revoke every connected client:** put new random values in the Bitwarden item (password and
  `signing_key`), write them to `~/.unifi-mcp/owner_key` / `signing_key`, kickstart the service. Old
  access and refresh tokens stop working at once (they are HMAC-signed with the old key).
- **UDM password rotated:** update `~/.unifi-mcp/udm.json` (no restart needed; after a rejected
  password the server pauses logins for 10 minutes so it cannot lock the account).
- `cloudflared tunnel route dns` on ALPUCA must be run with `--config ~/.cloudflared/config-unifi-mcp.yml`
  and the tunnel id: without it, cloudflared takes the tunnel from the default `config.yml` (alpaca-cam).
