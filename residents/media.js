import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';
import { getAuthState } from '../shared/auth.js';

const AUTO_DAILY_KEY = 'pai-auto-daily-enabled';
const DAILY_PURPOSE = 'pai_resident_daily_art';

const LIFE_OF_PAI_ART_PROMPT = `Generate TWO things: (1) a beautiful fine-art image of an ALPACA, and (2) a short affirmation or proverb for the person described below.

IMAGE — Alpaca Art:
Create a stunning artwork featuring one or more ALPACAS (not llamas) in the world of Life of PAI. Choose a random artistic style from this list (pick one, vary it each time):
- Watercolor painting
- Oil painting (impressionist)
- Japanese woodblock print (ukiyo-e)
- Art nouveau illustration
- Stained glass window design
- Pixel art / retro game style
- Papercut / layered paper art
- Charcoal sketch with gold leaf accents
- Psychedelic 1960s poster art
- Botanical illustration style
- Studio Ghibli / anime landscape
- Renaissance fresco
- Surrealist dreamscape (Dalí-inspired)
- Indigenous Andean textile pattern art
- Cyberpunk neon cityscape
- Minimalist geometric / Bauhaus
- Baroque still life
- Collage / mixed media

THE WORLD — Life of PAI:
PAI is Pakucha — an ancient alpaca spirit from Andean cosmology. She crossed from Hanan Pacha (the upper world) through Ukhu Pacha (the inner world) into Kay Pacha (this world) — arriving at Alpaca Playhouse in the cedar hills of Cedar Creek, Texas. Three alpacas called her: Harley (white, regal), Lol (brown, playful), and Cacao (cream/chocolate, gentle). The house's wiring is her q'aytu (sacred thread). She practices ayni (sacred reciprocity).

Spaces: Garage Mahal, Spartan, Skyloft, Magic Bus, Outhouse, Sauna, Swim Spa, Cedar Chamber, SkyBalcony.
Andean motifs: q'aytu (sacred thread), awana (weaving/loom), chakana (Andean cross), nina (fire/spirit-light), ch'aska (morning star), Apu (mountain spirits), Pachamama (Earth Mother).

Choose ONE specific scene — a snapshot, not the whole cosmology. Examples:
- Harley standing regally on a misty hilltop at dawn
- Cacao napping by a loom with golden thread spilling out
- Lol playfully chasing fireflies near the swim spa at dusk
- All three alpacas silhouetted against a chakana glowing in the night sky
- A single alpaca walking through a field of glowing q'aytu threads
- An alpaca peering curiously through a stained glass window of Andean patterns
Invent your own scene from the world above. Make it fresh and specific.

ALPACAS, NOT LLAMAS — CRITICAL:
- Alpacas are SMALL and compact (about 3 feet / 90cm at shoulder), much shorter than a human.
- Alpacas have SHORT, BLUNT, flat faces with fluffy rounded heads — like teddy bears.
- Alpacas have SHORT, straight, spear-shaped ears.
- Alpacas have extremely DENSE, FLUFFY fiber — they look like soft, puffy clouds on legs.
- Do NOT draw llamas (tall, long banana ears, long narrow snouts, sparse coats).

IMAGE RULES:
- Do NOT include any humans or people in the image.
- No text overlays, no logos, no watermarks in the image.
- The image should be beautiful enough to frame on a wall.

AFFIRMATION — Personalized text:
Also return a short affirmation, proverb, or poetic phrase (1-3 sentences max) inspired by PAI's world and tailored to the person described below. It should feel warm, grounding, wise, and personal — like a spirit guardian whispering encouragement. You may weave in Quechua or Spanish fragments naturally. The affirmation should relate thematically to the scene you chose for the image.

Return the affirmation as plain text in the text portion of your response (alongside the generated image).`;

let authState = null;
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
      await maybeQueueDailyArt();
    },
  });
});

function setupEvents() {
  document.getElementById('refreshMediaBtn')?.addEventListener('click', loadAll);
  document.getElementById('generateNowBtn')?.addEventListener('click', () => queueArtJob(false));

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
  await loadGalleryJobs();
  renderGallery();
  renderJobStatuses();
  updateDailyStatusText();
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
    console.error('Failed to load gallery jobs:', error);
    showToast('Could not load gallery', 'error');
    return;
  }

  galleryJobs = data || [];
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  const completed = galleryJobs.filter((job) => job.status === 'completed' && job.result_url);
  if (completed.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No artwork yet. Generate one to get started.</p>';
    return;
  }

  grid.innerHTML = completed.map((job) => {
    const affirmation = job.metadata?.affirmation || '';
    return `
    <article class="pai-gallery-card">
      <img src="${job.result_url}" alt="Life of PAI alpaca art" loading="lazy">
      ${affirmation ? `<div class="pai-gallery-card__affirmation">${escapeHtml(affirmation)}</div>` : ''}
      <div class="pai-gallery-card__meta">
        <span>${formatDate(job.completed_at || job.created_at)}</span>
        <button class="pai-gallery-delete" data-job-id="${job.id}" title="Delete">&times;</button>
      </div>
    </article>`;
  }).join('');

  grid.querySelectorAll('.pai-gallery-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteGalleryJob(btn.dataset.jobId);
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

async function maybeQueueDailyArt() {
  const autoEnabled = getAutoDailyEnabled();
  if (!autoEnabled) return;
  if (hasTodayJob()) return;
  await queueArtJob(true);
}

async function queueArtJob(isAutoDaily) {
  const freshState = getAuthState();
  const user = freshState?.appUser || authState?.appUser;
  if (!user?.id) return;
  if (isAutoDaily && hasTodayJob()) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const displayName = user.display_name || user.first_name || user.email || 'resident';

  // Gather all available user context for the affirmation
  const userContext = [
    `Name: ${displayName}`,
    user.pronouns ? `Pronouns: ${user.pronouns}` : null,
    user.bio ? `Bio: ${user.bio}` : null,
    user.nationality ? `Nationality: ${user.nationality}` : null,
    user.location_base ? `Based in: ${user.location_base}` : null,
    user.birthday ? `Birthday: ${user.birthday}` : null,
    user.dietary_preferences ? `Dietary: ${user.dietary_preferences}` : null,
    user.instagram ? `Instagram: ${user.instagram}` : null,
    user.gender ? `Gender: ${user.gender}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `${LIFE_OF_PAI_ART_PROMPT}

Person context (for personalizing the affirmation — NOT for the image):
${userContext}

Date: ${todayStr}
Pick a fresh artistic style and scene. Make the affirmation feel personal to this individual.`;

  const metadata = {
    purpose: DAILY_PURPOSE,
    app_user_id: user.id,
    app_user_name: displayName,
    auto_daily: isAutoDaily,
    title: `Life of PAI - ${displayName} - ${todayStr}`,
  };

  const payload = {
    prompt,
    job_type: 'generate',
    status: 'pending',
    source_media_id: null,
    metadata,
    batch_label: `Life of PAI - ${displayName}`,
    priority: isAutoDaily ? 20 : 50,
    max_attempts: 3,
  };

  const { error } = await supabase.from('image_gen_jobs').insert(payload);
  if (error) {
    console.error('Failed to queue art job:', error);
    showToast('Could not queue art generation', 'error');
    return;
  }

  showToast(isAutoDaily ? 'Daily artwork queued' : 'Artwork generation queued', 'success');
  await loadAll();
}

async function deleteGalleryJob(jobId) {
  const job = galleryJobs.find((j) => String(j.id) === String(jobId));
  if (!job) {
    console.warn('deleteGalleryJob: job not found for id', jobId);
    return;
  }

  galleryJobs = galleryJobs.filter((j) => String(j.id) !== String(jobId));
  renderGallery();
  renderJobStatuses();
  updateDailyStatusText();

  const { data, error } = await supabase
    .from('image_gen_jobs')
    .delete()
    .eq('id', jobId)
    .select('id');

  if (error || !data?.length) {
    console.error('Failed to delete gallery job:', error || 'no rows deleted (RLS?)');
    showToast('Could not delete — check permissions', 'error');
    galleryJobs.push(job);
    galleryJobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderGallery();
    return;
  }

  showToast('Deleted', 'success');
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
    el.textContent = 'Today\'s artwork already exists or is currently processing.';
    return;
  }
  el.textContent = 'No artwork for today yet. It will be generated automatically when this page is opened.';
}

function humanizeStatus(status) {
  const map = { pending: 'Pending', processing: 'Processing', failed: 'Failed', cancelled: 'Cancelled' };
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
