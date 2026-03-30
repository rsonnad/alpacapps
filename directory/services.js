/**
 * Service Connections Directory
 * Card-based view with detail panel for infrastructure service recipes
 * Source: service_connections table
 */
import { supabase } from '../shared/supabase.js';
import { renderHeader, renderFooter, initSiteComponents } from '../shared/site-components.js';

// =============================================
// STATE
// =============================================

let allServices = [];
let selectedService = null;

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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCategory(cat) {
  const map = {
    server: 'Server',
    api: 'API',
    storage: 'Storage',
    database: 'Database',
    iot: 'IoT',
    network: 'Network',
  };
  return map[cat] || cat;
}

function formatProtocol(p) {
  const map = {
    ssh: 'SSH',
    https: 'HTTPS',
    http: 'HTTP',
    s3: 'S3',
    mqtt: 'MQTT',
  };
  return map[p] || p;
}

function formatAuthMethod(m) {
  const map = {
    key: 'SSH Key',
    password: 'Password',
    token: 'API Token',
    s3_keys: 'S3 Access Keys',
    cookie: 'Cookie/Session',
    none: 'None',
  };
  return map[m] || m || 'Unknown';
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
// RENDERING
// =============================================

function renderSummary(filtered) {
  const counts = {};
  for (const s of filtered) {
    counts[s.status] = (counts[s.status] || 0) + 1;
  }

  const items = ['working', 'degraded', 'down', 'unknown', 'decommissioned']
    .filter(st => counts[st])
    .map(st => `<span class="sc-count-item"><span class="sc-count-dot sc-count-dot--${st}"></span>${counts[st]} ${st}</span>`)
    .join('');

  document.getElementById('summaryCounts').innerHTML =
    items + `<span class="sc-count-item"><strong>${filtered.length}</strong> total</span>`;
}

function renderFilters() {
  const categories = [...new Set(allServices.map(s => s.category))].filter(Boolean).sort();
  const protocols = [...new Set(allServices.map(s => s.protocol))].filter(Boolean).sort();

  const catSel = document.getElementById('filterCategory');
  catSel.innerHTML = '<option value="">All Categories</option>' +
    categories.map(c => `<option value="${esc(c)}">${esc(formatCategory(c))}</option>`).join('');

  const protoSel = document.getElementById('filterProtocol');
  protoSel.innerHTML = '<option value="">All Protocols</option>' +
    protocols.map(p => `<option value="${esc(p)}">${esc(formatProtocol(p))}</option>`).join('');
}

function renderCards() {
  const filtered = getFiltered();
  renderSummary(filtered);

  const container = document.getElementById('cardsContainer');

  if (!filtered.length) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--aap-text-muted);">No services match your filters</div>`;
    document.getElementById('footerInfo').textContent = '';
    return;
  }

  container.innerHTML = filtered.map(s => {
    const tags = (s.tags || []).slice(0, 5);
    const cardClass = [
      'sc-card',
      !s.is_active ? 'sc-card--inactive' : '',
      s.status === 'decommissioned' ? 'sc-card--decommissioned' : '',
    ].filter(Boolean).join(' ');

    return `<div class="${cardClass}" data-slug="${esc(s.slug)}">
      <div class="sc-card-header">
        <span class="sc-card-status sc-card-status--${s.status}" title="${s.status}"></span>
        <span class="sc-card-name">${esc(s.name)}</span>
        <span class="sc-card-category sc-cat--${s.category}">${esc(formatCategory(s.category))}</span>
      </div>
      <div class="sc-card-meta">
        ${s.host ? `<span class="sc-card-meta-item"><span class="sc-card-host">${esc(s.host)}${s.port ? ':' + s.port : ''}</span></span>` : ''}
        ${s.protocol ? `<span class="sc-card-meta-item">${esc(formatProtocol(s.protocol))}</span>` : ''}
        ${s.auth_method ? `<span class="sc-card-meta-item">${esc(formatAuthMethod(s.auth_method))}</span>` : ''}
      </div>
      ${s.notes ? `<div class="sc-card-notes">${esc(s.notes)}</div>` : ''}
      ${tags.length ? `<div class="sc-card-tags">${tags.map(t => `<span class="sc-tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  document.getElementById('footerInfo').textContent =
    `Showing ${filtered.length} of ${allServices.length} services`;
}

function renderDetail(service) {
  const s = service;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');

  let commonCmds = [];
  try {
    commonCmds = typeof s.common_commands === 'string' ? JSON.parse(s.common_commands) : (s.common_commands || []);
  } catch { commonCmds = []; }

  let extraFields = {};
  try {
    extraFields = typeof s.bw_extra_fields === 'string' ? JSON.parse(s.bw_extra_fields) : (s.bw_extra_fields || {});
  } catch { extraFields = {}; }

  const gotchas = s.gotchas || [];
  const tags = s.tags || [];

  content.innerHTML = `
    <div class="sc-detail-title">${esc(s.name)}</div>
    <div class="sc-detail-status">
      <span class="sc-card-status sc-card-status--${s.status}"></span>
      ${s.status.toUpperCase()}
      ${s.last_tested_at ? ` — tested ${timeAgo(s.last_tested_at)}` : ''}
    </div>

    <div class="sc-detail-section">
      <div class="sc-detail-section-title">Connection</div>
      ${s.host ? `<div class="sc-detail-field"><span class="sc-detail-label">Host</span><span class="sc-detail-value" style="font-family:monospace">${esc(s.host)}${s.port ? ':' + s.port : ''}</span></div>` : ''}
      ${s.protocol ? `<div class="sc-detail-field"><span class="sc-detail-label">Protocol</span><span class="sc-detail-value">${esc(formatProtocol(s.protocol))}</span></div>` : ''}
      ${s.auth_method ? `<div class="sc-detail-field"><span class="sc-detail-label">Auth</span><span class="sc-detail-value">${esc(formatAuthMethod(s.auth_method))}</span></div>` : ''}
      <div class="sc-detail-field"><span class="sc-detail-label">Category</span><span class="sc-detail-value"><span class="sc-card-category sc-cat--${s.category}">${esc(formatCategory(s.category))}</span></span></div>
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
      <div class="sc-detail-code"><button class="sc-detail-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.textContent.replace('Copy','').trim())">Copy</button>${esc(s.connect_command)}</div>
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
      <div class="sc-card-tags">${tags.map(t => `<span class="sc-tag">${esc(t)}</span>`).join('')}</div>
    </div>
    ` : ''}
  `;

  panel.classList.remove('aap-hidden');
  selectedService = s;
}

function closeDetail() {
  document.getElementById('detailPanel').classList.add('aap-hidden');
  selectedService = null;
}

// =============================================
// EVENT HANDLERS
// =============================================

function initCardHandlers() {
  document.getElementById('cardsContainer').addEventListener('click', (e) => {
    const card = e.target.closest('.sc-card');
    if (!card) return;
    const slug = card.dataset.slug;
    const service = allServices.find(s => s.slug === slug);
    if (service) renderDetail(service);
  });
}

function initFilterHandlers() {
  const handler = () => renderCards();
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });

  try {
    allServices = await loadServices();
    renderFilters();
    initCardHandlers();
    initFilterHandlers();

    document.getElementById('loadingState').classList.add('aap-hidden');
    document.getElementById('mainContent').classList.remove('aap-hidden');

    renderCards();
  } catch (err) {
    console.error('Failed to load services:', err);
    document.getElementById('loadingState').innerHTML =
      `<div class="dir-empty"><div class="dir-empty-icon">&#9889;</div><h2>Error Loading Services</h2><p>${esc(err.message)}</p></div>`;
  }
});
