# Infrashare — Cross-Project Infrastructure Access

> Drop this into any project's `CLAUDE.md` to give it full access to AlpacApps infrastructure.

## Quick Start

```markdown
## Shared Infrastructure (AlpacApps)

> **Bitwarden:** Same vault (`DevOps-alpacapps`). Unlock: `export BW_SESSION=$(~/bin/bw-unlock)`
> **Supabase:** Ref `aphrrfprbixmhissnjfn`. BW item ID: `fd5b3ae7-d6a7-4e57-8475-b410007ea3a7`

### Service Discovery

All software services are in the `service_registry` Supabase table. Query it:

\```bash
# Get management token
MGMT_TOKEN=$(bw get item "fd5b3ae7-d6a7-4e57-8475-b410007ea3a7" 2>/dev/null | python3 -c "import sys,json; item=json.load(sys.stdin); [print(f['value']) for f in item.get('fields',[]) if f['name']=='Management API Token']")

# List all shareable services
curl -s -X POST -H "Authorization: Bearer $MGMT_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT name, slug, description, host_name, host_ip, port, protocol, invoke_command, invoke_url, category, tags FROM service_registry WHERE shareable = true AND status = '\''active'\'' ORDER BY host_name, name"}' \
  "https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn/database/query"

# Find services by tag
curl -s -X POST -H "Authorization: Bearer $MGMT_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT name, host_name, port, invoke_command FROM service_registry WHERE '\''ai'\'' = ANY(tags) AND status = '\''active'\''"}' \
  "https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn/database/query"

# Find services on a specific host
curl -s -X POST -H "Authorization: Bearer $MGMT_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT name, port, category, description FROM service_registry WHERE host_name = '\''alpuca'\'' AND status = '\''active'\''"}' \
  "https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn/database/query"
\```

### Servers

| Machine | Role | IP | SSH |
|---------|------|-----|-----|
| **Almaca** | Legacy home server (cameras, audio, files) | 192.168.1.74 | `ssh almaca` |
| **Alpuca** | Primary home server (HAOS, lights, AI, builds) | 192.168.1.200 | `ssh paca@192.168.1.200` |
| **Hostinger** | Cloud workers (image-gen, pollers, proxies) | 93.188.164.224 | `sshpass -p "$(bw-read 'Hostinger VPS — OpenClaw Server')" ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@93.188.164.224` |

### Key Services (copy-paste)

| Service | Endpoint | Auth |
|---------|----------|------|
| **Sonos** | `curl http://192.168.1.200:5005/{room}/{action}` | None (LAN) |
| **Lights** | `curl -X POST https://lights.alpacaplayhouse.com/lights -H "Authorization: Bearer $TOKEN" -d '{"rooms":"...","color":"..."}'` | `bw-read "Light API — Alpuca" "password"` |
| **HAOS** | `curl -H "Authorization: Bearer $TOKEN" http://192.168.1.39:8123/api/states` | BW: "Home Assistant — HAOS" |
| **Ollama** | `curl http://192.168.1.200:11434/api/generate -d '{"model":"qwen3:8b","prompt":"..."}'` | None (LAN) |
| **Music Assistant** | `http://192.168.1.200:8095` | None (LAN) |
| **go2rtc cameras** | `http://192.168.1.200:1984` | None (LAN) |
| **Uptime Kuma** | `http://192.168.1.200:3001` | None (LAN) |
| **File Search** | `https://files.alpacaplayhouse.com` | Token |

### Database (shared)

| | |
|--|--|
| **Ref** | `aphrrfprbixmhissnjfn` |
| **BW Item ID** | `fd5b3ae7-d6a7-4e57-8475-b410007ea3a7` |
| **Mgmt Token** | Field: "Management API Token" in above item |
| **Key tables** | `service_registry` (47 services), `device_control_recipes` (83 recipes), `devices_unified` (all devices), `service_connections` (access recipes) |

### Sonos Rooms

Living Sound, Dining Sound, Outhouse, Skyloft Sound, Front Outside Sound, Pequeno, MasterBlaster, DJ, garage outdoors, Kitchen, Office, Bedroom, TV Room, Bathroom
```

## Service Categories

The `service_registry` table uses these categories:

| Category | Count | Examples |
|----------|-------|---------|
| `api` | 12 | Sonos, Light API, HAOS, Music Assistant, File Search |
| `worker` | 10 | image-gen, bug-fixer, feature-builder, pollers |
| `proxy` | 10 | go2rtc, WiZ, PTZ, Caddy, Cloudflare tunnels |
| `cron` | 7 | backups, watchdogs, cleanup, sensor polling |
| `ai` | 4 | Ollama, Claude Remote, Claude Task Poller |
| `monitor` | 2 | Uptime Kuma (Almaca + Alpuca) |
| `vm` | 1 | HAOS QEMU VM |

## Updating the Registry

When adding a new service to any machine:

```sql
INSERT INTO service_registry (name, slug, description, host_name, host_ip, port, protocol, process_manager, unit_name, category, tags, shareable, runtime, status)
VALUES ('My New Service', 'my-service', 'What it does', 'alpuca', '192.168.1.200', 8999, 'http', 'launchd', 'com.alpacapps.my-service', 'api', '{my,tags}', true, 'node', 'active');
```
