/**
 * Templates - Lease and Event Agreement Template Management
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { leaseTemplateService } from '../../shared/lease-template-service.js';
import { eventTemplateService } from '../../shared/event-template-service.js';
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
  });

  // Lease template buttons
  document.getElementById('loadDefaultTemplateBtn')?.addEventListener('click', loadDefaultTemplate);
  document.getElementById('saveTemplateBtn')?.addEventListener('click', saveTemplate);
  document.getElementById('saveSignwellConfigBtn')?.addEventListener('click', saveSignwellConfig);

  // Event template buttons
  document.getElementById('loadDefaultEventTemplateBtn')?.addEventListener('click', loadDefaultEventTemplate);
  document.getElementById('saveEventTemplateBtn')?.addEventListener('click', saveEventTemplate);
}
