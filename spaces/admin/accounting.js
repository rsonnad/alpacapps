/**
 * Accounting Page - Transaction ledger, reconciliation, refunds
 */
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { supabase } from '../../shared/supabase.js';
import {
  accountingService,
  CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  DIRECTION,
  STATUS
} from '../../shared/accounting-service.js';

// State
let transactions = [];
let summary = {};
let people = [];
let currentFilters = {};
let initialized = false;

// Check if running in embed mode (inside iframe on manage.html)
const isEmbed = new URLSearchParams(window.location.search).has('embed');

// =============================================
// INITIALIZATION
// =============================================
initAdminPage({
  activeTab: 'accounting',
  onReady: async () => {
    if (initialized) return;
    initialized = true;

    // Hide header and tab nav in embed mode
    if (isEmbed) {
      const header = document.querySelector('header');
      if (header) header.style.display = 'none';
      const tabs = document.querySelector('.manage-tabs');
      if (tabs) tabs.style.display = 'none';
      // Reduce padding in embed mode
      const container = document.querySelector('.manage-container');
      if (container) container.style.padding = '1rem';
    }

    await loadPeople();
    setDefaultDateRange();
    setupEventListeners();
    await Promise.all([loadData(), loadOccupancy()]);
  }
});

// =============================================
// DATE HELPERS
// =============================================
function getToday() {
  return new Date().toISOString().split('T')[0];
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

function getFirstOfQuarter() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3;
  return `${d.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`;
}

function getFirstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function setDefaultDateRange() {
  document.getElementById('filterDateFrom').value = getFirstOfMonth();
  document.getElementById('filterDateTo').value = getToday();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// =============================================
// DATA LOADING
// =============================================
async function loadPeople() {
  try {
    people = await accountingService.getPeople();
    populatePersonDropdown();
  } catch (err) {
    console.error('Failed to load people:', err);
  }
}

function populatePersonDropdown() {
  const select = document.getElementById('txPerson');
  select.innerHTML = '<option value="">-- Select Person --</option>';
  for (const p of people) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.first_name} ${p.last_name}`;
    select.appendChild(opt);
  }
}

function getFilters() {
  const filters = {};
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;
  const direction = document.getElementById('filterDirection').value;
  const category = document.getElementById('filterCategory').value;
  const method = document.getElementById('filterMethod').value;
  const reconciled = document.getElementById('filterReconciled').value;
  const search = document.getElementById('filterSearch').value.trim();

  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  if (direction) filters.direction = direction;
  if (category) filters.category = category;
  if (method) filters.paymentMethod = method;
  if (reconciled !== '') filters.isReconciled = reconciled === 'true';
  if (search) filters.search = search;

  return filters;
}

async function loadData() {
  try {
    currentFilters = getFilters();
    const [txResult, summaryResult] = await Promise.all([
      accountingService.getTransactions(currentFilters),
      accountingService.getSummary(currentFilters.dateFrom, currentFilters.dateTo)
    ]);

    transactions = txResult.data;
    summary = summaryResult;

    renderSummary();
    renderTransactions();
    renderMonthlySummary();
  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('Failed to load accounting data', 'error');
  }
}

// =============================================
// RENDERING
// =============================================
function renderSummary() {
  document.getElementById('totalIncome').textContent = formatCurrency(summary.totalIncome);
  document.getElementById('totalExpenses').textContent = formatCurrency(summary.totalExpenses);
  document.getElementById('netIncome').textContent = formatCurrency(summary.netIncome);
  document.getElementById('pendingAmount').textContent = formatCurrency(summary.pendingIncome);
}

function renderTransactions() {
  const container = document.getElementById('transactionsTableContainer');
  document.getElementById('transactionCount').textContent = transactions.length;

  if (transactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found for the selected filters.</div>';
    return;
  }

  const html = `
    <table class="transactions-table">
      <thead>
        <tr>
          <th>Date</th>
          <th></th>
          <th>Category</th>
          <th>Description</th>
          <th style="text-align: right;">Amount</th>
          <th class="col-method">Method</th>
          <th class="col-status">Status</th>
          <th class="col-reconciled" style="text-align: center;">QB</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${transactions.map(tx => renderTransactionRow(tx)).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;

  // Attach reconcile checkbox handlers
  container.querySelectorAll('.reconciled-check').forEach(cb => {
    cb.addEventListener('change', (e) => handleReconcileToggle(e.target.dataset.id, e.target.checked));
  });

  // Attach action button handlers
  container.querySelectorAll('.tx-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      if (action === 'refund') openRefundModal(id);
      else if (action === 'void') handleVoid(id);
      else if (action === 'reconcile') openReconcileModal(id);
    });
  });
}

function renderTransactionRow(tx) {
  const dirIcon = tx.direction === 'income' ? '+' : '-';
  const amountClass = tx.direction === 'income' ? 'amount-income' : 'amount-expense';
  const prefix = tx.direction === 'expense' ? '-' : '';
  const personName = tx.person_name || (tx.person ? `${tx.person.first_name} ${tx.person.last_name}` : '');
  const description = tx.description || '';
  const displayDesc = personName ? `${personName}${description ? ' — ' + description : ''}` : description || '—';

  // Determine if refund is possible (Square + completed + income)
  const canRefund = tx.direction === 'income' && tx.payment_method === 'square' && tx.status === 'completed' && tx.square_payment_id;

  const rowClass = tx.status === 'voided' ? 'voided' : '';

  return `
    <tr class="${rowClass}">
      <td style="white-space: nowrap;">${formatDate(tx.transaction_date)}</td>
      <td><span class="direction-badge ${tx.direction}">${dirIcon}</span></td>
      <td><span class="category-badge">${CATEGORY_LABELS[tx.category] || tx.category}</span></td>
      <td>${escapeHtml(displayDesc)}</td>
      <td style="text-align: right;" class="${amountClass}">${prefix}${formatCurrency(tx.amount)}</td>
      <td class="col-method"><span class="method-badge">${PAYMENT_METHOD_LABELS[tx.payment_method] || tx.payment_method || '—'}</span></td>
      <td class="col-status"><span class="tx-status-badge ${tx.status}">${tx.status}</span></td>
      <td class="col-reconciled" style="text-align: center;">
        <input type="checkbox" class="reconciled-check" data-id="${tx.id}" ${tx.is_reconciled ? 'checked' : ''} title="${tx.qb_reference ? 'QB: ' + tx.qb_reference : 'Not reconciled'}">
      </td>
      <td>
        <div class="tx-actions">
          ${canRefund ? `<button class="tx-action-btn refund" data-action="refund" data-id="${tx.id}">Refund</button>` : ''}
          ${!tx.is_reconciled && tx.status === 'completed' ? `<button class="tx-action-btn" data-action="reconcile" data-id="${tx.id}">QB</button>` : ''}
          ${tx.status !== 'voided' ? `<button class="tx-action-btn" data-action="void" data-id="${tx.id}">Void</button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

function renderMonthlySummary() {
  const container = document.getElementById('monthlySummaryContainer');
  const months = summary.byMonth || [];

  if (months.length === 0) {
    container.innerHTML = '<div class="empty-state">No data for monthly summary.</div>';
    return;
  }

  const html = `
    <table class="monthly-table">
      <thead>
        <tr>
          <th>Month</th>
          <th style="text-align: right;">Income</th>
          <th style="text-align: right;">Expenses</th>
          <th style="text-align: right;">Net</th>
        </tr>
      </thead>
      <tbody>
        ${months.map(m => `
          <tr>
            <td>${formatMonthLabel(m.month)}</td>
            <td style="text-align: right;" class="amount-positive">${formatCurrency(m.income)}</td>
            <td style="text-align: right;" class="amount-negative">${formatCurrency(m.expenses)}</td>
            <td style="text-align: right;" class="${m.net >= 0 ? 'amount-positive' : 'amount-negative'}">${formatCurrency(m.net)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

function formatMonthLabel(monthStr) {
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Filters
  document.getElementById('filterDateFrom').addEventListener('change', loadData);
  document.getElementById('filterDateTo').addEventListener('change', loadData);
  document.getElementById('filterDirection').addEventListener('change', loadData);
  document.getElementById('filterCategory').addEventListener('change', loadData);
  document.getElementById('filterMethod').addEventListener('change', loadData);
  document.getElementById('filterReconciled').addEventListener('change', loadData);

  let searchTimeout;
  document.getElementById('filterSearch').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadData, 300);
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });

  // Add Transaction
  document.getElementById('addTransactionBtn').addEventListener('click', openTransactionModal);
  document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
  document.getElementById('cancelTransactionBtn').addEventListener('click', closeTransactionModal);
  document.getElementById('saveTransactionBtn').addEventListener('click', saveTransaction);

  // Export CSV
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCSV);

  // Refund Modal
  document.getElementById('closeRefundModal').addEventListener('click', closeRefundModal);
  document.getElementById('cancelRefundBtn').addEventListener('click', closeRefundModal);
  document.getElementById('processRefundBtn').addEventListener('click', handleProcessRefund);

  // Reconcile Modal
  document.getElementById('closeReconcileModal').addEventListener('click', closeReconcileModal);
  document.getElementById('cancelReconcileBtn').addEventListener('click', closeReconcileModal);
  document.getElementById('confirmReconcileBtn').addEventListener('click', handleConfirmReconcile);

  // Close modals on overlay click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });
}

function applyPreset(preset) {
  const dateFrom = document.getElementById('filterDateFrom');
  const dateTo = document.getElementById('filterDateTo');

  switch (preset) {
    case 'month':
      dateFrom.value = getFirstOfMonth();
      dateTo.value = getToday();
      break;
    case 'last-month':
      dateFrom.value = getFirstOfLastMonth();
      dateTo.value = getLastDayOfLastMonth();
      break;
    case 'quarter':
      dateFrom.value = getFirstOfQuarter();
      dateTo.value = getToday();
      break;
    case 'ytd':
      dateFrom.value = getFirstOfYear();
      dateTo.value = getToday();
      break;
    case 'all':
      dateFrom.value = '';
      dateTo.value = '';
      break;
  }

  loadData();
}

// =============================================
// RECORD TRANSACTION
// =============================================
function openTransactionModal() {
  document.getElementById('transactionModalTitle').textContent = 'Record Payment';
  document.getElementById('txId').value = '';
  document.getElementById('txDirection').value = 'income';
  document.getElementById('txCategory').value = 'rent';
  document.getElementById('txAmount').value = '';
  document.getElementById('txMethod').value = 'zelle';
  document.getElementById('txDate').value = getToday();
  document.getElementById('txPerson').value = '';
  document.getElementById('txDescription').value = '';
  document.getElementById('txNotes').value = '';
  document.getElementById('transactionModal').classList.remove('hidden');
}

function closeTransactionModal() {
  document.getElementById('transactionModal').classList.add('hidden');
}

async function saveTransaction() {
  const direction = document.getElementById('txDirection').value;
  const category = document.getElementById('txCategory').value;
  const amount = parseFloat(document.getElementById('txAmount').value);
  const paymentMethod = document.getElementById('txMethod').value;
  const transactionDate = document.getElementById('txDate').value;
  const personId = document.getElementById('txPerson').value || null;
  const description = document.getElementById('txDescription').value;
  const notes = document.getElementById('txNotes').value;

  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  if (!transactionDate) {
    showToast('Please select a date', 'error');
    return;
  }

  // Get person name if selected
  let personName = null;
  if (personId) {
    const person = people.find(p => p.id === personId);
    if (person) personName = `${person.first_name} ${person.last_name}`;
  }

  try {
    await accountingService.createTransaction({
      direction,
      category,
      amount,
      paymentMethod,
      transactionDate,
      personId,
      personName,
      description,
      notes,
      recordedBy: 'admin'
    });

    showToast('Transaction recorded', 'success');
    closeTransactionModal();
    await loadData();
  } catch (err) {
    console.error('Failed to save transaction:', err);
    showToast('Failed to save transaction', 'error');
  }
}

// =============================================
// RECONCILIATION
// =============================================
async function handleReconcileToggle(id, checked) {
  try {
    if (checked) {
      await accountingService.reconcileTransaction(id, null, null);
      showToast('Marked as reconciled', 'success');
    } else {
      await accountingService.unreconcile(id);
      showToast('Removed reconciliation', 'info');
    }
  } catch (err) {
    console.error('Reconciliation failed:', err);
    showToast('Reconciliation failed', 'error');
    await loadData();
  }
}

function openReconcileModal(id) {
  document.getElementById('reconcileLedgerId').value = id;
  document.getElementById('reconcileQbRef').value = '';
  document.getElementById('reconcileNotes').value = '';
  document.getElementById('reconcileModal').classList.remove('hidden');
}

function closeReconcileModal() {
  document.getElementById('reconcileModal').classList.add('hidden');
}

async function handleConfirmReconcile() {
  const id = document.getElementById('reconcileLedgerId').value;
  const qbRef = document.getElementById('reconcileQbRef').value;
  const notes = document.getElementById('reconcileNotes').value;

  try {
    await accountingService.reconcileTransaction(id, qbRef, notes);
    showToast('Transaction reconciled', 'success');
    closeReconcileModal();
    await loadData();
  } catch (err) {
    console.error('Reconciliation failed:', err);
    showToast('Reconciliation failed', 'error');
  }
}

// =============================================
// REFUND
// =============================================
async function openRefundModal(ledgerId) {
  const tx = transactions.find(t => t.id === ledgerId);
  if (!tx) return;

  // Get already refunded amount
  let refundedAmount = 0;
  try {
    refundedAmount = await accountingService.getRefundedAmount(ledgerId);
  } catch (err) {
    console.error('Failed to get refunded amount:', err);
  }

  const originalAmount = parseFloat(tx.amount) || 0;
  const refundable = originalAmount - refundedAmount;

  document.getElementById('refundOriginalAmount').textContent = formatCurrency(originalAmount);
  document.getElementById('refundAlreadyRefunded').textContent = formatCurrency(refundedAmount);
  document.getElementById('refundRefundable').textContent = formatCurrency(refundable);
  document.getElementById('refundAmount').value = refundable.toFixed(2);
  document.getElementById('refundAmount').max = refundable;
  document.getElementById('refundReason').value = '';
  document.getElementById('refundLedgerId').value = ledgerId;

  // Get the Square payment ID from square_payments table via the FK
  if (tx.square_payment_id) {
    // Need to get the actual Square payment ID string (from Square API)
    try {
      const { data: spRecord } = await supabase
        .from('square_payments')
        .select('id, square_payment_id')
        .eq('id', tx.square_payment_id)
        .single();

      if (spRecord) {
        document.getElementById('refundSquarePaymentId').value = spRecord.square_payment_id || '';
        document.getElementById('refundPaymentRecordId').value = spRecord.id;
      }
    } catch (err) {
      console.error('Failed to look up Square payment:', err);
    }
  }

  document.getElementById('refundModal').classList.remove('hidden');
}

function closeRefundModal() {
  document.getElementById('refundModal').classList.add('hidden');
}

async function handleProcessRefund() {
  const ledgerId = document.getElementById('refundLedgerId').value;
  const squarePaymentId = document.getElementById('refundSquarePaymentId').value;
  const paymentRecordId = document.getElementById('refundPaymentRecordId').value;
  const amount = parseFloat(document.getElementById('refundAmount').value);
  const reason = document.getElementById('refundReason').value;

  if (!squarePaymentId) {
    showToast('No Square payment ID found — cannot process automated refund', 'error');
    return;
  }

  if (!amount || amount <= 0) {
    showToast('Please enter a valid refund amount', 'error');
    return;
  }

  const amountCents = Math.round(amount * 100);
  const btn = document.getElementById('processRefundBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    await accountingService.initiateRefund(squarePaymentId, amountCents, reason, ledgerId, paymentRecordId);
    showToast(`Refund of ${formatCurrency(amount)} processed successfully`, 'success');
    closeRefundModal();
    await loadData();
  } catch (err) {
    console.error('Refund failed:', err);
    showToast(`Refund failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Process Refund';
  }
}

// =============================================
// VOID
// =============================================
async function handleVoid(id) {
  if (!confirm('Are you sure you want to void this transaction? This cannot be undone.')) return;

  try {
    await accountingService.voidTransaction(id, 'Voided by admin');
    showToast('Transaction voided', 'success');
    await loadData();
  } catch (err) {
    console.error('Void failed:', err);
    showToast('Failed to void transaction', 'error');
  }
}

// =============================================
// EXPORT
// =============================================
async function handleExportCSV() {
  try {
    const filters = getFilters();
    await accountingService.downloadCSV(filters);
    showToast('CSV downloaded', 'success');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Failed to export CSV', 'error');
  }
}

// =============================================
// OCCUPANCY & REVENUE POTENTIAL
// =============================================
async function loadOccupancy() {
  try {
    // Load dwelling spaces
    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, name, monthly_rate, weekly_rate, nightly_rate, parent_id, can_be_dwelling, is_archived')
      .eq('can_be_dwelling', true)
      .eq('is_archived', false)
      .order('monthly_rate', { ascending: false, nullsFirst: false });

    // Load active assignments with spaces
    const { data: assignments } = await supabase
      .from('assignments')
      .select('id, status, start_date, end_date, rate_amount, rate_term, is_free, desired_departure_date, desired_departure_listed, person:person_id(first_name, last_name), assignment_spaces(space_id)')
      .in('status', ['active', 'pending_contract', 'contract_sent']);

    if (!spaces || !assignments) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Determine occupancy for each space
    const spaceData = spaces.map(space => {
      const spaceAssignments = (assignments || []).filter(a =>
        a.assignment_spaces?.some(as => as.space_id === space.id)
      );

      const currentAssignment = spaceAssignments.find(a => {
        if (a.status !== 'active') return false;
        const effectiveEnd = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
        if (!effectiveEnd) return true; // indefinite
        return new Date(effectiveEnd + 'T00:00:00') >= today;
      });

      // Normalize rate to monthly for comparison
      let actualMonthly = 0;
      if (currentAssignment) {
        if (currentAssignment.is_free) {
          actualMonthly = 0;
        } else if (currentAssignment.rate_term === 'weekly') {
          actualMonthly = (parseFloat(currentAssignment.rate_amount) || 0) * 4.33;
        } else if (currentAssignment.rate_term === 'monthly') {
          actualMonthly = parseFloat(currentAssignment.rate_amount) || 0;
        } else {
          // flat or other - use rate_amount as monthly approximation
          actualMonthly = parseFloat(currentAssignment.rate_amount) || 0;
        }
      }

      return {
        id: space.id,
        name: space.name,
        monthlyRate: parseFloat(space.monthly_rate) || 0,
        weeklyRate: parseFloat(space.weekly_rate) || 0,
        parentId: space.parent_id,
        isOccupied: !!currentAssignment,
        isFree: currentAssignment?.is_free || false,
        actualMonthly: Math.round(actualMonthly * 100) / 100,
        occupantName: currentAssignment?.person
          ? `${currentAssignment.person.first_name} ${currentAssignment.person.last_name}`
          : null,
        rateTerm: currentAssignment?.rate_term || null,
      };
    });

    // Parent-child propagation (same logic as consumer view)
    // Pass 1: Parent → child
    for (const space of spaceData) {
      if (space.parentId && !space.isOccupied) {
        const parent = spaceData.find(s => s.id === space.parentId);
        if (parent && parent.isOccupied) {
          space.isOccupied = true;
          space.occupantName = parent.occupantName;
          space.actualMonthly = 0; // Revenue counted on parent
          space.isChildOfOccupied = true;
        }
      }
    }

    // Pass 2: Child → parent
    for (const space of spaceData) {
      if (!space.isOccupied) {
        const children = spaceData.filter(s => s.parentId === space.id);
        const occupiedChildren = children.filter(c => c.isOccupied);
        if (occupiedChildren.length > 0) {
          space.isOccupied = true;
          space.isParentOfOccupied = true;
          space.actualMonthly = 0; // Revenue counted on children
        }
      }
    }

    // Filter to only "leaf" or independently rentable units for counting
    // Exclude spaces that are only occupied because they are parents of occupied children
    // (the children are the actual rentable units)
    const countableSpaces = spaceData.filter(s => {
      // If this space has children that are also dwellings, don't count this as a separate unit
      const hasChildDwellings = spaceData.some(c => c.parentId === s.id);
      return !hasChildDwellings;
    });

    renderOccupancy(countableSpaces, spaceData);
  } catch (err) {
    console.error('Failed to load occupancy:', err);
  }
}

function renderOccupancy(countableSpaces, allSpaces) {
  const totalUnits = countableSpaces.length;
  const occupiedUnits = countableSpaces.filter(s => s.isOccupied).length;
  const availableUnits = totalUnits - occupiedUnits;
  const occupancyPct = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  // Revenue calculation
  const maxPotential = countableSpaces.reduce((sum, s) => sum + s.monthlyRate, 0);
  const currentRevenue = countableSpaces
    .filter(s => s.isOccupied && !s.isChildOfOccupied)
    .reduce((sum, s) => sum + s.actualMonthly, 0);
  const revenueGap = maxPotential - currentRevenue;
  const revenuePct = maxPotential > 0 ? Math.round((currentRevenue / maxPotential) * 100) : 0;

  // Update unit occupancy donut
  const circumference = 2 * Math.PI * 52; // ~326.7
  const unitArcLen = (occupancyPct / 100) * circumference;
  const unitArc = document.getElementById('unitOccupancyArc');
  unitArc.setAttribute('stroke-dasharray', `${unitArcLen} ${circumference}`);
  document.getElementById('unitOccupancyPct').textContent = `${occupancyPct}%`;
  document.getElementById('unitOccupancySub').textContent = `${occupiedUnits} / ${totalUnits}`;

  // Update unit detail rows
  document.getElementById('unitOccupied').textContent = occupiedUnits;
  document.getElementById('unitAvailable').textContent = availableUnits;
  document.getElementById('unitTotal').textContent = totalUnits;

  // Update revenue donut
  const revArcLen = (revenuePct / 100) * circumference;
  const revArc = document.getElementById('revenueOccupancyArc');
  revArc.setAttribute('stroke-dasharray', `${revArcLen} ${circumference}`);
  document.getElementById('revenueOccupancyPct').textContent = `${revenuePct}%`;
  document.getElementById('revenueOccupancySub').textContent = formatCurrency(currentRevenue);

  // Update revenue detail rows
  document.getElementById('revenueCurrent').textContent = formatCurrency(currentRevenue);
  document.getElementById('revenuePotential').textContent = formatCurrency(maxPotential);
  document.getElementById('revenueGap').textContent = formatCurrency(revenueGap);

  // Render unit breakdown
  renderUnitBreakdown(allSpaces);
}

function renderUnitBreakdown(spaces) {
  const container = document.getElementById('unitBreakdown');

  // Sort: occupied first, then by rate descending
  const sorted = [...spaces].sort((a, b) => {
    if (a.isOccupied !== b.isOccupied) return a.isOccupied ? -1 : 1;
    return (b.monthlyRate || 0) - (a.monthlyRate || 0);
  });

  const maxRate = Math.max(...spaces.map(s => s.monthlyRate || 0), 1);

  const rows = sorted.map(space => {
    const barWidth = space.monthlyRate > 0 ? Math.max(5, (space.monthlyRate / maxRate) * 100) : 5;
    const barClass = space.isOccupied ? 'occupied' : 'vacant';

    let statusTag;
    if (space.isFree) {
      statusTag = '<span class="unit-status-tag free">Free</span>';
    } else if (space.isOccupied) {
      statusTag = '<span class="unit-status-tag occupied">Occupied</span>';
    } else {
      statusTag = '<span class="unit-status-tag vacant">Vacant</span>';
    }

    const rateDisplay = space.isOccupied && !space.isChildOfOccupied && !space.isParentOfOccupied
      ? formatCurrency(space.actualMonthly) + '/mo'
      : space.monthlyRate > 0
        ? formatCurrency(space.monthlyRate) + '/mo'
        : '—';

    return `
      <div class="unit-row">
        <span class="unit-name" title="${escapeHtml(space.name)}">${escapeHtml(space.name)}</span>
        <div class="unit-bar-container">
          <div class="unit-bar ${barClass}" style="width: ${barWidth}%"></div>
        </div>
        <span class="unit-rate">${rateDisplay}</span>
        ${statusTag}
      </div>
    `;
  }).join('');

  container.innerHTML = rows || '<div class="empty-state">No dwelling spaces found</div>';
}
