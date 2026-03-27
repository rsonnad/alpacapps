/**
 * Kiosk Display - Hallway Tablet
 * No auth required. Polls data every 60s.
 * Landscape-optimized two-column layout.
 * Video/audio guestbook recording with R2 upload.
 */

import { supabase, SUPABASE_URL } from '../shared/supabase.js';

const POLL_INTERVAL = 60_000;        // 60s data refresh
const VERSION_CHECK_INTERVAL = 300_000; // 5min version check
const AUSTIN_TZ = 'America/Chicago';
const MAX_RECORD_SECONDS = 60;
let currentVersion = null;

// Hardcoded alpaca facts as fallback when edge function + DB both fail
const FALLBACK_FACTS = [
  "Alpacas hum to communicate — it's their primary social sound and can express curiosity, contentment, or concern.",
  "Baby alpacas are called 'crias' and can stand and walk within an hour of birth.",
  "Alpaca fiber comes in over 22 natural colors, from white to black and everything in between.",
  "Alpacas are herd animals and can become stressed or depressed if kept alone.",
  "Unlike llamas, alpacas rarely spit at humans — they mostly reserve it for disagreements with other alpacas.",
  "Alpacas have soft padded feet instead of hooves, making them gentle on terrain and pastures.",
  "An alpaca's fleece grows about 5 inches per year and is warmer, softer, and lighter than sheep's wool.",
  "Alpacas originated in the Andes Mountains of South America and were domesticated over 6,000 years ago.",
  "Alpacas have a communal dung pile — the whole herd uses the same spot, making cleanup easy.",
  "Alpacas can recognize individual humans and other animals by sight and sound.",
  "Alpacas have three stomach compartments, not four like cows, making them very efficient at digesting tough grasses.",
  "A single alpaca produces enough fleece each year to make several sweaters — about 5 to 10 pounds per shearing.",
  "Alpacas come in two breeds: Huacaya (fluffy, teddy bear-like) and Suri (long, silky dreadlocks).",
  "Alpacas can run up to 35 mph — fast enough to outrun most predators over short distances.",
  "The Incas considered alpaca fiber the 'fiber of the gods' and reserved the finest fleece for royalty.",
  "Alpacas rarely bite, kick, or charge — they're one of the gentlest domesticated animals on the planet.",
  "Alpacas communicate through body language, ear position, tail height, and over a dozen distinct vocalizations.",
  "Alpaca fleece is naturally hypoallergenic because it contains no lanolin, unlike sheep's wool.",
  "Alpacas have excellent memory and can remember routes, faces, and other alpacas for years.",
  "A group of alpacas is sometimes called a herd, but breeders often call them a 'string' of alpacas.",
  "Alpacas are incredibly curious — they'll investigate anything new in their environment by sniffing and staring.",
  "Alpacas sunbathe by lying flat on their sides with their legs stretched out, which can alarm new owners.",
  "Alpacas have been used as therapy animals because of their calm, gentle nature and soft fleece.",
  "The world alpaca population is about 3.5 million, with most still living in Peru, Bolivia, and Chile.",
  "Alpacas can live at altitudes above 15,000 feet — their blood is specially adapted to carry oxygen in thin air.",
  "Alpacas have a split upper lip that lets them nibble grass close to the ground without pulling out the roots.",
  "Male alpacas make a unique 'orgling' sound during mating that sounds like a cross between humming and gargling.",
  "Alpacas can crossbreed with llamas to produce a hybrid called a 'huarizo' — but this is rare in practice.",
  "Alpaca manure is so nutrient-rich and low in nitrogen that it can be used directly as garden fertilizer without composting.",
  "Alpacas have been guarding chickens and smaller livestock for centuries — their alert nature scares off foxes and hawks.",
];

let pollTimer = null;

// =============================================
// CLOCK
// =============================================
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: AUSTIN_TZ,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: AUSTIN_TZ,
  });
  const el = document.getElementById('datetime');
  if (el) el.textContent = `${dateStr} \u2022 ${timeStr}`;
}

// =============================================
// OCCUPANTS
// =============================================
async function loadOccupants() {
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

    if (!data || data.length === 0) {
      document.getElementById('occupantsGrid').innerHTML =
        '<span class="kiosk-empty">No current occupants</span>';
      return;
    }

    const current = data.filter(a => {
      if (!a.start_date) return false;
      if (a.start_date > today) return false;
      if (a.end_date && a.end_date < today) return false;
      return true;
    });

    if (current.length === 0) {
      document.getElementById('occupantsGrid').innerHTML =
        '<span class="kiosk-empty">No current occupants</span>';
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });

    const pills = current.map(a => {
      const name = a.person?.first_name || 'Guest';
      const spaces = (a.assignment_spaces || [])
        .map(as => as.space?.name)
        .filter(Boolean)
        .join(', ');
      const isNew = a.start_date >= sevenDaysAgoStr;
      return `<span class="occupant-pill${isNew ? ' occupant-new' : ''}">
        ${escapeHtml(name)}${spaces ? ` <span class="occupant-space">\u2022 ${escapeHtml(spaces)}</span>` : ''}
      </span>`;
    }).join('');

    document.getElementById('occupantsGrid').innerHTML = pills;
  } catch (err) {
    console.error('Failed to load occupants:', err);
  }
}

// =============================================
// EVENTS
// =============================================
async function loadEvents() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
    const { data } = await supabase
      .from('event_hosting_requests')
      .select('event_name, event_date, event_start_time, event_end_time')
      .eq('request_status', 'approved')
      .gte('event_date', today)
      .order('event_date')
      .limit(3);

    const section = document.getElementById('eventsSection');
    if (!data || data.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    const rows = data.map(e => {
      const dateObj = new Date(e.event_date + 'T12:00:00');
      const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: AUSTIN_TZ });
      const timeLabel = e.event_start_time
        ? formatTime(e.event_start_time) + (e.event_end_time ? ` - ${formatTime(e.event_end_time)}` : '')
        : '';
      return `<div class="event-row">
        <span class="event-date">${dateLabel}</span>
        <span class="event-name">${escapeHtml(e.event_name || 'Event')}</span>
        ${timeLabel ? `<span class="event-time">${timeLabel}</span>` : ''}
      </div>`;
    }).join('');

    document.getElementById('eventsList').innerHTML = rows;
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

// =============================================
// ALPACA FACT OF THE MOMENT (rotates through facts)
// =============================================
const FACT_ROTATE_INTERVAL = 20_000; // 20s per fact
let allFacts = [...FALLBACK_FACTS];
let currentFactIndex = 0;

async function loadFacts() {
  // Try to fetch recent facts from DB
  try {
    const { data } = await supabase
      .from('kiosk_facts')
      .select('fact_text')
      .order('generated_date', { ascending: false })
      .limit(10);
    if (data && data.length > 0) {
      allFacts = data.map(d => d.fact_text);
    }
  } catch (_) { /* use fallback array */ }

  // Also try to get today's fresh fact from edge function
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-daily-fact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.ok) {
      const { fact } = await resp.json();
      if (fact && !allFacts.includes(fact)) {
        allFacts.unshift(fact); // add to front
        if (allFacts.length > 10) allFacts.length = 10;
      }
    }
  } catch (_) { /* ignore */ }

  // Show the first fact
  showNextFact();
  // Rotate every 30s
  setInterval(showNextFact, FACT_ROTATE_INTERVAL);
}

function showNextFact() {
  const el = document.getElementById('factText');
  if (!el || allFacts.length === 0) return;
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = allFacts[currentFactIndex % allFacts.length];
    el.style.opacity = '1';
    currentFactIndex++;
  }, 400);
}

// =============================================
// GUESTBOOK
// =============================================
async function loadGuestbook() {
  try {
    const { data } = await supabase
      .from('guestbook_entries')
      .select('guest_name, message, video_url, audio_url, media_type, created_at')
      .order('created_at', { ascending: false })
      .limit(8);

    const container = document.getElementById('guestbookEntries');
    if (!data || data.length === 0) {
      container.innerHTML = '<span class="kiosk-empty">No messages yet — be the first!</span>';
      return;
    }

    container.innerHTML = data.map(entry => {
      const ago = timeAgo(new Date(entry.created_at));
      const name = entry.guest_name || 'Anonymous';
      const type = entry.media_type || 'text';
      const badge = type !== 'text' ? `<span class="entry-type-badge">${type}</span>` : '';

      let mediaHtml = '';
      if (entry.video_url) {
        mediaHtml = `<div class="guestbook-entry-media">
          <video class="guestbook-thumb" src="${escapeHtml(entry.video_url)}#t=0.5"
                 controls playsinline preload="metadata"></video>
        </div>`;
      } else if (entry.audio_url) {
        mediaHtml = `<div class="guestbook-entry-media">
          <audio class="guestbook-audio-player" src="${escapeHtml(entry.audio_url)}"
                 controls preload="metadata"></audio>
        </div>`;
      }

      const msgHtml = entry.message
        ? `<p class="guestbook-entry-msg">${escapeHtml(entry.message)}</p>`
        : '';

      return `<div class="guestbook-entry">
        <div class="guestbook-entry-header">
          <span class="guestbook-entry-name">${escapeHtml(name)}${badge}</span>
          <span class="guestbook-entry-time">${ago}</span>
        </div>
        ${msgHtml}
        ${mediaHtml}
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load guestbook:', err);
  }
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: AUSTIN_TZ });
}

async function submitGuestbookEntry() {
  const nameEl = document.getElementById('guestName');
  const msgEl = document.getElementById('guestMessage');
  const btn = document.getElementById('guestSubmit');
  const message = msgEl.value.trim();

  if (!message) {
    msgEl.placeholder = 'Please write a message first...';
    msgEl.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { error } = await supabase
      .from('guestbook_entries')
      .insert({
        guest_name: nameEl.value.trim() || null,
        message,
        entry_type: 'text',
        media_type: 'text',
        source: 'kiosk',
      });

    if (error) throw error;

    nameEl.value = '';
    msgEl.value = '';
    btn.textContent = 'Signed!';
    setTimeout(() => { btn.textContent = 'Sign'; btn.disabled = false; }, 2000);
    loadGuestbook();
  } catch (err) {
    console.error('Failed to submit guestbook entry:', err);
    btn.textContent = 'Error — try again';
    setTimeout(() => { btn.textContent = 'Sign'; btn.disabled = false; }, 2000);
  }
}

// =============================================
// MEDIA RECORDING (Video / Audio)
// =============================================
let mediaRecorder = null;
let recordedChunks = [];
let recordingType = null; // 'video' or 'audio'
let recordTimerInterval = null;
let recordStartTime = null;
let mediaStream = null;

async function showRecorder(type) {
  recordingType = type;
  const ui = document.getElementById('recorderUI');
  const preview = document.getElementById('recorderPreview');
  const startStopBtn = document.getElementById('recorderStartStop');
  const timerEl = document.getElementById('recorderTimer');

  ui.style.display = '';
  startStopBtn.textContent = 'Connecting...';
  startStopBtn.disabled = true;
  delete startStopBtn.dataset.retry;
  timerEl.textContent = '0:00';
  recordedChunks = [];

  if (type === 'audio') {
    preview.classList.add('audio-only');
    preview.style.display = 'none';
  } else {
    preview.classList.remove('audio-only');
    preview.style.display = '';
  }

  // Check API availability
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    timerEl.textContent = 'Recording not supported on this browser';
    startStopBtn.textContent = 'Unavailable';
    console.error('getUserMedia not available — requires HTTPS');
    return;
  }

  const constraints = type === 'video'
    ? { video: { facingMode: 'user', width: 640, height: 480 }, audio: true }
    : { audio: true };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    mediaStream = stream;
    if (type === 'video') {
      preview.srcObject = stream;
    }
    startStopBtn.textContent = 'Start Recording';
    startStopBtn.disabled = false;
  } catch (err) {
    console.error('Camera/mic access denied:', err);
    const reason = err.name === 'NotAllowedError'
      ? 'Permission denied — tap Allow when prompted'
      : err.name === 'NotFoundError'
      ? `No ${type === 'video' ? 'camera' : 'microphone'} found`
      : err.name === 'NotReadableError'
      ? 'Device busy — close other apps using camera/mic'
      : `Error: ${err.message}`;
    timerEl.textContent = reason;
    startStopBtn.textContent = 'Retry';
    startStopBtn.disabled = false;
    startStopBtn.dataset.retry = type;
  }
}

function hideRecorder() {
  const ui = document.getElementById('recorderUI');
  ui.style.display = 'none';
  stopMediaStream();
  if (recordTimerInterval) {
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordedChunks = [];
}

function stopMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  const preview = document.getElementById('recorderPreview');
  if (preview) preview.srcObject = null;
}

function toggleRecording() {
  const btn = document.getElementById('recorderStartStop');
  const timerEl = document.getElementById('recorderTimer');

  // Retry state — re-attempt getUserMedia
  if (btn.dataset.retry) {
    const retryType = btn.dataset.retry;
    delete btn.dataset.retry;
    showRecorder(retryType);
    return;
  }

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    // Start recording
    if (!mediaStream) return;

    const mimeType = recordingType === 'video'
      ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
      : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm');

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      clearInterval(recordTimerInterval);
      stopMediaStream();
      if (recordedChunks.length > 0) {
        const blob = new Blob(recordedChunks, { type: mimeType });
        uploadMediaEntry(blob, recordingType);
      }
    };

    mediaRecorder.start(1000); // collect every 1s
    recordStartTime = Date.now();
    btn.textContent = 'Stop';
    btn.style.background = 'var(--kiosk-red)';

    recordTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      if (elapsed >= MAX_RECORD_SECONDS) {
        mediaRecorder.stop();
      }
    }, 500);

  } else if (mediaRecorder.state === 'recording') {
    // Stop recording
    mediaRecorder.stop();
    btn.textContent = 'Processing...';
    btn.style.background = '';
  }
}

async function uploadMediaEntry(blob, type) {
  const uploadUI = document.getElementById('uploadUI');
  const uploadFill = document.getElementById('uploadFill');
  const uploadLabel = document.getElementById('uploadLabel');
  const recorderUI = document.getElementById('recorderUI');

  recorderUI.style.display = 'none';
  uploadUI.style.display = '';
  uploadFill.style.width = '10%';
  uploadLabel.textContent = 'Uploading...';

  try {
    const guestName = document.getElementById('guestName').value.trim() || null;
    const ext = type === 'video' ? 'webm' : 'webm';
    const filename = `guestbook/${type}/${Date.now()}.${ext}`;

    // Upload to R2 via edge function
    uploadFill.style.width = '30%';

    const formData = new FormData();
    formData.append('file', blob, `recording.${ext}`);
    formData.append('key', filename);
    formData.append('guest_name', guestName || '');
    formData.append('media_type', type);
    formData.append('content_type', blob.type);

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/guestbook-upload`, {
      method: 'POST',
      body: formData,
    });

    uploadFill.style.width = '90%';

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Upload failed: ${errText}`);
    }

    uploadFill.style.width = '100%';
    uploadLabel.textContent = 'Posted!';
    setTimeout(() => { uploadUI.style.display = 'none'; }, 2000);
    loadGuestbook();

  } catch (err) {
    console.error('Upload failed:', err);
    uploadLabel.textContent = 'Upload failed — try again';
    setTimeout(() => { uploadUI.style.display = 'none'; }, 3000);
  }
}

// =============================================
// PAI QUERY COUNT
// =============================================
async function loadPaiCount() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('pai_interactions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);

    const el = document.getElementById('paiCount');
    if (count !== null && count > 0) {
      el.textContent = `${count} AI quer${count === 1 ? 'y' : 'ies'} today`;
    } else {
      el.textContent = '';
    }
  } catch (err) {
    console.error('Failed to load PAI count:', err);
  }
}

// =============================================
// VERSION CHECK + AUTO-RELOAD
// =============================================
async function checkVersion() {
  try {
    const resp = await fetch('/version.json?t=' + Date.now());
    if (!resp.ok) return;
    const data = await resp.json();
    const ver = data.version || data.sha;
    const versionEl = document.querySelector('.kiosk-version');
    const appVer = (typeof AlpacaKiosk !== 'undefined' && AlpacaKiosk.getAppVersion)
      ? AlpacaKiosk.getAppVersion() : null;
    const label = (data.version || '') + (appVer ? ` | app ${appVer}` : '');
    if (versionEl) versionEl.textContent = label;
    if (!currentVersion) {
      currentVersion = ver;
      return;
    }
    if (ver !== currentVersion) {
      console.log('New version detected, reloading...', ver);
      window.location.reload();
    }
  } catch (_) { /* ignore */ }
}

// =============================================
// NETWORK HEALTH DASHBOARD
// =============================================
async function refreshNetworkDashboard() {
  // 1. Internet connectivity + latency (ping Supabase health endpoint)
  const statusEl = document.getElementById('netStatusValue');
  const statusSub = document.getElementById('netStatusSub');
  const latencyEl = document.getElementById('netLatencyValue');
  const latencySub = document.getElementById('netLatencySub');
  const connEl = document.getElementById('netConnValue');
  const connSub = document.getElementById('netConnSub');
  const apiEl = document.getElementById('netApiValue');
  const apiSub = document.getElementById('netApiSub');

  // Internet check via Supabase health
  try {
    const t0 = performance.now();
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Math.round(performance.now() - t0);

    if (resp.ok || resp.status === 401) {
      statusEl.textContent = 'Online';
      statusEl.className = 'net-dash-card-value status-good';
      statusSub.textContent = 'Internet connected';

      latencyEl.textContent = `${latencyMs}ms`;
      latencyEl.className = 'net-dash-card-value ' + (latencyMs < 200 ? 'status-good' : latencyMs < 500 ? 'status-warn' : 'status-bad');
      latencySub.textContent = latencyMs < 200 ? 'Excellent' : latencyMs < 500 ? 'Fair' : 'Slow';
    } else {
      statusEl.textContent = 'Degraded';
      statusEl.className = 'net-dash-card-value status-warn';
      statusSub.textContent = `HTTP ${resp.status}`;
      latencyEl.textContent = `${latencyMs}ms`;
      latencyEl.className = 'net-dash-card-value status-warn';
      latencySub.textContent = '';
    }
  } catch (err) {
    statusEl.textContent = 'Offline';
    statusEl.className = 'net-dash-card-value status-bad';
    statusSub.textContent = 'No internet connection';
    latencyEl.textContent = '--';
    latencyEl.className = 'net-dash-card-value status-bad';
    latencySub.textContent = 'Unreachable';
  }

  // 2. Connection info from navigator.connection
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    const type = conn.effectiveType ? conn.effectiveType.toUpperCase() : conn.type || 'Unknown';
    connEl.textContent = type;
    connEl.className = 'net-dash-card-value ' + (type === '4G' || type === 'WIFI' ? 'status-good' : type === '3G' ? 'status-warn' : '');
    const parts = [];
    if (conn.downlink) parts.push(`${conn.downlink} Mbps down`);
    if (conn.rtt) parts.push(`${conn.rtt}ms RTT`);
    connSub.textContent = parts.join(' \u2022 ') || conn.type || '';
  } else {
    connEl.textContent = 'WiFi';
    connEl.className = 'net-dash-card-value status-good';
    connSub.textContent = '';
  }

  // 3. Supabase API check (actual query)
  try {
    const t0 = performance.now();
    const { data, error } = await supabase.from('guestbook_entries').select('id').limit(1);
    const ms = Math.round(performance.now() - t0);
    if (!error) {
      apiEl.textContent = 'Healthy';
      apiEl.className = 'net-dash-card-value status-good';
      apiSub.textContent = `${ms}ms response`;
    } else {
      apiEl.textContent = 'Error';
      apiEl.className = 'net-dash-card-value status-warn';
      apiSub.textContent = error.message?.slice(0, 40) || '';
    }
  } catch (_) {
    apiEl.textContent = 'Down';
    apiEl.className = 'net-dash-card-value status-bad';
    apiSub.textContent = 'Cannot reach API';
  }
}

// =============================================
// 3-VIEW ROTATION: Network (15s) → Slideshow (15s) → Kiosk (15s)
// Tap any overlay to dismiss → 2 min kiosk before resuming
// =============================================
const ROTATION_SECONDS = 15;          // each view shows for 15s
const TAP_DISMISS_SECONDS = 120;      // 2 min kiosk after user taps
// Views cycle: KIOSK → NETWORK → SLIDESHOW → KIOSK → ...
const ROTATION_VIEWS = ['kiosk', 'network', 'slideshow'];
let rotationTimer = null;
let rotationIndex = 0;  // start at kiosk
let slideshowImages = [];
let slideshowIndex = 0;

async function loadSlideshowImages() {
  try {
    const { data } = await supabase
      .from('image_gen_jobs')
      .select('result_url, metadata')
      .eq('status', 'completed')
      .ilike('metadata->>prompt', '%alpaca%')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data && data.length > 0) {
      slideshowImages = data.map(d => ({
        url: d.result_url,
        caption: d.metadata?.title || '',
      }));
    }
  } catch (_) { /* no images available */ }
}

function showView(viewName) {
  const networkOverlay = document.getElementById('networkOverlay');
  const slideshowOverlay = document.getElementById('slideshowOverlay');

  // Hide all overlays first
  networkOverlay.classList.remove('visible');
  slideshowOverlay.classList.remove('visible');

  // After fade-out transition, hide display
  setTimeout(() => {
    if (viewName !== 'network') networkOverlay.style.display = 'none';
    if (viewName !== 'slideshow') slideshowOverlay.style.display = 'none';
  }, 800);

  if (viewName === 'network') {
    refreshNetworkDashboard();
    networkOverlay.style.display = '';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => networkOverlay.classList.add('visible'));
    });
  } else if (viewName === 'slideshow') {
    if (slideshowImages.length === 0) {
      // Skip slideshow if no images, advance to next view
      scheduleNextView();
      return;
    }
    const img = document.getElementById('slideshowImage');
    const caption = document.getElementById('slideshowCaption');
    const slide = slideshowImages[slideshowIndex % slideshowImages.length];
    slideshowIndex++;
    img.src = slide.url;
    caption.textContent = slide.caption;
    slideshowOverlay.style.display = '';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => slideshowOverlay.classList.add('visible'));
    });
  }
  // viewName === 'kiosk' → both overlays hidden, main content visible
}

function advanceRotation() {
  rotationIndex = (rotationIndex + 1) % ROTATION_VIEWS.length;
  const view = ROTATION_VIEWS[rotationIndex];
  showView(view);
  scheduleNextView();
}

function scheduleNextView() {
  if (rotationTimer) clearTimeout(rotationTimer);
  rotationTimer = setTimeout(advanceRotation, ROTATION_SECONDS * 1000);
}

function startRotation() {
  rotationIndex = 0; // start at kiosk
  showView('kiosk');
  scheduleNextView();
}

// Tap overlay to dismiss → 2 min kiosk before resuming
function onRotationTap() {
  if (rotationTimer) clearTimeout(rotationTimer);
  rotationIndex = 0;
  showView('kiosk');
  rotationTimer = setTimeout(advanceRotation, TAP_DISMISS_SECONDS * 1000);
}

// =============================================
// REFRESH & INIT
// =============================================
async function refreshAll() {
  await Promise.allSettled([
    loadOccupants(),
    loadEvents(),
    loadGuestbook(),
    loadPaiCount(),
  ]);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshAll, POLL_INTERVAL);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  updateClock();
  setInterval(updateClock, 1000);

  // Load fact once (doesn't change during the day)
  loadFacts();

  // Version check + auto-reload every 5 min
  checkVersion();
  setInterval(checkVersion, VERSION_CHECK_INTERVAL);

  // Guestbook text submit
  document.getElementById('guestSubmit')?.addEventListener('click', submitGuestbookEntry);

  // Allow Enter in message textarea to submit (Shift+Enter for newline)
  document.getElementById('guestMessage')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitGuestbookEntry();
    }
  });

  // Media recording buttons
  document.getElementById('recordVideoBtn')?.addEventListener('click', () => showRecorder('video'));
  document.getElementById('recordAudioBtn')?.addEventListener('click', () => showRecorder('audio'));
  document.getElementById('recorderStartStop')?.addEventListener('click', toggleRecording);
  document.getElementById('recorderCancel')?.addEventListener('click', hideRecorder);

  // Rotation overlays: tap to dismiss
  document.getElementById('networkOverlay')?.addEventListener('click', onRotationTap);
  document.getElementById('slideshowOverlay')?.addEventListener('click', onRotationTap);

  // Load dynamic data
  await refreshAll();
  startPolling();

  // Load slideshow images and start 3-view rotation
  await loadSlideshowImages();
  startRotation();

  // Visibility-based polling pause
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
    } else {
      refreshAll();
      startPolling();
    }
  });
});
