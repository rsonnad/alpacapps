/**
 * Vendor Directory - lightweight CRM for utilities, contractors, and suppliers.
 * One row per company; extends the `vendors` table the purchases flow reads.
 */

import { supabase } from '../shared/supabase.js';
import { initAdminPage, showToast } from '../shared/admin-shell.js';

// =============================================
// STATE
// =============================================

let authState = null;
let allVendors = [];
let activeType = 'all';
let searchQuery = '';
let editingVendorId = null;

const TYPE_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'utility',    label: 'Utility' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'service',    label: 'Service' },
  { id: 'supplier',   label: 'Supplier' },
  { id: 'government', label: 'Government' },
];

// Category is free text in the DB (the purchases flow wrote arbitrary values),
// but the form offers this list so new entries stay consistent.
const CATEGORIES = [
  'waste', 'water', 'wastewater', 'electric', 'gas', 'internet', 'plumbing',
  'electrical', 'hvac', 'landscaping', 'pest_control', 'roofing', 'appliance',
  'general_contractor', 'cleaning', 'pool', 'security', 'permitting', 'other',
];

const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'vendors',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      renderFilters();
      populateCategoryDropdown();
      await loadVendors();
      setupEventListeners();
    }
  });
});

// =============================================
// DATA
// =============================================

async function loadVendors() {
  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    allVendors = data || [];
    renderGrid();
  } catch (err) {
    console.error('Error loading vendors:', err);
    showToast('Failed to load vendors', 'error');
  }
}

function populateCategoryDropdown() {
  const sel = document.getElementById('vendorCategory');
  sel.innerHTML = '<option value="">—</option>' +
    CATEGORIES.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(prettyCategory(c))}</option>`).join('');
}

function getFilteredVendors() {
  let vendors = allVendors;
  if (activeType !== 'all') {
    vendors = vendors.filter(v => v.vendor_type === activeType);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    vendors = vendors.filter(v =>
      (v.name && v.name.toLowerCase().includes(q)) ||
      (v.category && v.category.toLowerCase().includes(q)) ||
      (v.phone && v.phone.toLowerCase().includes(q)) ||
      (v.contact_name && v.contact_name.toLowerCase().includes(q)) ||
      (v.account_number && v.account_number.toLowerCase().includes(q)) ||
      (v.notes && v.notes.toLowerCase().includes(q))
    );
  }
  return vendors;
}

// =============================================
// RENDERING
// =============================================

function renderFilters() {
  const container = document.getElementById('vendFilters');
  container.innerHTML = TYPE_FILTERS.map(t =>
    `<button class="vend-chip ${t.id === activeType ? 'active' : ''}" data-type="${t.id}">${t.label}</button>`
  ).join('');
}

function renderGrid() {
  const vendors = getFilteredVendors();
  const grid = document.getElementById('vendGrid');
  const countEl = document.getElementById('vendCount');

  countEl.textContent = `${vendors.length} of ${allVendors.length}`;

  if (!vendors.length) {
    grid.innerHTML = '<div class="vend-empty">No vendors found.</div>';
    return;
  }

  const headerRow = `
    <div class="vend-col-header">
      <span class="vend-col-label">Name</span>
      <span class="vend-col-label">Type</span>
      <span class="vend-col-label">Phone</span>
      <span class="vend-col-label">Account #</span>
      <span class="vend-col-label col-actions">Actions</span>
    </div>`;

  const rows = vendors.map(v => {
    const subtitleParts = [];
    if (v.category) subtitleParts.push(escapeHtml(prettyCategory(v.category)));
    if (v.contact_name) subtitleParts.push(escapeHtml(v.contact_name));
    if (v.website) subtitleParts.push(`<a href="${escapeAttr(v.website)}" target="_blank" rel="noopener">${escapeHtml(prettifyUrl(v.website))}</a>`);
    if (v.notes) subtitleParts.push(`<span style="font-style:italic">${escapeHtml(v.notes)}</span>`);

    const phoneCell = v.phone
      ? `<a href="tel:${escapeAttr(v.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(v.phone)}</a>`
      : '<span class="vend-muted">—</span>';

    const acctCell = v.account_number
      ? escapeHtml(v.account_number)
      : '<span class="vend-muted">—</span>';

    return `
      <div class="vend-card" data-id="${escapeAttr(v.id)}">
        <div class="vend-card-name">
          <span class="vend-card-title">${escapeHtml(v.name)}</span>
          ${subtitleParts.length ? `<span class="vend-card-subtitle">${subtitleParts.join(' &middot; ')}</span>` : ''}
        </div>
        <span class="vend-card-type" data-type="${escapeAttr(v.vendor_type || '')}">${escapeHtml(v.vendor_type || '—')}</span>
        <span class="vend-phone">${phoneCell}</span>
        <span class="vend-acct">${acctCell}</span>
        <div class="vend-actions">
          <button class="vend-btn-icon" data-action="copy" data-id="${escapeAttr(v.id)}" title="Copy contact details">${COPY_SVG}</button>
          <button class="vend-btn-icon" data-action="edit" data-id="${escapeAttr(v.id)}" title="Edit">${EDIT_SVG}</button>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = headerRow + rows;
}

// =============================================
// MODAL
// =============================================

function openModal(vendorId = null) {
  editingVendorId = vendorId;
  const modal = document.getElementById('vendorModal');
  const title = document.getElementById('vendorModalTitle');
  const archiveBtn = document.getElementById('archiveVendorBtn');
  const form = document.getElementById('vendorForm');

  if (vendorId) {
    title.textContent = 'Edit Vendor';
    archiveBtn.style.display = 'block';
    const v = allVendors.find(x => String(x.id) === String(vendorId));
    if (v) {
      document.getElementById('vendorId').value = v.id;
      document.getElementById('vendorName').value = v.name || '';
      document.getElementById('vendorType').value = v.vendor_type || '';
      document.getElementById('vendorCategory').value = v.category || '';
      document.getElementById('vendorPhone').value = v.phone || '';
      document.getElementById('vendorAccount').value = v.account_number || '';
      document.getElementById('vendorEmail').value = v.email || '';
      document.getElementById('vendorContact').value = v.contact_name || '';
      document.getElementById('vendorWebsite').value = v.website || '';
      document.getElementById('vendorAddress').value = v.address || '';
      document.getElementById('vendorLicense').value = v.license_number || '';
      document.getElementById('vendorInsurance').value = v.insurance_expires || '';
      document.getElementById('vendorNotes').value = v.notes || '';
    }
  } else {
    title.textContent = 'Add Vendor';
    archiveBtn.style.display = 'none';
    form.reset();
    document.getElementById('vendorId').value = '';
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('vendorModal').classList.add('hidden');
  editingVendorId = null;
}

async function saveVendor() {
  const name = document.getElementById('vendorName').value.trim();
  if (!name) {
    showToast('Vendor name is required', 'warning');
    return;
  }

  const data = {
    name,
    vendor_type: document.getElementById('vendorType').value || null,
    category: document.getElementById('vendorCategory').value || null,
    phone: document.getElementById('vendorPhone').value.trim() || null,
    account_number: document.getElementById('vendorAccount').value.trim() || null,
    email: document.getElementById('vendorEmail').value.trim() || null,
    contact_name: document.getElementById('vendorContact').value.trim() || null,
    website: document.getElementById('vendorWebsite').value.trim() || null,
    address: document.getElementById('vendorAddress').value.trim() || null,
    license_number: document.getElementById('vendorLicense').value.trim() || null,
    insurance_expires: document.getElementById('vendorInsurance').value || null,
    notes: document.getElementById('vendorNotes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  try {
    if (editingVendorId) {
      const { error } = await supabase
        .from('vendors')
        .update(data)
        .eq('id', editingVendorId);
      if (error) throw error;
      showToast('Vendor updated', 'success');
    } else {
      const { error } = await supabase
        .from('vendors')
        .insert(data);
      if (error) throw error;
      showToast('Vendor added', 'success');
    }
    closeModal();
    await loadVendors();
  } catch (err) {
    console.error('Error saving vendor:', err);
    showToast('Failed to save vendor', 'error');
  }
}

// Soft delete: purchases may reference this vendor, so never hard-delete.
async function archiveVendor() {
  if (!editingVendorId) return;
  if (!confirm('Archive this vendor? It will be hidden from the list but kept for purchase history.')) return;

  try {
    const { error } = await supabase
      .from('vendors')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', editingVendorId);

    if (error) throw error;
    showToast('Vendor archived', 'success');
    closeModal();
    await loadVendors();
  } catch (err) {
    console.error('Error archiving vendor:', err);
    showToast('Failed to archive vendor', 'error');
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

function buildShareText(v) {
  const lines = [v.name];
  if (v.contact_name) lines.push(`Contact: ${v.contact_name}`);
  if (v.phone) lines.push(`Phone: ${v.phone}`);
  if (v.email) lines.push(`Email: ${v.email}`);
  if (v.account_number) lines.push(`Account: ${v.account_number}`);
  if (v.website) lines.push(`Web: ${v.website}`);
  if (v.address) lines.push(`Address: ${v.address}`);
  if (v.notes) lines.push(`Notes: ${v.notes}`);
  return lines.join('\n');
}

// =============================================
// EVENT LISTENERS
// =============================================

function setupEventListeners() {
  document.getElementById('vendSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchQuery) {
      activeType = 'all';
      renderFilters();
    }
    renderGrid();
  });

  document.getElementById('vendFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('.vend-chip');
    if (!chip) return;
    activeType = chip.dataset.type;
    renderFilters();
    renderGrid();
  });

  document.getElementById('vendGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    if (action === 'edit') {
      openModal(btn.dataset.id);
    } else if (action === 'copy') {
      const v = allVendors.find(x => String(x.id) === String(btn.dataset.id));
      if (v) copyToClipboard(buildShareText(v));
    }
  });

  document.getElementById('addVendorBtn').addEventListener('click', () => openModal());
  document.getElementById('closeVendorModal').addEventListener('click', closeModal);
  document.getElementById('cancelVendorBtn').addEventListener('click', closeModal);
  document.getElementById('saveVendorBtn').addEventListener('click', saveVendor);
  document.getElementById('archiveVendorBtn').addEventListener('click', archiveVendor);

  document.getElementById('vendorModal').addEventListener('click', (e) => {
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prettyCategory(cat) {
  if (!cat) return '';
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function prettifyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}
