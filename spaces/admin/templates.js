/**
 * Templates - Lease and Event Agreement Template Management
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { leaseTemplateService } from '../../shared/lease-template-service.js';
import { eventTemplateService } from '../../shared/event-template-service.js';
import { worktradeTemplateService } from '../../shared/worktrade-template-service.js';
import { emailTemplateService, renderTemplate } from '../../shared/email-template-service.js';
import { formatDateAustin } from '../../shared/timezone.js';

// =============================================
// STATE
// =============================================

let authState = null;

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize auth and admin page
  authState = await initAdminPage({
    activeTab: 'templates',
    requiredRole: 'admin', // Templates require admin access
    section: 'admin',
    onReady: async (state) => {
      // Load templates panel
      await loadTemplatesPanel();

      // Set up event listeners
      setupEventListeners();
    }
  });
});

// =============================================
// DATA LOADING
// =============================================

async function loadTemplatesPanel() {
  // Load lease placeholder reference
  const placeholders = leaseTemplateService.getAvailablePlaceholders();
  const placeholderList = document.getElementById('placeholderList');
  if (placeholderList) {
    placeholderList.innerHTML = Object.entries(placeholders)
      .map(([key, desc]) => `
        <div class="placeholder-item">
          <code>{{${key}}}</code>
          <span class="placeholder-desc">${desc}</span>
        </div>
      `).join('');
  }

  // Load active lease template
  try {
    const template = await leaseTemplateService.getActiveTemplate();
    if (template) {
      document.getElementById('templateName').value = template.name;
      document.getElementById('templateContent').value = template.content;
    } else {
      // Load default template
      document.getElementById('templateContent').value = leaseTemplateService.getDefaultTemplate();
    }
  } catch (e) {
    console.error('Error loading lease template:', e);
  }

  // Load template history
  await loadTemplateHistory();

  // Load SignWell config
  await loadSignwellConfig();

  // Load event placeholder reference
  const eventPlaceholders = eventTemplateService.getAvailablePlaceholders();
  const eventPlaceholderList = document.getElementById('eventPlaceholderList');
  if (eventPlaceholderList) {
    eventPlaceholderList.innerHTML = Object.entries(eventPlaceholders)
      .map(([key, desc]) => `
        <div class="placeholder-item">
          <code>{{${key}}}</code>
          <span class="placeholder-desc">${desc}</span>
        </div>
      `).join('');
  }

  // Load active event template
  try {
    const eventTemplate = await eventTemplateService.getActiveTemplate();
    if (eventTemplate) {
      document.getElementById('eventTemplateName').value = eventTemplate.name;
      document.getElementById('eventTemplateContent').value = eventTemplate.content;
    } else {
      // Load default template
      document.getElementById('eventTemplateContent').value = eventTemplateService.getDefaultTemplate();
    }
  } catch (e) {
    console.error('Error loading event template:', e);
  }

  // Load event template history
  await loadEventTemplateHistory();

  // Load worktrade placeholder reference
  const worktradePlaceholders = worktradeTemplateService.getAvailablePlaceholders();
  const worktradePlaceholderList = document.getElementById('worktradePlaceholderList');
  if (worktradePlaceholderList) {
    worktradePlaceholderList.innerHTML = Object.entries(worktradePlaceholders)
      .map(([key, desc]) => `
        <div class="placeholder-item">
          <code>{{${key}}}</code>
          <span class="placeholder-desc">${desc}</span>
        </div>
      `).join('');
  }

  // Load active worktrade template
  try {
    const worktradeTemplate = await worktradeTemplateService.getActiveTemplate();
    if (worktradeTemplate) {
      document.getElementById('worktradeTemplateName').value = worktradeTemplate.name;
      document.getElementById('worktradeTemplateContent').value = worktradeTemplate.content;
    } else {
      // Load default template
      document.getElementById('worktradeTemplateContent').value = worktradeTemplateService.getDefaultTemplate();
    }
  } catch (e) {
    console.error('Error loading worktrade template:', e);
  }

  // Load worktrade template history
  await loadWorktradeTemplateHistory();
}

async function loadTemplateHistory() {
  try {
    const templates = await leaseTemplateService.getAllTemplates();
    const tbody = document.getElementById('templateHistoryBody');
    if (!tbody) return;

    if (templates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No templates saved yet</td></tr>';
      return;
    }

    tbody.innerHTML = templates.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>v${t.version}</td>
        <td>${formatDateAustin(t.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td>${t.is_active ? '<span class="status-badge active">Active</span>' : ''}</td>
        <td>
          <button class="btn-small" data-action="load-template" data-id="${t.id}">Load</button>
          ${!t.is_active ? `<button class="btn-small" data-action="set-active-template" data-id="${t.id}">Set Active</button>` : ''}
        </td>
      </tr>
    `).join('');

    // Add click handlers
    tbody.querySelectorAll('[data-action="load-template"]').forEach(btn => {
      btn.addEventListener('click', () => loadTemplate(btn.dataset.id));
    });
    tbody.querySelectorAll('[data-action="set-active-template"]').forEach(btn => {
      btn.addEventListener('click', () => setActiveTemplate(btn.dataset.id));
    });
  } catch (e) {
    console.error('Error loading template history:', e);
  }
}

async function loadTemplate(templateId) {
  try {
    const { data, error } = await supabase
      .from('lease_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (error) throw error;

    document.getElementById('templateName').value = data.name;
    document.getElementById('templateContent').value = data.content;
    showToast('Template loaded', 'success');
  } catch (e) {
    showToast('Error loading template: ' + e.message, 'error');
  }
}

async function setActiveTemplate(templateId) {
  try {
    await leaseTemplateService.setActiveTemplate(templateId);
    await loadTemplateHistory();
    showToast('Template set as active', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function saveTemplate() {
  const name = document.getElementById('templateName').value.trim();
  const content = document.getElementById('templateContent').value;
  const makeActive = document.getElementById('templateMakeActive').checked;

  if (!name) {
    showToast('Please enter a template name', 'warning');
    return;
  }

  if (!content.trim()) {
    showToast('Template content cannot be empty', 'warning');
    return;
  }

  // Validate template
  const validation = leaseTemplateService.validateTemplate(content);
  const validationDiv = document.getElementById('templateValidation');

  if (!validation.isValid) {
    validationDiv.innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong>
        <ul>${validation.errors.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
    return;
  }

  if (validation.warnings.length > 0) {
    validationDiv.innerHTML = `
      <div class="validation-warning">
        <strong>Warnings:</strong>
        <ul>${validation.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
  } else {
    validationDiv.style.display = 'none';
  }

  try {
    await leaseTemplateService.saveTemplate(content, name, makeActive);
    await loadTemplateHistory();
    showToast('Template saved successfully!', 'success');
  } catch (e) {
    showToast('Error saving template: ' + e.message, 'error');
  }
}

function loadDefaultTemplate() {
  document.getElementById('templateContent').value = leaseTemplateService.getDefaultTemplate();
  document.getElementById('templateName').value = 'Standard Lease Agreement';
  showToast('Default template loaded', 'info');
}

// =============================================
// EVENT TEMPLATE FUNCTIONS
// =============================================

async function loadEventTemplateHistory() {
  try {
    const templates = await eventTemplateService.getAllTemplates();
    const tbody = document.getElementById('eventTemplateHistoryBody');
    if (!tbody) return;

    if (templates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No templates saved yet</td></tr>';
      return;
    }

    tbody.innerHTML = templates.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>v${t.version}</td>
        <td>${formatDateAustin(t.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td>${t.is_active ? '<span class="status-badge active">Active</span>' : ''}</td>
        <td>
          <button class="btn-small" data-action="load-event-template" data-id="${t.id}">Load</button>
          ${!t.is_active ? `<button class="btn-small" data-action="set-active-event-template" data-id="${t.id}">Set Active</button>` : ''}
        </td>
      </tr>
    `).join('');

    // Add click handlers
    tbody.querySelectorAll('[data-action="load-event-template"]').forEach(btn => {
      btn.addEventListener('click', () => loadEventTemplate(btn.dataset.id));
    });
    tbody.querySelectorAll('[data-action="set-active-event-template"]').forEach(btn => {
      btn.addEventListener('click', () => setActiveEventTemplate(btn.dataset.id));
    });
  } catch (e) {
    console.error('Error loading event template history:', e);
  }
}

async function loadEventTemplate(templateId) {
  try {
    const { data, error } = await supabase
      .from('event_agreement_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (error) throw error;

    document.getElementById('eventTemplateName').value = data.name;
    document.getElementById('eventTemplateContent').value = data.content;
    showToast('Event template loaded', 'success');
  } catch (e) {
    showToast('Error loading event template: ' + e.message, 'error');
  }
}

async function setActiveEventTemplate(templateId) {
  try {
    await eventTemplateService.setActiveTemplate(templateId);
    await loadEventTemplateHistory();
    showToast('Event template set as active', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function saveEventTemplate() {
  const name = document.getElementById('eventTemplateName').value.trim();
  const content = document.getElementById('eventTemplateContent').value;
  const makeActive = document.getElementById('eventTemplateMakeActive').checked;

  if (!name) {
    showToast('Please enter a template name', 'warning');
    return;
  }

  if (!content.trim()) {
    showToast('Template content cannot be empty', 'warning');
    return;
  }

  // Validate template
  const validation = eventTemplateService.validateTemplate(content);
  const validationDiv = document.getElementById('eventTemplateValidation');

  if (!validation.isValid) {
    validationDiv.innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong>
        <ul>${validation.errors.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
    return;
  }

  if (validation.warnings.length > 0) {
    validationDiv.innerHTML = `
      <div class="validation-warning">
        <strong>Warnings:</strong>
        <ul>${validation.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
  } else {
    validationDiv.style.display = 'none';
  }

  try {
    await eventTemplateService.saveTemplate(content, name, makeActive);
    await loadEventTemplateHistory();
    showToast('Event template saved successfully!', 'success');
  } catch (e) {
    showToast('Error saving event template: ' + e.message, 'error');
  }
}

function loadDefaultEventTemplate() {
  document.getElementById('eventTemplateContent').value = eventTemplateService.getDefaultTemplate();
  document.getElementById('eventTemplateName').value = 'Standard Event Agreement';
  showToast('Default event template loaded', 'info');
}

// =============================================
// WORKTRADE TEMPLATE FUNCTIONS
// =============================================

async function loadWorktradeTemplateHistory() {
  try {
    const templates = await worktradeTemplateService.getAllTemplates();
    const tbody = document.getElementById('worktradeTemplateHistoryBody');
    if (!tbody) return;

    if (templates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No templates saved yet</td></tr>';
      return;
    }

    tbody.innerHTML = templates.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>v${t.version}</td>
        <td>${formatDateAustin(t.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td>${t.is_active ? '<span class="status-badge active">Active</span>' : ''}</td>
        <td>
          <button class="btn-small" data-action="load-worktrade-template" data-id="${t.id}">Load</button>
          ${!t.is_active ? `<button class="btn-small" data-action="set-active-worktrade-template" data-id="${t.id}">Set Active</button>` : ''}
        </td>
      </tr>
    `).join('');

    // Add click handlers
    tbody.querySelectorAll('[data-action="load-worktrade-template"]').forEach(btn => {
      btn.addEventListener('click', () => loadWorktradeTemplate(btn.dataset.id));
    });
    tbody.querySelectorAll('[data-action="set-active-worktrade-template"]').forEach(btn => {
      btn.addEventListener('click', () => setActiveWorktradeTemplate(btn.dataset.id));
    });
  } catch (e) {
    console.error('Error loading worktrade template history:', e);
  }
}

async function loadWorktradeTemplate(templateId) {
  try {
    const { data, error } = await supabase
      .from('worktrade_agreement_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (error) throw error;

    document.getElementById('worktradeTemplateName').value = data.name;
    document.getElementById('worktradeTemplateContent').value = data.content;
    showToast('Work trade template loaded', 'success');
  } catch (e) {
    showToast('Error loading work trade template: ' + e.message, 'error');
  }
}

async function setActiveWorktradeTemplate(templateId) {
  try {
    await worktradeTemplateService.setActiveTemplate(templateId);
    await loadWorktradeTemplateHistory();
    showToast('Work trade template set as active', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function saveWorktradeTemplate() {
  const name = document.getElementById('worktradeTemplateName').value.trim();
  const content = document.getElementById('worktradeTemplateContent').value;
  const makeActive = document.getElementById('worktradeMakeActive').checked;

  if (!name) {
    showToast('Please enter a template name', 'warning');
    return;
  }

  if (!content.trim()) {
    showToast('Template content cannot be empty', 'warning');
    return;
  }

  // Validate template
  const validation = worktradeTemplateService.validateTemplate(content);
  const validationDiv = document.getElementById('worktradeTemplateValidation');

  if (!validation.isValid) {
    validationDiv.innerHTML = `
      <div class="validation-error">
        <strong>Validation Errors:</strong>
        <ul>${validation.errors.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
    return;
  }

  if (validation.warnings.length > 0) {
    validationDiv.innerHTML = `
      <div class="validation-warning">
        <strong>Warnings:</strong>
        <ul>${validation.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
  } else {
    validationDiv.style.display = 'none';
  }

  try {
    await worktradeTemplateService.saveTemplate(content, name, makeActive);
    await loadWorktradeTemplateHistory();
    showToast('Work trade template saved successfully!', 'success');
  } catch (e) {
    showToast('Error saving work trade template: ' + e.message, 'error');
  }
}

function loadDefaultWorktradeTemplate() {
  document.getElementById('worktradeTemplateContent').value = worktradeTemplateService.getDefaultTemplate();
  document.getElementById('worktradeTemplateName').value = 'Standard Work Trade Agreement';
  showToast('Default work trade template loaded', 'info');
}

// =============================================
// SIGNWELL CONFIG
// =============================================

async function loadSignwellConfig() {
  try {
    const { data, error } = await supabase
      .from('signwell_config')
      .select('*')
      .single();

    if (data) {
      document.getElementById('signwellApiKey').value = data.api_key || '';
      document.getElementById('signwellTestMode').checked = data.test_mode !== false;
    }
  } catch (e) {
    console.error('Error loading SignWell config:', e);
  }
}

async function saveSignwellConfig() {
  const apiKey = document.getElementById('signwellApiKey').value.trim();
  const testMode = document.getElementById('signwellTestMode').checked;

  try {
    const { error } = await supabase
      .from('signwell_config')
      .upsert({
        id: 1,
        api_key: apiKey || null,
        test_mode: testMode,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    showToast('SignWell configuration saved', 'success');
  } catch (e) {
    showToast('Error saving config: ' + e.message, 'error');
  }
}

// =============================================
// EVENT LISTENERS
// =============================================

function setupEventListeners() {
  // Template type selector
  document.getElementById('templateTypeSelector')?.addEventListener('change', (e) => {
    const type = e.target.value;
    document.getElementById('leaseTemplateSection').style.display = type === 'lease' ? 'block' : 'none';
    document.getElementById('eventTemplateSection').style.display = type === 'event' ? 'block' : 'none';
    document.getElementById('worktradeTemplateSection').style.display = type === 'worktrade' ? 'block' : 'none';
    document.getElementById('emailTemplateSection').style.display = type === 'email' ? 'block' : 'none';
    if (type === 'email') loadEmailTemplates();
  });

  // Lease template buttons
  document.getElementById('loadDefaultTemplateBtn')?.addEventListener('click', loadDefaultTemplate);
  document.getElementById('saveTemplateBtn')?.addEventListener('click', saveTemplate);
  document.getElementById('saveSignwellConfigBtn')?.addEventListener('click', saveSignwellConfig);

  // Event template buttons
  document.getElementById('loadDefaultEventTemplateBtn')?.addEventListener('click', loadDefaultEventTemplate);
  document.getElementById('saveEventTemplateBtn')?.addEventListener('click', saveEventTemplate);

  // Work trade template buttons
  document.getElementById('loadDefaultWorktradeTemplateBtn')?.addEventListener('click', loadDefaultWorktradeTemplate);
  document.getElementById('saveWorktradeTemplateBtn')?.addEventListener('click', saveWorktradeTemplate);

  // Email template buttons
  document.getElementById('emailBackToListBtn')?.addEventListener('click', emailBackToList);
  document.getElementById('emailPreviewBtn')?.addEventListener('click', emailPreviewTemplate);
  document.getElementById('emailSaveBtn')?.addEventListener('click', emailSaveTemplate);
  document.getElementById('emailPreviewCloseBtn')?.addEventListener('click', () => {
    document.getElementById('emailPreviewModal').style.display = 'none';
  });
}

// =============================================
// EMAIL TEMPLATE FUNCTIONS
// =============================================

let emailTemplateList = [];
let currentEmailTemplateKey = null;
let emailCategoryFilterValue = null;

const SENDER_LABELS = {
  team: 'Team',
  auto: 'Automaton',
  noreply: 'No-Reply',
  payments: 'Payments',
};

async function loadEmailTemplates() {
  try {
    emailTemplateList = await emailTemplateService.getAllTemplates(emailCategoryFilterValue);
    renderEmailCategoryFilter();
    renderEmailTemplateList();
  } catch (e) {
    console.error('Error loading email templates:', e);
    showToast('Error loading email templates', 'error');
  }
}

function renderEmailCategoryFilter() {
  const container = document.getElementById('emailCategoryFilter');
  if (!container) return;

  const categories = emailTemplateService.getCategories();
  const allActive = !emailCategoryFilterValue ? 'btn-primary' : '';

  container.innerHTML = `
    <button class="btn-small ${allActive}" data-cat="">All</button>
    ${categories.map(c => {
      const active = emailCategoryFilterValue === c.key ? 'btn-primary' : '';
      return `<button class="btn-small ${active}" data-cat="${c.key}">${c.label}</button>`;
    }).join('')}
  `;

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      emailCategoryFilterValue = btn.dataset.cat || null;
      loadEmailTemplates();
    });
  });
}

function renderEmailTemplateList() {
  const tbody = document.getElementById('emailTemplateListBody');
  if (!tbody) return;

  if (emailTemplateList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No templates found</td></tr>';
    return;
  }

  const categories = emailTemplateService.getCategories();
  const catMap = Object.fromEntries(categories.map(c => [c.key, c]));

  tbody.innerHTML = emailTemplateList.map(t => {
    const cat = catMap[t.category] || { label: t.category, color: '#666' };
    const sender = SENDER_LABELS[t.sender_type] || t.sender_type;
    const keyLabel = t.template_key.replace(/_/g, ' ');
    return `
      <tr>
        <td>
          <strong style="text-transform:capitalize;">${keyLabel}</strong>
          ${t.description ? `<br><span class="text-muted" style="font-size:0.85em;">${t.description}</span>` : ''}
        </td>
        <td><span class="status-badge" style="background:${cat.color};color:#fff;font-size:0.75em;">${cat.label}</span></td>
        <td style="font-size:0.85em;">${sender}</td>
        <td>v${t.version}</td>
        <td>
          <button class="btn-small" data-action="edit-email-template" data-key="${t.template_key}">Edit</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action="edit-email-template"]').forEach(btn => {
    btn.addEventListener('click', () => editEmailTemplate(btn.dataset.key));
  });
}

async function editEmailTemplate(templateKey) {
  try {
    const template = await emailTemplateService.getActiveTemplate(templateKey);
    if (!template) {
      showToast('Template not found', 'error');
      return;
    }

    currentEmailTemplateKey = templateKey;

    // Populate editor
    const keyLabel = templateKey.replace(/_/g, ' ');
    document.getElementById('emailEditorTitle').textContent = `Edit: ${keyLabel}`;
    document.getElementById('emailDescription').value = template.description || '';
    document.getElementById('emailSubject').value = template.subject_template || '';
    document.getElementById('emailHtmlBody').value = template.html_template || '';
    document.getElementById('emailTextBody').value = template.text_template || '';

    // Populate placeholder reference
    const placeholderList = document.getElementById('emailPlaceholderList');
    const placeholders = template.placeholders || [];
    if (placeholders.length > 0) {
      placeholderList.innerHTML = placeholders.map(p => `
        <div class="placeholder-item">
          <code>{{${p.key}}}</code>
          <span class="placeholder-desc">${p.description || ''}${p.required ? '' : ' <em>(optional)</em>'}</span>
        </div>
      `).join('');
    } else {
      placeholderList.innerHTML = '<p class="text-muted">No placeholders defined</p>';
    }

    // Load version history
    await loadEmailVersionHistory(templateKey);

    // Show editor, hide list
    document.getElementById('emailListView').style.display = 'none';
    document.getElementById('emailEditorView').style.display = 'block';
    document.getElementById('emailTemplateValidation').style.display = 'none';
  } catch (e) {
    console.error('Error loading email template:', e);
    showToast('Error loading template', 'error');
  }
}

async function loadEmailVersionHistory(templateKey) {
  try {
    const versions = await emailTemplateService.getTemplateVersions(templateKey);
    const tbody = document.getElementById('emailVersionHistoryBody');
    if (!tbody) return;

    if (versions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No versions yet</td></tr>';
      return;
    }

    tbody.innerHTML = versions.map(v => `
      <tr>
        <td>v${v.version}</td>
        <td>${formatDateAustin(v.updated_at || v.created_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
        <td>${v.is_active ? '<span class="status-badge active">Active</span>' : ''}</td>
        <td>
          <button class="btn-small" data-action="load-email-version" data-id="${v.id}">Load</button>
          ${!v.is_active ? `<button class="btn-small" data-action="set-active-email-version" data-id="${v.id}" data-key="${v.template_key}">Set Active</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="load-email-version"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { data } = await supabase.from('email_templates').select('*').eq('id', btn.dataset.id).single();
        if (data) {
          document.getElementById('emailSubject').value = data.subject_template || '';
          document.getElementById('emailHtmlBody').value = data.html_template || '';
          document.getElementById('emailTextBody').value = data.text_template || '';
          document.getElementById('emailDescription').value = data.description || '';
          showToast('Version loaded', 'success');
        }
      });
    });

    tbody.querySelectorAll('[data-action="set-active-email-version"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await emailTemplateService.setActiveVersion(btn.dataset.id, btn.dataset.key);
          await loadEmailVersionHistory(btn.dataset.key);
          showToast('Version set as active', 'success');
        } catch (e) {
          showToast('Error: ' + e.message, 'error');
        }
      });
    });
  } catch (e) {
    console.error('Error loading email version history:', e);
  }
}

function emailBackToList() {
  currentEmailTemplateKey = null;
  document.getElementById('emailEditorView').style.display = 'none';
  document.getElementById('emailListView').style.display = 'block';
  loadEmailTemplates();
}

async function emailSaveTemplate() {
  if (!currentEmailTemplateKey) return;

  const subject = document.getElementById('emailSubject').value.trim();
  const html = document.getElementById('emailHtmlBody').value;
  const text = document.getElementById('emailTextBody').value;
  const description = document.getElementById('emailDescription').value.trim();

  if (!subject) {
    showToast('Subject line cannot be empty', 'warning');
    return;
  }
  if (!html.trim()) {
    showToast('HTML body cannot be empty', 'warning');
    return;
  }

  // Get current template for category/sender/placeholders
  const current = await emailTemplateService.getActiveTemplate(currentEmailTemplateKey);
  if (!current) {
    showToast('Could not find current template', 'error');
    return;
  }

  // Validate
  const allContent = subject + ' ' + html + ' ' + text;
  const validation = emailTemplateService.validateTemplate(allContent, current.placeholders);
  const validationDiv = document.getElementById('emailTemplateValidation');

  if (validation.warnings.length > 0) {
    validationDiv.innerHTML = `
      <div class="validation-warning">
        <strong>Warnings:</strong>
        <ul>${validation.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
      </div>
    `;
    validationDiv.style.display = 'block';
  } else {
    validationDiv.style.display = 'none';
  }

  try {
    await emailTemplateService.saveTemplate(currentEmailTemplateKey, {
      category: current.category,
      description: description || current.description,
      sender_type: current.sender_type,
      subject_template: subject,
      html_template: html,
      text_template: text,
      placeholders: current.placeholders,
    }, true);

    await loadEmailVersionHistory(currentEmailTemplateKey);
    showToast('Email template saved!', 'success');
  } catch (e) {
    showToast('Error saving: ' + e.message, 'error');
  }
}

function emailPreviewTemplate() {
  const subject = document.getElementById('emailSubject').value;
  const html = document.getElementById('emailHtmlBody').value;

  // Get current template for sample data
  const current = emailTemplateList.find(t => t.template_key === currentEmailTemplateKey);
  const placeholders = current?.placeholders || [];
  const sampleData = {};
  for (const p of placeholders) {
    sampleData[p.key] = p.sample_value || `[${p.key}]`;
  }

  const renderedSubject = renderTemplate(subject, sampleData);
  const renderedHtml = renderTemplate(html, sampleData);

  document.getElementById('emailPreviewSubject').textContent = renderedSubject;
  const iframe = document.getElementById('emailPreviewFrame');
  iframe.srcdoc = renderedHtml;

  document.getElementById('emailPreviewModal').style.display = 'flex';
}
