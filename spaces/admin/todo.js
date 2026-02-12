/**
 * Setup Todo - Database-backed checklist with full CRUD
 * Self-contained: uses initAdminPage for nav/auth but loads data independently
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { getAuthState } from '../../shared/auth.js';

// =============================================
// STATE
// =============================================

let categories = [];
let allItems = [];

// =============================================
// DATA LOADING
// =============================================

async function loadData() {
  console.log('[todo] loadData() starting...');
  try {
    const catRes = await supabase.from('todo_categories').select('*').order('display_order');
    console.log('[todo] categories:', catRes.data?.length, 'error:', catRes.error);

    const itemRes = await supabase.from('todo_items').select('*').order('display_order');
    console.log('[todo] items:', itemRes.data?.length, 'error:', itemRes.error);

    if (catRes.error) showToast('Failed to load categories: ' + catRes.error.message, 'error');
    if (itemRes.error) showToast('Failed to load items: ' + itemRes.error.message, 'error');

    allItems = itemRes.data || [];
    categories = (catRes.data || []).map(cat => ({
      ...cat,
      items: allItems.filter(i => i.category_id === cat.id)
    }));
  } catch (err) {
    console.error('[todo] loadData exception:', err);
    showToast('Error loading data: ' + err.message, 'error');
  }

  render();
  console.log('[todo] render() complete, categories:', categories.length, 'items:', allItems.length);
}

// =============================================
// CHECKBOX TOGGLE
// =============================================

async function toggleItem(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  const auth = getAuthState();
  const newChecked = !item.is_checked;

  // Optimistic update
  item.is_checked = newChecked;
  item.checked_at = newChecked ? new Date().toISOString() : null;
  render();

  const update = {
    is_checked: newChecked,
    checked_by: newChecked ? (auth?.appUser?.id || null) : null,
    checked_at: newChecked ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('todo_items').update(update).eq('id', itemId);
  if (error) {
    console.error('Toggle failed:', error);
    item.is_checked = !newChecked;
    render();
    showToast('Failed to update', 'error');
  }
}

// =============================================
// CATEGORY CRUD
// =============================================

function openCategoryModal(category = null) {
  const modal = document.getElementById('todoModal');
  const title = document.getElementById('todoModalTitle');
  const body = document.getElementById('todoModalBody');
  const saveBtn = document.getElementById('todoModalSave');
  const deleteBtn = document.getElementById('todoModalDelete');

  title.textContent = category ? 'Edit Category' : 'Add Category';

  body.innerHTML = `
    <label for="catTitle">Title</label>
    <input type="text" id="catTitle" value="${esc(category?.title || '')}" placeholder="Category name">
    <label for="catIcon">Icon SVG</label>
    <textarea id="catIcon" rows="3" style="font-family:monospace;font-size:0.8rem" placeholder="Paste SVG element">${esc(category?.icon_svg || defaultIcon)}</textarea>
    <small style="color:var(--text-muted);display:block;margin-top:0.25rem">Paste a Feather Icons SVG or leave default</small>
  `;

  deleteBtn.style.display = category ? '' : 'none';
  deleteBtn.onclick = async () => {
    if (!confirm(`Delete "${category.title}" and all its items?`)) return;
    const { error } = await supabase.from('todo_categories').delete().eq('id', category.id);
    if (error) { showToast('Delete failed', 'error'); return; }
    closeModal();
    showToast('Category deleted', 'info');
    await loadData();
  };

  saveBtn.onclick = async () => {
    const t = document.getElementById('catTitle').value.trim();
    const icon = document.getElementById('catIcon').value.trim();
    if (!t) { showToast('Title is required', 'error'); return; }

    if (category) {
      const { error } = await supabase.from('todo_categories').update({
        title: t, icon_svg: icon, updated_at: new Date().toISOString()
      }).eq('id', category.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Category updated', 'success');
    } else {
      const maxOrder = categories.reduce((max, c) => Math.max(max, c.display_order), -1);
      const { error } = await supabase.from('todo_categories').insert({
        title: t, icon_svg: icon, display_order: maxOrder + 1
      });
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Category added', 'success');
    }
    closeModal();
    await loadData();
  };

  modal.classList.remove('hidden');
}

// =============================================
// ITEM CRUD
// =============================================

function openItemModal(categoryId, item = null) {
  const modal = document.getElementById('todoModal');
  const title = document.getElementById('todoModalTitle');
  const body = document.getElementById('todoModalBody');
  const saveBtn = document.getElementById('todoModalSave');
  const deleteBtn = document.getElementById('todoModalDelete');

  title.textContent = item ? 'Edit Item' : 'Add Item';

  const catOptions = categories.map(c =>
    `<option value="${c.id}" ${c.id === (item?.category_id || categoryId) ? 'selected' : ''}>${esc(c.title)}</option>`
  ).join('');

  body.innerHTML = `
    <label for="itemTitle">Title</label>
    <input type="text" id="itemTitle" value="${esc(item?.title || '')}" placeholder="Task title">
    <label for="itemDesc">Description <small style="font-weight:400;color:var(--text-muted)">(HTML allowed)</small></label>
    <textarea id="itemDesc" rows="3" placeholder="Optional description...">${item?.description || ''}</textarea>
    <label for="itemBadge">Priority</label>
    <select id="itemBadge">
      <option value="" ${!item?.badge ? 'selected' : ''}>None</option>
      <option value="critical" ${item?.badge === 'critical' ? 'selected' : ''}>Critical</option>
      <option value="important" ${item?.badge === 'important' ? 'selected' : ''}>Important</option>
      <option value="nice" ${item?.badge === 'nice' ? 'selected' : ''}>Nice to Have</option>
      <option value="blocked" ${item?.badge === 'blocked' ? 'selected' : ''}>Blocked</option>
    </select>
    <label for="itemCategory">Category</label>
    <select id="itemCategory">${catOptions}</select>
  `;

  deleteBtn.style.display = item ? '' : 'none';
  deleteBtn.onclick = async () => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    const { error } = await supabase.from('todo_items').delete().eq('id', item.id);
    if (error) { showToast('Delete failed', 'error'); return; }
    closeModal();
    showToast('Item deleted', 'info');
    await loadData();
  };

  saveBtn.onclick = async () => {
    const t = document.getElementById('itemTitle').value.trim();
    const desc = document.getElementById('itemDesc').value.trim();
    const badge = document.getElementById('itemBadge').value || null;
    const catId = document.getElementById('itemCategory').value;
    if (!t) { showToast('Title is required', 'error'); return; }

    if (item) {
      const { error } = await supabase.from('todo_items').update({
        title: t, description: desc || null, badge,
        category_id: catId, updated_at: new Date().toISOString()
      }).eq('id', item.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Item updated', 'success');
    } else {
      const catItems = allItems.filter(i => i.category_id === catId);
      const maxOrder = catItems.reduce((max, i) => Math.max(max, i.display_order), -1);
      const { error } = await supabase.from('todo_items').insert({
        category_id: catId, title: t, description: desc || null,
        badge, display_order: maxOrder + 1
      });
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Item added', 'success');
    }
    closeModal();
    await loadData();
  };

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('todoModal').classList.add('hidden');
}

// =============================================
// REORDER
// =============================================

async function moveCategory(catId, direction) {
  const idx = categories.findIndex(c => c.id === catId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= categories.length) return;

  const a = categories[idx], b = categories[swapIdx];
  await Promise.all([
    supabase.from('todo_categories').update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from('todo_categories').update({ display_order: a.display_order }).eq('id', b.id)
  ]);
  await loadData();
}

async function moveItem(itemId, direction) {
  const cat = categories.find(c => c.items.some(i => i.id === itemId));
  if (!cat) return;
  const items = cat.items;
  const idx = items.findIndex(i => i.id === itemId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;

  const a = items[idx], b = items[swapIdx];
  await Promise.all([
    supabase.from('todo_items').update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from('todo_items').update({ display_order: a.display_order }).eq('id', b.id)
  ]);
  await loadData();
}

// =============================================
// RESET ALL
// =============================================

async function handleResetAll() {
  if (!confirm('Reset all checkboxes? This will uncheck everything.')) return;
  const { error } = await supabase.from('todo_items').update({
    is_checked: false, checked_by: null, checked_at: null, updated_at: new Date().toISOString()
  }).eq('is_checked', true);

  if (error) { showToast('Reset failed', 'error'); return; }
  showToast('All tasks reset', 'info');
  await loadData();
}

// =============================================
// RENDERING
// =============================================

const defaultIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';

const icons = {
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  chevron: '<svg class="todo-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
};

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function render() {
  // Summary
  const total = allItems.length;
  const done = allItems.filter(i => i.is_checked).length;
  const remaining = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('todoSummary').innerHTML = `
    <div class="todo-summary-stat"><span class="todo-summary-value total">${total}</span><span class="todo-summary-label">Total</span></div>
    <div class="todo-summary-stat"><span class="todo-summary-value done">${done}</span><span class="todo-summary-label">Done</span></div>
    <div class="todo-summary-stat"><span class="todo-summary-value remaining">${remaining}</span><span class="todo-summary-label">Remaining</span></div>
    <div class="todo-summary-stat"><span class="todo-summary-value" style="color:${pct === 100 ? 'var(--success)' : 'var(--text)'}">${pct}%</span><span class="todo-summary-label">Progress</span></div>
  `;
  document.getElementById('todoProgressFill').style.width = `${pct}%`;

  // Categories
  document.getElementById('todoContainer').innerHTML = categories.map(cat => {
    const catDone = cat.items.filter(i => i.is_checked).length;
    const catTotal = cat.items.length;
    const allDone = catDone === catTotal && catTotal > 0;

    return `
      <div class="todo-category${allDone ? ' collapsed' : ''}" data-cat="${cat.id}">
        <div class="todo-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.icon_svg || defaultIcon}
          <h2>${esc(cat.title)}</h2>
          <span class="todo-category-progress"><span class="${allDone ? 'done' : ''}">${catDone}/${catTotal}</span></span>
          <div class="todo-cat-actions" onclick="event.stopPropagation()">
            <button class="todo-action-btn" title="Add item" data-action="add-item" data-cat-id="${cat.id}">${icons.plus}</button>
            <button class="todo-action-btn" title="Edit" data-action="edit-cat" data-cat-id="${cat.id}">${icons.edit}</button>
            <button class="todo-action-btn" title="Move up" data-action="move-cat-up" data-cat-id="${cat.id}">${icons.up}</button>
            <button class="todo-action-btn" title="Move down" data-action="move-cat-down" data-cat-id="${cat.id}">${icons.down}</button>
          </div>
          ${icons.chevron}
        </div>
        <div class="todo-items">
          ${cat.items.map((item, idx) => {
            const checked = item.is_checked;
            const badgeHtml = item.badge ? `<span class="todo-badge ${item.badge}">${item.badge}</span>` : '';
            const checkedInfo = checked && item.checked_at ? `<div class="todo-checked-info">${timeAgo(item.checked_at)}</div>` : '';
            return `
              <div class="todo-item${checked ? ' checked' : ''}">
                <input type="checkbox" class="todo-checkbox" data-id="${item.id}" ${checked ? 'checked' : ''}>
                <div class="todo-item-content">
                  <div class="todo-item-title">${esc(item.title)}</div>
                  ${item.description ? `<div class="todo-item-desc">${item.description}</div>` : ''}
                  ${checkedInfo}
                </div>
                ${badgeHtml}
                <div class="todo-item-actions" onclick="event.stopPropagation()">
                  <button class="todo-action-btn" title="Edit" data-action="edit-item" data-item-id="${item.id}">${icons.edit}</button>
                  <button class="todo-action-btn" title="Move up" data-action="move-item-up" data-item-id="${item.id}" ${idx === 0 ? 'disabled' : ''}>${icons.up}</button>
                  <button class="todo-action-btn" title="Move down" data-action="move-item-down" data-item-id="${item.id}" ${idx === cat.items.length - 1 ? 'disabled' : ''}>${icons.down}</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// =============================================
// EVENT DELEGATION
// =============================================

function setupEventListeners() {
  const container = document.getElementById('todoContainer');

  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-checkbox')) toggleItem(e.target.dataset.id);
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, catId, itemId } = btn.dataset;

    switch (action) {
      case 'add-item': openItemModal(catId); break;
      case 'edit-cat': { const c = categories.find(x => x.id === catId); if (c) openCategoryModal(c); break; }
      case 'move-cat-up': moveCategory(catId, 'up'); break;
      case 'move-cat-down': moveCategory(catId, 'down'); break;
      case 'edit-item': { const i = allItems.find(x => x.id === itemId); if (i) openItemModal(i.category_id, i); break; }
      case 'move-item-up': moveItem(itemId, 'up'); break;
      case 'move-item-down': moveItem(itemId, 'down'); break;
    }
  });

  document.getElementById('resetAllBtn').addEventListener('click', handleResetAll);
  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
  document.getElementById('todoModalClose').addEventListener('click', closeModal);
  document.getElementById('todoModal').addEventListener('click', (e) => {
    if (e.target.id === 'todoModal') closeModal();
  });
}

// =============================================
// INIT
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Set up event listeners immediately (DOM is ready)
  setupEventListeners();

  // Load data immediately — RLS is open for reads, no auth needed
  await loadData();

  // Then let admin shell handle nav/auth in background
  initAdminPage({
    activeTab: 'todo',
    requiredRole: 'staff',
    section: 'staff',
    onReady: () => {
      console.log('[todo] initAdminPage onReady fired');
    }
  }).catch(err => {
    console.warn('[todo] initAdminPage error (non-fatal):', err);
  });
});
