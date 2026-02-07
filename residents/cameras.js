/**
 * Cameras Page - Live camera feeds via HLS proxy
 * Loads stream config from camera_streams table, plays via HLS.js
 */

import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

let cameras = []; // grouped by camera_name

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
        streams: {},
      };
    }
    grouped[stream.camera_name].streams[stream.quality] = stream;
  }
  cameras = Object.values(grouped);
}

// =============================================
// RENDER
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
      <div class="camera-card__video" id="video-container-${i}">
        <video id="video-${i}" muted autoplay playsinline></video>
        <div class="camera-card__overlay" id="overlay-${i}">
          <div class="camera-card__loading">Connecting...</div>
        </div>
      </div>
    </div>
  `).join('');

  // Bind quality selectors
  grid.querySelectorAll('.quality-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.cam);
      retryCount[idx] = 0;
      startStream(idx, e.target.value);
    });
  });

  // Start all streams at low quality (most reliable, fastest to connect)
  cameras.forEach((cam, i) => {
    const defaultQuality = cam.streams.low ? 'low' : (cam.streams.med ? 'med' : 'high');
    // Set the select to match
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

function startStream(camIndex, quality) {
  const cam = cameras[camIndex];
  const stream = cam.streams[quality];
  if (!stream) return;

  const video = document.getElementById(`video-${camIndex}`);
  const overlay = document.getElementById(`overlay-${camIndex}`);
  const dot = document.getElementById(`dot-${camIndex}`);
  if (!video) return;

  // Clean up previous instance
  if (activeHls[camIndex]) {
    activeHls[camIndex].destroy();
    delete activeHls[camIndex];
  }

  // Initialize retry counter
  if (retryCount[camIndex] === undefined) retryCount[camIndex] = 0;

  const hlsUrl = `${stream.proxy_base_url}/${stream.stream_name}/index.m3u8`;

  overlay.classList.remove('hidden');
  const retries = retryCount[camIndex];
  overlay.querySelector('.camera-card__loading').textContent =
    retries === 0 ? 'Connecting...' : `Warming up camera... (${retries}/${MAX_RETRIES})`;
  dot.className = 'status-dot status-connecting';

  if (typeof Hls === 'undefined') {
    overlay.querySelector('.camera-card__loading').textContent = 'Player not available';
    dot.className = 'status-dot status-offline';
    return;
  }

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      manifestLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 2000,
      levelLoadingMaxRetry: 6,
      levelLoadingRetryDelay: 2000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 2000,
    });
    activeHls[camIndex] = hls;

    hls.loadSource(hlsUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      retryCount[camIndex] = 0;
      overlay.classList.add('hidden');
      dot.className = 'status-dot status-live';
      video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        hls.destroy();
        delete activeHls[camIndex];

        if (retryCount[camIndex] < MAX_RETRIES) {
          retryCount[camIndex]++;
          // Retry in 5s — camera needs time to warm up on-demand
          setTimeout(() => startStream(camIndex, quality), 5000);
        } else {
          overlay.classList.remove('hidden');
          overlay.querySelector('.camera-card__loading').textContent = 'Stream offline';
          dot.className = 'status-dot status-offline';
          // Long retry after max retries exhausted
          retryCount[camIndex] = 0;
          setTimeout(() => startStream(camIndex, quality), 30000);
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari/iOS)
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', () => {
      retryCount[camIndex] = 0;
      overlay.classList.add('hidden');
      dot.className = 'status-dot status-live';
      video.play().catch(() => {});
    }, { once: true });
    video.addEventListener('error', () => {
      if (retryCount[camIndex] < MAX_RETRIES) {
        retryCount[camIndex]++;
        setTimeout(() => startStream(camIndex, quality), 5000);
      } else {
        overlay.classList.remove('hidden');
        overlay.querySelector('.camera-card__loading').textContent = 'Stream offline';
        dot.className = 'status-dot status-offline';
        retryCount[camIndex] = 0;
        setTimeout(() => startStream(camIndex, quality), 30000);
      }
    }, { once: true });
  } else {
    overlay.querySelector('.camera-card__loading').textContent = 'Browser not supported';
    dot.className = 'status-dot status-offline';
  }
}
