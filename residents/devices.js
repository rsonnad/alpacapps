/**
 * Devices Page — Hybrid table with group headers.
 * Queries devices_unified view for base inventory,
 * overlays live data (Sonos playback, vehicle GPS).
 */

import { initResidentPage } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';
import { loadZones } from '../shared/services/sonos-data.js';

/* ── Constants ── */

const DOMAIN_ORDER = ['security', 'lighting', 'climate', 'vehicle', 'appliance'];
const DOMAIN_LABELS = {
  security: 'Cameras', lighting: 'Lighting', climate: 'Climate',
  vehicle: 'Vehicles', appliance: 'Appliances',
};
const DOMAIN_ICONS = {
  security: '📹', lighting: '💡', climate: '🌡️',
  vehicle: '🚗', appliance: '🧺',
};
const DOMAIN_LINKS = {
  security: { href: 'cameras.html', label: 'Camera Feeds' },
  lighting: { href: 'lighting.html', label: 'Lighting Controls' },
  climate:  { href: 'climate.html', label: 'Climate Controls' },
  vehicle:  { href: 'cars.html', label: 'Vehicle Controls' },
  appliance:{ href: 'appliances.html', label: 'Appliance Status' },
};

const COLLAPSE_KEY = 'devices-collapsed-v2';
const ONSITE_RADIUS_M = 200;

/* ── Helpers ── */

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function esc(s) {
  if (s == null || s === '') return '—';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Data Loading ── */

let propertyGps = null;

async function fetchPropertyGps() {
  try {
    const { data } = await supabase
      .from('spaces').select('gps')
      .is('parent_id', null).not('gps', 'is', null)
      .limit(1).single();
    if (data?.gps) propertyGps = data.gps;
  } catch (e) { console.warn('Property GPS fetch failed:', e); }
}

async function loadDevices() {
  // Base inventory from unified view
  const { data: devices, error } = await supabase
    .from('devices_unified')
    .select('*');
  if (error) throw error;
  return (devices || []).filter(d => d.is_active);
}

async function loadLiveOverlays() {
  const overlays = { sonos: [], vehicleStates: {}, cameraDetails: {} };

  // Sonos live playback
  try {
    const zones = await Promise.race([
      loadZones(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    if (zones.length > 0) {
      for (const group of zones) {
        const state = group.coordinatorState || {};
        const track = state.currentTrack || {};
        const playback = state.playbackState || 'STOPPED';
        const isActive = playback === 'PLAYING' || playback === 'PAUSED_PLAYBACK';
        for (const member of group.members || []) {
          overlays.sonos.push({
            room_name: member.roomName,
            playbackState: playback,
            volume: member.volume,
            mute: member.mute,
            trackTitle: isActive ? (track.title || '') : '',
            trackArtist: isActive ? (track.artist || '') : '',
          });
        }
      }
    }
  } catch (e) { console.warn('Sonos live fetch failed:', e); }

  // Vehicle last_state for GPS + battery
  try {
    const { data } = await supabase
      .from('vehicles')
      .select('id, last_state, last_synced_at, vehicle_state')
      .eq('is_active', true);
    for (const v of (data || [])) {
      overlays.vehicleStates[String(v.id)] = {
        last_state: v.last_state || {},
        last_synced_at: v.last_synced_at,
        vehicle_state: v.vehicle_state,
      };
    }
  } catch (e) { console.warn('Vehicle state fetch failed:', e); }

  // Camera details (model, space map)
  try {
    const [streamsRes, spacesRes] = await Promise.all([
      supabase.from('camera_streams').select('camera_name, camera_model, quality').eq('is_active', true),
      supabase.from('camera_space_map').select('camera_name, space:space_id(name)'),
    ]);
    const spaceMap = {};
    for (const row of (spacesRes.data || [])) {
      if (!spaceMap[row.camera_name]) spaceMap[row.camera_name] = [];
      if (row.space?.name) spaceMap[row.camera_name].push(row.space.name);
    }
    const camMap = {};
    for (const s of (streamsRes.data || [])) {
      if (!camMap[s.camera_name]) camMap[s.camera_name] = { model: s.camera_model, qualities: [], spaces: '' };
      camMap[s.camera_name].qualities.push(s.quality);
      if (spaceMap[s.camera_name]) camMap[s.camera_name].spaces = spaceMap[s.camera_name].sort().join(', ');
    }
    overlays.cameraDetails = camMap;
  } catch (e) { console.warn('Camera details fetch failed:', e); }

  // Climate last_state
  try {
    const { data } = await supabase
      .from('nest_devices')
      .select('id, last_state')
      .eq('is_active', true);
    overlays.climateStates = {};
    for (const d of (data || [])) {
      overlays.climateStates[String(d.id)] = d.last_state || {};
    }
  } catch (e) { console.warn('Climate state fetch failed:', e); }

  // Appliance last_state
  try {
    const { data } = await supabase
      .from('lg_appliances')
      .select('id, last_state, last_synced_at')
      .eq('is_active', true);
    overlays.applianceStates = {};
    for (const d of (data || [])) {
      overlays.applianceStates[String(d.id)] = { last_state: d.last_state || {}, last_synced_at: d.last_synced_at };
    }
  } catch (e) { console.warn('Appliance state fetch failed:', e); }

  return overlays;
}

/* ── Rendering ── */

function renderDeviceRow(dev, overlays) {
  const domain = dev.domain;

  // Domain-specific detail column
  let detail = '';
  let status = '';

  if (domain === 'security') {
    const cam = overlays.cameraDetails[dev.device_key] || {};
    const loc = cam.spaces || dev.room || '';
    const quals = (cam.qualities || []).map(q => `<span class="dt-badge">${q}</span>`).join(' ');
    detail = `${esc(cam.model || '')}`;
    status = quals;
  } else if (domain === 'climate') {
    const s = (overlays.climateStates || {})[dev.id] || {};
    const temp = s.currentTempF != null ? `${Math.round(s.currentTempF)}°F` : '—';
    const humidity = s.humidity != null ? `${s.humidity}%` : '';
    const hvac = s.hvacStatus || '';
    const hvacIcon = hvac === 'HEATING' ? '🔥' : hvac === 'COOLING' ? '❄️' : '';
    detail = `${temp} ${humidity ? '· ' + humidity + ' humidity' : ''}`;
    status = hvacIcon ? `${hvacIcon} ${hvac}` : (s.mode || '');
  } else if (domain === 'vehicle') {
    const vs = overlays.vehicleStates[dev.id] || {};
    const s = vs.last_state || {};
    const battery = s.battery_level != null ? `${s.battery_level}%` : '';
    const locked = s.locked != null ? (s.locked ? '🔒' : '🔓') : '';
    let onsite = '';
    if (propertyGps && s.latitude != null && s.longitude != null) {
      const dist = distanceMeters(s.latitude, s.longitude, propertyGps.lat, propertyGps.lng);
      onsite = dist <= ONSITE_RADIUS_M
        ? '<span class="dt-badge dt-badge--green">ONSITE</span>'
        : '';
    }
    detail = [battery ? `🔋 ${battery}` : '', locked, onsite].filter(Boolean).join(' · ');
    status = vs.vehicle_state || '';
  } else if (domain === 'appliance') {
    const as = (overlays.applianceStates || {})[dev.id] || {};
    const s = as.last_state || {};
    const state = s.currentState || '';
    const remaining = (s.remainHour || s.remainMinute)
      ? `${s.remainHour ? s.remainHour + 'h ' : ''}${s.remainMinute || 0}m`
      : '';
    detail = state;
    status = remaining ? `⏱ ${remaining} left` : '';
  } else if (domain === 'lighting') {
    detail = dev.room || '';
    status = '';
  }

  return `<tr class="dv-device-row" data-domain="${domain}">
    <td class="dt-name">${esc(dev.name)}</td>
    <td class="dt-location">${esc(dev.room || '')}</td>
    <td class="dt-detail">${detail}</td>
    <td class="dt-status">${status}</td>
  </tr>`;
}

function renderSonosRow(zone) {
  const isPlaying = zone.playbackState === 'PLAYING';
  const isPaused = zone.playbackState === 'PAUSED_PLAYBACK';
  const rowClass = isPlaying ? 'dt-row-playing' : isPaused ? 'dt-row-paused' : 'dt-row-idle';
  const vol = zone.volume != null ? `${zone.volume}%` : '—';
  let nowPlaying = '';
  if (zone.trackTitle) {
    nowPlaying = esc(zone.trackTitle);
    if (zone.trackArtist) nowPlaying += ` <span class="dt-secondary">— ${esc(zone.trackArtist)}</span>`;
  }
  const stateLabel = isPlaying ? 'Playing' : isPaused ? 'Paused' : 'Idle';
  return `<tr class="${rowClass}" data-domain="music">
    <td class="dt-name">${esc(zone.room_name)}</td>
    <td class="dt-location">${stateLabel}</td>
    <td class="dt-detail">${nowPlaying || '—'}</td>
    <td class="dt-status">${zone.mute ? '🔇 ' : ''}${vol}</td>
  </tr>`;
}

function renderGroupHeader(domain, count, extra) {
  const icon = DOMAIN_ICONS[domain] || '📦';
  const label = DOMAIN_LABELS[domain] || domain;
  const link = DOMAIN_LINKS[domain];
  const collapsed = getCollapsed();
  const isCollapsed = collapsed.includes(domain);

  return `<tr class="dv-group-header${isCollapsed ? ' dv-group-collapsed' : ''}" data-group="${domain}">
    <td colspan="4">
      <span class="dv-group-toggle">${isCollapsed ? '▸' : '▾'}</span>
      <span class="dv-group-icon">${icon}</span>
      <span class="dv-group-label">${label}</span>
      <span class="dv-group-count">${count}${extra ? ' · ' + extra : ''}</span>
      ${link ? `<a href="${link.href}" class="dv-group-link" onclick="event.stopPropagation()">${link.label} →</a>` : ''}
    </td>
  </tr>`;
}

/* ── Collapse Persistence ── */

function getCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { return []; }
}

function toggleCollapse(domain) {
  let collapsed = getCollapsed();
  if (collapsed.includes(domain)) {
    collapsed = collapsed.filter(c => c !== domain);
  } else {
    collapsed.push(domain);
  }
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
  return collapsed;
}

/* ── Search ── */

function filterDevices(devices, sonosZones, query) {
  if (!query) return { devices, sonosZones };
  const q = query.toLowerCase();
  return {
    devices: devices.filter(d => {
      const hay = [d.name, d.room, d.domain, d.device_key].join(' ').toLowerCase();
      return hay.includes(q);
    }),
    sonosZones: sonosZones.filter(z => {
      const hay = [z.room_name, z.trackTitle, z.trackArtist, z.playbackState].join(' ').toLowerCase();
      return hay.includes(q);
    }),
  };
}

/* ── Main Render ── */

function renderInventory(allDevices, overlays, searchQuery = '') {
  const container = document.getElementById('devicesGrid');
  if (!container) return;

  const { devices, sonosZones } = filterDevices(allDevices, overlays.sonos || [], searchQuery);

  // Group devices by domain
  const groups = {};
  for (const d of devices) {
    if (!groups[d.domain]) groups[d.domain] = [];
    groups[d.domain].push(d);
  }

  const collapsed = getCollapsed();

  // Build table
  let rows = '';
  for (const domain of DOMAIN_ORDER) {
    const items = groups[domain] || [];
    if (!items.length && domain !== 'security') continue;

    // Insert Sonos as a "music" group after lighting
    if (domain === 'climate' && sonosZones.length > 0) {
      const playingCount = sonosZones.filter(z => z.playbackState === 'PLAYING').length;
      const extra = playingCount > 0 ? `${playingCount} playing` : '';
      rows += renderGroupHeader('music', sonosZones.length + ' zones', extra);
      if (!collapsed.includes('music')) {
        rows += sonosZones.map(z => renderSonosRow(z)).join('');
      }
    }

    let extra = '';
    if (domain === 'security') extra = '';
    if (domain === 'vehicle') {
      const onsite = items.filter(v => {
        const vs = overlays.vehicleStates[v.id] || {};
        const s = vs.last_state || {};
        if (!propertyGps || s.latitude == null) return false;
        return distanceMeters(s.latitude, s.longitude, propertyGps.lat, propertyGps.lng) <= ONSITE_RADIUS_M;
      }).length;
      if (onsite > 0) extra = `${onsite} onsite`;
    }

    rows += renderGroupHeader(domain, items.length, extra);
    if (!collapsed.includes(domain)) {
      rows += items.map(d => renderDeviceRow(d, overlays)).join('');
    }
  }

  // Also add Sonos if we didn't insert it above (e.g., when there's no climate domain)
  if (!DOMAIN_ORDER.includes('music') && sonosZones.length > 0 && !rows.includes('data-group="music"')) {
    const playingCount = sonosZones.filter(z => z.playbackState === 'PLAYING').length;
    rows += renderGroupHeader('music', sonosZones.length + ' zones', playingCount > 0 ? `${playingCount} playing` : '');
    if (!collapsed.includes('music')) {
      rows += sonosZones.map(z => renderSonosRow(z)).join('');
    }
  }

  // Total count
  const totalCount = devices.length + sonosZones.length;
  const metaEl = document.getElementById('devicesMeta');
  if (metaEl) metaEl.textContent = `${totalCount} devices`;

  container.innerHTML = `
    <div class="dv-search-bar">
      <input type="text" class="dv-search-input" id="deviceSearch" placeholder="Search devices..." value="${esc(searchQuery).replace(/"/g, '&quot;')}">
    </div>
    <div class="dv-summary">
      ${DOMAIN_ORDER.filter(d => (groups[d] || []).length > 0).map(d =>
        `<span class="dv-summary-item">${DOMAIN_ICONS[d]} ${(groups[d] || []).length} ${DOMAIN_LABELS[d]}</span>`
      ).join('')}
      ${sonosZones.length > 0 ? `<span class="dv-summary-item">🔊 ${sonosZones.length} Music</span>` : ''}
    </div>
    <div class="device-table-wrap">
      <table class="device-table dv-hybrid-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Location</th>
            <th>Detail</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="dv-footer">
      <a href="/directory/devices.html">View all devices in directory →</a>
    </div>
  `;

  // Search handler
  const searchInput = document.getElementById('deviceSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderInventory(allDevices, overlays, searchInput.value.trim());
      // Re-focus and restore cursor position
      const newInput = document.getElementById('deviceSearch');
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(newInput.value.length, newInput.value.length);
      }
    });
  }

  // Group header click → toggle collapse
  container.querySelectorAll('.dv-group-header').forEach(row => {
    row.addEventListener('click', () => {
      const domain = row.dataset.group;
      toggleCollapse(domain);
      renderInventory(allDevices, overlays, searchQuery);
    });
  });
}

// Add music to the domain labels/icons for Sonos (not in unified view)
DOMAIN_LABELS['music'] = 'Music';
DOMAIN_ICONS['music'] = '🔊';
DOMAIN_LINKS['music'] = { href: 'sonos.html', label: 'Sonos Controls' };

/* ── Init ── */

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: async () => {
      const container = document.getElementById('devicesGrid');
      if (!container) return;
      container.innerHTML = '<p class="text-muted" style="padding:1rem">Loading devices...</p>';

      try {
        const [devices, overlays] = await Promise.all([
          loadDevices(),
          loadLiveOverlays(),
          fetchPropertyGps(),
        ]);
        renderInventory(devices, overlays);
      } catch (e) {
        console.error('Device inventory fetch error:', e);
        container.innerHTML = '<p class="text-muted" style="padding:1rem">Error loading devices. Check console.</p>';
      }
    },
  });
});
