/**
 * Sonos Music Page
 * Shows all Sonos zones with playback info, transport controls, volume, and favorites.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// CONFIGURATION
// =============================================
const SONOS_CONTROL_URL = `${SUPABASE_URL}/functions/v1/sonos-control`;
const POLL_INTERVAL_MS = 30000;

// =============================================
// STATE
// =============================================
let zones = [];
let favorites = [];
let pollTimer = null;
let volumeTimers = {};

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'music',
    requiredRole: 'resident',
    onReady: async () => {
      await loadZones();
      renderZones();
      await loadFavorites();
      renderFavorites();
      setupEventListeners();
      startPolling();
    },
  });
});

// =============================================
// API WRAPPER
// =============================================
async function sonosApi(action, params = {}) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) {
    showToast('Session expired. Please refresh.', 'error');
    throw new Error('No auth token');
  }

  const response = await fetch(SONOS_CONTROL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
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
// DATA LOADING
// =============================================
async function loadZones() {
  try {
    const result = await sonosApi('getZones');
    zones = [];
    if (!Array.isArray(result)) return;

    for (const group of result) {
      const coordinator = group.coordinator;
      const members = group.members || [];
      for (const member of members) {
        zones.push({
          roomName: member.roomName,
          state: member.state,
          coordinator: coordinator.roomName,
          isCoordinator: member.roomName === coordinator.roomName,
          groupSize: members.length,
          groupMembers: members.map(m => m.roomName),
        });
      }
    }

    // Sort: playing first, then paused, then stopped, then alphabetically
    const stateOrder = { PLAYING: 0, PAUSED_PLAYBACK: 1, TRANSITIONING: 2, STOPPED: 3 };
    zones.sort((a, b) => {
      const aOrder = stateOrder[a.state?.playbackState] ?? 3;
      const bOrder = stateOrder[b.state?.playbackState] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.roomName.localeCompare(b.roomName);
    });
  } catch (err) {
    console.error('Failed to load zones:', err);
    showToast('Failed to load Sonos zones', 'error');
  }
}

async function loadFavorites() {
  try {
    if (zones.length === 0) return;
    const result = await sonosApi('favorites', { room: zones[0].roomName });
    favorites = Array.isArray(result) ? result : [];
  } catch (err) {
    console.error('Failed to load favorites:', err);
  }
}

// =============================================
// RENDERING - ZONES
// =============================================
function isLocalArtUrl(url) {
  if (!url) return true;
  return /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/.test(url);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MUSIC_NOTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const PREV_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const NEXT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
const VOL_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const MUTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

function renderZones() {
  const container = document.getElementById('sonosZones');
  if (!container) return;

  if (!zones.length) {
    container.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center">No Sonos zones found. Is the Sonos system online?</p>';
    return;
  }

  container.innerHTML = zones.map(zone => {
    const track = zone.state?.currentTrack || {};
    const isPlaying = zone.state?.playbackState === 'PLAYING';
    const isPaused = zone.state?.playbackState === 'PAUSED_PLAYBACK';
    const volume = zone.state?.volume ?? 0;
    const muted = zone.state?.mute;
    const hasTrack = track.title && track.title.trim() !== '';
    const artUrl = track.absoluteAlbumArtUri;
    const showArt = hasTrack && artUrl && !isLocalArtUrl(artUrl);
    const playMode = zone.state?.playMode || {};
    const duration = track.duration || 0;
    const elapsed = zone.state?.elapsedTime || 0;

    // Group badge
    let groupLabel = '';
    if (zone.groupSize > 1 && zone.isCoordinator) {
      groupLabel = ` <span class="sonos-group-badge">+${zone.groupSize - 1}</span>`;
    } else if (zone.groupSize > 1 && !zone.isCoordinator) {
      groupLabel = ` <span class="sonos-group-badge sonos-grouped">grouped</span>`;
    }

    // Status text
    let statusText = 'Stopped';
    if (isPlaying) statusText = 'Playing';
    else if (isPaused) statusText = 'Paused';

    // Play mode indicators
    const modeIcons = [];
    if (playMode.shuffle) modeIcons.push('Shuffle');
    if (playMode.repeat === 'all') modeIcons.push('Repeat');
    else if (playMode.repeat === 'one') modeIcons.push('Repeat 1');

    const roomAttr = escapeHtml(zone.roomName);
    const isGrouped = zone.groupSize > 1 && !zone.isCoordinator;

    return `
      <div class="sonos-zone-card ${isPlaying ? 'playing' : ''} ${muted ? 'muted' : ''} ${isGrouped ? 'grouped-member' : ''}" data-room="${roomAttr}">
        <div class="sonos-zone-card__header">
          <div class="sonos-zone-card__title">
            <span class="sonos-zone-card__name">${escapeHtml(zone.roomName)}${groupLabel}</span>
            <span class="sonos-zone-card__status">
              ${statusText}${modeIcons.length ? ' &middot; ' + modeIcons.join(', ') : ''}${duration > 0 ? ' &middot; ' + zone.state?.elapsedTimeFormatted + ' / ' + formatDuration(duration) : ''}
            </span>
          </div>
        </div>

        <div class="sonos-zone-card__track">
          ${showArt
            ? `<img class="sonos-album-art" src="${escapeHtml(artUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''
          }
          <div class="sonos-album-art sonos-album-art--empty" ${showArt ? 'style="display:none"' : ''}>
            ${MUSIC_NOTE_SVG}
          </div>
          <div class="sonos-track-info">
            <span class="sonos-track-title">${hasTrack ? escapeHtml(track.title) : 'No track'}</span>
            <span class="sonos-track-artist">${escapeHtml(track.artist || '')}</span>
          </div>
        </div>

        <div class="sonos-zone-card__controls">
          <button class="sonos-btn" data-action="previous" data-room="${roomAttr}" title="Previous">${PREV_SVG}</button>
          <button class="sonos-btn sonos-btn--play" data-action="playpause" data-room="${roomAttr}" title="${isPlaying ? 'Pause' : 'Play'}">
            ${isPlaying ? PAUSE_SVG : PLAY_SVG}
          </button>
          <button class="sonos-btn" data-action="next" data-room="${roomAttr}" title="Next">${NEXT_SVG}</button>
          <button class="sonos-btn sonos-btn--mute ${muted ? 'active' : ''}" data-action="toggleMute" data-room="${roomAttr}" data-muted="${muted ? '1' : '0'}" title="${muted ? 'Unmute' : 'Mute'}">
            ${muted ? MUTE_SVG : VOL_SVG}
          </button>
        </div>

        <div class="sonos-volume-control">
          <span class="sonos-volume-label">${volume}%</span>
          <input type="range" min="0" max="100" value="${volume}"
            data-action="volume" data-room="${roomAttr}">
        </div>
      </div>
    `;
  }).join('');
}

// =============================================
// RENDERING - FAVORITES
// =============================================
function renderFavorites() {
  const container = document.getElementById('favoritesList');
  if (!container) return;

  if (!favorites.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No favorites found.</p>';
    return;
  }

  container.innerHTML = favorites.map(fav => `
    <button class="favorite-btn" data-favorite="${escapeHtml(fav)}" title="Play ${escapeHtml(fav)}">${escapeHtml(fav)}</button>
  `).join('');
}

// =============================================
// CONTROL FUNCTIONS
// =============================================
async function controlWithFeedback(roomName, action, params = {}, successMsg = null) {
  const card = document.querySelector(`[data-room="${CSS.escape(roomName)}"]`);
  card?.classList.add('loading');
  try {
    await sonosApi(action, { room: roomName, ...params });
    if (successMsg) showToast(successMsg, 'success', 1500);
    // Refresh after a short delay to let Sonos process
    setTimeout(() => refreshZoneState(roomName), 1000);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    card?.classList.remove('loading');
  }
}

async function setVolume(roomName, value) {
  try {
    await sonosApi('volume', { room: roomName, value: parseInt(value) });
  } catch (err) {
    showToast(`Volume failed: ${err.message}`, 'error');
  }
}

async function pauseAll() {
  try {
    await sonosApi('pauseall');
    showToast('All zones paused', 'success', 2000);
    setTimeout(() => refreshAllZones(), 1500);
  } catch (err) {
    showToast(`Pause all failed: ${err.message}`, 'error');
  }
}

async function playFavoriteOnRoom(favoriteName, roomName) {
  const card = document.querySelector(`[data-room="${CSS.escape(roomName)}"]`);
  card?.classList.add('loading');
  try {
    await sonosApi('favorite', { room: roomName, name: favoriteName });
    showToast(`Playing "${favoriteName}" on ${roomName}`, 'success', 2500);
    setTimeout(() => refreshZoneState(roomName), 2000);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    card?.classList.remove('loading');
  }
}

// =============================================
// ROOM PICKER (for favorites)
// =============================================
function showRoomPicker(favoriteName) {
  // Remove existing picker
  document.querySelector('.room-picker-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'room-picker-overlay';

  const picker = document.createElement('div');
  picker.className = 'room-picker';
  picker.innerHTML = `
    <div class="room-picker__header">Play "${escapeHtml(favoriteName)}" on:</div>
    ${zones.filter(z => z.isCoordinator || z.groupSize === 1).map(z => `
      <button class="room-picker__option" data-room="${escapeHtml(z.roomName)}">
        ${escapeHtml(z.roomName)}
        ${z.state?.playbackState === 'PLAYING' ? '<span class="room-picker__playing">playing</span>' : ''}
      </button>
    `).join('')}
    <button class="room-picker__option room-picker__cancel">Cancel</button>
  `;

  picker.addEventListener('click', async (e) => {
    const option = e.target.closest('.room-picker__option');
    if (!option) return;
    overlay.remove();
    if (option.classList.contains('room-picker__cancel')) return;
    const room = option.dataset.room;
    if (room) playFavoriteOnRoom(favoriteName, room);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.appendChild(picker);
  document.body.appendChild(overlay);
}

// =============================================
// POLLING
// =============================================
async function refreshAllZones() {
  try {
    await loadZones();
    renderZones();
    updatePollStatus();
  } catch (err) {
    console.warn('Zone refresh failed:', err);
  }
}

async function refreshZoneState(roomName) {
  try {
    const result = await sonosApi('getState', { room: roomName });
    const zone = zones.find(z => z.roomName === roomName);
    if (zone && result) {
      zone.state = result;
      renderZones(); // Re-render all (simple approach)
    }
  } catch (err) {
    console.warn(`State refresh failed for ${roomName}:`, err);
  }
}

function updatePollStatus() {
  const el = document.getElementById('pollStatus');
  if (!el) return;
  const now = new Date();
  el.textContent = `Last updated: ${now.toLocaleTimeString()}`;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refreshAllZones(), POLL_INTERVAL_MS);
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
    refreshAllZones();
    startPolling();
  }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  const zonesContainer = document.getElementById('sonosZones');

  // Transport controls (click delegation)
  zonesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName !== 'BUTTON') return;
    const { action, room } = btn.dataset;
    switch (action) {
      case 'playpause':
        controlWithFeedback(room, 'playpause');
        break;
      case 'next':
        controlWithFeedback(room, 'next');
        break;
      case 'previous':
        controlWithFeedback(room, 'previous');
        break;
      case 'toggleMute': {
        const isMuted = btn.dataset.muted === '1';
        controlWithFeedback(room, isMuted ? 'unmute' : 'mute');
        break;
      }
    }
  });

  // Volume slider (debounced)
  zonesContainer.addEventListener('input', (e) => {
    if (e.target.dataset.action !== 'volume') return;
    const room = e.target.dataset.room;
    const label = e.target.closest('.sonos-volume-control')?.querySelector('.sonos-volume-label');
    if (label) label.textContent = `${e.target.value}%`;
    clearTimeout(volumeTimers[room]);
    volumeTimers[room] = setTimeout(() => setVolume(room, e.target.value), 400);
  });

  // Favorites
  document.getElementById('favoritesList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.favorite-btn');
    if (!btn) return;
    showRoomPicker(btn.dataset.favorite);
  });

  // Favorites toggle
  document.getElementById('toggleFavoritesBtn')?.addEventListener('click', () => {
    const body = document.getElementById('favoritesBody');
    const btn = document.getElementById('toggleFavoritesBtn');
    body.classList.toggle('hidden');
    btn.textContent = body.classList.contains('hidden') ? 'Show' : 'Hide';
  });

  // Pause All
  document.getElementById('pauseAllBtn')?.addEventListener('click', () => pauseAll());

  // Refresh
  document.getElementById('refreshZonesBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshZonesBtn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    await refreshAllZones();
    btn.disabled = false;
    btn.textContent = 'Refresh';
    showToast('Zones refreshed', 'info', 1500);
  });

  // Visibility change (pause polling when tab hidden)
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Cleanup
  window.addEventListener('beforeunload', stopPolling);
}
