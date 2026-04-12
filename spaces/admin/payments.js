/**
 * Admin Payments Page — View unpaid hours per associate and pay via Stripe Connect
 */
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { supabase } from '../../shared/supabase.js';
import { payoutService } from '../../shared/payout-service.js';
import { hoursService } from '../../shared/hours-service.js';
import { isDemoUser, redactString } from '../../shared/demo-redact.js';
import { AUSTIN_TIMEZONE } from '../../shared/timezone.js';

// State
let associates = [];
let unpaidByAssociate = {};  // associateId -> [entries]
let recentPayouts = [];
let stripeBalance = null;
let payingAssociateId = null;
let initialized = false;

// =============================================
// INITIALIZATION
// =============================================
initAdminPage({
  activeTab: 'payments',
  section: 'staff',
  onReady: async () => {
    if (initialized) return;
    initialized = true;
    setupEventListeners();
    await loadAll();
  }
});

function setupEventListeners() {
  document.getElementById('payCancel').addEventListener('click', closePayModal);
  document.getElementById('payConfirm').addEventListener('click', confirmPay);
  document.getElementById('btnPayAll').addEventListener('click', payAll);
  // Close modal on backdrop click
  document.getElementById('payModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePayModal();
  });
}

// =============================================
// DATA LOADING
// =============================================
async function loadAll() {
  await Promise.all([loadAssociatesAndEntries(), loadStripeBalance(), loadRecentPayouts()]);
}

async function loadAssociatesAndEntries() {
  // Load active associates
  const allAssociates = await hoursService.getAllAssociates();
  associates = allAssociates.filter(a => a.is_active);

  // Load unpaid time entries for all associates
  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*, associate:associate_id(id, app_user_id, hourly_rate, stripe_connect_account_id, app_user:app_user_id(display_name, first_name, last_name))')
    .eq('is_paid', false)
    .not('clock_out', 'is', null)
    .order('clock_in', { ascending: true });

  if (error) {
    console.error('Failed to load entries:', error);
    showToast('Failed to load time entries', 'error');
    return;
  }

  // Group by associate
  unpaidByAssociate = {};
  for (const entry of (entries || [])) {
    const aid = entry.associate_id;
    if (!unpaidByAssociate[aid]) unpaidByAssociate[aid] = [];
    unpaidByAssociate[aid].push(entry);
  }

  renderAssociateCards();
}

async function loadStripeBalance() {
  const result = await payoutService.testStripeConnection();
  const el = document.getElementById('stripeBalance');
  const note = document.getElementById('balanceNote');

  if (result.success) {
    // Parse balance from message
    const match = result.message.match(/Balance: \$([\d,.]+)/);
    if (match) {
      stripeBalance = parseFloat(match[1].replace(',', ''));
      el.textContent = `$${stripeBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      note.textContent = result.message.includes('Live') ? 'Live mode' : 'Test mode';
    } else {
      el.textContent = '--';
      note.textContent = result.message;
    }
  } else {
    el.textContent = 'Error';
    el.style.color = '#dc2626';
    note.textContent = result.error || 'Could not connect to Stripe';
    document.getElementById('balanceBanner').style.background = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
    document.getElementById('balanceBanner').style.borderColor = '#fecaca';
  }
}

async function loadRecentPayouts() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const from = thirtyDaysAgo.toISOString();
  const to = new Date().toISOString();

  try {
    recentPayouts = await payoutService.getPayoutsForPeriod(from, to);
  } catch (e) {
    console.error('Failed to load payouts:', e);
    recentPayouts = [];
  }

  renderRecentPayouts();
}

// =============================================
// RENDERING
// =============================================
function renderAssociateCards() {
  const grid = document.getElementById('associateGrid');
  const demo = isDemoUser();

  // Sort: associates with unpaid entries first, then alphabetically
  const sorted = [...associates].sort((a, b) => {
    const aUnpaid = (unpaidByAssociate[a.id] || []).length;
    const bUnpaid = (unpaidByAssociate[b.id] || []).length;
    if (aUnpaid > 0 && bUnpaid === 0) return -1;
    if (bUnpaid > 0 && aUnpaid === 0) return 1;
    const aName = a.app_user?.display_name || '';
    const bName = b.app_user?.display_name || '';
    return aName.localeCompare(bName);
  });

  let totalUnpaidAll = 0;
  const rows = [];

  for (const assoc of sorted) {
    const entries = unpaidByAssociate[assoc.id] || [];
    const name = demo ? redactString(assoc.app_user?.display_name || 'Unknown') : (assoc.app_user?.display_name || 'Unknown');
    const hasConnect = !!assoc.stripe_connect_account_id;
    const rate = parseFloat(assoc.hourly_rate) || 0;

    let totalHours = 0;
    let totalAmount = 0;
    for (const e of entries) {
      const mins = parseFloat(e.duration_minutes) || 0;
      const entryRate = parseFloat(e.hourly_rate) || rate;
      totalHours += mins / 60;
      totalAmount += (mins / 60) * entryRate;
    }
    totalUnpaidAll += totalAmount;

    const row = document.createElement('div');
    row.className = `pay-row${entries.length > 0 ? ' has-unpaid' : ''}`;

    // Right side: either unpaid summary or "all paid"
    let rightHtml;
    if (entries.length === 0) {
      rightHtml = `
        <span class="paid-check">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          All paid
        </span>
        <span class="rate-tag">$${rate.toFixed(2)}/hr</span>
      `;
    } else {
      rightHtml = `
        <span class="unpaid-meta">${entries.length} entries &middot; ${totalHours.toFixed(1)}h</span>
        <span class="unpaid-amount">$${totalAmount.toFixed(2)}</span>
        <span class="rate-tag">$${rate.toFixed(2)}/hr</span>
        <span class="expand-icon">&#9654;</span>
      `;
    }

    row.innerHTML = `
      <div class="pay-row-header">
        <div class="row-left">
          <h3>${name}</h3>
          <span class="connect-badge ${hasConnect ? 'connected' : 'not-connected'}">
            ${hasConnect ? 'Stripe' : 'No Stripe'}
          </span>
        </div>
        <div class="row-right">
          ${rightHtml}
        </div>
      </div>
    `;

    // Expandable detail with entries table + pay button
    if (entries.length > 0) {
      let detailHtml = `<div class="pay-row-detail"><table class="unpaid-table">
        <thead><tr>
          <th class="cb"><input type="checkbox" data-select-all="${assoc.id}" checked></th>
          <th>Date</th>
          <th>Hours</th>
          <th>Amount</th>
          <th>Description</th>
          <th></th>
        </tr></thead><tbody>`;

      for (const e of entries) {
        const mins = parseFloat(e.duration_minutes) || 0;
        const hrs = mins / 60;
        const entryRate = parseFloat(e.hourly_rate) || rate;
        const amt = hrs * entryRate;
        const date = new Date(e.clock_in).toLocaleDateString('en-US', { timeZone: AUSTIN_TIMEZONE, month: 'short', day: 'numeric' });
        const desc = e.description || '';

        detailHtml += `<tr>
          <td class="cb"><input type="checkbox" data-entry-id="${e.id}" data-assoc-id="${assoc.id}" checked></td>
          <td>${date}</td>
          <td>${hrs.toFixed(2)}h</td>
          <td>$${amt.toFixed(2)}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${desc.replace(/"/g, '&quot;')}">${desc}</td>
          <td class="row-actions">
            <button class="btn-icon btn-mark-paid-single" data-entry-id="${e.id}" title="Mark as paid (no Stripe)">&#10003;</button>
            <button class="btn-icon btn-delete-entry" data-entry-id="${e.id}" title="Delete entry">&times;</button>
          </td>
        </tr>`;
      }

      detailHtml += `</tbody></table>
        <div class="pay-row-actions">
          <button class="btn-mark-paid-bulk" data-mark-assoc="${assoc.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Mark Selected as Paid
          </button>
          <button class="btn-delete-selected" data-delete-assoc="${assoc.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            Delete Selected
          </button>
          <button class="btn-pay" data-pay-assoc="${assoc.id}" ${!hasConnect ? 'disabled title="Stripe Connect not set up"' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            Pay $${totalAmount.toFixed(2)} via Stripe
          </button>
        </div>
      </div>`;

      row.innerHTML += detailHtml;
    }

    rows.push(row);
  }

  grid.innerHTML = '';
  if (rows.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);">No active associates found.</div>';
  } else {
    rows.forEach(r => grid.appendChild(r));
  }

  // Wire up row expand/collapse
  grid.querySelectorAll('.pay-row-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking a checkbox
      if (e.target.tagName === 'INPUT') return;
      const row = header.closest('.pay-row');
      if (row.querySelector('.pay-row-detail')) {
        row.classList.toggle('expanded');
      }
    });
  });

  // Auto-expand rows with unpaid entries
  grid.querySelectorAll('.pay-row.has-unpaid').forEach(row => {
    row.classList.add('expanded');
  });

  // Wire up pay buttons
  grid.querySelectorAll('[data-pay-assoc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPayModal(btn.dataset.payAssoc);
    });
  });

  // Wire up select-all checkboxes
  grid.querySelectorAll('[data-select-all]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const assocId = cb.dataset.selectAll;
      grid.querySelectorAll(`[data-assoc-id="${assocId}"]`).forEach(ecb => {
        ecb.checked = cb.checked;
      });
    });
  });

  // Wire up single mark-as-paid buttons (checkmark per row)
  grid.querySelectorAll('.btn-mark-paid-single').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      markEntriesAsPaid([btn.dataset.entryId]);
    });
  });

  // Wire up single delete buttons (x per row)
  grid.querySelectorAll('.btn-delete-entry').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteEntries([btn.dataset.entryId]);
    });
  });

  // Wire up bulk mark-as-paid
  grid.querySelectorAll('[data-mark-assoc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assocId = btn.dataset.markAssoc;
      const ids = getSelectedEntryIds(assocId);
      if (ids.length === 0) { showToast('No entries selected', 'error'); return; }
      markEntriesAsPaid(ids);
    });
  });

  // Wire up bulk delete
  grid.querySelectorAll('[data-delete-assoc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assocId = btn.dataset.deleteAssoc;
      const ids = getSelectedEntryIds(assocId);
      if (ids.length === 0) { showToast('No entries selected', 'error'); return; }
      deleteEntries(ids);
    });
  });

  // Update Pay All button
  const btnPayAll = document.getElementById('btnPayAll');
  const unpaidAssocCount = Object.keys(unpaidByAssociate).filter(k => unpaidByAssociate[k].length > 0).length;
  if (unpaidAssocCount > 0) {
    btnPayAll.disabled = false;
    btnPayAll.textContent = `Pay All Unpaid ($${totalUnpaidAll.toFixed(2)})`;
  } else {
    btnPayAll.disabled = true;
    btnPayAll.textContent = 'All Paid Up';
  }
}

function renderRecentPayouts() {
  const tbody = document.getElementById('payoutsBody');

  if (recentPayouts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:1.5rem;">No payouts in the last 30 days</td></tr>';
    return;
  }

  tbody.innerHTML = recentPayouts.map(p => {
    const date = new Date(p.created_at).toLocaleDateString('en-US', { timeZone: AUSTIN_TIMEZONE, month: 'short', day: 'numeric', year: 'numeric' });
    const amount = parseFloat(p.amount) || 0;
    const method = p.payment_method || '--';
    const status = p.status || 'pending';
    const transferId = p.external_payout_id || '--';
    const shortId = transferId.length > 20 ? transferId.slice(0, 20) + '...' : transferId;

    return `<tr>
      <td>${date}</td>
      <td>${p.person_name || 'Unknown'}</td>
      <td style="font-weight:700;">$${amount.toFixed(2)}</td>
      <td>${method}</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td style="font-size:0.75rem;font-family:monospace;" title="${transferId}">${shortId}</td>
    </tr>`;
  }).join('');
}

// =============================================
// PAY MODAL
// =============================================
function openPayModal(associateId) {
  payingAssociateId = associateId;
  const assoc = associates.find(a => a.id === associateId);
  const entries = unpaidByAssociate[associateId] || [];
  const name = assoc?.app_user?.display_name || 'Unknown';

  // Get selected entries
  const grid = document.getElementById('associateGrid');
  const selectedEntryIds = [];
  grid.querySelectorAll(`[data-assoc-id="${associateId}"]:checked`).forEach(cb => {
    selectedEntryIds.push(cb.dataset.entryId);
  });

  if (selectedEntryIds.length === 0) {
    showToast('No entries selected', 'error');
    return;
  }

  const selectedEntries = entries.filter(e => selectedEntryIds.includes(e.id));
  let totalHours = 0;
  let totalAmount = 0;
  for (const e of selectedEntries) {
    const mins = parseFloat(e.duration_minutes) || 0;
    const hrs = mins / 60;
    const rate = parseFloat(e.hourly_rate) || 0;
    totalHours += hrs;
    totalAmount += hrs * rate;
  }

  const dateRange = getDateRange(selectedEntries);

  document.getElementById('payModalTitle').textContent = `Pay ${name}`;

  const summary = document.getElementById('payModalSummary');
  summary.innerHTML = `
    <div class="pay-summary-line"><span>Entries</span><span>${selectedEntries.length}</span></div>
    <div class="pay-summary-line"><span>Period</span><span>${dateRange}</span></div>
    <div class="pay-summary-line"><span>Total Hours</span><span>${totalHours.toFixed(2)}h</span></div>
    <div class="pay-summary-line total"><span>Amount</span><span>$${totalAmount.toFixed(2)}</span></div>
  `;

  // Warning if balance is low
  const warningEl = document.getElementById('payModalWarning');
  if (stripeBalance !== null && totalAmount > stripeBalance) {
    warningEl.innerHTML = `<div class="pay-warning">Stripe balance ($${stripeBalance.toFixed(2)}) is less than the payout amount. The transfer may fail unless auto top-up is enabled.</div>`;
  } else {
    warningEl.innerHTML = '';
  }

  document.getElementById('payNotes').value = `Payment for ${totalHours.toFixed(1)}h (${dateRange})`;
  document.getElementById('payModal').classList.add('open');

  // Store selected IDs for confirm
  document.getElementById('payConfirm').dataset.entryIds = JSON.stringify(selectedEntryIds);
  document.getElementById('payConfirm').dataset.amount = totalAmount.toFixed(2);
}

function closePayModal() {
  document.getElementById('payModal').classList.remove('open');
  payingAssociateId = null;
}

async function confirmPay() {
  const btn = document.getElementById('payConfirm');
  const entryIds = JSON.parse(btn.dataset.entryIds || '[]');
  const amount = parseFloat(btn.dataset.amount || '0');
  const notes = document.getElementById('payNotes').value.trim();

  if (!payingAssociateId || entryIds.length === 0) return;

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    // Send Stripe payout via edge function
    const result = await payoutService.sendStripePayout(payingAssociateId, amount, entryIds, notes);

    if (!result.success) {
      showToast(`Payment failed: ${result.error}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Send Payment';
      return;
    }

    // Mark entries as paid via hours service (creates ledger entry)
    const assoc = associates.find(a => a.id === payingAssociateId);
    const personName = assoc?.app_user?.display_name || 'Unknown';
    await hoursService.markPaid(entryIds, {
      paymentMethod: 'stripe',
      notes: `Stripe transfer ${result.transfer_id || result.payout_id || ''}. ${notes}`,
      personName
    });

    showToast(`$${amount.toFixed(2)} sent to ${personName}`, 'success');
    closePayModal();

    // Refresh data
    await loadAll();
  } catch (err) {
    console.error('Payment error:', err);
    showToast(`Payment error: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Payment';
  }
}

async function payAll() {
  const unpaidAssocs = Object.keys(unpaidByAssociate).filter(k => unpaidByAssociate[k].length > 0);
  const connectedAssocs = unpaidAssocs.filter(aid => {
    const assoc = associates.find(a => a.id === aid);
    return assoc?.stripe_connect_account_id;
  });

  if (connectedAssocs.length === 0) {
    showToast('No associates with Stripe Connect set up', 'error');
    return;
  }

  // Calculate total
  let grandTotal = 0;
  const names = [];
  for (const aid of connectedAssocs) {
    const entries = unpaidByAssociate[aid];
    const assoc = associates.find(a => a.id === aid);
    let total = 0;
    for (const e of entries) {
      const mins = parseFloat(e.duration_minutes) || 0;
      const rate = parseFloat(e.hourly_rate) || 0;
      total += (mins / 60) * rate;
    }
    grandTotal += total;
    names.push(`${assoc?.app_user?.display_name || 'Unknown'} ($${total.toFixed(2)})`);
  }

  if (!confirm(`Send payments to ${connectedAssocs.length} associate(s) totaling $${grandTotal.toFixed(2)}?\n\n${names.join('\n')}`)) {
    return;
  }

  const btn = document.getElementById('btnPayAll');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  let successCount = 0;
  let failCount = 0;

  for (const aid of connectedAssocs) {
    const entries = unpaidByAssociate[aid];
    const entryIds = entries.map(e => e.id);
    const assoc = associates.find(a => a.id === aid);
    const personName = assoc?.app_user?.display_name || 'Unknown';

    let total = 0;
    for (const e of entries) {
      const mins = parseFloat(e.duration_minutes) || 0;
      const rate = parseFloat(e.hourly_rate) || 0;
      total += (mins / 60) * rate;
    }

    const dateRange = getDateRange(entries);
    const notes = `Payment for ${(entries.reduce((s, e) => s + (parseFloat(e.duration_minutes) || 0), 0) / 60).toFixed(1)}h (${dateRange})`;

    try {
      const result = await payoutService.sendStripePayout(aid, total, entryIds, notes);
      if (result.success) {
        await hoursService.markPaid(entryIds, {
          paymentMethod: 'stripe',
          notes: `Stripe transfer ${result.transfer_id || result.payout_id || ''}. ${notes}`,
          personName
        });
        successCount++;
      } else {
        console.error(`Payment failed for ${personName}:`, result.error);
        failCount++;
      }
    } catch (err) {
      console.error(`Payment error for ${personName}:`, err);
      failCount++;
    }
  }

  if (successCount > 0) showToast(`${successCount} payment(s) sent successfully`, 'success');
  if (failCount > 0) showToast(`${failCount} payment(s) failed`, 'error');

  await loadAll();
}

// =============================================
// ENTRY ACTIONS
// =============================================
function getSelectedEntryIds(assocId) {
  const grid = document.getElementById('associateGrid');
  const ids = [];
  grid.querySelectorAll(`[data-assoc-id="${assocId}"]:checked`).forEach(cb => {
    ids.push(cb.dataset.entryId);
  });
  return ids;
}

async function markEntriesAsPaid(entryIds) {
  if (!confirm(`Mark ${entryIds.length} entry/entries as paid (without sending a Stripe payment)?`)) return;

  try {
    const { error } = await supabase
      .from('time_entries')
      .update({ is_paid: true, updated_at: new Date().toISOString() })
      .in('id', entryIds);

    if (error) throw error;
    showToast(`${entryIds.length} entry/entries marked as paid`, 'success');
    await loadAssociatesAndEntries();
  } catch (err) {
    console.error('Mark paid error:', err);
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteEntries(entryIds) {
  if (!confirm(`Delete ${entryIds.length} time entry/entries? This cannot be undone.`)) return;

  try {
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .in('id', entryIds);

    if (error) throw error;
    showToast(`${entryIds.length} entry/entries deleted`, 'success');
    await loadAssociatesAndEntries();
  } catch (err) {
    console.error('Delete error:', err);
    showToast(`Error: ${err.message}`, 'error');
  }
}

// =============================================
// HELPERS
// =============================================
function getDateRange(entries) {
  if (!entries || entries.length === 0) return '--';
  const dates = entries.map(e => new Date(e.clock_in));
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  const fmt = (d) => d.toLocaleDateString('en-US', { timeZone: AUSTIN_TIMEZONE, month: 'short', day: 'numeric' });
  return min.toDateString() === max.toDateString() ? fmt(min) : `${fmt(min)} - ${fmt(max)}`;
}
