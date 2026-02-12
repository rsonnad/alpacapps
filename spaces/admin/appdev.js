/**
 * App Dev - Claudero AI Developer Console
 * Submit feature requests to the feature builder worker on the DO droplet.
 * Shows live build progress and reverse-chronological status timeline.
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { mediaService } from '../../shared/media-service.js';

let authState = null;
let pollTimer = null;
let hasActiveBuild = false;
let pendingAttachments = []; // { id, file, url, name, size, type, uploading }

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initAdminPage({
      activeTab: 'appdev',
      requiredPermission: 'view_appdev',
      section: 'staff',
      onReady: async (state) => {
        authState = state;
        setupPromptBox();
        await loadHistory();
        startPolling();
      }
    });
  } catch (err) {
    console.error('AppDev init failed:', err);
  }
});

// =============================================
// PROMPT BOX
// =============================================
function setupPromptBox() {
  const textarea = document.getElementById('featurePrompt');
  const submitBtn = document.getElementById('submitBtn');
  const charCount = document.getElementById('charCount');

  textarea.addEventListener('input', () => {
    const len = textarea.value.trim().length;
    charCount.textContent = `${len} chars`;
    submitBtn.disabled = len < 10 || hasActiveBuild;
  });

  submitBtn.addEventListener('click', () => submitFeatureRequest());

  // File inputs
  document.getElementById('cameraInput').addEventListener('change', (e) => handleFiles(e.target.files));
  document.getElementById('fileInput').addEventListener('change', (e) => handleFiles(e.target.files));

  // Paste images from clipboard
  textarea.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  });

  // Drag and drop onto the prompt card
  const promptCard = document.querySelector('.appdev-prompt-card');
  promptCard.addEventListener('dragover', (e) => {
    e.preventDefault();
    promptCard.style.borderColor = 'var(--accent)';
    promptCard.style.borderStyle = 'dashed';
  });
  promptCard.addEventListener('dragleave', () => {
    promptCard.style.borderColor = '';
    promptCard.style.borderStyle = '';
  });
  promptCard.addEventListener('drop', (e) => {
    e.preventDefault();
    promptCard.style.borderColor = '';
    promptCard.style.borderStyle = '';
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  });
}

// =============================================
// FILE ATTACHMENTS
// =============================================
async function handleFiles(fileList) {
  if (!fileList?.length) return;

  for (const file of fileList) {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} is too large (max 10 MB)`, 'warning');
      continue;
    }

    const id = Math.random().toString(36).substring(2, 10);
    const entry = { id, file, url: null, name: file.name, size: file.size, type: file.type, uploading: true };
    pendingAttachments.push(entry);
    renderThumbs();

    try {
      // Compress images > 500KB
      let uploadFile = file;
      const isImage = file.type.startsWith('image/');
      if (isImage && file.size > 500 * 1024) {
        try {
          const compressed = await mediaService.compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.85 });
          if (compressed.size < file.size) uploadFile = compressed;
        } catch { /* use original */ }
      }

      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const ext = file.name.split('.').pop().toLowerCase();
      const storagePath = `appdev/${timestamp}-${randomId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('housephotos')
        .upload(storagePath, uploadFile);

      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage
        .from('housephotos')
        .getPublicUrl(storagePath);

      entry.url = urlData.publicUrl;
      entry.uploading = false;
      renderThumbs();
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
      pendingAttachments = pendingAttachments.filter(a => a.id !== id);
      renderThumbs();
    }
  }

  // Reset file inputs
  document.getElementById('cameraInput').value = '';
  document.getElementById('fileInput').value = '';
}

function removeAttachment(id) {
  pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  renderThumbs();
}

function renderThumbs() {
  const container = document.getElementById('attachThumbs');
  if (!pendingAttachments.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = pendingAttachments.map(att => {
    const isImage = att.type.startsWith('image/');
    const preview = isImage && att.file
      ? `<img src="${URL.createObjectURL(att.file)}" alt="">`
      : `<div class="appdev-thumb-file">${escapeHtml(att.name)}</div>`;

    return `
      <div class="appdev-thumb ${att.uploading ? 'uploading' : ''}" data-id="${att.id}">
        ${preview}
        ${att.uploading ? '<div class="appdev-thumb-progress" style="width:50%"></div>' : ''}
        <button class="appdev-thumb-remove" onclick="window._removeAttachment('${att.id}')">&times;</button>
      </div>
    `;
  }).join('');
}

// Expose for inline onclick
window._removeAttachment = removeAttachment;

async function submitFeatureRequest() {
  const textarea = document.getElementById('featurePrompt');
  const submitBtn = document.getElementById('submitBtn');
  const description = textarea.value.trim();

  if (description.length < 10) {
    showToast('Please describe the feature in at least 10 characters.', 'warning');
    return;
  }

  // Check if any uploads still in progress
  if (pendingAttachments.some(a => a.uploading)) {
    showToast('Please wait for uploads to finish.', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    // Build attachments array (only successfully uploaded)
    const attachments = pendingAttachments
      .filter(a => a.url)
      .map(a => ({ url: a.url, name: a.name, size: a.size, type: a.type }));

    const { error } = await supabase.from('feature_requests').insert({
      requester_user_id: authState.appUser?.id || null,
      requester_name: authState.appUser?.display_name || authState.email || 'Unknown',
      requester_role: authState.role || 'staff',
      requester_email: authState.email || null,
      description,
      status: 'pending',
      attachments: attachments.length ? attachments : [],
    });

    if (error) throw error;

    showToast('Feature request submitted! Claudero will pick it up shortly.', 'success');
    textarea.value = '';
    pendingAttachments = [];
    renderThumbs();
    document.getElementById('charCount').textContent = '0 chars';
    await loadHistory();
  } catch (err) {
    showToast(`Failed to submit: ${err.message}`, 'error');
  } finally {
    submitBtn.textContent = 'Submit to Claudero';
    submitBtn.disabled = false;
  }
}

// =============================================
// POLLING
// =============================================
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollTick, hasActiveBuild ? 10000 : 30000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
    } else {
      loadHistory();
      startPolling();
    }
  });
}

async function pollTick() {
  await loadHistory();
}

// =============================================
// LOAD HISTORY
// =============================================
async function loadHistory() {
  try {
    const userId = authState.appUser?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('feature_requests')
      .select('*')
      .eq('requester_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    renderHistory(data || []);
    updateActiveBuild(data || []);
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// =============================================
// ACTIVE BUILD BANNER
// =============================================
function updateActiveBuild(requests) {
  const activeBanner = document.getElementById('activeBuild');
  const statusEl = document.getElementById('activeBuildStatus');
  const submitBtn = document.getElementById('submitBtn');

  const active = requests.find(r => ['pending', 'processing', 'building'].includes(r.status));
  const wasActive = hasActiveBuild;
  hasActiveBuild = !!active;

  // Adjust polling speed if active state changed
  if (hasActiveBuild !== wasActive) {
    startPolling();
  }

  if (active) {
    activeBanner.classList.add('visible');
    submitBtn.disabled = true;

    const badgeColor = active.status === 'pending' ? '#e0e7ff' : '#fef3c7';
    const badgeText = active.status === 'pending' ? '#3730a3' : '#92400e';
    statusEl.innerHTML = `
      <span class="status-badge" style="background:${badgeColor};color:${badgeText}">${active.status}</span>
      ${active.progress_message || 'Waiting for Claudero to pick up the request...'}
      <div style="margin-top:0.4rem;font-size:0.8rem;color:var(--text-muted)">
        ${escapeHtml(active.description.substring(0, 120))}${active.description.length > 120 ? '...' : ''}
      </div>
    `;
  } else {
    activeBanner.classList.remove('visible');
    // Re-enable submit if there's text
    const textarea = document.getElementById('featurePrompt');
    submitBtn.disabled = (textarea.value.trim().length < 10);
  }
}

// =============================================
// RENDER HISTORY
// =============================================
function renderHistory(requests) {
  const container = document.getElementById('historyContainer');

  if (!requests.length) {
    container.innerHTML = '<div class="appdev-empty">No feature requests yet. Describe something above and hit submit.</div>';
    return;
  }

  // Group by parent chain: root requests and their follow-ups
  const rootRequests = requests.filter(r => !r.parent_request_id);
  const followUps = requests.filter(r => r.parent_request_id);
  const followUpMap = {};
  for (const fu of followUps) {
    if (!followUpMap[fu.parent_request_id]) followUpMap[fu.parent_request_id] = [];
    followUpMap[fu.parent_request_id].push(fu);
  }

  container.innerHTML = rootRequests.map(req => {
    const chain = [req, ...(followUpMap[req.id] || [])];
    // Sort chain newest first
    chain.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const latestStatus = chain[0].status;
    const isActive = ['pending', 'processing', 'building'].includes(latestStatus);

    return `
      <div class="appdev-request ${isActive ? '' : 'collapsed'}">
        <div class="appdev-request-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="appdev-request-badge ${latestStatus}">${latestStatus}</span>
          <span class="appdev-request-title">${escapeHtml(req.description.substring(0, 80))}${req.description.length > 80 ? '...' : ''}</span>
          ${chain.length > 1 ? `<span class="appdev-followup-badge">${chain.length - 1} follow-up${chain.length > 2 ? 's' : ''}</span>` : ''}
          <span class="appdev-request-time">${formatTimeAgo(req.created_at)}</span>
          <svg class="appdev-request-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="appdev-request-body">
          <div class="appdev-request-desc">${escapeHtml(req.description)}</div>
          ${renderAttachments(req.attachments)}
          <ul class="appdev-timeline">
            ${chain.map(item => renderTimelineItem(item)).join('')}
          </ul>
        </div>
      </div>
    `;
  }).join('');
}

function renderTimelineItem(req) {
  const timelineClass = getTimelineClass(req.status);
  const items = [];

  // Submitted
  items.push({
    time: req.created_at,
    label: req.parent_request_id ? 'Follow-up submitted' : 'Submitted',
    detail: req.parent_request_id ? escapeHtml(req.description.substring(0, 200)) : null,
    class: 'success',
  });

  // Processing started
  if (req.processing_started_at) {
    items.push({
      time: req.processing_started_at,
      label: 'Claudero picked up',
      detail: null,
      class: 'active',
    });
  }

  // Status updates for in-flight
  if (['processing', 'building'].includes(req.status) && req.progress_message) {
    items.push({
      time: null,
      label: req.status === 'building' ? 'Building' : 'Processing',
      detail: req.progress_message,
      class: 'active',
    });
  }

  // Completed
  if (req.status === 'completed' && req.completed_at) {
    const details = buildCompletionDetails(req);
    items.push({
      time: req.completed_at,
      label: req.deploy_decision === 'auto_merged' ? 'Deployed' : 'Completed',
      detail: null,
      class: 'success',
      html: details,
    });
  }

  // Failed
  if (req.status === 'failed' && req.completed_at) {
    items.push({
      time: req.completed_at,
      label: 'Failed',
      detail: req.error_message || 'Unknown error',
      class: 'error',
    });
  }

  // Review
  if (req.status === 'review') {
    const details = buildReviewDetails(req);
    items.push({
      time: req.review_notified_at || req.completed_at,
      label: 'Sent for review',
      detail: null,
      class: 'active',
      html: details,
    });
  }

  // Reverse chronological
  items.reverse();

  return items.map(item => `
    <li class="appdev-timeline-item ${item.class}">
      ${item.time ? `<span class="appdev-timeline-time">${formatDateTime(item.time)}</span>` : ''}
      <span class="appdev-timeline-label">${item.label}</span>
      ${item.detail ? `<span class="appdev-timeline-detail"> &mdash; ${item.detail}</span>` : ''}
      ${item.html || ''}
    </li>
  `).join('');
}

function buildCompletionDetails(req) {
  const parts = [];

  if (req.build_summary) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Summary</h4>
      <p>${escapeHtml(req.build_summary)}</p>
    </div>`);
  }

  // Design outline from risk_assessment metadata
  const risk = req.risk_assessment || {};
  if (risk.design_outline) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Design</h4>
      <p>${escapeHtml(risk.design_outline)}</p>
    </div>`);
  }
  if (risk.testing_instructions) {
    parts.push(`<div class="appdev-detail-section">
      <h4>How to Test</h4>
      <p>${escapeHtml(risk.testing_instructions)}</p>
    </div>`);
  }

  if (req.files_created?.length) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Files Created</h4>
      <ul class="appdev-file-list">${req.files_created.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>
    </div>`);
  }

  const meta = [];
  if (req.commit_sha) meta.push(`<strong>Commit:</strong> <code>${req.commit_sha.substring(0, 8)}</code>`);
  if (req.branch_name) meta.push(`<strong>Branch:</strong> <code>${req.branch_name}</code>`);
  if (req.deploy_decision) meta.push(`<strong>Deploy:</strong> ${req.deploy_decision === 'auto_merged' ? 'Auto-merged to main' : req.deploy_decision}`);
  if (req.claude_turns_used) meta.push(`<strong>Turns:</strong> ${req.claude_turns_used}`);

  if (meta.length) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Build Info</h4>
      <p>${meta.join(' &bull; ')}</p>
    </div>`);
  }

  // Page URL
  if (req.progress_message && req.progress_message.includes('https://')) {
    const urlMatch = req.progress_message.match(/(https:\/\/[^\s]+)/);
    if (urlMatch) {
      parts.push(`<div class="appdev-detail-section">
        <h4>Live Page</h4>
        <p><a href="${urlMatch[1]}" target="_blank">${urlMatch[1]}</a></p>
      </div>`);
    }
  }

  return parts.join('');
}

function buildReviewDetails(req) {
  const parts = [];

  if (req.build_summary) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Summary</h4>
      <p>${escapeHtml(req.build_summary)}</p>
    </div>`);
  }

  const risk = req.risk_assessment || {};
  if (risk.hard_rule_reasons?.length) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Review Reasons</h4>
      <ul class="appdev-file-list">${risk.hard_rule_reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>`);
  }

  if (req.files_created?.length) {
    parts.push(`<div class="appdev-detail-section">
      <h4>Files Created</h4>
      <ul class="appdev-file-list">${req.files_created.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>
    </div>`);
  }

  if (req.branch_name) {
    const compareUrl = `https://github.com/rsonnad/alpacapps/compare/${req.branch_name}`;
    parts.push(`<div class="appdev-detail-section">
      <h4>Branch</h4>
      <p><code>${escapeHtml(req.branch_name)}</code> &mdash; <a href="${compareUrl}" target="_blank">Review on GitHub</a></p>
    </div>`);
  }

  return parts.join('');
}

function renderAttachments(attachments) {
  if (!attachments?.length) return '';
  return `<div class="appdev-attachments">
    ${attachments.map(att => {
      const isImage = att.type?.startsWith('image/');
      if (isImage) {
        return `<a href="${att.url}" target="_blank"><img src="${att.url}" alt="${escapeHtml(att.name)}"></a>`;
      }
      return `<a href="${att.url}" target="_blank" class="file-link">${escapeHtml(att.name)}</a>`;
    }).join('')}
  </div>`;
}

function getTimelineClass(status) {
  if (['completed'].includes(status)) return 'success';
  if (['failed'].includes(status)) return 'error';
  if (['pending', 'processing', 'building', 'review'].includes(status)) return 'active';
  return '';
}

// =============================================
// HELPERS
// =============================================
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
