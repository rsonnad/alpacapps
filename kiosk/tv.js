/**
 * TV Display Page
 * Configurable per-display from DB via ?display=<uuid>
 * Modes: dashboard, cameras, signage, slideshow
 */

import { supabase, SUPABASE_URL } from '../shared/supabase.js';

const POLL_INTERVAL = 60_000;
const WEATHER_CACHE_MS = 600_000;
const AUSTIN_TZ = 'America/Chicago';

let displayConfig = null;
let weatherCache = null;
let weatherCacheTime = 0;
let pollTimer = null;
let activeHls = {};
let slideshowTimer = null;
let slideshowPhotos = [];
let slideshowIndex = 0;

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDisplayConfig();

  if (!displayConfig) {
    document.getElementById('tvContainer').innerHTML =
      '<div class="tv-signage"><h1 class="tv-signage-message">No display configured</h1><p class="tv-signage-subtitle">Add a display in Admin Settings, then load this page with ?display=&lt;id&gt;</p></div>';
    return;
  }

  // Show the correct mode
  const mode = displayConfig.mode || 'dashboard';
  const modeEl = document.getElementById(`${mode}Mode`);
  if (modeEl) modeEl.style.display = '';

  switch (mode) {
    case 'dashboard':
      initDashboard();
      break;
    case 'cameras':
      initCameras();
      break;
    case 'signage':
      initSignage();
      break;
    case 'slideshow':
      initSlideshow();
      break;
  }
});

async function loadDisplayConfig() {
  const params = new URLSearchParams(window.location.search);
  const displayId = params.get('display');

  try {
    if (displayId) {
      const { data } = await supabase
        .from('displays')
        .select('*')
        .eq('id', displayId)
        .single();
      displayConfig = data;
    } else {
      // Fallback: first active TV display
      const { data } = await supabase
        .from('displays')
        .select('*')
        .eq('display_type', 'tv')
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .single();
      displayConfig = data;
    }
  } catch (err) {
    console.error('Failed to load display config:', err);
  }
}

// =============================================
// DASHBOARD MODE
// =============================================
function initDashboard() {
  updateClock();
  setInterval(updateClock, 1000);

  loadFact();
  refreshDashboard();
  startPolling(() => refreshDashboard());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
    } else {
      refreshDashboard();
      startPolling(() => refreshDashboard());
    }
  });
}

async function refreshDashboard() {
  const cfg = displayConfig?.config || {};
  await Promise.allSettled([
    cfg.show_occupants !== false ? loadOccupantsTV() : Promise.resolve(),
    cfg.show_events !== false ? loadEventsTV() : Promise.resolve(),
    cfg.show_weather !== false ? loadWeatherTV() : Promise.resolve(),
    cfg.show_pai_count !== false ? loadPaiCountTV() : Promise.resolve(),
  ]);
}

function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById('tvClock');
  const dateEl = document.getElementById('tvDate');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: AUSTIN_TZ,
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: AUSTIN_TZ,
    });
  }
}

async function loadOccupantsTV() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
    const { data } = await supabase
      .from('assignments')
      .select(`
        id, start_date, end_date, status,
        person:person_id(first_name),
        assignment_spaces(space:space_id(name))
      `)
      .eq('status', 'active');

    const container = document.getElementById('tvOccupants');
    if (!data || data.length === 0) {
      container.innerHTML = '<span class="tv-loading">No current occupants</span>';
      return;
    }

    const current = data.filter(a => {
      if (!a.start_date || a.start_date > today) return false;
      if (a.end_date && a.end_date < today) return false;
      return true;
    });

    container.innerHTML = current.map(a => {
      const name = a.person?.first_name || 'Guest';
      const spaces = (a.assignment_spaces || []).map(as => as.space?.name).filter(Boolean).join(', ');
      return `<span class="tv-occupant-pill">
        ${esc(name)}${spaces ? ` <span class="tv-occupant-space">\u2022 ${esc(spaces)}</span>` : ''}
      </span>`;
    }).join('') || '<span class="tv-loading">No current occupants</span>';
  } catch (err) {
    console.error('Occupants error:', err);
  }
}

async function loadEventsTV() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
    const { data } = await supabase
      .from('event_hosting_requests')
      .select('event_name, event_date, event_start_time')
      .eq('request_status', 'approved')
      .gte('event_date', today)
      .order('event_date')
      .limit(3);

    const section = document.getElementById('tvEventsSection');
    if (!data || data.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    document.getElementById('tvEvents').innerHTML = data.map(e => {
      const d = new Date(e.event_date + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: AUSTIN_TZ });
      return `<div class="tv-event-row">
        <span class="tv-event-date">${label}</span>
        <span class="tv-event-name">${esc(e.event_name || 'Event')}</span>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Events error:', err);
  }
}

async function loadWeatherTV() {
  try {
    if (weatherCache && (Date.now() - weatherCacheTime) < WEATHER_CACHE_MS) {
      renderWeatherTV(weatherCache);
      return;
    }

    const { data: config } = await supabase
      .from('weather_config')
      .select('owm_api_key, latitude, longitude, is_active')
      .single();

    if (!config?.is_active || !config?.owm_api_key) return;

    let weather = null;
    try {
      const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${config.latitude}&lon=${config.longitude}&exclude=minutely,daily,alerts&units=imperial&appid=${config.owm_api_key}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const d = await resp.json();
        weather = {
          temp: Math.round(d.current.temp),
          desc: d.current.weather?.[0]?.description || '',
          icon: d.current.weather?.[0]?.icon || '01d',
          humidity: d.current.humidity,
          feelsLike: Math.round(d.current.feels_like),
        };
      }
    } catch (_) {}

    if (!weather) {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${config.latitude}&lon=${config.longitude}&units=imperial&appid=${config.owm_api_key}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const d = await resp.json();
        weather = {
          temp: Math.round(d.main.temp),
          desc: d.weather?.[0]?.description || '',
          icon: d.weather?.[0]?.icon || '01d',
          humidity: d.main.humidity,
          feelsLike: Math.round(d.main.feels_like),
        };
      }
    }

    if (weather) {
      weatherCache = weather;
      weatherCacheTime = Date.now();
      renderWeatherTV(weather);
    }
  } catch (err) {
    console.error('Weather error:', err);
  }
}

function renderWeatherTV(w) {
  const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('tvWeather').innerHTML = `
    <img class="tv-weather-icon" src="https://openweathermap.org/img/wn/${w.icon}@2x.png" alt="">
    <span class="tv-weather-temp">${w.temp}\u00B0</span>
    <div>
      <div class="tv-weather-desc">${cap(w.desc)}</div>
      <div class="tv-weather-detail">Feels ${w.feelsLike}\u00B0 \u2022 ${w.humidity}% humidity</div>
    </div>
  `;
}

async function loadFact() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-daily-fact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.ok) {
      const { fact } = await resp.json();
      const el = document.getElementById('tvFact');
      if (el && fact) el.textContent = fact;
    }
  } catch (err) {
    console.error('Fact error:', err);
  }
}

async function loadPaiCountTV() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('pai_interactions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);

    const el = document.getElementById('tvPaiCount');
    if (count !== null && count > 0) {
      el.textContent = `${count} AI quer${count === 1 ? 'y' : 'ies'} in the last 24 hours`;
    } else {
      el.textContent = '';
    }
  } catch (err) {
    console.error('PAI count error:', err);
  }
}

// =============================================
// CAMERA MODE
// =============================================
async function initCameras() {
  const cfg = displayConfig?.config || {};
  const quality = cfg.quality || 'med';
  const layout = cfg.layout || '2x2';
  const cameraFilter = cfg.cameras || [];
  const showLabels = cfg.show_labels !== false;

  const { data } = await supabase
    .from('camera_streams')
    .select('*')
    .eq('is_active', true)
    .order('camera_name')
    .order('quality');

  if (!data || data.length === 0) {
    document.getElementById('tvCameraGrid').innerHTML =
      '<div class="tv-signage"><h1 class="tv-signage-message">No cameras available</h1></div>';
    return;
  }

  // Group by camera name
  const grouped = {};
  for (const stream of data) {
    if (!grouped[stream.camera_name]) {
      grouped[stream.camera_name] = { name: stream.camera_name, streams: {} };
    }
    grouped[stream.camera_name].streams[stream.quality] = stream;
  }

  // Filter to configured cameras (or all if not specified)
  let cameras = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
  if (cameraFilter.length > 0) {
    cameras = cameras.filter(c => cameraFilter.includes(c.name));
  }

  const grid = document.getElementById('tvCameraGrid');
  grid.className = `tv-camera-grid layout-${layout}`;

  cameras.forEach((cam, i) => {
    const stream = cam.streams[quality] || cam.streams['med'] || cam.streams['low'] || Object.values(cam.streams)[0];
    if (!stream) return;

    const cell = document.createElement('div');
    cell.className = 'tv-camera-cell';
    cell.innerHTML = `
      <video id="tvCamVideo${i}" muted autoplay playsinline></video>
      <span class="tv-camera-dot" id="tvCamDot${i}"></span>
      ${showLabels ? `<span class="tv-camera-label">${esc(cam.name)}</span>` : ''}
    `;
    grid.appendChild(cell);

    const hlsUrl = `${stream.proxy_base_url}/api/stream.m3u8?src=${stream.stream_name}&mp4`;
    startHlsStream(hlsUrl, `tvCamVideo${i}`, `tvCamDot${i}`);
  });
}

function startHlsStream(url, videoId, dotId) {
  if (typeof Hls === 'undefined' || !Hls.isSupported()) {
    // Try native HLS (Safari)
    const video = document.getElementById(videoId);
    if (video?.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    }
    return;
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    manifestLoadingMaxRetry: 10,
    manifestLoadingRetryDelay: 3000,
    manifestLoadingMaxRetryTimeout: 30000,
    levelLoadingMaxRetry: 10,
    levelLoadingRetryDelay: 3000,
    fragLoadingMaxRetry: 10,
    fragLoadingRetryDelay: 3000,
  });

  const video = document.getElementById(videoId);
  const dot = document.getElementById(dotId);

  hls.loadSource(url);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (dot) dot.className = 'tv-camera-dot';
    video.play().catch(() => {});
  });

  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    hls.destroy();
    if (dot) dot.className = 'tv-camera-dot offline';
    // Retry after 30s
    setTimeout(() => startHlsStream(url, videoId, dotId), 30000);
  });

  activeHls[videoId] = hls;
}

// =============================================
// SIGNAGE MODE
// =============================================
function initSignage() {
  const cfg = displayConfig?.config || {};
  const msgEl = document.getElementById('signageMessage');
  const subEl = document.getElementById('signageSubtitle');

  if (cfg.message && msgEl) msgEl.textContent = cfg.message;
  if (cfg.subtitle && subEl) subEl.textContent = cfg.subtitle;
}

// =============================================
// SLIDESHOW MODE
// =============================================
async function initSlideshow() {
  const cfg = displayConfig?.config || {};
  const interval = cfg.slideshow_interval_ms || 10000;
  const showCaptions = cfg.show_captions !== false;
  const mediaTag = cfg.media_tag;

  // Load photos
  let query = supabase.from('media').select('id, url, caption').eq('category', 'mktg');
  if (mediaTag) {
    // Filter by tag if specified
    const { data: taggedIds } = await supabase
      .from('media_tag_assignments')
      .select('media_id, tag:tag_id(name)')
      .eq('tag.name', mediaTag);

    if (taggedIds && taggedIds.length > 0) {
      const ids = taggedIds.map(t => t.media_id);
      query = query.in('id', ids);
    }
  }

  const { data: photos } = await query.limit(50);
  if (!photos || photos.length === 0) {
    document.getElementById('slideshowMode').innerHTML =
      '<div class="tv-signage"><h1 class="tv-signage-message">No photos available</h1></div>';
    return;
  }

  slideshowPhotos = photos;
  slideshowIndex = 0;
  showSlide(showCaptions);

  slideshowTimer = setInterval(() => {
    slideshowIndex = (slideshowIndex + 1) % slideshowPhotos.length;
    showSlide(showCaptions);
  }, interval);
}

function showSlide(showCaptions) {
  const photo = slideshowPhotos[slideshowIndex];
  if (!photo) return;

  const img = document.getElementById('slideshowImage');
  const cap = document.getElementById('slideshowCaption');

  // Fade transition
  img.style.opacity = '0';
  setTimeout(() => {
    img.src = photo.url;
    img.onload = () => { img.style.opacity = '1'; };
    if (cap) cap.textContent = showCaptions && photo.caption ? photo.caption : '';
  }, 500);
}

// =============================================
// UTILITIES
// =============================================
function startPolling(fn) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fn, POLL_INTERVAL);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
