/**
 * Sensors Page — UP-SENSE environment sensor display with live data.
 * Loads sensor metadata from protect_sensors table, then fetches live
 * readings from the ptz-proxy and polls every 30s.
 */

import { initResidentPage } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

const SENSORS_PROXY = 'https://cam.alpacaplayhouse.com/sensors';
const POLL_INTERVAL = 30000;

const ICONS = {
  temperature: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  humidity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  door: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h11a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><circle cx="14" cy="12" r="1"/></svg>',
  motion: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v8"/><path d="M13 8v12"/><path d="M7 16v4"/><path d="M4 12v8"/></svg>',
  battery: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"/><line x1="23" y1="13" x2="23" y2="11"/></svg>',
};

let sensors = [];
let pollTimer = null;
let lastPollTime = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'sensors',
    requiredRole: 'resident',
    onReady: async () => {
      await loadSensors();
      render();
      startPolling();
    },
  });
});

async function loadSensors() {
  const { data, error } = await supabase
    .from('protect_sensors')
    .select('*')
    .eq('is_active', true)
    .order('display_order');

  if (error || !data?.length) {
    sensors = [];
    return;
  }

  // Fetch live state from proxy
  const states = await fetchSensorStates();
  sensors = data.map(meta => ({
    meta,
    state: states.find(s => s.id === meta.protect_sensor_id) || null,
  }));
}

async function fetchSensorStates() {
  try {
    const resp = await fetch(SENSORS_PROXY);
    if (!resp.ok) throw new Error(resp.status);
    lastPollTime = new Date();
    return await resp.json();
  } catch (err) {
    console.warn('Sensor fetch failed:', err.message);
    return [];
  }
}

async function refreshStates() {
  if (!sensors.length) return;
  const states = await fetchSensorStates();
  for (const s of sensors) {
    const live = states.find(st => st.id === s.meta.protect_sensor_id);
    if (live) s.state = live;
  }
}

function startPolling() {
  if (!sensors.length) return;
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    await refreshStates();
    render();
  }, POLL_INTERVAL);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sensors.length) {
      refreshStates().then(render);
    }
  });
}

// --- Helpers ---

function tempF(state) {
  const c = state?.stats?.temperature?.value ?? null;
  if (c == null) return '--';
  return ((c * 9 / 5) + 32).toFixed(1);
}

function humidity(state) {
  return state?.stats?.humidity?.value ?? '--';
}

function lightVal(state) {
  return state?.stats?.light?.value ?? '--';
}

// --- Rendering ---

function render() {
  const grid = document.getElementById('sensorsGrid');
  const empty = document.getElementById('sensorsEmpty');
  const meta = document.getElementById('sensorsMeta');

  if (!sensors.length) {
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = '';
    if (meta) meta.textContent = '0 sensors';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (meta) {
    const timeStr = lastPollTime
      ? lastPollTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    meta.textContent = `${sensors.length} sensor${sensors.length !== 1 ? 's' : ''}${timeStr ? ` \u00b7 Updated ${timeStr}` : ''}`;
  }
  if (grid) grid.innerHTML = sensors.map(renderCard).join('');
}

function renderCard({ meta, state }) {
  if (!state) {
    return `<div class="sensor-card sensor-card--offline">
      <div class="sensor-card__header">
        <span class="status-dot status-offline"></span>
        <span class="sensor-card__name">${esc(meta.name)}</span>
        ${meta.location ? `<span class="sensor-card__location">${esc(meta.location)}</span>` : ''}
      </div>
      <div class="sensor-card__body">
        <span class="text-muted" style="font-size:0.85rem">Sensor offline</span>
      </div>
    </div>`;
  }

  const temp = tempF(state);
  const hum = humidity(state);
  const lux = lightVal(state);
  const isConnected = state.isConnected !== false;
  const batteryPct = state.batteryStatus?.percentage ?? '--';
  const batteryLow = state.batteryStatus?.isLow;
  const isOpen = state.isOpened;
  const isMotion = state.isMotionDetected;
  const showDoor = meta.mount_type === 'door' || meta.mount_type === 'window' || isOpen != null;
  const hasAlarm = state.alarmTriggeredAt &&
    (Date.now() - new Date(state.alarmTriggeredAt).getTime()) < 300000;

  return `<div class="sensor-card ${hasAlarm ? 'sensor-card--alarm' : ''} ${!isConnected ? 'sensor-card--offline' : ''}">
    <div class="sensor-card__header">
      <span class="status-dot ${isConnected ? 'status-live' : 'status-offline'}"></span>
      <span class="sensor-card__name">${esc(meta.name)}</span>
      ${meta.location ? `<span class="sensor-card__location">${esc(meta.location)}</span>` : ''}
      <span class="sensor-card__battery ${batteryLow ? 'battery-low' : ''}">
        ${ICONS.battery} ${batteryPct}%
      </span>
    </div>
    <div class="sensor-card__body">
      <div class="sensor-card__readings">
        <div class="sensor-reading">
          <span class="sensor-reading__icon">${ICONS.temperature}</span>
          <span class="sensor-reading__value">${temp}</span>
          <span class="sensor-reading__unit">&deg;F</span>
        </div>
        <div class="sensor-reading">
          <span class="sensor-reading__icon">${ICONS.humidity}</span>
          <span class="sensor-reading__value">${hum}</span>
          <span class="sensor-reading__unit">%</span>
        </div>
        <div class="sensor-reading">
          <span class="sensor-reading__icon">${ICONS.light}</span>
          <span class="sensor-reading__value">${lux}</span>
          <span class="sensor-reading__unit">lux</span>
        </div>
      </div>
      <div class="sensor-card__statuses">
        ${showDoor ? `<span class="sensor-badge ${isOpen ? 'sensor-badge--open' : 'sensor-badge--closed'}">
          ${ICONS.door} ${isOpen ? 'Open' : 'Closed'}
        </span>` : ''}
        <span class="sensor-badge ${isMotion ? 'sensor-badge--motion' : 'sensor-badge--clear'}">
          ${ICONS.motion} ${isMotion ? 'Motion' : 'Clear'}
        </span>
      </div>
    </div>
  </div>`;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
