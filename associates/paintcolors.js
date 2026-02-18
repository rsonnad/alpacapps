/**
 * Paint Colors - Associate page for AI-powered paint color matching
 * Upload a surface photo → Claude analyzes colors → Brave finds matching paints from HD/Lowes
 */

import { supabase } from '../shared/supabase.js';
import { initAssociatePage, showToast } from '../shared/associate-shell.js';
import { mediaService } from '../shared/media-service.js';

let authState = null;
let appUser = null;
let uploadedMedia = null;
let activeJobId = null;
let pollTimer = null;

// =============================================
// Bootstrap
// =============================================
initAssociatePage({
  activeTab: 'paint',
  onReady: async (state) => {
    authState = state;
    appUser = state.appUser;
    await initApp();
  }
});

async function initApp() {
  await loadSpaces();
  setupEventListeners();
  await loadHistory();
}

// =============================================
// Load spaces for dropdown
// =============================================
async function loadSpaces() {
  const { data: spaces } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('is_archived', false)
    .order('name');

  const select = document.getElementById('spaceSelect');
  if (!spaces || !select) return;
  spaces.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

// =============================================
// Event listeners
// =============================================
function setupEventListeners() {
  const cameraInput = document.getElementById('cameraInput');
  const fileInput = document.getElementById('fileInput');
  const btnRemove = document.getElementById('btnRemove');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnNewAnalysis = document.getElementById('btnNewAnalysis');

  // Camera capture (Take Photo)
  cameraInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileSelected(e.target.files[0]);
    e.target.value = '';
  });

  // File picker (Upload Photo)
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileSelected(e.target.files[0]);
    e.target.value = '';
  });

  // Remove photo
  btnRemove.addEventListener('click', resetUpload);

  // Analyze
  btnAnalyze.addEventListener('click', handleAnalyze);

  // New analysis
  btnNewAnalysis.addEventListener('click', () => {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = '';
    resetUpload();
  });
}

// =============================================
// File selection + upload
// =============================================
async function handleFileSelected(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('previewImage').src = e.target.result;
    document.getElementById('uploadButtons').style.display = 'none';
    document.getElementById('uploadPreview').style.display = '';
  };
  reader.readAsDataURL(file);

  // Show progress bar
  const progressEl = document.getElementById('uploadProgress');
  const barEl = document.getElementById('uploadBar');
  progressEl.style.display = '';
  barEl.style.width = '0%';

  // Upload via media service
  try {
    const result = await mediaService.upload(file, {
      category: 'projects',
      caption: document.getElementById('captionInput').value.trim() || 'Paint color analysis',
      onProgress: (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        barEl.style.width = pct + '%';
      }
    });

    if (!result.success) {
      showToast('Upload failed: ' + (result.error || 'Unknown error'), 'error');
      resetUpload();
      return;
    }

    uploadedMedia = result.media;
    progressEl.style.display = 'none';
    document.getElementById('btnAnalyze').disabled = false;
    showToast('Photo uploaded', 'success');
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Upload failed', 'error');
    resetUpload();
  }
}

function resetUpload() {
  uploadedMedia = null;
  document.getElementById('cameraInput').value = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadButtons').style.display = '';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadBar').style.width = '0%';
  document.getElementById('btnAnalyze').disabled = true;
}

// =============================================
// Analyze colors
// =============================================
async function handleAnalyze() {
  if (!uploadedMedia) {
    showToast('Upload a photo first', 'error');
    return;
  }

  const caption = document.getElementById('captionInput').value.trim() || null;
  const spaceId = document.getElementById('spaceSelect').value || null;

  // Optionally link media to space
  if (spaceId && uploadedMedia.id) {
    try {
      await mediaService.linkMediaToSpace(uploadedMedia.id, spaceId, 0);
    } catch { /* ignore link failure */ }
  }

  // Create job
  const { data: job, error } = await supabase
    .from('paint_analysis_jobs')
    .insert({
      media_id: uploadedMedia.id,
      image_url: uploadedMedia.url,
      caption,
      space_id: spaceId,
      app_user_id: appUser.id,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('Job creation error:', error);
    showToast('Failed to start analysis', 'error');
    return;
  }

  activeJobId = job.id;

  // Show processing state
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('processingSection').style.display = '';
  document.getElementById('resultsSection').style.display = 'none';

  // Poll for results
  startPolling(job.id);
}

// =============================================
// Polling
// =============================================
function startPolling(jobId) {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    const { data: job } = await supabase
      .from('paint_analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) return;

    if (job.status === 'completed') {
      clearInterval(pollTimer);
      pollTimer = null;
      document.getElementById('processingSection').style.display = 'none';
      renderResults(job);
      loadHistory();
    } else if (job.status === 'failed') {
      clearInterval(pollTimer);
      pollTimer = null;
      document.getElementById('processingSection').style.display = 'none';
      document.getElementById('uploadSection').style.display = '';
      showToast('Analysis failed: ' + (job.error_message || 'Unknown error'), 'error');
    }
  }, 3000);
}

// =============================================
// Render results
// =============================================
function renderResults(job) {
  const analysis = job.analysis_result;
  const searches = job.search_results;

  if (!analysis || !analysis.colors) {
    showToast('No color data returned', 'error');
    document.getElementById('uploadSection').style.display = '';
    return;
  }

  // Show results section
  document.getElementById('resultsSection').style.display = '';

  // Surface analysis
  const surfaceEl = document.getElementById('surfaceAnalysis');
  if (analysis.surface_analysis || analysis.recommendations) {
    surfaceEl.innerHTML = `
      <div class="surface-card">
        <h3>Surface Analysis</h3>
        ${analysis.surface_analysis ? `<p>${escHtml(analysis.surface_analysis)}</p>` : ''}
        ${analysis.recommendations ? `<p style="margin-top:0.5rem"><strong>Prep:</strong> ${escHtml(analysis.recommendations)}</p>` : ''}
      </div>`;
  } else {
    surfaceEl.innerHTML = '';
  }

  // Color cards
  const cardsEl = document.getElementById('colorCards');
  cardsEl.innerHTML = '';

  analysis.colors.forEach((color, i) => {
    const matches = searches?.colors?.[i]?.matches || [];
    const card = document.createElement('div');
    card.className = 'color-card';

    card.innerHTML = `
      <div class="color-swatch" style="background-color:${escHtml(color.hex)}"></div>
      <div class="color-info">
        <div class="color-name">${escHtml(color.name)}</div>
        <div class="color-hex">${escHtml(color.hex)}${color.rgb ? ` · RGB(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})` : ''}</div>
        <div class="color-meta">
          ${color.surface_type ? `<span class="badge badge-surface">${escHtml(color.surface_type)}</span>` : ''}
          ${color.coverage_percent ? `<span>${color.coverage_percent}% coverage</span>` : ''}
          ${color.recommended_paint_type ? `<span class="badge badge-paint">${escHtml(color.recommended_paint_type)}</span>` : ''}
        </div>
        ${color.notes ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem">${escHtml(color.notes)}</p>` : ''}
        ${matches.length > 0 ? renderMatches(matches) : '<p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem">No store matches found</p>'}
      </div>`;

    cardsEl.appendChild(card);
  });
}

function renderMatches(matches) {
  const items = matches.map(m => `
    <div class="match-item">
      <div class="match-info">
        <div class="match-brand">${escHtml(m.brand || 'Unknown')}</div>
        <div class="match-product">${escHtml(m.product_name || m.title || 'Paint Match')}</div>
        ${m.paint_code ? `<div class="match-code">${escHtml(m.paint_code)}</div>` : ''}
        <div class="match-store">${escHtml(m.store || '')}${m.price_hint ? ` · ${escHtml(m.price_hint)}` : ''}</div>
      </div>
      ${m.url ? `<a href="${escHtml(m.url)}" target="_blank" rel="noopener" class="match-link">View →</a>` : ''}
    </div>`).join('');

  return `<div class="match-list"><div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:0.25rem">PAINT MATCHES</div>${items}</div>`;
}

// =============================================
// History
// =============================================
async function loadHistory() {
  const { data: jobs } = await supabase
    .from('paint_analysis_jobs')
    .select('*')
    .eq('app_user_id', appUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const listEl = document.getElementById('historyList');
  const emptyEl = document.getElementById('historyEmpty');

  if (!jobs || jobs.length === 0) {
    emptyEl.style.display = '';
    listEl.querySelectorAll('.history-item').forEach(el => el.remove());
    return;
  }

  emptyEl.style.display = 'none';
  // Clear old items
  listEl.querySelectorAll('.history-item').forEach(el => el.remove());

  jobs.forEach(job => {
    const el = document.createElement('div');
    el.className = 'history-item';

    const colors = job.analysis_result?.colors || [];
    const swatches = colors.slice(0, 6).map(c => `<div class="history-swatch" style="background:${escHtml(c.hex)}"></div>`).join('');
    const date = new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const statusIcon = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'processing' ? '⏳' : '🔄';

    el.innerHTML = `
      <div class="history-meta">
        <div>
          <div class="history-caption">${statusIcon} ${escHtml(job.caption || 'Untitled analysis')}</div>
          <div class="history-date">${date}</div>
        </div>
        <div class="history-actions">
          ${job.status === 'completed' ? `<button class="btn-icon" data-view="${job.id}" title="View results">👁️</button>` : ''}
          <button class="btn-icon danger" data-delete="${job.id}" title="Delete">🗑️</button>
        </div>
      </div>
      ${swatches ? `<div class="history-colors">${swatches}</div>` : ''}`;

    // View handler
    const viewBtn = el.querySelector('[data-view]');
    if (viewBtn) {
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('processingSection').style.display = 'none';
        renderResults(job);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Delete handler
    const delBtn = el.querySelector('[data-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this analysis?')) return;
        const { error } = await supabase
          .from('paint_analysis_jobs')
          .delete()
          .eq('id', job.id);
        if (error) {
          showToast('Failed to delete', 'error');
        } else {
          showToast('Deleted', 'success');
          loadHistory();
        }
      });
    }

    listEl.appendChild(el);
  });
}

// =============================================
// Util
// =============================================
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
