/**
 * Cars Page - Tesla Fleet overview with live data from tesla_vehicles table.
 * Poller on DO droplet writes vehicle state; this page reads it every 30s.
 */

import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// CONFIGURATION
// =============================================
const POLL_INTERVAL_MS = 30000; // 30s (reads from Supabase, not Tesla API)

// =============================================
// STATE
// =============================================
let vehicles = [];
let accounts = [];
let pollTimer = null;
let currentUserRole = null;

// =============================================
// SVG ICONS (inline for data rows)
// =============================================
const ICONS = {
  battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="10" x2="23" y2="14"/></svg>',
  odometer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  climate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  tires: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

// Tesla car SVG silhouettes (fallback when images fail to load)
const CAR_SVG = {
  model3: `<svg viewBox="0 0 400 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 110 C50 110 55 65 90 55 L160 45 C170 43 200 38 240 38 L310 42 C340 48 360 65 365 80 L370 95 C372 100 370 110 365 110" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M90 55 C95 50 160 45 160 45" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M160 45 L240 38" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M240 38 C260 40 280 42 310 42" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="160" y1="45" x2="155" y2="80" stroke="currentColor" stroke-width="2"/>
    <line x1="240" y1="38" x2="245" y2="80" stroke="currentColor" stroke-width="2"/>
    <circle cx="105" cy="112" r="22" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="105" cy="112" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="315" cy="112" r="22" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="315" cy="112" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="50" y1="112" x2="83" y2="112" stroke="currentColor" stroke-width="2"/>
    <line x1="127" y1="112" x2="293" y2="112" stroke="currentColor" stroke-width="2"/>
    <line x1="337" y1="112" x2="365" y2="112" stroke="currentColor" stroke-width="2"/>
  </svg>`,
  modelY: `<svg viewBox="0 0 400 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M45 115 C45 112 48 70 85 52 L150 40 C165 37 200 33 245 33 L315 38 C345 45 362 65 368 82 L373 98 C375 105 372 115 368 115" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M85 52 C90 47 150 40 150 40" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M150 40 L245 33" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M245 33 C270 35 290 37 315 38" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="150" y1="40" x2="148" y2="82" stroke="currentColor" stroke-width="2"/>
    <line x1="245" y1="33" x2="248" y2="82" stroke="currentColor" stroke-width="2"/>
    <path d="M85 52 C82 58 78 75 76 85" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="105" cy="117" r="23" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="105" cy="117" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="318" cy="117" r="23" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="318" cy="117" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="45" y1="117" x2="82" y2="117" stroke="currentColor" stroke-width="2"/>
    <line x1="128" y1="117" x2="295" y2="117" stroke="currentColor" stroke-width="2"/>
    <line x1="341" y1="117" x2="368" y2="117" stroke="currentColor" stroke-width="2"/>
  </svg>`,
};

// =============================================
// DATA LOADING
// =============================================

async function loadVehicles() {
  const { data, error } = await supabase
    .from('tesla_vehicles')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.warn('Failed to load vehicles:', error.message);
    return;
  }
  vehicles = data || [];
}

async function loadAccounts() {
  const { data, error } = await supabase
    .from('tesla_accounts')
    .select('id, owner_name, tesla_email, is_active, last_error, refresh_token, updated_at')
    .order('id', { ascending: true });

  if (error) {
    console.warn('Failed to load accounts:', error.message);
    return;
  }
  accounts = data || [];
}

// =============================================
// HELPERS
// =============================================

function formatSyncTime(lastSyncedAt) {
  if (!lastSyncedAt) return 'Never synced';
  const diff = Date.now() - new Date(lastSyncedAt).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(lastSyncedAt).toLocaleDateString();
}

function formatNumber(n) {
  if (n == null) return '--';
  return n.toLocaleString();
}

function getStatusDisplay(car) {
  const s = car.last_state;
  if (car.vehicle_state === 'asleep') return { text: 'Asleep', color: 'var(--text-muted)' };
  if (car.vehicle_state === 'offline') return { text: 'Offline', color: 'var(--occupied, #e74c3c)' };
  if (!s) return { text: '--', color: 'var(--text-muted)' };
  if (s.charging_state === 'Charging') return { text: 'Charging', color: 'var(--available, #27ae60)' };
  if (s.charging_state === 'Complete') return { text: 'Charge Complete', color: 'var(--available, #27ae60)' };
  return { text: 'Online', color: 'var(--available, #27ae60)' };
}

function getDataRows(car) {
  const s = car.last_state;
  if (!s) {
    // No data yet — show placeholders
    return [
      { label: 'Battery', icon: 'battery', value: '--' },
      { label: 'Odometer', icon: 'odometer', value: '--' },
      { label: 'Status', icon: 'status', value: car.vehicle_state === 'unknown' ? 'Not connected' : car.vehicle_state },
      { label: 'Climate', icon: 'climate', value: '--' },
      { label: 'Location', icon: 'location', value: '--' },
      { label: 'Tires', icon: 'tires', value: '--' },
      { label: 'Locked', icon: 'lock', value: '--' },
    ];
  }

  const status = getStatusDisplay(car);
  const batteryStr = s.battery_level != null
    ? `${s.battery_level}%${s.battery_range_mi != null ? ` \u00b7 ${Math.round(s.battery_range_mi)} mi` : ''}`
    : '--';
  const climateStr = s.climate_on
    ? `${s.inside_temp_f || '--'}\u00b0F`
    : s.inside_temp_f != null ? `${s.inside_temp_f}\u00b0F (off)` : '--';
  const locationStr = s.latitude != null && s.longitude != null
    ? `${s.latitude.toFixed(2)}, ${s.longitude.toFixed(2)}`
    : '--';
  const tiresStr = s.tpms_fl_psi != null
    ? `${s.tpms_fl_psi} / ${s.tpms_fr_psi} / ${s.tpms_rl_psi} / ${s.tpms_rr_psi}`
    : '--';
  const lockStr = s.locked === true ? 'Locked' : s.locked === false ? 'Unlocked' : '--';

  return [
    { label: 'Battery', icon: 'battery', value: batteryStr },
    { label: 'Odometer', icon: 'odometer', value: s.odometer_mi != null ? `${formatNumber(Math.round(s.odometer_mi))} mi` : '--' },
    { label: 'Status', icon: 'status', value: `<span style="color:${status.color}">${status.text}</span>` },
    { label: 'Climate', icon: 'climate', value: climateStr },
    { label: 'Location', icon: 'location', value: locationStr },
    { label: 'Tires', icon: 'tires', value: tiresStr },
    { label: 'Locked', icon: 'lock', value: lockStr },
  ];
}

// =============================================
// RENDERING
// =============================================

function renderFleet() {
  const grid = document.getElementById('carGrid');
  if (!grid) return;

  if (!vehicles.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No vehicles configured.</p>';
    return;
  }

  grid.innerHTML = vehicles.map(car => {
    const svgKey = car.svg_key || 'modelY';
    const carSvg = CAR_SVG[svgKey] || CAR_SVG.modelY;
    const svgColor = car.color === 'Grey' ? '#777' : '#999';
    const dataRows = getDataRows(car);

    const dataRowsHtml = dataRows.map(row => `
      <div class="car-data-row">
        <span class="car-data-row__icon">${ICONS[row.icon]}</span>
        <span class="car-data-row__label">${row.label}</span>
        <span class="car-data-row__value">${row.value}</span>
      </div>
    `).join('');

    // AI-generated image with SVG fallback
    const imageContent = car.image_url
      ? `<img src="${car.image_url}" alt="${car.name} - ${car.year} ${car.model}"
             class="car-card__img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
         /><div class="car-card__svg-fallback" style="display:none;color:${svgColor}">${carSvg}</div>`
      : `<div class="car-card__svg-fallback" style="color:${svgColor}">${carSvg}</div>`;

    const syncTime = formatSyncTime(car.last_synced_at);

    return `
      <div class="car-card">
        <div class="car-card__image">
          ${imageContent}
        </div>
        <div class="car-card__info">
          <div class="car-card__header">
            <div class="car-card__name">${car.name}</div>
            <span class="car-card__color-chip">
              <span class="car-card__color-dot" style="background:${car.color_hex || '#ccc'}"></span>
              ${car.color || ''}
            </span>
          </div>
          <div class="car-card__model">${car.year} ${car.model}</div>
          <div class="car-data-grid">
            ${dataRowsHtml}
          </div>
          <div class="car-card__sync-time">${syncTime}</div>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================
// ADMIN: SETTINGS
// =============================================

function renderSettings() {
  const section = document.getElementById('teslaSettingsSection');
  const list = document.getElementById('teslaAccountsList');
  if (!section || !list) return;

  if (currentUserRole !== 'admin') {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  list.innerHTML = accounts.map(acc => {
    const hasToken = !!acc.refresh_token;
    const statusDot = hasToken
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--available, #27ae60);margin-right:0.4rem;"></span>'
      : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--occupied, #e74c3c);margin-right:0.4rem;"></span>';
    const statusText = hasToken ? 'Connected' : 'Not connected';
    const errorHtml = acc.last_error
      ? `<div style="font-size:0.7rem;color:var(--occupied, #e74c3c);margin-top:0.25rem;">Error: ${acc.last_error}</div>`
      : '';

    return `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--border-light, #f0f0f0);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.85rem;">${statusDot}${acc.owner_name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">${statusText}${acc.tesla_email ? ` \u00b7 ${acc.tesla_email}` : ''}</div>
          ${errorHtml}
        </div>
        <input type="text" id="token_${acc.id}" placeholder="Paste refresh token..."
               style="width:200px;font-size:0.75rem;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:4px;"
               value="" />
        <button class="btn-small" onclick="window._saveToken(${acc.id})">Save</button>
      </div>
    `;
  }).join('');
}

// Save token handler (attached to window for onclick access)
window._saveToken = async function(accountId) {
  const input = document.getElementById(`token_${accountId}`);
  if (!input) return;
  const token = input.value.trim();
  if (!token) {
    showToast('Please paste a refresh token', 'error');
    return;
  }

  const { error } = await supabase
    .from('tesla_accounts')
    .update({
      refresh_token: token,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) {
    showToast(`Failed to save: ${error.message}`, 'error');
    return;
  }

  input.value = '';
  showToast('Token saved! Data will appear within 5 minutes.', 'success');
  await loadAccounts();
  renderSettings();
};

// =============================================
// POLLING (visibility-based)
// =============================================

function startPolling() {
  stopPolling();
  refreshFromDB();
  pollTimer = setInterval(refreshFromDB, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
  }
}

async function refreshFromDB() {
  await loadVehicles();
  renderFleet();
}

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'cars',
    requiredRole: 'resident',
    onReady: async (authState) => {
      currentUserRole = authState.appUser?.role;

      // Load vehicles and render
      await loadVehicles();
      renderFleet();

      // Start polling
      startPolling();

      // Admin: load settings
      if (currentUserRole === 'admin') {
        await loadAccounts();
        renderSettings();
      }
    },
  });
});
