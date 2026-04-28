/**
 * SHFuego.js — Safiyya Haider / Fuego Trailer financial status page
 * Queries live data from Supabase: people, assignments, ledger, rental_payments
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

const PERSON_ID = '433e74fd-0058-4bff-ba15-e0384b163260';
const SPACE_ID = '14d17e18-b271-409c-b99e-ab74018b23a2';

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'accounting',
    requiredRole: 'staff',
    onReady: loadPage,
  });
});

async function loadPage() {
  try {
    const [person, assignment, ledgerEntries, rentalPayments] = await Promise.all([
      loadPerson(),
      loadAssignment(),
      loadLedger(),
      loadRentalPayments(),
    ]);

    if (!person) {
      document.querySelector('.sh-page').innerHTML = '<div class="sh-empty">Person record not found.</div>';
      return;
    }

    // Merge all payment sources
    const payments = mergePayments(ledgerEntries, rentalPayments);

    renderHeader(person, assignment);
    renderSummary(assignment, payments);
    renderLease(person, assignment);
    renderMonthBreakdown(assignment, payments);
    renderTransactions(payments);
  } catch (err) {
    console.error('[SHFuego] Load error:', err);
    showToast('Failed to load financial data', 'error');
  }
}

// =============================================
// DATA LOADERS
// =============================================

async function loadPerson() {
  const { data, error } = await supabase
    .from('people')
    .select('id, first_name, last_name, email, phone')
    .eq('id', PERSON_ID)
    .single();
  if (error) { console.error('Person load error:', error); return null; }
  return data;
}

async function loadAssignment() {
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      id, status, start_date, end_date, monthly_rent, rate_amount, rate_term,
      desired_departure_date, desired_departure_listed,
      assignment_spaces(space:space_id(id, name, monthly_rate, type))
    `)
    .eq('person_id', PERSON_ID)
    .order('start_date', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') console.error('Assignment load error:', error);
  return data || null;
}

async function loadLedger() {
  const { data, error } = await supabase
    .from('ledger')
    .select('*')
    .eq('person_id', PERSON_ID)
    .order('transaction_date', { ascending: false });
  if (error) { console.error('Ledger load error:', error); return []; }
  return data || [];
}

async function loadRentalPayments() {
  // Get assignment IDs for this person, then load rental_payments
  const { data: assignments } = await supabase
    .from('assignments')
    .select('id')
    .eq('person_id', PERSON_ID);

  if (!assignments?.length) return [];

  const assignmentIds = assignments.map(a => a.id);
  const { data, error } = await supabase
    .from('rental_payments')
    .select('*')
    .in('assignment_id', assignmentIds)
    .order('paid_date', { ascending: false });

  if (error) { console.error('Rental payments load error:', error); return []; }
  return data || [];
}

// =============================================
// MERGE PAYMENTS FROM MULTIPLE SOURCES
// =============================================

function mergePayments(ledgerEntries, rentalPayments) {
  const payments = [];

  for (const l of ledgerEntries) {
    payments.push({
      id: l.id,
      source: 'ledger',
      date: l.transaction_date,
      amount: Number(l.amount || 0),
      category: l.category,
      method: l.payment_method,
      description: l.description,
      notes: l.notes,
      status: l.status || 'completed',
      direction: l.direction,
      periodStart: l.period_start,
      periodEnd: l.period_end,
    });
  }

  // Avoid duplicates — skip rental_payments that have a matching ledger entry
  const ledgerRpIds = new Set(ledgerEntries.filter(l => l.rental_payment_id).map(l => l.rental_payment_id));
  for (const rp of rentalPayments) {
    if (ledgerRpIds.has(rp.id)) continue;
    payments.push({
      id: rp.id,
      source: 'rental_payment',
      date: rp.paid_date || rp.due_date,
      amount: Number(rp.amount_paid || rp.amount_due || 0),
      category: rp.payment_type || 'rent',
      method: rp.payment_method,
      description: `${titleCase(rp.payment_type || 'rent')}`,
      notes: rp.notes,
      status: rp.amount_paid ? 'completed' : 'pending',
      direction: 'income',
      periodStart: rp.period_start,
      periodEnd: rp.period_end,
    });
  }

  payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return payments;
}

// =============================================
// RENDERERS
// =============================================

function renderHeader(person, assignment) {
  const name = `${person.first_name || ''} ${person.last_name || ''}`.trim();
  const spaceName = assignment?.assignment_spaces?.[0]?.space?.name || 'Fuego Trailer';

  document.getElementById('tenantName').textContent = `${name} — ${spaceName}`;
  document.getElementById('tenantSubtitle').textContent = [
    person.email,
    person.phone,
  ].filter(Boolean).join(' | ');
}

function renderSummary(assignment, payments) {
  const rate = Number(assignment?.rate_amount || assignment?.monthly_rent || 0);
  const startDate = assignment?.start_date ? new Date(assignment.start_date + 'T00:00:00') : null;
  const endDate = assignment?.end_date ? new Date(assignment.end_date + 'T00:00:00') : null;
  const today = new Date();

  // Calculate total months of rent owed
  const months = getLeaseMonths(startDate, endDate);
  const totalOwed = computeTotalOwed(months, rate, startDate);
  const totalPaid = payments
    .filter(p => p.direction === 'income' && p.status !== 'voided')
    .reduce((sum, p) => sum + p.amount, 0);
  const balance = totalOwed - totalPaid;

  const el = document.getElementById('summaryCards');
  el.innerHTML = `
    <div class="sh-card">
      <div class="sh-card-label">Monthly Rate</div>
      <div class="sh-card-value">${fmtCurrency(rate)}</div>
      <div class="sh-card-note">${assignment?.rate_term || 'monthly'}</div>
    </div>
    <div class="sh-card">
      <div class="sh-card-label">Total Owed to Date</div>
      <div class="sh-card-value">${fmtCurrency(totalOwed)}</div>
      <div class="sh-card-note">${months.filter(m => m.start <= today).length} month(s) through today</div>
    </div>
    <div class="sh-card">
      <div class="sh-card-label">Total Paid</div>
      <div class="sh-card-value positive">${fmtCurrency(totalPaid)}</div>
      <div class="sh-card-note">${payments.filter(p => p.direction === 'income').length} payment(s)</div>
    </div>
    <div class="sh-card">
      <div class="sh-card-label">Balance ${balance >= 0 ? 'Due' : 'Credit'}</div>
      <div class="sh-card-value ${balance > 0 ? 'negative' : balance < 0 ? 'positive' : ''}">${fmtCurrency(Math.abs(balance))}</div>
      <div class="sh-card-note">${balance > 0 ? 'Unpaid' : balance < 0 ? 'Overpaid' : 'Settled'}</div>
    </div>
  `;
}

function renderLease(person, assignment) {
  if (!assignment) {
    document.getElementById('leaseGrid').innerHTML = '<div class="sh-empty">No active assignment found.</div>';
    return;
  }

  const spaceName = assignment.assignment_spaces?.[0]?.space?.name || 'Fuego Trailer';
  const rate = Number(assignment.rate_amount || assignment.monthly_rent || 0);
  const status = assignment.status || 'unknown';

  document.getElementById('leaseGrid').innerHTML = `
    <div class="sh-lease-row"><span class="sh-lease-label">Space</span><span class="sh-lease-val">${esc(spaceName)}</span></div>
    <div class="sh-lease-row"><span class="sh-lease-label">Status</span><span class="sh-lease-val"><span class="sh-status-badge ${status === 'active' ? 'active' : 'ended'}">${titleCase(status)}</span></span></div>
    <div class="sh-lease-row"><span class="sh-lease-label">Start Date</span><span class="sh-lease-val">${fmtDate(assignment.start_date)}</span></div>
    <div class="sh-lease-row"><span class="sh-lease-label">End Date</span><span class="sh-lease-val">${fmtDate(assignment.end_date)}</span></div>
    <div class="sh-lease-row"><span class="sh-lease-label">Rent</span><span class="sh-lease-val">${fmtCurrency(rate)} / ${esc(assignment.rate_term || 'month')}</span></div>
    <div class="sh-lease-row"><span class="sh-lease-label">Email</span><span class="sh-lease-val">${esc(person.email || 'N/A')}</span></div>
  `;
}

function renderMonthBreakdown(assignment, payments) {
  const rate = Number(assignment?.rate_amount || assignment?.monthly_rent || 0);
  const startDate = assignment?.start_date ? new Date(assignment.start_date + 'T00:00:00') : null;
  const endDate = assignment?.end_date ? new Date(assignment.end_date + 'T00:00:00') : null;
  const today = new Date();

  if (!startDate) {
    document.getElementById('monthTable').innerHTML = '<div class="sh-empty">No assignment dates.</div>';
    return;
  }

  const months = getLeaseMonths(startDate, endDate);

  // Match payments to months by period or date
  const monthData = months.map(m => {
    const monthPayments = payments.filter(p => {
      if (p.direction !== 'income') return false;
      if (p.periodStart && p.periodEnd) {
        const ps = new Date(p.periodStart + 'T00:00:00');
        return ps >= m.start && ps < m.end;
      }
      if (p.date) {
        const pd = new Date(p.date + 'T00:00:00');
        return pd >= m.start && pd < m.end;
      }
      return false;
    });
    const paid = monthPayments.reduce((s, p) => s + p.amount, 0);
    const isFuture = m.start > today;
    const isPast = m.end <= today;
    return { ...m, paid, owed: m.rentDue, balance: m.rentDue - paid, isFuture, isPast };
  });

  let html = `<table class="sh-table">
    <thead><tr>
      <th>Period</th>
      <th>Days</th>
      <th class="right">Rent Due</th>
      <th class="right">Paid</th>
      <th class="right">Balance</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  let totalDue = 0, totalPaid = 0;

  for (const m of monthData) {
    totalDue += m.owed;
    totalPaid += m.paid;
    const bal = m.owed - m.paid;

    let badge;
    if (m.isFuture) badge = '<span class="sh-badge-future">Upcoming</span>';
    else if (bal <= 0) badge = '<span class="sh-badge-paid">Paid</span>';
    else if (m.paid > 0) badge = '<span class="sh-badge-partial">Partial</span>';
    else badge = '<span class="sh-badge-unpaid">Unpaid</span>';

    html += `<tr>
      <td>${m.label}</td>
      <td>${m.days}</td>
      <td class="amt">${fmtCurrency(m.owed)}</td>
      <td class="amt ${m.paid > 0 ? 'paid' : 'zero'}">${fmtCurrency(m.paid)}</td>
      <td class="amt ${bal > 0 ? 'owed' : bal < 0 ? 'paid' : 'zero'}">${bal === 0 ? '$0.00' : (bal > 0 ? fmtCurrency(bal) : '-' + fmtCurrency(Math.abs(bal)))}</td>
      <td>${badge}</td>
    </tr>`;
  }

  const totalBal = totalDue - totalPaid;
  html += `</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">
    <td>Total</td>
    <td></td>
    <td class="amt">${fmtCurrency(totalDue)}</td>
    <td class="amt paid">${fmtCurrency(totalPaid)}</td>
    <td class="amt ${totalBal > 0 ? 'owed' : totalBal < 0 ? 'paid' : 'zero'}">${totalBal === 0 ? '$0.00' : (totalBal > 0 ? fmtCurrency(totalBal) : '-' + fmtCurrency(Math.abs(totalBal)))}</td>
    <td></td>
  </tr></tfoot></table>`;

  document.getElementById('monthTable').innerHTML = html;
}

function renderTransactions(payments) {
  const el = document.getElementById('txList');
  if (!payments.length) {
    el.innerHTML = `<div class="sh-empty">
      No payments recorded yet.<br>
      <a href="accounting.html" style="color:var(--accent);font-size:0.8rem">Record a payment in Accounting</a>
    </div>`;
    return;
  }

  let html = `<table class="sh-table">
    <thead><tr>
      <th>Date</th>
      <th>Category</th>
      <th>Method</th>
      <th class="right">Amount</th>
      <th>Description</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  for (const p of payments) {
    html += `<tr>
      <td>${fmtDate(p.date)}</td>
      <td>${titleCase(p.category)}</td>
      <td>${titleCase(p.method)}</td>
      <td class="amt ${p.direction === 'income' ? 'paid' : 'owed'}">${p.direction === 'expense' ? '-' : ''}${fmtCurrency(p.amount)}</td>
      <td>${esc(p.description || p.notes || '')}</td>
      <td>${titleCase(p.status)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  el.innerHTML = html;
}

// =============================================
// HELPERS
// =============================================

function getLeaseMonths(startDate, endDate) {
  if (!startDate) return [];
  const end = endDate || new Date();
  const months = [];
  let cursor = new Date(startDate);

  while (cursor < end) {
    const monthStart = new Date(cursor);
    // End of this billing period = one month later or lease end, whichever is first
    const nextMonth = new Date(cursor);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthEnd = nextMonth > end ? end : nextMonth;

    const daysInFullMonth = daysInMonth(cursor.getFullYear(), cursor.getMonth());
    const days = Math.round((monthEnd - monthStart) / (1000 * 60 * 60 * 24));
    const isPartial = days < daysInFullMonth;

    months.push({
      start: monthStart,
      end: monthEnd,
      days,
      isPartial,
      label: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      rentDue: 0, // filled in by computeTotalOwed caller
    });

    cursor = nextMonth;
  }

  return months;
}

function computeTotalOwed(months, rate, startDate) {
  const today = new Date();
  let total = 0;

  for (const m of months) {
    if (m.start > today) {
      m.rentDue = 0; // future — not owed yet
      continue;
    }
    if (m.isPartial) {
      const fullDays = daysInMonth(m.start.getFullYear(), m.start.getMonth());
      m.rentDue = Math.round((rate / fullDays) * m.days * 100) / 100;
    } else {
      m.rentDue = rate;
    }
    total += m.rentDue;
  }

  return Math.round(total * 100) / 100;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function fmtCurrency(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
}

function fmtDate(val) {
  if (!val) return 'N/A';
  const d = new Date(val + (val.includes('T') ? '' : 'T00:00:00'));
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(str) {
  if (!str) return 'N/A';
  return String(str).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
