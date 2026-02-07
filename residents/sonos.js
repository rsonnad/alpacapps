/**
 * Sonos Music Page
 * Shows zone groups with playback controls, and playlists/favorites
 * that can be dragged onto zone groups to start playback.
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
let zoneGroups = [];    // Array of { coordinator, members, state, groupState }
let playlists = [];
let favorites = [];
let pollTimer = null;
let volumeTimers = {};
let dragItem = null;    // { type: 'playlist'|'favorite', name: string }

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
      // Load playlists and favorites in parallel
      await Promise.all([loadPlaylists(), loadFavorites()]);
      renderMusicLibrary();
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
    zoneGroups = [];
    if (!Array.isArray(result)) return;

    for (const group of result) {
      const coord = group.coordinator;
      const members = group.members || [];
      zoneGroups.push({
        coordinatorName: coord.roomName,
        coordinatorState: coord.state,
        groupState: coord.groupState,
        members: members.map(m => ({
          roomName: m.roomName,
          volume: m.state?.volume ?? 0,
          mute: m.state?.mute ?? false,
          isCoordinator: m.roomName === coord.roomName,
        })),
      });
    }

    // Sort: playing first, then paused, then stopped, then alphabetically
    const stateOrder = { PLAYING: 0, PAUSED_PLAYBACK: 1, TRANSITIONING: 2, STOPPED: 3 };
    zoneGroups.sort((a, b) => {
      const aOrder = stateOrder[a.coordinatorState?.playbackState] ?? 3;
      const bOrder = stateOrder[b.coordinatorState?.playbackState] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.coordinatorName.localeCompare(b.coordinatorName);
    });
  } catch (err) {
    console.error('Failed to load zones:', err);
    showToast('Failed to load Sonos zones', 'error');
  }
}

async function loadPlaylists() {
  try {
    if (!zoneGroups.length) return;
    const result = await sonosApi('playlists', { room: zoneGroups[0].coordinatorName });
    playlists = Array.isArray(result) ? result : [];
  } catch (err) {
    console.error('Failed to load playlists:', err);
  }
}

async function loadFavorites() {
  try {
    if (!zoneGroups.length) return;
    const result = await sonosApi('favorites', { room: zoneGroups[0].coordinatorName });
    favorites = Array.isArray(result) ? result : [];
  } catch (err) {
    console.error('Failed to load favorites:', err);
  }
}

// =============================================
// HELPERS
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

// =============================================
// SVG ICONS
// =============================================
const MUSIC_NOTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const PREV_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const NEXT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
const VOL_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const MUTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
const PLAYLIST_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>';
const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';

// =============================================
// RENDERING - ZONE GROUPS
// =============================================
function renderZones() {
  const container = document.getElementById('sonosZones');
  if (!container) return;

  if (!zoneGroups.length) {
    container.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center">No Sonos zones found. Is the Sonos system online?</p>';
    return;
  }

  container.innerHTML = zoneGroups.map(group => {
    const state = group.coordinatorState || {};
    const track = state.currentTrack || {};
    const isPlaying = state.playbackState === 'PLAYING';
    const isPaused = state.playbackState === 'PAUSED_PLAYBACK';
    const hasTrack = track.title && track.title.trim() !== '';
    const artUrl = track.absoluteAlbumArtUri;
    const showArt = hasTrack && artUrl && !isLocalArtUrl(artUrl);
    const playMode = state.playMode || {};
    const duration = track.duration || 0;
    const coordName = escapeHtml(group.coordinatorName);

    // Group name: coordinator + member names
    const memberNames = group.members
      .filter(m => !m.isCoordinator)
      .map(m => m.roomName);
    const groupTitle = memberNames.length > 0
      ? `${group.coordinatorName} <span class="sonos-group-badge">+${memberNames.length}</span>`
      : group.coordinatorName;

    // Status line
    let statusText = 'Stopped';
    if (isPlaying) statusText = 'Playing';
    else if (isPaused) statusText = 'Paused';
    const modeIcons = [];
    if (playMode.shuffle) modeIcons.push('Shuffle');
    if (playMode.repeat === 'all') modeIcons.push('Repeat');
    else if (playMode.repeat === 'one') modeIcons.push('Repeat 1');

    // Member volume rows (only if group has multiple speakers)
    const memberRows = group.members.length > 1
      ? `<div class="sonos-group-members">
          <div class="sonos-group-members__label">Speakers</div>
          ${group.members.map(m => `
            <div class="sonos-member-row">
              <span class="sonos-member-name">${escapeHtml(m.roomName)}</span>
              <span class="sonos-member-vol">${m.volume}%</span>
              <input type="range" min="0" max="100" value="${m.volume}" class="sonos-member-slider"
                data-action="memberVolume" data-room="${escapeHtml(m.roomName)}">
            </div>
          `).join('')}
        </div>`
      : '';

    // Single speaker volume
    const mainVolume = group.members.length === 1
      ? group.members[0].volume
      : group.groupState?.volume ?? 0;
    const mainMuted = group.members.length === 1
      ? group.members[0].mute
      : group.groupState?.mute ?? false;

    return `
      <div class="sonos-zone-card ${isPlaying ? 'playing' : ''} ${mainMuted ? 'muted' : ''}"
           data-room="${coordName}" data-drop-target="true">
        <div class="sonos-zone-card__header">
          <div class="sonos-zone-card__title">
            <span class="sonos-zone-card__name">${groupTitle}</span>
            <span class="sonos-zone-card__status">
              ${statusText}${modeIcons.length ? ' &middot; ' + modeIcons.join(', ') : ''}${duration > 0 ? ' &middot; ' + state.elapsedTimeFormatted + ' / ' + formatDuration(duration) : ''}
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
          <button class="sonos-btn" data-action="previous" data-room="${coordName}" title="Previous">${PREV_SVG}</button>
          <button class="sonos-btn sonos-btn--play" data-action="playpause" data-room="${coordName}" title="${isPlaying ? 'Pause' : 'Play'}">
            ${isPlaying ? PAUSE_SVG : PLAY_SVG}
          </button>
          <button class="sonos-btn" data-action="next" data-room="${coordName}" title="Next">${NEXT_SVG}</button>
          <button class="sonos-btn sonos-btn--mute ${mainMuted ? 'active' : ''}" data-action="toggleMute" data-room="${coordName}" data-muted="${mainMuted ? '1' : '0'}" title="${mainMuted ? 'Unmute' : 'Mute'}">
            ${mainMuted ? MUTE_SVG : VOL_SVG}
          </button>
        </div>

        <div class="sonos-volume-control">
          <span class="sonos-volume-label">${mainVolume}%</span>
          <input type="range" min="0" max="100" value="${mainVolume}"
            data-action="volume" data-room="${coordName}">
        </div>

        ${memberRows}

        <div class="sonos-drop-hint hidden">Drop to play here</div>
      </div>
    `;
  }).join('');
}

// =============================================
// RENDERING - MUSIC LIBRARY (Playlists + Favorites)
// =============================================
function renderMusicLibrary() {
  renderLibrarySection('playlistsList', playlists, 'playlist', PLAYLIST_SVG);
  renderLibrarySection('favoritesList', favorites, 'favorite', STAR_SVG);

  // Update counts
  const plCount = document.getElementById('playlistsCount');
  const favCount = document.getElementById('favoritesCount');
  if (plCount) plCount.textContent = playlists.length ? `(${playlists.length})` : '';
  if (favCount) favCount.textContent = favorites.length ? `(${favorites.length})` : '';
}

function renderLibrarySection(containerId, items, type, iconSvg) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<p class="text-muted" style="font-size:0.8rem;padding:0.5rem 0;">None found.</p>`;
    return;
  }

  container.innerHTML = items.map(name => `
    <div class="sonos-library-item" draggable="true" data-type="${type}" data-name="${escapeHtml(name)}">
      <span class="sonos-library-item__icon">${iconSvg}</span>
      <span class="sonos-library-item__name">${escapeHtml(name)}</span>
    </div>
  `).join('');
}

// =============================================
// DRAG AND DROP
// =============================================
function setupDragAndDrop() {
  // Drag start on library items
  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sonos-library-item');
    if (!item) return;
    dragItem = { type: item.dataset.type, name: item.dataset.name };
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', item.dataset.name);
    // Show drop hints on all zone cards
    document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.remove('hidden'));
  });

  document.addEventListener('dragend', (e) => {
    const item = e.target.closest('.sonos-library-item');
    if (item) item.classList.remove('dragging');
    dragItem = null;
    document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.add('hidden'));
    document.querySelectorAll('.sonos-zone-card').forEach(c => c.classList.remove('drag-over'));
  });

  // Drop targets (zone cards)
  const zonesContainer = document.getElementById('sonosZones');

  zonesContainer.addEventListener('dragover', (e) => {
    const card = e.target.closest('[data-drop-target]');
    if (!card) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    card.classList.add('drag-over');
  });

  zonesContainer.addEventListener('dragleave', (e) => {
    const card = e.target.closest('[data-drop-target]');
    if (!card) return;
    // Only remove if we're leaving the card entirely
    const related = e.relatedTarget;
    if (related && card.contains(related)) return;
    card.classList.remove('drag-over');
  });

  zonesContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    const card = e.target.closest('[data-drop-target]');
    if (!card || !dragItem) return;
    card.classList.remove('drag-over');
    document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.add('hidden'));

    const room = card.dataset.room;
    const { type, name } = dragItem;
    dragItem = null;

    card.classList.add('loading');
    try {
      await sonosApi(type, { room, name });
      showToast(`Playing "${name}" on ${room}`, 'success', 2500);
      setTimeout(() => refreshAllZones(), 2000);
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      card.classList.remove('loading');
    }
  });
}

// Mobile touch fallback: tap library item then tap zone
let pendingLibraryItem = null;

function setupTouchFallback() {
  // Tap library item to "pick it up"
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.sonos-library-item');
    if (!item) {
      // Clicked elsewhere — cancel pending
      if (pendingLibraryItem) {
        cancelPendingItem();
      }
      return;
    }

    // If there's already a pending item and user clicks a different one, switch
    if (pendingLibraryItem) cancelPendingItem();

    pendingLibraryItem = { type: item.dataset.type, name: item.dataset.name };
    item.classList.add('selected');
    document.querySelectorAll('.sonos-drop-hint').forEach(h => {
      h.textContent = `Tap to play "${item.dataset.name}"`;
      h.classList.remove('hidden');
    });
    document.querySelectorAll('.sonos-zone-card').forEach(c => c.classList.add('awaiting-drop'));
  });

  // Tap zone card to play pending item
  document.getElementById('sonosZones')?.addEventListener('click', async (e) => {
    if (!pendingLibraryItem) return;
    const card = e.target.closest('[data-drop-target]');
    if (!card) return;
    // Don't intercept transport button clicks
    if (e.target.closest('button') || e.target.closest('input')) return;

    const room = card.dataset.room;
    const { type, name } = pendingLibraryItem;
    cancelPendingItem();

    card.classList.add('loading');
    try {
      await sonosApi(type, { room, name });
      showToast(`Playing "${name}" on ${room}`, 'success', 2500);
      setTimeout(() => refreshAllZones(), 2000);
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      card.classList.remove('loading');
    }
  });
}

function cancelPendingItem() {
  pendingLibraryItem = null;
  document.querySelectorAll('.sonos-library-item.selected').forEach(i => i.classList.remove('selected'));
  document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.add('hidden'));
  document.querySelectorAll('.sonos-zone-card').forEach(c => c.classList.remove('awaiting-drop'));
}

// =============================================
// CONTROL FUNCTIONS
// =============================================
async function controlWithFeedback(roomName, action, params = {}) {
  const card = document.querySelector(`.sonos-zone-card[data-room="${CSS.escape(roomName)}"]`);
  card?.classList.add('loading');
  try {
    await sonosApi(action, { room: roomName, ...params });
    setTimeout(() => refreshAllZones(), 1000);
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

function updatePollStatus() {
  const el = document.getElementById('pollStatus');
  if (!el) return;
  el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refreshAllZones(), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function handleVisibilityChange() {
  if (document.hidden) stopPolling();
  else { refreshAllZones(); startPolling(); }
}

// =============================================
// LIBRARY SEARCH FILTER
// =============================================
function setupSearch() {
  const input = document.getElementById('librarySearch');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    document.querySelectorAll('.sonos-library-item').forEach(item => {
      const name = item.dataset.name.toLowerCase();
      item.style.display = !q || name.includes(q) ? '' : 'none';
    });
  });
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  const zonesContainer = document.getElementById('sonosZones');

  // Transport controls
  zonesContainer.addEventListener('click', (e) => {
    if (pendingLibraryItem) return; // Don't handle if pending drop
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, room } = btn.dataset;
    switch (action) {
      case 'playpause': controlWithFeedback(room, 'playpause'); break;
      case 'next': controlWithFeedback(room, 'next'); break;
      case 'previous': controlWithFeedback(room, 'previous'); break;
      case 'toggleMute': {
        const isMuted = btn.dataset.muted === '1';
        controlWithFeedback(room, isMuted ? 'unmute' : 'mute');
        break;
      }
    }
  });

  // Volume sliders (main + member)
  zonesContainer.addEventListener('input', (e) => {
    const action = e.target.dataset.action;
    if (action !== 'volume' && action !== 'memberVolume') return;
    const room = e.target.dataset.room;
    // Update label for main volume
    if (action === 'volume') {
      const label = e.target.closest('.sonos-volume-control')?.querySelector('.sonos-volume-label');
      if (label) label.textContent = `${e.target.value}%`;
    }
    // Update label for member volume
    if (action === 'memberVolume') {
      const volLabel = e.target.closest('.sonos-member-row')?.querySelector('.sonos-member-vol');
      if (volLabel) volLabel.textContent = `${e.target.value}%`;
    }
    clearTimeout(volumeTimers[room]);
    volumeTimers[room] = setTimeout(() => setVolume(room, e.target.value), 400);
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

  // Library section toggles
  document.querySelectorAll('.sonos-library-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const isHidden = target.classList.toggle('hidden');
      btn.textContent = isHidden ? 'Show' : 'Hide';
    });
  });

  // Visibility
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', stopPolling);

  // Drag and drop + mobile fallback
  setupDragAndDrop();
  setupTouchFallback();
  setupSearch();
}
