# Sonos Automation — Alpaca Playhouse

> 14 Sonos zones on UniFi Dream Machine Pro network. This doc covers network configuration,
> troubleshooting history, and best practices for reliable multi-room audio.

## Speaker Inventory

| Room | MAC | Connection | Switch/Port | Model Era |
|------|-----|------------|-------------|-----------|
| Living Sound | 00:0e:58:* | Wired (ethernet) | — | Old (Connect) |
| MasterBlaster | 00:0e:58:ae:51:9a | Wired (ethernet) | US8P60 port 5 | Old (Connect:Amp) |
| saunaHiFi | 00:0e:58:* | Wired (ethernet) | — | Old (Connect:Amp) |
| DJ | 00:0e:58:* | WiFi | — | Old (Connect) |
| garage outdoors | 00:0e:58:* | WiFi | — | Old (Connect) |
| Outhouse | 00:0e:58:* | WiFi | — | Old (Connect) |
| Skyloft Sound | b8:e9:37:* | WiFi | — | Newer (S2) |
| Front Outside Sound | 00:0e:58:* | WiFi | — | Old (Connect) |
| Dining Sound | 00:0e:58:* | WiFi | — | Old (Connect) |
| Pequeno | 00:0e:58:* | WiFi | — | Old (Connect) |
| SkyBalcony Sound | 00:0e:58:* | WiFi | — | Old (Connect) |
| Backyard Sound | b8:e9:37:* | WiFi | — | Newer (S2) |
| SwimSpa | 00:0e:58:* | WiFi | — | Old (Connect) |

**SSID:** All on "Black Rock City" (2.4GHz)

## Sonos HTTP API (node-sonos-http-api)

- **Server:** Almaca (192.168.1.74), port 5005
- **Installed at:** `/Users/alpaca/node-sonos-http-api/`
- **Quick test:** `curl http://192.168.1.74:5005/zones`

### Common Commands

```bash
# Play/pause/stop
curl http://192.168.1.74:5005/{Room}/play
curl http://192.168.1.74:5005/{Room}/pause
curl http://192.168.1.74:5005/{Room}/next

# Search & play from Spotify
curl http://192.168.1.74:5005/{Room}/musicsearch/spotify/song/{query}

# Play specific Spotify track
curl http://192.168.1.74:5005/{Room}/spotify/now/spotify:track:{id}

# Get zone state
curl http://192.168.1.74:5005/{Room}/state

# Group rooms
curl http://192.168.1.74:5005/{Room}/join/{OtherRoom}
curl http://192.168.1.74:5005/{Room}/leave

# Volume
curl http://192.168.1.74:5005/{Room}/volume/{0-100}
```

Room names are URL-encoded: `garage%20outdoors`, `Living%20Sound`, `Front%20Outside%20Sound`.

## UDM Pro Network Settings

### Full Settings Audit (verified 2026-03-31)

Audited against [unifi-sonos-doc](https://github.com/IngmarStein/unifi-sonos-doc) (537★),
[Ubiquiti Help Center](https://help.ui.com/hc/en-us/articles/18930473041047),
and [TwP Sonos/UniFi gist](https://gist.github.com/TwP/a8286f85dfb606a0403b71a6516f4132).

**Black Rock City SSID** (all Sonos speakers are on this network):

| Setting | Value | Recommended | Status | Why |
|---------|-------|-------------|--------|-----|
| Multicast Enhancement (IGMPv3) | **OFF** | ON (guides say) | Intentional override | ON breaks older Connect/Connect:Amp — tested 2026-03-31 |
| BSS Transition (802.11v) | **OFF** | OFF | OK | Prevents APs from handing off stationary speakers |
| Fast Roaming (802.11r) | **OFF** | OFF | OK | Old Sonos devices disconnect during fast roam |
| Min 2.4GHz Rate | **6 Mbps** | 6-12 Mbps | OK | Higher values can kick weak-signal speakers |
| DTIM 2.4GHz | **1** | 1 | OK | Fastest multicast delivery |
| DTIM 5GHz | **1** | 1 | OK | Fastest multicast delivery |
| L2 Isolation | **OFF** | OFF | OK | Speakers must talk to each other |
| Proxy ARP | **OFF** | OFF | OK | Can interfere with Sonos discovery |
| UAPSD | **OFF** | OFF | OK | Power save mode can delay multicast |
| Broadcast Filter | **OFF** | OFF | OK | Sonos needs broadcast for discovery |
| Group Rekey | **0** (disabled) | 0 | OK | Rekeying can briefly disconnect clients |
| mDNS Proxy Mode | **auto** | auto/on | OK | Required for Sonos mDNS discovery |
| IAPP | **ON** | ON | OK | Inter-AP handoff protocol |
| WPA Mode | **wpa2** | wpa2 | OK | WPA3 causes issues with older Sonos |
| Band | **both** (2g+5g) | both | OK | Old devices use 2.4GHz, newer use 5GHz |
| Hide SSID | **OFF** | OFF | OK | Sonos can't find hidden SSIDs reliably |
| Enhanced IoT | **OFF** | OFF | OK | Can cause unexpected behavior |

**Default Network (LAN):**

| Setting | Value | Recommended | Status | Why |
|---------|-------|-------------|--------|-----|
| IGMP Snooping | **ON** | ON | OK | Directs multicast to only ports that need it (critical for 14 zones) |
| mDNS | **ON** | ON | OK | Required for Sonos discovery |
| DHCP Range | 192.168.1.6–254 | — | OK | — |
| Sonos DHCP Reservations | **NONE** | Should have | GAP | Prevents IP churn during DHCP renewal |

**Switch Ports (STP):**

| Switch | STP Status | Recommended | Status | Why |
|--------|-----------|-------------|--------|-----|
| UDM Pro (ports 1-8) | **Disabled per-port** | Disabled | OK | Sonos uses old STP path costs incompatible with RSTP |
| US8P60 Skyloft Closet (all ports) | **Disabled per-port** | Disabled | OK | Same reason |
| Flex Mini Attic (fw 2.1.6) | Default | Disabled (can't) | N/A | Firmware doesn't support per-port STP disable |
| Flex Mini Sauna (fw 2.1.6) | Default | Disabled (can't) | N/A | Firmware doesn't support per-port STP disable |

**Other SSIDs** (not used by Sonos, but listed for reference):

| SSID | Multicast Enhancement | BSS Transition | Min Rate 2.4GHz |
|------|----------------------|----------------|-----------------|
| Alpacalypse | ON | ON | 1 Mbps |
| Eight Small Eyes | ON | ON | 1 Mbps |

### Settings to NEVER enable on Black Rock City

| Setting | Why |
|---------|-----|
| Multicast Enhancement | Breaks older Sonos Connect/Connect:Amp grouping (tested 2026-03-31) |
| WiFi AI / Auto-Optimize | Channel changes mid-stream cause dropouts |
| Airtime Fairness | Starves older Sonos hardware |
| Block LAN to WLAN Multicast | Prevents wired-to-wireless multicast |
| Client Device Isolation | Prevents speakers from communicating |
| WPA3 | Old Connect/Connect:Amp doesn't support it |

### Sonos-Required Ports (for firewall/VLAN setups)

| Protocol | Ports | Purpose |
|----------|-------|---------|
| TCP | 3400, 3401, 3500 | Sonos control |
| UDP | 319, 1900, 1901, 1902 | SSDP/UPnP discovery, PTP sync |
| UDP | 6969 | Sonos direct control |
| UDP | 32768-65535 | Audio streaming |
| UDP | 5353 | mDNS |

### TODO: Add DHCP Reservations

No Sonos speakers have static DHCP reservations. When speakers get new IPs during renewal,
it can cause temporary grouping failures. Current WiZ bulb reservations exist (192.168.1.160-167)
but zero Sonos reservations. Add these when speaker MACs/IPs are stable.

## Troubleshooting History

### 2026-03-31: "Unable to play" + songs not changing

**Root cause:** Tailscale DNS on Almaca was intercepting all DNS but offline, so the Sonos HTTP API couldn't resolve music service URLs (YouTube Music, Spotify).

**Fix:** `ssh alpaca@192.168.1.74` then:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale set --accept-dns=false
```

**Secondary issue:** Music stops when adding rooms to a group — caused by STP/RSTP incompatibility on wired Sonos ports. Fixed by disabling STP per-port on UDM Pro and US8P60.

### 2026-03-30: All speakers moved to WiFi

Unplugged all ethernet cables to eliminate SonosNet mesh bridge conflicts. Verified all 13 speakers on WiFi. Later re-wired Living Sound, MasterBlaster, and saunaHiFi for reliability.

### 2026-03-27: Sonos cutting out on Living Sound and DJ

**Root causes found:**
1. IGMP Snooping was OFF — multicast flooding all ports (14 zones × 5-10 pkt/sec)
2. BSS Transition was ON — APs tried handing off stationary speakers
3. Mixed wired/WiFi created SonosNet bridge causing STP conflicts

**Fixes applied:**
- IGMP Snooping → ON
- BSS Transition → OFF
- DTIM 5GHz → 1

### 2026-03-25: Living Sound intermittent dropouts

Diagnosed as mixed wired/WiFi issue. Living Sound was the only wired speaker, creating a SonosNet mesh bridge. Recommended going all-WiFi or disabling STP.

### 2026-03-06: Sonos post-router reconfiguration

After migrating from Google Mesh to UDM Pro, grouping failed and Front Sound disappeared from Spotify device list. mDNS proxy was off, IGMP snooping not verified.

## Best Practices for 14-Zone Sonos on UniFi

### Network Architecture

1. **Pick a topology and stick with it:** All-WiFi OR strategic wired. Never randomly mixed.
2. **Wired speakers = SonosNet bridges.** Any ethernet cable enables SonosNet mesh on 2.4GHz, which conflicts with UniFi's RSTP. If wiring, disable STP on those switch ports.
3. **Wire central/important speakers** (Living Sound, MasterBlaster) for reliability. Leave outdoor/distant ones on WiFi.
4. **Static DHCP reservations** for all Sonos speakers prevent IP churn during DHCP renewal.

### When Adding Rooms to a Group

The "music stops when adding rooms" issue is caused by:
- **STP topology renegotiation** when wired+wireless speakers are grouped
- **Multicast stream renegotiation** across wired/wireless boundaries
- **Fix:** Disable STP on all wired Sonos switch ports (done — see above)

### Music Service Authentication

YouTube Music and Spotify tokens can expire if DNS is broken (e.g., Tailscale DNS interception). If you see "connection to YouTube Music was lost":
1. Check DNS on Almaca: `ssh alpaca@192.168.1.74 "nslookup google.com"`
2. If DNS fails, check Tailscale: `scutil --dns` — Tailscale resolver should NOT be primary
3. In Sonos app: Settings → Services & Voice → remove and re-add the service

### Almaca (Sonos HTTP API Server) Gotchas

- **Tailscale DNS must be disabled:** `tailscale set --accept-dns=false` (set 2026-03-31)
- **DNS should resolve via UDM Pro (192.168.1.1)** not Tailscale (100.100.100.100)
- **node-sonos-http-api** uses DNS for music service lookups (Spotify, YouTube Music)
- If music commands fail with `getaddrinfo ENOTFOUND`, it's always a DNS issue on Almaca

### UDM Pro Maintenance

- **After firmware updates:** Re-verify IGMP Snooping, mDNS, and per-port STP settings
- **After AP firmware updates:** Check multicast settings haven't been reset
- **Settings are in MongoDB** (port 27117 on UDM Pro) — API account is read-only

#### How to read/write UDM Pro settings

```bash
# SSH to UDM Pro
sshpass -p "$(bw-read 'UniFi Dream Machine Pro — Network Gateway' 'SSH Password')" \
  ssh -o StrictHostKeyChecking=no root@192.168.1.1

# Read WiFi settings
mongo --port 27117 ace --quiet --eval 'db.wlanconf.find({name:"Black Rock City"}).pretty()'

# Read network settings
mongo --port 27117 ace --quiet --eval 'db.networkconf.find({name:"Default"}).pretty()'

# Read switch STP settings
mongo --port 27117 ace --quiet --eval 'db.device.find({type:"usw"},{name:1,port_overrides:1}).pretty()'

# Write example (change a WLAN setting)
mongo --port 27117 ace --quiet --eval \
  'db.wlanconf.updateOne({name:"Black Rock City"}, {$set:{setting_name: value}})'
```

Key MongoDB collections: `wlanconf` (WiFi), `networkconf` (LAN), `device` (switches/APs/UDM), `user` (clients)

## References

- [UniFi + Sonos Configuration Guide (GitHub, 537★)](https://github.com/IngmarStein/unifi-sonos-doc)
- [Ubiquiti Help Center: Best Practices for Sonos](https://help.ui.com/hc/en-us/articles/18930473041047)
- [Sonos Community: Large UniFi Network Performance](https://en.community.sonos.com/advanced-setups-229000/large-sonos-and-unifi-network-performance-problems-6829841)
- [Sonos Community: SonosNet vs WiFi with UniFi 2025](https://en.community.sonos.com/advanced-setups-229000/sonosnet-vs-wifi-with-unifi-2025-6926853)
- [UniFi Community: STP and Sonos](https://community.ui.com/questions/UniFi-STP-and-Sonos/7f72d9cf-6511-42f6-b6bc-d9b5efb7cb19)
