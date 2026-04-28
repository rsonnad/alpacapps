/**
 * Home Automation - Lighting Page
 * Controls Govee lighting groups via Edge Function proxy
 * Groups loaded dynamically from govee_devices table
 */

import { supabase, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { hasPermission } from '../shared/auth.js';
import { getResidentDeviceScope } from '../shared/services/resident-device-scope.js';
import { PollManager } from '../shared/services/poll-manager.js';
import { supabaseHealth } from '../shared/supabase-health.js';

// =============================================
// CONFIGURATION
// =============================================
const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const GOVEE_CONTROL_URL = `${SUPABASE_URL}/functions/v1/govee-control`;
const HOME_ASSISTANT_CONTROL_URL = `${SUPABASE_URL}/functions/v1/home-assistant-control`;
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

// H601F segment mapping — Ring (nightlight) vs Main (downlight)
// Icons show top-down view of the recessed light:
//   Ring = outer edge glow (thick colored ring, dim center)
//   Main = center downlight (dim outer ring, bright filled center)
const ZONE_ICONS = {
  Ring: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.9"/>
    <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1" fill="none" opacity="0.25"/>
  </svg>`,
  Main: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1" fill="none" opacity="0.25"/>
    <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.9"/>
  </svg>`,
};

const SEGMENT_ZONES = {
  H601F: [
    { name: 'Ring', icon: ZONE_ICONS.Ring, segments: [0], description: 'Outer ring / nightlight' },
    { name: 'Main', icon: ZONE_ICONS.Main, segments: [1, 2, 3, 4, 5, 6], description: 'Downlight' },
  ],
  H601A: [
    { name: 'Ring', icon: ZONE_ICONS.Ring, segments: [0], description: 'Outer ring / nightlight' },
    { name: 'Main', icon: ZONE_ICONS.Main, segments: [1, 2, 3, 4, 5, 6], description: 'Downlight' },
  ],
};

function getSegmentZones(sku, segmentCount) {
  if (SEGMENT_ZONES[sku]) return SEGMENT_ZONES[sku];
  // Strip lights with many segments get individual segment grid
  if (segmentCount > 2) return null; // signal to use strip grid instead
  const all = Array.from({ length: segmentCount }, (_, i) => i);
  return [
    { name: 'All', segments: all, description: 'All segments' },
  ];
}

// Music mode definitions (from Govee API)
const MUSIC_MODES = [
  { name: 'Energic', value: 0, icon: '⚡' },
  { name: 'Rhythm', value: 1, icon: '🥁' },
  { name: 'Spectrum', value: 2, icon: '🌊' },
  { name: 'Rolling', value: 3, icon: '🎢' },
  { name: 'Separation', value: 4, icon: '🔀' },
  { name: 'Hopping', value: 5, icon: '🐇' },
  { name: 'PianoKeys', value: 6, icon: '🎹' },
  { name: 'Fountain', value: 7, icon: '⛲' },
  { name: 'DayAndNight', value: 8, icon: '🌗' },
  { name: 'Sprouting', value: 9, icon: '🌱' },
  { name: 'Shiny', value: 10, icon: '✨' },
];

// Scene visual gradients for enhanced chips
const SCENE_GRADIENTS = {
  'Sunrise': 'linear-gradient(135deg, #ff6b35, #ffd700)',
  'Sunset': 'linear-gradient(135deg, #ff4500, #8b008b)',
  'Afternoon': 'linear-gradient(135deg, #ffd700, #fffacd)',
  'Candlelight': 'linear-gradient(135deg, #ff8c00, #ffd700)',
  'Romantic': 'linear-gradient(135deg, #ff69b4, #ff1493)',
  'Reading': 'linear-gradient(135deg, #fffaf0, #faebd7)',
  'Aurora-B': 'linear-gradient(135deg, #00ff87, #60efff, #b366ff)',
  'Universe-B': 'linear-gradient(135deg, #1a0533, #4a0e8f, #00d4ff)',
  'Fire-C': 'linear-gradient(135deg, #ff0000, #ff6600, #ffcc00)',
  'Crossing': 'linear-gradient(135deg, #0077be, #00bfff, #00ff7f)',
  'Halloween-A': 'linear-gradient(135deg, #ff6600, #800080, #000)',
  'Breathe': 'linear-gradient(135deg, #87ceeb, #fff, #87ceeb)',
  'Sweet': 'linear-gradient(135deg, #ff69b4, #dda0dd, #87ceeb)',
  'Moonlight-A': 'linear-gradient(135deg, #191970, #4169e1)',
  'Sleep-A': 'linear-gradient(135deg, #1a0a2e, #2d1b69)',
  'Soothing-A': 'linear-gradient(135deg, #2e8b57, #3cb371)',
};
const DARK_SCENES = ['Moonlight-A','Moonlight-B','Night-A','Universe-B','Sleep-A','Sleep-B','Quiet-A','Halloween-A'];

// =============================================
// STATE
// =============================================
let goveeGroups = []; // Flat list for backward compat (allOff, refresh)
let lightingSections = []; // { name, sectionId, groups[] } — grouped by area
let unifiedGroups = []; // Logical room groups (HA primary + fallback targets)
let unifiedGroupStates = {}; // { groupKey: { on, brightness, disconnected } }
let groupStates = {}; // { groupId: { on, brightness, color, disconnected } }
let lastContactTimes = {}; // { groupId|groupKey: Date } — last successful state fetch
let deviceStates = {}; // { deviceId: { on, brightness, color, disconnected } }
let poll = null;
let lastPollTime = null;
let childrenStateLoaded = {}; // { groupId: true } — tracks which groups have had child states fetched
let sceneCache = {}; // { sku: [{name, value}] } — client-side scene cache
let sceneFetching = {}; // { sku: Promise } — dedup concurrent fetches
let deviceScope = null;

// Debounce timers
const brightnessTimers = {};
const colorTimers = {};

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: async (authState) => {
      deviceScope = await getResidentDeviceScope(authState.appUser, authState.hasPermission);
      await loadUnifiedGroups();
      await loadGroupsFromDB();
      if (hasPermission('admin_lighting_settings')) {
        await loadGoveeSettings();
      }
      renderUnifiedLightingGroups();
      renderLightingAreas();
      setupEventListeners();
      await refreshUnifiedStates();
      await refreshAllStates();
      startPolling();
      // Sync UI when PAI takes light actions
      window.addEventListener('pai-actions', (e) => {
        const actions = (e.detail?.actions || []);
        const lightActions = actions.filter(a => a.type === 'control_lights');
        const unifiedActions = actions.filter(a => a.type === 'control_room_lights');
        for (const action of lightActions) {
          if (!action.result?.startsWith('OK:')) continue;
          // Find group by name match
          const group = goveeGroups.find(g =>
            g.name.toLowerCase() === (action.target || '').toLowerCase()
          );
          if (!group) continue;
          const gid = group.groupId;
          const args = action.args || {};
          const patch = { disconnected: false };
          switch (args.action) {
            case 'on':
              patch.on = true;
              break;
            case 'off':
              patch.on = false;
              break;
            case 'color':
              patch.on = true;
              // Convert color name to hex for the picker
              if (args.value) {
                const named = paiColorToHex(args.value);
                if (named) patch.color = named;
              }
              break;
            case 'brightness':
              patch.on = true;
              if (args.value) patch.brightness = parseInt(args.value);
              break;
          }
          groupStates[gid] = { ...groupStates[gid], ...patch };
          updateGroupUI(gid);
        }
        // Also do a background Govee state refresh for accuracy
        if (lightActions.length) {
          setTimeout(() => refreshAllStates(), 2000);
        }
        if (unifiedActions.length) {
          setTimeout(() => refreshUnifiedStates(), 1500);
        }
      });
      // Load child device states in background (staggered to respect rate limits)
      loadAllChildrenStates();
      // Auto-load scenes for devices whose panels start expanded
      autoLoadVisibleScenes();
    },
  });
});

// =============================================
// LOAD GROUPS FROM DATABASE
// =============================================
const AREA_ORDER = ['Spartan', 'Garage Mahal', 'Outhouse', 'Bedrooms'];

async function loadGroupsFromDB() {
  try {
    // Load active groups ordered by display_order
    const { data: groups, error: groupErr } = await supabase
      .from('govee_devices')
      .select('*')
      .eq('is_group', true)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (groupErr) throw groupErr;

    // Load child devices with their SKUs, names, and capabilities
    const { data: children, error: childErr } = await supabase
      .from('govee_devices')
      .select('*')
      .eq('is_group', false)
      .eq('is_active', true)
      .not('parent_group_id', 'is', null)
      .order('name', { ascending: true });

    if (childErr) throw childErr;

    // Load model name lookup with segment_count
    const { data: models, error: modelErr } = await supabase
      .from('govee_models')
      .select('sku, model_name, segment_count');

    if (modelErr) throw modelErr;

    const modelMap = {};
    const segmentCountMap = {};
    for (const m of models) {
      modelMap[m.sku] = m.model_name;
      if (m.segment_count) segmentCountMap[m.sku] = m.segment_count;
    }

    const scopedGroups = applyDeviceScopeToGoveeRecords(groups || []);
    const scopedGroupIds = new Set(scopedGroups.map(g => g.device_id));
    const scopedChildren = (children || []).filter(c =>
      scopedGroupIds.has(c.parent_group_id) || canAccessScopedDevice(c)
    );

    // Build goveeGroups array with children
    goveeGroups = scopedGroups.map(g => {
      const groupChildren = scopedChildren.filter(c => c.parent_group_id === g.device_id);
      const deviceCount = groupChildren.length || null;

      const uniqueModels = [...new Set(
        groupChildren.map(c => modelMap[c.sku]).filter(Boolean)
      )];
      const modelsStr = uniqueModels.join(', ');

      return {
        name: g.name,
        groupId: g.device_id,
        area: g.area || 'Other',
        deviceCount,
        models: modelsStr,
        children: groupChildren.map(c => {
          const caps = c.capabilities || [];
          const hasSegments = caps.some(cap => cap.instance === 'segmentedColorRgb');
          const hasScenes = caps.some(cap => cap.instance === 'lightScene');
          const hasMusicMode = caps.some(cap => cap.instance === 'musicMode');
          const hasGradientToggle = caps.some(cap => cap.instance === 'gradientToggle');
          // Extract music mode options from capability if present
          const musicCap = caps.find(cap => cap.instance === 'musicMode');
          const musicModeOptions = musicCap?.parameters?.fields
            ?.find(f => f.fieldName === 'musicMode')?.options || [];
          return {
            deviceId: c.device_id,
            name: c.name,
            sku: c.sku,
            modelName: modelMap[c.sku] || c.sku,
            segmentCount: segmentCountMap[c.sku] || 0,
            hasSegments,
            hasScenes,
            hasMusicMode,
            hasGradientToggle,
            musicModeOptions,
          };
        }),
      };
    });

    // Build lightingSections grouped by area
    const sectionMap = new Map();
    for (const group of goveeGroups) {
      const area = group.area;
      if (!sectionMap.has(area)) {
        sectionMap.set(area, { name: area, sectionId: area, groups: [] });
      }
      sectionMap.get(area).groups.push(group);
    }

    // Sort by AREA_ORDER
    lightingSections = [...sectionMap.values()].sort((a, b) => {
      const ai = AREA_ORDER.indexOf(a.sectionId);
      const bi = AREA_ORDER.indexOf(b.sectionId);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  } catch (err) {
    console.error('Failed to load groups from DB:', err);
    showToast('Failed to load lighting groups', 'error');
  }
}

function applyDeviceScopeToGoveeRecords(records) {
  if (!deviceScope || deviceScope.fullAccess) return records || [];
  return (records || []).filter(canAccessScopedDevice);
}

function canAccessScopedDevice(record) {
  if (!deviceScope || deviceScope.fullAccess) return true;
  return deviceScope.canAccessSpaceId(record?.space_id)
    || deviceScope.canAccessSpaceName(record?.space_name)
    || deviceScope.canAccessSpaceName(record?.area)
    || deviceScope.canAccessSpaceName(record?.name);
}

// =============================================
// UNIFIED LIGHTING GROUPS (HA PRIMARY)
// =============================================
async function loadUnifiedGroups() {
  try {
    const result = await homeAssistantApi('list_groups');
    const groups = result.groups || [];
    unifiedGroups = (groups || []).filter(g => {
      if (!deviceScope || deviceScope.fullAccess) return true;
      return deviceScope.canAccessSpaceName(g?.area) || deviceScope.canAccessSpaceName(g?.name);
    });
  } catch (err) {
    console.warn('Failed to load unified lighting groups:', err.message);
    unifiedGroups = [];
  }
}

function renderUnifiedLightingGroups() {
  const container = document.getElementById('unifiedLightingGroups');
  if (!container) return;
  if (!unifiedGroups.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No unified room groups configured yet.</p>';
    return;
  }
  container.innerHTML = unifiedGroups.map(group => {
    const state = unifiedGroupStates[group.key] || {};
    return `
      <div class="lighting-group-card" data-unified-group-key="${group.key}">
        <div class="lighting-group-card__header">
          <div class="lighting-group-card__title">
            <div class="lighting-group-card__name-row">
              <span class="status-dot ${getStatusDotClass(state)}" title="${getStatusDotTitle(state)}"></span>
              <span class="lighting-group-card__name">${group.name}</span>
            </div>
            <span class="lighting-group-card__devices">${group.area || 'Room'} · ${(group.lighting_group_targets || []).length} target${(group.lighting_group_targets || []).length !== 1 ? 's' : ''}${lastContactTimes[group.key] ? ` · ${formatLastContact(group.key)}` : ''}</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" data-action="unified-toggle" data-group-key="${group.key}" ${state.on ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="brightness-control">
          <div class="brightness-control__label">
            <span>Brightness</span>
            <span class="brightness-value">${typeof state.brightness === 'number' ? `${state.brightness}%` : '—'}</span>
          </div>
          <input type="range" min="1" max="100" value="${typeof state.brightness === 'number' ? state.brightness : 60}"
            data-action="unified-brightness" data-group-key="${group.key}">
        </div>
        <div class="color-control">
          <span class="color-control__label">Color</span>
          <input type="color" value="${state.color || '#FFD4A3'}"
            data-action="unified-color" data-group-key="${group.key}">
          <div class="color-presets">
            ${COLOR_PRESETS.map(p => `
              <button class="color-preset" title="${p.name}" style="background:${p.hex}"
                data-action="unified-preset" data-group-key="${group.key}" data-hex="${p.hex}"></button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function refreshUnifiedStates() {
  if (!unifiedGroups.length) return;
  await Promise.allSettled(unifiedGroups.map(async (group) => {
    const result = await homeAssistantApi('get_group_state', { group_key: group.key });
    unifiedGroupStates[group.key] = {
      on: !!result?.state?.on,
      brightness: typeof result?.state?.brightness === 'number' ? result.state.brightness : undefined,
      disconnected: false,
    };
    lastContactTimes[group.key] = new Date();
  }));
  renderUnifiedLightingGroups();
}

async function controlUnifiedGroup(groupKey, action, payload = {}) {
  await homeAssistantApi(action, { group_key: groupKey, ...payload });
  if (action === 'set_power') {
    unifiedGroupStates[groupKey] = { ...unifiedGroupStates[groupKey], on: !!payload.on, disconnected: false };
  } else if (action === 'set_brightness') {
    unifiedGroupStates[groupKey] = { ...unifiedGroupStates[groupKey], brightness: parseInt(payload.brightness), on: true, disconnected: false };
  } else if (action === 'set_color') {
    unifiedGroupStates[groupKey] = { ...unifiedGroupStates[groupKey], color: payload.hex_color, on: true, disconnected: false };
  }
  renderUnifiedLightingGroups();
}

async function allUnifiedOff() {
  const btn = document.getElementById('allUnifiedOffBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Turning off...';
  }
  try {
    for (const g of unifiedGroups) {
      await controlUnifiedGroup(g.key, 'set_power', { on: false });
    }
    showToast(`Unified rooms off (${unifiedGroups.length})`, 'success');
  } catch (err) {
    showToast(`Unified room off failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'All Rooms Off';
    }
  }
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

    // Load all devices with details
    const [goveeResult, tuyaResult] = await Promise.all([
      supabase.from('govee_devices')
        .select('name, device_id, sku, area, is_group')
        .eq('is_active', true)
        .order('name'),
      supabase.from('lighting_group_targets')
        .select('target_id, metadata, is_active, lighting_groups!inner(key, name, area)')
        .eq('backend', 'tuya_cloud')
    ]);

    if (goveeResult.error) throw goveeResult.error;
    const goveeDevices = goveeResult.data || [];
    const tuyaTargets = (tuyaResult.data || []).map(t => ({
      name: t.metadata?.name || t.target_id,
      device_id: t.target_id,
      sku: t.metadata?.product || 'Tuya',
      area: t.lighting_groups?.area || 'Unknown',
      is_group: false,
      backend: 'tuya_cloud',
      status: t.metadata?.status || 'unknown',
      is_active: t.is_active
    }));

    const allDevices = [
      ...goveeDevices.map(d => ({ ...d, backend: 'govee', status: 'active', is_active: true })),
      ...tuyaTargets
    ];

    const countEl = document.getElementById('goveeDeviceCount');
    if (countEl) countEl.textContent = `${allDevices.length} devices`;

    // Build area accordion
    const summaryEl = document.getElementById('goveeDeviceSummary');
    if (summaryEl && allDevices.length > 0) {
      const areas = {};
      for (const d of allDevices) {
        const area = d.area || 'Unknown';
        if (!areas[area]) areas[area] = { devices: [], groups: 0, lights: 0 };
        if (d.is_group) areas[area].groups++;
        else areas[area].lights++;
        areas[area].devices.push(d);
      }

      summaryEl.innerHTML = Object.entries(areas)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([area, info]) => {
          const countLabel = `${info.lights} light${info.lights !== 1 ? 's' : ''}${info.groups > 0 ? ` + ${info.groups} group${info.groups !== 1 ? 's' : ''}` : ''}`;
          const deviceRows = info.devices
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(d => {
              const backendBadge = d.backend === 'tuya_cloud'
                ? '<span style="background:#7c3aed;color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:4px;">Tuya</span>'
                : '<span style="background:#059669;color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:4px;">Govee</span>';
              const statusDot = d.is_active
                ? '<span style="color:#22c55e;margin-right:4px;">●</span>'
                : '<span style="color:#d1d5db;margin-right:4px;">●</span>';
              const typeBadge = d.is_group
                ? '<span style="background:#f59e0b;color:#fff;font-size:0.6rem;padding:1px 4px;border-radius:3px;margin-left:4px;">GROUP</span>'
                : '';
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0.5rem;font-size:0.8rem;border-bottom:1px solid var(--border-light,#f5f5f5);">
                <span>${statusDot}${d.name}${typeBadge}${backendBadge}</span>
                <span class="text-muted" style="font-size:0.7rem;">${d.sku}</span>
              </div>`;
            }).join('');

          return `<details style="border-bottom:1px solid var(--border-light,#e5e5e5);">
            <summary style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;cursor:pointer;font-size:0.85rem;user-select:none;">
              <span style="font-weight:600;">${area}</span>
              <span class="text-muted">${countLabel}</span>
            </summary>
            <div style="padding:0 0 0.5rem 0;background:var(--bg-muted,#fafafa);border-radius:4px;margin-bottom:0.25rem;">
              ${deviceRows}
            </div>
          </details>`;
        }).join('');
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
  // Get session — getSession() may return a stale/expired JWT from cache,
  // so check expiry and force refresh if needed
  const token = await getAuthToken();
  const response = await fetch(GOVEE_CONTROL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error || err.message || err.msg || `API error ${response.status}`;
    console.error('goveeApi error:', { action, status: response.status, body: err, params });
    throw new Error(msg);
  }

  return response.json();
}

async function getAuthToken() {
  let { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const expiresAt = session.expires_at; // Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    if (!expiresAt || expiresAt - now < 60) {
      // Token expired or expiring within 60s — force refresh
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
  } else {
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }
  const token = session?.access_token;
  if (!token) {
    showToast('Session expired. Please sign in again.', 'error');
    throw new Error('No auth token');
  }
  return token;
}

async function homeAssistantApi(action, params = {}) {
  const token = await getAuthToken();
  const response = await fetch(HOME_ASSISTANT_CONTROL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error || err.message || err.msg || `API error ${response.status}`;
    console.error('homeAssistantApi error:', { action, status: response.status, body: err, params });
    throw new Error(msg);
  }
  return response.json();
}

// =============================================
// SCENE FETCHING
// =============================================
async function fetchScenesForSku(sku, sampleDeviceId) {
  if (sceneCache[sku]) return sceneCache[sku];
  if (sceneFetching[sku]) return sceneFetching[sku];

  sceneFetching[sku] = (async () => {
    try {
      const result = await goveeApi('getScenes', { sku, device: sampleDeviceId });
      sceneCache[sku] = result.scenes || [];
      return sceneCache[sku];
    } catch (err) {
      console.warn(`Failed to fetch scenes for ${sku}:`, err.message);
      return [];
    } finally {
      delete sceneFetching[sku];
    }
  })();

  return sceneFetching[sku];
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
// SEGMENT COLOR CONTROLS
// =============================================
async function setSegmentColor(deviceId, sku, segments, hexColor) {
  try {
    const rgb = hexToRgbInt(hexColor);
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
      capability: {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        value: { segment: segments, rgb },
      },
    });
    showToast(`Segment color set`, 'success', 1500);
  } catch (err) {
    showToast(`Segment color failed: ${err.message}`, 'error');
  }
}

// =============================================
// SCENE CONTROLS
// =============================================
async function activateScene(deviceId, sku, sceneValue, sceneName) {
  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku: sku,
      capability: {
        type: 'devices.capabilities.dynamic_scene',
        instance: 'lightScene',
        value: sceneValue,
      },
    });
    showToast(`Scene: ${sceneName}`, 'success', 2000);
  } catch (err) {
    console.error('Scene activation failed:', { deviceId, sku, sceneName, sceneValue, error: err.message });
    showToast(`Scene failed: ${err.message}`, 'error');
  }
}

async function activateGroupScene(groupId, sceneValue, sceneName) {
  const group = goveeGroups.find(g => g.groupId === groupId);
  if (!group) return;

  // Scene must be sent to an actual device, not SameModeGroup (groups don't support dynamic_scene)
  // Send to all children that support scenes
  const sceneChildren = group.children.filter(c => c.hasScenes);
  if (sceneChildren.length === 0) return;

  let success = 0;
  for (const child of sceneChildren) {
    try {
      await goveeApi('controlDevice', {
        device: child.deviceId,
        sku: child.sku,
        capability: {
          type: 'devices.capabilities.dynamic_scene',
          instance: 'lightScene',
          value: sceneValue,
        },
      });
      success++;
    } catch (err) {
      console.error('Group scene failed for child:', child.deviceId, err.message);
    }
    // Small delay between children to avoid rate limits
    if (sceneChildren.length > 1) await sleep(200);
  }

  if (success > 0) {
    showToast(`Scene: ${sceneName} (${success}/${sceneChildren.length})`, 'success', 2000);
  } else {
    showToast(`Scene failed for all devices`, 'error');
  }
}

// =============================================
// MUSIC MODE & GRADIENT CONTROLS
// =============================================
async function setMusicMode(deviceId, sku, modeValue, sensitivity = 80, autoColor = true, rgb = null) {
  try {
    const fields = [
      { fieldName: 'musicMode', value: modeValue },
      { fieldName: 'sensitivity', value: sensitivity },
      { fieldName: 'autoColor', value: autoColor ? 1 : 0 },
    ];
    if (!autoColor && rgb != null) {
      fields.push({ fieldName: 'rgb', value: rgb });
    }

    await goveeApi('controlDevice', {
      device: deviceId,
      sku,
      capability: {
        type: 'devices.capabilities.music_setting',
        instance: 'musicMode',
        value: fields.reduce((obj, f) => { obj[f.fieldName] = f.value; return obj; }, {}),
      },
    });

    const modeName = MUSIC_MODES.find(m => m.value === modeValue)?.name || `Mode ${modeValue}`;
    showToast(`Music: ${modeName}`, 'success', 2000);
  } catch (err) {
    showToast(`Music mode failed: ${err.message}`, 'error');
  }
}

async function toggleGradient(deviceId, sku, on) {
  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku,
      capability: {
        type: 'devices.capabilities.toggle',
        instance: 'gradientToggle',
        value: on ? 1 : 0,
      },
    });
    showToast(`Gradient ${on ? 'on' : 'off'}`, 'success', 1500);
  } catch (err) {
    showToast(`Gradient failed: ${err.message}`, 'error');
  }
}

async function setStripSegmentColors(deviceId, sku, segments, hexColor) {
  const rgb = hexToRgbInt(hexColor);
  try {
    await goveeApi('controlDevice', {
      device: deviceId,
      sku,
      capability: {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        value: { segment: segments, rgb },
      },
    });
  } catch (err) {
    showToast(`Segment color failed: ${err.message}`, 'error');
  }
}

async function applyRainbow(deviceId, sku, segmentCount) {
  const colors = [];
  for (let i = 0; i < segmentCount; i++) {
    const hue = Math.round((i / segmentCount) * 360);
    colors.push(hslToRgbInt(hue, 100, 50));
  }
  // Send each segment individually (API may not support batch)
  for (let i = 0; i < segmentCount; i++) {
    try {
      await goveeApi('controlDevice', {
        device: deviceId,
        sku,
        capability: {
          type: 'devices.capabilities.segment_color_setting',
          instance: 'segmentedColorRgb',
          value: { segment: [i], rgb: colors[i] },
        },
      });
    } catch (err) {
      // Continue with remaining segments
    }
    if (segmentCount > 5) await sleep(100);
  }
  showToast('Rainbow applied', 'success', 2000);
}

function hslToRgbInt(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
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
        } else if (cap.instance === 'online') {
          if (cap.state?.value === false) {
            state.disconnected = true;
          }
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
  if (colorBtn && colorBtn.style && state.color) {
    colorBtn.style.background = state.color;
  }

  // Update segment color pickers to reflect current device color
  if (state.color) {
    const segPickers = row.querySelectorAll('.segment-color-picker');
    segPickers.forEach(picker => {
      // Only set if still at default value
      if (picker.value === '#ffd4a3') {
        picker.value = state.color;
      }
    });
  }

  // Update status dot
  const dot = row.querySelector('.status-dot');
  if (dot) {
    dot.className = 'status-dot ' + getStatusDotClass(state);
    dot.title = getStatusDotTitle(state);
  }

  // Dim row if off
  if (row && row.style) {
    row.style.opacity = state.on === false ? '0.5' : '';
  }
}

// =============================================
// STATE POLLING
// =============================================
async function refreshAllStates() {
  await refreshUnifiedStates();

  const results = await Promise.allSettled(
    goveeGroups.map(g => refreshGroupState(g.groupId))
  );

  lastPollTime = new Date();
  updatePollStatus();

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0 && failed < goveeGroups.length) {
    console.warn(`${failed} group state queries failed`);
  }

  // Track health: if ALL groups failed, record failure and throw for circuit breaker
  if (failed === goveeGroups.length && goveeGroups.length > 0) {
    supabaseHealth.recordFailure();
    throw new Error(`All ${failed} lighting group queries failed`);
  } else if (goveeGroups.length > 0) {
    supabaseHealth.recordSuccess();
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
      lastContactTimes[groupId] = new Date();
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
  if (poll) poll.stop();
  poll = new PollManager(refreshAllStates, POLL_INTERVAL_MS);
  poll.start();
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
// LAST CONTACT HELPERS
// =============================================
function formatLastContact(key) {
  const t = lastContactTimes[key];
  if (!t) return '';
  const diff = Date.now() - t.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return t.toLocaleDateString();
}

// =============================================
// STATUS DOT HELPERS
// =============================================
function getStatusDotClass(state) {
  if (state.disconnected) return 'status-dot--red';
  if (state.on) return 'status-dot--green';
  return 'status-dot--gray';
}

function getStatusDotTitle(state) {
  if (state.disconnected) return 'Disconnected';
  if (state.on) return 'On';
  return 'Off';
}

function getGroupStatusDotHtml(groupId) {
  const state = groupStates[groupId] || {};
  const cls = getStatusDotClass(state);
  const title = getStatusDotTitle(state);
  return `<span class="status-dot ${cls}" data-group-dot="${groupId}" title="${title}"></span>`;
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
  const anyChildHasScenes = group.children.some(c => c.hasScenes);
  const sceneChild = group.children.find(c => c.hasScenes);

  const groupSceneHtml = anyChildHasScenes
    ? `<div class="group-scene-picker">
        <button class="btn-scene-toggle" data-action="group-scene-expand" data-group="${group.groupId}"
          data-sku="${sceneChild.sku}" data-sample-device="${sceneChild.deviceId}">
          <span class="scene-icon">&#9733;</span> Scenes
        </button>
        <div class="group-scene-panel hidden" data-group-scene-panel="${group.groupId}">
          <input type="text" class="scene-search" placeholder="Search scenes..."
            data-action="group-scene-search" data-group="${group.groupId}">
          <div class="scene-list" data-group-scene-list="${group.groupId}">
            <span class="text-muted" style="font-size:0.75rem;">Loading...</span>
          </div>
        </div>
      </div>`
    : '';

  const childrenHtml = group.children.length > 0
    ? `<div class="child-devices" data-children-for="${group.groupId}">
        <div class="child-devices__header">
          <span class="child-devices__count">${group.children.length} device${group.children.length !== 1 ? 's' : ''}</span>
          <button class="child-devices__toggle" data-action="toggle-children" data-group="${group.groupId}" title="Show/hide devices">&#9662;</button>
        </div>
        <div class="child-devices__list" data-children-list="${group.groupId}">
          ${group.children.map(c => renderChildDevice(c)).join('')}
        </div>
      </div>`
    : '';

  return `
    <div class="lighting-group-card" data-group-id="${group.groupId}">
      <div class="lighting-group-card__header">
        <div class="lighting-group-card__title">
          <div class="lighting-group-card__name-row">
            <span class="status-dot status-dot--gray" data-group-dot="${group.groupId}" title="Loading..."></span>
            <span class="lighting-group-card__name">${group.name}</span>
          </div>
          ${group.deviceCount ? `<span class="lighting-group-card__devices">${group.deviceCount} ${group.deviceCount === 1 ? 'device' : 'devices'} · ${group.models}${lastContactTimes[group.groupId] ? ` · ${formatLastContact(group.groupId)}` : ''}</span>` : ''}
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

      ${groupSceneHtml}

      ${childrenHtml}

      <div class="group-status" data-status="${group.groupId}">
        <span>Loading status...</span>
      </div>
    </div>
  `;
}

function renderChildDevice(child) {
  const segmentBtn = child.hasSegments
    ? `<button class="child-extra-btn active" title="Segment colors"
        data-action="segment-expand" data-device="${child.deviceId}" data-sku="${child.sku}"
        data-segments="${child.segmentCount}">&#9783;</button>`
    : '';

  const sceneBtn = child.hasScenes
    ? `<button class="child-extra-btn" title="Scenes"
        data-action="scene-expand" data-device="${child.deviceId}" data-sku="${child.sku}">&#9733;</button>`
    : '';

  const musicBtn = child.hasMusicMode
    ? `<button class="child-extra-btn" title="Music mode"
        data-action="music-expand" data-device="${child.deviceId}" data-sku="${child.sku}">&#9835;</button>`
    : '';

  const gradientBtn = child.hasGradientToggle
    ? `<button class="child-extra-btn" title="Toggle gradient"
        data-action="gradient-toggle" data-device="${child.deviceId}" data-sku="${child.sku}">&#8776;</button>`
    : '';

  const hasExpanded = child.hasSegments || child.hasScenes || child.hasMusicMode;
  // Segment controls start expanded so dual-color Ring/Main is immediately visible
  const expandedHtml = hasExpanded
    ? `<div class="child-device-row__expanded${child.hasSegments ? '' : ' hidden'}" data-expanded-for="${child.deviceId}">
        ${child.hasSegments ? renderSegmentControls(child) : ''}
        ${child.hasScenes ? renderSceneSelector(child) : ''}
        ${child.hasMusicMode ? renderMusicModePanel(child) : ''}
      </div>`
    : '';

  return `
    <div class="child-device-row" data-device-id="${child.deviceId}" data-device-sku="${child.sku}">
      <div class="child-device-row__info">
        <div class="child-device-row__name-row">
          <span class="status-dot status-dot--gray" data-device-dot="${child.deviceId}" title="Loading..."></span>
          <span class="child-device-row__name">${child.name}</span>
        </div>
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
        ${segmentBtn}
        ${sceneBtn}
        ${musicBtn}
        ${gradientBtn}
      </div>
      ${expandedHtml}
    </div>
  `;
}

function renderSegmentControls(child) {
  const zones = getSegmentZones(child.sku, child.segmentCount);

  // Strip grid mode for devices with many segments (no predefined zone mapping)
  if (!zones && child.segmentCount > 2) {
    return renderStripSegmentGrid(child);
  }

  if (!zones) return '';

  return `
    <div class="segment-controls" data-segment-panel="${child.deviceId}">
      <div class="segment-zone-list">
        ${zones.map(z => `
          <div class="segment-zone">
            <div class="segment-zone__label" title="${z.description}">
              ${z.icon ? `<span class="segment-zone__icon">${z.icon}</span>` : ''}
              <span class="segment-zone__name">${z.name}</span>
            </div>
            <input type="color" value="#FFD4A3" class="segment-color-picker"
              data-action="segment-color" data-device="${child.deviceId}"
              data-sku="${child.sku}" data-segments='${JSON.stringify(z.segments)}'>
            <div class="segment-zone-presets">
              ${COLOR_PRESETS.map(p => `
                <button class="color-preset color-preset-tiny" title="${p.name}"
                  style="background:${p.hex}"
                  data-action="segment-preset" data-device="${child.deviceId}"
                  data-sku="${child.sku}" data-segments='${JSON.stringify(z.segments)}'
                  data-hex="${p.hex}" ${p.temp ? `data-temp="${p.temp}"` : ''}>
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderStripSegmentGrid(child) {
  const count = child.segmentCount;
  const segBtns = Array.from({ length: count }, (_, i) =>
    `<button class="strip-seg-btn" data-action="strip-seg-select" data-seg="${i}"
       data-device="${child.deviceId}" title="Segment ${i + 1}"
       style="background:#888">${i + 1}</button>`
  ).join('');

  return `
    <div class="strip-grid-controls" data-strip-panel="${child.deviceId}">
      <div class="strip-grid-controls__label">
        <span>Segments (${count})</span>
        <div class="strip-grid-controls__actions">
          <button class="btn-tiny" data-action="strip-select-all" data-device="${child.deviceId}" data-count="${count}">Select All</button>
          <button class="btn-tiny" data-action="strip-clear" data-device="${child.deviceId}">Clear</button>
          <button class="btn-tiny btn-rainbow" data-action="strip-rainbow" data-device="${child.deviceId}" data-sku="${child.sku}" data-count="${count}">🌈 Rainbow</button>
        </div>
      </div>
      <div class="strip-seg-grid" data-strip-grid="${child.deviceId}">
        ${segBtns}
      </div>
      <div class="strip-grid-color-row">
        <input type="color" value="#FF6600" data-strip-color="${child.deviceId}">
        <button class="btn-tiny" data-action="strip-apply-color" data-device="${child.deviceId}" data-sku="${child.sku}">Apply to Selected</button>
        <div class="color-presets">
          ${COLOR_PRESETS.map(p => `
            <button class="color-preset color-preset-tiny" title="${p.name}"
              style="background:${p.hex}"
              data-action="strip-color-preset" data-device="${child.deviceId}"
              data-sku="${child.sku}" data-hex="${p.hex}">
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderSceneSelector(child) {
  return `
    <div class="scene-selector" data-scene-panel="${child.deviceId}">
      <div class="scene-selector__label">Scenes</div>
      <div class="scene-selector__controls">
        <input type="text" class="scene-search" placeholder="Search scenes..."
          data-action="scene-search" data-device="${child.deviceId}">
        <div class="scene-list" data-scene-list="${child.deviceId}">
          <span class="text-muted" style="font-size:0.75rem;">Loading scenes...</span>
        </div>
      </div>
    </div>
  `;
}

function renderMusicModePanel(child) {
  // Use device-specific modes if available, otherwise fall back to defaults
  const modes = child.musicModeOptions.length > 0
    ? child.musicModeOptions.map(o => {
        const def = MUSIC_MODES.find(m => m.name === o.name || m.value === o.value);
        return { name: o.name, value: o.value, icon: def?.icon || '🎵' };
      })
    : MUSIC_MODES;

  return `
    <div class="music-mode-panel" data-music-panel="${child.deviceId}">
      <div class="music-mode-panel__label">Music Mode</div>
      <div class="music-mode-grid">
        ${modes.map(m => `
          <button class="music-mode-btn" data-action="activate-music"
            data-device="${child.deviceId}" data-sku="${child.sku}"
            data-mode="${m.value}" title="${m.name}">
            <span class="music-mode-btn__icon">${m.icon}</span>
            <span class="music-mode-btn__name">${m.name}</span>
          </button>
        `).join('')}
      </div>
      <div class="music-mode-controls">
        <div class="music-sensitivity">
          <label>Sensitivity</label>
          <input type="range" min="0" max="100" value="80"
            data-action="music-sensitivity" data-device="${child.deviceId}" data-sku="${child.sku}">
          <span data-music-sens-label="${child.deviceId}">80%</span>
        </div>
      </div>
    </div>
  `;
}

// =============================================
// SCENE PANEL EXPANSION
// =============================================
async function expandDeviceScenePanel(deviceId, sku) {
  const listEl = document.querySelector(`[data-scene-list="${deviceId}"]`);
  if (!listEl || listEl.dataset.loaded) return;

  listEl.innerHTML = '<span class="text-muted" style="font-size:0.75rem;">Loading scenes...</span>';
  const scenes = await fetchScenesForSku(sku, deviceId);
  listEl.dataset.loaded = 'true';

  if (scenes.length === 0) {
    listEl.innerHTML = '<span class="text-muted" style="font-size:0.75rem;">No scenes available</span>';
    return;
  }

  listEl.innerHTML = scenes.map(s => `
    <button class="scene-chip" data-action="activate-scene"
      data-device="${deviceId}" data-sku="${sku}"
      data-scene-value='${JSON.stringify(s.value)}'
      data-scene-name="${s.name}">
      ${s.name}
    </button>
  `).join('');
}

async function expandGroupScenePanel(groupId, sku, sampleDeviceId) {
  const listEl = document.querySelector(`[data-group-scene-list="${groupId}"]`);
  if (!listEl || listEl.dataset.loaded) return;

  listEl.innerHTML = '<span class="text-muted" style="font-size:0.75rem;">Loading scenes...</span>';
  const scenes = await fetchScenesForSku(sku, sampleDeviceId);
  listEl.dataset.loaded = 'true';

  if (scenes.length === 0) {
    listEl.innerHTML = '<span class="text-muted" style="font-size:0.75rem;">No scenes available</span>';
    return;
  }

  listEl.innerHTML = scenes.map(s => `
    <button class="scene-chip" data-action="activate-group-scene"
      data-group="${groupId}"
      data-scene-value='${JSON.stringify(s.value)}'
      data-scene-name="${s.name}">
      ${s.name}
    </button>
  `).join('');
}

function filterScenes(listSelector, query) {
  const listEl = document.querySelector(listSelector);
  if (!listEl) return;
  const chips = listEl.querySelectorAll('.scene-chip');
  const q = query.toLowerCase();
  chips.forEach(chip => {
    chip.style.display = chip.dataset.sceneName.toLowerCase().includes(q) ? '' : 'none';
  });
}

// Auto-load scenes for devices whose expanded panels start visible
// Fetches once per SKU, then populates all devices of that SKU from cache
async function autoLoadVisibleScenes() {
  const skusFetched = new Set();
  const devicesToPopulate = [];

  // Collect all devices with segments (panels start expanded) that also have scenes
  for (const group of goveeGroups) {
    for (const child of group.children) {
      if (child.hasSegments && child.hasScenes) {
        devicesToPopulate.push(child);
      }
    }
  }

  // Also pre-fetch scenes by SKU for all scene-capable devices (for faster ★ button response)
  const allSceneSkus = new Set();
  for (const group of goveeGroups) {
    for (const child of group.children) {
      if (child.hasScenes) allSceneSkus.add(child.sku);
    }
  }

  if (devicesToPopulate.length === 0) return;

  // Fetch scenes for each unique SKU (only once per SKU)
  for (const child of devicesToPopulate) {
    if (!skusFetched.has(child.sku)) {
      skusFetched.add(child.sku);
      await fetchScenesWithDbFallback(child.sku, child.deviceId);
      await sleep(300);
    }
  }

  // Pre-fetch remaining scene SKUs in background (so ★ button is instant)
  for (const sku of allSceneSkus) {
    if (!skusFetched.has(sku)) {
      skusFetched.add(sku);
      const sampleChild = goveeGroups.flatMap(g => g.children).find(c => c.sku === sku);
      if (sampleChild) {
        fetchScenesWithDbFallback(sku, sampleChild.deviceId).catch(() => {}); // fire and forget
        await sleep(300);
      }
    }
  }

  // Now populate all device scene panels from cache
  for (const child of devicesToPopulate) {
    await expandDeviceScenePanel(child.deviceId, child.sku);
  }
}

// Try edge function first, fall back to reading DB cache directly
async function fetchScenesWithDbFallback(sku, sampleDeviceId) {
  if (sceneCache[sku]) return sceneCache[sku];

  try {
    // Try edge function (which checks its own DB cache)
    const result = await goveeApi('getScenes', { sku, device: sampleDeviceId });
    sceneCache[sku] = result.scenes || [];
    return sceneCache[sku];
  } catch (err) {
    console.warn(`Edge function scene fetch failed for ${sku}, trying DB cache:`, err.message);
  }

  // Fallback: read directly from govee_scene_cache table
  try {
    const { data } = await supabase
      .from('govee_scene_cache')
      .select('scenes')
      .eq('sku', sku)
      .single();
    if (data?.scenes) {
      sceneCache[sku] = data.scenes;
      return sceneCache[sku];
    }
  } catch (err) {
    console.warn(`DB cache fallback failed for ${sku}:`, err.message);
  }

  return [];
}

// =============================================
// GROUP UI UPDATE
// =============================================
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

  // Update status dot
  const dot = card.querySelector(`[data-group-dot="${groupId}"]`);
  if (dot) {
    dot.className = 'status-dot ' + getStatusDotClass(state);
    dot.title = getStatusDotTitle(state);
  }

  // Update group toggle (specific selector avoids matching child device toggles)
  const toggle = card.querySelector(`input[data-action="toggle"][data-group="${groupId}"]`);
  if (toggle) toggle.checked = !!state.on;

  // Update group brightness (specific selector avoids matching child device sliders)
  const slider = card.querySelector(`input[data-action="brightness"][data-group="${groupId}"]`);
  const label = card.querySelector(`[data-brightness-label="${groupId}"]`);
  if (slider && state.brightness != null) {
    slider.value = state.brightness;
  }
  if (label) {
    label.textContent = state.brightness != null ? `${state.brightness}%` : '—';
  }

  // Update color picker
  const colorInput = card.querySelector(`input[data-action="color"][data-group="${groupId}"]`);
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
  const contactStr = lastContactTimes[groupId] ? ` · ${formatLastContact(groupId)}` : '';

  if (state.disconnected) {
    statusEl.innerHTML = `<span>Disconnected${contactStr}</span>`;
    statusEl.className = 'group-status disconnected';
    return;
  }

  if (state.on === undefined) {
    statusEl.innerHTML = '<span>Status unknown</span>';
    statusEl.className = 'group-status';
    return;
  }

  const colorSwatch = state.color
    ? `<span class="color-swatch-label"><span class="color-swatch" style="background:${state.color}"></span>Color</span>`
    : '';

  if (state.on) {
    const brightnessStr = state.brightness != null ? ` @ ${state.brightness}%` : '';
    const tempStr = state.colorTemp ? ` ${state.colorTemp}K` : '';
    statusEl.innerHTML = `<span>On${brightnessStr}${tempStr}</span>${colorSwatch}`;
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
  const unifiedContainer = document.getElementById('unifiedLightingGroups');
  const container = document.getElementById('lightingGroups');
  if (!container && !unifiedContainer) return;

  if (unifiedContainer) {
    unifiedContainer.addEventListener('change', (e) => {
      const target = e.target;
      const { action, groupKey } = target.dataset || {};
      if (action === 'unified-toggle' && groupKey) {
        controlUnifiedGroup(groupKey, 'set_power', { on: !!target.checked })
          .catch(err => showToast(`Room control failed: ${err.message}`, 'error'));
      }
    });

    unifiedContainer.addEventListener('input', (e) => {
      const target = e.target;
      const { action, groupKey } = target.dataset || {};
      if (action === 'unified-brightness' && groupKey) {
        clearTimeout(brightnessTimers[`unified_${groupKey}`]);
        brightnessTimers[`unified_${groupKey}`] = setTimeout(() => {
          controlUnifiedGroup(groupKey, 'set_brightness', { brightness: parseInt(target.value, 10) })
            .catch(err => showToast(`Room brightness failed: ${err.message}`, 'error'));
        }, 400);
      }
      if (action === 'unified-color' && groupKey) {
        clearTimeout(colorTimers[`unified_${groupKey}`]);
        colorTimers[`unified_${groupKey}`] = setTimeout(() => {
          controlUnifiedGroup(groupKey, 'set_color', { hex_color: target.value })
            .catch(err => showToast(`Room color failed: ${err.message}`, 'error'));
        }, 400);
      }
    });

    unifiedContainer.addEventListener('click', (e) => {
      const preset = e.target.closest('[data-action="unified-preset"]');
      if (!preset) return;
      const { groupKey, hex } = preset.dataset;
      if (!groupKey || !hex) return;
      const input = unifiedContainer.querySelector(`input[data-action="unified-color"][data-group-key="${groupKey}"]`);
      if (input) input.value = hex;
      controlUnifiedGroup(groupKey, 'set_color', { hex_color: hex })
        .catch(err => showToast(`Room color failed: ${err.message}`, 'error'));
    });
  }

  // Event delegation for all controls
  container?.addEventListener('change', (e) => {
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
  container?.addEventListener('input', (e) => {
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

    // Segment color picker (debounced)
    if (action === 'segment-color' && device && sku) {
      const segments = JSON.parse(e.target.dataset.segments);
      const key = `seg_${device}_${segments.join(',')}`;
      clearTimeout(colorTimers[key]);
      colorTimers[key] = setTimeout(() => {
        setSegmentColor(device, sku, segments, e.target.value);
      }, 400);
    }

    // Scene search filtering (device)
    if (action === 'scene-search' && device) {
      filterScenes(`[data-scene-list="${device}"]`, e.target.value);
    }

    // Scene search filtering (group)
    if (action === 'group-scene-search') {
      const groupId = e.target.dataset.group;
      if (groupId) filterScenes(`[data-group-scene-list="${groupId}"]`, e.target.value);
    }
  });

  // Click handlers
  container?.addEventListener('click', (e) => {
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
        toggleBtn.innerHTML = isExpanded ? '&#9652;' : '&#9662;';
        toggleBtn.title = isExpanded ? 'Hide devices' : 'Show devices';
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

    // Segment expand/collapse toggle
    const segExpand = e.target.closest('[data-action="segment-expand"]');
    if (segExpand) {
      const deviceId = segExpand.dataset.device;
      const expandedPanel = container.querySelector(`[data-expanded-for="${deviceId}"]`);
      if (expandedPanel) {
        const isHidden = expandedPanel.classList.toggle('hidden');
        segExpand.classList.toggle('active', !isHidden);
      }
      return;
    }

    // Scene expand/collapse toggle (device)
    const sceneExpand = e.target.closest('[data-action="scene-expand"]');
    if (sceneExpand) {
      const { device, sku } = sceneExpand.dataset;
      const expandedPanel = container.querySelector(`[data-expanded-for="${device}"]`);
      if (expandedPanel) {
        const isHidden = expandedPanel.classList.toggle('hidden');
        sceneExpand.classList.toggle('active', !isHidden);
        if (!isHidden) {
          expandDeviceScenePanel(device, sku);
        }
      }
      return;
    }

    // Segment preset button
    const segPreset = e.target.closest('[data-action="segment-preset"]');
    if (segPreset) {
      const { device, sku, segments, hex, temp } = segPreset.dataset;
      const parsedSegs = JSON.parse(segments);
      if (temp) {
        // For segment temp, we use the whole-device color temp
        // (segments don't support color temp individually)
        setDeviceColorTemp(device, sku, parseInt(temp));
      } else {
        setSegmentColor(device, sku, parsedSegs, hex);
      }
      // Update the zone color picker to match
      const zoneRow = segPreset.closest('.segment-zone');
      const picker = zoneRow?.querySelector('.segment-color-picker');
      if (picker) picker.value = hex;
      return;
    }

    // Activate scene (device)
    const sceneChip = e.target.closest('[data-action="activate-scene"]');
    if (sceneChip) {
      const { device, sku, sceneValue, sceneName } = sceneChip.dataset;
      activateScene(device, sku, JSON.parse(sceneValue), sceneName);
      // Highlight active scene
      sceneChip.closest('.scene-list')?.querySelectorAll('.scene-chip')
        .forEach(c => c.classList.remove('active'));
      sceneChip.classList.add('active');
      return;
    }

    // Group scene expand/collapse
    const groupSceneExpand = e.target.closest('[data-action="group-scene-expand"]');
    if (groupSceneExpand) {
      const { group, sku, sampleDevice } = groupSceneExpand.dataset;
      const panel = container.querySelector(`[data-group-scene-panel="${group}"]`);
      if (panel) {
        const isHidden = panel.classList.toggle('hidden');
        groupSceneExpand.classList.toggle('active', !isHidden);
        if (!isHidden) {
          expandGroupScenePanel(group, sku, sampleDevice);
        }
      }
      return;
    }

    // Activate group scene
    const groupSceneChip = e.target.closest('[data-action="activate-group-scene"]');
    if (groupSceneChip) {
      const { group, sceneValue, sceneName } = groupSceneChip.dataset;
      activateGroupScene(group, JSON.parse(sceneValue), sceneName);
      groupSceneChip.closest('.scene-list')?.querySelectorAll('.scene-chip')
        .forEach(c => c.classList.remove('active'));
      groupSceneChip.classList.add('active');
      return;
    }

    // Music mode expand/collapse
    const musicExpand = e.target.closest('[data-action="music-expand"]');
    if (musicExpand) {
      const deviceId = musicExpand.dataset.device;
      const expandedPanel = container.querySelector(`[data-expanded-for="${deviceId}"]`);
      if (expandedPanel) {
        const isHidden = expandedPanel.classList.toggle('hidden');
        musicExpand.classList.toggle('active', !isHidden);
      }
      return;
    }

    // Activate music mode
    const musicBtn = e.target.closest('[data-action="activate-music"]');
    if (musicBtn) {
      const { device, sku, mode } = musicBtn.dataset;
      const sensitivityInput = container.querySelector(`input[data-action="music-sensitivity"][data-device="${device}"]`);
      const sensitivity = sensitivityInput ? parseInt(sensitivityInput.value) : 80;
      setMusicMode(device, sku, parseInt(mode), sensitivity);
      // Highlight active
      musicBtn.closest('.music-mode-grid')?.querySelectorAll('.music-mode-btn')
        .forEach(b => b.classList.remove('active'));
      musicBtn.classList.add('active');
      return;
    }

    // Gradient toggle
    const gradientToggleBtn = e.target.closest('[data-action="gradient-toggle"]');
    if (gradientToggleBtn) {
      const { device, sku } = gradientToggleBtn.dataset;
      const isActive = gradientToggleBtn.classList.toggle('active');
      toggleGradient(device, sku, isActive);
      return;
    }

    // Strip segment select
    const stripSegBtn = e.target.closest('[data-action="strip-seg-select"]');
    if (stripSegBtn) {
      stripSegBtn.classList.toggle('selected');
      return;
    }

    // Strip select all
    const stripSelectAll = e.target.closest('[data-action="strip-select-all"]');
    if (stripSelectAll) {
      const deviceId = stripSelectAll.dataset.device;
      container.querySelectorAll(`.strip-seg-btn[data-device="${deviceId}"]`)
        .forEach(b => b.classList.add('selected'));
      return;
    }

    // Strip clear selection
    const stripClear = e.target.closest('[data-action="strip-clear"]');
    if (stripClear) {
      const deviceId = stripClear.dataset.device;
      container.querySelectorAll(`.strip-seg-btn[data-device="${deviceId}"]`)
        .forEach(b => b.classList.remove('selected'));
      return;
    }

    // Strip rainbow
    const stripRainbow = e.target.closest('[data-action="strip-rainbow"]');
    if (stripRainbow) {
      const { device, sku, count } = stripRainbow.dataset;
      applyRainbow(device, sku, parseInt(count));
      return;
    }

    // Strip apply color to selected segments
    const stripApply = e.target.closest('[data-action="strip-apply-color"]');
    if (stripApply) {
      const { device, sku } = stripApply.dataset;
      const colorInput = container.querySelector(`[data-strip-color="${device}"]`);
      const hex = colorInput?.value || '#FF6600';
      const selected = [...container.querySelectorAll(`.strip-seg-btn[data-device="${device}"].selected`)]
        .map(b => parseInt(b.dataset.seg));
      if (selected.length === 0) {
        showToast('Select segments first', 'info', 1500);
        return;
      }
      setStripSegmentColors(device, sku, selected, hex);
      // Update button backgrounds
      selected.forEach(seg => {
        const btn = container.querySelector(`.strip-seg-btn[data-device="${device}"][data-seg="${seg}"]`);
        if (btn) btn.style.background = hex;
      });
      return;
    }

    // Strip color preset
    const stripPreset = e.target.closest('[data-action="strip-color-preset"]');
    if (stripPreset) {
      const { device, sku, hex } = stripPreset.dataset;
      const colorInput = container.querySelector(`[data-strip-color="${device}"]`);
      if (colorInput) colorInput.value = hex;
      const selected = [...container.querySelectorAll(`.strip-seg-btn[data-device="${device}"].selected`)]
        .map(b => parseInt(b.dataset.seg));
      if (selected.length > 0) {
        setStripSegmentColors(device, sku, selected, hex);
        selected.forEach(seg => {
          const btn = container.querySelector(`.strip-seg-btn[data-device="${device}"][data-seg="${seg}"]`);
          if (btn) btn.style.background = hex;
        });
      }
      return;
    }
  });

  // Music sensitivity label update
  container?.addEventListener('input', (e) => {
    const { action, device } = e.target.dataset;
    if (action === 'music-sensitivity' && device) {
      const label = container.querySelector(`[data-music-sens-label="${device}"]`);
      if (label) label.textContent = `${e.target.value}%`;
    }
  }, true); // use capture to not interfere with existing input handler

  // All Off button
  document.getElementById('allOffBtn')?.addEventListener('click', () => {
    if (confirm('Turn off all lighting groups?')) {
      allOff();
    }
  });

  document.getElementById('allUnifiedOffBtn')?.addEventListener('click', () => {
    if (confirm('Turn off all unified room groups?')) {
      allUnifiedOff();
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

  document.getElementById('refreshUnifiedBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshUnifiedBtn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    await refreshUnifiedStates();
    btn.disabled = false;
    btn.textContent = 'Refresh Rooms';
    showToast('Unified room states refreshed', 'info', 1500);
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

  // Sync Capabilities button (admin-only)
  document.getElementById('syncCapabilitiesBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('syncCapabilitiesBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      const result = await goveeApi('syncCapabilities');
      showToast(`Synced ${result.synced}/${result.total} device capabilities`, 'success');
    } catch (err) {
      showToast(`Sync failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync Capabilities';
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
    // Double-check popover is still valid and connected before AND during style access
    if (!popover || !popover.isConnected || !popover.style) return;
    try {
      const popRect = popover.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) {
        // Re-check before style access to prevent race condition
        if (popover && popover.isConnected && popover.style) {
          popover.style.left = `${window.innerWidth - popRect.width - 8}px`;
        }
      }
    } catch (err) {
      // Popover was removed before RAF callback executed
      console.debug('Popover positioning skipped - element removed');
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

// Map PAI color names to hex (mirrors COLOR_MAP in alpaca-pai)
function paiColorToHex(value) {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  const map = {
    red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff',
    yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ff69b7',
    cyan: '#00ffff', magenta: '#ff00ff', warm: '#fff3a5', cool: '#e1e1ff',
  };
  if (map[lower]) return map[lower];
  // Check hex input
  if (/^#?[0-9a-f]{6}$/i.test(lower)) return lower.startsWith('#') ? lower : '#' + lower;
  return null;
}

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
