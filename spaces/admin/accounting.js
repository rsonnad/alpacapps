/**
 * Accounting Page - Transaction ledger, reconciliation, refunds
 */
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
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

// =============================================
// INITIALIZATION
// =============================================
initAdminPage({
  activeTab: 'accounting',
  onReady: async () => {
    if (initialized) return;
    initialized = true;

    await loadPeople();
    setDefaultDateRange();
    setupEventListeners();
    await loadData();
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
      const { data: spRecord } = await (await import('../../shared/supabase.js')).supabase
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
