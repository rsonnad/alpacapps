import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';
import { mediaService } from '../shared/media-service.js';

const AUTO_DAILY_KEY = 'pai-auto-daily-enabled';
const REF_TITLE_PREFIX = 'PAI_REF:';
const DAILY_PURPOSE = 'pai_resident_daily_art';

const LIFE_OF_PAI_ART_PROMPT = `Create a cinematic fine-art portrait in the world of Life of PAI.

Backstory grounding:
- PAI is Pakucha, an ancient alpaca spirit from Andean cosmology.
- She crosses from Hanan Pacha through Ukhu Pacha into Kay Pacha at Alpaca Playhouse.
- Mood is mystical, warm, poetic, and quietly powerful.
- Never make this look like a modern chatbot UI or meme art.

Visual direction:
- Subject should be naturally integrated into a dreamlike alpaca scene.
- Include subtle visual motifs: amber light, woven textile texture, mountain spirit atmosphere, soft cedar/oak environment.
- Include at least one alpaca companion in-frame.
- Keep the person respectful, recognizable, elegant, and artistically flattering.
- Ultra-detailed digital painting or cinematic photo-illustration.
- No text overlays, no logos, no watermark.`;

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
      </div>
    </article>
  `).join('');
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
  const user = authState?.appUser;
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
- Render this person naturally and respectfully inside the Life of PAI world.
- Keep likeness close to provided image reference.

Narrative moment:
- Date marker: ${todayStr}
- Scene should feel like one quiet chapter in PAI's ongoing story, with alpaca presence and amber spirit-light.
- Make this unique from prior days while keeping stylistic continuity.`;

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
