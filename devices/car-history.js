/**
 * Car History Page - Shows tesla_vehicle_snapshots data in a table.
 * Filterable by vehicle and date.
 */

import { supabase } from '../shared/supabase.js';
import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// STATE
// =============================================
let vehicles = [];

// =============================================
// INIT
// =============================================
async function init() {
  await initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: initHistory,
  });
}

async function initHistory() {
  // Load vehicles for dropdown
  const { data: vData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, name, vehicle_make, vehicle_model, year')
    .eq('is_active', true)
    .order('display_order');

  if (vehicleError) {
    showToast(`Failed to load vehicles: ${vehicleError.message}`, 'error');
    console.error(vehicleError);
  }

  vehicles = vData || [];
  const sel = document.getElementById('vehicleSelect');
  for (const v of vehicles) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.year || ''} ${v.vehicle_make || ''} ${v.vehicle_model || ''})`.trim();
    sel.appendChild(opt);
  }

  // Check URL params for pre-selected vehicle
  const params = new URLSearchParams(window.location.search);
  if (params.get('vehicle')) sel.value = params.get('vehicle');

  // Default date to today
  const dateInput = document.getElementById('dateSelect');
  dateInput.value = new Date().toISOString().split('T')[0];

  // Load on button click
  document.getElementById('loadBtn').addEventListener('click', loadSnapshots);

  // Auto-load
  await loadSnapshots();
}

// =============================================
// LOAD DATA
// =============================================
async function loadSnapshots() {
  const vehicleId = document.getElementById('vehicleSelect').value;
  const dateStr = document.getElementById('dateSelect').value;
  const tbody = document.getElementById('tableBody');
  const thead = document.getElementById('tableHead');
  const empty = document.getElementById('emptyState');
  const countEl = document.getElementById('resultCount');

  tbody.innerHTML = '<tr><td colspan="20" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';
  empty.style.display = 'none';

  // Build query
  let query = supabase
    .from('tesla_vehicle_snapshots')
    .select('*, vehicle:vehicle_id (name)')
    .order('recorded_at', { ascending: false })
    .limit(200);

  if (vehicleId) {
    query = query.eq('vehicle_id', parseInt(vehicleId));
  }

  if (dateStr) {
    // Filter to the selected day (in CT — approximate with UTC offset)
    const dayStart = `${dateStr}T00:00:00-06:00`;
    const dayEnd = `${dateStr}T23:59:59-06:00`;
    query = query.gte('recorded_at', dayStart).lte('recorded_at', dayEnd);
  }

  const { data: snapshots, error } = await query;

  if (error) {
    showToast('Failed to load snapshots', 'error');
    console.error(error);
    tbody.innerHTML = '';
    return;
  }

  if (!snapshots?.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    countEl.textContent = '0 snapshots';
    renderHeader(thead, false);
    return;
  }

  empty.style.display = 'none';
  countEl.textContent = `${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}`;
  const showVehicleCol = !vehicleId;
  renderHeader(thead, showVehicleCol);
  renderRows(tbody, snapshots, showVehicleCol);
}

// =============================================
// RENDER
// =============================================
const COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'vehicle_state', label: 'State' },
  { key: 'battery_level', label: 'Battery', suffix: '%' },
  { key: 'battery_range_mi', label: 'Range', suffix: ' mi' },
  { key: 'charging_state', label: 'Charging' },
  { key: 'charge_limit_soc', label: 'Limit', suffix: '%' },
  { key: 'odometer_mi', label: 'Odometer', suffix: ' mi' },
  { key: 'inside_temp_f', label: 'Inside', suffix: '\u00b0F' },
  { key: 'outside_temp_f', label: 'Outside', suffix: '\u00b0F' },
  { key: 'locked', label: 'Locked' },
  { key: 'sentry_mode', label: 'Sentry' },
  { key: 'location', label: 'Location' },
  { key: 'speed_mph', label: 'Speed', suffix: ' mph' },
  { key: 'software_version', label: 'Software' },
];

function renderHeader(thead, showVehicle) {
  const vehicleCol = showVehicle ? '<th style="padding:0.5rem 0.75rem;text-align:left;white-space:nowrap;font-weight:600;">Vehicle</th>' : '';
  thead.innerHTML = vehicleCol + COLUMNS.map(c =>
    `<th style="padding:0.5rem 0.75rem;text-align:left;white-space:nowrap;font-weight:600;">${c.label}</th>`
  ).join('');
}

function renderRows(tbody, snapshots, showVehicle) {
  tbody.innerHTML = snapshots.map(s => {
    const vehicleCell = showVehicle
      ? `<td style="padding:0.4rem 0.75rem;white-space:nowrap;font-weight:600;">${s.vehicle?.name || s.vehicle_id}</td>`
      : '';

    const time = new Date(s.recorded_at).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const stateColor = s.vehicle_state === 'online' ? 'var(--available,#27ae60)'
      : s.vehicle_state === 'asleep' ? 'var(--text-muted)' : 'var(--occupied,#e74c3c)';

    const batteryColor = s.battery_level != null
      ? (s.battery_level < 20 ? '#dc3545' : s.battery_level < 50 ? '#fd7e14' : 'inherit')
      : 'inherit';

    const chargingColor = s.charging_state === 'Charging' ? 'var(--available,#27ae60)'
      : s.charging_state === 'Disconnected' ? 'var(--text-muted)' : 'inherit';

    const locStr = s.latitude != null && s.longitude != null
      ? `${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)}`
      : '--';

    const lockStr = s.locked === true ? 'Yes' : s.locked === false ? 'No' : '--';
    const sentryStr = s.sentry_mode === true ? 'On' : s.sentry_mode === false ? 'Off' : '--';

    return `<tr style="border-bottom:1px solid var(--border,#eee);">
      ${vehicleCell}
      <td style="padding:0.4rem 0.75rem;white-space:nowrap;">${time}</td>
      <td style="padding:0.4rem 0.75rem;color:${stateColor};">${s.vehicle_state || '--'}</td>
      <td style="padding:0.4rem 0.75rem;font-weight:600;color:${batteryColor};">${fmtVal(s.battery_level, '%')}</td>
      <td style="padding:0.4rem 0.75rem;">${fmtVal(s.battery_range_mi, ' mi')}</td>
      <td style="padding:0.4rem 0.75rem;color:${chargingColor};">${s.charging_state || '--'}</td>
      <td style="padding:0.4rem 0.75rem;">${fmtVal(s.charge_limit_soc, '%')}</td>
      <td style="padding:0.4rem 0.75rem;">${s.odometer_mi != null ? Number(s.odometer_mi).toLocaleString() + ' mi' : '--'}</td>
      <td style="padding:0.4rem 0.75rem;">${fmtVal(s.inside_temp_f, '\u00b0F')}</td>
      <td style="padding:0.4rem 0.75rem;">${fmtVal(s.outside_temp_f, '\u00b0F')}</td>
      <td style="padding:0.4rem 0.75rem;">${lockStr}</td>
      <td style="padding:0.4rem 0.75rem;">${sentryStr}</td>
      <td style="padding:0.4rem 0.75rem;font-size:0.8rem;">${locStr}</td>
      <td style="padding:0.4rem 0.75rem;">${fmtVal(s.speed_mph, ' mph')}</td>
      <td style="padding:0.4rem 0.75rem;font-size:0.8rem;">${s.software_version || '--'}</td>
    </tr>`;
  }).join('');
}

function fmtVal(v, suffix = '') {
  if (v == null) return '--';
  return `${v}${suffix}`;
}

// =============================================
// START
// =============================================
init().catch(err => console.error('Car history init failed:', err));
