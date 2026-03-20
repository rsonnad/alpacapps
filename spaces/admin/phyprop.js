/**
 * PhyProp - Physical Property data dashboard
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

let authState = null;

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'phyprop',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      await Promise.all([
        loadSpaces(),
        loadThermostats(),
        loadCameras(),
        loadLighting(),
        loadVehicles(),
        loadAppliances(),
      ]);
    }
  });
});

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
