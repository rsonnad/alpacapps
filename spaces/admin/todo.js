/**
 * Setup Todo - Database-backed checklist with full CRUD
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { getAuthState } from '../../shared/auth.js';

// =============================================
// STATE
// =============================================

let categories = [];   // [{...cat, items: [...]}]
let allItems = [];     // flat array for stats

// =============================================
// DATA
// =============================================

async function loadData() {
  const [catRes, itemRes] = await Promise.all([
    supabase.from('todo_categories').select('*').order('display_order'),
    supabase.from('todo_items').select('*, checked_by_user:checked_by(display_name)').order('display_order')
  ]);

  if (catRes.error) { console.error('Failed to load categories:', catRes.error); showToast('Failed to load data', 'error'); return; }
  if (itemRes.error) { console.error('Failed to load items:', itemRes.error); showToast('Failed to load data', 'error'); return; }

  allItems = itemRes.data || [];
  categories = (catRes.data || []).map(cat => ({
    ...cat,
    items: allItems.filter(i => i.category_id === cat.id)
  }));

  render();
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
  item.checked_by = newChecked ? auth.appUser?.id : null;
  item.checked_at = newChecked ? new Date().toISOString() : null;
  item.checked_by_user = newChecked ? { display_name: auth.appUser?.display_name || auth.user?.email } : null;
  render();

  const update = {
    is_checked: newChecked,
    checked_by: newChecked ? auth.appUser?.id : null,
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
    <input type="text" id="catTitle" value="${escHtml(category?.title || '')}" placeholder="Category name">
    <label for="catIcon">Icon SVG</label>
    <textarea id="catIcon" rows="3" style="font-family:monospace;font-size:0.8rem" placeholder="Paste SVG element">${escHtml(category?.icon_svg || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>')}</textarea>
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
    const catTitle = document.getElementById('catTitle').value.trim();
    const catIcon = document.getElementById('catIcon').value.trim();
    if (!catTitle) { showToast('Title is required', 'error'); return; }

    if (category) {
      const { error } = await supabase.from('todo_categories').update({
        title: catTitle, icon_svg: catIcon, updated_at: new Date().toISOString()
      }).eq('id', category.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Category updated', 'success');
    } else {
      const maxOrder = categories.reduce((max, c) => Math.max(max, c.display_order), -1);
      const { error } = await supabase.from('todo_categories').insert({
        title: catTitle, icon_svg: catIcon, display_order: maxOrder + 1
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
    `<option value="${c.id}" ${c.id === (item?.category_id || categoryId) ? 'selected' : ''}>${escHtml(c.title)}</option>`
  ).join('');

  body.innerHTML = `
    <label for="itemTitle">Title</label>
    <input type="text" id="itemTitle" value="${escHtml(item?.title || '')}" placeholder="Task title">
    <label for="itemDesc">Description <small style="font-weight:400;color:var(--text-muted)">(HTML allowed)</small></label>
    <textarea id="itemDesc" rows="3" placeholder="Optional description with links...">${item?.description || ''}</textarea>
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
    const itemTitle = document.getElementById('itemTitle').value.trim();
    const itemDesc = document.getElementById('itemDesc').value.trim();
    const itemBadge = document.getElementById('itemBadge').value || null;
    const itemCategoryId = document.getElementById('itemCategory').value;
    if (!itemTitle) { showToast('Title is required', 'error'); return; }

    if (item) {
      const { error } = await supabase.from('todo_items').update({
        title: itemTitle, description: itemDesc || null, badge: itemBadge,
        category_id: itemCategoryId, updated_at: new Date().toISOString()
      }).eq('id', item.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Item updated', 'success');
    } else {
      // Get max display_order within category
      const catItems = allItems.filter(i => i.category_id === itemCategoryId);
      const maxOrder = catItems.reduce((max, i) => Math.max(max, i.display_order), -1);
      const { error } = await supabase.from('todo_items').insert({
        category_id: itemCategoryId, title: itemTitle, description: itemDesc || null,
        badge: itemBadge, display_order: maxOrder + 1
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

  const a = categories[idx];
  const b = categories[swapIdx];
  const [aOrder, bOrder] = [a.display_order, b.display_order];

  await Promise.all([
    supabase.from('todo_categories').update({ display_order: bOrder }).eq('id', a.id),
    supabase.from('todo_categories').update({ display_order: aOrder }).eq('id', b.id)
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

  const a = items[idx];
  const b = items[swapIdx];
  const [aOrder, bOrder] = [a.display_order, b.display_order];

  await Promise.all([
    supabase.from('todo_items').update({ display_order: bOrder }).eq('id', a.id),
    supabase.from('todo_items').update({ display_order: aOrder }).eq('id', b.id)
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

function getStats() {
  let total = allItems.length;
  let done = allItems.filter(i => i.is_checked).length;
  return { total, done, remaining: total - done };
}

function getCategoryStats(cat) {
  let total = cat.items.length;
  let done = cat.items.filter(i => i.is_checked).length;
  return { total, done };
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSummary() {
  const { total, done, remaining } = getStats();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('todoSummary').innerHTML = `
    <div class="todo-summary-stat">
      <span class="todo-summary-value total">${total}</span>
      <span class="todo-summary-label">Total Tasks</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value done">${done}</span>
      <span class="todo-summary-label">Completed</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value remaining">${remaining}</span>
      <span class="todo-summary-label">Remaining</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value" style="color:${pct === 100 ? 'var(--success)' : 'var(--text)'}">${pct}%</span>
      <span class="todo-summary-label">Progress</span>
    </div>
  `;

  document.getElementById('todoProgressFill').style.width = `${pct}%`;
}

function renderCategories() {
  const container = document.getElementById('todoContainer');
  container.innerHTML = categories.map(cat => {
    const stats = getCategoryStats(cat);
    const allDone = stats.done === stats.total && stats.total > 0;
    const collapsed = allDone ? ' collapsed' : '';

    return `
      <div class="todo-category${collapsed}" data-cat="${cat.id}">
        <div class="todo-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.icon_svg || ''}
          <h2>${escHtml(cat.title)}</h2>
          <span class="todo-category-progress">
            <span class="${allDone ? 'done' : ''}">${stats.done}/${stats.total}</span>
          </span>
          <div class="todo-cat-actions" onclick="event.stopPropagation()">
            <button class="todo-action-btn" title="Add item" data-action="add-item" data-cat-id="${cat.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="todo-action-btn" title="Edit category" data-action="edit-cat" data-cat-id="${cat.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="todo-action-btn" title="Move up" data-action="move-cat-up" data-cat-id="${cat.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button class="todo-action-btn" title="Move down" data-action="move-cat-down" data-cat-id="${cat.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
          <svg class="todo-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="todo-items">
          ${cat.items.map((item, idx) => renderItem(item, idx, cat.items.length)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderItem(item, idx, totalInCat) {
  const checked = item.is_checked;
  const badgeHtml = item.badge ? `<span class="todo-badge ${item.badge}">${item.badge}</span>` : '';
  const checkedInfo = checked && item.checked_by_user
    ? `<div class="todo-checked-info">${escHtml(item.checked_by_user.display_name)} &middot; ${timeAgo(item.checked_at)}</div>`
    : '';

  return `
    <div class="todo-item${checked ? ' checked' : ''}">
      <input type="checkbox" class="todo-checkbox" data-id="${item.id}" ${checked ? 'checked' : ''}>
      <div class="todo-item-content">
        <div class="todo-item-title">${escHtml(item.title)}</div>
        ${item.description ? `<div class="todo-item-desc">${item.description}</div>` : ''}
        ${checkedInfo}
      </div>
      ${badgeHtml}
      <div class="todo-item-actions" onclick="event.stopPropagation()">
        <button class="todo-action-btn" title="Edit" data-action="edit-item" data-item-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="todo-action-btn" title="Move up" data-action="move-item-up" data-item-id="${item.id}" ${idx === 0 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="todo-action-btn" title="Move down" data-action="move-item-down" data-item-id="${item.id}" ${idx === totalInCat - 1 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
  `;
}

function render() {
  renderSummary();
  renderCategories();
}

// =============================================
// EVENT DELEGATION
// =============================================

function setupEventListeners() {
  const container = document.getElementById('todoContainer');

  // Checkbox changes
  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-checkbox')) {
      toggleItem(e.target.dataset.id);
    }
  });

  // Action buttons (delegated)
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const catId = btn.dataset.catId;
    const itemId = btn.dataset.itemId;

    switch (action) {
      case 'add-item':
        openItemModal(catId);
        break;
      case 'edit-cat': {
        const cat = categories.find(c => c.id === catId);
        if (cat) openCategoryModal(cat);
        break;
      }
      case 'move-cat-up':
        moveCategory(catId, 'up');
        break;
      case 'move-cat-down':
        moveCategory(catId, 'down');
        break;
      case 'edit-item': {
        const item = allItems.find(i => i.id === itemId);
        if (item) openItemModal(item.category_id, item);
        break;
      }
      case 'move-item-up':
        moveItem(itemId, 'up');
        break;
      case 'move-item-down':
        moveItem(itemId, 'down');
        break;
    }
  });

  // Top-level buttons
  document.getElementById('resetAllBtn').addEventListener('click', handleResetAll);
  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());

  // Modal close
  document.getElementById('todoModalClose').addEventListener('click', closeModal);
  document.getElementById('todoModal').addEventListener('click', (e) => {
    if (e.target.id === 'todoModal') closeModal();
  });
}

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'todo',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      setupEventListeners();
      await loadData();
    }
  });
});
