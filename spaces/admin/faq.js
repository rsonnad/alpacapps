// FAQ Management Page
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/supabase.js';
import { initAuth, getAuthState } from '../../shared/auth.js';

// State
let faqEntries = [];
let contextLinks = [];
let contextMeta = null;
let contextEntries = [];

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const unauthorizedOverlay = document.getElementById('unauthorizedOverlay');
const appContent = document.getElementById('appContent');
const toastContainer = document.getElementById('toastContainer');

// Check if running in embed mode (inside iframe)
const isEmbed = new URLSearchParams(window.location.search).has('embed');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { user, role } = await initAuth();

    if (!user || (role !== 'admin' && role !== 'staff')) {
      loadingOverlay.classList.add('hidden');
      unauthorizedOverlay.classList.remove('hidden');
      return;
    }

    // Hide header in embed mode
    if (isEmbed) {
      const header = document.querySelector('header');
      if (header) header.style.display = 'none';
      const backLink = document.querySelector('.back-link');
      if (backLink) backLink.style.display = 'none';
    }

    // Set up user info
    document.getElementById('userInfo').textContent = user.email;
    document.getElementById('signOutBtn').addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/spaces/admin/';
    });

    // Load data
    await loadData();

    // Set up event listeners
    setupEventListeners();

    // Check URL for question_id parameter
    const urlParams = new URLSearchParams(window.location.search);
    const questionId = urlParams.get('question_id');
    if (questionId) {
      const entry = faqEntries.find(e => e.id === questionId);
      if (entry) {
        openFaqModal(entry);
      }
    }

    // Show content
    loadingOverlay.classList.add('hidden');
    appContent.classList.remove('hidden');
  } catch (error) {
    console.error('Init error:', error);
    showToast('Failed to initialize', 'error');
  }
});

async function loadData() {
  await Promise.all([
    loadFaqEntries(),
    loadContextLinks(),
    loadContextMeta(),
    loadContextEntries()
  ]);
  renderAll();
}

async function loadFaqEntries() {
  const { data, error } = await supabase
    .from('faq_entries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading FAQ entries:', error);
    return;
  }
  faqEntries = data || [];
}

async function loadContextLinks() {
  const { data, error } = await supabase
    .from('faq_context_links')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading context links:', error);
    return;
  }
  contextLinks = data || [];
}

async function loadContextMeta() {
  const { data, error } = await supabase
    .from('faq_context_meta')
    .select('*')
    .eq('id', 1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error loading context meta:', error);
    return;
  }
  contextMeta = data;
}

async function loadContextEntries() {
  const { data, error } = await supabase
    .from('faq_context_entries')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error loading context entries:', error);
    return;
  }
  contextEntries = data || [];
}

function setupEventListeners() {
  document.getElementById('recompileBtn').addEventListener('click', recompileContext);
  document.getElementById('addFaqBtn').addEventListener('click', () => openFaqModal());
  document.getElementById('addLinkBtn').addEventListener('click', () => openLinkModal());
  const addContextBtn = document.getElementById('addContextEntryBtn');
  if (addContextBtn) addContextBtn.addEventListener('click', () => openContextEntryModal());
}

function renderAll() {
  renderContextMeta();
  renderQuestionLog();
  renderPendingQuestions();
  renderFaqEntries();
  renderContextEntries();
  renderContextLinks();
}

function renderContextMeta() {
  const lastCompiled = document.getElementById('lastCompiled');
  const statSpaces = document.getElementById('statSpaces');
  const statFaqs = document.getElementById('statFaqs');
  const statLinks = document.getElementById('statLinks');

  if (contextMeta?.last_compiled_at) {
    const date = new Date(contextMeta.last_compiled_at);
    lastCompiled.textContent = `Last compiled: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } else {
    lastCompiled.textContent = 'Last compiled: Never';
  }

  statSpaces.textContent = contextMeta?.entry_count || '-';
  statFaqs.textContent = faqEntries.filter(e => e.answer && e.is_published).length;
  statLinks.textContent = contextLinks.filter(l => l.is_active).length;
}

function renderQuestionLog() {
  const container = document.getElementById('questionLogSection');
  if (!container) return; // Not on page yet

  const autoEntries = faqEntries.filter(e => e.source === 'auto');
  const countBadge = document.getElementById('questionLogCount');
  if (countBadge) countBadge.textContent = autoEntries.length;

  if (autoEntries.length === 0) {
    container.innerHTML = '<div class="empty-state">No questions asked yet</div>';
    return;
  }

  container.innerHTML = `
    <div class="faq-list">
      ${autoEntries.map(entry => `
        <div class="faq-card">
          <div class="faq-card__header">
            <div class="faq-card__question">${escapeHtml(entry.question)}</div>
            <div class="faq-card__actions">
              <span class="confidence-badge confidence-badge--${(entry.confidence || 'LOW').toLowerCase()}">${entry.confidence || '?'}</span>
              <button class="btn-danger btn-small" onclick="deleteFaq('${entry.id}')">×</button>
            </div>
          </div>
          ${entry.ai_answer ? `<div class="faq-card__answer" style="color: #555; font-style: italic;">${escapeHtml(entry.ai_answer)}</div>` : ''}
          <div class="faq-card__meta">
            <span>${formatDate(entry.created_at)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPendingQuestions() {
  const container = document.getElementById('pendingSection');
  const countBadge = document.getElementById('pendingCount');

  const pending = faqEntries.filter(e => !e.answer);
  countBadge.textContent = pending.length;

  if (pending.length === 0) {
    container.innerHTML = '<div class="empty-state">No pending questions</div>';
    return;
  }

  container.innerHTML = `
    <div class="faq-list">
      ${pending.map(entry => `
        <div class="faq-card faq-card--pending">
          <div class="faq-card__header">
            <div class="faq-card__question">${escapeHtml(entry.question)}</div>
            <div class="faq-card__actions">
              <button class="btn-primary btn-small" onclick="openFaqModal(${JSON.stringify(entry).replace(/"/g, '&quot;')})">Answer</button>
              <button class="btn-danger btn-small" onclick="deleteFaq('${entry.id}')">Delete</button>
            </div>
          </div>
          <div class="faq-card__meta">
            <span class="faq-card__source faq-card__source--${entry.source}">${formatSource(entry.source)}</span>
            ${entry.user_name ? `<span>${escapeHtml(entry.user_name)}</span>` : ''}
            ${entry.user_email ? `<span>${escapeHtml(entry.user_email)}</span>` : ''}
            ${entry.user_phone ? `<span>${escapeHtml(entry.user_phone)}</span>` : ''}
            <span>${formatDate(entry.created_at)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderFaqEntries() {
  const container = document.getElementById('faqSection');
  const countBadge = document.getElementById('faqCount');

  const answered = faqEntries.filter(e => e.answer);
  countBadge.textContent = answered.length;

  if (answered.length === 0) {
    container.innerHTML = '<div class="empty-state">No FAQ entries yet</div>';
    return;
  }

  container.innerHTML = `
    <div class="faq-list">
      ${answered.map(entry => `
        <div class="faq-card">
          <div class="faq-card__header">
            <div class="faq-card__question">${escapeHtml(entry.question)}</div>
            <div class="faq-card__actions">
              <button class="btn-secondary btn-small" onclick="openFaqModal(${JSON.stringify(entry).replace(/"/g, '&quot;')})">Edit</button>
              <button class="btn-danger btn-small" onclick="deleteFaq('${entry.id}')">Delete</button>
            </div>
          </div>
          <div class="faq-card__answer">${escapeHtml(entry.answer)}</div>
          <div class="faq-card__meta">
            ${entry.is_published ? '<span class="published-badge">Published</span>' : ''}
            <span class="faq-card__source faq-card__source--${entry.source}">${formatSource(entry.source)}</span>
            <span>${formatDate(entry.answered_at || entry.created_at)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderContextEntries() {
  const container = document.getElementById('contextEntriesSection');
  if (!container) return;

  const countBadge = document.getElementById('contextEntriesCount');
  if (countBadge) countBadge.textContent = contextEntries.length;

  if (contextEntries.length === 0) {
    container.innerHTML = '<div class="empty-state">No context entries. Add knowledge about your property for the AI to use.</div>';
    return;
  }

  container.innerHTML = `
    <div class="faq-list">
      ${contextEntries.map(entry => `
        <div class="faq-card ${entry.is_active ? '' : 'faq-card--inactive'}">
          <div class="faq-card__header">
            <div class="faq-card__question">${escapeHtml(entry.title)}</div>
            <div class="faq-card__actions">
              <button class="btn-secondary btn-small" onclick='openContextEntryModal(${JSON.stringify(entry).replace(/'/g, "\\'").replace(/"/g, "&quot;")})'>Edit</button>
              <button class="btn-danger btn-small" onclick="deleteContextEntry('${entry.id}')">Delete</button>
            </div>
          </div>
          <div class="faq-card__answer">${escapeHtml(entry.content)}</div>
          <div class="faq-card__meta">
            ${entry.is_active ? '<span class="published-badge">Active</span>' : '<span style="color:#999;">Inactive</span>'}
            <span>Order: ${entry.display_order}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderContextLinks() {
  const container = document.getElementById('linksSection');
  const countBadge = document.getElementById('linksCount');

  countBadge.textContent = contextLinks.length;

  if (contextLinks.length === 0) {
    container.innerHTML = '<div class="empty-state">No context links added</div>';
    return;
  }

  container.innerHTML = `
    <div class="link-list">
      ${contextLinks.map(link => `
        <div class="link-card ${link.is_active ? '' : 'link-card--inactive'}">
          <div class="link-card__icon">
            ${getLinkIcon(link.url)}
          </div>
          <div class="link-card__content">
            <div class="link-card__title">${escapeHtml(link.title)}</div>
            <div class="link-card__url"><a href="${escapeHtml(link.url)}" target="_blank">${escapeHtml(truncateUrl(link.url))}</a></div>
            ${link.description ? `<div class="link-card__description">${escapeHtml(link.description)}</div>` : ''}
          </div>
          <div class="link-card__actions">
            <button class="btn-secondary btn-small" onclick="openLinkModal(${JSON.stringify(link).replace(/"/g, '&quot;')})">Edit</button>
            <button class="btn-danger btn-small" onclick="deleteLink('${link.id}')">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// FAQ Modal
window.openFaqModal = function(entry = null) {
  const modal = document.getElementById('faqModal');
  const title = document.getElementById('faqModalTitle');
  const form = document.getElementById('faqForm');

  form.reset();

  if (entry) {
    title.textContent = entry.answer ? 'Edit FAQ Entry' : 'Answer Question';
    document.getElementById('faqId').value = entry.id;
    document.getElementById('faqQuestion').value = entry.question;
    document.getElementById('faqAnswer').value = entry.answer || '';
    document.getElementById('faqPublished').checked = entry.is_published || false;
  } else {
    title.textContent = 'Add FAQ Entry';
    document.getElementById('faqId').value = '';
    document.getElementById('faqPublished').checked = true;
  }

  modal.classList.remove('hidden');
};

window.closeFaqModal = function() {
  document.getElementById('faqModal').classList.add('hidden');
};

window.saveFaq = async function() {
  const id = document.getElementById('faqId').value;
  const question = document.getElementById('faqQuestion').value.trim();
  const answer = document.getElementById('faqAnswer').value.trim();
  const is_published = document.getElementById('faqPublished').checked;

  if (!question || !answer) {
    showToast('Please fill in both question and answer', 'error');
    return;
  }

  const data = {
    question,
    answer,
    is_published,
    answered_at: new Date().toISOString()
  };

  try {
    if (id) {
      const { error } = await supabase
        .from('faq_entries')
        .update(data)
        .eq('id', id);

      if (error) throw error;
      showToast('FAQ entry updated', 'success');
    } else {
      data.source = 'manual';
      const { error } = await supabase
        .from('faq_entries')
        .insert(data);

      if (error) throw error;
      showToast('FAQ entry created', 'success');
    }

    closeFaqModal();
    await loadFaqEntries();
    renderAll();
  } catch (error) {
    console.error('Error saving FAQ:', error);
    showToast('Failed to save FAQ entry', 'error');
  }
};

window.deleteFaq = async function(id) {
  if (!confirm('Delete this FAQ entry?')) return;

  try {
    const { error } = await supabase
      .from('faq_entries')
      .delete()
      .eq('id', id);

    if (error) throw error;
    showToast('FAQ entry deleted', 'success');
    await loadFaqEntries();
    renderAll();
  } catch (error) {
    console.error('Error deleting FAQ:', error);
    showToast('Failed to delete FAQ entry', 'error');
  }
};

// Link Modal
window.openLinkModal = function(link = null) {
  const modal = document.getElementById('linkModal');
  const title = document.getElementById('linkModalTitle');
  const form = document.getElementById('linkForm');

  form.reset();

  if (link) {
    title.textContent = 'Edit Context Link';
    document.getElementById('linkId').value = link.id;
    document.getElementById('linkUrl').value = link.url;
    document.getElementById('linkTitle').value = link.title;
    document.getElementById('linkDescription').value = link.description || '';
    document.getElementById('linkActive').checked = link.is_active;
  } else {
    title.textContent = 'Add Context Link';
    document.getElementById('linkId').value = '';
    document.getElementById('linkActive').checked = true;
  }

  modal.classList.remove('hidden');
};

window.closeLinkModal = function() {
  document.getElementById('linkModal').classList.add('hidden');
};

window.saveLink = async function() {
  const id = document.getElementById('linkId').value;
  const url = document.getElementById('linkUrl').value.trim();
  const title = document.getElementById('linkTitle').value.trim();
  const description = document.getElementById('linkDescription').value.trim();
  const is_active = document.getElementById('linkActive').checked;

  if (!url || !title) {
    showToast('Please fill in URL and title', 'error');
    return;
  }

  const data = { url, title, description: description || null, is_active };

  try {
    if (id) {
      const { error } = await supabase
        .from('faq_context_links')
        .update(data)
        .eq('id', id);

      if (error) throw error;
      showToast('Link updated', 'success');
    } else {
      const { error } = await supabase
        .from('faq_context_links')
        .insert(data);

      if (error) throw error;
      showToast('Link added', 'success');
    }

    closeLinkModal();
    await loadContextLinks();
    renderAll();
  } catch (error) {
    console.error('Error saving link:', error);
    showToast('Failed to save link', 'error');
  }
};

window.deleteLink = async function(id) {
  if (!confirm('Delete this context link?')) return;

  try {
    const { error } = await supabase
      .from('faq_context_links')
      .delete()
      .eq('id', id);

    if (error) throw error;
    showToast('Link deleted', 'success');
    await loadContextLinks();
    renderAll();
  } catch (error) {
    console.error('Error deleting link:', error);
    showToast('Failed to delete link', 'error');
  }
};

// Context Entry Modal
window.openContextEntryModal = function(entry = null) {
  const modal = document.getElementById('contextEntryModal');
  if (!modal) return;

  const title = document.getElementById('contextEntryModalTitle');
  const form = document.getElementById('contextEntryForm');

  form.reset();

  if (entry) {
    title.textContent = 'Edit Context Entry';
    document.getElementById('contextEntryId').value = entry.id;
    document.getElementById('contextEntryTitle').value = entry.title;
    document.getElementById('contextEntryContent').value = entry.content;
    document.getElementById('contextEntryOrder').value = entry.display_order || 0;
    document.getElementById('contextEntryActive').checked = entry.is_active !== false;
  } else {
    title.textContent = 'Add Context Entry';
    document.getElementById('contextEntryId').value = '';
    document.getElementById('contextEntryOrder').value = contextEntries.length + 1;
    document.getElementById('contextEntryActive').checked = true;
  }

  modal.classList.remove('hidden');
};

window.closeContextEntryModal = function() {
  document.getElementById('contextEntryModal').classList.add('hidden');
};

window.saveContextEntry = async function() {
  const id = document.getElementById('contextEntryId').value;
  const title = document.getElementById('contextEntryTitle').value.trim();
  const content = document.getElementById('contextEntryContent').value.trim();
  const display_order = parseInt(document.getElementById('contextEntryOrder').value) || 0;
  const is_active = document.getElementById('contextEntryActive').checked;

  if (!title || !content) {
    showToast('Please fill in both title and content', 'error');
    return;
  }

  const data = { title, content, display_order, is_active, updated_at: new Date().toISOString() };

  try {
    if (id) {
      const { error } = await supabase
        .from('faq_context_entries')
        .update(data)
        .eq('id', id);
      if (error) throw error;
      showToast('Context entry updated', 'success');
    } else {
      const { error } = await supabase
        .from('faq_context_entries')
        .insert(data);
      if (error) throw error;
      showToast('Context entry created', 'success');
    }

    closeContextEntryModal();
    await loadContextEntries();
    renderAll();
  } catch (error) {
    console.error('Error saving context entry:', error);
    showToast('Failed to save context entry', 'error');
  }
};

window.deleteContextEntry = async function(id) {
  if (!confirm('Delete this context entry? You\'ll need to recompile for changes to take effect.')) return;

  try {
    const { error } = await supabase
      .from('faq_context_entries')
      .delete()
      .eq('id', id);
    if (error) throw error;
    showToast('Context entry deleted', 'success');
    await loadContextEntries();
    renderAll();
  } catch (error) {
    console.error('Error deleting context entry:', error);
    showToast('Failed to delete context entry', 'error');
  }
};

// Context Compilation
async function recompileContext() {
  const modal = document.getElementById('recompileModal');
  const progressSpaces = document.getElementById('progressSpaces');
  const progressFaqs = document.getElementById('progressFaqs');
  const progressLinks = document.getElementById('progressLinks');
  const progressUpload = document.getElementById('progressUpload');
  const errorDiv = document.getElementById('recompileError');

  // Reset progress
  [progressSpaces, progressFaqs, progressLinks, progressUpload].forEach(el => {
    el.className = 'progress-item';
  });
  errorDiv.classList.add('hidden');
  modal.classList.remove('hidden');

  const context = {
    compiled_at: new Date().toISOString(),
    spaces: [],
    faq: [],
    external_content: []
  };

  try {
    // Step 1: Load spaces
    progressSpaces.classList.add('active');
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('name, description, type, monthly_rate')
      .eq('is_archived', false)
      .eq('is_listed', true);

    if (spacesError) throw new Error('Failed to load spaces: ' + spacesError.message);

    context.spaces = spaces.map(s => ({
      name: s.name,
      description: s.description,
      type: s.type,
      monthly_rate: s.monthly_rate
    }));
    progressSpaces.classList.remove('active');
    progressSpaces.classList.add('complete');

    // Step 2: Load FAQ entries (published Q&A pairs)
    progressFaqs.classList.add('active');
    const publishedFaqs = faqEntries.filter(e => e.answer && e.is_published);
    context.faq = publishedFaqs.map(f => ({
      question: f.question,
      answer: f.answer
    }));
    progressFaqs.classList.remove('active');
    progressFaqs.classList.add('complete');

    // Step 3: Load context entries from database + fetch external links
    progressLinks.classList.add('active');

    // Load context entries (key-value pairs from faq_context_entries table)
    const { data: contextEntries, error: entriesError } = await supabase
      .from('faq_context_entries')
      .select('title, content')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (entriesError) throw new Error('Failed to load context entries: ' + entriesError.message);

    context.external_content = (contextEntries || []).map(e => ({
      title: e.title,
      content: e.content
    }));

    // Also fetch external links
    const activeLinks = contextLinks.filter(l => l.is_active);

    for (const link of activeLinks) {
      try {
        const content = await fetchLinkContent(link.url);
        if (content) {
          context.external_content.push({
            title: link.title,
            content: content
          });

          await supabase
            .from('faq_context_links')
            .update({ last_fetched_at: new Date().toISOString() })
            .eq('id', link.id);
        }
      } catch (err) {
        console.warn(`Failed to fetch ${link.url}:`, err);
      }
    }
    progressLinks.classList.remove('active');
    progressLinks.classList.add('complete');

    // Step 4: Upload to storage
    progressUpload.classList.add('active');
    const contextJson = JSON.stringify(context, null, 2);
    const blob = new Blob([contextJson], { type: 'application/json' });

    const { error: uploadError } = await supabase.storage
      .from('site-content')
      .upload('context.json', blob, {
        upsert: true,
        contentType: 'application/json'
      });

    if (uploadError) throw new Error('Failed to upload context: ' + uploadError.message);

    // Update meta
    const { error: metaError } = await supabase
      .from('faq_context_meta')
      .upsert({
        id: 1,
        last_compiled_at: new Date().toISOString(),
        compiled_by: getAuthState()?.user?.email,
        entry_count: context.spaces.length,
        link_count: context.external_content.length
      });

    if (metaError) throw new Error('Failed to update meta: ' + metaError.message);

    progressUpload.classList.remove('active');
    progressUpload.classList.add('complete');

    showToast('Context compiled successfully!', 'success');

    // Close modal after brief delay
    setTimeout(() => {
      modal.classList.add('hidden');
      loadContextMeta().then(renderContextMeta);
    }, 1000);

  } catch (error) {
    console.error('Recompile error:', error);
    errorDiv.textContent = error.message;
    errorDiv.classList.remove('hidden');

    // Mark current step as error
    [progressSpaces, progressFaqs, progressLinks, progressUpload].forEach(el => {
      if (el.classList.contains('active')) {
        el.classList.remove('active');
        el.classList.add('error');
      }
    });
  }
}

async function fetchLinkContent(url) {
  // Handle Google Docs
  if (url.includes('docs.google.com/document')) {
    const docId = extractGoogleDocId(url);
    if (docId) {
      const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      try {
        const response = await fetch(exportUrl);
        if (response.ok) {
          return await response.text();
        }
      } catch (e) {
        console.warn('Failed to fetch Google Doc:', e);
      }
    }
  }

  // For other URLs, try fetching directly (may fail due to CORS)
  // In production, this should go through a server-side proxy
  try {
    const response = await fetch(url);
    if (response.ok) {
      const text = await response.text();
      // Strip HTML if it looks like HTML
      if (text.trim().startsWith('<')) {
        return stripHtml(text);
      }
      return text;
    }
  } catch (e) {
    console.warn('Failed to fetch URL (CORS?):', url, e);
  }

  return null;
}

function extractGoogleDocId(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

// Utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatSource(source) {
  const labels = {
    'user_feedback': 'User Feedback',
    'low_confidence': 'Low Confidence',
    'manual': 'Manual'
  };
  return labels[source] || source;
}

function getLinkIcon(url) {
  if (url.includes('docs.google.com')) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/><path d="M8 12h8v2H8zm0 4h8v2H8z"/></svg>';
  }
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
}

function truncateUrl(url) {
  if (url.length <= 60) return url;
  return url.substring(0, 57) + '...';
}

function showToast(message, type = 'info', duration = 4000) {
  const icons = {
    success: '&#10003;',
    error: '&#10007;',
    warning: '&#9888;',
    info: '&#8505;'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
}
