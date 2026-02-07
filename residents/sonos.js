/**
 * Sonos Music Page
 * Shows zone groups with playback controls, a music library sidebar
 * with starred playlists, ambient group, and drag-and-drop playback.
 * Also supports room grouping/ungrouping and scheduled playback alarms.
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
let zoneGroups = [];       // Array of { coordinatorName, coordinatorState, groupState, members[] }
let playlists = [];        // Array of playlist name strings
let favorites = [];        // Array of favorite name strings
let playlistTags = [];     // Array of { playlist_name, tag } from DB
let schedules = [];        // Array of schedule objects from DB
let pollTimer = null;
let volumeTimers = {};
let dragItem = null;       // { type: 'playlist'|'favorite', name: string }
let pendingLibraryItem = null;
let userRole = null;       // 'admin', 'staff', 'resident', 'associate'
let groupingMode = false;
let groupingSelected = []; // room names selected for grouping

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'music',
    requiredRole: 'resident',
    onReady: async (state) => {
      userRole = state.appUser?.role;
      if (['staff', 'admin'].includes(userRole)) {
        document.body.classList.add('is-staff');
      }
      await loadZones();
      renderZones();
      await Promise.all([loadPlaylists(), loadFavorites(), loadPlaylistTags(), loadSchedules()]);
      renderMusicLibrary();
      renderSchedules();
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

async function loadPlaylistTags() {
  try {
    const { data, error } = await supabase
      .from('sonos_playlist_tags')
      .select('playlist_name, tag');
    if (!error) playlistTags = data || [];
  } catch (err) {
    console.error('Failed to load playlist tags:', err);
  }
}

async function loadSchedules() {
  try {
    const { data, error } = await supabase
      .from('sonos_schedules')
      .select('*')
      .order('time_of_day', { ascending: true });
    if (!error) schedules = data || [];
  } catch (err) {
    console.error('Failed to load schedules:', err);
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

function isStaffPlus() {
  return ['staff', 'admin'].includes(userRole);
}

function isPlaylistStarred(name) {
  return playlistTags.some(t => t.playlist_name === name && t.tag === 'favorite');
}

function getAllRoomNames() {
  const rooms = [];
  for (const g of zoneGroups) {
    for (const m of g.members) {
      rooms.push(m.roomName);
    }
  }
  return [...new Set(rooms)].sort();
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
const STAR_OUTLINE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>';
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';
const UNLINK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16v-2zM2 4.27l3.11 3.11C3.29 8.12 2 9.91 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4.01 1.27-1.27L3.27 3 2 4.27z"/></svg>';
const ALARM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
const LEAF_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6.05 8.05c-2.73 2.73-2.73 7.15-.02 9.88a6.985 6.985 0 004.95 2.05c.41 0 .82-.04 1.21-.12-1.44-.44-2.79-1.18-3.95-2.34-2.55-2.55-2.95-6.36-1.2-9.31l.01-.01c.38.23.8.35 1.24.35C9.8 8.55 11 7.35 11 5.84V2.02S4.47 3.66 6.05 8.05z"/><path d="M17.95 8.05c-1.58-4.39-8.11-6.03-8.11-6.03V5.84c0 1.52 1.2 2.72 2.72 2.72.43 0 .84-.12 1.21-.34 1.76 2.96 1.36 6.77-1.2 9.13-1.15 1.15-2.49 1.89-3.92 2.33.39.08.79.12 1.2.12 1.84 0 3.58-.72 4.89-2.03 2.71-2.73 2.71-7.15-.01-9.88l.01.01.02.01-.01.01c.38.23.8.36 1.24.36a2.72 2.72 0 002.72-2.72V2.02s-1.65.82-2.76 2.21"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>';

// =============================================
// RENDERING - ZONE GROUPS
// =============================================
function renderZones() {
  const container = document.getElementById('sonosZones');
  if (!container) return;

  // Update grouping mode button visibility
  const groupBtn = document.getElementById('groupRoomsBtn');
  if (groupBtn) {
    groupBtn.textContent = groupingMode ? 'Cancel Grouping' : 'Group Rooms';
    groupBtn.className = groupingMode ? 'btn-all-off' : 'btn-small';
  }

  if (!zoneGroups.length) {
    container.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center">No Sonos zones found. Is the Sonos system online?</p>';
    return;
  }

  // Grouping mode controls bar
  const groupControls = groupingMode
    ? `<div class="sonos-group-controls">
        <span class="sonos-group-controls__hint">Select rooms to group together, then click "Group Selected"</span>
        <button class="btn-primary btn-small" id="groupSelectedBtn" disabled>Group Selected</button>
      </div>`
    : '';

  container.innerHTML = groupControls + zoneGroups.map(group => {
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
    const isGrouped = group.members.length > 1;

    // Group name: coordinator + all member names
    const memberNames = group.members
      .filter(m => !m.isCoordinator)
      .map(m => m.roomName);
    const groupTitle = memberNames.length > 0
      ? `${escapeHtml(group.coordinatorName)} <span class="sonos-group-plus">&</span> ${memberNames.map(n => escapeHtml(n)).join(', ')}`
      : escapeHtml(group.coordinatorName);

    // Status line
    let statusText = 'Stopped';
    if (isPlaying) statusText = 'Playing';
    else if (isPaused) statusText = 'Paused';
    const modeIcons = [];
    if (playMode.shuffle) modeIcons.push('Shuffle');
    if (playMode.repeat === 'all') modeIcons.push('Repeat');
    else if (playMode.repeat === 'one') modeIcons.push('Repeat 1');

    // Ungroup button for grouped zones
    const ungroupBtn = isGrouped && isStaffPlus()
      ? `<button class="sonos-ungroup-btn" data-action="ungroup" data-room="${coordName}" title="Ungroup speakers">${UNLINK_SVG} Ungroup</button>`
      : '';

    // Grouping mode checkbox
    const groupCheckbox = groupingMode
      ? `<label class="sonos-group-checkbox">
          <input type="checkbox" data-group-room="${coordName}" ${groupingSelected.includes(group.coordinatorName) ? 'checked' : ''}>
        </label>`
      : '';

    // Member volume rows (only if group has multiple speakers)
    const memberRows = isGrouped
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

    const cardClasses = [
      'sonos-zone-card',
      isPlaying ? 'playing' : '',
      mainMuted ? 'muted' : '',
      isGrouped ? 'grouped' : '',
      groupingMode ? 'group-selectable' : '',
      groupingSelected.includes(group.coordinatorName) ? 'group-selected' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}" data-room="${coordName}" data-drop-target="true">
        ${groupCheckbox}
        <div class="sonos-zone-card__header">
          <div class="sonos-zone-card__title">
            <span class="sonos-zone-card__name">${groupTitle}</span>
            <span class="sonos-zone-card__status">
              ${statusText}${modeIcons.length ? ' &middot; ' + modeIcons.join(', ') : ''}${duration > 0 ? ' &middot; ' + state.elapsedTimeFormatted + ' / ' + formatDuration(duration) : ''}
            </span>
          </div>
          ${ungroupBtn}
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
  const libraryBody = document.getElementById('libraryBody');
  if (!libraryBody) return;

  const starredPlaylists = playlists.filter(name => isPlaylistStarred(name));
  const ambientPlaylists = playlists.filter(name => /ambient/i.test(name));

  let html = '';

  // Starred section
  if (starredPlaylists.length > 0) {
    html += renderLibrarySectionHtml('Starred', 'starredList', starredPlaylists, 'playlist', STAR_SVG, true);
  }

  // Ambient section
  if (ambientPlaylists.length > 0) {
    html += renderLibrarySectionHtml('Ambient', 'ambientList', ambientPlaylists, 'playlist', LEAF_SVG, true);
  }

  // All Playlists
  html += renderLibrarySectionHtml(`Playlists (${playlists.length})`, 'playlistsList', playlists, 'playlist', PLAYLIST_SVG, false, true);

  // Sonos Favorites
  html += renderLibrarySectionHtml(`Favorites (${favorites.length})`, 'favoritesList', favorites, 'favorite', STAR_SVG, false);

  libraryBody.innerHTML = html;
}

function renderLibrarySectionHtml(label, listId, items, type, iconSvg, defaultOpen = true, showStars = false) {
  let itemsHtml = '';
  if (!items.length) {
    itemsHtml = `<p class="text-muted" style="font-size:0.8rem;padding:0.5rem 0;">None found.</p>`;
  } else {
    itemsHtml = items.map(name => {
      const starred = isPlaylistStarred(name);
      const starBtn = showStars && isStaffPlus()
        ? `<button class="sonos-library-item__star ${starred ? 'starred' : ''}" data-star-playlist="${escapeHtml(name)}" title="${starred ? 'Remove from starred' : 'Add to starred'}">${starred ? STAR_SVG : STAR_OUTLINE_SVG}</button>`
        : (showStars && starred ? `<span class="sonos-library-item__star starred">${STAR_SVG}</span>` : '');
      return `
        <div class="sonos-library-item" draggable="true" data-type="${type}" data-name="${escapeHtml(name)}">
          <span class="sonos-library-item__icon">${iconSvg}</span>
          <span class="sonos-library-item__name">${escapeHtml(name)}</span>
          ${starBtn}
        </div>
      `;
    }).join('');
  }

  return `
    <div class="sonos-library__section">
      <details ${defaultOpen ? 'open' : ''}>
        <summary class="sonos-library__section-header">
          <span>${label}</span>
          <span class="sonos-library__chevron">${CHEVRON_SVG}</span>
        </summary>
        <div id="${listId}" class="sonos-library__list">
          ${itemsHtml}
        </div>
      </details>
    </div>
  `;
}

// =============================================
// PLAYLIST STARRING
// =============================================
async function togglePlaylistStar(playlistName) {
  if (!isStaffPlus()) return;

  const existing = playlistTags.find(t => t.playlist_name === playlistName && t.tag === 'favorite');
  if (existing) {
    await supabase.from('sonos_playlist_tags').delete()
      .eq('playlist_name', playlistName).eq('tag', 'favorite');
    playlistTags = playlistTags.filter(t => !(t.playlist_name === playlistName && t.tag === 'favorite'));
    showToast(`Removed "${playlistName}" from starred`, 'info', 1500);
  } else {
    const { error } = await supabase.from('sonos_playlist_tags').insert({ playlist_name: playlistName, tag: 'favorite' });
    if (!error) {
      playlistTags.push({ playlist_name: playlistName, tag: 'favorite' });
      showToast(`Starred "${playlistName}"`, 'success', 1500);
    }
  }
  renderMusicLibrary();
}

// =============================================
// RENDERING - SCHEDULES
// =============================================
function renderSchedules() {
  const container = document.getElementById('schedulesList');
  if (!container) return;

  if (!schedules.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.8rem;padding:0.75rem 0;text-align:center;">No scheduled alarms yet.</p>';
    return;
  }

  container.innerHTML = schedules.map(s => {
    const timeStr = formatTime12h(s.time_of_day);
    const recStr = formatRecurrence(s);
    const activeClass = s.is_active ? '' : 'inactive';

    return `
      <div class="sonos-schedule-card ${activeClass}" data-schedule-id="${s.id}">
        <div class="sonos-schedule-card__left">
          <div class="sonos-schedule-card__time">${timeStr}</div>
          <div class="sonos-schedule-card__name">${escapeHtml(s.name)}</div>
        </div>
        <div class="sonos-schedule-card__meta">
          <span>${escapeHtml(s.room)}</span>
          <span>${escapeHtml(s.playlist_name)}</span>
          <span>${recStr}${s.volume != null ? ` &middot; Vol ${s.volume}%` : ''}${s.keep_grouped ? ' &middot; Grouped' : ''}</span>
        </div>
        <div class="sonos-schedule-card__actions">
          <label class="sonos-schedule-toggle" title="${s.is_active ? 'Active' : 'Inactive'}">
            <input type="checkbox" ${s.is_active ? 'checked' : ''} data-toggle-schedule="${s.id}">
            <span class="sonos-schedule-toggle__slider"></span>
          </label>
          ${isStaffPlus() ? `
            <button class="btn-small" data-edit-schedule="${s.id}">Edit</button>
            <button class="btn-small btn-danger-small" data-delete-schedule="${s.id}">Del</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatRecurrence(schedule) {
  switch (schedule.recurrence) {
    case 'daily': return 'Daily';
    case 'weekdays': return 'Weekdays';
    case 'weekends': return 'Weekends';
    case 'once': return schedule.one_time_date || 'Once';
    case 'custom': {
      const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return (schedule.custom_days || []).map(d => dayNames[d] || d).join(', ');
    }
    default: return schedule.recurrence;
  }
}

// =============================================
// SCHEDULE CRUD
// =============================================
function openScheduleModal(schedule = null) {
  // Remove existing modal if any
  document.getElementById('scheduleModal')?.remove();

  const isEdit = !!schedule;
  const rooms = getAllRoomNames();
  const allItems = [
    ...playlists.map(p => ({ name: p, type: 'playlist' })),
    ...favorites.map(f => ({ name: f, type: 'favorite' })),
  ];

  const modal = document.createElement('div');
  modal.id = 'scheduleModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:420px;">
      <h3 style="margin:0 0 1rem;">${isEdit ? 'Edit' : 'New'} Schedule</h3>
      <form id="scheduleForm">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required value="${escapeHtml(schedule?.name || '')}" placeholder="e.g. Morning Wake Up">
        </div>
        <div class="form-group">
          <label>Playlist / Favorite</label>
          <select name="playlist_name" required>
            <option value="">Select...</option>
            <optgroup label="Playlists">
              ${playlists.map(p => `<option value="${escapeHtml(p)}" data-source="playlist" ${schedule?.playlist_name === p && schedule?.source_type === 'playlist' ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
            </optgroup>
            <optgroup label="Favorites">
              ${favorites.map(f => `<option value="${escapeHtml(f)}" data-source="favorite" ${schedule?.playlist_name === f && schedule?.source_type === 'favorite' ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
            </optgroup>
          </select>
        </div>
        <div class="form-group">
          <label>Room</label>
          <select name="room" required>
            <option value="">Select...</option>
            ${rooms.map(r => `<option value="${escapeHtml(r)}" ${schedule?.room === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label>Time</label>
            <input type="time" name="time_of_day" required value="${schedule?.time_of_day?.substring(0, 5) || '08:00'}">
          </div>
          <div class="form-group" style="flex:1">
            <label>Volume (optional)</label>
            <input type="number" name="volume" min="0" max="100" placeholder="—" value="${schedule?.volume ?? ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Recurrence</label>
          <select name="recurrence" id="scheduleRecurrence">
            <option value="daily" ${schedule?.recurrence === 'daily' ? 'selected' : ''}>Daily</option>
            <option value="weekdays" ${schedule?.recurrence === 'weekdays' ? 'selected' : ''}>Weekdays</option>
            <option value="weekends" ${schedule?.recurrence === 'weekends' ? 'selected' : ''}>Weekends</option>
            <option value="custom" ${schedule?.recurrence === 'custom' ? 'selected' : ''}>Custom Days</option>
            <option value="once" ${schedule?.recurrence === 'once' ? 'selected' : ''}>One Time</option>
          </select>
        </div>
        <div class="form-group" id="customDaysGroup" style="display:${schedule?.recurrence === 'custom' ? 'block' : 'none'}">
          <label>Days</label>
          <div class="schedule-days">
            ${[['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat'],['7','Sun']].map(([v,l]) =>
              `<label class="schedule-day-chip"><input type="checkbox" name="custom_days" value="${v}" ${(schedule?.custom_days || []).includes(parseInt(v)) ? 'checked' : ''}> ${l}</label>`
            ).join('')}
          </div>
        </div>
        <div class="form-group" id="oneDateGroup" style="display:${schedule?.recurrence === 'once' ? 'block' : 'none'}">
          <label>Date</label>
          <input type="date" name="one_time_date" value="${schedule?.one_time_date || ''}">
        </div>
        <label class="form-checkbox">
          <input type="checkbox" name="keep_grouped" ${schedule?.keep_grouped ? 'checked' : ''}>
          <span>Keep rooms grouped</span>
          <span class="form-checkbox__hint">When fired, also play on any rooms grouped with this room</span>
        </label>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="cancelScheduleBtn">Cancel</button>
          <button type="submit" class="btn-primary">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Toggle visibility of custom days / one-time date based on recurrence
  const recurrenceSelect = modal.querySelector('#scheduleRecurrence');
  recurrenceSelect.addEventListener('change', () => {
    modal.querySelector('#customDaysGroup').style.display = recurrenceSelect.value === 'custom' ? 'block' : 'none';
    modal.querySelector('#oneDateGroup').style.display = recurrenceSelect.value === 'once' ? 'block' : 'none';
  });

  // Cancel
  modal.querySelector('#cancelScheduleBtn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Submit
  modal.querySelector('#scheduleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const playlistSelect = form.querySelector('[name="playlist_name"]');
    const selectedOption = playlistSelect.selectedOptions[0];

    const data = {
      name: form.name.value.trim(),
      playlist_name: playlistSelect.value,
      source_type: selectedOption?.dataset.source || 'playlist',
      room: form.room.value,
      time_of_day: form.time_of_day.value + ':00',
      volume: form.volume.value ? parseInt(form.volume.value) : null,
      recurrence: form.recurrence.value,
      custom_days: form.recurrence.value === 'custom'
        ? [...form.querySelectorAll('[name="custom_days"]:checked')].map(c => parseInt(c.value))
        : null,
      one_time_date: form.recurrence.value === 'once' ? form.one_time_date.value || null : null,
      keep_grouped: form.keep_grouped.checked,
    };

    try {
      if (isEdit) {
        data.updated_at = new Date().toISOString();
        const { error } = await supabase.from('sonos_schedules').update(data).eq('id', schedule.id);
        if (error) throw error;
        showToast('Schedule updated', 'success', 2000);
      } else {
        const { error } = await supabase.from('sonos_schedules').insert(data);
        if (error) throw error;
        showToast('Schedule created', 'success', 2000);
      }
      modal.remove();
      await loadSchedules();
      renderSchedules();
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    }
  });
}

async function toggleScheduleActive(id, isActive) {
  try {
    const { error } = await supabase.from('sonos_schedules')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await loadSchedules();
    renderSchedules();
    showToast(isActive ? 'Schedule activated' : 'Schedule paused', 'info', 1500);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

async function deleteSchedule(id) {
  if (!confirm('Delete this schedule?')) return;
  try {
    const { error } = await supabase.from('sonos_schedules').delete().eq('id', id);
    if (error) throw error;
    await loadSchedules();
    renderSchedules();
    showToast('Schedule deleted', 'success', 1500);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

// =============================================
// ROOM GROUPING
// =============================================
function toggleGroupingMode() {
  groupingMode = !groupingMode;
  groupingSelected = [];
  renderZones();
}

function updateGroupingSelection() {
  const btn = document.getElementById('groupSelectedBtn');
  if (btn) btn.disabled = groupingSelected.length < 2;
}

async function groupSelectedRooms() {
  if (groupingSelected.length < 2) return;
  const coordinator = groupingSelected[0];
  const members = groupingSelected.slice(1);

  try {
    for (const member of members) {
      await sonosApi('join', { room: member, other: coordinator });
    }
    showToast(`Grouped ${groupingSelected.length} rooms under ${coordinator}`, 'success');
    groupingMode = false;
    groupingSelected = [];
    setTimeout(() => refreshAllZones(), 2000);
  } catch (err) {
    showToast(`Grouping failed: ${err.message}`, 'error');
  }
}

async function ungroupZone(coordinatorName) {
  const group = zoneGroups.find(g => g.coordinatorName === coordinatorName);
  if (!group || group.members.length <= 1) return;

  try {
    const nonCoordinators = group.members.filter(m => !m.isCoordinator);
    for (const member of nonCoordinators) {
      await sonosApi('leave', { room: member.roomName });
    }
    showToast(`Ungrouped ${coordinatorName}`, 'success');
    setTimeout(() => refreshAllZones(), 2000);
  } catch (err) {
    showToast(`Ungrouping failed: ${err.message}`, 'error');
  }
}

// =============================================
// DRAG AND DROP
// =============================================
function setupDragAndDrop() {
  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sonos-library-item');
    if (!item) return;
    dragItem = { type: item.dataset.type, name: item.dataset.name };
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', item.dataset.name);
    document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.remove('hidden'));
  });

  document.addEventListener('dragend', (e) => {
    const item = e.target.closest('.sonos-library-item');
    if (item) item.classList.remove('dragging');
    dragItem = null;
    document.querySelectorAll('.sonos-drop-hint').forEach(h => h.classList.add('hidden'));
    document.querySelectorAll('.sonos-zone-card').forEach(c => c.classList.remove('drag-over'));
  });

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
function setupTouchFallback() {
  document.addEventListener('click', (e) => {
    // Don't intercept star button clicks
    if (e.target.closest('[data-star-playlist]')) return;

    const item = e.target.closest('.sonos-library-item');
    if (!item) {
      if (pendingLibraryItem) cancelPendingItem();
      return;
    }

    if (pendingLibraryItem) cancelPendingItem();

    pendingLibraryItem = { type: item.dataset.type, name: item.dataset.name };
    item.classList.add('selected');
    document.querySelectorAll('.sonos-drop-hint').forEach(h => {
      h.textContent = `Tap to play "${item.dataset.name}"`;
      h.classList.remove('hidden');
    });
    document.querySelectorAll('.sonos-zone-card').forEach(c => c.classList.add('awaiting-drop'));
  });

  document.getElementById('sonosZones')?.addEventListener('click', async (e) => {
    if (!pendingLibraryItem) return;
    const card = e.target.closest('[data-drop-target]');
    if (!card) return;
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label')) return;

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
    // Also show/hide section headers if all items are hidden
    document.querySelectorAll('.sonos-library__section').forEach(section => {
      const list = section.querySelector('.sonos-library__list');
      if (!list || list.classList.contains('hidden')) return;
      const visibleItems = list.querySelectorAll('.sonos-library-item:not([style*="display: none"])');
      section.style.display = q && visibleItems.length === 0 ? 'none' : '';
    });
  });
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  const zonesContainer = document.getElementById('sonosZones');

  // Transport controls + grouping checkbox + ungroup
  zonesContainer.addEventListener('click', (e) => {
    // Grouping mode checkbox
    const groupCheckbox = e.target.closest('[data-group-room]');
    if (groupCheckbox && groupingMode) {
      const room = groupCheckbox.dataset.groupRoom;
      if (groupCheckbox.checked) {
        if (!groupingSelected.includes(room)) groupingSelected.push(room);
      } else {
        groupingSelected = groupingSelected.filter(r => r !== room);
      }
      // Update visual state
      document.querySelectorAll('.sonos-zone-card').forEach(card => {
        card.classList.toggle('group-selected', groupingSelected.includes(card.dataset.room));
      });
      updateGroupingSelection();
      return;
    }

    // Group Selected button
    if (e.target.id === 'groupSelectedBtn') {
      groupSelectedRooms();
      return;
    }

    // Ungroup button
    const ungroupBtn = e.target.closest('[data-action="ungroup"]');
    if (ungroupBtn) {
      ungroupZone(ungroupBtn.dataset.room);
      return;
    }

    if (pendingLibraryItem) return; // Don't handle transport if pending drop
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
    if (action === 'volume') {
      const label = e.target.closest('.sonos-volume-control')?.querySelector('.sonos-volume-label');
      if (label) label.textContent = `${e.target.value}%`;
    }
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

  // Group Rooms button
  document.getElementById('groupRoomsBtn')?.addEventListener('click', () => toggleGroupingMode());

  // Star playlist clicks (delegated on library body)
  document.getElementById('libraryBody')?.addEventListener('click', (e) => {
    const starBtn = e.target.closest('[data-star-playlist]');
    if (starBtn) {
      e.stopPropagation();
      togglePlaylistStar(starBtn.dataset.starPlaylist);
    }
  });

  // Schedule section events
  const schedulesSection = document.getElementById('schedulesSection');
  if (schedulesSection) {
    // Add schedule button
    document.getElementById('addScheduleBtn')?.addEventListener('click', () => openScheduleModal());

    // Delegated clicks for edit/delete/toggle
    schedulesSection.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-schedule]');
      if (editBtn) {
        const s = schedules.find(s => s.id === parseInt(editBtn.dataset.editSchedule));
        if (s) openScheduleModal(s);
        return;
      }
      const deleteBtn = e.target.closest('[data-delete-schedule]');
      if (deleteBtn) {
        deleteSchedule(parseInt(deleteBtn.dataset.deleteSchedule));
        return;
      }
    });

    // Toggle active/inactive
    schedulesSection.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle-schedule]');
      if (toggle) {
        toggleScheduleActive(parseInt(toggle.dataset.toggleSchedule), toggle.checked);
      }
    });
  }

  // Visibility
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', stopPolling);

  // Drag and drop + mobile fallback
  setupDragAndDrop();
  setupTouchFallback();
  setupSearch();
}
