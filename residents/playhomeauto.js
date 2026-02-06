/**
 * Home Automation - Lighting Page
 * Controls Govee lighting groups via Edge Function proxy
 */

import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// CONFIGURATION
// =============================================
const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const GOVEE_CONTROL_URL = `${SUPABASE_URL}/functions/v1/govee-control`;
const POLL_INTERVAL_MS = 30000; // 30 seconds

// Govee lighting groups (SameModeGroup type)
const GOVEE_GROUPS = [
  { name: 'Common',              groupId: '12097114', deviceCount: null, models: '' },
  { name: 'East Bedroom',        groupId: '12097639', deviceCount: null, models: '' },
  { name: 'Garage Mahal',        groupId: '13452517', deviceCount: 16,   models: 'Recessed Lights Pro' },
  { name: 'Outhouse',            groupId: '13166268', deviceCount: 6,    models: 'Recessed Lights Pro' },
  { name: 'Spartan Tea Lounge',  groupId: '12411623', deviceCount: 2,    models: 'Outdoor Strip, Wall Light' },
  { name: 'Fishbowl',            groupId: '12411702', deviceCount: 2,    models: 'Recessed Downlights' },
  { name: 'Spartan Main',        groupId: '12411712', deviceCount: 6,    models: 'Recessed Downlights' },
  { name: 'Cedar Chamber',       groupId: '12001251', deviceCount: 4,    models: 'Recessed Lights Pro' },
  { name: 'West Bedroom',        groupId: '12097082', deviceCount: null, models: '' },
];

// Color presets for quick selection
const COLOR_PRESETS = [
  { name: 'Warm White', hex: '#FFD4A3', temp: 3000 },
  { name: 'Cool White', hex: '#E8F0FF', temp: 5500 },
  { name: 'Red', hex: '#FF0000' },
  { name: 'Orange', hex: '#FF6600' },
  { name: 'Purple', hex: '#8800FF' },
  { name: 'Blue', hex: '#0044FF' },
  { name: 'Green', hex: '#00CC00' },
  { name: 'Pink', hex: '#FF69B4' },
];

// =============================================
// STATE
// =============================================
let groupStates = {}; // { groupId: { on, brightness, color } }
let pollTimer = null;
let lastPollTime = null;

// Debounce timers
const brightnessTimers = {};
const colorTimers = {};

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'homeauto',
    requiredRole: 'resident',
    onReady: async () => {
      renderLightingGroups();
      setupEventListeners();
      await refreshAllStates();
      startPolling();
    },
  });
});

// =============================================
// API CALLS (via Edge Function)
// =============================================
async function goveeApi(action, params = {}) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) {
    showToast('Session expired. Please refresh.', 'error');
    throw new Error('No auth token');
  }

  const response = await fetch(GOVEE_CONTROL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc1OTg1NjUsImV4cCI6MjA1MzE3NDU2NX0.RQRRAqp6qEhLDSANOSEaHVLSMDxBIJXzfPfQ3chrcHs',
    },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `API error ${response.status}`);
  }

  return response.json();
}

// =============================================
// CONTROL FUNCTIONS
// =============================================
async function toggleGroup(groupId, on) {
  const card = document.querySelector(`[data-group-id="${groupId}"]`);
  card?.classList.add('loading');

  try {
    await goveeApi('controlDevice', {
      device: groupId,
      sku: 'SameModeGroup',
      capability: {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        value: on ? 1 : 0,
      },
    });

    groupStates[groupId] = { ...groupStates[groupId], on };
    updateGroupUI(groupId);
    showToast(`${getGroupName(groupId)} turned ${on ? 'on' : 'off'}`, 'success', 2000);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
    // Revert toggle
    const toggle = card?.querySelector('input[type="checkbox"]');
    if (toggle) toggle.checked = !on;
  } finally {
    card?.classList.remove('loading');
  }
}

async function setBrightness(groupId, value) {
  const card = document.querySelector(`[data-group-id="${groupId}"]`);

  try {
    await goveeApi('controlDevice', {
      device: groupId,
      sku: 'SameModeGroup',
      capability: {
        type: 'devices.capabilities.range',
        instance: 'brightness',
        value: parseInt(value),
      },
    });

    groupStates[groupId] = { ...groupStates[groupId], brightness: parseInt(value) };
    updateGroupStatus(groupId);
  } catch (err) {
    showToast(`Brightness failed: ${err.message}`, 'error');
  }
}

async function setColor(groupId, hexColor) {
  const card = document.querySelector(`[data-group-id="${groupId}"]`);

  try {
    const rgb = hexToRgbInt(hexColor);
    await goveeApi('controlDevice', {
      device: groupId,
      sku: 'SameModeGroup',
      capability: {
        type: 'devices.capabilities.color_setting',
        instance: 'colorRgb',
        value: rgb,
      },
    });

    groupStates[groupId] = { ...groupStates[groupId], color: hexColor };
    updateGroupStatus(groupId);
  } catch (err) {
    showToast(`Color failed: ${err.message}`, 'error');
  }
}

async function setColorTemp(groupId, temp) {
  try {
    await goveeApi('controlDevice', {
      device: groupId,
      sku: 'SameModeGroup',
      capability: {
        type: 'devices.capabilities.color_setting',
        instance: 'colorTemperatureK',
        value: parseInt(temp),
      },
    });

    showToast(`Set to ${temp}K`, 'success', 1500);
  } catch (err) {
    showToast(`Color temp failed: ${err.message}`, 'error');
  }
}

async function allOff() {
  const btn = document.getElementById('allOffBtn');
  btn.disabled = true;
  btn.textContent = 'Turning off...';

  let successes = 0;
  let failures = 0;

  for (const group of GOVEE_GROUPS) {
    try {
      await goveeApi('controlDevice', {
        device: group.groupId,
        sku: 'SameModeGroup',
        capability: {
          type: 'devices.capabilities.on_off',
          instance: 'powerSwitch',
          value: 0,
        },
      });
      groupStates[group.groupId] = { ...groupStates[group.groupId], on: false };
      updateGroupUI(group.groupId);
      successes++;
    } catch (err) {
      failures++;
    }
    // Small delay to avoid rate limiting
    await sleep(200);
  }

  btn.disabled = false;
  btn.textContent = 'All Off';

  if (failures === 0) {
    showToast(`All ${successes} groups turned off`, 'success');
  } else {
    showToast(`${successes} off, ${failures} failed`, 'warning');
  }
}

// =============================================
// STATE POLLING
// =============================================
async function refreshAllStates() {
  const results = await Promise.allSettled(
    GOVEE_GROUPS.map(g => refreshGroupState(g.groupId))
  );

  lastPollTime = new Date();
  updatePollStatus();

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0 && failed < GOVEE_GROUPS.length) {
    // Some failed — don't spam toasts, just note it
    console.warn(`${failed} group state queries failed`);
  }
}

async function refreshGroupState(groupId) {
  try {
    const result = await goveeApi('getDeviceState', {
      device: groupId,
      sku: 'SameModeGroup',
    });

    // Parse Govee state response
    if (result.payload) {
      const capabilities = result.payload.capabilities || [];
      const state = {};

      for (const cap of capabilities) {
        if (cap.instance === 'powerSwitch') {
          state.on = cap.state?.value === 1;
        } else if (cap.instance === 'brightness') {
          state.brightness = cap.state?.value;
        } else if (cap.instance === 'colorRgb') {
          state.color = rgbIntToHex(cap.state?.value);
        } else if (cap.instance === 'colorTemperatureK') {
          state.colorTemp = cap.state?.value;
        }
      }

      groupStates[groupId] = { ...groupStates[groupId], ...state };
      updateGroupUI(groupId);
    }
  } catch (err) {
    console.warn(`Failed to get state for group ${groupId}:`, err.message);
    throw err;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refreshAllStates(), POLL_INTERVAL_MS);

  // Pause when tab is hidden
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
    refreshAllStates();
    startPolling();
  }
}

function updatePollStatus() {
  const el = document.getElementById('pollStatus');
  if (!el || !lastPollTime) return;

  const timeStr = lastPollTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  el.textContent = `Last updated: ${timeStr} (auto-refreshes every 30s)`;
}

// =============================================
// RENDERING
// =============================================
function renderLightingGroups() {
  const container = document.getElementById('lightingGroups');
  if (!container) return;

  container.innerHTML = GOVEE_GROUPS.map(group => `
    <div class="lighting-group-card" data-group-id="${group.groupId}">
      <div class="lighting-group-card__header">
        <div class="lighting-group-card__title">
          <span class="lighting-group-card__name">${group.name}</span>
          ${group.deviceCount ? `<span class="lighting-group-card__devices">${group.deviceCount} ${group.deviceCount === 1 ? 'device' : 'devices'} · ${group.models}</span>` : ''}
        </div>
        <label class="toggle-switch">
          <input type="checkbox" data-action="toggle" data-group="${group.groupId}">
          <span class="slider"></span>
        </label>
      </div>

      <div class="brightness-control">
        <div class="brightness-control__label">
          <span>Brightness</span>
          <span class="brightness-value" data-brightness-label="${group.groupId}">—</span>
        </div>
        <input type="range" min="1" max="100" value="50"
          data-action="brightness" data-group="${group.groupId}">
      </div>

      <div class="color-control">
        <span class="color-control__label">Color</span>
        <input type="color" value="#FFD4A3"
          data-action="color" data-group="${group.groupId}">
        <div class="color-presets">
          ${COLOR_PRESETS.map(p => `
            <button class="color-preset" title="${p.name}"
              style="background:${p.hex}"
              data-action="preset" data-group="${group.groupId}"
              data-hex="${p.hex}" ${p.temp ? `data-temp="${p.temp}"` : ''}>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="group-status" data-status="${group.groupId}">
        <span>Loading status...</span>
      </div>
    </div>
  `).join('');
}

function updateGroupUI(groupId) {
  const card = document.querySelector(`[data-group-id="${groupId}"]`);
  if (!card) return;

  const state = groupStates[groupId] || {};

  // Update toggle
  const toggle = card.querySelector('input[type="checkbox"]');
  if (toggle) toggle.checked = !!state.on;

  // Update brightness
  const slider = card.querySelector('input[type="range"]');
  const label = card.querySelector(`[data-brightness-label="${groupId}"]`);
  if (slider && state.brightness != null) {
    slider.value = state.brightness;
  }
  if (label) {
    label.textContent = state.brightness != null ? `${state.brightness}%` : '—';
  }

  // Update color picker
  const colorInput = card.querySelector('input[type="color"]');
  if (colorInput && state.color) {
    colorInput.value = state.color;
  }

  // Update status line
  updateGroupStatus(groupId);
}

function updateGroupStatus(groupId) {
  const statusEl = document.querySelector(`[data-status="${groupId}"]`);
  if (!statusEl) return;

  const state = groupStates[groupId] || {};

  if (state.on === undefined) {
    statusEl.innerHTML = '<span>Status unknown</span>';
    statusEl.className = 'group-status';
    return;
  }

  const colorSwatch = state.color
    ? `<span class="color-swatch" style="background:${state.color}"></span>`
    : '';

  if (state.on) {
    const brightnessStr = state.brightness != null ? ` @ ${state.brightness}%` : '';
    const tempStr = state.colorTemp ? ` ${state.colorTemp}K` : '';
    statusEl.innerHTML = `${colorSwatch}<span>On${brightnessStr}${tempStr}</span>`;
    statusEl.className = 'group-status on';
  } else {
    statusEl.innerHTML = '<span>Off</span>';
    statusEl.className = 'group-status off';
  }
}

// =============================================
// EVENT HANDLERS
// =============================================
function setupEventListeners() {
  const container = document.getElementById('lightingGroups');
  if (!container) return;

  // Event delegation for all controls
  container.addEventListener('change', (e) => {
    const { action, group } = e.target.dataset;
    if (!action || !group) return;

    if (action === 'toggle') {
      toggleGroup(group, e.target.checked);
    } else if (action === 'brightness') {
      // Update label immediately
      const label = container.querySelector(`[data-brightness-label="${group}"]`);
      if (label) label.textContent = `${e.target.value}%`;
    }
  });

  // Debounced brightness on input
  container.addEventListener('input', (e) => {
    const { action, group } = e.target.dataset;
    if (action === 'brightness' && group) {
      const label = container.querySelector(`[data-brightness-label="${group}"]`);
      if (label) label.textContent = `${e.target.value}%`;

      clearTimeout(brightnessTimers[group]);
      brightnessTimers[group] = setTimeout(() => {
        setBrightness(group, e.target.value);
      }, 400);
    }

    if (action === 'color' && group) {
      clearTimeout(colorTimers[group]);
      colorTimers[group] = setTimeout(() => {
        setColor(group, e.target.value);
      }, 400);
    }
  });

  // Color preset clicks
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="preset"]');
    if (!btn) return;

    const { group, hex, temp } = btn.dataset;
    if (!group) return;

    // Update color picker visually
    const colorInput = container.querySelector(`input[type="color"][data-group="${group}"]`);
    if (colorInput) colorInput.value = hex;

    if (temp) {
      // Temperature-based preset
      setColorTemp(group, parseInt(temp));
    } else {
      // RGB color preset
      setColor(group, hex);
    }
  });

  // All Off button
  document.getElementById('allOffBtn')?.addEventListener('click', () => {
    if (confirm('Turn off all lighting groups?')) {
      allOff();
    }
  });

  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    await refreshAllStates();
    btn.disabled = false;
    btn.textContent = 'Refresh';
    showToast('States refreshed', 'info', 1500);
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
}

// =============================================
// UTILITIES
// =============================================
function hexToRgbInt(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return r * 65536 + g * 256 + b;
}

function rgbIntToHex(value) {
  if (value == null) return null;
  const r = (value >> 16) & 0xFF;
  const g = (value >> 8) & 0xFF;
  const b = value & 0xFF;
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function getGroupName(groupId) {
  return GOVEE_GROUPS.find(g => g.groupId === groupId)?.name || groupId;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
