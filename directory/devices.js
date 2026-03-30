/**
 * Unified Devices Directory
 * Queries devices_unified view + device_control_recipes table
 * Sortable, filterable table with recipe detail panel
 */
import { supabase } from '../shared/supabase.js';
import { renderHeader, renderFooter, initSiteComponents } from '../shared/site-components.js';

// =============================================
// STATE
// =============================================

let allDevices = []; // merged: devices_unified + recipes
let sortCol = 'domain';
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

const DOMAIN_LABELS = {
  lighting: 'Lighting',
  climate: 'Climate',
  appliance: 'Appliance',
  security: 'Security',
  vehicle: 'Vehicle',
};

const PROTOCOL_LABELS = {
  light_api: 'Light API',
  govee_lan: 'Govee LAN',
  nest_sdm: 'Nest SDM',
  lg_thinq: 'LG ThinQ',
  rtsp: 'RTSP',
  tesla_api: 'Tesla API',
  haos: 'HAOS',
  tuya_local: 'Tuya Local',
  wiz_proxy: 'WiZ Proxy',
  matter_proxy: 'Matter',
};

function domainIcon(domain) {
  return { lighting: '💡', climate: '🌡️', appliance: '🧺', security: '📹', vehicle: '🚗' }[domain] || '📦';
}

function domainClass(domain) {
  return `dv-domain--${domain || 'unknown'}`;
}

// =============================================
// DATA LOADING
// =============================================

async function loadDevices() {
  // Load unified devices view
  const { data: devices, error: devErr } = await supabase
    .from('devices_unified')
    .select('*');
  if (devErr) throw devErr;

  // Load all recipes
  const { data: recipes, error: recErr } = await supabase
    .from('device_control_recipes')
    .select('*')
    .order('display_order');
  if (recErr) throw recErr;

  // Group recipes by device_id
  const recipeMap = {};
  for (const r of (recipes || [])) {
    const key = `${r.device_table}:${r.device_id}`;
    if (!recipeMap[key]) recipeMap[key] = [];
    recipeMap[key].push(r);
  }

  // Merge: each device gets its recipes
  const merged = (devices || []).map(dev => {
    const key = `${dev.source_table}:${dev.id}`;
    const deviceRecipes = recipeMap[key] || [];
    const actions = [...new Set(deviceRecipes.map(r => r.action))];
    const allTags = [...new Set(deviceRecipes.flatMap(r => r.tags || []))];
    const latestVerified = deviceRecipes.reduce((latest, r) => {
      if (!r.last_verified_at) return latest;
      return (!latest || r.last_verified_at > latest) ? r.last_verified_at : latest;
    }, null);

    return {
      ...dev,
      device_name: dev.name,
      recipes: deviceRecipes,
      actions,
      allTags,
      last_verified_at: latestVerified,
      hasRecipes: deviceRecipes.length > 0,
    };
  });

  // Also add "All Rooms" virtual device from recipes with device_id 00000000-...
  const allRoomsKey = 'lighting_groups:00000000-0000-0000-0000-000000000000';
  if (recipeMap[allRoomsKey]) {
    const allRecipes = recipeMap[allRoomsKey];
    merged.unshift({
      id: '00000000-0000-0000-0000-000000000000',
      device_key: 'all',
      name: 'All Rooms',
      device_name: 'All Rooms',
      room: 'All',
      domain: 'lighting',
      protocol: 'light_api',
      is_active: true,
      source_table: 'lighting_groups',
      recipes: allRecipes,
      actions: [...new Set(allRecipes.map(r => r.action))],
      allTags: [...new Set(allRecipes.flatMap(r => r.tags || []))],
      last_verified_at: allRecipes[0]?.last_verified_at,
      hasRecipes: true,
    });
  }

  return merged;
}

// =============================================
// FILTERING
// =============================================

function getFiltered() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const domain = document.getElementById('filterDomain').value;
  const protocol = document.getElementById('filterProtocol').value;
  const room = document.getElementById('filterRoom').value;
  const activeOnly = document.getElementById('filterActive').checked;

  return allDevices.filter(d => {
    if (activeOnly && !d.is_active) return false;
    if (domain && d.domain !== domain) return false;
    if (protocol && d.protocol !== protocol) return false;
    if (room && d.room !== room) return false;
    if (search) {
      const tags = (d.allTags || []).join(' ');
      const actions = (d.actions || []).join(' ');
      const haystack = [d.name, d.device_key, d.room, d.domain, d.protocol, tags, actions].join(' ').toLowerCase();
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

    if (sortCol === 'domain') {
      const order = { lighting: 0, climate: 1, appliance: 2, security: 3, vehicle: 4 };
      av = order[av] ?? 5;
      bv = order[bv] ?? 5;
    }

    if (sortCol === 'actions') {
      av = (a.actions || []).length;
      bv = (b.actions || []).length;
    }

    if (sortCol === 'tags') {
      av = (a.allTags || []).join(',');
      bv = (b.allTags || []).join(',');
    }

    if (sortCol === 'last_verified_at') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }

    if (!av && av !== 0) av = '';
    if (!bv && bv !== 0) bv = '';

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
  const counts = {};
  for (const d of filtered) counts[d.domain] = (counts[d.domain] || 0) + 1;

  const items = Object.keys(DOMAIN_LABELS)
    .filter(dom => counts[dom])
    .map(dom => `<span class="ld-count-item"><span class="dv-count-icon">${domainIcon(dom)}</span>${counts[dom]} ${DOMAIN_LABELS[dom]}</span>`)
    .join('');

  const withRecipes = filtered.filter(d => d.hasRecipes).length;
  document.getElementById('summaryCounts').innerHTML =
    items + `<span class="ld-count-item"><strong>${filtered.length}</strong> devices</span>` +
    `<span class="ld-count-item">${withRecipes} with recipes</span>`;
}

function renderFilters() {
  const domains = [...new Set(allDevices.map(d => d.domain))].filter(Boolean).sort();
  const protocols = [...new Set(allDevices.map(d => d.protocol))].filter(Boolean).sort();
  const rooms = [...new Set(allDevices.map(d => d.room))].filter(Boolean).sort();

  document.getElementById('filterDomain').innerHTML = '<option value="">All Domains</option>' +
    domains.map(d => `<option value="${esc(d)}">${esc(DOMAIN_LABELS[d] || d)}</option>`).join('');

  document.getElementById('filterProtocol').innerHTML = '<option value="">All Protocols</option>' +
    protocols.map(p => `<option value="${esc(p)}">${esc(PROTOCOL_LABELS[p] || p)}</option>`).join('');

  document.getElementById('filterRoom').innerHTML = '<option value="">All Rooms</option>' +
    rooms.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
}

function renderTable() {
  const filtered = getFiltered();
  const sorted = sortDevices(filtered);
  renderSummary(filtered);

  // Update sort indicators
  document.querySelectorAll('.ld-table th').forEach(th => {
    th.classList.remove('ld-sorted-asc', 'ld-sorted-desc');
    if (th.dataset.sort === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'ld-sorted-asc' : 'ld-sorted-desc');
    }
  });

  const tbody = document.getElementById('tableBody');
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--aap-text-muted);">No devices match your filters</td></tr>`;
    document.getElementById('footerInfo').textContent = '';
    return;
  }

  tbody.innerHTML = sorted.map(d => {
    const tags = (d.allTags || []).slice(0, 4);
    const rowClass = !d.is_active ? 'ld-row-inactive' : '';
    const actionBadges = (d.actions || []).map(a =>
      `<span class="dv-action-badge">${esc(a.replace('_', ' '))}</span>`
    ).join(' ');

    return `<tr class="${rowClass}" data-id="${esc(d.id)}" data-table="${esc(d.source_table)}">
      <td><span class="dv-domain-dot ${domainClass(d.domain)}" title="${DOMAIN_LABELS[d.domain] || d.domain}">${domainIcon(d.domain)}</span></td>
      <td class="sc-name-cell">${esc(d.name)}</td>
      <td>${esc(d.room || '')}</td>
      <td><span class="dv-domain-badge ${domainClass(d.domain)}">${esc(DOMAIN_LABELS[d.domain] || d.domain)}</span></td>
      <td>${esc(PROTOCOL_LABELS[d.protocol] || d.protocol || '')}</td>
      <td>${actionBadges || '<span style="color:var(--aap-text-muted);font-size:0.7rem">none</span>'}</td>
      <td>${tags.map(t => `<span class="sc-tag">${esc(t)}</span>`).join(' ')}</td>
      <td title="${esc(d.last_verified_at || '')}">${timeAgo(d.last_verified_at)}</td>
    </tr>`;
  }).join('');

  document.getElementById('footerInfo').textContent = `Showing ${sorted.length} of ${allDevices.length} devices`;
}

function renderDetail(device) {
  const d = device;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');

  const recipes = d.recipes || [];
  const tags = d.allTags || [];

  let recipesHtml = '';
  if (recipes.length) {
    recipesHtml = recipes.map((r, i) => {
      const gotchas = (r.gotchas || []);
      return `
        <div class="dv-recipe">
          <div class="dv-recipe-header">
            <span class="dv-action-badge dv-action-badge--lg">${esc(r.action.replace('_', ' '))}</span>
            <span class="dv-recipe-proto">${esc(PROTOCOL_LABELS[r.protocol] || r.protocol)}</span>
          </div>
          <div class="sc-detail-code" id="recipeCmd${i}">${esc(r.command_template)}</div>
          <button class="sc-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('recipeCmd${i}').textContent)">Copy</button>
          ${r.command_notes ? `<div class="dv-recipe-notes">${esc(r.command_notes)}</div>` : ''}
          ${r.requires_secret ? `<div class="dv-recipe-secret">Credential: <strong>${esc(r.requires_secret)}</strong>${r.secret_field ? ` → ${esc(r.secret_field)}` : ''}</div>` : ''}
          ${gotchas.length ? gotchas.map(g => `<div class="sc-gotcha">${esc(g)}</div>`).join('') : ''}
        </div>
      `;
    }).join('');
  }

  content.innerHTML = `
    <div class="sc-detail-title">${domainIcon(d.domain)} ${esc(d.name)}</div>
    <div class="sc-detail-status">
      <span class="dv-domain-badge ${domainClass(d.domain)}">${esc(DOMAIN_LABELS[d.domain] || d.domain)}</span>
      ${d.room ? `<span style="margin-left:0.5rem;font-size:0.75rem;color:var(--aap-text-muted)">${esc(d.room)}</span>` : ''}
    </div>

    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Device Info</div>
      <div class="sc-detail-field"><span class="sc-detail-label">Source</span><span class="sc-detail-value">${esc(d.source_table)}</span></div>
      <div class="sc-detail-field"><span class="sc-detail-label">Protocol</span><span class="sc-detail-value">${esc(PROTOCOL_LABELS[d.protocol] || d.protocol)}</span></div>
      <div class="sc-detail-field"><span class="sc-detail-label">Active</span><span class="sc-detail-value">${d.is_active ? 'Yes' : 'No'}</span></div>
      ${d.device_key ? `<div class="sc-detail-field"><span class="sc-detail-label">Key</span><span class="sc-detail-value" style="font-family:monospace">${esc(d.device_key)}</span></div>` : ''}
    </div>

    ${recipes.length ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Control Recipes (${recipes.length})</div>
      ${recipesHtml}
    </div>
    ` : `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Control Recipes</div>
      <div style="font-size:0.8rem;color:var(--aap-text-muted)">No control recipes configured for this device.</div>
    </div>
    `}

    ${tags.length ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Tags</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.25rem">${tags.map(t => `<span class="sc-tag">${esc(t)}</span>`).join('')}</div>
    </div>
    ` : ''}
  `;

  panel.classList.remove('aap-hidden');
}

function closeDetail() {
  document.getElementById('detailPanel').classList.add('aap-hidden');
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

function initRowHandlers() {
  document.getElementById('tableBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const device = allDevices.find(d => d.id === row.dataset.id && d.source_table === row.dataset.table);
    if (device) renderDetail(device);
  });
}

function initFilterHandlers() {
  const handler = () => renderTable();
  document.getElementById('searchInput').addEventListener('input', handler);
  document.getElementById('filterDomain').addEventListener('change', handler);
  document.getElementById('filterProtocol').addEventListener('change', handler);
  document.getElementById('filterRoom').addEventListener('change', handler);
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

  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  try {
    allDevices = await loadDevices();
    renderFilters();
    initSortHandlers();
    initRowHandlers();
    initFilterHandlers();

    document.getElementById('loadingState').classList.add('aap-hidden');
    document.getElementById('mainContent').classList.remove('aap-hidden');
    renderTable();
  } catch (err) {
    console.error('Failed to load devices:', err);
    document.getElementById('loadingState').innerHTML =
      `<div class="dir-empty"><div class="dir-empty-icon">&#9889;</div><h2>Error Loading Devices</h2><p>${esc(err.message)}</p></div>`;
  }
});
