/**
 * Lighting Directory
 * Sortable, filterable table of all smart lighting devices
 * Sources: govee_devices + lighting_devices tables
 */
import { supabase } from '../shared/supabase.js';
import { renderHeader, renderFooter, initSiteComponents } from '../shared/site-components.js';

// =============================================
// STATE
// =============================================

let allDevices = [];
let sortCol = 'room';
let sortDir = 'asc';

// =============================================
// HELPERS
// =============================================

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getOnlineStatus(device) {
  if (device._source === 'govee') {
    if (device.online === true) return 'online';
    if (device.online === false) return 'offline';
    return 'unknown';
  }
  // lighting_devices don't have an online field — unknown
  return 'unknown';
}

// =============================================
// DATA LOADING
// =============================================

async function loadDevices() {
  const [goveeRes, lightingRes, modelsRes] = await Promise.all([
    supabase.from('govee_devices').select('*').order('area').order('display_order').order('name'),
    supabase.from('lighting_devices').select('*').order('room').order('socket_number').order('device_name'),
    supabase.from('govee_models').select('*'),
  ]);

  const modelMap = {};
  if (modelsRes.data) {
    for (const m of modelsRes.data) {
      modelMap[m.sku] = m;
    }
  }

  const devices = [];

  // Normalize govee_devices
  if (goveeRes.data) {
    for (const g of goveeRes.data) {
      const model = modelMap[g.sku];
      devices.push({
        _source: 'govee',
        _id: g.id,
        name: g.name || '',
        room: g.area || '',
        brand: 'Govee',
        model: model?.model_name || g.sku || '',
        sku: g.sku || '',
        protocol: 'govee_cloud',
        form_factor: model?.category || '',
        matter: false,
        ip: '',
        mac: g.device_id || '',
        is_group: g.is_group || false,
        is_active: g.is_active !== false,
        device_type: g.device_type || '',
        online: g.online,
        last_state: g.last_state,
        notes: g.notes || '',
        updated_at: g.updated_at || g.created_at || '',
        parent_group_id: g.parent_group_id,
        space_id: g.space_id,
        ha_entity_id: '',
      });
    }
  }

  // Normalize lighting_devices
  if (lightingRes.data) {
    for (const l of lightingRes.data) {
      devices.push({
        _source: 'lighting',
        _id: l.id,
        name: l.device_name || '',
        room: l.room || '',
        brand: l.device_brand || '',
        model: l.device_model || '',
        sku: l.sku || '',
        protocol: l.protocol || '',
        form_factor: l.form_factor || '',
        matter: l.matter_support || false,
        ip: l.ip_address || '',
        mac: l.mac_address || '',
        is_group: false,
        is_active: l.is_active !== false,
        device_type: '',
        online: null,
        last_state: null,
        notes: l.notes || '',
        updated_at: l.updated_at || l.created_at || '',
        parent_group_id: null,
        space_id: null,
        ha_entity_id: l.ha_entity_id || '',
      });
    }
  }

  return devices;
}

// =============================================
// FILTERING
// =============================================

function getFiltered() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const brand = document.getElementById('filterBrand').value;
  const room = document.getElementById('filterRoom').value;
  const protocol = document.getElementById('filterProtocol').value;
  const status = document.getElementById('filterStatus').value;
  const activeOnly = document.getElementById('filterActive').checked;

  return allDevices.filter(d => {
    if (activeOnly && !d.is_active) return false;
    if (brand && d.brand !== brand) return false;
    if (room && d.room !== room) return false;
    if (protocol && d.protocol !== protocol) return false;
    if (status) {
      const s = getOnlineStatus(d);
      if (s !== status) return false;
    }
    if (search) {
      const haystack = [d.name, d.room, d.brand, d.model, d.sku, d.protocol, d.form_factor, d.device_type, d.ip, d.mac, d.ha_entity_id, d.notes].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// =============================================
// SORTING
// =============================================

function sortDevices(devices) {
  return [...devices].sort((a, b) => {
    let av = a[sortCol];
    let bv = b[sortCol];

    // Special sort for status
    if (sortCol === 'status') {
      const order = { online: 0, offline: 1, unknown: 2 };
      av = order[getOnlineStatus(a)] ?? 2;
      bv = order[getOnlineStatus(b)] ?? 2;
    }

    // Booleans
    if (typeof av === 'boolean') {
      av = av ? 0 : 1;
      bv = bv ? 0 : 1;
    }

    // Nulls / empty last
    if (!av && av !== 0) av = '';
    if (!bv && bv !== 0) bv = '';

    // Dates
    if (sortCol === 'updated_at') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }

    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }

    const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// =============================================
// RENDERING
// =============================================

function renderSummary(filtered) {
  const online = filtered.filter(d => getOnlineStatus(d) === 'online').length;
  const offline = filtered.filter(d => getOnlineStatus(d) === 'offline').length;
  const unknown = filtered.filter(d => getOnlineStatus(d) === 'unknown').length;
  const groups = filtered.filter(d => d.is_group).length;

  document.getElementById('summaryCounts').innerHTML = `
    <span class="ld-count-item"><span class="ld-count-dot ld-count-dot--online"></span>${online} online</span>
    <span class="ld-count-item"><span class="ld-count-dot ld-count-dot--offline"></span>${offline} offline</span>
    <span class="ld-count-item"><span class="ld-count-dot ld-count-dot--unknown"></span>${unknown} unknown</span>
    ${groups ? `<span class="ld-count-item">${groups} groups</span>` : ''}
    <span class="ld-count-item"><strong>${filtered.length}</strong> total</span>
  `;
}

function renderFilters() {
  const brands = [...new Set(allDevices.map(d => d.brand))].filter(Boolean).sort();
  const rooms = [...new Set(allDevices.map(d => d.room))].filter(Boolean).sort();
  const protocols = [...new Set(allDevices.map(d => d.protocol))].filter(Boolean).sort();

  const brandSel = document.getElementById('filterBrand');
  brandSel.innerHTML = '<option value="">All Brands</option>' +
    brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');

  const roomSel = document.getElementById('filterRoom');
  roomSel.innerHTML = '<option value="">All Rooms</option>' +
    rooms.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');

  const protoSel = document.getElementById('filterProtocol');
  protoSel.innerHTML = '<option value="">All Protocols</option>' +
    protocols.map(p => `<option value="${esc(p)}">${esc(formatProtocol(p))}</option>`).join('');
}

function formatProtocol(p) {
  const map = {
    govee_cloud: 'Govee Cloud',
    wiz_udp: 'WiZ UDP',
    tuya_cloud: 'Tuya Cloud',
    tuya_local: 'Tuya Local',
    matter: 'Matter',
    zigbee: 'Zigbee',
    hue_bridge: 'Hue Bridge',
  };
  return map[p] || p;
}

function brandClass(brand) {
  const b = (brand || '').toLowerCase();
  if (b === 'govee' || b === 'aidot') return 'ld-brand--govee';
  if (b === 'wiz') return 'ld-brand--wiz';
  if (b === 'tuya') return 'ld-brand--tuya';
  if (b === 'philips' || b === 'hue') return 'ld-brand--hue';
  return 'ld-brand--other';
}

function renderTable() {
  const filtered = getFiltered();
  const sorted = sortDevices(filtered);

  renderSummary(filtered);

  // Update sort header indicators
  document.querySelectorAll('.ld-table th').forEach(th => {
    th.classList.remove('ld-sorted-asc', 'ld-sorted-desc');
    if (th.dataset.sort === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'ld-sorted-asc' : 'ld-sorted-desc');
    }
  });

  const tbody = document.getElementById('tableBody');
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:2rem;color:var(--aap-text-muted);">No devices match your filters</td></tr>`;
    document.getElementById('footerInfo').textContent = '';
    return;
  }

  const rows = sorted.map(d => {
    const status = getOnlineStatus(d);
    const rowClass = [
      !d.is_active ? 'ld-row-inactive' : '',
      d.is_group ? 'ld-row-group' : '',
    ].filter(Boolean).join(' ');

    return `<tr class="${rowClass}" title="${esc(d.notes || '')}">
      <td><span class="ld-status-dot ld-status-dot--${status}" title="${status}"></span></td>
      <td>${esc(d.name)}${d.is_group ? ' <span class="ld-group-badge">GROUP</span>' : ''}</td>
      <td>${esc(d.room)}</td>
      <td><span class="ld-brand ${brandClass(d.brand)}">${esc(d.brand)}</span></td>
      <td title="${esc(d.sku)}">${esc(d.model || d.sku)}</td>
      <td><span class="ld-proto">${esc(formatProtocol(d.protocol))}</span></td>
      <td>${esc(d.form_factor)}</td>
      <td>${d.matter ? '<span class="ld-matter ld-matter--yes">Yes</span>' : '<span class="ld-matter ld-matter--no">No</span>'}</td>
      <td class="ld-mono">${esc(d.ip)}</td>
      <td class="ld-mono" title="${esc(d.mac)}">${esc(d.mac ? d.mac.substring(0, 17) : '')}</td>
      <td>${d.is_group ? 'Yes' : ''}</td>
      <td>${esc(d.device_type)}</td>
      <td title="${esc(d.updated_at)}">${timeAgo(d.updated_at)}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');

  const goveeCount = filtered.filter(d => d._source === 'govee').length;
  const lightingCount = filtered.filter(d => d._source === 'lighting').length;
  document.getElementById('footerInfo').textContent =
    `Showing ${sorted.length} devices (${goveeCount} from Govee, ${lightingCount} from Lighting Inventory)`;
}

// =============================================
// EVENT HANDLERS
// =============================================

function initSortHandlers() {
  document.querySelectorAll('.ld-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      renderTable();
    });
  });
}

function initFilterHandlers() {
  const handler = () => renderTable();
  document.getElementById('searchInput').addEventListener('input', handler);
  document.getElementById('filterBrand').addEventListener('change', handler);
  document.getElementById('filterRoom').addEventListener('change', handler);
  document.getElementById('filterProtocol').addEventListener('change', handler);
  document.getElementById('filterStatus').addEventListener('change', handler);
  document.getElementById('filterActive').addEventListener('change', handler);
}

// =============================================
// INIT
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  const version = document.querySelector('[data-site-version]')?.textContent || '';
  document.getElementById('siteHeader').innerHTML = renderHeader({ transparent: false, light: false, version });
  document.getElementById('siteFooter').innerHTML = renderFooter();
  initSiteComponents();

  try {
    allDevices = await loadDevices();
    renderFilters();
    initSortHandlers();
    initFilterHandlers();

    document.getElementById('loadingState').classList.add('aap-hidden');
    document.getElementById('mainContent').classList.remove('aap-hidden');

    renderTable();
  } catch (err) {
    console.error('Failed to load lighting devices:', err);
    document.getElementById('loadingState').innerHTML =
      `<div class="dir-empty"><div class="dir-empty-icon">⚡</div><h2>Error Loading Devices</h2><p>${esc(err.message)}</p></div>`;
  }
});
