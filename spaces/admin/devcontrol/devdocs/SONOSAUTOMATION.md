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

- **Server:** Alpuca (192.168.1.200), port 5005
- **Installed at:** `/Users/alpuca/node-sonos-http-api/`
- **Quick test:** `curl http://192.168.1.200:5005/zones`

### Common Commands

```bash
# Play/pause/stop
curl http://192.168.1.200:5005/{Room}/play
curl http://192.168.1.200:5005/{Room}/pause
curl http://192.168.1.200:5005/{Room}/next

# Search & play from Spotify
curl http://192.168.1.200:5005/{Room}/musicsearch/spotify/song/{query}

# Play specific Spotify track
curl http://192.168.1.200:5005/{Room}/spotify/now/spotify:track:{id}

# Get zone state
curl http://192.168.1.200:5005/{Room}/state

# Group rooms
curl http://192.168.1.200:5005/{Room}/join/{OtherRoom}
curl http://192.168.1.200:5005/{Room}/leave

# Volume
curl http://192.168.1.200:5005/{Room}/volume/{0-100}
```

Room names are URL-encoded: `garage%20outdoors`, `Living%20Sound`, `Front%20Outside%20Sound`.

## UDM Pro Network Settings

### Full Settings Audit (verified 2026-04-01)

Audited against [unifi-sonos-doc](https://github.com/IngmarStein/unifi-sonos-doc) (537★),
[Ubiquiti Help Center](https://help.ui.com/hc/en-us/articles/18930473041047),
and [TwP Sonos/UniFi gist](https://gist.github.com/TwP/a8286f85dfb606a0403b71a6516f4132).

**Black Rock City SSID** (all Sonos speakers are on this network):

| Setting | Value | Recommended | Status | Why |
|---------|-------|-------------|--------|-----|
| Multicast Enhancement (IGMPv3) | **OFF** | ON (guides say) | Intentional override | ON breaks older Connect/Connect:Amp — tested 2026-03-31 |
| BSS Transition (802.11v) | **ON** | OFF (guides say) | Reverted to pre-3/27 | Disabling didn't help; pre-3/27 had it ON and worked fine |
| Fast Roaming (802.11r) | **OFF** | OFF | OK | Old Sonos devices disconnect during fast roam |
| Min 2.4GHz Rate | **6 Mbps** | 6-12 Mbps | OK | Higher values can kick weak-signal speakers |
| DTIM 2.4GHz | **1** | 1 | OK | Fastest multicast delivery |
| DTIM 5GHz | **3** (default) | 1 (guides say) | Reverted to pre-3/27 | DTIM 1 didn't help; default 3 is what worked pre-3/27 |
| L2 Isolation | **OFF** | OFF | OK | Speakers must talk to each other |
| Proxy ARP | **OFF** | OFF | OK | Can interfere with Sonos discovery |
| UAPSD | **OFF** | OFF | OK | Power save mode can delay multicast |
| Broadcast Filter | **OFF** | OFF | OK | Sonos needs broadcast for discovery |
| Group Rekey | **0** (disabled) | 0 | OK | Rekeying can briefly disconnect clients |
| mDNS Proxy Mode | **auto** | auto/on | OK | Required for Sonos mDNS discovery |
| IAPP | **ON** | ON | OK | Inter-AP handoff protocol |
| WPA Mode | **wpa2** | wpa2 | OK | WPA3 causes issues with older Sonos |
| WPA3 Support | **OFF** | OFF | OK | Old Connect/Connect:Amp don't support WPA3 |
| WPA3 Transition | **OFF** | OFF | OK | Transition mode still advertises PMF, confuses old devices |
| PMF Mode | **disabled** | disabled | OK | Protected Management Frames breaks old Sonos auth |
| Band | **both** (2g+5g) | both | OK | Old devices use 2.4GHz, newer use 5GHz |
| Hide SSID | **OFF** | OFF | OK | Sonos can't find hidden SSIDs reliably |
| Enhanced IoT | **OFF** | OFF | OK | Can cause unexpected behavior |

**Default Network (LAN):**

| Setting | Value | Recommended | Status | Why |
|---------|-------|-------------|--------|-----|
| IGMP Snooping (controller) | **OFF** | ON (guides say) | Reverted to pre-3/27 | See "Kernel vs Controller" below — controller toggle alone is insufficient |
| IGMP Querier (kernel) | **OFF** (`multicast_querier=0`) | ON if snooping ON | OK (snooping off) | Not needed when snooping is off — multicast floods everywhere |
| Kernel multicast_snooping (br0) | **OFF** (`multicast_snooping=0`) | — | **CRITICAL** | See "Kernel vs Controller" below |
| mDNS | **ON** | ON | OK | Required for Sonos discovery |
| DHCP Range | 192.168.1.6–254 | — | OK | — |
| Sonos DHCP Reservations | **NONE** | Should have | GAP | Prevents IP churn during DHCP renewal |

### ⚠️ Kernel vs Controller IGMP Snooping — CRITICAL

The UniFi controller's `igmp_snooping` toggle (Settings → Networks → Default) only controls the **UniFi switch layer**. It does **NOT** control the Linux kernel's `br0` bridge `multicast_snooping` setting on the UDM Pro itself. These are two independent systems:

| Layer | Setting | How to read | How to change |
|-------|---------|-------------|---------------|
| Controller (switch) | `igmp_snooping` in networkconf | API GET `/rest/networkconf/{id}` | API PUT with CSRF |
| Kernel (br0 bridge) | `/sys/devices/virtual/net/br0/bridge/multicast_snooping` | SSH: `cat /sys/.../multicast_snooping` | SSH: `echo 0 > /sys/.../multicast_snooping` |

**If you enable controller IGMP snooping, you MUST also enable the kernel querier** (`multicast_querier=1`). If the kernel has snooping ON but querier OFF, IGMP group memberships expire after ~260 seconds and the switch stops forwarding multicast to Sonos ports → music stops.

**Current working state (2026-04-01):** Both OFF — multicast floods freely. Less efficient but 100% reliable for 14 zones.

**Non-persistent:** Kernel settings reset on UDM reboot. If a boot persistence script is needed:
```bash
# /data/on_boot.d/10-multicast-snooping-off.sh
#!/bin/sh
sleep 30  # wait for br0 bridge init
echo 0 > /sys/devices/virtual/net/br0/bridge/multicast_snooping
```

**Switch Ports (STP):**

| Switch | STP Status | Recommended | Status | Why |
|--------|-----------|-------------|--------|-----|
| UDM Pro (ports 1-8) | **Default (enabled)** | Default | OK | Disabling per-port caused grouping failures + cutouts (tested 2026-03-31) |
| US8P60 Skyloft Closet (all ports) | **Default (enabled)** | Default | OK | Same — reverted 2026-03-31 |
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
| WPA3 / WPA3 Transition | Old Connect/Connect:Amp doesn't support it. Transition mode causes repeated auth negotiation loops (WPA3 fail → WPA2 reconnect → repeat) |
| PMF (Protected Management Frames) | Even in "optional" mode, confuses old Sonos devices. Set to `disabled`. |
| Per-port STP disable | Causes grouping failures and cutouts — tested and reverted 2026-03-31 |
| Kernel snooping ON without querier | Controller `igmp_snooping` toggle doesn't control kernel `br0`. If kernel snooping is ON, querier MUST also be ON or music dies after ~260s |

### Sonos-Required Ports (for firewall/VLAN setups)

| Protocol | Ports | Purpose |
|----------|-------|---------|
| TCP | 3400, 3401, 3500 | Sonos control |
| UDP | 319, 1900, 1901, 1902 | SSDP/UPnP discovery, PTP sync |
| UDP | 6969 | Sonos direct control |
| UDP | 32768-65535 | Audio streaming |
| UDP | 5353 | mDNS |

### DHCP Reservations (DONE — 2026-04-13)

All 14 Sonos speakers now have static DHCP reservations in the 192.168.1.170-183 range.
Speakers will pick up new IPs on next DHCP renewal or after power cycle.

| Speaker | Reserved IP | MAC |
|---------|------------|-----|
| Living Sound | 192.168.1.170 | 00:0e:58:ab:6e:c6 |
| MasterBlaster | 192.168.1.171 | 00:0e:58:ae:51:9a |
| Dining Sound | 192.168.1.172 | 00:0e:58:13:7a:8c |
| DJ | 192.168.1.173 | 00:0e:58:a1:21:46 |
| Outhouse | 192.168.1.174 | 00:0e:58:30:9a:48 |
| Front Outside | 192.168.1.175 | 00:0e:58:20:07:ca |
| SkyBalcony | 192.168.1.176 | 00:0e:58:24:46:d6 |
| Skyloft Sound | 192.168.1.177 | 00:0e:58:a1:2a:1a |
| Pequeno | 192.168.1.178 | b8:e9:37:a2:34:82 |
| Backyard | 192.168.1.179 | b8:e9:37:92:72:fc |
| SwimSpa | 192.168.1.180 | 00:0e:58:2d:67:9c |
| saunaHiFi | 192.168.1.181 | b8:e9:37:93:cb:ec |
| garage outdoors | 192.168.1.182 | 00:0e:58:10:d6:d6 |
| Garage Bridge | 192.168.1.183 | 00:0e:58:21:e8:e0 |

WiZ bulb reservations remain at 192.168.1.160-167.

## Troubleshooting History

### 2026-04-13: Living Sound & Dining Sound cutting out from Spotify

**Symptoms:** Music stops after playing directly from Spotify on Living Sound and Dining Sound. Multi-zone grouped playback unreliable.

**Settings snapshot (BEFORE — pulled from API 2026-04-13):**

WLAN: Black Rock City:

| Setting | Value |
|---------|-------|
| mcastenhance_enabled | false |
| bss_transition | true |
| fast_roaming_enabled | false |
| dtim_ng (2.4GHz) | 1 |
| dtim_na (5GHz) | 3 |
| l2_isolation | false |
| proxy_arp | false |
| uapsd_enabled | false |
| group_rekey | 0 |
| iapp_enabled | true |
| wpa_mode | wpa2 |
| wpa3_support / transition / pmf | false / false / disabled |
| no2ghz_oui | true |
| enhanced_iot | false |

Network: Default:

| Setting | Value |
|---------|-------|
| igmp_snooping | false |
| mdns_enabled | true |
| Sonos DHCP reservations | NONE |

Switch: US8P60 Skyloft Closet:

| Setting | Value |
|---------|-------|
| stp_priority | 8192 |
| All ports stp_port_mode | edge |

UDM Pro: port_overrides = [] (no custom config)

AP 2.4GHz channels (all 20MHz width):

| AP | Channel |
|----|---------|
| Living Room U6 | 1 |
| Skyloft | 1 |
| Garage Mahal | 1 |
| Sauna Cabinet | 6 |
| Outhouse | 6 |
| Laundry Hall | 6 |
| Spartan | 11 |
| Doghouse | 11 |

Kernel (UNKNOWN — SSH password changed, access denied):

| Setting | Last known (2026-04-01) | Current |
|---------|------------------------|---------|
| multicast_snooping | 0 | UNKNOWN (resets on reboot) |
| multicast_querier | 0 | UNKNOWN (resets on reboot) |

**Analysis:** Three likely causes:
1. Kernel multicast_snooping may have reset to 1 (ON) after a UDM reboot, while controller shows OFF — the exact mismatch that caused the April 1 outage
2. SonosNet bridge conflict: Living Sound (wired) activates SonosNet mesh on 2.4GHz, interfering with WiFi-only Dining Sound when grouped
3. No Sonos DHCP reservations — IP churn during renewal can break active groups

**Planned fixes (pending SSH access):**
1. Verify/fix kernel multicast_snooping=0 and multicast_querier=0
2. Install persistent boot script at /data/on_boot.d/10-multicast-snooping-off.sh
3. Add DHCP reservations for all 14 Sonos speakers
4. Verify SonosNet channel doesn't overlap with nearby APs (check via speaker:1400/support/review)
5. Confirm wired speakers (Living Sound, MasterBlaster, saunaHiFi) connect through US8P60, not UDM Pro ports 1-8

**Root cause found — SonosNet channel 1 collision:**

SonosNet topology dump (`http://<speaker>:1400/support/review`) revealed:
- SonosNet home channel = **1 (2412 MHz)** for ALL speakers
- UniFi APs on channel 1: Living Room U6, Skyloft, Garage Mahal
- Living Sound and Dining Sound are both near the Living Room U6 AP
- When Spotify streams to both, SonosNet mesh + UniFi WiFi fight on same frequency → packet loss → cutouts

Speaker connection details (from diagnostics):

| Speaker | Operating Ch | Noise Floor | Connection | Notes |
|---------|-------------|-------------|------------|-------|
| Living Sound | N/A (wired primary) | N/A | Wired 100FD | SonosNet root bridge |
| Dining Sound | 1 | -96 dBm | Wired+WiFi | Has active ethernet! |
| garage outdoors | 1 | -104 dBm | Wired+WiFi | Also has active ethernet |
| MasterBlaster | 1 | -90 dBm | WiFi | |
| DJ | 1 | -92 dBm | WiFi | |
| SwimSpa | 11 | -92 dBm | WiFi | Only one on ch11 |
| Backyard Sound | 1 | -91 dBm | WiFi | |

**Fixes applied (2026-04-13):**

| Fix | Method | Status |
|-----|--------|--------|
| Boot persistence script | `/data/on_boot.d/10-multicast-snooping-off.sh` on UDM Pro | DONE |
| DHCP reservations for all 14 Sonos | MongoDB update to networkconf (.170-.183 range) | DONE |
| Kernel multicast_snooping verified | SSH check: `multicast_snooping=0`, `multicast_querier=0` | CONFIRMED OK |

**Remaining fixes (requires user action):**

| Fix | How | Why |
|-----|-----|-----|
| **Change SonosNet to channel 11** | Sonos app → Settings → System → SonosNet Channel → 11 | Eliminates ch1 collision with 3 APs |
| **OR: Go all-WiFi** | Unplug ethernet from Living Sound, Dining Sound, garage outdoors | Kills SonosNet entirely, no channel conflict |
| Reboot all speakers after DHCP change | Power cycle speakers one by one | They'll pick up new static IPs (.170-.183) |

**Recommendation:** Change SonosNet channel to 11 first. If cutouts persist, go all-WiFi (unplug all ethernet cables from Sonos speakers). The WiFi signal strength is good across all speakers (-42 to -54 dBm for most), so all-WiFi should be reliable.

**SSH gotcha resolved:** SSH was failing because `sshpass` can't handle UDM Pro fw 5.0.16 `keyboard-interactive` auth. Must use `expect` instead. Recipe updated in `service-access.md`.

---

### 2026-04-01: Full revert to pre-3/27 + kernel snooping fix

**Symptoms:** Music cuts off after ~1 minute, stops when starting music on a different speaker, songs take forever to load or fail entirely.

**Root causes (3 issues compounding):**

1. **Kernel `multicast_snooping` ON with querier OFF** — The UniFi controller's `igmp_snooping: false` toggle only controls the switch layer, NOT the Linux kernel's `br0` bridge. Kernel had `multicast_snooping=1` + `multicast_querier=0` → IGMP memberships expired after ~260s → multicast dropped.

2. **WPA3 Transition mode ON** — `wpa3_support: true`, `wpa3_transition: true`, `pmf_mode: "optional"` were set on Black Rock City. Old Sonos Connect devices tried WPA3 auth, failed, fell back to WPA2, causing repeated connection cycling.

3. **Various 3/27 "optimization" changes** — IGMP snooping ON (without proper querier), BSS Transition OFF, DTIM 5GHz changed to 1. None of these helped; the pre-3/27 defaults worked better.

**All fixes applied (2026-04-01):**

| Fix | Command/Method | Persists? |
|-----|---------------|-----------|
| Kernel multicast_snooping → 0 | `echo 0 > /sys/.../br0/bridge/multicast_snooping` via SSH | **NO** — resets on reboot |
| Kernel multicast_querier → 0 | `echo 0 > /sys/.../br0/bridge/multicast_querier` via SSH | NO |
| Controller IGMP snooping → OFF | API PUT to networkconf | Yes |
| BSS Transition → ON | API PUT to wlanconf | Yes |
| DTIM 5GHz → 3 (default) | API PUT to wlanconf | Yes |
| WPA3 Support → OFF | API PUT to wlanconf | Yes |
| WPA3 Transition → OFF | API PUT to wlanconf | Yes |
| PMF → disabled | API PUT to wlanconf | Yes |

**Lesson:** The controller UI is not the whole story. Always verify kernel-level settings via SSH (`cat /sys/devices/virtual/net/br0/bridge/multicast_snooping`). The two layers are independent.

**SSH gotcha:** UDM Pro SSH requires `-o PubkeyAuthentication=no` flag or sshpass can't feed the password. Without it, pubkey fails silently and keyboard-interactive doesn't prompt.

### 2026-03-31: "Unable to play" + songs not changing

**Root cause:** Tailscale DNS on Almaca was intercepting all DNS but offline, so the Sonos HTTP API couldn't resolve music service URLs (YouTube Music, Spotify). (Note: Sonos API has since moved to Alpuca.)

**Fix (on Almaca, historical):** `ssh alpaca@192.168.1.74` then:
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale set --accept-dns=false
```

**Secondary issue (REVERTED):** Tried disabling STP per-port on UDM Pro and US8P60 to fix group-add stops. This actually made things **worse** — caused persistent cutouts and grouping failures. Reverted `port_overrides` back to `[]` (default STP enabled). The Mar 30 working state had default STP on all ports.

**Lesson:** Despite internet guides recommending per-port STP disable for Sonos, it doesn't work on this network. The default STP is what was running when everything worked fine on Mar 27-30.

### 2026-03-31: Music stops after ~2 minutes (IGMP querier missing)

**Root cause:** IGMP snooping was ON (enabled Mar 27) but the **IGMP querier was OFF** (kernel default `multicast_querier=0`). Without a querier sending periodic queries, the switch's IGMP group membership entries expire after 260 seconds. Once expired, the switch stops forwarding multicast traffic to Sonos ports → music stops.

**Fix:** Enabled IGMP querier on br0 bridge:
```bash
echo 1 > /sys/devices/virtual/net/br0/bridge/multicast_querier
```

**Persistence:** Created `/data/on_boot.d/10-igmp-querier.sh` boot script on UDM Pro. Runs on every boot with 30s delay for bridge initialization.

**Why this wasn't caught earlier:** On Mar 27 when IGMP snooping was first enabled, the querier wasn't set. Music worked initially because speakers had just joined their multicast groups. The ~2-4 minute timeout wasn't immediately obvious during short testing sessions.

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
- **Tried fix:** Per-port STP disable — **made things worse** (reverted 2026-03-31)
- **Working state:** Default STP enabled on all ports. The grouping pause is brief (~2-3 sec) but playback resumes. Per-port STP disable caused persistent cutouts instead.

### Music Service Authentication

YouTube Music and Spotify tokens can expire if DNS is broken (e.g., Tailscale DNS interception). If you see "connection to YouTube Music was lost":
1. Check DNS on Alpuca: `ssh paca@192.168.1.200 "nslookup google.com"`
2. If DNS fails, check Tailscale: `scutil --dns` — Tailscale resolver should NOT be primary
3. In Sonos app: Settings → Services & Voice → remove and re-add the service

### Alpuca (Sonos HTTP API Server) Gotchas

- **Sonos API runs on Alpuca ONLY** (192.168.1.200). Never use Almaca — duplicate instances caused Living Sound cutouts.
- **DNS should resolve via UDM Pro (192.168.1.1)** not Tailscale (100.100.100.100)
- **node-sonos-http-api** uses DNS for music service lookups (Spotify, YouTube Music)
- If music commands fail with `getaddrinfo ENOTFOUND`, it's always a DNS issue on Alpuca

### UDM Pro Maintenance

- **After firmware updates or reboots:** Re-check kernel `multicast_snooping` via SSH — it resets to default (ON) on every reboot. Run: `cat /sys/devices/virtual/net/br0/bridge/multicast_snooping` — should be `0`.
- **After AP firmware updates:** Check multicast settings haven't been reset
- **Settings are in MongoDB** (port 27117 on UDM Pro) or via **REST API** (PUT with CSRF token — `alpacaauto` is Super Admin)

#### How to read/write UDM Pro settings

```bash
# SSH to UDM Pro (MUST use -o PubkeyAuthentication=no)
sshpass -p "$(bw-read 'UniFi Dream Machine Pro — Network Gateway' 'SSH Password')" \
  ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1

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
