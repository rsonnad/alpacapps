/**
 * Cameras Page - Live camera feeds via go2rtc + HLS proxy
 * Loads stream config from camera_streams table, plays via HLS.js
 * Features: quality selection, PTZ controls, lightbox with navigation
 */

import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

let cameras = []; // grouped by camera_name
let currentQualities = {}; // track selected quality per cam index

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'cameras',
    requiredRole: 'resident',
    onReady: async () => {
      await loadCameras();
      renderCameras();
      renderLightbox();
      bindKeyboard();
    },
  });
});

// =============================================
// DATA
// =============================================
async function loadCameras() {
  const { data, error } = await supabase
    .from('camera_streams')
    .select('*')
    .eq('is_active', true)
    .order('camera_name')
    .order('quality');

  if (error) {
    console.error('Failed to load camera streams:', error);
    showToast('Failed to load cameras', 'error');
    return;
  }

  // Group by camera_name
  const grouped = {};
  for (const stream of data) {
    if (!grouped[stream.camera_name]) {
      grouped[stream.camera_name] = {
        name: stream.camera_name,
        location: stream.location,
        protectUrl: stream.protect_share_url,
        protectCameraId: stream.protect_camera_id,
        streams: {},
      };
    }
    grouped[stream.camera_name].streams[stream.quality] = stream;
  }
  cameras = Object.values(grouped);
}

// =============================================
// RENDER CAMERA GRID
// =============================================
function renderCameras() {
  const grid = document.getElementById('cameraGrid');
  if (!grid) return;

  if (!cameras.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">No cameras configured.</p>';
    return;
  }

  grid.innerHTML = cameras.map((cam, i) => `
    <div class="camera-card" data-cam-index="${i}">
      <div class="camera-card__label">
        <span class="status-dot" id="dot-${i}"></span>
        <span>${cam.name}</span>
        <div class="camera-card__controls">
          <select class="quality-select" data-cam="${i}">
            ${cam.streams.low ? '<option value="low">Low</option>' : ''}
            ${cam.streams.med ? '<option value="med" selected>Med</option>' : ''}
            ${cam.streams.high ? '<option value="high">High</option>' : ''}
          </select>
          <span style="font-weight:400;color:var(--text-muted);font-size:0.7rem">${cam.location || ''}</span>
        </div>
      </div>
      <div class="camera-card__video" id="video-container-${i}" data-cam="${i}">
        <video id="video-${i}" muted autoplay playsinline></video>
        <div class="camera-card__overlay" id="overlay-${i}">
          <div class="camera-card__loading">Connecting...</div>
        </div>
        <!-- Expand button -->
        <button class="camera-card__expand" data-cam="${i}" title="Fullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        ${cam.protectCameraId ? `
        <!-- PTZ Controls -->
        <div class="ptz-controls" id="ptz-${i}">
          <button class="ptz-btn ptz-up" data-cam="${i}" data-dir="up" title="Tilt Up">▲</button>
          <button class="ptz-btn ptz-left" data-cam="${i}" data-dir="left" title="Pan Left">◀</button>
          <button class="ptz-btn ptz-home" data-cam="${i}" data-dir="home" title="Home Position">⌂</button>
          <button class="ptz-btn ptz-right" data-cam="${i}" data-dir="right" title="Pan Right">▶</button>
          <button class="ptz-btn ptz-down" data-cam="${i}" data-dir="down" title="Tilt Down">▼</button>
          <button class="ptz-btn ptz-zoomin" data-cam="${i}" data-dir="zoomin" title="Zoom In">+</button>
          <button class="ptz-btn ptz-zoomout" data-cam="${i}" data-dir="zoomout" title="Zoom Out">−</button>
        </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Bind quality selectors
  grid.querySelectorAll('.quality-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.cam);
      currentQualities[idx] = e.target.value;
      retryCount[idx] = 0;
      startStream(idx, e.target.value);
    });
  });

  // Bind expand buttons
  grid.querySelectorAll('.camera-card__expand').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.cam);
      openLightbox(idx);
    });
  });

  // Bind PTZ buttons (press and hold for continuous, release to stop)
  grid.querySelectorAll('.ptz-btn').forEach(btn => {
    bindPtzButton(btn);
  });

  // Also allow clicking on video container to open lightbox
  grid.querySelectorAll('.camera-card__video').forEach(container => {
    container.addEventListener('dblclick', (e) => {
      if (e.target.closest('.ptz-btn') || e.target.closest('.camera-card__expand')) return;
      const idx = parseInt(container.dataset.cam);
      openLightbox(idx);
    });
  });

  // Start all streams at low quality
  cameras.forEach((cam, i) => {
    const defaultQuality = cam.streams.low ? 'low' : (cam.streams.med ? 'med' : 'high');
    currentQualities[i] = defaultQuality;
    const select = grid.querySelector(`.quality-select[data-cam="${i}"]`);
    if (select) select.value = defaultQuality;
    startStream(i, defaultQuality);
  });
}

// =============================================
// HLS PLAYBACK
// =============================================
const activeHls = {};   // track Hls instances for cleanup
const retryCount = {};  // retry counter per camera
const MAX_RETRIES = 8;  // ~40s of retrying (5s intervals)

function startStream(camIndex, quality, videoElementId) {
  const cam = cameras[camIndex];
  const stream = cam.streams[quality];
  if (!stream) return;

  const videoId = videoElementId || `video-${camIndex}`;
  const video = document.getElementById(videoId);
  const overlayId = videoElementId ? 'lightbox-overlay-inner' : `overlay-${camIndex}`;
  const overlay = document.getElementById(overlayId);
  const dotId = videoElementId ? null : `dot-${camIndex}`;
  const dot = dotId ? document.getElementById(dotId) : null;
  if (!video) return;

  // Determine HLS tracking key (grid uses camIndex, lightbox uses 'lb')
  const hlsKey = videoElementId ? 'lb' : camIndex;

  // Clean up previous instance
  if (activeHls[hlsKey]) {
    activeHls[hlsKey].destroy();
    delete activeHls[hlsKey];
  }

  // Initialize retry counter
  if (retryCount[hlsKey] === undefined) retryCount[hlsKey] = 0;

  const hlsUrl = `${stream.proxy_base_url}/api/stream.m3u8?src=${stream.stream_name}&mp4`;

  if (overlay) {
    overlay.classList.remove('hidden');
    const retries = retryCount[hlsKey];
    const loadingEl = overlay.querySelector('.camera-card__loading') || overlay;
    if (loadingEl.classList) {
      loadingEl.textContent = retries === 0 ? 'Connecting...' : `Warming up camera... (${retries}/${MAX_RETRIES})`;
    }
  }
  if (dot) dot.className = 'status-dot status-connecting';

  if (typeof Hls === 'undefined') {
    if (overlay) {
      const loadingEl = overlay.querySelector('.camera-card__loading') || overlay;
      loadingEl.textContent = 'Player not available';
    }
    if (dot) dot.className = 'status-dot status-offline';
    return;
  }

  if (Hls.isSupported()) {
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
    activeHls[hlsKey] = hls;

    hls.loadSource(hlsUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      retryCount[hlsKey] = 0;
      if (overlay) overlay.classList.add('hidden');
      if (dot) dot.className = 'status-dot status-live';
      video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        console.warn(`[Camera ${camIndex}] Media error, attempting recovery`);
        hls.recoverMediaError();
        return;
      }

      hls.destroy();
      delete activeHls[hlsKey];

      if (retryCount[hlsKey] < MAX_RETRIES) {
        retryCount[hlsKey]++;
        setTimeout(() => startStream(camIndex, quality, videoElementId), 5000);
      } else {
        if (overlay) {
          overlay.classList.remove('hidden');
          const loadingEl = overlay.querySelector('.camera-card__loading') || overlay;
          loadingEl.textContent = 'Stream offline';
        }
        if (dot) dot.className = 'status-dot status-offline';
        retryCount[hlsKey] = 0;
        setTimeout(() => startStream(camIndex, quality, videoElementId), 30000);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari/iOS)
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', () => {
      retryCount[camIndex] = 0;
      if (overlay) overlay.classList.add('hidden');
      if (dot) dot.className = 'status-dot status-live';
      video.play().catch(() => {});
    }, { once: true });
    video.addEventListener('error', () => {
      if (retryCount[camIndex] < MAX_RETRIES) {
        retryCount[camIndex]++;
        setTimeout(() => startStream(camIndex, quality, videoElementId), 5000);
      } else {
        if (overlay) {
          overlay.classList.remove('hidden');
          const loadingEl = overlay.querySelector('.camera-card__loading') || overlay;
          loadingEl.textContent = 'Stream offline';
        }
        if (dot) dot.className = 'status-dot status-offline';
        retryCount[camIndex] = 0;
        setTimeout(() => startStream(camIndex, quality, videoElementId), 30000);
      }
    }, { once: true });
  } else {
    if (overlay) {
      const loadingEl = overlay.querySelector('.camera-card__loading') || overlay;
      loadingEl.textContent = 'Browser not supported';
    }
    if (dot) dot.className = 'status-dot status-offline';
  }
}

// =============================================
// PTZ CONTROLS
// =============================================
const PTZ_PROXY_BASE = 'https://cam.alpacaplayhouse.com/ptz';
let activePtzTimers = {};

function bindPtzButton(btn) {
  const dir = btn.dataset.dir;

  if (dir === 'home') {
    // Home is a single click action
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.cam);
      sendPtzCommand(idx, 'home');
    });
    return;
  }

  // Continuous move: start on mousedown/touchstart, stop on mouseup/touchend
  let pressing = false;

  const startPress = (e) => {
    e.preventDefault();
    pressing = true;
    const idx = parseInt(btn.dataset.cam);
    sendPtzCommand(idx, dir);
    btn.classList.add('active');
  };

  const endPress = (e) => {
    e.preventDefault();
    if (!pressing) return;
    pressing = false;
    const idx = parseInt(btn.dataset.cam);
    sendPtzCommand(idx, 'stop');
    btn.classList.remove('active');
  };

  btn.addEventListener('mousedown', startPress);
  btn.addEventListener('touchstart', startPress, { passive: false });
  document.addEventListener('mouseup', endPress);
  document.addEventListener('touchend', endPress);
  btn.addEventListener('mouseleave', () => {
    if (pressing) {
      pressing = false;
      const idx = parseInt(btn.dataset.cam);
      sendPtzCommand(idx, 'stop');
      btn.classList.remove('active');
    }
  });
}

async function sendPtzCommand(camIndex, direction) {
  const cam = cameras[camIndex];
  if (!cam || !cam.protectCameraId) {
    showToast('PTZ not available for this camera', 'error');
    return;
  }

  const speed = 500; // moderate speed out of -750 to 750 range
  let payload;

  switch (direction) {
    case 'up':
      payload = { action: 'move', x: 0, y: speed, z: 0 };
      break;
    case 'down':
      payload = { action: 'move', x: 0, y: -speed, z: 0 };
      break;
    case 'left':
      payload = { action: 'move', x: -speed, y: 0, z: 0 };
      break;
    case 'right':
      payload = { action: 'move', x: speed, y: 0, z: 0 };
      break;
    case 'zoomin':
      payload = { action: 'move', x: 0, y: 0, z: speed };
      break;
    case 'zoomout':
      payload = { action: 'move', x: 0, y: 0, z: -speed };
      break;
    case 'stop':
      payload = { action: 'move', x: 0, y: 0, z: 0 };
      break;
    case 'home':
      payload = { action: 'goto', slot: -1 };
      break;
    default:
      return;
  }

  try {
    const resp = await fetch(`${PTZ_PROXY_BASE}/${cam.protectCameraId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('PTZ error:', err);
      if (direction !== 'stop') {
        showToast('PTZ command failed', 'error');
      }
    }
  } catch (err) {
    console.error('PTZ network error:', err);
    if (direction !== 'stop') {
      showToast('PTZ unavailable', 'error');
    }
  }
}

// =============================================
// LIGHTBOX
// =============================================
let lightboxOpen = false;
let lightboxCamIndex = 0;
let lightboxQuality = null; // null = use same as grid

function renderLightbox() {
  // Create lightbox overlay (once)
  const lb = document.createElement('div');
  lb.id = 'cameraLightbox';
  lb.className = 'camera-lightbox hidden';
  lb.innerHTML = `
    <div class="camera-lightbox__backdrop"></div>
    <div class="camera-lightbox__content">
      <div class="camera-lightbox__header">
        <div class="camera-lightbox__title">
          <span class="status-dot" id="lb-dot"></span>
          <span id="lb-name"></span>
          <span id="lb-location" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:0.5rem"></span>
        </div>
        <div class="camera-lightbox__header-controls">
          <select class="quality-select" id="lb-quality">
            <option value="low">Low</option>
            <option value="med" selected>Med</option>
            <option value="high">High</option>
          </select>
          <button class="camera-lightbox__close" id="lb-close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="camera-lightbox__video-wrap">
        <button class="camera-lightbox__nav camera-lightbox__nav--prev" id="lb-prev" title="Previous camera (←)">‹</button>
        <div class="camera-lightbox__video-container">
          <video id="lb-video" muted autoplay playsinline></video>
          <div class="camera-card__overlay" id="lightbox-overlay-inner">
            <div class="camera-card__loading">Connecting...</div>
          </div>
        </div>
        <button class="camera-lightbox__nav camera-lightbox__nav--next" id="lb-next" title="Next camera (→)">›</button>
      </div>
      <div class="camera-lightbox__ptz" id="lb-ptz">
        <button class="ptz-btn ptz-up" data-dir="up" title="Tilt Up">▲</button>
        <button class="ptz-btn ptz-left" data-dir="left" title="Pan Left">◀</button>
        <button class="ptz-btn ptz-home" data-dir="home" title="Home Position">⌂</button>
        <button class="ptz-btn ptz-right" data-dir="right" title="Pan Right">▶</button>
        <button class="ptz-btn ptz-down" data-dir="down" title="Tilt Down">▼</button>
        <button class="ptz-btn ptz-zoomin" data-dir="zoomin" title="Zoom In">+</button>
        <button class="ptz-btn ptz-zoomout" data-dir="zoomout" title="Zoom Out">−</button>
      </div>
    </div>
  `;
  document.body.appendChild(lb);

  // Bind lightbox controls
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  lb.querySelector('.camera-lightbox__backdrop').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => navigateLightbox(-1));
  document.getElementById('lb-next').addEventListener('click', () => navigateLightbox(1));

  // Quality selector
  document.getElementById('lb-quality').addEventListener('change', (e) => {
    lightboxQuality = e.target.value;
    retryCount['lb'] = 0;
    startStream(lightboxCamIndex, lightboxQuality, 'lb-video');
  });

  // PTZ in lightbox
  lb.querySelectorAll('#lb-ptz .ptz-btn').forEach(btn => {
    const dir = btn.dataset.dir;
    if (dir === 'home') {
      btn.addEventListener('click', () => sendPtzCommand(lightboxCamIndex, 'home'));
      return;
    }
    let pressing = false;
    const startPress = (e) => {
      e.preventDefault();
      pressing = true;
      sendPtzCommand(lightboxCamIndex, dir);
      btn.classList.add('active');
    };
    const endPress = (e) => {
      e.preventDefault();
      if (!pressing) return;
      pressing = false;
      sendPtzCommand(lightboxCamIndex, 'stop');
      btn.classList.remove('active');
    };
    btn.addEventListener('mousedown', startPress);
    btn.addEventListener('touchstart', startPress, { passive: false });
    document.addEventListener('mouseup', endPress);
    document.addEventListener('touchend', endPress);
    btn.addEventListener('mouseleave', () => {
      if (pressing) {
        pressing = false;
        sendPtzCommand(lightboxCamIndex, 'stop');
        btn.classList.remove('active');
      }
    });
  });
}

function openLightbox(camIndex) {
  lightboxOpen = true;
  lightboxCamIndex = camIndex;
  const cam = cameras[camIndex];

  // Use current grid quality or default
  lightboxQuality = currentQualities[camIndex] || 'med';

  // Update UI
  document.getElementById('lb-name').textContent = cam.name;
  document.getElementById('lb-location').textContent = cam.location || '';

  // Update quality dropdown options based on available streams
  const qualitySelect = document.getElementById('lb-quality');
  qualitySelect.innerHTML = '';
  if (cam.streams.low) qualitySelect.innerHTML += '<option value="low">Low</option>';
  if (cam.streams.med) qualitySelect.innerHTML += '<option value="med">Med</option>';
  if (cam.streams.high) qualitySelect.innerHTML += '<option value="high">High</option>';
  qualitySelect.value = lightboxQuality;

  // Show/hide PTZ
  const ptzContainer = document.getElementById('lb-ptz');
  ptzContainer.style.display = cam.protectCameraId ? '' : 'none';

  // Show/hide nav buttons
  document.getElementById('lb-prev').style.visibility = cameras.length > 1 ? 'visible' : 'hidden';
  document.getElementById('lb-next').style.visibility = cameras.length > 1 ? 'visible' : 'hidden';

  // Show lightbox
  document.getElementById('cameraLightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Start stream
  retryCount['lb'] = 0;
  startStream(camIndex, lightboxQuality, 'lb-video');
}

function closeLightbox() {
  lightboxOpen = false;
  document.getElementById('cameraLightbox').classList.add('hidden');
  document.body.style.overflow = '';

  // Clean up lightbox HLS
  if (activeHls['lb']) {
    activeHls['lb'].destroy();
    delete activeHls['lb'];
  }
}

function navigateLightbox(delta) {
  if (!cameras.length) return;
  lightboxCamIndex = (lightboxCamIndex + delta + cameras.length) % cameras.length;
  openLightbox(lightboxCamIndex);
}

// =============================================
// KEYBOARD SHORTCUTS
// =============================================
function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!lightboxOpen) return;

    switch (e.key) {
      case 'Escape':
        closeLightbox();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        navigateLightbox(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        navigateLightbox(1);
        break;
    }
  });
}
