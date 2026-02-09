/**
 * Admin Hours Page - Manage associate time entries, rates, and payments
 */
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { supabase } from '../../shared/supabase.js';
import { hoursService, HoursService } from '../../shared/hours-service.js';
import { PAYMENT_METHOD_LABELS } from '../../shared/accounting-service.js';
import { payoutService } from '../../shared/payout-service.js';

// State
let associates = [];
let entries = [];
let selectedIds = new Set();
let editingEntryId = null;
let initialized = false;

// =============================================
// INITIALIZATION
// =============================================
initAdminPage({
  activeTab: 'hours',
  onReady: async () => {
    if (initialized) return;
    initialized = true;
    setDefaultDates();
    setupEventListeners();
    await loadAll();
  }
});

// =============================================
// DATE HELPERS
// =============================================
function getToday() { return new Date().toISOString().split('T')[0]; }

function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function getFirstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getFirstOfLastMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getLastDayOfLastMonth() {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().split('T')[0];
}

function setDefaultDates() {
  document.getElementById('filterFrom').value = getFirstOfMonth();
  document.getElementById('filterTo').value = getToday();
  document.getElementById('entryDate').value = getToday();
}

// =============================================
// DATA LOADING
// =============================================
async function loadAll() {
  await Promise.all([loadAssociates(), loadEntries()]);
}

async function loadAssociates() {
  try {
    associates = await hoursService.getAllAssociates();
    renderAssociateFilter();
    renderAssociateConfig();
    renderEntryAssociateSelect();
    await loadEligibleUsers();
  } catch (err) {
    console.error('Failed to load associates:', err);
    showToast('Failed to load associates', 'error');
  }
}

async function loadEligibleUsers() {
  try {
    const eligible = await hoursService.getEligibleUsers();
    const sel = document.getElementById('addAssocUser');
    sel.innerHTML = '<option value="">Select a user...</option>';
    for (const u of eligible) {
      const name = u.display_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
      const signedUp = u.auth_user_id ? '' : ' (invited, not signed up)';
      const role = u.role ? ` [${u.role}]` : '';
      sel.innerHTML += `<option value="${u.id}">${escapeHtml(name)}${role}${signedUp}</option>`;
    }
    // Hide the add button if no one left to add
    document.getElementById('btnShowAddAssoc').style.display = eligible.length ? '' : 'none';
  } catch (err) {
    console.error('Failed to load eligible users:', err);
  }
}

async function loadEntries() {
  try {
    const filters = getFilters();
    entries = await hoursService.getAllEntries(filters);
    selectedIds.clear();
    renderEntries();
    renderSummary();
    updateMarkPaidButton();
  } catch (err) {
    console.error('Failed to load entries:', err);
    showToast('Failed to load entries', 'error');
  }
}

function getFilters() {
  const f = {};
  const assocId = document.getElementById('filterAssociate').value;
  if (assocId) f.associateId = assocId;
  const from = document.getElementById('filterFrom').value;
  if (from) f.dateFrom = from;
  const to = document.getElementById('filterTo').value;
  if (to) f.dateTo = to;
  const status = document.getElementById('filterStatus').value;
  if (status === 'paid') f.isPaid = true;
  else if (status === 'unpaid') f.isPaid = false;
  return f;
}

// =============================================
// RENDERING
// =============================================
function renderAssociateFilter() {
  const sel = document.getElementById('filterAssociate');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Associates</option>';
  for (const a of associates) {
    const name = getAssocName(a);
    sel.innerHTML += `<option value="${a.id}">${name}</option>`;
  }
  sel.value = current;
}

function renderEntryAssociateSelect() {
  const sel = document.getElementById('entryAssociate');
  sel.innerHTML = '';
  for (const a of associates) {
    const name = getAssocName(a);
    sel.innerHTML += `<option value="${a.id}">${name}</option>`;
  }
}

function renderSummary() {
  let totalMins = 0, totalAmt = 0, paidAmt = 0, unpaidAmt = 0;
  for (const e of entries) {
    const mins = parseFloat(e.duration_minutes) || 0;
    totalMins += mins;
    const amt = (mins / 60) * parseFloat(e.hourly_rate);
    totalAmt += amt;
    if (e.is_paid) paidAmt += amt;
    else unpaidAmt += amt;
  }
  document.getElementById('sumHours').textContent = HoursService.formatHoursDecimal(totalMins);
  document.getElementById('sumEarned').textContent = HoursService.formatCurrency(totalAmt);
  document.getElementById('sumPaid').textContent = HoursService.formatCurrency(paidAmt);
  document.getElementById('sumUnpaid').textContent = HoursService.formatCurrency(unpaidAmt);
}

function renderEntries() {
  const tbody = document.getElementById('entriesBody');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No time entries found for this period.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const assoc = e.associate;
    const name = assoc ? getAssocName(assoc) : '?';
    const date = e.clock_in.split('T')[0];
    const clockIn = HoursService.formatTime(e.clock_in);
    const clockOut = e.clock_out ? HoursService.formatTime(e.clock_out) : '<span class="badge active">Active</span>';
    const mins = parseFloat(e.duration_minutes) || 0;
    const hours = HoursService.formatDuration(mins);
    const rate = HoursService.formatCurrency(e.hourly_rate);
    const amount = HoursService.formatCurrency((mins / 60) * parseFloat(e.hourly_rate));
    const status = e.clock_out === null ? '' : (e.is_paid ? '<span class="badge paid">Paid</span>' : '<span class="badge unpaid">Unpaid</span>');
    const desc = e.description ? escapeHtml(e.description.substring(0, 60)) : '<span style="color:var(--text-muted)">—</span>';
    const spaceName = e.space?.name || '<span style="color:var(--text-muted)">—</span>';
    const manualTag = e.is_manual ? ' <span style="font-size:0.6rem;background:#eef2ff;color:#6366f1;padding:0.1rem 0.3rem;border-radius:3px;font-weight:700;">M</span>' : '';
    const loc = formatLocLink(e);
    const checked = selectedIds.has(e.id) ? 'checked' : '';
    const canCheck = e.clock_out && !e.is_paid;

    return `<tr>
      <td class="cb">${canCheck ? `<input type="checkbox" class="entry-cb" data-id="${e.id}" ${checked}>` : ''}</td>
      <td>${escapeHtml(name)}${manualTag}</td>
      <td>${HoursService.formatDate(date)}</td>
      <td>${clockIn}</td>
      <td>${clockOut}</td>
      <td>${hours}</td>
      <td>${rate}</td>
      <td><strong>${amount}</strong></td>
      <td>${status}</td>
      <td title="${escapeHtml(e.description || '')}">${desc}</td>
      <td>${spaceName}</td>
      <td>${loc}</td>
      <td><button class="btn-small" data-edit="${e.id}" style="font-size:0.7rem;padding:0.2rem 0.4rem;">Edit</button></td>
    </tr>`;
  }).join('');
}

function renderAssociateConfig() {
  const container = document.getElementById('associateConfig');
  if (!associates.length) {
    container.innerHTML = '<div class="empty-state">No associates set up yet. Click "+ Add Associate" above to add users for time tracking.</div>';
    return;
  }

  container.innerHTML = associates.map(a => {
    const name = getAssocName(a);
    const role = a.app_user?.role || 'unknown';
    const method = a.payment_method ? (PAYMENT_METHOD_LABELS[a.payment_method] || a.payment_method) : 'Not set';
    const handle = a.payment_handle || '';
    const rate = parseFloat(a.hourly_rate) || 0;

    return `<div class="assoc-card" data-profile-id="${a.id}">
      <h4>
        ${escapeHtml(name)}
        <span class="role-tag ${role}">${role}</span>
      </h4>
      <p class="detail">${escapeHtml(a.app_user?.email || '')}</p>
      <p class="detail">Payment: ${escapeHtml(method)}${handle ? ' — ' + escapeHtml(handle) : ''}</p>
      <div class="rate-highlight">
        <span class="rate-value">$${rate.toFixed(2)}</span>
        <span class="rate-unit">/ hour</span>
      </div>
      <div class="rate-row">
        <label style="font-size:0.75rem;font-weight:600;white-space:nowrap;">Set rate:</label>
        <input type="number" step="0.50" min="0" value="${rate}" class="rate-input" data-id="${a.id}">
        <button class="save-btn" data-save-rate="${a.id}">Save</button>
      </div>
    </div>`;
  }).join('');
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Filters
  document.getElementById('filterAssociate').addEventListener('change', loadEntries);
  document.getElementById('filterFrom').addEventListener('change', loadEntries);
  document.getElementById('filterTo').addEventListener('change', loadEntries);
  document.getElementById('filterStatus').addEventListener('change', loadEntries);

  // Presets
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      const from = document.getElementById('filterFrom');
      const to = document.getElementById('filterTo');
      if (p === 'week') { from.value = getMonday(); to.value = getToday(); }
      else if (p === 'month') { from.value = getFirstOfMonth(); to.value = getToday(); }
      else if (p === 'last-month') { from.value = getFirstOfLastMonth(); to.value = getLastDayOfLastMonth(); }
      else if (p === 'all') { from.value = ''; to.value = ''; }
      loadEntries();
    });
  });

  // Select all checkbox
  document.getElementById('selectAll').addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.entry-cb').forEach(cb => {
      cb.checked = checked;
      if (checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
    updateMarkPaidButton();
  });

  // Individual checkboxes (delegated)
  document.getElementById('entriesBody').addEventListener('change', (e) => {
    if (e.target.classList.contains('entry-cb')) {
      if (e.target.checked) selectedIds.add(e.target.dataset.id);
      else selectedIds.delete(e.target.dataset.id);
      updateMarkPaidButton();
    }
  });

  // Edit entry button (delegated)
  document.getElementById('entriesBody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) openEditEntry(editBtn.dataset.edit);
  });

  // Mark paid
  document.getElementById('btnMarkPaid').addEventListener('click', openPaidModal);
  document.getElementById('paidCancel').addEventListener('click', () => document.getElementById('paidModal').classList.remove('open'));
  document.getElementById('paidConfirm').addEventListener('click', confirmMarkPaid);

  // Add entry
  document.getElementById('btnAddEntry').addEventListener('click', openAddEntry);
  document.getElementById('entryCancel').addEventListener('click', () => document.getElementById('addEntryModal').classList.remove('open'));
  document.getElementById('entryConfirm').addEventListener('click', confirmSaveEntry);

  // Add Associate
  document.getElementById('btnShowAddAssoc').addEventListener('click', () => {
    const form = document.getElementById('addAssocForm');
    form.style.display = form.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('btnDoAddAssoc').addEventListener('click', async () => {
    const userId = document.getElementById('addAssocUser').value;
    const rate = parseFloat(document.getElementById('addAssocRate').value) || 0;
    if (!userId) { showToast('Please select a user', 'warning'); return; }
    const btn = document.getElementById('btnDoAddAssoc');
    btn.disabled = true;
    try {
      await hoursService.createProfile(userId, { hourlyRate: rate });
      showToast('Associate added!', 'success');
      document.getElementById('addAssocForm').style.display = 'none';
      document.getElementById('addAssocRate').value = '0';
      await loadAssociates();
      await loadEntries(); // refresh entries table too
    } catch (err) {
      showToast('Failed to add associate: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Save rate buttons (delegated)
  document.getElementById('associateConfig').addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-save-rate]');
    if (!saveBtn) return;
    const profileId = saveBtn.dataset.saveRate;
    const input = document.querySelector(`.rate-input[data-id="${profileId}"]`);
    const rate = parseFloat(input.value);
    if (isNaN(rate) || rate < 0) { showToast('Invalid rate', 'error'); return; }
    try {
      await hoursService.updateProfile(profileId, { hourly_rate: rate });
      showToast('Rate updated', 'success');
      await loadAssociates();
    } catch (err) {
      showToast('Failed to update rate: ' + err.message, 'error');
    }
  });
}

function updateMarkPaidButton() {
  const btn = document.getElementById('btnMarkPaid');
  btn.disabled = selectedIds.size === 0;
  btn.textContent = selectedIds.size > 0
    ? `Mark ${selectedIds.size} as Paid`
    : 'Mark Selected as Paid';
}

// =============================================
// MARK PAID FLOW
// =============================================
function openPaidModal() {
  if (selectedIds.size === 0) return;
  // Compute summary of selected entries
  let totalMins = 0, totalAmt = 0;
  const selectedEntries = entries.filter(e => selectedIds.has(e.id));
  for (const e of selectedEntries) {
    const mins = parseFloat(e.duration_minutes) || 0;
    totalMins += mins;
    totalAmt += (mins / 60) * parseFloat(e.hourly_rate);
  }

  // Pre-select payment method from associate's preference if all same associate
  const assocIds = new Set(selectedEntries.map(e => e.associate_id));
  if (assocIds.size === 1) {
    const assoc = associates.find(a => a.id === [...assocIds][0]);
    if (assoc?.payment_method) {
      document.getElementById('paidMethod').value = assoc.payment_method;
    }
  }

  document.getElementById('paidModalSummary').textContent =
    `${selectedIds.size} entries — ${HoursService.formatDuration(totalMins)} — ${HoursService.formatCurrency(totalAmt)}`;
  document.getElementById('paidNotes').value = '';
  updatePaypalPayoutInfo();
  document.getElementById('paidModal').classList.add('open');

  // Listen for payment method changes to toggle PayPal info
  document.getElementById('paidMethod').addEventListener('change', updatePaypalPayoutInfo);
}

/**
 * Show/hide PayPal payout info box based on selected method
 */
function updatePaypalPayoutInfo() {
  const method = document.getElementById('paidMethod').value;
  const paypalInfo = document.getElementById('paypalPayoutInfo');
  const confirmBtn = document.getElementById('paidConfirm');

  if (method === 'paypal') {
    // Find associate's PayPal email
    const selectedEntries = entries.filter(e => selectedIds.has(e.id));
    const assocIds = new Set(selectedEntries.map(e => e.associate_id));

    if (assocIds.size === 1) {
      const assoc = associates.find(a => a.id === [...assocIds][0]);
      const handle = assoc?.payment_handle;
      if (handle) {
        document.getElementById('paypalRecipientInfo').textContent = `Sends instantly to ${handle}`;
      } else {
        document.getElementById('paypalRecipientInfo').innerHTML =
          '<span style="color:var(--error,#ef4444);">No PayPal email configured for this associate. Set it in their profile first.</span>';
      }
    } else {
      document.getElementById('paypalRecipientInfo').textContent =
        'Multiple associates selected — PayPal payouts will be sent to each associate\'s configured email.';
    }
    paypalInfo.style.display = 'block';
    confirmBtn.textContent = 'Send via PayPal';
  } else {
    paypalInfo.style.display = 'none';
    confirmBtn.textContent = 'Confirm Payment';
  }
}

async function confirmMarkPaid() {
  const method = document.getElementById('paidMethod').value;
  const notes = document.getElementById('paidNotes').value.trim();
  const btn = document.getElementById('paidConfirm');
  btn.disabled = true;

  // If PayPal selected, send real payout via PayPal Payouts API
  if (method === 'paypal') {
    btn.textContent = 'Sending via PayPal...';
    try {
      // Group entries by associate for multi-associate payouts
      const selectedEntries = entries.filter(e => selectedIds.has(e.id));
      const byAssociate = {};
      for (const entry of selectedEntries) {
        if (!byAssociate[entry.associate_id]) {
          byAssociate[entry.associate_id] = { entries: [], totalMins: 0, totalAmt: 0 };
        }
        const mins = parseFloat(entry.duration_minutes) || 0;
        byAssociate[entry.associate_id].entries.push(entry);
        byAssociate[entry.associate_id].totalMins += mins;
        byAssociate[entry.associate_id].totalAmt += (mins / 60) * parseFloat(entry.hourly_rate);
      }

      let successCount = 0;
      let failCount = 0;

      for (const [assocId, data] of Object.entries(byAssociate)) {
        const amount = Math.round(data.totalAmt * 100) / 100;
        const entryIds = data.entries.map(e => e.id);

        const result = await payoutService.sendPayPalPayout(assocId, amount, entryIds, notes);

        if (result.success) {
          // Mark entries as paid in hours service (creates ledger entry too)
          await hoursService.markPaid(entryIds, { paymentMethod: 'paypal', notes: `PayPal payout${result.test_mode ? ' [TEST]' : ''}: ${result.message || ''}` });
          successCount++;
          showToast(result.message || `Sent $${amount.toFixed(2)} via PayPal`, 'success');
        } else {
          failCount++;
          showToast(`PayPal payout failed: ${result.error}`, 'error');
        }
      }

      if (successCount > 0) {
        document.getElementById('paidModal').classList.remove('open');
        await loadEntries();
      }
    } catch (err) {
      showToast('PayPal payout failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send via PayPal';
    }
    return;
  }

  // Non-PayPal: standard mark-as-paid flow (manual recording)
  btn.textContent = 'Processing...';
  try {
    const result = await hoursService.markPaid([...selectedIds], { paymentMethod: method, notes });
    showToast(`Marked ${result.entriesUpdated} entries as paid — ${HoursService.formatCurrency(result.totalAmount)}`, 'success');
    document.getElementById('paidModal').classList.remove('open');
    await loadEntries();
  } catch (err) {
    showToast('Failed to mark paid: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Payment';
  }
}

// =============================================
// ADD / EDIT ENTRY
// =============================================
function openAddEntry() {
  editingEntryId = null;
  document.getElementById('addEntryTitle').textContent = 'Add Manual Entry';
  document.getElementById('entryDate').value = getToday();
  document.getElementById('entryClockIn').value = '';
  document.getElementById('entryClockOut').value = '';
  document.getElementById('entryDescription').value = '';
  // Pre-select current filter associate
  const filterAssoc = document.getElementById('filterAssociate').value;
  if (filterAssoc) document.getElementById('entryAssociate').value = filterAssoc;
  document.getElementById('addEntryModal').classList.add('open');
}

function openEditEntry(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;
  document.getElementById('addEntryTitle').textContent = 'Edit Entry';
  document.getElementById('entryDate').value = entry.clock_in.split('T')[0];
  document.getElementById('entryClockIn').value = new Date(entry.clock_in).toTimeString().slice(0, 5);
  document.getElementById('entryClockOut').value = entry.clock_out ? new Date(entry.clock_out).toTimeString().slice(0, 5) : '';
  document.getElementById('entryDescription').value = entry.description || '';
  document.getElementById('entryAssociate').value = entry.associate_id;
  document.getElementById('addEntryModal').classList.add('open');
}

async function confirmSaveEntry() {
  const assocId = document.getElementById('entryAssociate').value;
  const date = document.getElementById('entryDate').value;
  const clockInTime = document.getElementById('entryClockIn').value;
  const clockOutTime = document.getElementById('entryClockOut').value;
  const description = document.getElementById('entryDescription').value.trim();

  if (!assocId || !date || !clockInTime) {
    showToast('Associate, date, and clock-in time are required', 'warning');
    return;
  }

  const clockIn = `${date}T${clockInTime}:00`;
  const clockOut = clockOutTime ? `${date}T${clockOutTime}:00` : null;

  // Handle overnight: if clock out is before clock in, assume next day
  let clockOutAdjusted = clockOut;
  if (clockOut && clockOut < clockIn) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    clockOutAdjusted = `${nextDay.toISOString().split('T')[0]}T${clockOutTime}:00`;
  }

  const btn = document.getElementById('entryConfirm');
  btn.disabled = true;

  try {
    if (editingEntryId) {
      await hoursService.updateEntry(editingEntryId, {
        clock_in: clockIn,
        clock_out: clockOutAdjusted,
        description
      });
      showToast('Entry updated', 'success');
    } else {
      await hoursService.createManualEntry(assocId, {
        clockIn,
        clockOut: clockOutAdjusted,
        description
      });
      showToast('Entry added', 'success');
    }
    document.getElementById('addEntryModal').classList.remove('open');
    await loadEntries();
  } catch (err) {
    showToast('Failed to save entry: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// =============================================
// HELPERS
// =============================================
function getAssocName(assocOrProfile) {
  const u = assocOrProfile.app_user || assocOrProfile;
  return u?.display_name || `${u?.first_name || ''} ${u?.last_name || ''}`.trim() || u?.email || '?';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatLocLink(entry) {
  const lat = entry.clock_in_lat || entry.clock_out_lat;
  const lng = entry.clock_in_lng || entry.clock_out_lng;
  if (!lat || !lng) return '<span style="color:var(--text-muted)">—</span>';
  return `<a class="loc-link" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" title="${lat}, ${lng}">Map</a>`;
}
