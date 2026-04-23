/**
 * Kiosk Display - Hallway Tablet
 * No auth required. Polls data every 60s.
 * Landscape-optimized two-column layout.
 * Video/audio guestbook recording with R2 upload.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/supabase.js';

const POLL_INTERVAL = 60_000;        // 60s data refresh

/** Escape HTML to prevent XSS in innerHTML contexts */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const VERSION_CHECK_INTERVAL = 300_000; // 5min version check
const AUSTIN_TZ = 'America/Chicago';
const MAX_RECORD_SECONDS = 60;
let currentVersion = null;

// Hardcoded alpaca facts as fallback when edge function + DB both fail
const FALLBACK_FACTS = [
  // Communication & behavior
  "Alpacas hum to communicate — it's their primary social sound and can express curiosity, contentment, or concern.",
  "Unlike llamas, alpacas rarely spit at humans — they mostly reserve it for disagreements with other alpacas.",
  "Alpacas communicate through body language, ear position, tail height, and over a dozen distinct vocalizations.",
  "Male alpacas make a unique 'orgling' sound during mating that sounds like a cross between humming and gargling.",
  "Alpacas are incredibly curious — they'll investigate anything new in their environment by sniffing and staring.",
  "Alpacas sunbathe by lying flat on their sides with their legs stretched out, which can alarm new owners.",
  "Alpacas rarely bite, kick, or charge — they're one of the gentlest domesticated animals on the planet.",
  "Alpacas are herd animals and can become stressed or depressed if kept alone.",
  "Alpacas have excellent memory and can remember routes, faces, and other alpacas for years.",
  "A group of alpacas is sometimes called a herd, but breeders often call them a 'string' of alpacas.",
  // Fiber & industry
  "Alpaca fiber comes in over 22 natural colors, from white to black and everything in between.",
  "An alpaca's fleece grows about 5 inches per year and is warmer, softer, and lighter than sheep's wool.",
  "A single alpaca produces enough fleece each year to make several sweaters — about 5 to 10 pounds per shearing.",
  "Alpaca fleece is naturally hypoallergenic because it contains no lanolin, unlike sheep's wool.",
  "The Incas considered alpaca fiber the 'fiber of the gods' and reserved the finest fleece for royalty.",
  "Alpacas come in two breeds: Huacaya (fluffy, teddy bear-like) and Suri (long, silky dreadlocks).",
  // Biology & anatomy
  "Baby alpacas are called 'crias' and can stand and walk within an hour of birth.",
  "Alpacas have soft padded feet instead of hooves, making them gentle on terrain and pastures.",
  "Alpacas have three stomach compartments, not four like cows, making them very efficient at digesting tough grasses.",
  "Alpacas can recognize individual humans and other animals by sight and sound.",
  "Alpacas have a split upper lip that lets them nibble grass close to the ground without pulling out the roots.",
  "Alpacas can run up to 35 mph — fast enough to outrun most predators over short distances.",
  "Alpacas can live at altitudes above 15,000 feet — their blood is specially adapted to carry oxygen in thin air.",
  "Alpacas have a communal dung pile — the whole herd uses the same spot, making cleanup easy.",
  // Domestication & history
  "Alpacas originated in the Andes Mountains of South America and were domesticated over 6,000 years ago.",
  "The world alpaca population is about 3.5 million, with most still living in Peru, Bolivia, and Chile.",
  "Alpacas have been used as therapy animals because of their calm, gentle nature and soft fleece.",
  "Alpacas have been guarding chickens and smaller livestock for centuries — their alert nature scares off foxes and hawks.",
  "Alpaca manure is so nutrient-rich and low in nitrogen that it can be used directly as garden fertilizer without composting.",
  "Alpacas can crossbreed with llamas to produce a hybrid called a 'huarizo' — but this is rare in practice.",
  // Evolution & genetics
  "Alpacas share a common ancestor with camels — the family Camelidae split roughly 40 million years ago when early camelids migrated from North America to South America and Asia.",
  "DNA studies show modern alpacas descend primarily from the wild vicuña, not the guanaco — centuries of crossbreeding with llamas had obscured their true ancestry until genetic testing revealed it.",
  "Alpacas have 74 chromosomes — the same as llamas, guanacos, and vicuñas — which is why all four South American camelids can interbreed and produce fertile offspring.",
  "The vicuña, the wild ancestor of the alpaca, produces the finest animal fiber on Earth — just 12 microns thick, finer than cashmere.",
  "Alpacas went nearly extinct during the Spanish conquest of the Inca Empire — conquistadors killed roughly 90% of the population and replaced them with European sheep and cattle.",
  "After the conquest, surviving alpacas were pushed to harsh high-altitude puna grasslands above 14,000 feet, where their cold-adapted genetics helped them survive while European livestock could not.",
  "Alpacas were unknown outside South America until the 1800s when Sir Titus Salt of England discovered alpaca fiber and built a textile empire around it, sparking global demand.",
  "Alpacas were first imported to the United States in 1984 — the entire North American herd descends from a small founding population brought over in the 1980s and 90s.",
  // Peru & cultural significance
  "Peru is home to roughly 80% of the world's alpacas — about 3 million animals, mostly raised by small-scale indigenous herders in the Andean highlands.",
  "In Andean Quechua culture, alpacas are considered a gift from Pachamama (Mother Earth), and herders perform rituals of gratitude during shearing season.",
  "Peruvian alpaca herders live at elevations between 12,000 and 16,000 feet — some of the highest permanently inhabited places on Earth — and alpacas are central to their livelihood.",
  "Peru exports over $200 million worth of alpaca fiber and textiles annually, making it the country's most valuable livestock fiber crop and a major employer in the highlands.",
  "The ancient Inca road system, Qhapaq Ñan, was built partly to transport alpaca fiber from highland herders to coastal weavers — a 25,000-mile textile supply chain.",
  "In pre-Columbian Peru, alpaca fiber was so valuable that it functioned as a form of currency — cloth made from fine fiber was more precious than gold.",
  "Peruvian scientists at INIA (National Institute of Agricultural Innovation) are working to restore the genetic purity of alpacas by selectively breeding out llama DNA introduced over centuries of hybridization.",
  // Science & modern use
  "Alpacas produce remarkably low methane compared to cattle — about one-tenth per animal — making them one of the most climate-friendly livestock options for fiber production.",
  "Alpaca blood contains uniquely small antibodies called nanobodies that are being studied for cancer treatment, virus detection, and diagnostic tools.",
  "Researchers at the University of Reading found that alpaca nanobodies can neutralize SARS-CoV-2 — their tiny size lets them bind to parts of the virus that human antibodies can't reach.",
  "Alpaca fiber has microscopic air pockets that make it thermally efficient — it insulates in cold weather and breathes in heat, outperforming synthetic technical fabrics.",
  "Alpacas are induced ovulators — they don't have a heat cycle like most mammals. Instead, the act of mating triggers ovulation, making breeding unpredictable without veterinary guidance.",
  "Alpaca gestation lasts about 11.5 months, and twins are extremely rare — fewer than 1 in 10,000 births. Almost every pregnancy produces a single cria.",
  "A 2019 Belgian study found that alpaca nanobodies could be engineered to cross the blood-brain barrier, opening potential treatments for Alzheimer's and other neurological diseases.",
  "Alpacas have an unusually efficient digestive system that extracts more nutrients from poor-quality forage than sheep or goats, requiring about 30% less feed per pound of body weight.",
  // Quirky & surprising
  "Alpacas have no top front teeth — just a hard dental pad. They grind food with their back molars, which is why they chew with a distinctive sideways motion.",
  "Alpaca eyes have horizontal slit pupils, like goats, giving them a nearly 340-degree field of vision to spot predators from almost any direction.",
  "Alpacas rarely drink standing water in the wild — they get most of their hydration from dew-covered grasses in the early morning on the high Andean plains.",
  "The Aymara people of Bolivia believe that a white alpaca born into a colored herd is a sacred omen called an 'illa' — a sign of abundance and protection from the mountain spirits.",
  "Alpaca teeth grow continuously throughout their lives and occasionally need to be trimmed — an overgrown bite is one of the most common veterinary issues in pet alpacas.",
  "Alpacas can distinguish between familiar and unfamiliar dogs at a distance and will form a defensive line, stomping and alarm-calling to protect the herd.",
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
        person:person_id(first_name, residence_location),
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
      // Entry tablet is at the Playhouse (cedar_creek). Hide people who
      // live at other residences like Sharingwood. NULL = show (legacy default).
      const loc = a.person?.residence_location;
      if (loc && loc !== 'cedar_creek') return false;
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
let currentFactIndex = Math.floor(Math.random() * FALLBACK_FACTS.length);

async function loadFacts() {
  // Try to fetch recent facts from DB and merge with fallbacks
  try {
    const { data } = await supabase
      .from('kiosk_facts')
      .select('fact_text')
      .order('generated_date', { ascending: false })
      .limit(20);
    if (data && data.length > 0) {
      const dbFacts = data.map(d => d.fact_text);
      // Merge DB facts (at front) with fallbacks, deduplicating
      const merged = [...dbFacts];
      for (const f of FALLBACK_FACTS) {
        if (!merged.includes(f)) merged.push(f);
      }
      allFacts = merged;
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
      const name = escapeHtml(entry.guest_name) || 'Anonymous';
      const type = escapeHtml(entry.media_type) || 'text';
      const badge = type !== 'text' ? `<span class="entry-type-badge">${type}</span>` : '';

      let mediaHtml = '';
      if (entry.video_url) {
        mediaHtml = `<div class="guestbook-entry-media">
          <div class="video-thumb-wrap" data-video-url="${escapeHtml(entry.video_url)}">
            <video class="guestbook-thumb" src="${escapeHtml(entry.video_url)}#t=0.5"
                   playsinline preload="metadata" muted></video>
            <div class="video-play-btn">&#9654;</div>
            <span class="video-duration">--:--</span>
          </div>
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

    // Read video durations from metadata and wire up play-on-tap
    container.querySelectorAll('.video-thumb-wrap').forEach(wrap => {
      const video = wrap.querySelector('video');
      const durationEl = wrap.querySelector('.video-duration');
      video.addEventListener('loadedmetadata', () => {
        const dur = video.duration;
        if (dur && isFinite(dur)) {
          const m = Math.floor(dur / 60);
          const s = Math.floor(dur % 60).toString().padStart(2, '0');
          durationEl.textContent = `${m}:${s}`;
        }
      });
      wrap.addEventListener('click', () => {
        openVideoPlayer(wrap.dataset.videoUrl);
      });
    });
  } catch (err) {
    console.error('Failed to load guestbook:', err);
  }
}

function openVideoPlayer(url) {
  let overlay = document.getElementById('videoPlayerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'videoPlayerOverlay';
    overlay.className = 'video-player-overlay';
    overlay.innerHTML = `<video id="videoPlayerEl" class="video-player-el" controls autoplay playsinline></video>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.querySelector('video').pause();
        overlay.style.display = 'none';
      }
    });
    document.body.appendChild(overlay);
  }
  const videoEl = overlay.querySelector('video');
  videoEl.src = url;
  overlay.style.display = '';
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
// HAOS CONVERSATION AGENT
// =============================================
let HAOS_BASE_URL = '';
let HAOS_TOKEN = '';
let haosConversationId = null;

// Fetch HAOS config from Supabase at startup (no hardcoded token)
async function loadHaosConfig() {
  try {
    const { data, error } = await supabase.rpc('get_kiosk_haos_config');
    if (error) throw error;
    HAOS_BASE_URL = data?.base_url || '';
    HAOS_TOKEN = data?.token || '';
  } catch (err) {
    console.error('Failed to load HAOS config:', err);
  }
}
let haosIsLoading = false;

function openHaosChat() {
  const overlay = document.getElementById('haosOverlay');
  overlay.style.display = '';
  document.getElementById('haosInput')?.focus();
  // Pause rotation while chat is open
  if (rotationTimer) clearTimeout(rotationTimer);
}

function closeHaosChat() {
  document.getElementById('haosOverlay').style.display = 'none';
  // Resume rotation
  rotationTimer = setTimeout(advanceRotation, TAP_DISMISS_SECONDS * 1000);
}

function appendHaosMessage(text, type) {
  const container = document.getElementById('haosChatMessages');
  const div = document.createElement('div');
  div.className = `haos-msg haos-msg-${type}`;
  if (type === 'loading') {
    div.textContent = 'Thinking';
  } else {
    const p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeHaosLoading() {
  const container = document.getElementById('haosChatMessages');
  const loader = container.querySelector('.haos-msg-loading');
  if (loader) loader.remove();
}

async function sendHaosMessage(text) {
  if (!text.trim() || haosIsLoading) return;
  if (!HAOS_BASE_URL || !HAOS_TOKEN) {
    appendHaosMessage('Home Assistant is not configured yet. Please wait a moment and try again.', 'assistant');
    return;
  }
  haosIsLoading = true;

  const input = document.getElementById('haosInput');
  const sendBtn = document.getElementById('haosSend');
  input.value = '';
  sendBtn.disabled = true;

  appendHaosMessage(text, 'user');
  appendHaosMessage('', 'loading');

  try {
    const body = {
      text: text.trim(),
      language: 'en',
    };
    if (haosConversationId) body.conversation_id = haosConversationId;

    const resp = await fetch(`${HAOS_BASE_URL}/api/conversation/process`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HAOS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    removeHaosLoading();

    if (!resp.ok) {
      throw new Error(`HAOS returned ${resp.status}`);
    }

    const data = await resp.json();
    const speech = data.response?.speech?.plain?.speech || 'No response received.';
    haosConversationId = data.conversation_id || haosConversationId;

    appendHaosMessage(speech, 'assistant');
  } catch (err) {
    removeHaosLoading();
    const msg = err.name === 'TimeoutError'
      ? 'Request timed out — the house may be busy.'
      : `Could not reach the house: ${err.message}`;
    appendHaosMessage(msg, 'error');
    console.error('HAOS conversation error:', err);
  } finally {
    haosIsLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function startNewHaosConversation() {
  haosConversationId = null;
  const container = document.getElementById('haosChatMessages');
  container.innerHTML = `<div class="haos-msg haos-msg-assistant">
    <p>Hi! I'm the house assistant. Ask me to control lights, play music, check the weather, or anything about the property.</p>
  </div>`;
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
// NETWORK HEALTH — inline status indicator
// =============================================
async function checkNetworkHealth() {
  const subtitle = document.getElementById('netSubtitle');
  const icon = document.querySelector('.net-icon');
  if (!subtitle) return;
  try {
    const start = Date.now();
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/brand_config?select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    if (resp.ok) {
      subtitle.textContent = `Online \u2022 ${latency}ms`;
      if (icon) icon.style.color = 'var(--kiosk-green, #4ade80)';
    } else {
      subtitle.textContent = 'Degraded';
      if (icon) icon.style.color = 'var(--kiosk-yellow, #facc15)';
    }
  } catch {
    subtitle.textContent = 'Offline';
    if (icon) icon.style.color = 'var(--kiosk-red, #f87171)';
  }
}

// =============================================
// 3-VIEW ROTATION: Network (15s) → Slideshow (15s) → Kiosk (15s)
// Tap any overlay to dismiss → 2 min kiosk before resuming
// =============================================
const ROTATION_SECONDS = 15;          // each view shows for 15s
const TAP_DISMISS_SECONDS = 120;      // 2 min kiosk after user taps
// Views cycle: KIOSK → SLIDESHOW → KIOSK → ...
// (network popup removed — browsers block window.open on kiosk tablets)
const ROTATION_VIEWS = ['kiosk', 'slideshow'];
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
      .not('result_url', 'is', null)
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
  const slideshowOverlay = document.getElementById('slideshowOverlay');

  // Hide slideshow overlay
  slideshowOverlay.classList.remove('visible');
  setTimeout(() => {
    if (viewName !== 'slideshow') slideshowOverlay.style.display = 'none';
  }, 800);

  if (viewName === 'slideshow') {
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
// LIVE SUBTITLES
// =============================================
const SUBTITLE_SERVER = 'ws://alpuca.local:8910';
const SUBTITLE_STATUS_URL = 'http://alpuca.local:8910/subtitles/status';
const SUBTITLE_MAX_SEGMENTS = 50;

let subtitleWs = null;
let subtitleSegments = [];
let subtitleFontSize = 32;
let subtitleAutoScroll = true;
let subtitleReconnectDelay = 1000;

function initSubtitles() {
  // Check if subtitle server is active
  checkSubtitleServer();
  setInterval(checkSubtitleServer, 30_000);

  // Button opens overlay
  document.getElementById('subtitlesBtn')?.addEventListener('click', openSubtitles);
  document.getElementById('subtitlesClose')?.addEventListener('click', closeSubtitles);

  // Font size
  document.getElementById('subtitleFontUp')?.addEventListener('click', () => {
    subtitleFontSize = Math.min(72, subtitleFontSize + 4);
    document.documentElement.style.setProperty('--subtitle-font-size', subtitleFontSize + 'px');
  });
  document.getElementById('subtitleFontDown')?.addEventListener('click', () => {
    subtitleFontSize = Math.max(16, subtitleFontSize - 4);
    document.documentElement.style.setProperty('--subtitle-font-size', subtitleFontSize + 'px');
  });

  // Language picker
  document.getElementById('subtitleLangPicker')?.addEventListener('change', (e) => {
    if (subtitleWs) subtitleWs.close();
    subtitleSegments = [];
    renderSubtitles();
    connectSubtitleWs(e.target.value);
  });

  // Auto-scroll detection
  document.getElementById('subtitleContent')?.addEventListener('scroll', () => {
    const el = document.getElementById('subtitleContent');
    subtitleAutoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  });
}

async function checkSubtitleServer() {
  try {
    const res = await fetch(SUBTITLE_STATUS_URL, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const btn = document.getElementById('subtitlesBtn');
    if (btn) btn.style.display = data.active ? 'flex' : 'none';
  } catch {
    const btn = document.getElementById('subtitlesBtn');
    if (btn) btn.style.display = 'none';
  }
}

function openSubtitles() {
  document.getElementById('subtitlesOverlay').style.display = 'flex';
  const lang = document.getElementById('subtitleLangPicker')?.value || 'en';
  connectSubtitleWs(lang);
}

function closeSubtitles() {
  document.getElementById('subtitlesOverlay').style.display = 'none';
  if (subtitleWs) {
    subtitleWs.close();
    subtitleWs = null;
  }
  subtitleSegments = [];
}

function connectSubtitleWs(lang) {
  const dot = document.getElementById('subtitleStatusDot');
  const text = document.getElementById('subtitleStatusText');
  if (dot) dot.className = 'subtitles-status-dot reconnecting';
  if (text) text.textContent = 'Connecting...';

  subtitleWs = new WebSocket(`${SUBTITLE_SERVER}/subtitles?lang=${lang}`);

  subtitleWs.onopen = () => {
    if (dot) dot.className = 'subtitles-status-dot connected';
    if (text) text.textContent = `Connected (${lang})`;
    subtitleReconnectDelay = 1000;
  };

  subtitleWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'subtitle') return;

    if (msg.is_partial) {
      const idx = subtitleSegments.findIndex(s => s.id === msg.id && s.is_partial);
      if (idx >= 0) subtitleSegments[idx] = msg;
      else subtitleSegments.push(msg);
    } else {
      subtitleSegments = subtitleSegments.filter(s => !(s.id === msg.id && s.is_partial));
      subtitleSegments.push(msg);
    }
    while (subtitleSegments.length > SUBTITLE_MAX_SEGMENTS) subtitleSegments.shift();
    renderSubtitles();
  };

  subtitleWs.onclose = () => {
    if (dot) dot.className = 'subtitles-status-dot';
    if (text) text.textContent = `Disconnected — retrying...`;
    // Only reconnect if overlay is still open
    if (document.getElementById('subtitlesOverlay')?.style.display !== 'none') {
      setTimeout(() => {
        const currentLang = document.getElementById('subtitleLangPicker')?.value || 'en';
        connectSubtitleWs(currentLang);
      }, subtitleReconnectDelay);
      subtitleReconnectDelay = Math.min(30000, subtitleReconnectDelay * 2);
    }
  };

  subtitleWs.onerror = () => subtitleWs.close();
}

function renderSubtitles() {
  const el = document.getElementById('subtitleContent');
  if (!el) return;

  if (subtitleSegments.length === 0) {
    el.innerHTML = '<div class="subtitles-empty">Waiting for subtitles...</div>';
    return;
  }

  el.innerHTML = subtitleSegments.map(seg => {
    const cls = seg.is_partial ? 'subtitles-segment partial' : 'subtitles-segment';
    if (seg.lang !== 'en' && seg.source_text) {
      // Different language: original (dim) on top, translation (bright) below
      return `<div class="${cls}"><div class="sub-original">${escapeHtml(seg.source_text)}</div><div class="sub-translation">${escapeHtml(seg.text)}</div></div>`;
    }
    // Same language (English): just show the text
    return `<div class="${cls}"><div class="sub-translation">${escapeHtml(seg.text)}</div></div>`;
  }).join('');

  if (subtitleAutoScroll) el.scrollTop = el.scrollHeight;
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
    checkNetworkHealth(),
  ]);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshAll, POLL_INTERVAL);
}

document.addEventListener('DOMContentLoaded', async () => {
  updateClock();
  setInterval(updateClock, 1000);

  // Load fact once (doesn't change during the day)
  loadFacts();

  // Load HAOS config from DB (token not hardcoded)
  loadHaosConfig();

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

  // HAOS chat
  document.getElementById('haosBtn')?.addEventListener('click', openHaosChat);
  document.getElementById('haosClose')?.addEventListener('click', closeHaosChat);
  document.getElementById('haosOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'haosOverlay') closeHaosChat();
  });
  document.getElementById('haosSend')?.addEventListener('click', () => {
    sendHaosMessage(document.getElementById('haosInput').value);
  });
  document.getElementById('haosInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendHaosMessage(e.target.value);
    }
  });
  document.querySelectorAll('.haos-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sendHaosMessage(btn.dataset.cmd);
    });
  });

  // Live Subtitles
  initSubtitles();

  // Rotation overlays: tap to dismiss
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
