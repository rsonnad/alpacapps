// FAQ Management Page
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { askQuestion } from '../../shared/chat-widget.js';

// State
let faqEntries = [];
let contextLinks = [];
let contextMeta = null;
let contextEntries = [];
let voiceAssistant = null;
let voiceCallStats = null;

// Check if running in embed mode (inside iframe)
const isEmbed = new URLSearchParams(window.location.search).has('embed');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'faq',
    onReady: async (state) => {
      // Hide header and tabs in embed mode
      if (isEmbed) {
        const header = document.querySelector('header');
        if (header) header.style.display = 'none';
        const tabs = document.querySelector('.manage-tabs');
        if (tabs) tabs.style.display = 'none';
      }

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
    }
  });
});

async function loadData() {
  await Promise.all([
    loadFaqEntries(),
    loadContextLinks(),
    loadContextMeta(),
    loadContextEntries(),
    loadVoiceAssistant()
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

  // Test AI Assistant
  const testAskBtn = document.getElementById('testAskBtn');
  const testQuestionInput = document.getElementById('testQuestionInput');
  if (testAskBtn && testQuestionInput) {
    testAskBtn.addEventListener('click', handleTestQuestion);
    testQuestionInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleTestQuestion();
    });
  }
}

async function handleTestQuestion() {
  const input = document.getElementById('testQuestionInput');
  const btn = document.getElementById('testAskBtn');
  const answerContainer = document.getElementById('testAnswerContainer');
  const answerText = document.getElementById('testAnswerText');
  const lowConfidence = document.getElementById('testLowConfidenceNotice');
  const confidenceMeta = document.getElementById('testConfidenceMeta');
  const confidenceLabel = document.getElementById('testConfidenceLabel');

  const question = input.value.trim();
  if (!question) return;

  // Show loading state
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span>Thinking...';

  // Reset answer UI
  answerContainer.classList.remove('visible');
  lowConfidence.classList.remove('visible');
  confidenceMeta.classList.remove('visible');

  try {
    const result = await askQuestion(question);

    answerText.textContent = result.answer;
    answerContainer.classList.add('visible');

    // Show confidence indicator
    confidenceMeta.classList.add('visible');
    if (result.confident) {
      confidenceLabel.innerHTML = '<span class="confidence-badge confidence-badge--high">HIGH CONFIDENCE</span>';
    } else {
      confidenceLabel.innerHTML = '<span class="confidence-badge confidence-badge--low">LOW CONFIDENCE</span>';
      lowConfidence.classList.add('visible');
    }

    // Refresh question log since the edge function logs the question
    await loadFaqEntries();
    renderQuestionLog();
    renderPendingQuestions();
    const countBadge = document.getElementById('questionLogCount');
    if (countBadge) countBadge.textContent = faqEntries.filter(e => e.source === 'auto').length;
  } catch (error) {
    answerText.textContent = 'Error: ' + (error.message || 'Failed to get a response. Check console for details.');
    answerContainer.classList.add('visible');
    confidenceMeta.classList.add('visible');
    confidenceLabel.innerHTML = '<span class="confidence-badge confidence-badge--low">ERROR</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask';
  }
}

function renderAll() {
  renderContextMeta();
  renderQuestionLog();
  renderPendingQuestions();
  renderFaqEntries();
  renderContextEntries();
  renderContextLinks();
  renderVoiceConfig();
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
              <button class="btn-secondary btn-small" onclick="editAutoEntry('${entry.id}')">Edit</button>
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

window.editAutoEntry = function(id) {
  const entry = faqEntries.find(e => e.id === id);
  if (!entry) return;
  // Open modal pre-filled with the AI answer so admin can correct it
  openFaqModal({
    ...entry,
    answer: entry.answer || entry.ai_answer || ''
  });
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

// =============================================
// VOICE ASSISTANT CONFIG
// =============================================

async function loadVoiceAssistant() {
  try {
    // Load default voice assistant
    const { data: assistant, error } = await supabase
      .from('voice_assistants')
      .select('*')
      .eq('is_active', true)
      .eq('is_default', true)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error loading voice assistant:', error);
      return;
    }
    voiceAssistant = assistant;

    // Load call stats
    const { data: calls, error: callsError } = await supabase
      .from('voice_calls')
      .select('duration_seconds, cost_cents, created_at, status')
      .order('created_at', { ascending: false });

    if (!callsError && calls) {
      const ended = calls.filter(c => c.status === 'ended');
      voiceCallStats = {
        totalCalls: ended.length,
        totalMinutes: Math.round(ended.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / 60 * 10) / 10,
        totalCost: ended.reduce((sum, c) => sum + (parseFloat(c.cost_cents) || 0), 0) / 100,
        lastCall: calls.length > 0 ? calls[0].created_at : null
      };
    }
  } catch (err) {
    console.error('Failed to load voice assistant:', err);
  }
}

function renderVoiceConfig() {
  const container = document.getElementById('voiceConfigSection');
  if (!container) return;

  if (!voiceAssistant) {
    container.innerHTML = '<div class="empty-state">No voice assistant configured</div>';
    return;
  }

  const a = voiceAssistant;
  const stats = voiceCallStats || { totalCalls: 0, totalMinutes: 0, totalCost: 0, lastCall: null };
  const maxDurationMin = Math.round((a.max_duration_seconds || 600) / 60);

  container.innerHTML = `
    <div class="voice-config-display">
      <div class="voice-config-grid">
        <div class="voice-config-item">
          <span class="voice-config-label">Name</span>
          <span class="voice-config-value">${escapeHtml(a.name)}${a.is_default ? ' <span class="published-badge">Default</span>' : ''}${a.is_active ? '' : ' <span style="color:#999;">Inactive</span>'}</span>
        </div>
        <div class="voice-config-item">
          <span class="voice-config-label">Model</span>
          <span class="voice-config-value">${escapeHtml((a.model_provider || 'google').charAt(0).toUpperCase() + (a.model_provider || 'google').slice(1))} · ${escapeHtml(a.model_name || 'unknown')}</span>
        </div>
        <div class="voice-config-item">
          <span class="voice-config-label">Voice</span>
          <span class="voice-config-value">${escapeHtml((a.voice_provider || 'vapi').charAt(0).toUpperCase() + (a.voice_provider || 'vapi').slice(1))} · ${escapeHtml(a.voice_id || 'default')}</span>
        </div>
        <div class="voice-config-item">
          <span class="voice-config-label">Transcriber</span>
          <span class="voice-config-value">${escapeHtml((a.transcriber_provider || 'deepgram').charAt(0).toUpperCase() + (a.transcriber_provider || 'deepgram').slice(1))} · ${escapeHtml(a.transcriber_model || 'nova-2')} (${escapeHtml(a.transcriber_language || 'en')})</span>
        </div>
        <div class="voice-config-item">
          <span class="voice-config-label">Temperature</span>
          <span class="voice-config-value">${a.temperature || 0.7}</span>
        </div>
        <div class="voice-config-item">
          <span class="voice-config-label">Max Duration</span>
          <span class="voice-config-value">${maxDurationMin} min</span>
        </div>
      </div>

      <div class="voice-config-stats">
        <div class="stat">
          <span class="stat-value">${stats.totalCalls}</span>
          <span class="stat-label">Calls</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.totalMinutes}</span>
          <span class="stat-label">Minutes</span>
        </div>
        <div class="stat">
          <span class="stat-value">$${stats.totalCost.toFixed(2)}</span>
          <span class="stat-label">Cost</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.lastCall ? formatDate(stats.lastCall) : 'Never'}</span>
          <span class="stat-label">Last Call</span>
        </div>
      </div>

      <div class="voice-config-prompt-section">
        <div class="voice-config-label">First Message</div>
        <div class="voice-config-prompt-box">${escapeHtml(a.first_message || '(none)')}</div>
      </div>

      <div class="voice-config-prompt-section">
        <div class="voice-config-label">System Prompt</div>
        <div class="voice-config-prompt-box voice-config-prompt-box--long">${escapeHtml(a.system_prompt || '(none)')}</div>
      </div>

    </div>
  `;

  // Show edit button
  const editBtn = document.getElementById('editVoiceBtn');
  if (editBtn) editBtn.classList.remove('hidden');
}

// Voice Assistant Modal
function openVoiceModal() {
  if (!voiceAssistant) return;
  const a = voiceAssistant;

  document.getElementById('voiceAssistantId').value = a.id;
  document.getElementById('voiceName').value = a.name || '';
  document.getElementById('voiceModelProvider').value = a.model_provider || 'google';
  document.getElementById('voiceModelName').value = a.model_name || '';
  document.getElementById('voiceVoiceProvider').value = a.voice_provider || 'vapi';
  document.getElementById('voiceVoiceId').value = a.voice_id || '';
  document.getElementById('voiceTranscriberProvider').value = a.transcriber_provider || 'deepgram';
  document.getElementById('voiceTranscriberModel').value = a.transcriber_model || 'nova-2';
  document.getElementById('voiceTranscriberLanguage').value = a.transcriber_language || 'en';
  document.getElementById('voiceTemperature').value = a.temperature || 0.7;
  document.getElementById('voiceMaxDuration').value = Math.round((a.max_duration_seconds || 600) / 60);
  document.getElementById('voiceFirstMessage').value = a.first_message || '';
  document.getElementById('voiceSystemPrompt').value = a.system_prompt || '';

  document.getElementById('voiceModal').classList.remove('hidden');
}
window.openVoiceModal = openVoiceModal;

function closeVoiceModal() {
  document.getElementById('voiceModal').classList.add('hidden');
}
window.closeVoiceModal = closeVoiceModal;

async function saveVoiceAssistant() {
  const id = document.getElementById('voiceAssistantId').value;
  if (!id) return;

  const btn = document.getElementById('saveVoiceBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const updates = {
      name: document.getElementById('voiceName').value.trim(),
      model_provider: document.getElementById('voiceModelProvider').value.trim(),
      model_name: document.getElementById('voiceModelName').value.trim(),
      voice_provider: document.getElementById('voiceVoiceProvider').value.trim(),
      voice_id: document.getElementById('voiceVoiceId').value.trim(),
      transcriber_provider: document.getElementById('voiceTranscriberProvider').value.trim(),
      transcriber_model: document.getElementById('voiceTranscriberModel').value.trim(),
      transcriber_language: document.getElementById('voiceTranscriberLanguage').value.trim(),
      temperature: parseFloat(document.getElementById('voiceTemperature').value) || 0.7,
      max_duration_seconds: (parseInt(document.getElementById('voiceMaxDuration').value) || 10) * 60,
      first_message: document.getElementById('voiceFirstMessage').value.trim(),
      system_prompt: document.getElementById('voiceSystemPrompt').value.trim(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('voice_assistants')
      .update(updates)
      .eq('id', id);

    if (error) throw error;

    // Refresh data
    await loadVoiceAssistant();
    renderVoiceConfig();
    closeVoiceModal();
    showToast('Voice assistant updated', 'success');
  } catch (err) {
    console.error('Error saving voice assistant:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}
window.saveVoiceAssistant = saveVoiceAssistant;

// showToast is now imported from admin-shell.js
