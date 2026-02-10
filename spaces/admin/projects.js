/**
 * Admin Projects Page - Create, edit, delete, and reassign tasks
 */
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { supabase } from '../../shared/supabase.js';
import { projectService } from '../../shared/project-service.js';

let allTasks = [];
let spaces = [];
let assigneeNames = [];
let selectedIds = new Set();
let initialized = false;
let debounceTimer = null;

// ---- Init ----
initAdminPage({
  activeTab: 'projects',
  section: 'staff',
  onReady: async () => {
    if (initialized) return;
    initialized = true;
    await Promise.all([loadSpaces(), loadAssignees()]);
    bindEvents();
    await loadTasks();
  }
});

// ---- Load reference data ----
async function loadSpaces() {
  const { data } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('is_archived', false)
    .order('name');
  spaces = data || [];

  // Populate modal dropdown
  const sel = document.getElementById('inputSpace');
  spaces.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

async function loadAssignees() {
  assigneeNames = await projectService.getAssigneeNames();

  // Populate filter + bulk + modal dropdowns
  [document.getElementById('filterAssignee'), document.getElementById('bulkAssignee')].forEach(sel => {
    assigneeNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });

  // Also load app_users for the modal assignee dropdown (links to real accounts)
  const { data: users } = await supabase
    .from('app_users')
    .select('id, display_name, role')
    .in('role', ['associate', 'staff', 'admin', 'oracle'])
    .order('display_name');

  const modalSel = document.getElementById('inputAssignee');
  // Add a "name only" group
  const optGroupName = document.createElement('optgroup');
  optGroupName.label = 'Name Only';
  assigneeNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = `name:${name}`;
    opt.textContent = name;
    optGroupName.appendChild(opt);
  });
  modalSel.appendChild(optGroupName);

  // Add linked users group
  if (users && users.length) {
    const optGroupUsers = document.createElement('optgroup');
    optGroupUsers.label = 'System Users';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = `user:${u.id}:${u.display_name}`;
      opt.textContent = `${u.display_name} (${u.role})`;
      optGroupUsers.appendChild(opt);
    });
    modalSel.appendChild(optGroupUsers);
  }
}

// ---- Load Tasks ----
async function loadTasks() {
  const filters = getFilters();
  allTasks = await projectService.getAllTasks(filters);

  // Default: show open + in_progress only
  const statusVal = document.getElementById('filterStatus').value;
  let display = allTasks;
  if (!statusVal) {
    display = allTasks.filter(t => t.status !== 'done');
  }

  renderTable(display);
  updateStats();
  updateBulkBar();
}

function getFilters() {
  const f = {};
  const status = document.getElementById('filterStatus').value;
  f.status = status || 'all';

  const priority = document.getElementById('filterPriority').value;
  if (priority) f.priority = parseInt(priority);

  const assignee = document.getElementById('filterAssignee').value;
  if (assignee) f.assignedName = assignee;

  const search = document.getElementById('searchInput').value.trim();
  if (search) f.search = search;

  return f;
}

// ---- Render ----
function renderTable(tasks) {
  const tbody = document.getElementById('taskTableBody');

  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tasks match your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = tasks.map(t => {
    const pClass = t.priority ? `p${t.priority}` : '';
    const pLabel = t.priority ? `P${t.priority}` : '';
    const location = t.space?.name || t.location_label || '';
    const checked = selectedIds.has(t.id) ? 'checked' : '';

    return `<tr class="${t.status === 'done' ? 'done' : ''}">
      <td><input type="checkbox" class="row-check" data-id="${t.id}" ${checked}></td>
      <td>${pLabel ? `<span class="priority-badge ${pClass}">${pLabel}</span>` : ''}</td>
      <td class="title-cell">
        <div class="title-text">${esc(t.title)}</div>
        ${t.notes ? `<div class="notes-text">${esc(t.notes)}</div>` : ''}
      </td>
      <td>${t.assigned_name ? `<span class="assignee-badge">${esc(t.assigned_name)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${esc(location)}</td>
      <td><span class="status-badge ${t.status}">${statusLabel(t.status)}</span></td>
      <td class="hide-mobile">
        <div class="row-actions">
          <button data-edit="${t.id}" title="Edit">Edit</button>
          <button class="btn-del" data-delete="${t.id}" title="Delete">&times;</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function statusLabel(s) {
  return { open: 'Open', in_progress: 'In Progress', done: 'Done' }[s] || s;
}

async function updateStats() {
  const stats = await projectService.getTaskStats();
  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statOpen').textContent = stats.open;
  document.getElementById('statInProgress').textContent = stats.in_progress;
  document.getElementById('statDone').textContent = stats.done;
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  bar.classList.toggle('visible', selectedIds.size > 0);
  document.getElementById('bulkCount').textContent = selectedIds.size;
}

// ---- Events ----
function bindEvents() {
  // Filters
  ['filterAssignee', 'filterStatus', 'filterPriority'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadTasks);
  });

  // Search debounce
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadTasks, 300);
  });

  // Select all
  document.getElementById('selectAll').addEventListener('change', (e) => {
    const checks = document.querySelectorAll('.row-check');
    checks.forEach(c => {
      c.checked = e.target.checked;
      if (e.target.checked) selectedIds.add(c.dataset.id);
      else selectedIds.delete(c.dataset.id);
    });
    updateBulkBar();
  });

  // Individual checkboxes (delegated)
  document.getElementById('taskTableBody').addEventListener('change', (e) => {
    if (!e.target.classList.contains('row-check')) return;
    if (e.target.checked) selectedIds.add(e.target.dataset.id);
    else selectedIds.delete(e.target.dataset.id);
    updateBulkBar();
  });

  // Row actions (delegated)
  document.getElementById('taskTableBody').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const task = allTasks.find(t => t.id === editBtn.dataset.edit);
      if (task) openEditModal(task);
      return;
    }
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      if (!confirm('Delete this task?')) return;
      try {
        await projectService.deleteTask(delBtn.dataset.delete);
        showToast('Task deleted', 'success');
        await loadTasks();
      } catch (err) {
        showToast('Delete failed', 'error');
      }
    }
  });

  // Add task button
  document.getElementById('btnAddTask').addEventListener('click', openAddModal);

  // Modal save/cancel
  document.getElementById('btnModalSave').addEventListener('click', saveTask);
  document.getElementById('btnModalCancel').addEventListener('click', closeModal);
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Bulk reassign
  document.getElementById('btnBulkReassign').addEventListener('click', async () => {
    const val = document.getElementById('bulkAssignee').value;
    if (!val || !selectedIds.size) return;
    try {
      await projectService.bulkReassign([...selectedIds], null, val);
      showToast(`Reassigned ${selectedIds.size} tasks to ${val}`, 'success');
      selectedIds.clear();
      await loadTasks();
    } catch (err) {
      showToast('Reassign failed', 'error');
    }
  });

  // Bulk status
  document.getElementById('btnBulkStatus').addEventListener('click', async () => {
    const status = document.getElementById('bulkStatus').value;
    if (!status || !selectedIds.size) return;
    try {
      for (const id of selectedIds) {
        await projectService.updateTask(id, { status });
      }
      showToast(`Updated ${selectedIds.size} tasks to ${statusLabel(status)}`, 'success');
      selectedIds.clear();
      await loadTasks();
    } catch (err) {
      showToast('Status update failed', 'error');
    }
  });
}

// ---- Modal ----
function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Add Task';
  document.getElementById('editTaskId').value = '';
  document.getElementById('inputTitle').value = '';
  document.getElementById('inputNotes').value = '';
  document.getElementById('inputPriority').value = '';
  document.getElementById('inputSpace').value = '';
  document.getElementById('inputLocationLabel').value = '';
  document.getElementById('inputAssignee').value = '';
  document.getElementById('inputStatus').value = 'open';
  document.getElementById('taskModal').classList.add('open');
}

function openEditModal(task) {
  document.getElementById('modalTitle').textContent = 'Edit Task';
  document.getElementById('editTaskId').value = task.id;
  document.getElementById('inputTitle').value = task.title;
  document.getElementById('inputNotes').value = task.notes || '';
  document.getElementById('inputPriority').value = task.priority || '';
  document.getElementById('inputSpace').value = task.space_id || '';
  document.getElementById('inputLocationLabel').value = task.location_label || '';
  document.getElementById('inputStatus').value = task.status;

  // Set assignee
  const assigneeSel = document.getElementById('inputAssignee');
  if (task.assigned_to) {
    assigneeSel.value = `user:${task.assigned_to}:${task.assigned_name || ''}`;
  } else if (task.assigned_name) {
    assigneeSel.value = `name:${task.assigned_name}`;
  } else {
    assigneeSel.value = '';
  }

  document.getElementById('taskModal').classList.add('open');
}

function closeModal() {
  document.getElementById('taskModal').classList.remove('open');
}

async function saveTask() {
  const title = document.getElementById('inputTitle').value.trim();
  if (!title) { showToast('Title is required', 'warning'); return; }

  const id = document.getElementById('editTaskId').value;
  const assigneeVal = document.getElementById('inputAssignee').value;
  let assignedTo = null, assignedName = null;

  if (assigneeVal.startsWith('user:')) {
    const parts = assigneeVal.split(':');
    assignedTo = parts[1];
    assignedName = parts.slice(2).join(':');
  } else if (assigneeVal.startsWith('name:')) {
    assignedName = assigneeVal.substring(5);
  }

  const payload = {
    title,
    notes: document.getElementById('inputNotes').value.trim(),
    priority: document.getElementById('inputPriority').value ? parseInt(document.getElementById('inputPriority').value) : null,
    spaceId: document.getElementById('inputSpace').value || null,
    locationLabel: document.getElementById('inputLocationLabel').value.trim() || null,
    assignedTo,
    assignedName,
    status: document.getElementById('inputStatus').value,
  };

  try {
    if (id) {
      await projectService.updateTask(id, payload);
      showToast('Task updated', 'success');
    } else {
      await projectService.createTask(payload);
      showToast('Task created', 'success');
    }
    closeModal();
    await loadTasks();
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Save failed', 'error');
  }
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
