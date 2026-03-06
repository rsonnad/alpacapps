/**
 * Permitting Tracker - Admin page for 160 Still Forest Dr commercial lodging approval
 * Reads tasks from permit_tasks table, allows status updates and notes
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminShell, showToast } from '../../shared/admin-shell.js';

const PHASE_LABELS = {
  A: 'Phase A: Pre-Development Meeting',
  B: 'Phase B: IDP Submission Documents',
  C: 'Phase C: Physical Infrastructure',
};

const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  completed: 'Done',
  skipped: 'Skipped',
  not_needed: 'N/A',
};

const SUPABASE_STORAGE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/permitting-documents';

let tasks = [];

// =============================================
// INIT
// =============================================
async function init(authState) {
  await loadTasks();
  renderSummary();
  renderPhases();
  renderCostSummary();
}

async function loadTasks() {
  const { data, error } = await supabase
    .from('permit_tasks')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    showToast('Failed to load permit tasks: ' + error.message, 'error');
    return;
  }
  tasks = data || [];
}

// =============================================
// SUMMARY STATS
// =============================================
function renderSummary() {
  const container = document.getElementById('summaryStats');
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const estCost = tasks.reduce((sum, t) => sum + (parseFloat(t.cost_estimate) || 0), 0);

  container.innerHTML = `
    <div class="permit-stat"><div class="label">Progress</div><div class="value">${pct}%</div></div>
    <div class="permit-stat"><div class="label">Completed</div><div class="value done">${done}</div></div>
    <div class="permit-stat"><div class="label">Pending</div><div class="value pending">${pending}</div></div>
    <div class="permit-stat"><div class="label">In Progress</div><div class="value" style="color:#b45309">${inProgress}</div></div>
    <div class="permit-stat"><div class="label">Blocked</div><div class="value blocked">${blocked}</div></div>
    <div class="permit-stat"><div class="label">Est. Cost</div><div class="value">$${estCost.toLocaleString()}</div></div>
  `;
}

// =============================================
// PHASE RENDERING
// =============================================
function renderPhases() {
  const container = document.getElementById('phasesContainer');
  const phases = [...new Set(tasks.map(t => t.phase))];

  container.innerHTML = phases.map(phase => {
    const phaseTasks = tasks.filter(t => t.phase === phase);
    const done = phaseTasks.filter(t => t.status === 'completed').length;
    const total = phaseTasks.length;
    const collapsed = localStorage.getItem(`permit-phase-${phase}`) === 'collapsed';

    return `
      <div class="phase-section${collapsed ? ' collapsed' : ''}" data-phase="${phase}">
        <div class="phase-header" onclick="togglePhase('${phase}')">
          <svg class="phase-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          <h3>${PHASE_LABELS[phase] || 'Phase ' + phase}</h3>
          <span class="phase-progress">${done}/${total}</span>
        </div>
        <div class="phase-body">
          ${phaseTasks.map(t => renderTaskRow(t)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderTaskRow(task) {
  const isDone = task.status === 'completed';
  const costStr = task.cost_estimate ? '$' + parseFloat(task.cost_estimate).toLocaleString() : '';

  return `
    <div class="task-row" data-task-id="${task.id}" onclick="openTaskModal('${task.id}')">
      <div class="task-check ${isDone ? 'done' : ''}" onclick="event.stopPropagation(); toggleTask('${task.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="task-info">
        <div class="task-name"><span class="task-code">${task.task_code}</span>${task.task_name}</div>
        ${task.description ? `<div class="task-desc" title="${escHtml(task.description)}">${escHtml(task.description)}</div>` : ''}
        ${task.storage_paths?.length ? renderDocLinks(task.storage_paths) : ''}
      </div>
      <span class="task-status ${task.status}">${STATUS_LABELS[task.status] || task.status}</span>
      <span class="task-assignee">${task.assignee || ''}</span>
    </div>
  `;
}

function renderDocLinks(paths) {
  const links = paths.map(p => {
    const name = p.split('/').pop();
    const url = `${SUPABASE_STORAGE_URL}/${p}`;
    return `<a href="${url}" target="_blank" onclick="event.stopPropagation()">${name}</a>`;
  });
  return `<div class="doc-links">${links.join('')}</div>`;
}

// =============================================
// COST SUMMARY
// =============================================
function renderCostSummary() {
  const container = document.getElementById('costSummary');
  const estTotal = tasks.reduce((sum, t) => sum + (parseFloat(t.cost_estimate) || 0), 0);
  const actualTotal = tasks.reduce((sum, t) => sum + (parseFloat(t.actual_cost) || 0), 0);

  container.innerHTML = `
    <div class="cost-summary">
      <div class="cost-item"><span class="cost-label">Estimated Total:</span><span class="cost-value">$${estTotal.toLocaleString()}</span></div>
      <div class="cost-item"><span class="cost-label">Actual Spent:</span><span class="cost-value">$${actualTotal.toLocaleString()}</span></div>
    </div>
  `;
}

// =============================================
// INTERACTIONS
// =============================================
window.togglePhase = function(phase) {
  const section = document.querySelector(`.phase-section[data-phase="${phase}"]`);
  if (!section) return;
  section.classList.toggle('collapsed');
  const collapsed = section.classList.contains('collapsed');
  localStorage.setItem(`permit-phase-${phase}`, collapsed ? 'collapsed' : 'open');
};

window.toggleTask = async function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const newStatus = task.status === 'completed' ? 'pending' : 'completed';
  const updates = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
  else updates.completed_at = null;

  const { error } = await supabase.from('permit_tasks').update(updates).eq('id', taskId);
  if (error) {
    showToast('Failed to update task: ' + error.message, 'error');
    return;
  }

  task.status = newStatus;
  task.completed_at = updates.completed_at;
  renderSummary();
  renderPhases();
  renderCostSummary();
  showToast(`${task.task_code} marked ${STATUS_LABELS[newStatus].toLowerCase()}`, 'success');
};

// =============================================
// TASK DETAIL MODAL
// =============================================
window.openTaskModal = function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const container = document.getElementById('taskModalContainer');
  container.innerHTML = `
    <div class="task-modal-overlay" onclick="if(event.target===this)closeTaskModal()">
      <div class="task-modal">
        <div class="task-modal-header">
          <h3>${task.task_code}: ${escHtml(task.task_name)}</h3>
          <button class="task-modal-close" onclick="closeTaskModal()">&times;</button>
        </div>
        <div class="task-modal-body">
          <div class="field">
            <label>Status</label>
            <select id="modalStatus">
              ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${task.status === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Assignee</label>
            <input id="modalAssignee" value="${escHtml(task.assignee || '')}" placeholder="us, engineer, septic designer...">
          </div>
          <div class="field">
            <label>Estimated Cost ($)</label>
            <input id="modalCostEstimate" type="number" step="0.01" value="${task.cost_estimate || ''}">
          </div>
          <div class="field">
            <label>Actual Cost ($)</label>
            <input id="modalActualCost" type="number" step="0.01" value="${task.actual_cost || ''}">
          </div>
          <div class="field">
            <label>Due Date</label>
            <input id="modalDueDate" type="date" value="${task.due_date || ''}">
          </div>
          <div class="field">
            <label>Notes</label>
            <textarea id="modalNotes" rows="3">${escHtml(task.notes || '')}</textarea>
          </div>
          <div class="field">
            <label>Description</label>
            <textarea id="modalDescription" rows="3">${escHtml(task.description || '')}</textarea>
          </div>
          ${task.storage_paths?.length ? `
          <div class="field">
            <label>Stored Documents</label>
            <div class="doc-links">
              ${task.storage_paths.map(p => {
                const name = p.split('/').pop();
                return `<a href="${SUPABASE_STORAGE_URL}/${p}" target="_blank">${name}</a>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>
        <div class="task-modal-footer">
          <button class="btn-cancel" onclick="closeTaskModal()">Cancel</button>
          <button class="btn-save" onclick="saveTaskModal('${taskId}')">Save</button>
        </div>
      </div>
    </div>
  `;
};

window.closeTaskModal = function() {
  document.getElementById('taskModalContainer').innerHTML = '';
};

window.saveTaskModal = async function(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const newStatus = document.getElementById('modalStatus').value;
  const updates = {
    status: newStatus,
    assignee: document.getElementById('modalAssignee').value || null,
    cost_estimate: parseFloat(document.getElementById('modalCostEstimate').value) || null,
    actual_cost: parseFloat(document.getElementById('modalActualCost').value) || null,
    due_date: document.getElementById('modalDueDate').value || null,
    notes: document.getElementById('modalNotes').value || null,
    description: document.getElementById('modalDescription').value || null,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === 'completed' && task.status !== 'completed') {
    updates.completed_at = new Date().toISOString();
  } else if (newStatus !== 'completed') {
    updates.completed_at = null;
  }

  const { error } = await supabase.from('permit_tasks').update(updates).eq('id', taskId);
  if (error) {
    showToast('Failed to save: ' + error.message, 'error');
    return;
  }

  Object.assign(task, updates);
  closeTaskModal();
  renderSummary();
  renderPhases();
  renderCostSummary();
  showToast(`${task.task_code} updated`, 'success');
};

// =============================================
// HELPERS
// =============================================
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================
// BOOT
// =============================================
initAdminShell({
  pageId: 'permitting',
  section: 'admin',
  requiredPermission: 'view_settings',
  onReady: init,
});
