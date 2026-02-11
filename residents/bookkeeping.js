import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

const ACTIVE_ASSIGNMENT_STATUSES = ['active', 'pending_contract', 'contract_sent'];

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'bookkeeping',
    requiredRole: 'resident',
    requiredPermission: 'view_profile',
    onReady: async (state) => {
      await loadBookkeeping(state.appUser);
    },
  });
});

async function loadBookkeeping(appUser) {
  const personId = await resolvePersonId(appUser);
  if (!personId) {
    renderNoData('bookkeepingSummary', 'No linked person record was found for this user.');
    renderNoData('paymentsList', 'No payments found.');
    renderNoData('ownedAssets', 'No owned items found.');
    renderNoData('rentalTerms', 'No rental terms found.');
    return;
  }

  try {
    const [applications, payments, assignments, vehicles] = await Promise.all([
      loadApplications(personId),
      loadPayments(personId),
      loadAssignments(personId),
      loadVehicles(personId),
    ]);

    renderSummary(payments, assignments, vehicles);
    renderPayments(payments);
    renderOwnedAssets(assignments, vehicles);
    renderRentalTerms(applications, assignments);
  } catch (err) {
    console.error('Failed to load bookkeeping data:', err);
    showToast('Failed to load bookkeeping data', 'error');
  }
}

async function resolvePersonId(appUser) {
  if (appUser?.person_id) return appUser.person_id;
  if (!appUser?.email) return null;

  const { data, error } = await supabase
    .from('people')
    .select('id')
    .eq('email', appUser.email)
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].id;
}

async function loadApplications(personId) {
  const { data, error } = await supabase
    .from('rental_applications')
    .select(`
      id,
      created_at,
      application_status,
      agreement_status,
      agreement_document_url,
      approved_move_in,
      approved_lease_end,
      approved_rate,
      approved_rate_term,
      approved_space:approved_space_id(id, name, monthly_rate),
      desired_space:desired_space_id(id, name, monthly_rate)
    `)
    .eq('person_id', personId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function loadPayments(personId) {
  const { data, error } = await supabase
    .from('rental_payments')
    .select('*')
    .eq('person_id', personId)
    .order('paid_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function loadAssignments(personId) {
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      id,
      status,
      start_date,
      end_date,
      desired_departure_date,
      desired_departure_listed,
      monthly_rent,
      rate_amount,
      rate_term,
      assignment_spaces(space:space_id(id, name, type, monthly_rate))
    `)
    .eq('person_id', personId)
    .in('status', ACTIVE_ASSIGNMENT_STATUSES)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function loadVehicles(personId) {
  if (!personId) return [];

  // Vehicles are linked to people via the vehicle_drivers junction table
  const { data, error } = await supabase
    .from('vehicle_drivers')
    .select('vehicle:vehicle_id(id, name, make, model, year, color, is_active, display_order)')
    .eq('person_id', personId);

  if (error) throw error;

  // Flatten join rows, keep only active vehicles, sort by display_order
  return (data || [])
    .map(d => d.vehicle)
    .filter(v => v && v.is_active)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

function renderSummary(payments, assignments, vehicles) {
  const el = document.getElementById('bookkeepingSummary');
  if (!el) return;

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
  const rentedSpaces = new Set();
  for (const assignment of assignments) {
    for (const relation of assignment.assignment_spaces || []) {
      if (relation?.space?.id) rentedSpaces.add(relation.space.id);
    }
  }

  el.innerHTML = `
    <div class="bookkeeping-stat-card">
      <span class="bookkeeping-stat-label">Total Paid</span>
      <span class="bookkeeping-stat-value">${formatCurrency(totalPaid)}</span>
    </div>
    <div class="bookkeeping-stat-card">
      <span class="bookkeeping-stat-label">Payments Recorded</span>
      <span class="bookkeeping-stat-value">${payments.length}</span>
    </div>
    <div class="bookkeeping-stat-card">
      <span class="bookkeeping-stat-label">Spaces Assigned</span>
      <span class="bookkeeping-stat-value">${rentedSpaces.size}</span>
    </div>
    <div class="bookkeeping-stat-card">
      <span class="bookkeeping-stat-label">Owned Vehicles</span>
      <span class="bookkeeping-stat-value">${vehicles.length}</span>
    </div>
  `;
}

function renderPayments(payments) {
  const el = document.getElementById('paymentsList');
  if (!el) return;
  if (!payments.length) {
    renderNoData('paymentsList', 'No payments have been recorded yet.');
    return;
  }

  el.innerHTML = `
    <div class="bookkeeping-table-wrap">
      <table class="bookkeeping-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map(payment => `
            <tr>
              <td>${formatDate(payment.paid_date || payment.created_at)}</td>
              <td>${toTitleCase(payment.payment_type)}</td>
              <td>${toTitleCase(payment.payment_method)}</td>
              <td>${formatCurrency(payment.amount_paid || payment.amount_due || 0)}</td>
              <td>${toTitleCase(payment.status || 'completed')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOwnedAssets(assignments, vehicles) {
  const el = document.getElementById('ownedAssets');
  if (!el) return;

  const spaceCards = [];
  for (const assignment of assignments) {
    for (const relation of assignment.assignment_spaces || []) {
      if (!relation?.space) continue;
      spaceCards.push({
        name: relation.space.name,
        type: relation.space.type,
        assignmentStatus: assignment.status,
        monthlyRate: assignment.monthly_rent || assignment.rate_amount || relation.space.monthly_rate,
      });
    }
  }

  const ownedVehiclesHtml = vehicles.length
    ? vehicles.map(v => `
      <div class="bookkeeping-item-card">
        <div>
          <div class="bookkeeping-item-title">${escapeHtml(v.name || `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle')}</div>
          <div class="bookkeeping-item-meta">${escapeHtml([v.year, v.make, v.model].filter(Boolean).join(' ')) || 'Vehicle'}</div>
        </div>
        <div class="bookkeeping-item-right">
          <span class="bookkeeping-chip">Driver</span>
        </div>
      </div>
    `).join('')
    : '<p class="text-muted">No vehicles currently linked to your account.</p>';

  const rentedSpacesHtml = spaceCards.length
    ? spaceCards.map(space => `
      <div class="bookkeeping-item-card">
        <div>
          <div class="bookkeeping-item-title">${escapeHtml(space.name || 'Assigned space')}</div>
          <div class="bookkeeping-item-meta">${toTitleCase(space.type)} space</div>
        </div>
        <div class="bookkeeping-item-right">
          <span class="bookkeeping-chip">${toTitleCase(space.assignmentStatus)}</span>
          <span class="bookkeeping-item-meta">${formatCurrency(space.monthlyRate || 0)}/mo</span>
        </div>
      </div>
    `).join('')
    : '<p class="text-muted">No current space assignments.</p>';

  el.innerHTML = `
    <div class="bookkeeping-subsection">
      <h3>Assigned Spaces</h3>
      ${rentedSpacesHtml}
    </div>
    <div class="bookkeeping-subsection">
      <h3>Owned Vehicles</h3>
      ${ownedVehiclesHtml}
    </div>
  `;
}

function renderRentalTerms(applications, assignments) {
  const el = document.getElementById('rentalTerms');
  if (!el) return;
  if (!applications.length && !assignments.length) {
    renderNoData('rentalTerms', 'No rental terms found.');
    return;
  }

  const latestApp = applications[0] || null;
  const latestAssignment = assignments[0] || null;

  const agreementStatus = latestApp?.agreement_status || 'n/a';
  const agreementUrl = latestApp?.agreement_document_url || '';
  const rentAmount = latestApp?.approved_rate || latestAssignment?.monthly_rent || latestAssignment?.rate_amount || 0;
  const leaseStart = latestApp?.approved_move_in || latestAssignment?.start_date || null;
  const leaseEnd = latestApp?.approved_lease_end || latestAssignment?.end_date || latestAssignment?.desired_departure_date || null;
  const rateTerm = latestApp?.approved_rate_term || latestAssignment?.rate_term || 'month';
  const spaceName = latestApp?.approved_space?.name || latestApp?.desired_space?.name || getFirstAssignedSpaceName(latestAssignment);

  el.innerHTML = `
    <div class="bookkeeping-item-card">
      <div>
        <div class="bookkeeping-item-title">${escapeHtml(spaceName || 'Current rental')}</div>
        <div class="bookkeeping-item-meta">
          ${leaseStart ? `Start: ${formatDate(leaseStart)}` : 'Start date: N/A'}
          ${leaseEnd ? ` · End: ${formatDate(leaseEnd)}` : ''}
        </div>
      </div>
      <div class="bookkeeping-item-right">
        <span class="bookkeeping-chip">${toTitleCase(agreementStatus)}</span>
        <span class="bookkeeping-item-meta">${formatCurrency(rentAmount)} / ${escapeHtml(rateTerm)}</span>
      </div>
    </div>
    <div class="bookkeeping-term-list">
      <div class="bookkeeping-term-row"><span>Lease Term</span><strong>${leaseStart && leaseEnd ? `${formatDate(leaseStart)} - ${formatDate(leaseEnd)}` : 'N/A'}</strong></div>
      <div class="bookkeeping-term-row"><span>Rent</span><strong>${formatCurrency(rentAmount)} / ${escapeHtml(rateTerm)}</strong></div>
      <div class="bookkeeping-term-row"><span>Agreement Status</span><strong>${toTitleCase(agreementStatus)}</strong></div>
      <div class="bookkeeping-term-row"><span>Agreement Document</span><strong>${agreementUrl ? `<a href="${agreementUrl}" target="_blank" rel="noopener">Open</a>` : 'Not linked'}</strong></div>
    </div>
  `;
}

function getFirstAssignedSpaceName(assignment) {
  const space = assignment?.assignment_spaces?.[0]?.space;
  return space?.name || null;
}

function renderNoData(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<p class="text-muted">${escapeHtml(message)}</p>`;
}

function toTitleCase(value) {
  const str = String(value || '').trim();
  if (!str) return 'N/A';
  return str
    .replace(/_/g, ' ')
    .split(' ')
    .map(part => part ? (part[0].toUpperCase() + part.slice(1).toLowerCase()) : '')
    .join(' ');
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
