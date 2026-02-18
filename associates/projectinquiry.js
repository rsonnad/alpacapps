/**
 * Project Inquiry - Associate page for AI-powered project questions
 * Upload a photo → ask a question or pick a special analysis type
 * General questions answered by Claude CLI; Color Pick analyzed + matched via Brave
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
  activeTab: 'inquiry',
  onReady: async (state) => {
    authState = state;
    appUser = state.appUser;
    await initApp();
  }
});

const STORAGE_KEY_ASSIGNED = 'projectInquiry_assignedTo';
const STORAGE_KEY_SPECIAL = 'projectInquiry_specialType';
const STORAGE_KEY_SPACE = 'projectInquiry_space';

async function initApp() {
  await Promise.all([loadSpaces(), loadUsers()]);
  restoreDropdownSelections();
  setupEventListeners();
  setupDynamicFields();
  await loadHistory();
}

function restoreDropdownSelections() {
  const savedAssigned = localStorage.getItem(STORAGE_KEY_ASSIGNED);
  const savedSpecial = localStorage.getItem(STORAGE_KEY_SPECIAL);

  if (savedAssigned) {
    const sel = document.getElementById('assignedToSelect');
    // Only restore if the value exists in the dropdown
    if ([...sel.options].some(o => o.value === savedAssigned)) {
      sel.value = savedAssigned;
    }
  }
  if (savedSpecial) {
    const sel = document.getElementById('specialTypeSelect');
    if ([...sel.options].some(o => o.value === savedSpecial)) {
      sel.value = savedSpecial;
    }
  }

  const savedSpace = localStorage.getItem(STORAGE_KEY_SPACE);
  if (savedSpace) {
    const sel = document.getElementById('spaceSelect');
    if ([...sel.options].some(o => o.value === savedSpace)) {
      sel.value = savedSpace;
    }
  }
}

function persistDropdownSelections() {
  localStorage.setItem(STORAGE_KEY_ASSIGNED, document.getElementById('assignedToSelect').value);
  localStorage.setItem(STORAGE_KEY_SPECIAL, document.getElementById('specialTypeSelect').value);
  localStorage.setItem(STORAGE_KEY_SPACE, document.getElementById('spaceSelect').value);
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
// Load users for "Question for" dropdown
// =============================================
async function loadUsers() {
  const { data: users } = await supabase
    .from('app_users')
    .select('id, display_name, first_name, last_name, role, email')
    .not('role', 'in', '("demon","prospect","public")')
    .order('display_name');

  const select = document.getElementById('assignedToSelect');
  if (!users || !select) return;

  // Group by role, with staff/associates/admins first, residents last
  const roleOrder = ['oracle', 'admin', 'staff', 'associate', 'resident'];
  const roleLabels = {
    oracle: 'Admin',
    admin: 'Admin',
    staff: 'Staff',
    associate: 'Associates',
    resident: 'Residents',
  };

  // Merge oracle and admin into one group
  const groups = {
    'Staff': [],
    'Associates': [],
    'Admin': [],
    'Residents': [],
  };

  users.forEach(u => {
    // Skip bot user
    if (u.email === 'bot@alpacaplayhouse.com') return;
    const name = (u.first_name && u.last_name)
      ? `${u.first_name} ${u.last_name}`
      : u.display_name || u.email;
    const group = roleLabels[u.role] || 'Residents';
    if (groups[group]) {
      groups[group].push({ id: u.id, name });
    }
  });

  // Add optgroups in order: Staff, Associates, Admin, Residents
  const groupOrder = ['Staff', 'Associates', 'Admin', 'Residents'];
  groupOrder.forEach(groupName => {
    const members = groups[groupName];
    if (!members || members.length === 0) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
}

// =============================================
// Dynamic field visibility
// =============================================
// Question type config — each type defines its action button and label.
// Add new types here as needed (e.g. 'material_id', 'damage_assess').
const QUESTION_TYPE_CONFIG = {
  color_pick: { btnId: 'btnAnalyze', icon: '🎨', label: 'Analyze Color Options' },
  // Future types:
  // material_id: { btnId: 'btnAnalyze', icon: '🪵', label: 'Identify Material' },
};

function setupDynamicFields() {
  const questionInput = document.getElementById('questionInput');
  const specialTypeField = document.getElementById('specialTypeField');
  const specialTypeSelect = document.getElementById('specialTypeSelect');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnSubmitQuestion = document.getElementById('btnSubmitQuestion');

  function updateFieldVisibility() {
    const hasQuestion = questionInput.value.trim().length > 0;
    const selectedType = specialTypeSelect.value;
    const typeConfig = QUESTION_TYPE_CONFIG[selectedType];

    // When question is typed → hide Question Type, show Submit Question button
    // When no question → show Question Type, show type-specific button only if a type is selected
    specialTypeField.style.display = hasQuestion ? 'none' : '';
    btnSubmitQuestion.style.display = hasQuestion ? '' : 'none';
    btnAnalyze.style.display = (!hasQuestion && typeConfig) ? '' : 'none';

    // Update the action button label/icon to match selected type
    if (typeConfig) {
      const iconSpan = btnAnalyze.querySelector('span:first-child');
      const labelSpan = btnAnalyze.querySelector('span:last-child');
      if (iconSpan) iconSpan.textContent = typeConfig.icon;
      if (labelSpan) labelSpan.textContent = typeConfig.label;
    }

    // Enable/disable based on photo
    btnSubmitQuestion.disabled = !uploadedMedia;
    btnAnalyze.disabled = !uploadedMedia;
  }

  questionInput.addEventListener('input', updateFieldVisibility);
  specialTypeSelect.addEventListener('change', updateFieldVisibility);

  // Run once on init to set correct state (e.g. restored blank selection)
  updateFieldVisibility();
}

// =============================================
// Event listeners
// =============================================
function setupEventListeners() {
  const cameraInput = document.getElementById('cameraInput');
  const fileInput = document.getElementById('fileInput');
  const btnRemove = document.getElementById('btnRemove');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnSubmitQuestion = document.getElementById('btnSubmitQuestion');
  const btnNewAnalysis = document.getElementById('btnNewAnalysis');

  // Persist dropdown selections on change
  document.getElementById('assignedToSelect').addEventListener('change', persistDropdownSelections);
  document.getElementById('specialTypeSelect').addEventListener('change', persistDropdownSelections);
  document.getElementById('spaceSelect').addEventListener('change', persistDropdownSelections);

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

  // Analyze (Color Pick)
  btnAnalyze.addEventListener('click', () => handleSubmit('color_pick'));

  // Submit Question (General)
  btnSubmitQuestion.addEventListener('click', () => handleSubmit('general'));

  // New inquiry
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
      caption: document.getElementById('captionInput').value.trim() || 'Project inquiry',
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
    // Enable whichever button is currently visible
    document.getElementById('btnAnalyze').disabled = false;
    document.getElementById('btnSubmitQuestion').disabled = false;
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
  document.getElementById('btnSubmitQuestion').disabled = true;
  // Reset question field and show special type
  document.getElementById('questionInput').value = '';
  document.getElementById('specialTypeField').style.display = '';
  document.getElementById('btnAnalyze').style.display = '';
  document.getElementById('btnSubmitQuestion').style.display = 'none';
}

// =============================================
// Submit inquiry (both types)
// =============================================
async function handleSubmit(inquiryType) {
  if (!uploadedMedia) {
    showToast('Upload a photo first', 'error');
    return;
  }

  const caption = document.getElementById('captionInput').value.trim() || null;
  const spaceId = document.getElementById('spaceSelect').value || null;
  const assignedToId = document.getElementById('assignedToSelect').value || null;
  const question = document.getElementById('questionInput').value.trim() || null;

  // Get assigned user's display name
  let assignedToName = null;
  if (assignedToId) {
    const sel = document.getElementById('assignedToSelect');
    assignedToName = sel.options[sel.selectedIndex]?.textContent || null;
  }

  // Optionally link media to space
  if (spaceId && uploadedMedia.id) {
    try {
      await mediaService.linkMediaToSpace(uploadedMedia.id, spaceId, 0);
    } catch { /* ignore link failure */ }
  }

  // Create job
  const { data: job, error } = await supabase
    .from('project_inquiries')
    .insert({
      media_id: uploadedMedia.id,
      image_url: uploadedMedia.url,
      caption,
      space_id: spaceId,
      app_user_id: appUser.id,
      status: 'pending',
      inquiry_type: inquiryType,
      question,
      assigned_to: assignedToId,
      assigned_to_name: assignedToName,
    })
    .select()
    .single();

  if (error) {
    console.error('Job creation error:', error);
    showToast('Failed to start inquiry', 'error');
    return;
  }

  activeJobId = job.id;

  // Show processing state
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('processingSection').style.display = '';
  document.getElementById('resultsSection').style.display = 'none';

  // Update processing title
  const processingTitle = document.getElementById('processingTitle');
  if (inquiryType === 'general') {
    processingTitle.textContent = 'Answering your question...';
  } else {
    processingTitle.textContent = 'Analyzing colors...';
  }

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
      .from('project_inquiries')
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
      showToast('Inquiry failed: ' + (job.error_message || 'Unknown error'), 'error');
    }
  }, 3000);
}

// =============================================
// Render results
// =============================================
function renderResults(job) {
  // Show results section
  document.getElementById('resultsSection').style.display = '';
  const answerEl = document.getElementById('answerResult');
  const surfaceEl = document.getElementById('surfaceAnalysis');
  const cardsEl = document.getElementById('colorCards');
  const resultsTitle = document.getElementById('resultsTitle');

  // Clear previous results
  answerEl.innerHTML = '';
  surfaceEl.innerHTML = '';
  cardsEl.innerHTML = '';

  if (job.inquiry_type === 'general') {
    // General question results
    resultsTitle.textContent = 'Answer';
    answerEl.innerHTML = `
      <div class="answer-card">
        <h3>AI Response</h3>
        ${job.question ? `<p class="question-text">"${escHtml(job.question)}"</p>` : ''}
        <p>${escHtml(job.answer || 'No answer available')}</p>
      </div>`;
    return;
  }

  // Color Pick results
  resultsTitle.textContent = 'Color Analysis';
  const analysis = job.analysis_result;
  const searches = job.search_results;

  if (!analysis || !analysis.colors) {
    showToast('No color data returned', 'error');
    document.getElementById('uploadSection').style.display = '';
    return;
  }

  // Surface analysis
  if (analysis.surface_analysis || analysis.recommendations) {
    surfaceEl.innerHTML = `
      <div class="surface-card">
        <h3>Surface Analysis</h3>
        ${analysis.surface_analysis ? `<p>${escHtml(analysis.surface_analysis)}</p>` : ''}
        ${analysis.recommendations ? `<p style="margin-top:0.5rem"><strong>Prep:</strong> ${escHtml(analysis.recommendations)}</p>` : ''}
      </div>`;
  }

  // Color cards
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
    .from('project_inquiries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const listEl = document.getElementById('historyList');
  const emptyEl = document.getElementById('historyEmpty');

  if (!jobs || jobs.length === 0) {
    emptyEl.style.display = '';
    listEl.querySelectorAll('.history-section-title, .history-group-title, .history-item').forEach(el => el.remove());
    return;
  }

  emptyEl.style.display = 'none';
  // Clear old items
  listEl.querySelectorAll('.history-section-title, .history-group-title, .history-item').forEach(el => el.remove());

  // Split into "For Me" and "All"
  const forMe = jobs.filter(j => j.assigned_to === appUser.id && j.app_user_id !== appUser.id);
  const allOthers = jobs.filter(j => !(j.assigned_to === appUser.id && j.app_user_id !== appUser.id));

  // "For You" section
  if (forMe.length > 0) {
    const forYouTitle = document.createElement('div');
    forYouTitle.className = 'history-section-title';
    forYouTitle.textContent = `For You (${forMe.length})`;
    listEl.appendChild(forYouTitle);

    forMe.forEach(job => {
      listEl.appendChild(buildHistoryItem(job, true));
    });
  }

  // "All Inquiries" section
  if (allOthers.length > 0) {
    const allTitle = document.createElement('div');
    allTitle.className = 'history-section-title';
    allTitle.textContent = forMe.length > 0 ? 'All Inquiries' : 'Recent Inquiries';
    listEl.appendChild(allTitle);

    // Group by inquiry_type
    const colorPick = allOthers.filter(j => j.inquiry_type === 'color_pick');
    const general = allOthers.filter(j => j.inquiry_type === 'general');

    if (colorPick.length > 0) {
      const groupTitle = document.createElement('div');
      groupTitle.className = 'history-group-title';
      groupTitle.textContent = `🎨 Color Pick (${colorPick.length})`;
      listEl.appendChild(groupTitle);
      colorPick.forEach(job => listEl.appendChild(buildHistoryItem(job, false)));
    }

    if (general.length > 0) {
      const groupTitle = document.createElement('div');
      groupTitle.className = 'history-group-title';
      groupTitle.textContent = `❓ General (${general.length})`;
      listEl.appendChild(groupTitle);
      general.forEach(job => listEl.appendChild(buildHistoryItem(job, false)));
    }
  }
}

function buildHistoryItem(job, isForMe) {
  const el = document.createElement('div');
  el.className = 'history-item' + (isForMe ? ' for-me' : '');

  const colors = job.analysis_result?.colors || [];
  const swatches = colors.slice(0, 6).map(c => `<div class="history-swatch" style="background:${escHtml(c.hex)}"></div>`).join('');
  const date = new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const statusIcon = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'processing' ? '⏳' : '🔄';
  const typeIcon = job.inquiry_type === 'general' ? '❓' : '🎨';
  const typeBadge = `<span class="badge-type ${job.inquiry_type === 'general' ? 'general' : 'color-pick'}">${job.inquiry_type === 'general' ? 'General' : 'Color Pick'}</span>`;

  // Caption or question preview
  let titleText = '';
  if (job.inquiry_type === 'general' && job.question) {
    titleText = `"${job.question.substring(0, 60)}${job.question.length > 60 ? '...' : ''}"`;
  } else {
    titleText = job.caption || 'Untitled analysis';
  }

  // From line (for assigned items)
  const fromLine = isForMe && job.assigned_to_name
    ? ''
    : (job.assigned_to_name ? `<div class="history-from">For: ${escHtml(job.assigned_to_name)}</div>` : '');

  el.innerHTML = `
    <div class="history-meta">
      <div>
        <div class="history-caption">${statusIcon} ${typeBadge} ${escHtml(titleText)}</div>
        <div class="history-date">${date}</div>
        ${fromLine}
      </div>
      <div class="history-actions">
        ${job.status === 'completed' ? `<button class="btn-icon" data-view="${job.id}" title="View results">👁️</button>` : ''}
        ${job.app_user_id === appUser.id ? `<button class="btn-icon danger" data-delete="${job.id}" title="Delete">🗑️</button>` : ''}
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
      if (!confirm('Delete this inquiry?')) return;
      const { error } = await supabase
        .from('project_inquiries')
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

  return el;
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
