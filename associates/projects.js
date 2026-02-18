/**
 * Associate Projects Page
 * Task board view — all associates can see all tasks and update status.
 */

import { initAssociatePage, showToast } from '../shared/associate-shell.js';
import { projectService } from '../shared/project-service.js';

let currentUser = null;
let allTasks = [];
let myTasksActive = false;
let modalDataLoaded = false;

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
    const currentVal = sel.value;
    // Clear existing options except the first "All People"
    while (sel.options.length > 1) sel.remove(1);
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = currentVal; // preserve selection
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

  // Add Project
  document.getElementById('btnAddProject').addEventListener('click', openAddModal);
  document.getElementById('btnCloseModal').addEventListener('click', closeAddModal);
  document.getElementById('btnCancelModal').addEventListener('click', closeAddModal);
  document.getElementById('addProjectModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddModal();
  });
  document.getElementById('addProjectForm').addEventListener('submit', handleAddProject);

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

// ---- Add Project Modal ----
async function openAddModal() {
  const modal = document.getElementById('addProjectModal');
  modal.classList.remove('hidden');
  document.getElementById('newTitle').focus();

  // Load spaces and users on first open
  if (!modalDataLoaded) {
    modalDataLoaded = true;
    try {
      const [spaces, users] = await Promise.all([
        projectService.getSpaces(),
        projectService.getUsers(),
      ]);

      const spaceSel = document.getElementById('newSpace');
      spaces.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        spaceSel.appendChild(opt);
      });

      const assigneeSel = document.getElementById('newAssignee');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ id: u.id, name: u.display_name });
        opt.textContent = u.display_name;
        assigneeSel.appendChild(opt);
      });
    } catch (e) {
      console.error('Failed to load modal data:', e);
    }
  }
}

function closeAddModal() {
  document.getElementById('addProjectModal').classList.add('hidden');
  document.getElementById('addProjectForm').reset();
}

async function handleAddProject(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitProject');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const title = document.getElementById('newTitle').value.trim();
    const notes = document.getElementById('newNotes').value.trim();
    const priority = document.getElementById('newPriority').value;
    const spaceId = document.getElementById('newSpace').value;
    const assigneeVal = document.getElementById('newAssignee').value;

    let assignedTo = null;
    let assignedName = null;
    if (assigneeVal) {
      const parsed = JSON.parse(assigneeVal);
      assignedTo = parsed.id;
      assignedName = parsed.name;
    }

    await projectService.createTask({
      title,
      notes,
      priority: priority ? parseInt(priority) : null,
      spaceId: spaceId || null,
      assignedTo,
      assignedName,
      status: 'open',
    });

    showToast('Project created', 'success');
    closeAddModal();
    await loadTasks();
    await loadAssignees(); // refresh assignee filter if new name
  } catch (err) {
    console.error('Failed to create project:', err);
    showToast('Failed to create project', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Project';
  }
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
