/**
 * PhyProp - Physical Property data dashboard
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

let authState = null;
let activeSubtab = 'overview';
const loadedTabs = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'phyprop',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      initSubtabs();
    }
  });
});

// =============================================
// SUBTAB ROUTING
// =============================================

function initSubtabs() {
  const hash = location.hash.replace('#', '');
  if (hash && document.getElementById(`pp-panel-${hash}`)) activeSubtab = hash;

  document.querySelectorAll('.pp-subtab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchSubtab(btn.dataset.tab);
    });
  });
  switchSubtab(activeSubtab);
}

function switchSubtab(tab) {
  activeSubtab = tab;
  location.hash = tab === 'overview' ? '' : tab;

  document.querySelectorAll('.pp-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.pp-panel').forEach(p => {
    p.style.display = p.id === `pp-panel-${tab}` ? '' : 'none';
  });

  if (!loadedTabs.has(tab)) {
    loadedTabs.add(tab);
    const loaders = {
      overview: loadOverviewTab,
      structures: loadStructuresTab,
    };
    loaders[tab]?.();
  }
}

async function loadOverviewTab() {
  await Promise.all([
    loadSpaces(),
    loadThermostats(),
    loadCameras(),
    loadLighting(),
    loadVehicles(),
    loadAppliances(),
  ]);
}

async function loadStructuresTab() {
  await Promise.all([
    loadParcel(),
    loadEdges(),
    loadStructures(),
    loadUtilities(),
    loadImpervious(),
    loadZoning(),
  ]);
}

// =============================================
// HELPERS
// =============================================

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function badge(text, color = 'gray') {
  return `<span class="pp-badge pp-badge-${color}">${esc(text)}</span>`;
}

function typeBadge(type) {
  const colors = { Dwelling: 'blue', Amenity: 'green', Event: 'amber', Storage: 'gray' };
  return badge(type, colors[type] || 'gray');
}

function relTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function setCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = `(${n})`;
}

function setStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// =============================================
// SPACES
// =============================================

async function loadSpaces() {
  try {
    const { data } = await supabase
      .from('spaces')
      .select('id, name, type, monthly_rate, beds, baths, is_archived, parent:parent_id(name)')
      .eq('is_archived', false)
      .order('name');

    const body = document.getElementById('spacesBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="6" class="pp-empty">No spaces found</td></tr>'; return; }

    setCount('spacesCount', data.length);
    setStat('statSpaces', data.length);

    body.innerHTML = data.map(s => `<tr>
      <td style="font-weight:500;">${esc(s.name)}</td>
      <td>${typeBadge(s.type)}</td>
      <td>${s.monthly_rate ? `$${Number(s.monthly_rate).toLocaleString()}` : '--'}</td>
      <td>${s.beds ?? '--'}</td>
      <td>${s.baths ?? '--'}</td>
      <td style="color:var(--text-muted);font-size:0.75rem;">${s.parent?.name ? esc(s.parent.name) : '--'}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Spaces load error:', err);
  }
}

// =============================================
// THERMOSTATS
// =============================================

async function loadThermostats() {
  try {
    const { data } = await supabase
      .from('nest_devices')
      .select('room_name, device_type, is_active, last_state, last_synced_at')
      .eq('is_active', true)
      .eq('device_type', 'thermostat')
      .order('display_order');

    const body = document.getElementById('thermostatsBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="6" class="pp-empty">No thermostats found</td></tr>'; return; }

    setCount('thermostatsCount', data.length);
    let totalDevices = data.length;

    body.innerHTML = data.map(t => {
      const s = t.last_state || {};
      const mode = s.mode || s.thermostatMode || '--';
      const setTemp = s.setpoint || s.heatSetpoint || s.coolSetpoint || '--';
      const current = s.ambientTemperature || s.currentTemp || '--';
      const humidity = s.humidity != null ? `${s.humidity}%` : '--';
      const modeColor = mode === 'HEAT' ? 'red' : mode === 'COOL' ? 'blue' : mode === 'HEATCOOL' ? 'amber' : 'gray';
      return `<tr>
        <td style="font-weight:500;">${esc(t.room_name)}</td>
        <td>${badge(mode, modeColor)}</td>
        <td>${setTemp !== '--' ? `${setTemp}°F` : '--'}</td>
        <td>${current !== '--' ? `${current}°F` : '--'}</td>
        <td>${humidity}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${relTime(t.last_synced_at)}</td>
      </tr>`;
    }).join('');

    updateDeviceTotal(totalDevices);
  } catch (err) {
    console.error('Thermostats load error:', err);
  }
}

let _deviceTotal = 0;
function updateDeviceTotal(n) {
  _deviceTotal += n;
  setStat('statDevices', _deviceTotal);
}

// =============================================
// CAMERAS
// =============================================

async function loadCameras() {
  try {
    const { data } = await supabase
      .from('camera_streams')
      .select('camera_name, location, camera_model, quality, is_active')
      .eq('is_active', true)
      .order('camera_name')
      .order('quality');

    const body = document.getElementById('camerasBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="5" class="pp-empty">No cameras found</td></tr>'; return; }

    const uniqueCams = [...new Set(data.map(c => c.camera_name))];
    setCount('camerasCount', uniqueCams.length);
    setStat('statCameras', uniqueCams.length);
    updateDeviceTotal(uniqueCams.length);

    body.innerHTML = data.map(c => `<tr>
      <td style="font-weight:500;">${esc(c.camera_name)}</td>
      <td>${esc(c.location || '--')}</td>
      <td style="font-size:0.75rem;">${esc(c.camera_model || '--')}</td>
      <td>${badge(c.quality, c.quality === 'high' ? 'green' : c.quality === 'med' ? 'blue' : 'gray')}</td>
      <td>${badge('Active', 'green')}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Cameras load error:', err);
  }
}

// =============================================
// LIGHTING
// =============================================

async function loadLighting() {
  try {
    const [{ data: groups }, { data: children }] = await Promise.all([
      supabase.from('govee_devices').select('device_id, name, area, online')
        .eq('is_group', true).eq('is_active', true).order('display_order'),
      supabase.from('govee_devices').select('device_id, parent_group_id, online')
        .eq('is_group', false).eq('is_active', true),
    ]);

    const body = document.getElementById('lightingBody');
    if (!groups || !groups.length) { body.innerHTML = '<tr><td colspan="4" class="pp-empty">No lighting groups found</td></tr>'; return; }

    const childMap = {};
    (children || []).forEach(c => {
      if (c.parent_group_id) {
        if (!childMap[c.parent_group_id]) childMap[c.parent_group_id] = [];
        childMap[c.parent_group_id].push(c);
      }
    });

    const totalLights = (children || []).length + groups.length;
    setCount('lightingCount', `${groups.length} groups, ${(children || []).length} bulbs`);
    updateDeviceTotal(totalLights);

    body.innerHTML = groups.map(g => {
      const kids = childMap[g.device_id] || [];
      const onlineCount = kids.filter(k => k.online).length;
      return `<tr>
        <td style="font-weight:500;">${esc(g.name)}</td>
        <td>${esc(g.area || '--')}</td>
        <td>${kids.length}</td>
        <td>${onlineCount}/${kids.length} ${badge(onlineCount === kids.length ? 'All online' : `${onlineCount} online`, onlineCount === kids.length ? 'green' : 'amber')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Lighting load error:', err);
  }
}

// =============================================
// VEHICLES
// =============================================

async function loadVehicles() {
  try {
    const { data } = await supabase
      .from('vehicles')
      .select('name, make, model, year, color, vehicle_state, last_state, last_synced_at, is_active')
      .eq('is_active', true)
      .order('display_order');

    const body = document.getElementById('vehiclesBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="6" class="pp-empty">No vehicles found</td></tr>'; return; }

    setCount('vehiclesCount', data.length);
    setStat('statVehicles', data.length);
    updateDeviceTotal(data.length);

    body.innerHTML = data.map(v => {
      const s = v.last_state || {};
      const battery = s.battery_level != null ? `${s.battery_level}%` : '--';
      const range = s.battery_range_mi != null ? `${Math.round(s.battery_range_mi)} mi` : '--';
      const stateColor = v.vehicle_state === 'online' ? 'green' : v.vehicle_state === 'asleep' ? 'gray' : 'amber';
      return `<tr>
        <td style="font-weight:500;">${esc(v.name)}</td>
        <td>${esc(v.model || `${v.make} ${v.model}`)}</td>
        <td>${v.year || '--'}</td>
        <td>${battery}</td>
        <td>${range}</td>
        <td>${badge(v.vehicle_state || 'unknown', stateColor)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Vehicles load error:', err);
  }
}

// =============================================
// APPLIANCES (LG + Printers + Glowforge + Anova)
// =============================================

async function loadAppliances() {
  try {
    const [{ data: lg }, { data: printers }, { data: glowforge }, { data: ovens }] = await Promise.all([
      supabase.from('lg_appliances').select('name, device_type, model, is_active, last_state, last_synced_at')
        .eq('is_active', true).order('display_order'),
      supabase.from('printer_devices').select('name, machine_type, firmware_version, is_active, last_state, last_synced_at')
        .eq('is_active', true).order('display_order'),
      supabase.from('glowforge_machines').select('name, machine_type, is_active, last_state, last_synced_at')
        .eq('is_active', true).order('display_order'),
      supabase.from('anova_ovens').select('name, oven_type, is_active, last_state, last_synced_at')
        .eq('is_active', true).order('display_order'),
    ]);

    const body = document.getElementById('appliancesBody');
    const all = [];

    (lg || []).forEach(a => {
      const st = a.last_state?.currentState || 'OFF';
      const stColor = st === 'RUNNING' || st === 'RINSING' || st === 'SPINNING' || st === 'DRYING' ? 'green' : st === 'END' ? 'blue' : 'gray';
      all.push({ name: a.name, type: `LG ${a.device_type}`, model: a.model || '--', status: st, statusColor: stColor, synced: a.last_synced_at });
    });

    (printers || []).forEach(p => {
      const st = p.last_state?.machineStatus || 'UNKNOWN';
      const stColor = st === 'READY' ? 'green' : st === 'BUILDING_FROM_SD' ? 'amber' : 'gray';
      all.push({ name: p.name, type: '3D Printer', model: p.machine_type || '--', status: st, statusColor: stColor, synced: p.last_synced_at });
    });

    (glowforge || []).forEach(g => {
      const st = g.last_state?.state || 'unknown';
      const stColor = st === 'online' ? 'green' : 'gray';
      all.push({ name: g.name, type: 'Laser Cutter', model: g.machine_type || 'Glowforge', status: st, statusColor: stColor, synced: g.last_synced_at });
    });

    (ovens || []).forEach(o => {
      const st = o.last_state?.state?.mode || 'idle';
      const stColor = st === 'cook' || st === 'preheating' ? 'green' : 'gray';
      all.push({ name: o.name, type: 'Precision Oven', model: o.oven_type || 'Anova', status: st, statusColor: stColor, synced: o.last_synced_at });
    });

    if (!all.length) { body.innerHTML = '<tr><td colspan="5" class="pp-empty">No appliances found</td></tr>'; return; }

    setCount('appliancesCount', all.length);
    updateDeviceTotal(all.length);

    body.innerHTML = all.map(a => `<tr>
      <td style="font-weight:500;">${esc(a.name)}</td>
      <td>${esc(a.type)}</td>
      <td style="font-size:0.75rem;">${esc(a.model)}</td>
      <td>${badge(a.status, a.statusColor)}</td>
      <td style="font-size:0.75rem;color:var(--text-muted);">${relTime(a.synced)}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Appliances load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Parcel
// =============================================

async function loadParcel() {
  try {
    const { data } = await supabase
      .from('parcels')
      .select('*')
      .limit(1)
      .single();

    const el = document.getElementById('parcelSummary');
    if (!data) { el.innerHTML = '<div class="pp-empty">No parcel data found</div>'; return; }

    el.innerHTML = `
      <div class="pp-stat"><div class="pp-stat-label">Name</div><div class="pp-stat-value" style="font-size:1rem;">${esc(data.name)}</div></div>
      <div class="pp-stat"><div class="pp-stat-label">Acreage</div><div class="pp-stat-value">${data.acreage ?? '--'}</div></div>
      <div class="pp-stat"><div class="pp-stat-label">Area (sq ft)</div><div class="pp-stat-value">${data.area_sqft ? Number(data.area_sqft).toLocaleString() : '--'}</div></div>
      <div class="pp-stat"><div class="pp-stat-label">Flood Zone</div><div class="pp-stat-value" style="font-size:1rem;">${esc(data.flood_zone || '--')}</div></div>
      <div class="pp-stat"><div class="pp-stat-label">ESD District</div><div class="pp-stat-value" style="font-size:1rem;">${esc(data.esd_district || '--')}</div></div>
      <div class="pp-stat"><div class="pp-stat-label">Survey</div><div class="pp-stat-value" style="font-size:0.875rem;">${esc(data.survey_by || '--')} (${data.survey_date || '--'})</div></div>
    `;
  } catch (err) {
    console.error('Parcel load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Edges
// =============================================

async function loadEdges() {
  try {
    const { data } = await supabase
      .from('parcel_edges')
      .select('*')
      .order('edge_side');

    const body = document.getElementById('edgesBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="7" class="pp-empty">No edges found</td></tr>'; return; }

    setCount('edgesCount', data.length);

    body.innerHTML = data.map(e => `<tr>
      <td><span class="pp-badge pp-badge-blue">${esc(e.edge_side)}</span></td>
      <td style="font-weight:500;">${esc(e.edge_label || '--')}</td>
      <td>${e.length_ft ? `${Number(e.length_ft).toFixed(1)} ft` : '--'}</td>
      <td style="font-size:0.75rem;">${esc(e.bearing || '--')}</td>
      <td>${e.is_road_frontage ? badge(e.road_name || 'Yes', 'green') : badge('No', 'gray')}</td>
      <td>${e.has_easement ? badge(`${e.easement_type} (${e.easement_width_ft}')`, 'amber') : badge('None', 'gray')}</td>
      <td>${e.setback_required_ft ? `${e.setback_required_ft} ft` : '--'}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Edges load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Structures
// =============================================

async function loadStructures() {
  try {
    const { data } = await supabase
      .from('structures')
      .select('*, structure_setbacks(*, edge:edge_id(edge_side, edge_label))')
      .order('name');

    const el = document.getElementById('structureCards');
    if (!data || !data.length) { el.innerHTML = '<div class="pp-empty">No structures found</div>'; return; }

    setCount('structuresCount', data.length);

    el.innerHTML = `<div class="pp-struct-cards">${data.map(s => {
      const permitColors = {
        permitted: 'green', exempt: 'green', grandfathered: 'blue',
        unpermitted: 'red', violation: 'red', pending: 'amber',
      };
      const complianceClass = s.setback_compliant === true ? 'compliant'
        : s.setback_compliant === false ? 'violation' : 'pending';

      const dims = [s.width_ft, s.length_ft].filter(Boolean).join(' × ');
      const dimsStr = dims ? `${dims} ft` : '--';
      const heightStr = s.height_ft ? `${s.height_ft} ft` : null;

      const amenities = [];
      if (s.has_plumbing) amenities.push('Plumbing');
      if (s.has_electric) amenities.push('Electric');
      if (s.has_hvac) amenities.push('HVAC');

      const setbacks = (s.structure_setbacks || []).map(sb => {
        const edgeLabel = sb.edge?.edge_side || '?';
        return `${sb.measured_distance_ft}′ to ${esc(edgeLabel)} (req ${sb.required_distance_ft}′) ${sb.is_compliant ? '✓' : '✗'}`;
      });

      return `<div class="pp-struct-card">
        <div class="pp-compliance-bar ${complianceClass}"></div>
        <h4>${esc(s.name)}</h4>
        <dl class="pp-struct-meta">
          <dt>Type</dt><dd>${badge(s.structure_type || '--', 'blue')}</dd>
          <dt>Use</dt><dd>${badge(s.use_type || '--', 'gray')}</dd>
          <dt>Dimensions</dt><dd>${esc(dimsStr)}${heightStr ? ` × ${esc(heightStr)} H` : ''}</dd>
          <dt>Area</dt><dd>${s.area_sqft ? `${Number(s.area_sqft).toLocaleString()} sq ft` : '--'}</dd>
          <dt>Stories</dt><dd>${s.stories ?? '--'}</dd>
          <dt>Material</dt><dd>${esc(s.material || '--')}</dd>
          <dt>Roof</dt><dd>${esc(s.roof_type || '--')}</dd>
          <dt>Permit</dt><dd>${badge(s.permit_status || 'unknown', permitColors[s.permit_status] || 'gray')}</dd>
          ${s.guest_capacity ? `<dt>Capacity</dt><dd>${s.guest_capacity} guests</dd>` : ''}
          ${s.bedrooms ? `<dt>Beds / Baths</dt><dd>${s.bedrooms} / ${s.bathrooms ?? '--'}</dd>` : ''}
          <dt>Movable</dt><dd>${s.is_movable ? 'Yes' : 'No'}</dd>
          ${amenities.length ? `<dt>Utilities</dt><dd>${amenities.join(', ')}</dd>` : ''}
          <dt>Nearest Edge</dt><dd>${s.nearest_edge_side ? `${s.nearest_edge_side} — ${s.nearest_edge_distance_ft}′ (req ${s.setback_required_ft}′)` : '--'}</dd>
        </dl>
        ${setbacks.length ? `<div style="margin-top:0.75rem;font-size:0.75rem;color:var(--text-muted);">
          <strong>Setback Measurements:</strong><br>${setbacks.join('<br>')}
        </div>` : ''}
        <div class="pp-struct-tags">
          ${s.setback_compliant === true ? '<span class="pp-badge pp-badge-green">Compliant</span>' : ''}
          ${s.setback_compliant === false ? '<span class="pp-badge pp-badge-red">Violation</span>' : ''}
          ${s.setback_surplus_ft != null && s.setback_surplus_ft < 0 ? `<span class="pp-badge pp-badge-red">${Math.abs(s.setback_surplus_ft)}′ over line</span>` : ''}
          ${s.setback_surplus_ft != null && s.setback_surplus_ft > 0 ? `<span class="pp-badge pp-badge-green">${s.setback_surplus_ft}′ surplus</span>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (err) {
    console.error('Structures load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Utilities
// =============================================

async function loadUtilities() {
  try {
    const { data } = await supabase
      .from('property_utilities')
      .select('*')
      .order('utility_type');

    const body = document.getElementById('utilitiesBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="4" class="pp-empty">No utilities found</td></tr>'; return; }

    setCount('utilitiesCount', data.length);

    body.innerHTML = data.map(u => `<tr>
      <td style="font-weight:500;">${esc(u.utility_type)}</td>
      <td>${esc(u.provider || '--')}</td>
      <td>${esc(u.system_type || '--')}</td>
      <td>${badge(u.availability_letter_status || '--', u.availability_letter_status === 'obtained' ? 'green' : u.availability_letter_status === 'pending' ? 'amber' : 'gray')}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Utilities load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Impervious Cover
// =============================================

async function loadImpervious() {
  try {
    const { data } = await supabase
      .from('impervious_cover')
      .select('*, structure:structure_id(name)')
      .order('id');

    const body = document.getElementById('imperviousBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="3" class="pp-empty">No impervious cover data</td></tr>'; return; }

    setCount('imperviousCount', data.length);

    body.innerHTML = data.map(ic => `<tr>
      <td style="font-weight:500;">${esc(ic.structure?.name || ic.source_label || '--')}</td>
      <td>${esc(ic.surface_type || '--')}</td>
      <td>${ic.area_sqft ? `${Number(ic.area_sqft).toLocaleString()} sq ft` : '--'}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Impervious load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Zoning Rules
// =============================================

async function loadZoning() {
  try {
    const { data } = await supabase
      .from('zoning_rules')
      .select('*')
      .order('id');

    const body = document.getElementById('zoningBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="4" class="pp-empty">No zoning rules found</td></tr>'; return; }

    body.innerHTML = data.map(z => `<tr>
      <td style="font-weight:500;">${esc(z.rule_name || z.name || '--')}</td>
      <td>${badge(z.category || z.rule_type || '--', 'blue')}</td>
      <td>${esc(z.value || z.rule_value || '--')}</td>
      <td style="font-size:0.75rem;color:var(--text-muted);">${esc(z.notes || z.description || '--')}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Zoning load error:', err);
  }
}
