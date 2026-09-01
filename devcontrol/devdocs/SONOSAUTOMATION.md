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

### DHCP Reservations (⚠️ TABLE BELOW IS STALE — see 2026-08-30 audit)

> **The `.170–.183` plan below was never adopted.** Reservations exist and work, but they are
> pinned to each speaker's pre-existing IP. Verified 2026-08-30 against `rest/user`. Query live
> state instead of trusting this table:
>
> ```bash
> curl -sk -b /tmp/uc.txt 'https://localhost/proxy/network/api/s/default/rest/user' \
>   | python3 -c "import sys,json;[print(u['mac'],u.get('fixed_ip')) for u in json.load(sys.stdin)['data'] if u.get('use_fixedip') and u['mac'].startswith(('00:0e:58','b8:e9:37'))]"
> ```
>
> Live as of 2026-08-30: .7 Skyloft, .25 SkyBalcony, .29 DJ, .33 Outhouse, .47 garage outdoors,
> .97 Backyard, .148 MasterBlaster, .156 Living, .178 Dining, .191 Pequeno, .193 Front Outside.
> Missing: Garage Bridge (.220, online), saunaHiFi, SwimSpa (both powered off).

Historical plan (not in effect):

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

## 2026-04-16 — Deep Dive: Retry Rates & Controller Fixes

### Live diagnostic snapshot (UDM controller, 14 speakers)

**Wired (2):** MasterBlaster (UDM port 5), .156 SonosZP (UDM port 8). Both on UDM Pro's internal dumb switch — not a managed USW. Per doc this is a known weak spot (no STP processing), but only 2 devices so low loop risk.

**Wireless (12):** ALL on "Black Rock City" SSID, ALL on 2.4GHz channel 1, connected to 3 APs:
- Living Room U6 (e4:38:83) — 3 clients
- Skyloft (18:e8:29) — 4 clients
- Garage Mahal (78:8a:20) — 4 clients (⚠ mostly weak signal)
- Outhouse (fc:ec:da) — 1 client (ch6, -16 dBm, excellent)

### tx_retry % per client (computed tx_retries / (tx_retries+tx_packets))

| IP | AP | Signal | **Retry %** | tx_rate |
|----|----|--------|-------------|---------|
| 192.168.1.220 | Garage Mahal | -79 | **63.7%** | 24 Mbps |
| 192.168.1.99  | Garage Mahal | -76 | **61.7%** | 36 Mbps |
| 192.168.1.42  | Garage Mahal | -77 | **39.1%** | 54 Mbps |
| 192.168.1.47  | Garage Mahal | -41 | 18.7% | 54 Mbps |
| 192.168.1.29  | Living Room  | -62 | 15.0% | 6 Mbps |
| 192.168.1.191 | Living Room  | -41 | 9.3%  | 6 Mbps |
| 192.168.1.97  | Skyloft      | -47 | 5.6%  | 54 Mbps |
| 192.168.1.7   | Skyloft      | -42 | 5.8%  | 54 Mbps |
| 192.168.1.25  | Skyloft      | -44 | 6.9%  | 54 Mbps |
| 192.168.1.193 | Skyloft      | -54 | 3.9%  | 54 Mbps |
| 192.168.1.178 | Living Room  | -43 | 3.6%  | 6 Mbps |
| 192.168.1.33  | Outhouse     | -16 | 2.1%  | 54 Mbps |

**Anything >5% retry = audible cutouts. 6 of 12 clients exceed this.**

### Applied fixes (via Mongo on UDM, port 27117)

1. **Enabled IGMP Snooping on `Default` network** (was `false`). Prevents multicast flooding of Sonos discovery packets to every port.
   ```
   db.networkconf.updateOne({_id:ObjectId("692fb4074604456db96c9784")}, {$set:{igmp_snooping:true}})
   ```
2. **Disabled BSS Transition (802.11v) on `Black Rock City` SSID** (was `true`). Per doc this confuses legacy Sonos S1 NICs and causes disconnects when AP tries to migrate them. Fast Roaming (802.11r) was already off ✓.
   ```
   db.wlanconf.updateOne({_id:ObjectId("694897ccae8561195e0c0398")}, {$set:{bss_transition:false}})
   ```
3. Set `provisioned_at:0` on all UAPs/USWs to force controller re-push of config.

Mongo writes bypass alpacaauto's read-only REST role (which 403s on PUT). Use the `expect` wrapper in `memory/service-access.md` § UDM Pro.

### Verified current WLAN state ("Black Rock City", post-change)

| Setting | Value | Doc recommends |
|---------|-------|----------------|
| bss_transition | **false** ✓ | disable |
| fast_roaming_enabled | false ✓ | disable |
| minrate_ng_enabled | true, 6 Mbps | ok (weak clients stay connected) |
| mcastenhance_enabled | false | doc says enable for wireless Sonos BUT warns "occasionally conflicts with legacy S1" — left OFF |
| pmf_mode | disabled ✓ | keep disabled for S1 |
| wpa_mode | wpa2 ✓ | S1 requires WPA2 |
| wlan_band | both | recommend 2g-only for a dedicated Sonos SSID |
| band_steering | not set (off) ✓ | disable |

### Additional fix applied (2026-04-16, after user sign-off)

**Moved Garage Mahal AP (78:8a:20:50:c2:8b) from 2.4GHz ch1 → ch11.**

Mongo edit alone didn't propagate — controller caches the device's `radio_table` in memory. Had to:
1. `db.device.updateOne({mac:"78:8a:20:50:c2:8b"},{$set:{"radio_table.$[ng].channel":"11"}})` (or equivalent positional update on `radio.ng`)
2. `db.device.updateOne(...,{$set:{cfgversion:"0000000000000000"}})` to invalidate cached config hash
3. `systemctl restart unifi.service` on the UDM Pro — ~45s API outage, WiFi kept running during.
4. On next inform (~30-60s post-restart), controller pushed ch11 to AP.

**Post-change channel distribution (11 wireless Sonos):**
- ch1 (Living Room U6 + Skyloft): 7 clients (down from 11)
- ch6 (Outhouse + Laundry Hall): **4 clients (up from 1)** — Garage Mahal's 3 sticky clients roamed to Laundry Hall on ch6, plus .220 picked up Outhouse
- ch11 (Garage Mahal): 0 — clients scattered on roam as expected (they had weak signal to Garage Mahal anyway)

**Post-change retry rates:**

| IP | AP (new) | Signal | Retry % | Δ from before |
|----|----------|--------|---------|---------------|
| 192.168.1.47  | Laundry Hall (ch6) | -53 | **5.0%** | ✓ was 18.7% on Garage Mahal |
| 192.168.1.193 | Skyloft (ch1) | -51 | **1.2%** | ✓ was 3.9% |
| 192.168.1.42  | Laundry Hall (ch6) | -77 | 59.0% | ~ was 39.1% (similar weak RF) |
| 192.168.1.99  | Laundry Hall (ch6) | -76 | 68.5% | ~ was 61.7% |
| 192.168.1.220 | Outhouse (ch6) | -81 | 69.6% | ~ was 63.7% |
| 192.168.1.29  | Living Room (ch1) | -62 | 17.8% | ↑ was 15.0% |
| 192.168.1.191 | Living Room (ch1) | -42 | 12.6% | ~ was 9.3% |

**Verdict:** ch1 congestion relieved. `.47` improved dramatically (got it off sticky Garage Mahal). Three weak-signal speakers (`.42`, `.99`, `.220`) still have 59–70% retry rates regardless of AP — they're in RF dead zones and need physical remediation.

### Remaining problems — physical/RF, no config fix

- **Three speakers in RF dead zones:** `.42`, `.99`, `.220` all sit at –76 to –81 dBm on their closest AP with >59% retry rate. Any AP will fail them.
  - **Action required (physical):** identify locations of these three speakers (MACs: b8:e9:37:93:cb:ec, 00:0e:58:2d:67:9c, 00:0e:58:21:e8:e0). Need an extra AP or Sonos Boost near them, or move the speaker closer to an existing AP.
  - Previously noted: these appeared tied to Pequeno / SwimSpa region. Sauna HFi and SwimSpa speakers reported as "not on" so the cutouts there may also be power state, not network.
- **Wired Sonos on UDM Pro ports 5,8** (MasterBlaster, `.156`). Only 2 devices so low loop risk, but gold-standard is to re-wire them to the US8P60 (Skyloft Closet switch — already `stp_version=stp`, priority 8192, all ports edge-mode ✓). Physical rewiring, user decision.

### Deferred settings (not applied — user decision)

| Setting | Current | Doc rec | Why deferred |
|---------|---------|---------|--------------|
| Global STP mode on non-US8P60 | RSTP | STP (802.1D) | US8P60 is already `stp`. Other APs/switches: Flex Minis don't expose STP, UDM internal bridge doesn't STP. Marginal impact. |
| Move wired Sonos → US8P60 | UDM ports 5,8 | Managed switch | Physical rewire |
| Raise `minrate_ng_data_rate_kbps` 6→12 Mbps on BRC | 6000 | 12000 | **Risky on S1** — may disconnect weak clients permanently. Skip until tested. |
| Enable `mcastenhance_enabled` on BRC | false | true | Doc warns S1 conflicts; keep off. |
| Add extra 2.4GHz AP near Pequeno/SwimSpa | n/a | — | Physical install |

### Ports the Sonos S1 + UniFi doc says must be allowed (cross-VLAN only — we're single-VLAN, so n/a today)

UDP 1900 (SSDP), UDP 5353 (mDNS), TCP 1400/1443 (control), TCP 3400/3401 (event push), UDP 6969 (setup), TCP 80/443 (streaming).

## 2026-05-06 — Channel-11 SonosNet conflict, controller-IGMP drift, daily drift-detection cron

### Reported symptom

Music stops after a few minutes; faster when more rooms are grouped. Working a while back, broke after troubleshooting.

### Diagnostic — SonosNet matrix on every speaker

Pulled `http://<ip>:1400/status/proc/ath_rincon/status` from 11 reachable speakers. Pattern was unambiguous:

| Speaker (SonosNet root) | PHY errors / read | STP nodes unreachable | Noise floor |
|---|---|---|---|
| Garage Bridge "no sound" (.220) | **12,806,409** | 9 of 11 | -97 dBm |
| Skyloft (.7) | 4,039,566 | 1 | -95 dBm |
| Front Outside (.193) | 4,286,326 | 4 | -101 dBm |

PHY errors in the millions per read = severe co-channel interference. SonosNet is on **channel 11 (2462 MHz)**. STP 00 across most edges of the matrix = mesh hadn't converged. "Drops faster when grouped" = the Group Coordinator's clock-sync buffer drains under packet loss + retransmits, then audio dies.

### Root causes (two stacked drifts)

**Drift #1 — UniFi 2.4 GHz channel 11 collision with SonosNet.** Three APs were on ch 11. The reference notes (and §UDM Pro Network Settings above) require **NO UniFi AP on the SonosNet channel**. Garage Mahal AP sat right next to the wired SonosNet root in the garage — that single co-channel pair was the dominant interference source.

| AP | Pre-fix ch | Post-fix ch | Note |
|---|---|---|---|
| Garage Mahal (78:8a:20) | 11 | **1** | next to Sonos Boost root |
| Spartan (f4:92:bf) | 11 | **6** | |
| Sauna Cabinet (fc:ec:da:f0:d4:b7) | 11 | **1** | |
| Skyloft / Living Room U6 / Laundry / Outhouse / DoggieHaus | 1 / 6 (unchanged) | 1 / 6 | |

Final distribution: 4 APs on ch 1, 4 APs on ch 6, **0 APs on ch 11** — channel 11 reserved for SonosNet alone.

**Drift #2 — Controller IGMP snooping drifted from `false` (working) to `true`.** The 2026-04-16 deep dive enabled controller IGMP snooping on the Default LAN with the intent of "preventing multicast flooding". But the §Kernel vs Controller IGMP Snooping CRITICAL warning above still applies: **both layers must be OFF for 14 zones to be reliable** (the documented 2026-04-01 working state). Verified today:

| Layer | State on 2026-05-06 (start) | State after fix | Working baseline |
|---|---|---|---|
| Kernel `br0/multicast_snooping` | 0 ✓ (persisted via `/data/on_boot.d/10-multicast-snooping-off.sh`) | 0 | 0 |
| Controller `networkconf.igmp_snooping` (Default LAN) | **true** ❌ | **false** ✓ | false |

Reverting controller IGMP to `false` matches the 2026-03-06 stable snapshot (`network_config_snapshots` row `a9d45377`) and the 2026-04-01 "100% reliable" state. Kernel state already correct.

### Other changes applied

- **Skyloft Closet US8P60 stp_priority `8192 → 4096`** to make it the explicit STP Root Bridge. Was implicitly winning by lowest MAC, now wins by configured priority.
- **Black Rock City `mcastenhance_enabled` explicit `false`** (was already false but field-name had been ambiguous in past audits).

### Fix surface — write recipe

`alpacaauto` has Super Admin role. Earlier note that called it "API read-only" was a CSRF-extraction bug. **CSRF lives in the `x-csrf-token` response header on login, not in the cookie file's `TOKEN` (that's a JWT).** Recipe in `memory/service-access.md` §8.

```bash
# Capture CSRF from login RESPONSE HEADER
HEADERS=$(curl -sk -i -c /tmp/uc.txt -X POST 'https://192.168.1.1/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"alpacaauto\",\"password\":\"$BW_PASS\",\"remember\":true}")
CSRF=$(echo "$HEADERS" | grep -i '^x-csrf-token:' | tr -d '\r' | awk '{print $2}')

# Set channel on an AP
curl -sk -b /tmp/uc.txt -X PUT \
  "https://192.168.1.1/proxy/network/api/s/default/rest/device/<DEVICE_ID>" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"radio_table":[{"radio":"ng","name":"wifi0","channel":"1","ht":"20","tx_power_mode":"auto"},{"radio":"na","name":"wifi1","channel":"auto","ht":"40","tx_power_mode":"auto"}]}'
```

Mongo direct edits also work but require `cfgversion:0` invalidation + `unifi.service` restart to push the radio_table change. The PUT path doesn't.

### Configuration Drift Detection — Daily Auto-Snapshots

Drifts like the controller-IGMP toggle are silent — nothing flashes red, you just notice that audio dies more often. We now snapshot the entire UDM config every night at 4:00 AM into Supabase so any future drift is bisectable to a date.

**Where:** `public.network_config_snapshots`. Single table, one row per snapshot, `config jsonb` column holds full state (networks, wifi_networks, access_points, switches, plus a `critical_rules_for_sonos` array).

**Stable baseline:** row id `a9d45377-fef8-480c-9526-1caa7fd1b72d` (2026-03-07, `is_stable=true`, tagged `[sonos,multicast,wifi,stable]`). Rule #1 in its annotation explicitly: "IGMP snooping MUST be disabled on the Default LAN network."

**Daily snapshot:** Alpuca crontab line:
```
0 4 * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/Documents/codingprojects/alpacapps/scripts/unifi-snapshot-cron.sh >> /Users/alpuca/logs/unifi-snapshot.log 2>&1
```

Wrapper: `scripts/unifi-snapshot-cron.sh` (in repo). Reads creds from `/Users/alpuca/.unifi-snapshot.env` (chmod 600 — macOS Keychain isn't reachable from cron/SSH on Alpuca, so plaintext-cred files match the existing `~/.ha_llat`, `~/.sb_service_key` pattern).

**Manual snapshot from any dev box** (after a deliberate change):
```bash
./scripts/unifi-snapshot.sh "Description of change" --notes "Why" --tags sonos,wifi --stable
```
Tagging `--stable` flags it as a known-good baseline for future diff queries.

**Diff query — "what's drifted from the last stable baseline?"**
```sql
WITH stable AS (SELECT config FROM public.network_config_snapshots WHERE is_stable=true ORDER BY snapshot_date DESC LIMIT 1),
     latest AS (SELECT config FROM public.network_config_snapshots ORDER BY snapshot_date DESC LIMIT 1)
SELECT
  'igmp_snooping (Default LAN)' AS field,
  stable.config -> 'networks' -> 'default_lan' ->> 'igmp_snooping' AS stable_value,
  latest.config -> 'networks' -> 'default_lan' ->> 'igmp_snooping' AS current_value
FROM stable, latest;
```

Extend with one UNION ALL per field you care about, or read the full `config` jsonb pretty:
```sql
SELECT jsonb_pretty(config) FROM public.network_config_snapshots WHERE is_stable=true ORDER BY snapshot_date DESC LIMIT 1;
```

**Operational note:** if a UDM password or the Supabase Dashboard Access Token rotates in Bitwarden, regenerate `~/.unifi-snapshot.env` on Alpuca or cron fails silently. Refresh recipe in `memory/service-access.md` §0.

## 2026-08-30 — Multi-zone dropout audit (3–5 grouped zones)

### Reported symptom

Dropouts when 3–5 zones play the same music concurrently.

### 🚨 PRIMARY ROOT CAUSE — kernel snooping ON, querier OFF, boot script never ran

`multicast_snooping=1` + `multicast_querier=0` on the UDM's `br0` bridge — **the exact fatal
combination documented in §Kernel vs Controller IGMP Snooping**. IGMP group memberships expire
after ~260 s with no querier to refresh them, the bridge stops forwarding multicast to Sonos,
and audio dies. Dropping faster with more grouped zones is the signature symptom.

**Why the 2026-04-13 "DONE" fix didn't hold:** `/data/on_boot.d/10-multicast-snooping-off.sh`
exists and is `-rwxr-xr-x`, but **`udm-boot.service` does not exist on this UDM**
(`systemctl status udm-boot` → "Unit could not be found"). That systemd unit — from the
`udm-utilities` boot-script package — is what actually executes `/data/on_boot.d/*`. Without it
the directory is inert. **The script has never run on any boot since it was created.**

The 2026-04-13 and 2026-05-06 entries recorded this as persisted; that was wrong. Placing the
file was verified, installing the runner was not.

UDM uptime at audit: 10 h 30 m (rebooted ~01:01 on 2026-08-30, matching `/data` mtime). So the
system has been in the fatal state all day.

**Lesson (again, harder):** verifying a persistence *artifact* exists is not verifying the
*mechanism* runs. Always confirm with `systemctl status udm-boot` and by reading back the
kernel value after an actual reboot.

### Controller/WLAN audit — NO DRIFT ✓

Pulled live via UDM API (from Alpuca, `~/.unifi-snapshot.env` creds). Every documented-critical setting matches the working baseline: `igmp_snooping=false`, `mdns=true`, `mcastenhance=false`, `bss_transition=false`, `fast_roaming=false`, `dtim_ng=1/dtim_na=3`, `wpa2` only, `pmf=disabled`, `min-rate 6 Mbps`, `l2_isolation/proxy_arp/uapsd off`, `group_rekey=0`. Nightly snapshot cron confirmed running (last: 2026-08-30 04:00).

AP 2.4 GHz plan still matches the 2026-05-06 fix: 4 APs ch1, 4 APs ch6, **0 on ch11** (SonosNet home ch = 11 confirmed on every speaker, `/status/proc/ath_rincon/status`).

### Actual bottleneck — channel-1 airtime congestion

10 wireless Sonos online (SwimSpa + saunaHiFi powered off). **8 of 10 sit on ch1**, where the APs also carry the heaviest general load (Skyloft 27 clients, Living Room U6 22, Garage Mahal 13). Grouped playback multiplies unicast streams over this one channel → retry-rate blowups:

| IP | Speaker | ch | RSSI | Retry % |
|----|---------|----|------|---------|
| .178 | Dining | 1 | -48 | **34.6%** |
| .25 | SkyBalcony | 6 | -57 | **18.0%** |
| .47 | garage outdoors | 1 | -41 | **16.6%** |
| .97 | Backyard | 1 | -61 | **14.4%** |
| .220 | Garage Bridge | 1 | -55 | **10.0%** |
| .191 | Pequeno | 1 | -58 | 6.9% |
| .33 | Outhouse | 6 | -16 | 5.5% |
| .29 | DJ | 1 | -31 | 4.7% |
| .193 | Front Outside | 1 | -52 | 4.1% |
| .7 | Skyloft | 1 | -43 | 3.5% |

>5% retry = audible cutouts; 7 of 10 exceed it. Dining at -48 dBm with 34.6% retry = pure congestion, not signal. Dining/garage outdoors/Pequeno/Backyard/DJ are all sticky on Garage Mahal (78:8a:20).

### Other findings

- **DHCP reservations ARE active and correct** — but at the speakers' real addresses, not the
  `.170–.183` block the 2026-04-13 table claims. 11 of 14 Sonos MACs carry `use_fixedip` in
  `rest/user`, and every one matches the live IP. The **table below was superseded**; the
  network is fine, the doc was stale. (An earlier draft of this entry wrongly said the
  reservations "never took effect" — corrected after querying `rest/user` directly.)
  **Gap:** `00:0e:58:21:e8:e0` (Garage Bridge, .220) is online with **no** reservation.
  saunaHiFi and SwimSpa also lack one but are powered off.
- Kernel multicast state: see the PRIMARY ROOT CAUSE section above — found at `snooping=1`,
  `querier=0`, boot runner missing.
- Wired: Living Sound (port 4) + MasterBlaster (port 5) on UDM internal switch — unchanged; their presence keeps SonosNet mesh alive in the background (all wireless speakers still hold ch11 mesh state while running INFRA on WiFi).

### Recommendations (in order of leverage)

0. **FIX THE KERNEL STATE + INSTALL A REAL BOOT RUNNER** (do this first — everything else is
   secondary until multicast forwarding is sane). Run from Alpuca:

   ```bash
   source ~/.unifi-snapshot.env
   sshpass -p "$UDM_SSH_PASS" ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no root@192.168.1.1 '
     echo 0 > /sys/devices/virtual/net/br0/bridge/multicast_snooping
     echo 0 > /sys/devices/virtual/net/br0/bridge/multicast_querier
     cat > /etc/systemd/system/udm-boot.service <<EOF
   [Unit]
   Description=Run /data/on_boot.d scripts at boot
   After=network-online.target
   Wants=network-online.target
   [Service]
   Type=oneshot
   ExecStart=/bin/sh -c "for f in /data/on_boot.d/*.sh; do [ -x \$f ] && \$f; done"
   RemainAfterExit=true
   [Install]
   WantedBy=multi-user.target
   EOF
     systemctl daemon-reload && systemctl enable --now udm-boot.service
     systemctl is-enabled udm-boot.service
     cat /sys/devices/virtual/net/br0/bridge/multicast_snooping'
   ```

   Note: `/etc/systemd/system` is wiped by UniFi OS **firmware upgrades** (not by plain
   reboots). Re-run this block after every firmware update, and verify with
   `systemctl status udm-boot`.

1. **Add the one missing DHCP reservation** — Garage Bridge `00:0e:58:21:e8:e0` → `192.168.1.220`
   (its current address, so nothing moves and no conflict is possible):

   ```bash
   source ~/.unifi-snapshot.env
   curl -sk -c /tmp/uc.txt -X POST 'https://192.168.1.1/api/auth/login' -H 'Content-Type: application/json' \
     -d "{\"username\":\"alpacaauto\",\"password\":\"$UDM_WEB_PASS\",\"remember\":true}" -D /tmp/uh.txt >/dev/null
   CSRF=$(grep -i '^x-csrf-token:' /tmp/uh.txt | tr -d '\r' | awk '{print $2}')
   UID_=$(curl -sk -b /tmp/uc.txt 'https://192.168.1.1/proxy/network/api/s/default/rest/user' \
     | python3 -c "import sys,json;print([u['_id'] for u in json.load(sys.stdin)['data'] if u['mac']=='00:0e:58:21:e8:e0'][0])")
   curl -sk -b /tmp/uc.txt -X PUT "https://192.168.1.1/proxy/network/api/s/default/rest/user/$UID_" \
     -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
     -d '{"use_fixedip":true,"fixed_ip":"192.168.1.220","name":"Sonos Garage Bridge"}'
   ```

2. **⏸ HOLD the ch1 rebalance until the telemetry has a few days of data.** The 2.4 GHz client
   split is genuinely lopsided — **ch1 carries ~67 clients across 4 APs, ch6 only ~33** — and
   moving Garage Mahal (13 clients, 5 of them Sonos) ch1→ch6 would even it out without touching
   ch11. But: (a) it merely *relocates* the Sonos crowd rather than shrinking it — 7 speakers
   would end up on ch6 and 3 on ch1; (b) doing it in the same window as the multicast fix makes
   it impossible to attribute any improvement to either change. `sonos_health_samples` now
   records retry % per speaker per channel every 15 min. Let it run, then decide from the
   `largest_group_size` vs `avg_worst_retry` query in `sonos-health-schema.sql`. If retry rates
   stay flat as group size climbs, congestion was never the binding constraint and this change
   is unnecessary.

3. **Consider all-SonosNet** (still open, user action): ch11 has no UniFi APs on it. Removing
   WiFi credentials from the Sonos system would move every speaker onto that dedicated channel.
   Reversible. Worth trying only if dropouts persist after the multicast fix.

4. Physical: power on/check SwimSpa + saunaHiFi (both offline, both un-reserved).

**Observation logged 2026-08-30 11:50:** Garage Bridge (.220) accumulated **~2.3 M PHY errors in
~30 min** on SonosNet ch11 despite no UniFi AP sharing that channel — so the interference is
external (neighbouring networks or garage RF environment), not self-inflicted. The new telemetry
samples this every 15 min; if it stays in the millions, that speaker needs physical remediation,
not config.

## Telemetry — two layers (config nightly, symptoms every 15 min)

The 2026-08-30 incident exposed the gap: the nightly config snapshot is blind to anything below
the controller API, so a kernel-level regression ran for 10 hours unnoticed. Symptom sampling
now covers that.

| Layer | Script | Output | Cadence | Catches |
|---|---|---|---|---|
| Config history | `unifi-snapshot-cron.sh` → `unifi-snapshot.py` | `network_config_snapshots` | nightly 04:00 | controller/WLAN drift, bisectable to a date |
| Symptom telemetry | `sonos-health-cron.sh` → `sonos-health.py` | `sonos_health_samples` | every 15 min | **kernel multicast state**, **udm-boot.service missing**, retry rates, PHY errors, group size |
| Weekly review | `sonos-weekly-report.sh` → `sonos-weekly-report.py` | email via Resend | Mondays 08:00 | reboot-survival verdict, retry-vs-group-size trend, per-speaker ranking |

**All three run as local cron on Alpuca — not as cloud routines.** A scheduled cloud
agent cannot reach the UDM, Alpuca, or the LAN, and has no access to `~/.unifi-snapshot.env`,
so it cannot collect or query any of this. Anything scheduled for Sonos work belongs on Alpuca.

### What `sonos-health.py` checks

**Kernel tripwire (the 2026-08-30 blind spot):** `br0` `multicast_snooping` / `multicast_querier`
must both be 0, **and `udm-boot.service` must be `enabled`**. That last check is the important
new one — it is what silently failed from April to August, letting the boot script exist without
ever running. Any of these failing is a `CRITICAL` violation and pages immediately.

**Controller rules:** all the Sonos-critical settings (IGMP snooping off, mDNS on, mcast
enhancement off, BSS transition off, fast roaming off, L2 isolation off, WPA2/PMF-disabled,
min-rate ≤ 6 Mbps) plus rule #8 — no UniFi 2.4 GHz AP on SonosNet's channel 11.

**RF + playback:** per-speaker retry %, RSSI, channel, associated AP (joined from the UDM client
table), SonosNet PHY-error rate scraped from each speaker's `:1400` endpoint, and zone/group
counts from the Sonos HTTP API. Speakers are matched to UDM clients by decoding the MAC out of
the Sonos UUID (`RINCON_000E5821E8E0…` → `00:0e:58:21:e8:e0`) — no subnet scan needed.

Retry thresholds are deliberately above the doc's "5% = audible" line, since ~5% is the current
steady state and alerting there would be pure noise: any single speaker ≥ 25%, or ≥ 3 speakers
≥ 15%. Tune the constants at the top of the script.

### Self-healing (`--remediate`, enabled in the Alpuca cron since 2026-09-01)

Detection alone still meant a human had to read email and SSH in — a 1 am reboot would drop
audio until someone woke up. With `--remediate`, when the kernel tripwire fails the collector
applies the documented baseline itself (`echo 0 >` both bridge sysfs files) and, if
`udm-boot.service` is absent, rewrites the unit and enables it — then alerts. Outage window
shrinks from "until noticed" to ≤ 15 min, and firmware upgrades (which wipe
`/etc/systemd/system`) no longer regress silently.

Forensics stay honest: the sample records the state **as found** (`kernel_multicast_snooping=1`
etc.), with the post-fix state under `detail.remediation`. So the weekly reboot-survival check
still sees the failure — it just also sees that it was auto-corrected. The alert email carries a
`REMEDIATED automatically:` line; if it also says *"udm-boot.service was reinstalled"*, a firmware
upgrade almost certainly happened (`detail.udm_firmware` is recorded every sample for exactly
this comparison).

To disable: remove `--remediate` from the crontab line on Alpuca. It never touches anything but
the two sysfs values and the unit file.

**First real use — 2026-09-01 18:15 CDT:** the first `--remediate` tick found `udm-boot.service`
missing (it had never been installed — see the 2026-08-30 root cause), wrote and enabled it, and
recorded the sample as found (`udm_boot_service='missing'`, `detail.remediation.post.udm_boot='enabled'`).
Router verified afterwards: `enabled`, snooping `0`, querier `0`. A remediation event bypasses
the 6 h alert debounce so it is emailed immediately.

### Proving persistence: do a controlled reboot

"Persistence UNPROVEN" stays in the weekly report until the UDM actually reboots, and waiting
weeks for a natural one is a poor test. Once `udm-boot.service` is enabled, reboot the UDM
deliberately at a quiet hour (`reboot` over SSH, ~3 min of WAN outage). The 15-min sampler will
catch the post-boot state and the next Monday report flips to **CONFIRMED** — or tells you
exactly what came up wrong.

### Alerting

Resend → `rahulioson@gmail.com`, using the existing `~/.config/resend/key`. Debounced via
`~/.sonos-health-state.json`: fires on entering a bad state, re-fires at most every 6 h while
still bad, and sends one recovery notice when rules pass again.

### Install

```bash
# 1. Create the table (once) — paste scripts/sonos-health-schema.sql into the Supabase SQL editor
# 2. Deploy to Alpuca (TCC: cron cannot execute from ~/Documents — see service-access.md §0)
cp scripts/sonos-health.py scripts/sonos-health-cron.sh /Users/alpuca/scripts/
chmod +x /Users/alpuca/scripts/sonos-health-cron.sh
# 3. Verify by hand before scheduling
/Users/alpuca/scripts/sonos-health-cron.sh --dry-run
# 4. Schedule
( crontab -l; echo '*/15 * * * * PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /Users/alpuca/scripts/sonos-health-cron.sh >> /Users/alpuca/logs/sonos-health.log 2>&1' ) | crontab -
```

Credentials come from the same `~/.unifi-snapshot.env` the nightly snapshot uses — nothing new
to rotate.

### Useful queries

See the commented block at the bottom of `scripts/sonos-health-schema.sql`. The two that matter
most: *"what did the kernel look like right after the last reboot"* (proves persistence works)
and *"does retry rate worsen as group size grows"* (settles the ch1 rebalance question).

### Weekly review (`sonos-weekly-report.py`)

Emails a Monday digest that answers what a single sample cannot:

1. **Reboot survival.** Finds samples with `udm_uptime_seconds < 3600` and reports the kernel
   state captured right after boot. A reboot is the only genuine test of `udm-boot.service`,
   and there may be weeks between them — so until one happens the report says persistence is
   **UNPROVEN** rather than implying it works.
2. **The ch1 verdict.** Compares average worst-retry at group size 1 against the largest group
   seen. ≥8 pct-pt says rebalance; ≤3 says congestion is not the binding constraint and the
   channels should be left alone. Needs grouped playback during the week to have any signal —
   if nothing is ever grouped it says so instead of guessing.
3. Per-speaker retry ranking, SonosNet PHY averages over valid intervals only, and every rule
   violation seen that week with counts.

Run it on demand from Alpuca:

```bash
/Users/alpuca/scripts/sonos-weekly-report.sh --print       # stdout, no email
/Users/alpuca/scripts/sonos-weekly-report.sh --days 14     # wider window, emails
```

**Gotcha:** the Supabase SQL API returns `numeric`/`bigint` as JSON **strings**. Comparing them
raises `TypeError` — coerce with the `num()` helper before any arithmetic. Both this script and
`sonos-health.py` also must send an explicit `User-Agent`; Cloudflare fronts Resend and the
Supabase Management API and answers urllib's default agent with `403` / error `1010`.

## References

- [UniFi + Sonos Configuration Guide (GitHub, 537★)](https://github.com/IngmarStein/unifi-sonos-doc)
- [Ubiquiti Help Center: Best Practices for Sonos](https://help.ui.com/hc/en-us/articles/18930473041047)
- [Sonos Community: Large UniFi Network Performance](https://en.community.sonos.com/advanced-setups-229000/large-sonos-and-unifi-network-performance-problems-6829841)
- [Sonos Community: SonosNet vs WiFi with UniFi 2025](https://en.community.sonos.com/advanced-setups-229000/sonosnet-vs-wifi-with-unifi-2025-6926853)
- [UniFi Community: STP and Sonos](https://community.ui.com/questions/UniFi-STP-and-Sonos/7f72d9cf-6511-42f6-b6bc-d9b5efb7cb19)
