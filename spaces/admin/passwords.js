/**
 * Password Vault - Admin-only credential storage with copy-to-clipboard
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

// =============================================
// STATE
// =============================================

let authState = null;
let allEntries = [];
let activeCategory = 'all';
let searchQuery = '';
let editingEntryId = null;
let revealedPasswords = new Set();

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'access', label: 'Access' },
  { id: 'platform', label: 'Platform' },
  { id: 'social', label: 'Social' },
  { id: 'service', label: 'Service' },
  { id: 'email', label: 'Email' },
  { id: 'tools', label: 'Tools' },
];

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'passwords',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async (state) => {
      renderFilters();
      await loadEntries();
      setupEventListeners();
    }
  });
});

// =============================================
// DATA
// =============================================

async function loadEntries() {
  try {
    const { data, error } = await supabase
      .from('password_vault')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    allEntries = data || [];
    renderGrid();
  } catch (err) {
    console.error('Error loading vault:', err);
    showToast('Failed to load passwords', 'error');
  }
}

function getFilteredEntries() {
  let entries = allEntries;
  if (activeCategory !== 'all') {
    entries = entries.filter(e => e.category === activeCategory);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    entries = entries.filter(e =>
      e.service.toLowerCase().includes(q) ||
      (e.username && e.username.toLowerCase().includes(q)) ||
      (e.notes && e.notes.toLowerCase().includes(q))
    );
  }
  return entries;
}

// =============================================
// RENDERING
// =============================================

function renderFilters() {
  const container = document.getElementById('vaultFilters');
  container.innerHTML = CATEGORIES.map(cat =>
    `<button class="vault-chip ${cat.id === activeCategory ? 'active' : ''}" data-cat="${cat.id}">${cat.label}</button>`
  ).join('');
}

function renderGrid() {
  const entries = getFilteredEntries();
  const grid = document.getElementById('vaultGrid');
  const countEl = document.getElementById('vaultCount');

  countEl.textContent = `${entries.length} of ${allEntries.length}`;

  if (!entries.length) {
    grid.innerHTML = '<div class="vault-empty">No entries found.</div>';
    return;
  }

  grid.innerHTML = entries.map(e => {
    const isRevealed = revealedPasswords.has(e.id);
    // Fixed-length mask so password length is not leaked
    const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

    return `
      <div class="vault-card" data-id="${e.id}">
        <div class="vault-card-header">
          <span class="vault-card-service">${escapeHtml(e.service)}</span>
          <span class="vault-card-category" data-cat="${e.category}">${e.category}</span>
        </div>
        ${e.username ? `
        <div class="vault-field">
          <span class="vault-field-label">user</span>
          <span class="vault-field-value">${escapeHtml(e.username)}</span>
          <button class="vault-btn-icon" data-action="copy-field" data-id="${e.id}" data-field="username" title="Copy username">${COPY_SVG}</button>
        </div>` : ''}
        ${e.password ? `
        <div class="vault-field">
          <span class="vault-field-label">pass</span>
          <span class="vault-field-value ${isRevealed ? '' : 'masked'}" id="pw-${e.id}">${isRevealed ? escapeHtml(e.password) : MASK}</span>
          <button class="vault-btn-icon" data-action="toggle-pw" data-id="${e.id}" title="${isRevealed ? 'Hide' : 'Reveal'}">${isRevealed ? EYE_OFF_SVG : EYE_SVG}</button>
          <button class="vault-btn-icon" data-action="copy-field" data-id="${e.id}" data-field="password" title="Copy password">${COPY_SVG}</button>
        </div>` : ''}
        ${e.url ? `<div class="vault-card-url"><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener">${prettifyUrl(e.url)}</a></div>` : ''}
        ${e.notes ? `<div class="vault-card-notes">${escapeHtml(e.notes)}</div>` : ''}
        <div class="vault-card-actions">
          <button class="vault-btn-icon" data-action="edit" data-id="${e.id}" title="Edit">${EDIT_SVG}</button>
        </div>
      </div>`;
  }).join('');
}

// =============================================
// MODAL
// =============================================

function openModal(entryId = null) {
  editingEntryId = entryId;
  const modal = document.getElementById('entryModal');
  const title = document.getElementById('entryModalTitle');
  const deleteBtn = document.getElementById('deleteEntryBtn');
  const form = document.getElementById('entryForm');

  if (entryId) {
    title.textContent = 'Edit Entry';
    deleteBtn.style.display = 'block';
    const entry = allEntries.find(e => e.id === entryId);
    if (entry) {
      document.getElementById('entryId').value = entry.id;
      document.getElementById('entryService').value = entry.service;
      document.getElementById('entryCategory').value = entry.category;
      document.getElementById('entryUsername').value = entry.username || '';
      document.getElementById('entryPassword').value = entry.password || '';
      document.getElementById('entryUrl').value = entry.url || '';
      document.getElementById('entryNotes').value = entry.notes || '';
    }
  } else {
    title.textContent = 'Add Entry';
    deleteBtn.style.display = 'none';
    form.reset();
    document.getElementById('entryId').value = '';
    document.getElementById('entryCategory').value = 'service';
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('entryModal').classList.add('hidden');
  editingEntryId = null;
}

async function saveEntry() {
  const service = document.getElementById('entryService').value.trim();
  if (!service) {
    showToast('Service name is required', 'warning');
    return;
  }

  const data = {
    service,
    category: document.getElementById('entryCategory').value,
    username: document.getElementById('entryUsername').value.trim() || null,
    password: document.getElementById('entryPassword').value.trim() || null,
    url: document.getElementById('entryUrl').value.trim() || null,
    notes: document.getElementById('entryNotes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  try {
    if (editingEntryId) {
      const { error } = await supabase
        .from('password_vault')
        .update(data)
        .eq('id', editingEntryId);
      if (error) throw error;
      showToast('Entry updated', 'success');
    } else {
      data.display_order = allEntries.length;
      const { error } = await supabase
        .from('password_vault')
        .insert(data);
      if (error) throw error;
      showToast('Entry added', 'success');
    }
    closeModal();
    await loadEntries();
  } catch (err) {
    console.error('Error saving entry:', err);
    showToast('Failed to save entry', 'error');
  }
}

async function deleteEntry() {
  if (!editingEntryId) return;
  if (!confirm('Delete this credential entry?')) return;

  try {
    const { error } = await supabase
      .from('password_vault')
      .delete()
      .eq('id', editingEntryId);

    if (error) throw error;
    showToast('Entry deleted', 'success');
    closeModal();
    await loadEntries();
  } catch (err) {
    console.error('Error deleting entry:', err);
    showToast('Failed to delete entry', 'error');
  }
}

// =============================================
// CLIPBOARD
// =============================================

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success', 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied to clipboard', 'success', 2000);
  }
}

// =============================================
// EVENT LISTENERS
// =============================================

function setupEventListeners() {
  document.getElementById('vaultSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGrid();
  });

  document.getElementById('vaultFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('.vault-chip');
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    renderFilters();
    renderGrid();
  });

  document.getElementById('vaultGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    if (action === 'copy-field') {
      // Look up value from JS state, never from DOM
      const entry = allEntries.find(en => en.id === btn.dataset.id);
      if (entry) {
        const val = btn.dataset.field === 'password' ? entry.password : entry.username;
        if (val) copyToClipboard(val);
      }
    } else if (action === 'toggle-pw') {
      const id = btn.dataset.id;
      if (revealedPasswords.has(id)) {
        revealedPasswords.delete(id);
      } else {
        revealedPasswords.add(id);
      }
      renderGrid();
    } else if (action === 'edit') {
      openModal(btn.dataset.id);
    }
  });

  document.getElementById('addEntryBtn').addEventListener('click', () => openModal());
  document.getElementById('closeEntryModal').addEventListener('click', closeModal);
  document.getElementById('cancelEntryBtn').addEventListener('click', closeModal);
  document.getElementById('saveEntryBtn').addEventListener('click', saveEntry);
  document.getElementById('deleteEntryBtn').addEventListener('click', deleteEntry);

  document.getElementById('entryModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// =============================================
// HELPERS
// =============================================

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prettifyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}
