/**
 * Admin Applications Review (AA17 #22 + #23)
 *
 * Lists rental_applications, lets admin filter, view detail, leave
 * internal notes, request more info, decline (with public reason), or
 * approve. Wires into the status-transition trigger and the
 * applicant-facing status page (/rentals/status.html?token=...).
 */
import { supabase } from '../shared/supabase.js';
import { initAdminPage, showToast } from '../shared/admin-shell.js';

let allApps = [];
let activeAppId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'applications',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async () => {
      bindEvents();
      await loadApplications();
    },
  });
});

function bindEvents() {
  document.getElementById('refreshBtn')?.addEventListener('click', () => loadApplications());
  document.getElementById('searchInput')?.addEventListener('input', renderList);
  document.getElementById('statusFilter')?.addEventListener('change', renderList);
}

async function loadApplications() {
  try {
    const { data, error } = await supabase
      .from('rental_applications')
      .select(`
        id, application_status, submitted_at, created_at, reviewed_at, reviewed_by,
        admin_notes, denial_reason, applicant_visible_decline_reason,
        needs_more_info_message, needs_more_info_requested_at,
        approved_space_id, approved_rate, approved_rate_term, approved_move_in,
        desired_move_in, desired_term, desired_space_id, status_token, status_history,
        assigned_staff_id,
        person:person_id (id, first_name, last_name, email, phone),
        approved_space:approved_space_id (id, name),
        desired_space:desired_space_id (id, name)
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;
    allApps = data || [];
    renderList();
    if (activeAppId) renderDetail(allApps.find(a => a.id === activeAppId));
  } catch (err) {
    console.error('Failed to load applications:', err);
    showToast('Failed to load applications: ' + err.message, 'error');
  }
}

function renderList() {
  const filter = document.getElementById('statusFilter').value;
  const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  let items = allApps;
  if (filter) items = items.filter(a => a.application_status === filter);
  if (q) {
    items = items.filter(a => {
      const name = `${a.person?.first_name || ''} ${a.person?.last_name || ''}`.toLowerCase();
      const email = (a.person?.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }
  const list = document.getElementById('appsList');
  if (items.length === 0) {
    list.innerHTML = '<p style="padding:1rem;color:#888;text-align:center;font-size:0.9rem;">No applications match.</p>';
    return;
  }
  list.innerHTML = items.map(a => {
    const name = `${a.person?.first_name || '?'} ${a.person?.last_name || ''}`.trim();
    const when = a.submitted_at || a.created_at;
    const dateStr = when ? new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `<div class="app-row ${a.id === activeAppId ? 'active' : ''}" data-id="${a.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="app-row-name">${esc(name)}</span>
        <span class="status-pill status-${a.application_status}">${esc(a.application_status || '')}</span>
      </div>
      <span class="app-row-meta">${esc(a.person?.email || '')} · ${dateStr}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.app-row').forEach(el => {
    el.addEventListener('click', () => {
      activeAppId = el.dataset.id;
      list.querySelectorAll('.app-row').forEach(x => x.classList.toggle('active', x === el));
      renderDetail(allApps.find(a => a.id === activeAppId));
    });
  });
}

function renderDetail(app) {
  const wrap = document.getElementById('appsDetail');
  if (!app) {
    wrap.innerHTML = '<p style="color:#888;text-align:center;padding:2rem;">Select an application to review.</p>';
    return;
  }
  const name = `${app.person?.first_name || ''} ${app.person?.last_name || ''}`.trim();
  const statusUrl = app.status_token ? `https://alpacaplayhouse.com/rentals/status.html?token=${app.status_token}` : '';
  const historyHtml = Array.isArray(app.status_history) && app.status_history.length
    ? '<ul>' + app.status_history.map(h => `<li>${esc(h.from || '∅')} → ${esc(h.to || '')} · ${new Date(h.at).toLocaleString()}</li>`).join('') + '</ul>'
    : '<em style="color:#888;">No prior transitions.</em>';

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
      <div>
        <h2 style="font-size:1.2rem;color:#2d3024;margin:0;">${esc(name)}</h2>
        <p style="color:#666;font-size:0.85rem;margin-top:2px;">
          <a href="mailto:${esc(app.person?.email || '')}" style="color:#3d8b7a;">${esc(app.person?.email || '')}</a>
          ${app.person?.phone ? ' · ' + esc(app.person.phone) : ''}
        </p>
      </div>
      <span class="status-pill status-${app.application_status}">${esc(app.application_status || '')}</span>
    </div>

    <div style="margin-top:1rem;">
      <div class="field"><span class="field-label">Desired space</span><span class="field-value">${esc(app.desired_space?.name || '—')}</span></div>
      <div class="field"><span class="field-label">Desired move-in</span><span class="field-value">${esc(app.desired_move_in || '—')}</span></div>
      <div class="field"><span class="field-label">Desired term</span><span class="field-value">${esc(app.desired_term || '—')}</span></div>
      <div class="field"><span class="field-label">Approved space</span><span class="field-value">${esc(app.approved_space?.name || '—')}</span></div>
      <div class="field"><span class="field-label">Approved rate</span><span class="field-value">${app.approved_rate ? '$' + app.approved_rate + ' / ' + (app.approved_rate_term || 'month') : '—'}</span></div>
      <div class="field"><span class="field-label">Submitted at</span><span class="field-value">${app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</span></div>
      <div class="field"><span class="field-label">Reviewed at</span><span class="field-value">${app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : '—'}</span></div>
      ${statusUrl ? `<div class="field"><span class="field-label">Applicant status URL</span><span class="field-value"><a href="${esc(statusUrl)}" target="_blank" rel="noopener">${esc(statusUrl)}</a></span></div>` : ''}
    </div>

    <h3 style="margin-top:1.25rem;font-size:0.95rem;color:#2d3024;">Internal notes (admin-only)</h3>
    <textarea class="notes" id="adminNotes" placeholder="Internal notes — not visible to the applicant.">${esc(app.admin_notes || '')}</textarea>

    <h3 style="margin-top:1.25rem;font-size:0.95rem;color:#2d3024;">Applicant-visible decline reason</h3>
    <textarea class="notes" id="declineReason" placeholder="If you decline, this message is shown on the applicant's status page.">${esc(app.applicant_visible_decline_reason || '')}</textarea>

    <h3 style="margin-top:1.25rem;font-size:0.95rem;color:#2d3024;">Needs-more-info message</h3>
    <textarea class="notes" id="moreInfoMessage" placeholder="What do you need from them? Shown on their status page.">${esc(app.needs_more_info_message || '')}</textarea>

    <div class="actions">
      <button id="saveNotesBtn">Save Notes</button>
      <button id="moveToReviewBtn" ${['under_review','approved','declined','archived'].includes(app.application_status) ? 'disabled' : ''}>Mark Under Review</button>
      <button class="warn" id="needsMoreInfoBtn">Request More Info</button>
      <button class="primary" id="approveBtn" ${['approved','declined','leased','archived'].includes(app.application_status) ? 'disabled' : ''}>Approve</button>
      <button class="danger" id="declineBtn" ${['approved','declined','leased','archived'].includes(app.application_status) ? 'disabled' : ''}>Decline</button>
      <button id="archiveBtn">Archive</button>
    </div>

    <div class="history">
      <strong>Status history</strong>
      ${historyHtml}
    </div>
  `;

  document.getElementById('saveNotesBtn').addEventListener('click', () => saveFields(app.id));
  document.getElementById('moveToReviewBtn').addEventListener('click', () => transition(app.id, 'under_review'));
  document.getElementById('needsMoreInfoBtn').addEventListener('click', () => requestMoreInfo(app.id));
  document.getElementById('approveBtn').addEventListener('click', () => transition(app.id, 'approved'));
  document.getElementById('declineBtn').addEventListener('click', () => declineApp(app.id));
  document.getElementById('archiveBtn').addEventListener('click', () => transition(app.id, 'archived'));
}

async function saveFields(id, extra = {}) {
  try {
    const updates = {
      admin_notes: document.getElementById('adminNotes').value,
      applicant_visible_decline_reason: document.getElementById('declineReason').value,
      needs_more_info_message: document.getElementById('moreInfoMessage').value,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    const { error } = await supabase.from('rental_applications').update(updates).eq('id', id);
    if (error) throw error;
    showToast('Saved.', 'success');
    await loadApplications();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

async function transition(id, newStatus) {
  if (!confirm(`Move this application to "${newStatus}"?`)) return;
  try {
    // Save fields first so the trigger sees them in this transition.
    await saveFields(id, {
      application_status: newStatus,
      reviewed_at: new Date().toISOString(),
    });
  } catch (err) {
    showToast('Transition failed: ' + err.message, 'error');
  }
}

async function requestMoreInfo(id) {
  const msg = document.getElementById('moreInfoMessage').value.trim();
  if (!msg) { showToast('Write a message describing what you need.', 'error'); return; }
  await saveFields(id, {
    application_status: 'needs_more_info',
    needs_more_info_requested_at: new Date().toISOString(),
  });
}

async function declineApp(id) {
  const reason = document.getElementById('declineReason').value.trim();
  if (!reason) {
    if (!confirm('No applicant-visible reason was entered. Decline anyway?')) return;
  }
  await saveFields(id, {
    application_status: 'declined',
    denial_reason: document.getElementById('adminNotes').value || reason,
    reviewed_at: new Date().toISOString(),
  });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
