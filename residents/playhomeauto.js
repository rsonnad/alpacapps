/**
 * Home Automation - Lighting Page
 * Controls Govee lighting groups via Edge Function proxy
 * Groups loaded dynamically from govee_devices table
 */

import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// CONFIGURATION
// =============================================
const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const GOVEE_CONTROL_URL = `${SUPABASE_URL}/functions/v1/govee-control`;
const POLL_INTERVAL_MS = 30000; // 30 seconds

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
let goveeGroups = []; // Flat list for backward compat (allOff, refresh)
let lightingSections = []; // { name, sectionId, groups[] } — grouped by space hierarchy
let spaceMap = {}; // { spaceId: { id, name, parent_id } }
let groupStates = {}; // { groupId: { on, brightness, color, disconnected } }
let deviceStates = {}; // { deviceId: { on, brightness, color, disconnected } }
let pollTimer = null;
let lastPollTime = null;
let childrenStateLoaded = {}; // { groupId: true } — tracks which groups have had child states fetched

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
      await loadGroupsFromDB();
      await loadGoveeSettings();
      renderLightingAreas();
      setupEventListeners();
      await refreshAllStates();
      startPolling();
      // Load child device states in background (staggered to respect rate limits)
      loadAllChildrenStates();
    },
  });
});

// =============================================
// LOAD GROUPS FROM DATABASE
// =============================================
async function loadGroupsFromDB() {
  try {
    // Load active groups with space link, ordered by display_order
    const { data: groups, error: groupErr } = await supabase
      .from('govee_devices')
      .select('device_id, name, area, display_order, space_id')
      .eq('is_group', true)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (groupErr) throw groupErr;

    // Load child devices with their SKUs and names
    const { data: children, error: childErr } = await supabase
      .from('govee_devices')
      .select('device_id, name, sku, parent_group_id')
      .eq('is_group', false)
      .eq('is_active', true)
      .not('parent_group_id', 'is', null)
      .order('name', { ascending: true });

    if (childErr) throw childErr;

    // Load model name lookup
    const { data: models, error: modelErr } = await supabase
      .from('govee_models')
      .select('sku, model_name');

    if (modelErr) throw modelErr;

    // Load all spaces for hierarchy resolution (lightweight: id, name, parent_id only)
    const { data: allSpaces, error: spacesErr } = await supabase
      .from('spaces')
      .select('id, name, parent_id')
      .eq('is_archived', false);

    if (spacesErr) throw spacesErr;

    // Build space lookup map
    spaceMap = {};
    for (const s of allSpaces) {
      spaceMap[s.id] = s;
    }

    const modelMap = {};
    for (const m of models) {
      modelMap[m.sku] = m.model_name;
    }

    // Build goveeGroups array with children
    goveeGroups = groups.map(g => {
      const groupChildren = children.filter(c => c.parent_group_id === g.device_id);
      const deviceCount = groupChildren.length || null;

      const uniqueModels = [...new Set(
        groupChildren.map(c => modelMap[c.sku]).filter(Boolean)
      )];
      const modelsStr = uniqueModels.join(', ');

      return {
        name: g.name,
        groupId: g.device_id,
        area: g.area || 'Other',
        spaceId: g.space_id,
        deviceCount,
        models: modelsStr,
        children: groupChildren.map(c => ({
          deviceId: c.device_id,
          name: c.name,
          sku: c.sku,
          modelName: modelMap[c.sku] || c.sku,
        })),
      };
    });

    // Build lightingSections grouped by depth-1 space ancestor
    const sectionMap = new Map();

    for (const group of goveeGroups) {
      let sectionKey, sectionName;

      if (group.spaceId) {
        const ancestor = getDepth1Ancestor(group.spaceId);
        sectionKey = ancestor ? ancestor.id : '__ungrouped__';
        sectionName = ancestor ? ancestor.name : 'Other';
      } else {
        sectionKey = '__ungrouped__';
        sectionName = 'Other';
      }

      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, { name: sectionName, sectionId: sectionKey, groups: [] });
      }
      sectionMap.get(sectionKey).groups.push(group);
    }

    // Sort: named sections alphabetically, "Other" last
    lightingSections = [...sectionMap.values()].sort((a, b) => {
      if (a.sectionId === '__ungrouped__') return 1;
      if (b.sectionId === '__ungrouped__') return -1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error('Failed to load groups from DB:', err);
    showToast('Failed to load lighting groups', 'error');
  }
}

// Walk up parent_id chain to find depth-1 ancestor (direct child of root)
function getDepth1Ancestor(spaceId) {
  let current = spaceMap[spaceId];
  if (!current) return null;

  while (current.parent_id) {
    const parent = spaceMap[current.parent_id];
    if (!parent || !parent.parent_id) return current; // parent is root
    current = parent;
  }
  return current; // is root itself
}

// =============================================
// GOVEE SETTINGS (moved from admin settings.js)
// =============================================
async function loadGoveeSettings() {
  try {
    // Load config (non-sensitive fields only)
    const { data: config, error } = await supabase
      .from('govee_config')
      .select('is_active, test_mode, last_synced_at')
      .single();

    if (error) throw error;

    const checkbox = document.getElementById('goveeTestMode');
    const badge = document.getElementById('goveeModeBadge');

    if (checkbox) checkbox.checked = config.test_mode || false;
    if (badge) {
      badge.textContent = config.test_mode ? 'Test Mode' : 'Live';
      badge.classList.toggle('live', !config.test_mode);
    }

    // Load device counts by area
    const { data: devices, error: devError } = await supabase
      .from('govee_devices')
      .select('area, is_group')
      .eq('is_active', true);

    if (devError) throw devError;

    const countEl = document.getElementById('goveeDeviceCount');
    if (countEl) countEl.textContent = `${devices.length} devices`;

    // Build area summary
    const summaryEl = document.getElementById('goveeDeviceSummary');
    if (summaryEl && devices.length > 0) {
      const areas = {};
      for (const d of devices) {
        const area = d.area || 'Unknown';
        if (!areas[area]) areas[area] = { lights: 0, groups: 0 };
        if (d.is_group) areas[area].groups++;
        else areas[area].lights++;
      }

      summaryEl.innerHTML = Object.entries(areas)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([area, counts]) =>
          `<div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid var(--border-light, #f0f0f0); font-size: 0.85rem;">
            <span style="font-weight: 600;">${area}</span>
            <span class="text-muted">${counts.lights} light${counts.lights !== 1 ? 's' : ''}${counts.groups > 0 ? ` + ${counts.groups} group${counts.groups !== 1 ? 's' : ''}` : ''}</span>
          </div>`
        ).join('');
    } else if (summaryEl) {
      summaryEl.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No devices found.</p>';
    }
  } catch (error) {
    console.error('Error loading Govee settings:', error);
  }
}

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

    groupStates[groupId] = { ...groupStates[groupId], on, disconnected: false };
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

  for (const group of goveeGroups) {
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
// INDIVIDUAL DEVICE CONTROLS
// =============================================
async function toggleDevice(deviceId, sku, on) {
  const row = document.querySelector(`[data-device-id="${deviceId}"]`);
  row?.classList.add('loading');

  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
      capability: {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        value: on ? 1 : 0,
      },
    });

    deviceStates[deviceId] = { ...deviceStates[deviceId], on, disconnected: false };
    updateDeviceUI(deviceId);
    showToast(`${getDeviceName(deviceId)} turned ${on ? 'on' : 'off'}`, 'success', 2000);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
    const toggle = row?.querySelector('input[type="checkbox"]');
    if (toggle) toggle.checked = !on;
  } finally {
    row?.classList.remove('loading');
  }
}

async function setDeviceBrightness(deviceId, sku, value) {
  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
      capability: {
        type: 'devices.capabilities.range',
        instance: 'brightness',
        value: parseInt(value),
      },
    });
    deviceStates[deviceId] = { ...deviceStates[deviceId], brightness: parseInt(value) };
  } catch (err) {
    showToast(`Brightness failed: ${err.message}`, 'error');
  }
}

async function setDeviceColor(deviceId, sku, hexColor) {
  try {
    const rgb = hexToRgbInt(hexColor);
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
      capability: {
        type: 'devices.capabilities.color_setting',
        instance: 'colorRgb',
        value: rgb,
      },
    });
    deviceStates[deviceId] = { ...deviceStates[deviceId], color: hexColor };
    updateDeviceUI(deviceId);
  } catch (err) {
    showToast(`Color failed: ${err.message}`, 'error');
  }
}

async function setDeviceColorTemp(deviceId, sku, temp) {
  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
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

// =============================================
// DEVICE STATE LOADING
// =============================================
async function refreshDeviceState(deviceId, sku) {
  try {
    const result = await goveeApi('getDeviceState', { device: deviceId, sku });

    if (result.payload) {
      const capabilities = result.payload.capabilities || [];
      const state = { disconnected: false };

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

      deviceStates[deviceId] = { ...deviceStates[deviceId], ...state };
      updateDeviceUI(deviceId);
    }
  } catch (err) {
    console.warn(`Failed to get state for device ${deviceId}:`, err.message);
    deviceStates[deviceId] = { ...deviceStates[deviceId], disconnected: true };
    updateDeviceUI(deviceId);
  }
}

async function loadChildrenStates(groupId) {
  if (childrenStateLoaded[groupId]) return;
  childrenStateLoaded[groupId] = true;

  const group = goveeGroups.find(g => g.groupId === groupId);
  if (!group || !group.children.length) return;

  for (const child of group.children) {
    await refreshDeviceState(child.deviceId, child.sku);
    await sleep(150);
  }
}

async function loadAllChildrenStates() {
  for (const group of goveeGroups) {
    if (group.children.length > 0) {
      await loadChildrenStates(group.groupId);
      await sleep(500);
    }
  }
}

function updateDeviceUI(deviceId) {
  const row = document.querySelector(`[data-device-id="${deviceId}"]`);
  if (!row) return;

  const state = deviceStates[deviceId] || {};

  // Update toggle
  const toggle = row.querySelector('input[type="checkbox"]');
  if (toggle) toggle.checked = !!state.on;

  // Update brightness slider
  const slider = row.querySelector('input[type="range"]');
  if (slider && state.brightness != null) {
    slider.value = state.brightness;
  }

  // Update color button background
  const colorBtn = row.querySelector('.child-color-btn');
  if (colorBtn && state.color) {
    colorBtn.style.background = state.color;
  }

  // Dim row if off
  row.style.opacity = state.on === false ? '0.5' : '';
}

// =============================================
// STATE POLLING
// =============================================
async function refreshAllStates() {
  const results = await Promise.allSettled(
    goveeGroups.map(g => refreshGroupState(g.groupId))
  );

  lastPollTime = new Date();
  updatePollStatus();

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0 && failed < goveeGroups.length) {
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
      const state = { disconnected: false };

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
    // Mark as disconnected instead of throwing
    groupStates[groupId] = { ...groupStates[groupId], disconnected: true };
    updateGroupUI(groupId);
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
const COLLAPSE_STORAGE_KEY = 'lighting_collapsed_sections';

function renderLightingAreas() {
  const container = document.getElementById('lightingGroups');
  if (!container) return;

  container.innerHTML = lightingSections.map(section => {
    const isOpen = getSectionOpenState(section.sectionId);
    return `
      <details class="lighting-section" ${isOpen ? 'open' : ''} data-section="${section.sectionId}">
        <summary class="lighting-section__header">
          <span class="lighting-section__chevron"></span>
          <h3>${section.name}</h3>
          <span class="lighting-section__count">${section.groups.length} group${section.groups.length !== 1 ? 's' : ''}</span>
        </summary>
        <div class="lighting-section__body">
          <div class="lighting-area__grid">
            ${section.groups.map(g => renderGroupCard(g)).join('')}
          </div>
        </div>
      </details>
    `;
  }).join('');

  // Attach toggle listeners for persistence (toggle event doesn't bubble)
  container.querySelectorAll('.lighting-section').forEach(details => {
    details.addEventListener('toggle', () => {
      saveSectionState(details.dataset.section, details.open);
    });
  });
}

function getSectionOpenState(sectionId) {
  try {
    const collapsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '[]');
    return !collapsed.includes(sectionId);
  } catch { return true; }
}

function saveSectionState(sectionId, isOpen) {
  try {
    let collapsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '[]');
    if (isOpen) {
      collapsed = collapsed.filter(id => id !== sectionId);
    } else if (!collapsed.includes(sectionId)) {
      collapsed.push(sectionId);
    }
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
  } catch {}
}

function renderGroupCard(group) {
  const childrenHtml = group.children.length > 0
    ? `<div class="child-devices" data-children-for="${group.groupId}">
        <div class="child-devices__header">
          <span class="child-devices__count">${group.children.length} device${group.children.length !== 1 ? 's' : ''}</span>
          <button class="child-devices__toggle" data-action="toggle-children" data-group="${group.groupId}">Hide</button>
        </div>
        <div class="child-devices__list expanded" data-children-list="${group.groupId}">
          ${group.children.map(c => renderChildDevice(c)).join('')}
        </div>
      </div>`
    : '';

  return `
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

      ${childrenHtml}

      <div class="group-status" data-status="${group.groupId}">
        <span>Loading status...</span>
      </div>
    </div>
  `;
}

function renderChildDevice(child) {
  return `
    <div class="child-device-row" data-device-id="${child.deviceId}" data-device-sku="${child.sku}">
      <div class="child-device-row__info">
        <span class="child-device-row__name">${child.name}</span>
        <span class="child-device-row__model">${child.modelName}</span>
      </div>
      <div class="child-device-row__controls">
        <label class="toggle-switch-small">
          <input type="checkbox" data-action="device-toggle" data-device="${child.deviceId}" data-sku="${child.sku}">
          <span class="slider"></span>
        </label>
        <input type="range" min="1" max="100" value="50" class="child-brightness-slider"
          data-action="device-brightness" data-device="${child.deviceId}" data-sku="${child.sku}">
        <button class="child-color-btn" title="Set color"
          data-action="device-color-btn" data-device="${child.deviceId}" data-sku="${child.sku}"
          style="background: #FFD4A3;"></button>
      </div>
    </div>
  `;
}

function updateGroupUI(groupId) {
  const card = document.querySelector(`[data-group-id="${groupId}"]`);
  if (!card) return;

  const state = groupStates[groupId] || {};

  // Handle disconnected state
  if (state.disconnected) {
    card.classList.add('disconnected');
  } else {
    card.classList.remove('disconnected');
  }

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

  // Disconnected state
  if (state.disconnected) {
    statusEl.innerHTML = '<span>Disconnected</span>';
    statusEl.className = 'group-status disconnected';
    return;
  }

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
    const { action, group, device, sku } = e.target.dataset;

    if (action === 'toggle' && group) {
      toggleGroup(group, e.target.checked);
    } else if (action === 'brightness' && group) {
      const label = container.querySelector(`[data-brightness-label="${group}"]`);
      if (label) label.textContent = `${e.target.value}%`;
    } else if (action === 'device-toggle' && device && sku) {
      toggleDevice(device, sku, e.target.checked);
    }
  });

  // Debounced brightness/color on input
  container.addEventListener('input', (e) => {
    const { action, group, device, sku } = e.target.dataset;

    // Group brightness
    if (action === 'brightness' && group) {
      const label = container.querySelector(`[data-brightness-label="${group}"]`);
      if (label) label.textContent = `${e.target.value}%`;

      clearTimeout(brightnessTimers[group]);
      brightnessTimers[group] = setTimeout(() => {
        setBrightness(group, e.target.value);
      }, 400);
    }

    // Group color
    if (action === 'color' && group) {
      clearTimeout(colorTimers[group]);
      colorTimers[group] = setTimeout(() => {
        setColor(group, e.target.value);
      }, 400);
    }

    // Device brightness
    if (action === 'device-brightness' && device && sku) {
      const key = `dev_${device}`;
      clearTimeout(brightnessTimers[key]);
      brightnessTimers[key] = setTimeout(() => {
        setDeviceBrightness(device, sku, e.target.value);
      }, 400);
    }
  });

  // Click handlers: presets, child toggle, device color button
  container.addEventListener('click', (e) => {
    // Group color presets
    const presetBtn = e.target.closest('[data-action="preset"]');
    if (presetBtn) {
      const { group, hex, temp } = presetBtn.dataset;
      if (!group) return;
      const colorInput = container.querySelector(`input[type="color"][data-group="${group}"]`);
      if (colorInput) colorInput.value = hex;
      if (temp) {
        setColorTemp(group, parseInt(temp));
      } else {
        setColor(group, hex);
      }
      return;
    }

    // Toggle children expand/collapse
    const toggleBtn = e.target.closest('[data-action="toggle-children"]');
    if (toggleBtn) {
      const groupId = toggleBtn.dataset.group;
      const list = container.querySelector(`[data-children-list="${groupId}"]`);
      if (list) {
        const isExpanded = list.classList.toggle('expanded');
        toggleBtn.textContent = isExpanded ? 'Hide' : 'Show';
      }
      return;
    }

    // Device color button -> show popover
    const colorBtn = e.target.closest('[data-action="device-color-btn"]');
    if (colorBtn) {
      showDeviceColorPopover(colorBtn);
      return;
    }

    // Device color preset inside popover
    const devicePreset = e.target.closest('[data-action="device-preset"]');
    if (devicePreset) {
      const { device, sku, hex, temp } = devicePreset.dataset;
      if (temp) {
        setDeviceColorTemp(device, sku, parseInt(temp));
      } else {
        setDeviceColor(device, sku, hex);
      }
      // Update color button background
      const row = container.querySelector(`[data-device-id="${device}"]`);
      const btn = row?.querySelector('.child-color-btn');
      if (btn) btn.style.background = hex;
      hideDeviceColorPopover();
      return;
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

  // Govee test mode toggle (admin-only)
  document.getElementById('goveeTestMode')?.addEventListener('change', async (e) => {
    const testMode = e.target.checked;
    try {
      const { error } = await supabase
        .from('govee_config')
        .update({ test_mode: testMode, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;

      const badge = document.getElementById('goveeModeBadge');
      if (badge) {
        badge.textContent = testMode ? 'Test Mode' : 'Live';
        badge.classList.toggle('live', !testMode);
      }
      showToast(`Govee ${testMode ? 'test' : 'live'} mode enabled`, 'success');
    } catch (error) {
      console.error('Error updating Govee mode:', error);
      showToast('Failed to update Govee mode', 'error');
      e.target.checked = !testMode;
    }
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });
}

// =============================================
// COLOR POPOVER
// =============================================
let activePopover = null;

function showDeviceColorPopover(triggerBtn) {
  hideDeviceColorPopover();

  const { device, sku } = triggerBtn.dataset;
  const popover = document.createElement('div');
  popover.className = 'device-color-popover';

  popover.innerHTML = COLOR_PRESETS.map(p => `
    <button class="color-preset" title="${p.name}"
      style="background:${p.hex}"
      data-action="device-preset" data-device="${device}" data-sku="${sku}"
      data-hex="${p.hex}" ${p.temp ? `data-temp="${p.temp}"` : ''}>
    </button>
  `).join('');

  // Position below the trigger button
  const rect = triggerBtn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${rect.left}px`;

  document.body.appendChild(popover);
  activePopover = popover;

  // Adjust if overflows right edge
  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      popover.style.left = `${window.innerWidth - popRect.width - 8}px`;
    }
  });

  // Close on outside click (delayed to avoid immediate close)
  setTimeout(() => {
    document.addEventListener('click', handlePopoverOutsideClick);
  }, 0);
}

function hideDeviceColorPopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  document.removeEventListener('click', handlePopoverOutsideClick);
}

function handlePopoverOutsideClick(e) {
  if (activePopover && !activePopover.contains(e.target) && !e.target.closest('[data-action="device-color-btn"]')) {
    hideDeviceColorPopover();
  }
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
  return goveeGroups.find(g => g.groupId === groupId)?.name || groupId;
}

function getDeviceName(deviceId) {
  for (const g of goveeGroups) {
    const child = g.children.find(c => c.deviceId === deviceId);
    if (child) return child.name;
  }
  return deviceId;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
