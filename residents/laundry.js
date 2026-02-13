/**
 * Laundry Page - LG washer/dryer monitoring with live status from lg_appliances table.
 * Poller on DO droplet writes appliance state; this page reads it every 15s.
 */

import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { hasPermission } from '../shared/auth.js';
import { getResidentDeviceScope } from '../shared/services/resident-device-scope.js';
import { PollManager } from '../shared/services/poll-manager.js';
import { supabaseHealth } from '../shared/supabase-health.js';

// =============================================
// CONFIGURATION
// =============================================
const POLL_INTERVAL_MS = 15000; // 15s (laundry status changes fast)

// =============================================
// STATE
// =============================================
let appliances = [];
let watchedAppliances = new Set();
let poll = null;
let countdownTimer = null;
let currentUserRole = null;
let currentAppUserId = null;
let deviceScope = null;
let loadFailed = false; // distinguish query error from legitimately empty

// =============================================
// SVG ICONS
// =============================================
const WASHER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="2" width="20" height="20" rx="2"/>
  <circle cx="12" cy="14" r="5"/>
  <circle cx="12" cy="14" r="2.5" stroke-dasharray="3 2"/>
  <circle cx="6" cy="5.5" r="1" fill="currentColor" stroke="none"/>
  <circle cx="9" cy="5.5" r="1" fill="currentColor" stroke="none"/>
  <line x1="14" y1="5.5" x2="20" y2="5.5"/>
</svg>`;

const DRYER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="2" width="20" height="20" rx="2"/>
  <circle cx="12" cy="14" r="5"/>
  <path d="M10 12 C10 13 11 14.5 12 14.5 S14 13 14 12 S13 10.5 12 10.5 S10 12 10 12" stroke-width="1.2"/>
  <circle cx="6" cy="5.5" r="1" fill="currentColor" stroke="none"/>
  <circle cx="9" cy="5.5" r="1" fill="currentColor" stroke="none"/>
  <line x1="14" y1="5.5" x2="20" y2="5.5"/>
</svg>`;

const BELL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

// =============================================
// HELPERS
// =============================================
const RUNNING_STATES = new Set([
  'RUNNING', 'RINSING', 'SPINNING', 'DRYING',
  'STEAM_SOFTENING', 'COOL_DOWN', 'DETECTING',
  'REFRESHING', 'RINSE_HOLD',
]);

function formatTimeRemaining(hours, minutes) {
  const h = hours || 0;
  const m = minutes || 0;
  if (h === 0 && m === 0) return '';
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSyncTime(lastSyncedAt) {
  if (!lastSyncedAt) return 'Never synced';
  const diff = Date.now() - new Date(lastSyncedAt).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return new Date(lastSyncedAt).toLocaleDateString();
}

function getStateDisplay(appliance) {
  const s = appliance.last_state || {};
  const state = s.currentState || 'POWER_OFF';

  if (state === 'POWER_OFF' || state === 'SLEEP') return { text: 'Off', color: 'var(--text-muted)', isRunning: false, isDone: false };
  if (state === 'END') return { text: 'Done!', color: '#f59e0b', isRunning: false, isDone: true };
  if (state === 'PAUSE') return { text: 'Paused', color: '#f59e0b', isRunning: false, isDone: false };
  if (state === 'ERROR') return { text: 'Error', color: 'var(--occupied)', isRunning: false, isDone: false };
  if (state === 'RESERVED') return { text: 'Scheduled', color: '#8b5cf6', isRunning: false, isDone: false };
  if (state === 'INITIAL' || state === 'DETECTING') return { text: 'Starting...', color: 'var(--available)', isRunning: true, isDone: false };

  if (RUNNING_STATES.has(state)) {
    if (state === 'RINSING') return { text: 'Rinsing', color: 'var(--available)', isRunning: true, isDone: false };
    if (state === 'SPINNING') return { text: 'Spinning', color: 'var(--available)', isRunning: true, isDone: false };
    if (state === 'DRYING') return { text: 'Drying', color: 'var(--available)', isRunning: true, isDone: false };
    if (state === 'STEAM_SOFTENING') return { text: 'Steam Softening', color: 'var(--available)', isRunning: true, isDone: false };
    if (state === 'COOL_DOWN') return { text: 'Cooling Down', color: 'var(--available)', isRunning: true, isDone: false };
    const label = appliance.device_type === 'dryer' ? 'Drying' : 'Washing';
    return { text: `${label}...`, color: 'var(--available)', isRunning: true, isDone: false };
  }

  return { text: state, color: 'var(--text-muted)', isRunning: false, isDone: false };
}

function getProgressPercent(state) {
  if (!state) return 0;
  const totalMin = (state.totalHour || 0) * 60 + (state.totalMinute || 0);
  const remainMin = (state.remainHour || 0) * 60 + (state.remainMinute || 0);
  if (totalMin <= 0) return 0;
  const elapsed = totalMin - remainMin;
  return Math.max(0, Math.min(100, Math.round((elapsed / totalMin) * 100)));
}

// =============================================
// DATA LOADING
// =============================================
async function loadAppliances() {
  const { data, error } = await supabase
    .from('lg_appliances')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.warn('Failed to load appliances:', error.message);
    loadFailed = true;
    supabaseHealth.recordFailure();
    throw error; // let PollManager circuit breaker track failures
  }
  loadFailed = false;
  supabaseHealth.recordSuccess();
  appliances = (data || []).filter((appliance) => {
    if (!deviceScope || deviceScope.fullAccess) return true;
    return deviceScope.canAccessSpaceId(appliance.space_id)
      || deviceScope.canAccessSpaceName(appliance.space_name)
      || deviceScope.canAccessSpaceName(appliance.location)
      || deviceScope.canAccessSpaceName(appliance.name);
  });
}

async function loadWatcherStatus() {
  if (!currentAppUserId) return;
  const { data, error } = await supabase
    .from('laundry_watchers')
    .select('appliance_id')
    .eq('app_user_id', currentAppUserId);

  if (error) {
    console.warn('Failed to load watcher status:', error.message);
    return;
  }
  watchedAppliances = new Set((data || []).map(w => w.appliance_id));
}

// =============================================
// RENDERING
// =============================================
function renderAppliances() {
  const grid = document.getElementById('laundryGrid');
  const empty = document.getElementById('laundryEmpty');
  if (!grid) return;

  if (!appliances.length) {
    if (loadFailed) {
      grid.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">
        <p>Unable to load appliance data. Check your connection and try again.</p>
      </div>`;
      if (empty) empty.classList.add('hidden');
    } else {
      grid.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
    }
    return;
  }
  if (empty) empty.classList.add('hidden');

  grid.innerHTML = appliances.map((a, i) => {
    const state = getStateDisplay(a);
    const s = a.last_state || {};
    const progress = getProgressPercent(s);
    const timeStr = formatTimeRemaining(s.remainHour, s.remainMinute);
    const watching = watchedAppliances.has(a.id);
    const icon = a.device_type === 'dryer' ? DRYER_ICON : WASHER_ICON;
    const stateClass = state.isRunning ? 'running' : state.isDone ? 'done' : '';

    return `
      <div class="laundry-card ${stateClass}" data-appliance-id="${a.id}">
        <div class="laundry-card__header">
          <div class="laundry-card__icon">${icon}</div>
          <div class="laundry-card__name">${a.name}</div>
          <span class="laundry-card__status-dot" style="background:${state.color}"></span>
        </div>

        <div class="laundry-card__state" style="color:${state.color}">${state.text}</div>

        ${state.isRunning ? `
          <div class="laundry-card__progress">
            <div class="laundry-card__progress-bar" style="width:${progress}%"></div>
          </div>
        ` : ''}

        ${state.isRunning && timeStr ? `
          <div class="laundry-card__time" data-remain-h="${s.remainHour || 0}" data-remain-m="${s.remainMinute || 0}">
            ${timeStr} remaining
          </div>
        ` : ''}

        ${state.isDone ? `
          <div class="laundry-card__time laundry-card__time--done">
            Cycle complete
          </div>
        ` : ''}

        <div class="laundry-card__data-grid">
          <div class="laundry-data-row">
            <span class="laundry-data-label">Remote Control</span>
            <span class="laundry-data-value">${s.remoteControlEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          ${a.model ? `
          <div class="laundry-data-row">
            <span class="laundry-data-label">Model</span>
            <span class="laundry-data-value">${a.model}</span>
          </div>
          ` : ''}
        </div>

        <div class="laundry-card__controls">
          <button class="laundry-watch-btn ${watching ? 'active' : ''}"
                  onclick="window._toggleWatch(${a.id})"
                  title="${watching ? 'Stop watching' : 'Get notified when this cycle ends'}">
            ${BELL_ICON}
            <span>${watching ? 'Watching' : 'Notify When Done'}</span>
          </button>
        </div>

        <div class="laundry-card__sync-time">${formatSyncTime(a.last_synced_at)}</div>
      </div>
    `;
  }).join('');
}

// =============================================
// WATCH / UNWATCH
// =============================================
window._toggleWatch = async function(applianceId) {
  const isWatching = watchedAppliances.has(applianceId);
  const action = isWatching ? 'unwatch' : 'watch';

  try {
    const { data, error } = await supabase.functions.invoke('lg-control', {
      body: { action, applianceId },
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    if (action === 'watch') {
      watchedAppliances.add(applianceId);
      showToast("You'll be notified when this cycle ends!", 'success');
    } else {
      watchedAppliances.delete(applianceId);
      showToast('Notification cancelled', 'info');
    }
    renderAppliances();
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
};

// =============================================
// URL PARAMETER HANDLING (?watch=washer or ?watch=dryer)
// =============================================
async function handleWatchParam() {
  const params = new URLSearchParams(window.location.search);
  const watchType = params.get('watch');
  if (!watchType || !currentAppUserId) return;

  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);

  const target = appliances.find(a => a.device_type === watchType);
  if (!target) {
    showToast(`No ${watchType} found`, 'error');
    return;
  }

  if (watchedAppliances.has(target.id)) {
    showToast(`Already watching the ${watchType}`, 'info');
    return;
  }

  await window._toggleWatch(target.id);
}

// =============================================
// COUNTDOWN TIMER (client-side interpolation)
// =============================================
function startCountdown() {
  stopCountdown();
  countdownTimer = setInterval(() => {
    const timeEls = document.querySelectorAll('.laundry-card__time[data-remain-h]');
    timeEls.forEach(el => {
      let h = parseInt(el.dataset.remainH) || 0;
      let m = parseInt(el.dataset.remainM) || 0;
      const totalSec = h * 3600 + m * 60 - 1;
      if (totalSec <= 0) return;
      const newH = Math.floor(totalSec / 3600);
      const newM = Math.floor((totalSec % 3600) / 60);
      el.dataset.remainH = newH;
      el.dataset.remainM = newM;
      const display = newH > 0 ? `${newH}h ${newM}m` : `${newM}m`;
      el.textContent = `${display} remaining`;
    });
  }, 60000); // Update every minute
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// =============================================
// POLLING (via PollManager with circuit breaker)
// =============================================
async function refreshFromDB() {
  await loadAppliances();
  await loadWatcherStatus();
  renderAppliances();
}

// =============================================
// ADMIN SETTINGS
// =============================================
async function renderAdminSettings() {
  const container = document.getElementById('lgSettingsContent');
  if (!container) return;

  const { data: config } = await supabase
    .from('lg_config')
    .select('*')
    .eq('id', 1)
    .single();

  const c = config || {};
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem;max-width:600px;">
      <div>
        <label style="font-weight:600;display:block;margin-bottom:0.25rem;">LG ThinQ PAT</label>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem;">
          Generate at <a href="https://connect-pat.lgthinq.com/" target="_blank" rel="noopener">connect-pat.lgthinq.com</a>
        </p>
        <input type="password" id="lgPatInput" value="${c.pat || ''}"
               placeholder="Paste your Personal Access Token"
               style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:var(--radius);font-size:0.9rem;">
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <label style="font-weight:600;">Test Mode</label>
        <input type="checkbox" id="lgTestMode" ${c.test_mode ? 'checked' : ''}>
        <span style="font-size:0.8rem;color:var(--text-muted);">When enabled, no API calls are made</span>
      </div>
      ${c.last_error ? `
        <div style="background:var(--occupied-bg);border:1px solid var(--occupied);border-radius:var(--radius);padding:0.75rem;font-size:0.85rem;">
          <strong>Last Error:</strong> ${c.last_error}
        </div>
      ` : ''}
      <div>
        <button id="lgSaveBtn" class="btn-primary" style="padding:0.5rem 1.5rem;">Save Settings</button>
      </div>
    </div>
  `;

  document.getElementById('lgSaveBtn')?.addEventListener('click', async () => {
    const pat = document.getElementById('lgPatInput')?.value?.trim();
    const testMode = document.getElementById('lgTestMode')?.checked;

    const { error } = await supabase
      .from('lg_config')
      .update({
        pat: pat || null,
        test_mode: testMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    if (error) {
      showToast(`Save failed: ${error.message}`, 'error');
    } else {
      showToast('LG ThinQ settings saved', 'success');
    }
  });
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: async (authState) => {
      currentUserRole = authState.appUser?.role;
      currentAppUserId = authState.appUser?.id;
      deviceScope = await getResidentDeviceScope(authState.appUser, authState.hasPermission);

      // Show admin settings
      if (hasPermission('admin_laundry_settings')) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        await renderAdminSettings();
      }

      // Initial load + polling with circuit breaker
      await refreshFromDB();
      poll = new PollManager(refreshFromDB, POLL_INTERVAL_MS);
      poll.start();
      startCountdown();

      // Handle ?watch= URL parameter (from QR code scan fallback)
      await handleWatchParam();
    },
  });
});
