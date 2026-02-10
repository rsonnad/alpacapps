/**
 * Associate Projects Page
 * Task board view — all associates can see all tasks and update status.
 */

import { initAssociatePage, showToast } from '../shared/associate-shell.js';
import { projectService } from '../shared/project-service.js';

let currentUser = null;
let allTasks = [];
let myTasksActive = false;

// ---- Init ----
initAssociatePage({
  activeTab: 'projects',
  onReady: async (state) => {
    currentUser = state.appUser;
    await loadAssignees();
    await loadTasks();
    bindEvents();
  }
});

// ---- Load Assignees for Filter ----
async function loadAssignees() {
  try {
    const names = await projectService.getAssigneeNames();
    const sel = document.getElementById('filterAssignee');
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load assignees:', e);
  }
}

// ---- Load Tasks ----
async function loadTasks() {
  try {
    const filters = getFilters();
    allTasks = await projectService.getAllTasks(filters);
    renderTasks(allTasks);
    updateStats(allTasks);
  } catch (e) {
    console.error('Failed to load tasks:', e);
    document.getElementById('taskList').innerHTML = '<div class="empty-state">Failed to load tasks.</div>';
  }
}

function getFilters() {
  const filters = {};

  const status = document.getElementById('filterStatus').value;
  if (status === 'all') {
    filters.status = 'all';
  } else if (status) {
    filters.status = status;
  } else {
    // Default: open + in_progress — we'll fetch all and filter client-side
    filters.status = 'all';
  }

  const priority = document.getElementById('filterPriority').value;
  if (priority) filters.priority = parseInt(priority);

  if (myTasksActive && currentUser) {
    filters.assignedTo = currentUser.id;
  } else {
    const assignee = document.getElementById('filterAssignee').value;
    if (assignee) filters.assignedName = assignee;
  }

  return filters;
}

// ---- Render ----
function renderTasks(tasks) {
  const container = document.getElementById('taskList');

  // Client-side filter for default "Open + In Progress"
  const statusFilter = document.getElementById('filterStatus').value;
  if (!statusFilter) {
    tasks = tasks.filter(t => t.status !== 'done');
  }

  if (!tasks.length) {
    container.innerHTML = '<div class="empty-state">No tasks match your filters.</div>';
    return;
  }

  // Group by priority
  const groups = {};
  const labels = { 1: 'P1 — Urgent', 2: 'P2 — High', 3: 'P3 — Medium', 4: 'P4 — Low', null: 'No Priority' };

  tasks.forEach(t => {
    const key = t.priority || 'null';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const order = [1, 2, 3, 4, 'null'];
  let html = '';

  order.forEach(key => {
    const g = groups[key];
    if (!g || !g.length) return;
    html += `<div class="task-group">
      <div class="task-group-header">${labels[key === 'null' ? null : key]} (${g.length})</div>`;
    g.forEach(t => { html += renderTaskCard(t); });
    html += '</div>';
  });

  container.innerHTML = html;
}

function renderTaskCard(task) {
  const pClass = task.priority ? `p${task.priority}` : 'pnone';
  const pLabel = task.priority ? `P${task.priority}` : '—';
  const location = task.space?.name || task.location_label || '';
  const doneClass = task.status === 'done' ? 'done' : '';

  let actions = '';
  if (task.status === 'open') {
    actions = `<button class="btn-start" data-id="${task.id}" data-action="start">Start Working</button>
               <button class="btn-done" data-id="${task.id}" data-action="done">Mark Done</button>`;
  } else if (task.status === 'in_progress') {
    actions = `<button class="btn-done" data-id="${task.id}" data-action="done">Mark Done</button>
               <button class="btn-reopen" data-id="${task.id}" data-action="reopen">Reopen</button>`;
  } else {
    actions = `<button class="btn-reopen" data-id="${task.id}" data-action="reopen">Reopen</button>`;
  }

  const statusBadge = task.status === 'in_progress'
    ? '<span style="color:#d97706;font-weight:600;font-size:0.75rem">IN PROGRESS</span>' : '';

  return `<div class="task-card ${doneClass}">
    <div class="task-card-top">
      <span class="task-priority ${pClass}">${pLabel}</span>
      <div class="task-card-body">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">
          ${location ? `<span class="task-location">${esc(location)}</span>` : ''}
          ${task.assigned_name ? `<span class="task-assignee">${esc(task.assigned_name)}</span>` : ''}
          ${statusBadge}
        </div>
        ${task.notes ? `<div class="task-notes">${esc(task.notes)}</div>` : ''}
        ${task.status === 'done' && task.completed_date ? `<div class="task-completed-date">Completed: ${esc(task.completed_date)}</div>` : ''}
        ${task.status === 'done' && task.completed_at && !task.completed_date ? `<div class="task-completed-date">Completed: ${new Date(task.completed_at).toLocaleDateString()}</div>` : ''}
        <div class="task-actions">${actions}</div>
      </div>
    </div>
  </div>`;
}

function updateStats(tasks) {
  // Stats count ALL tasks regardless of filter — fetch separate
  projectService.getTaskStats().then(stats => {
    document.getElementById('statOpen').textContent = stats.open;
    document.getElementById('statInProgress').textContent = stats.in_progress;
    document.getElementById('statDone').textContent = stats.done;
  });
}

// ---- Events ----
function bindEvents() {
  // Filters
  document.getElementById('filterAssignee').addEventListener('change', () => {
    myTasksActive = false;
    document.getElementById('btnMyTasks').classList.remove('active');
    loadTasks();
  });
  document.getElementById('filterStatus').addEventListener('change', loadTasks);
  document.getElementById('filterPriority').addEventListener('change', loadTasks);

  // My Tasks toggle
  document.getElementById('btnMyTasks').addEventListener('click', () => {
    myTasksActive = !myTasksActive;
    document.getElementById('btnMyTasks').classList.toggle('active', myTasksActive);
    if (myTasksActive) {
      document.getElementById('filterAssignee').value = '';
    }
    loadTasks();
  });

  // Task action buttons (delegated)
  document.getElementById('taskList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    btn.disabled = true;

    try {
      if (action === 'start') {
        await projectService.updateTask(id, { status: 'in_progress' });
        showToast('Task started', 'success');
      } else if (action === 'done') {
        await projectService.updateTask(id, { status: 'done' });
        showToast('Task completed', 'success');
      } else if (action === 'reopen') {
        await projectService.updateTask(id, { status: 'open' });
        showToast('Task reopened', 'info');
      }
      await loadTasks();
    } catch (e) {
      console.error('Task update failed:', e);
      showToast('Failed to update task', 'error');
      btn.disabled = false;
    }
  });
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
