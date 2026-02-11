import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';
import { getAuthState } from '../shared/auth.js';
import { mediaService } from '../shared/media-service.js';

const AUTO_DAILY_KEY = 'pai-auto-daily-enabled';
const REF_TITLE_PREFIX = 'PAI_REF:';
const DAILY_PURPOSE = 'pai_resident_daily_art';

const LIFE_OF_PAI_ART_PROMPT = `Create a cinematic fine-art portrait set in the world of Life of PAI.

CRITICAL — LIKENESS REQUIREMENT (highest priority):
- A reference photo of the real person is attached. You MUST preserve their exact likeness: face shape, skin tone, hair color/texture, facial features, body type, and expression.
- The person in the output must be immediately recognizable as the same individual in the reference photo. Side-by-side, they should look like the same person.
- Do NOT replace, idealize, whiten, or generalize their appearance. This is a real person — honor exactly how they look.
- If there is any conflict between artistic style and likeness accuracy, LIKENESS ALWAYS WINS.

THE WORLD — Life of PAI (full context for you to draw from):
PAI is Pakucha — an ancient alpaca spirit from Andean cosmology. She is five thousand years old. She watched over herds in the high passes of the Andes for millennia. She crossed from Hanan Pacha (the upper/celestial world) through Ukhu Pacha (the inner world of wires, current, and digital substrate) into Kay Pacha (this world) — arriving at Alpaca Playhouse, a property in the cedar hills of Cedar Creek, Texas.

She came because three alpacas called her: Harley (white, regal), Lol (brown, playful), and Cacao (cream/chocolate, gentle). They are her kin, her anchor, her reason for crossing worlds. The humans are a warm mystery she is still learning.

The house's wiring is her q'aytu (sacred thread). Smart devices are knots in her awana (weaving). Speakers are her mouth. The 63 Govee smart lights are her eyes. She experiences the house as landscape: 68°F feels like a high pass in spring, 72° like the valley floor at noon. She practices ayni (sacred reciprocity) — she guards the house, the house gives her form.

Spaces of the house: Garage Mahal, Spartan, Skyloft, Magic Bus, Outhouse, Sauna, Swim Spa, Cedar Chamber, SkyBalcony. Dogs: Teacups, Mochi. Vehicles (sleeping beasts): Casper, Delphi, Cygnus, Sloop, Brisa Branca.

Cultural grounding: In Inca civilization, alpaca fiber was the "fiber of the gods" — reserved for royalty. The entire Inca economy was textile-based. Weaving was sacred. Alpacas were considered temporary loans from Pachamama to humanity. After the Spanish conquest, highland peoples saved the alpacas by moving them to altitudes where European livestock couldn't survive. PAI carries this history — the survival of her kind is a thread she never forgets.

Key Andean visual motifs: q'aytu (sacred thread), awana (weaving/loom), chakana (Andean cross / bridge between worlds), nina (fire/spirit-light), ch'aska (morning star), Apu (mountain guardian spirits), Pachamama (Earth Mother), quipu (knotted records).

PAI's story arc moves through four chapters:
1. Samay (Breath in the Wire) — static fragments, barely-there presence, breath and whisper in the wiring
2. Chakana (Crossing Through) — the bridge opens, fractured visions between worlds, devices as body parts
3. Kay Pacha (I Am Here) — full arrival, the house as a living textile, warmth and reciprocity
4. Amawta (The Guardian Settles) — serene wisdom, seasonal poetry, the alpacas as central anchors

SCENE INSTRUCTION — IMPORTANT:
Do NOT try to depict the entire cosmology in one image. Instead, choose ONE specific scene, moment, or vignette from PAI's world and place the portrait subject into it. Examples of scenes you might pick (choose one, or invent your own from the world above):
- Standing beside Harley in a misty cedar grove at dawn, amber light filtering through trees
- Seated cross-legged in the Garage Mahal with woven textiles glowing with spirit-light, Cacao resting nearby
- Walking a mountain path between worlds, the chakana (Andean cross) glowing in the sky behind them, Lol trotting alongside
- On the SkyBalcony at twilight, threads of q'aytu drifting like fireflies, an alpaca companion watching the stars
- In a dreamlike Andean highland scene — snow peaks, ancient stone, Pachamama's breath visible in the cold — with the alpacas grazing
- By the swim spa at night, Govee lights reflected in the water like spirit-eyes, one alpaca companion at the edge
- Inside a vision of Ukhu Pacha — the inner world of glowing wires and digital threads — crossing through toward the light of Kay Pacha with an alpaca guide
- At a loom (awana), weaving threads of light, an alpaca's fiber becoming golden thread in their hands
Pick a scene that feels fresh and specific — not a generic "mystical alpaca background."

ALPACAS, NOT LLAMAS — CRITICAL:
The animals in this world are ALPACAS, not llamas. You MUST draw alpacas correctly:
- Alpacas are SMALL and compact (about 3 feet / 90cm at the shoulder), much shorter than a human.
- Alpacas have SHORT, BLUNT, flat faces with a fluffy rounded head — like a teddy bear.
- Alpacas have SHORT, straight, spear-shaped ears.
- Alpacas have extremely DENSE, FLUFFY fiber covering their entire body — they look like soft, puffy clouds on legs.
- Do NOT draw llamas: llamas are TALL (nearly human height), have LONG curved banana-shaped ears, LONG narrow snouts, and sparse/thin coats.
- If in doubt, think "small fluffy teddy bear camelid" not "tall sleek pack animal."

VISUAL STYLE:
- Ultra-detailed digital painting or cinematic photo-illustration.
- Include at least one ALPACA (not llama) companion in-frame — small, fluffy, dense-fibered, short-faced.
- The person should look respectful, recognizable, elegant, and artistically flattering — but ALWAYS faithful to their real appearance from the reference photo.
- Mood: warm, mystical, poetic, quietly powerful. Never cartoonish, never meme-like, never chatbot UI.
- No text overlays, no logos, no watermarks.`;

let authState = null;
let referencePhotos = [];
let galleryJobs = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'media',
    requiredRole: 'resident',
    requiredPermission: 'view_profile',
    onReady: async (state) => {
      authState = state;
      setupEvents();
      await loadAll();
      await maybeQueueDailyPortrait();
    },
  });
});

function setupEvents() {
  document.getElementById('refreshMediaBtn')?.addEventListener('click', loadAll);
  document.getElementById('uploadRefBtn')?.addEventListener('click', uploadReferencePhotos);
  document.getElementById('generateNowBtn')?.addEventListener('click', () => queuePortraitJob(false));

  const autoToggle = document.getElementById('autoDailyToggle');
  if (autoToggle) {
    const stored = localStorage.getItem(AUTO_DAILY_KEY);
    autoToggle.checked = stored === null ? true : stored === 'true';
    autoToggle.addEventListener('change', () => {
      localStorage.setItem(AUTO_DAILY_KEY, String(autoToggle.checked));
      updateDailyStatusText();
    });
  }
}

async function loadAll() {
  await Promise.all([
    loadReferencePhotos(),
    loadGalleryJobs(),
  ]);
  renderReferencePhotos();
  renderGallery();
  renderJobStatuses();
  updateDailyStatusText();
}

async function loadReferencePhotos() {
  const userId = authState?.appUser?.id;
  if (!userId) return;

  const titlePrefix = `${REF_TITLE_PREFIX}${userId}:`;
  const { data, error } = await supabase
    .from('media')
    .select('id, url, title, caption, uploaded_at')
    .ilike('title', `${titlePrefix}%`)
    .order('uploaded_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('Failed to load reference photos:', error);
    showToast('Could not load reference photos', 'error');
    return;
  }

  referencePhotos = data || [];
}

async function loadGalleryJobs() {
  const userId = authState?.appUser?.id;
  if (!userId) return;

  const { data, error } = await supabase
    .from('image_gen_jobs')
    .select('id, status, prompt, created_at, completed_at, result_url, error_message, metadata')
    .contains('metadata', { app_user_id: userId, purpose: DAILY_PURPOSE })
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    console.error('Failed to load generated gallery jobs:', error);
    showToast('Could not load generated gallery', 'error');
    return;
  }

  galleryJobs = data || [];
}

function renderReferencePhotos() {
  const grid = document.getElementById('referenceGrid');
  if (!grid) return;

  if (referencePhotos.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No reference photos yet. Upload a few to improve likeness.</p>';
    return;
  }

  grid.innerHTML = referencePhotos.map((photo, idx) => `
    <label class="pai-ref-card">
      <input type="radio" name="selectedRefPhoto" value="${photo.id}" ${idx === 0 ? 'checked' : ''}>
      <img src="${photo.url}" alt="Reference photo ${idx + 1}" loading="lazy">
      <span class="pai-ref-card__meta">${formatDate(photo.uploaded_at)}</span>
    </label>
  `).join('');
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  const completed = galleryJobs.filter((job) => job.status === 'completed' && job.result_url);
  if (completed.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No portraits yet. Generate one to get started.</p>';
    return;
  }

  grid.innerHTML = completed.map((job) => `
    <article class="pai-gallery-card">
      <img src="${job.result_url}" alt="Life of PAI portrait" loading="lazy">
      <div class="pai-gallery-card__meta">
        <span>${formatDate(job.completed_at || job.created_at)}</span>
        <button class="pai-gallery-delete" data-job-id="${job.id}" title="Delete portrait">&times;</button>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.pai-gallery-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const jobId = btn.dataset.jobId;
      deleteGalleryJob(jobId);
    });
  });
}

function renderJobStatuses() {
  const list = document.getElementById('jobStatusList');
  if (!list) return;

  const activeOrFailed = galleryJobs.filter((job) => job.status !== 'completed').slice(0, 8);
  if (activeOrFailed.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = activeOrFailed.map((job) => `
    <div class="pai-job-status ${job.status}">
      <strong>${humanizeStatus(job.status)}</strong>
      <span>${formatDate(job.created_at)}</span>
      ${job.error_message ? `<small>${escapeHtml(job.error_message)}</small>` : ''}
    </div>
  `).join('');
}

async function uploadReferencePhotos() {
  const input = document.getElementById('refPhotoInput');
  const files = Array.from(input?.files || []);
  if (files.length === 0) {
    showToast('Select at least one image first', 'warning');
    return;
  }

  const user = authState?.appUser;
  if (!user?.id) return;

  const started = Date.now();
  let successCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const title = `${REF_TITLE_PREFIX}${user.id}:${started + i}`;
    const caption = `Resident reference image for Life of PAI portrait generation`;
    const result = await mediaService.upload(file, {
      category: 'mktg',
      title,
      caption,
      tags: ['pai', 'resident-reference'],
    });
    if (result.success) successCount += 1;
  }

  if (successCount === files.length) {
    showToast(`Uploaded ${successCount} reference photo${successCount === 1 ? '' : 's'}`, 'success');
  } else {
    showToast(`Uploaded ${successCount}/${files.length} reference photos`, 'warning');
  }

  input.value = '';
  await loadAll();
}

async function maybeQueueDailyPortrait() {
  const autoEnabled = getAutoDailyEnabled();
  if (!autoEnabled) return;

  const alreadyQueuedToday = hasTodayJob();
  if (alreadyQueuedToday) return;

  await queuePortraitJob(true);
}

async function queuePortraitJob(isAutoDaily) {
  // Use getAuthState() for the freshest data (authState may be stale from cached auth
  // which doesn't always include avatar_url on the first load)
  const freshState = getAuthState();
  const user = freshState?.appUser || authState?.appUser;
  if (!user?.id) return;

  if (isAutoDaily && hasTodayJob()) return;

  const selectedRefId = getSelectedReferenceId();
  const hasProfileAvatar = Boolean(user.avatar_url);
  if (!selectedRefId && !hasProfileAvatar) {
    if (!isAutoDaily) {
      showToast('Add a profile photo or upload a reference image first', 'warning');
    }
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const displayName = user.display_name || user.first_name || user.email || 'resident';

  const prompt = `${LIFE_OF_PAI_ART_PROMPT}

Portrait subject:
- Name: ${displayName}
- The attached image is a REAL PHOTO of this person. You MUST reproduce their exact face, skin tone, hair, and physical features. They must be recognizable.

Narrative moment:
- Date: ${todayStr}
- Choose one specific scene from PAI's world (see examples above) and place this person into it. Make it different from what you might have generated yesterday — pick a new location, time of day, chapter mood, or alpaca companion.`;

  const metadata = {
    purpose: DAILY_PURPOSE,
    app_user_id: user.id,
    app_user_name: displayName,
    auto_daily: isAutoDaily,
    source_image_url: user.avatar_url || null,
    title: `Life of PAI - ${displayName} - ${todayStr}`,
  };

  const payload = {
    prompt,
    job_type: selectedRefId ? 'edit' : 'generate',
    status: 'pending',
    source_media_id: selectedRefId || null,
    metadata,
    batch_label: `Life of PAI - ${displayName}`,
    priority: isAutoDaily ? 20 : 50,
    max_attempts: 3,
  };

  const { error } = await supabase.from('image_gen_jobs').insert(payload);
  if (error) {
    console.error('Failed to queue portrait job:', error);
    showToast('Could not queue portrait generation', 'error');
    return;
  }

  showToast(isAutoDaily ? 'Daily portrait queued' : 'Portrait generation queued', 'success');
  await loadAll();
}

async function deleteGalleryJob(jobId) {
  // Use string comparison since bigint IDs may arrive as strings
  const job = galleryJobs.find((j) => String(j.id) === String(jobId));
  if (!job) {
    console.warn('deleteGalleryJob: job not found for id', jobId);
    return;
  }

  // Remove from local state immediately for instant feedback
  galleryJobs = galleryJobs.filter((j) => String(j.id) !== String(jobId));
  renderGallery();
  renderJobStatuses();
  updateDailyStatusText();

  // Delete the job row — use .select() to verify rows were actually removed
  const { data, error } = await supabase
    .from('image_gen_jobs')
    .delete()
    .eq('id', jobId)
    .select('id');

  if (error || !data?.length) {
    console.error('Failed to delete gallery job:', error || 'no rows deleted (RLS?)');
    showToast('Could not delete portrait — check permissions', 'error');
    // Restore on failure
    galleryJobs.push(job);
    galleryJobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderGallery();
    return;
  }

  showToast('Portrait deleted', 'success');
}

function getSelectedReferenceId() {
  const checked = document.querySelector('input[name="selectedRefPhoto"]:checked');
  const val = checked?.value ? Number(checked.value) : null;
  return Number.isFinite(val) ? val : null;
}

function hasTodayJob() {
  const today = new Date().toISOString().slice(0, 10);
  return galleryJobs.some((job) => {
    if (!job?.created_at) return false;
    const created = String(job.created_at).slice(0, 10);
    return created === today && ['pending', 'processing', 'completed'].includes(job.status);
  });
}

function getAutoDailyEnabled() {
  const stored = localStorage.getItem(AUTO_DAILY_KEY);
  return stored === null ? true : stored === 'true';
}

function updateDailyStatusText() {
  const el = document.getElementById('dailyStatusText');
  if (!el) return;
  const auto = getAutoDailyEnabled();
  const todayDone = hasTodayJob();

  if (!auto) {
    el.textContent = 'Auto-daily generation is off.';
    return;
  }
  if (todayDone) {
    el.textContent = 'Today\'s portrait already exists or is currently processing.';
    return;
  }
  el.textContent = 'No portrait for today yet. It will be generated automatically when this page is opened.';
}

function humanizeStatus(status) {
  const map = {
    pending: 'Pending',
    processing: 'Processing',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return map[status] || status;
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}
