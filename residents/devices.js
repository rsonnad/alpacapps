/**
 * Devices Page — Unified device inventory.
 * Fetches all device data from Supabase and renders expandable sections
 * with tabular rows per device category.
 */

import { initResidentPage } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

const COLLAPSE_KEY = 'devices-collapsed';

const CATEGORIES = [
  { id: 'cameras',  label: 'Cameras',      href: 'cameras.html',  linkLabel: 'Camera Feeds' },
  { id: 'lighting', label: 'Lighting',      href: 'lighting.html', linkLabel: 'Lighting Controls' },
  { id: 'music',    label: 'Music',          href: 'sonos.html',    linkLabel: 'Sonos Controls' },
  { id: 'climate',  label: 'Climate',        href: 'climate.html',  linkLabel: 'Climate Controls' },
  { id: 'cars',     label: 'Vehicles',       href: 'cars.html',     linkLabel: 'Vehicle Controls' },
  { id: 'laundry',  label: 'Laundry',        href: 'laundry.html',  linkLabel: 'Laundry Status' },
];

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
  if (!s) return '—';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function statusDot(online) {
  const cls = online ? 'status-live' : 'status-offline';
  return `<span class="status-dot ${cls}"></span>`;
}

/* ── Data Fetchers (all DB, no live API) ── */

async function fetchCameras() {
  try {
    const { data, error } = await supabase
      .from('camera_streams')
      .select('camera_name, location, quality, is_active')
      .eq('is_active', true)
      .order('camera_name');
    if (error) { console.warn('Cameras fetch error:', error); return []; }
    if (!data) return [];
    const map = new Map();
    for (const s of data) {
      if (!map.has(s.camera_name)) {
        map.set(s.camera_name, { name: s.camera_name, location: s.location, qualities: [] });
      }
      map.get(s.camera_name).qualities.push(s.quality);
    }
    return [...map.values()];
  } catch (e) { console.warn('Cameras fetch failed:', e); return []; }
}

async function fetchLighting() {
  try {
    const [groupsRes, childrenRes, modelsRes] = await Promise.all([
      supabase.from('govee_devices')
        .select('device_id, name, area, display_order')
        .eq('is_group', true).eq('is_active', true)
        .order('display_order'),
      supabase.from('govee_devices')
        .select('device_id, name, sku, parent_group_id, area')
        .eq('is_group', false).eq('is_active', true)
        .order('name'),
      supabase.from('govee_models')
        .select('sku, model_name'),
    ]);
    const groups = groupsRes.data || [];
    const children = childrenRes.data || [];
    const models = new Map((modelsRes.data || []).map(m => [m.sku, m.model_name]));

    const rows = groups.map(g => {
      const kids = children.filter(c => c.parent_group_id === g.device_id);
      const modelSet = new Set(kids.map(c => models.get(c.sku) || c.sku).filter(Boolean));
      return { name: g.name, area: g.area, deviceCount: kids.length, models: [...modelSet].join(', ') || '—' };
    });

    const ungrouped = children.filter(c => !c.parent_group_id);
    const byArea = new Map();
    for (const u of ungrouped) {
      if (!byArea.has(u.area)) byArea.set(u.area, []);
      byArea.get(u.area).push(u);
    }
    for (const [area, devs] of byArea) {
      const modelSet = new Set(devs.map(d => models.get(d.sku) || d.sku));
      rows.push({ name: `${area} (ungrouped)`, area, deviceCount: devs.length, models: [...modelSet].join(', ') || '—' });
    }
    return rows;
  } catch (e) { console.warn('Lighting fetch failed:', e); return []; }
}

async function fetchSonos() {
  try {
    const { data, error } = await supabase
      .from('sonos_zones')
      .select('*')
      .eq('is_active', true)
      .order('display_order');
    if (error) { console.warn('Sonos fetch error:', error); return []; }
    return data || [];
  } catch (e) { console.warn('Sonos fetch failed:', e); return []; }
}

async function fetchClimate() {
  try {
    const { data, error } = await supabase
      .from('nest_devices')
      .select('room_name, device_type, display_order, last_state, is_active')
      .eq('is_active', true)
      .eq('device_type', 'thermostat')
      .order('display_order');
    if (error) { console.warn('Climate fetch error:', error); return []; }
    return data || [];
  } catch (e) { console.warn('Climate fetch failed:', e); return []; }
}

async function fetchVehicles() {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('name, vehicle_make, vehicle_model, year, color, vehicle_state, last_state, last_synced_at, is_active')
      .eq('is_active', true)
      .order('display_order');
    if (error) { console.warn('Vehicles fetch error:', error); return []; }
    return data || [];
  } catch (e) { console.warn('Vehicles fetch failed:', e); return []; }
}

async function fetchLaundry() {
  try {
    const { data, error } = await supabase
      .from('lg_appliances')
      .select('name, device_type, model, last_state, last_synced_at, is_active')
      .eq('is_active', true)
      .order('display_order');
    if (error) { console.warn('Laundry fetch error:', error); return []; }
    return data || [];
  } catch (e) { console.warn('Laundry fetch failed:', e); return []; }
}

/* ── Row Renderers ── */

function renderCameraRows(cameras) {
  if (!cameras.length) return emptyRow(3);
  return cameras.map(c => `
    <tr>
      <td class="dt-name">${esc(c.name)}</td>
      <td>${esc(c.location)}</td>
      <td>${c.qualities.map(q => `<span class="dt-badge">${q}</span>`).join(' ')}</td>
    </tr>
  `).join('');
}

function renderLightingRows(groups) {
  if (!groups.length) return emptyRow(4);
  return groups.map(g => `
    <tr>
      <td class="dt-name">${esc(g.name)}</td>
      <td>${esc(g.area)}</td>
      <td class="dt-num">${g.deviceCount}</td>
      <td class="dt-secondary">${esc(g.models)}</td>
    </tr>
  `).join('');
}

function renderSonosRows(zones) {
  if (!zones.length) return emptyRow(3, 'No zones synced yet');
  return zones.map(z => {
    const st = z.last_state || {};
    const playback = st.playbackState || '—';
    const vol = st.volume != null ? `${st.volume}%` : '—';
    return `
      <tr>
        <td class="dt-name">${esc(z.room_name)}</td>
        <td>${playback === 'PLAYING' ? statusDot(true) : statusDot(false)} ${esc(playback)}</td>
        <td class="dt-num">${vol}</td>
      </tr>
    `;
  }).join('');
}

function renderClimateRows(devices) {
  if (!devices.length) return emptyRow(5);
  return devices.map(d => {
    const s = d.last_state || {};
    const temp = s.currentTempF != null ? `${Math.round(s.currentTempF)}°F` : '—';
    const humidity = s.humidity != null ? `${s.humidity}%` : '—';
    const mode = s.mode || '—';
    const hvac = s.hvacStatus || 'OFF';
    const online = s.connectivity === 'ONLINE';
    return `
      <tr>
        <td class="dt-name">${statusDot(online)} ${esc(d.room_name)}</td>
        <td class="dt-num">${temp}</td>
        <td class="dt-num">${humidity}</td>
        <td>${esc(mode)}</td>
        <td>${hvac === 'HEATING' ? '🔥' : hvac === 'COOLING' ? '❄️' : '—'} ${esc(hvac)}</td>
      </tr>
    `;
  }).join('');
}

function renderVehicleRows(vehicles) {
  if (!vehicles.length) return emptyRow(6);
  return vehicles.map(v => {
    const s = v.last_state || {};
    const battery = s.battery_level != null ? `${s.battery_level}%` : '—';
    const status = v.vehicle_state || '—';
    const locked = s.locked != null ? (s.locked ? '🔒' : '🔓') : '—';
    return `
      <tr>
        <td class="dt-name">${esc(v.name)}</td>
        <td class="dt-secondary">${esc(v.vehicle_make)} ${esc(v.vehicle_model)} ${v.year || ''}</td>
        <td class="dt-num">${battery}</td>
        <td>${esc(status)}</td>
        <td>${locked}</td>
        <td class="dt-secondary">${timeAgo(v.last_synced_at)}</td>
      </tr>
    `;
  }).join('');
}

function renderLaundryRows(appliances) {
  if (!appliances.length) return emptyRow(4, 'No appliances configured');
  return appliances.map(a => {
    const s = a.last_state || {};
    const state = s.currentState || 'UNKNOWN';
    const remaining = (s.remainHour || s.remainMinute)
      ? `${s.remainHour ? s.remainHour + 'h ' : ''}${s.remainMinute || 0}m`
      : '—';
    return `
      <tr>
        <td class="dt-name">${esc(a.name)}</td>
        <td>${esc(a.device_type)}</td>
        <td>${esc(state)}</td>
        <td class="dt-num">${remaining}</td>
      </tr>
    `;
  }).join('');
}

function emptyRow(cols, msg = 'No devices') {
  return `<tr><td colspan="${cols}" class="dt-empty">${msg}</td></tr>`;
}

/* ── Section Builder ── */

function buildSection(cat, count, theadHtml, tbodyHtml) {
  const collapsed = getCollapsed();
  const isOpen = !collapsed.includes(cat.id);
  return `
    <details class="device-section" ${isOpen ? 'open' : ''} data-section="${cat.id}">
      <summary class="device-section__header">
        <span class="device-section__chevron"></span>
        <span class="device-section__label">${cat.label}</span>
        <a href="${cat.href}" class="device-section__link" onclick="event.stopPropagation()">${cat.linkLabel} →</a>
        <span class="device-section__count">${count}</span>
      </summary>
      <div class="device-section__body">
        <div class="device-table-wrap">
          <table class="device-table">
            <thead><tr>${theadHtml}</tr></thead>
            <tbody>${tbodyHtml}</tbody>
          </table>
        </div>
      </div>
    </details>
  `;
}

function th(label) { return `<th>${label}</th>`; }

/* ── Collapse Persistence ── */

function getCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { return []; }
}

function saveCollapsed(list) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
}

function initCollapseListeners(container) {
  container.querySelectorAll('.device-section').forEach(det => {
    det.addEventListener('toggle', () => {
      const id = det.dataset.section;
      let collapsed = getCollapsed();
      if (det.open) {
        collapsed = collapsed.filter(c => c !== id);
      } else {
        if (!collapsed.includes(id)) collapsed.push(id);
      }
      saveCollapsed(collapsed);
    });
  });
}

/* ── Main ── */

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: (state) => {
      renderInventory(state);
    },
  });
});

async function renderInventory() {
  const container = document.getElementById('devicesGrid');
  if (!container) return;
  container.innerHTML = '<p class="text-muted" style="padding:1rem">Loading devices...</p>';

  let cameras, lighting, sonos, climate, vehicles, laundry;
  try {
    [cameras, lighting, sonos, climate, vehicles, laundry] = await Promise.all([
      fetchCameras(),
      fetchLighting(),
      fetchSonos(),
      fetchClimate(),
      fetchVehicles(),
      fetchLaundry(),
    ]);
  } catch (e) {
    console.error('Device inventory fetch error:', e);
    container.innerHTML = '<p class="text-muted" style="padding:1rem">Error loading devices. Check console.</p>';
    return;
  }

  const totalDevices = cameras.length
    + lighting.reduce((s, g) => s + g.deviceCount, 0)
    + sonos.length
    + climate.length
    + vehicles.length
    + laundry.length;

  let html = `<p class="device-summary">${totalDevices} devices across ${CATEGORIES.length} categories</p>`;

  // Cameras
  const camCat = CATEGORIES.find(c => c.id === 'cameras');
  html += buildSection(camCat, cameras.length,
    th('Camera') + th('Location') + th('Qualities'),
    renderCameraRows(cameras));

  // Lighting (groups)
  const lightCat = CATEGORIES.find(c => c.id === 'lighting');
  const totalLights = lighting.reduce((s, g) => s + g.deviceCount, 0);
  html += buildSection(lightCat, `${lighting.length} groups · ${totalLights} devices`,
    th('Group') + th('Area') + th('Devices') + th('Models'),
    renderLightingRows(lighting));

  // Music (Sonos)
  const musicCat = CATEGORIES.find(c => c.id === 'music');
  html += buildSection(musicCat, sonos.length,
    th('Zone') + th('State') + th('Volume'),
    renderSonosRows(sonos));

  // Climate
  const climateCat = CATEGORIES.find(c => c.id === 'climate');
  html += buildSection(climateCat, climate.length,
    th('Room') + th('Temp') + th('Humidity') + th('Mode') + th('HVAC'),
    renderClimateRows(climate));

  // Vehicles
  const carCat = CATEGORIES.find(c => c.id === 'cars');
  html += buildSection(carCat, vehicles.length,
    th('Name') + th('Vehicle') + th('Battery') + th('Status') + th('Lock') + th('Synced'),
    renderVehicleRows(vehicles));

  // Laundry
  const laundryCat = CATEGORIES.find(c => c.id === 'laundry');
  html += buildSection(laundryCat, laundry.length,
    th('Name') + th('Type') + th('State') + th('Remaining'),
    renderLaundryRows(laundry));

  container.innerHTML = html;
  initCollapseListeners(container);
}
