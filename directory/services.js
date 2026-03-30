/**
 * Service Connections Directory
 * Sortable, filterable table with detail panel
 * Source: service_connections table
 */
import { supabase } from '../shared/supabase.js';
import { renderHeader, renderFooter, initSiteComponents } from '../shared/site-components.js';

// =============================================
// STATE
// =============================================

let allServices = [];
let sortCol = 'display_order';
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

function formatCategory(cat) {
  return { server: 'Server', api: 'API', storage: 'Storage', database: 'Database', iot: 'IoT', network: 'Network' }[cat] || cat;
}

function formatProtocol(p) {
  return { ssh: 'SSH', https: 'HTTPS', http: 'HTTP', s3: 'S3', mqtt: 'MQTT' }[p] || p;
}

function formatAuthMethod(m) {
  return { key: 'SSH Key', password: 'Password', token: 'API Token', s3_keys: 'S3 Keys', cookie: 'Cookie', none: 'None' }[m] || m || '';
}

function categoryClass(cat) {
  return { server: 'sc-cat--server', api: 'sc-cat--api', storage: 'sc-cat--storage', database: 'sc-cat--database', iot: 'sc-cat--iot', network: 'sc-cat--network' }[cat] || '';
}

// =============================================
// DATA LOADING
// =============================================

async function loadServices() {
  const { data, error } = await supabase
    .from('service_connections')
    .select('*')
    .order('display_order')
    .order('name');
  if (error) throw error;
  return data || [];
}

// =============================================
// FILTERING
// =============================================

function getFiltered() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const category = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;
  const protocol = document.getElementById('filterProtocol').value;
  const activeOnly = document.getElementById('filterActive').checked;

  return allServices.filter(s => {
    if (activeOnly && !s.is_active) return false;
    if (category && s.category !== category) return false;
    if (status && s.status !== status) return false;
    if (protocol && s.protocol !== protocol) return false;
    if (search) {
      const tags = (s.tags || []).join(' ');
      const gotchas = (s.gotchas || []).join(' ');
      const haystack = [s.name, s.slug, s.host, s.protocol, s.auth_method, s.bw_item_name, s.notes, tags, gotchas, s.category].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// =============================================
// SORTING
// =============================================

function sortServices(services) {
  return [...services].sort((a, b) => {
    let av = a[sortCol];
    let bv = b[sortCol];

    if (sortCol === 'status') {
      const order = { working: 0, degraded: 1, down: 2, unknown: 3, decommissioned: 4 };
      av = order[av] ?? 3;
      bv = order[bv] ?? 3;
    }

    if (sortCol === 'tags') {
      av = (av || []).join(',');
      bv = (bv || []).join(',');
    }

    if (sortCol === 'last_tested_at') {
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
  for (const s of filtered) counts[s.status] = (counts[s.status] || 0) + 1;

  const items = ['working', 'degraded', 'down', 'unknown', 'decommissioned']
    .filter(st => counts[st])
    .map(st => `<span class="ld-count-item"><span class="ld-count-dot sc-count-dot--${st}"></span>${counts[st]} ${st}</span>`)
    .join('');

  document.getElementById('summaryCounts').innerHTML =
    items + `<span class="ld-count-item"><strong>${filtered.length}</strong> total</span>`;
}

function renderFilters() {
  const categories = [...new Set(allServices.map(s => s.category))].filter(Boolean).sort();
  const protocols = [...new Set(allServices.map(s => s.protocol))].filter(Boolean).sort();

  document.getElementById('filterCategory').innerHTML = '<option value="">All Categories</option>' +
    categories.map(c => `<option value="${esc(c)}">${esc(formatCategory(c))}</option>`).join('');

  document.getElementById('filterProtocol').innerHTML = '<option value="">All Protocols</option>' +
    protocols.map(p => `<option value="${esc(p)}">${esc(formatProtocol(p))}</option>`).join('');
}

function renderTable() {
  const filtered = getFiltered();
  const sorted = sortServices(filtered);
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--aap-text-muted);">No services match your filters</td></tr>`;
    document.getElementById('footerInfo').textContent = '';
    return;
  }

  tbody.innerHTML = sorted.map(s => {
    const tags = (s.tags || []).slice(0, 4);
    const rowClass = [
      !s.is_active ? 'ld-row-inactive' : '',
      s.status === 'decommissioned' ? 'sc-row-decom' : '',
    ].filter(Boolean).join(' ');

    return `<tr class="${rowClass}" data-slug="${esc(s.slug)}" title="${esc(s.notes || '')}">
      <td><span class="ld-status-dot sc-status--${s.status}" title="${s.status}"></span></td>
      <td class="sc-name-cell">${esc(s.name)}</td>
      <td><span class="sc-cat-badge ${categoryClass(s.category)}">${esc(formatCategory(s.category))}</span></td>
      <td class="ld-mono">${esc(s.host || '')}${s.port ? ':' + s.port : ''}</td>
      <td>${esc(formatProtocol(s.protocol))}</td>
      <td>${esc(formatAuthMethod(s.auth_method))}</td>
      <td class="sc-cred-cell" title="${esc(s.bw_item_name || '')}">${esc(s.bw_item_name ? s.bw_item_name.split(' — ')[0] : '')}</td>
      <td>${tags.map(t => `<span class="sc-tag">${esc(t)}</span>`).join(' ')}</td>
      <td title="${esc(s.last_tested_at || '')}">${timeAgo(s.last_tested_at)}</td>
    </tr>`;
  }).join('');

  document.getElementById('footerInfo').textContent = `Showing ${sorted.length} of ${allServices.length} services`;
}

function renderDetail(service) {
  const s = service;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');

  let commonCmds = [];
  try { commonCmds = typeof s.common_commands === 'string' ? JSON.parse(s.common_commands) : (s.common_commands || []); } catch { commonCmds = []; }

  let extraFields = {};
  try { extraFields = typeof s.bw_extra_fields === 'string' ? JSON.parse(s.bw_extra_fields) : (s.bw_extra_fields || {}); } catch { extraFields = {}; }

  const gotchas = s.gotchas || [];
  const tags = s.tags || [];

  content.innerHTML = `
    <div class="sc-detail-title">${esc(s.name)}</div>
    <div class="sc-detail-status">
      <span class="ld-status-dot sc-status--${s.status}"></span>
      ${s.status.toUpperCase()}
      ${s.last_tested_at ? ` — tested ${timeAgo(s.last_tested_at)}` : ''}
    </div>

    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Connection</div>
      ${s.host ? `<div class="sc-detail-field"><span class="sc-detail-label">Host</span><span class="sc-detail-value" style="font-family:monospace">${esc(s.host)}${s.port ? ':' + s.port : ''}</span></div>` : ''}
      ${s.protocol ? `<div class="sc-detail-field"><span class="sc-detail-label">Protocol</span><span class="sc-detail-value">${esc(formatProtocol(s.protocol))}</span></div>` : ''}
      ${s.auth_method ? `<div class="sc-detail-field"><span class="sc-detail-label">Auth</span><span class="sc-detail-value">${esc(formatAuthMethod(s.auth_method))}</span></div>` : ''}
      <div class="sc-detail-field"><span class="sc-detail-label">Category</span><span class="sc-detail-value"><span class="sc-cat-badge ${categoryClass(s.category)}">${esc(formatCategory(s.category))}</span></span></div>
    </div>

    ${s.bw_item_name ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Credentials (Bitwarden)</div>
      <div class="sc-detail-field"><span class="sc-detail-label">Item</span><span class="sc-detail-value">${esc(s.bw_item_name)}</span></div>
      ${s.bw_field_name ? `<div class="sc-detail-field"><span class="sc-detail-label">Field</span><span class="sc-detail-value">${esc(s.bw_field_name)}</span></div>` : ''}
      ${Object.keys(extraFields).length ? Object.entries(extraFields).map(([k, v]) => `<div class="sc-detail-field"><span class="sc-detail-label">Field</span><span class="sc-detail-value">${esc(k)} — ${esc(v)}</span></div>`).join('') : ''}
    </div>
    ` : ''}

    ${s.connect_command ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Connect Command</div>
      <div class="sc-detail-code" id="connectCmd">${esc(s.connect_command)}</div>
      <button class="sc-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('connectCmd').textContent)">Copy</button>
    </div>
    ` : ''}

    ${commonCmds.length ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Common Commands</div>
      ${commonCmds.map(c => `
        <div class="sc-detail-cmd">
          <div class="sc-detail-cmd-label">${esc(c.label)}</div>
          <div class="sc-detail-cmd-code">${esc(c.command)}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    ${gotchas.length ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Gotchas</div>
      ${gotchas.map(g => `<div class="sc-gotcha">${esc(g)}</div>`).join('')}
    </div>
    ` : ''}

    ${s.notes ? `
    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Notes</div>
      <div style="font-size:0.8rem;line-height:1.5;color:var(--aap-text-muted)">${esc(s.notes)}</div>
    </div>
    ` : ''}

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
    const row = e.target.closest('tr[data-slug]');
    if (!row) return;
    const service = allServices.find(s => s.slug === row.dataset.slug);
    if (service) renderDetail(service);
  });
}

function initFilterHandlers() {
  const handler = () => renderTable();
  document.getElementById('searchInput').addEventListener('input', handler);
  document.getElementById('filterCategory').addEventListener('change', handler);
  document.getElementById('filterStatus').addEventListener('change', handler);
  document.getElementById('filterProtocol').addEventListener('change', handler);
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
    allServices = await loadServices();
    renderFilters();
    initSortHandlers();
    initRowHandlers();
    initFilterHandlers();

    document.getElementById('loadingState').classList.add('aap-hidden');
    document.getElementById('mainContent').classList.remove('aap-hidden');
    renderTable();
  } catch (err) {
    console.error('Failed to load services:', err);
    document.getElementById('loadingState').innerHTML =
      `<div class="dir-empty"><div class="dir-empty-icon">&#9889;</div><h2>Error Loading Services</h2><p>${esc(err.message)}</p></div>`;
  }
});
