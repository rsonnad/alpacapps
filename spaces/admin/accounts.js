/**
 * Accounts Page — Family Banking & Brokerage Account Registry
 * Hierarchical view of all family accounts with classification, dispersement dates, and statement links.
 */

import { initAdminPage } from '../../shared/admin-shell.js';

// =============================================
// ACCOUNT DATA
// =============================================
const ACCOUNTS = [
  // --- Rahul ---
  { owner: 'Rahul', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-31963711', inherited: false, dispersementDate: null, routingNumber: '121202211' },
  { owner: 'Rahul', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '6434-0566', inherited: false, dispersementDate: null },
  { owner: 'Rahul', type: 'Trading', classification: 'Non-IRA', institution: 'Schwab', number: '5306-2192', inherited: false, dispersementDate: null },
  { owner: 'Rahul', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '2628-4441', inherited: false, dispersementDate: null },
  { owner: 'Rahul', type: 'Traditional IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '8076-3902', inherited: false, dispersementDate: null },
  { owner: 'Rahul', type: 'Inherited Trad IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '6342-5874', inherited: true, dispersementDate: '2031-08-15' },
  { owner: 'Rahul', type: 'Mercer IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '0710-0001-3593-8538-0057-1000-95', inherited: false, dispersementDate: null },
  { owner: 'Rahul', type: 'Banking', classification: 'Banking', institution: 'US Bank', number: '153503737444', inherited: false, dispersementDate: null, routingNumber: '125000105' },

  // --- Kathy ---
  { owner: 'Kathy', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-32358408', inherited: false, dispersementDate: null },
  { owner: 'Kathy', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '3664-4708', inherited: false, dispersementDate: null },
  { owner: 'Kathy', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '3497-3678', inherited: false, dispersementDate: null },
  { owner: 'Kathy', type: 'Traditional IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '6602-1843', inherited: false, dispersementDate: null },

  // --- SubTrust (Revocable Trust of Subhash Sonnad) ---
  { owner: 'SubTrust', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-42890044', inherited: true, dispersementDate: '2031-08-15', notes: 'Revocable Trust of Subhash Sonnad' },
  { owner: 'SubTrust', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '7320-2028', inherited: true, dispersementDate: '2031-08-15', notes: 'Revocable Trust of Subhash Sonnad' },
  { owner: 'SubTrust', type: 'Traditional IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '6448-3403', inherited: true, dispersementDate: '2031-08-15', notes: 'Revocable Trust of Subhash Sonnad' },
  { owner: 'SubTrust', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '2233-0486', inherited: true, dispersementDate: '2031-08-15', notes: 'Revocable Trust of Subhash Sonnad' },

  // --- Haydn ---
  { owner: 'Haydn', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-32372359', inherited: false, dispersementDate: null },
  { owner: 'Haydn', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '2708-4944', inherited: false, dispersementDate: null },
  { owner: 'Haydn', type: 'Brokerage', classification: 'Non-IRA', institution: 'Robinhood', number: '123732554', inherited: false, dispersementDate: null },
  { owner: 'Haydn', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '4180-9797', inherited: false, dispersementDate: null },
  { owner: 'Haydn', type: 'Inherited Trad IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '7545-7692', inherited: true, dispersementDate: '2031-08-15' },
  { owner: 'Haydn', type: 'Roth (Trust)', classification: 'Roth IRA', institution: 'Schwab', number: '3243-8163', inherited: true, dispersementDate: null, notes: 'Trust-held Roth' },
  { owner: 'Haydn', type: 'Traditional (Trust)', classification: 'Traditional IRA', institution: 'Schwab', number: '7380-9661', inherited: true, dispersementDate: null, notes: 'Trust-held Traditional' },

  // --- Emina ---
  { owner: 'Emina', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-32372797', inherited: false, dispersementDate: null },
  { owner: 'Emina', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '9729-7151', inherited: false, dispersementDate: null },
  { owner: 'Emina', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '1728-1387', inherited: false, dispersementDate: null },
  { owner: 'Emina', type: 'Inherited Trad IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '2745-3866', inherited: true, dispersementDate: '2031-08-15' },
  { owner: 'Emina', type: 'Roth (Trust)', classification: 'Roth IRA', institution: 'Schwab', number: '8373-8945', inherited: true, dispersementDate: null, notes: 'Trust-held Roth' },
  { owner: 'Emina', type: 'Traditional (Trust)', classification: 'Traditional IRA', institution: 'Schwab', number: '4055-9200', inherited: true, dispersementDate: null, notes: 'Trust-held Traditional' },

  // --- Hannah ---
  { owner: 'Hannah', type: 'Checking', classification: 'Banking', institution: 'Schwab', number: '4400-32366518', inherited: false, dispersementDate: null },
  { owner: 'Hannah', type: 'Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '5416-8830', inherited: false, dispersementDate: null },
  { owner: 'Hannah', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '3326-5170', inherited: false, dispersementDate: null },
  { owner: 'Hannah', type: 'Inherited Trad IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '8208-3568', inherited: true, dispersementDate: '2031-08-15' },
  { owner: 'Hannah', type: 'Roth (Trust)', classification: 'Roth IRA', institution: 'Schwab', number: '3781-9342', inherited: true, dispersementDate: null, notes: 'Trust-held Roth' },
  { owner: 'Hannah', type: 'Traditional (Trust)', classification: 'Traditional IRA', institution: 'Schwab', number: '7706-6811', inherited: true, dispersementDate: null, notes: 'Trust-held Traditional' },
  { owner: 'Hannah', type: 'Solo 401(k)', classification: 'Traditional IRA', institution: 'Unknown', number: '362?', inherited: false, dispersementDate: null },

  // --- Dina Voronina ---
  { owner: 'Dina Voronina', type: 'Joint Brokerage', classification: 'Non-IRA', institution: 'Schwab', number: '1507-5535', inherited: false, dispersementDate: null, notes: 'Joint account — only her money' },

  // --- Subhash (prior to passing) ---
  { owner: 'Subhash', type: 'Traditional IRA', classification: 'Traditional IRA', institution: 'Schwab', number: '8667-9983', inherited: false, dispersementDate: null, notes: 'Non-trust, prior to passing' },
  { owner: 'Subhash', type: 'Roth IRA', classification: 'Roth IRA', institution: 'Schwab', number: '5296-0622', inherited: false, dispersementDate: null, notes: 'Non-trust, prior to passing' },
  { owner: 'Subhash', type: 'Checking', classification: 'Banking', institution: '5th/3rd Bank', number: '4581867', inherited: false, dispersementDate: null, routingNumber: '072400052' },
  { owner: 'Subhash', type: 'Checking', classification: 'Banking', institution: '5th/3rd Bank', number: '3199497', inherited: false, dispersementDate: null, routingNumber: '072400052' },

  // --- Venmo / AAP ---
  { owner: 'Rahul (AAP)', type: 'Venmo Checking', classification: 'Banking', institution: 'Schwab', number: '4400-52831102', inherited: false, dispersementDate: null, notes: 'Venmo — Alpaca Playhouse matters', routingNumber: '121202211' },
];

// Priority order for hierarchical default sort (highest priority first)
const OWNER_PRIORITY = ['Rahul', 'Rahul (AAP)', 'Kathy', 'SubTrust', 'Haydn', 'Emina', 'Hannah', 'Dina Voronina', 'Subhash'];
const TYPE_PRIORITY = ['Checking', 'Brokerage', 'Trading', 'Roth IRA', 'Traditional IRA', 'Inherited Trad IRA', 'Roth (Trust)', 'Traditional (Trust)', 'Mercer IRA', 'Joint Brokerage', 'Solo 401(k)', 'Venmo Checking', 'Banking'];

// Classification badge colors
const CLASSIFICATION_COLORS = {
  'Banking': { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
  'Non-IRA': { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
  'Roth IRA': { bg: '#f3e5f5', color: '#7b1fa2', border: '#ce93d8' },
  'Traditional IRA': { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
};

// Institution colors
const INSTITUTION_COLORS = {
  'Schwab': '#00a0df',
  'US Bank': '#d32f2f',
  'Robinhood': '#00c805',
  '5th/3rd Bank': '#003b5c',
  'Unknown': '#9e9e9e',
};

// =============================================
// STATE
// =============================================
let currentView = 'hierarchy';
let currentGroupBy = 'owner';
let searchQuery = '';

// =============================================
// RENDER HELPERS
// =============================================
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function classificationBadge(classification) {
  const c = CLASSIFICATION_COLORS[classification] || { bg: '#f5f5f5', color: '#616161', border: '#e0e0e0' };
  return `<span class="acct-badge" style="background:${c.bg};color:${c.color};border:1px solid ${c.border}">${escHtml(classification)}</span>`;
}

function inheritedBadge() {
  return `<span class="acct-badge acct-badge--inherited">Inherited</span>`;
}

function dispersementBadge(date) {
  const d = new Date(date + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const now = new Date();
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  const urgencyClass = diffDays < 365 ? 'acct-badge--urgent' : diffDays < 730 ? 'acct-badge--warning' : 'acct-badge--info';
  return `<span class="acct-badge ${urgencyClass}" title="Required dispersement by ${formatted}">Disp. ${formatted}</span>`;
}

function institutionDot(institution) {
  const color = INSTITUTION_COLORS[institution] || '#9e9e9e';
  return `<span class="acct-inst-dot" style="background:${color}" title="${escHtml(institution)}"></span>`;
}

function maskAccount(number) {
  if (!number || number.length < 4) return number;
  const last4 = number.slice(-4);
  return `····${last4}`;
}

function statementLink(acct) {
  // Link to Schwab or institution statement page
  if (acct.institution === 'Schwab') {
    return `<a href="https://client.schwab.com/app/accounts/statements" target="_blank" rel="noopener" class="acct-stmt-link" title="View statements at Schwab">Statements</a>`;
  }
  if (acct.institution === 'Robinhood') {
    return `<a href="https://robinhood.com/account/documents" target="_blank" rel="noopener" class="acct-stmt-link" title="View statements at Robinhood">Statements</a>`;
  }
  if (acct.institution === 'US Bank') {
    return `<a href="https://onlinebanking.usbank.com/digital/servicing/statements" target="_blank" rel="noopener" class="acct-stmt-link" title="View statements at US Bank">Statements</a>`;
  }
  if (acct.institution === '5th/3rd Bank') {
    return `<a href="https://www.53.com" target="_blank" rel="noopener" class="acct-stmt-link" title="View statements at 5th/3rd">Statements</a>`;
  }
  return '<span class="acct-stmt-na">—</span>';
}

// =============================================
// ACCOUNT CARD (used in grouped view)
// =============================================
function renderAccountCard(acct) {
  const badges = [];
  badges.push(classificationBadge(acct.classification));
  if (acct.inherited) badges.push(inheritedBadge());
  if (acct.dispersementDate) badges.push(dispersementBadge(acct.dispersementDate));

  return `
    <div class="acct-card" data-owner="${escHtml(acct.owner)}" data-type="${escHtml(acct.type)}">
      <div class="acct-card__header">
        <div class="acct-card__title">
          ${institutionDot(acct.institution)}
          <span class="acct-card__type">${escHtml(acct.type)}</span>
        </div>
        <span class="acct-card__number" title="${escHtml(acct.number)}">${maskAccount(acct.number)}</span>
      </div>
      <div class="acct-card__badges">${badges.join('')}</div>
      <div class="acct-card__footer">
        <span class="acct-card__inst">${escHtml(acct.institution)}</span>
        ${statementLink(acct)}
      </div>
      ${acct.notes ? `<div class="acct-card__notes">${escHtml(acct.notes)}</div>` : ''}
    </div>
  `;
}

// =============================================
// GROUPED VIEW
// =============================================
function groupAccounts(accounts, groupBy) {
  const groups = {};
  for (const acct of accounts) {
    const key = acct[groupBy] || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(acct);
  }
  return groups;
}

function sortGroupKeys(keys, groupBy) {
  if (groupBy === 'owner') {
    return keys.sort((a, b) => {
      const ai = OWNER_PRIORITY.indexOf(a);
      const bi = OWNER_PRIORITY.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }
  // For institution/type grouping, sort by count descending
  return keys;
}

function sortAccountsInGroup(accounts) {
  return [...accounts].sort((a, b) => {
    const ai = TYPE_PRIORITY.indexOf(a.type);
    const bi = TYPE_PRIORITY.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function renderGroupedView(accounts) {
  const container = document.getElementById('accountsGrid');
  const groups = groupAccounts(accounts, currentGroupBy);
  const keys = sortGroupKeys(Object.keys(groups), currentGroupBy);

  let html = '';
  for (const key of keys) {
    const sorted = sortAccountsInGroup(groups[key]);
    const inheritedCount = sorted.filter(a => a.inherited).length;
    const dispersementCount = sorted.filter(a => a.dispersementDate).length;

    html += `
      <div class="acct-group">
        <div class="acct-group__header">
          <h3 class="acct-group__title">${escHtml(key)}</h3>
          <div class="acct-group__meta">
            <span class="acct-group__count">${sorted.length} account${sorted.length !== 1 ? 's' : ''}</span>
            ${inheritedCount ? `<span class="acct-group__inherited">${inheritedCount} inherited</span>` : ''}
            ${dispersementCount ? `<span class="acct-group__dispersement">${dispersementCount} w/ dispersement</span>` : ''}
          </div>
        </div>
        <div class="acct-group__cards">
          ${sorted.map(renderAccountCard).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html || '<p class="acct-empty">No accounts match your search.</p>';
}

// =============================================
// FLAT TABLE VIEW
// =============================================
function renderFlatView(accounts) {
  const tbody = document.getElementById('accountsTableBody');
  const sorted = [...accounts].sort((a, b) => {
    const ownerDiff = (OWNER_PRIORITY.indexOf(a.owner) === -1 ? 999 : OWNER_PRIORITY.indexOf(a.owner)) - (OWNER_PRIORITY.indexOf(b.owner) === -1 ? 999 : OWNER_PRIORITY.indexOf(b.owner));
    if (ownerDiff !== 0) return ownerDiff;
    return (TYPE_PRIORITY.indexOf(a.type) === -1 ? 999 : TYPE_PRIORITY.indexOf(a.type)) - (TYPE_PRIORITY.indexOf(b.type) === -1 ? 999 : TYPE_PRIORITY.indexOf(b.type));
  });

  let html = '';
  for (const acct of sorted) {
    html += `
      <tr>
        <td>${escHtml(acct.owner)}</td>
        <td>${escHtml(acct.type)}</td>
        <td>${classificationBadge(acct.classification)}</td>
        <td>${institutionDot(acct.institution)} ${escHtml(acct.institution)}</td>
        <td class="acct-mono" title="${escHtml(acct.number)}">${maskAccount(acct.number)}</td>
        <td>${acct.inherited ? inheritedBadge() : '—'}</td>
        <td>${acct.dispersementDate ? dispersementBadge(acct.dispersementDate) : '—'}</td>
        <td>${statementLink(acct)}</td>
      </tr>
    `;
  }
  tbody.innerHTML = html || '<tr><td colspan="8" class="acct-empty">No accounts match your search.</td></tr>';
}

// =============================================
// FILTER & RENDER
// =============================================
function getFilteredAccounts() {
  if (!searchQuery) return ACCOUNTS;
  const q = searchQuery.toLowerCase();
  return ACCOUNTS.filter(a =>
    a.owner.toLowerCase().includes(q) ||
    a.type.toLowerCase().includes(q) ||
    a.classification.toLowerCase().includes(q) ||
    a.institution.toLowerCase().includes(q) ||
    a.number.toLowerCase().includes(q) ||
    (a.notes && a.notes.toLowerCase().includes(q))
  );
}

function render() {
  const filtered = getFilteredAccounts();
  const grid = document.getElementById('accountsGrid');
  const table = document.getElementById('accountsTable');

  if (currentView === 'hierarchy') {
    grid.classList.remove('hidden');
    table.classList.add('hidden');
    renderGroupedView(filtered);
  } else {
    grid.classList.add('hidden');
    table.classList.remove('hidden');
    renderFlatView(filtered);
  }
}

// =============================================
// EVENT BINDINGS
// =============================================
function bindEvents() {
  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      render();
    });
  });

  // Group by
  const groupSelect = document.getElementById('groupBySelect');
  groupSelect.addEventListener('change', () => {
    currentGroupBy = groupSelect.value;
    render();
  });

  // Search
  const searchInput = document.getElementById('accountSearch');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      render();
    }, 200);
  });
}

// =============================================
// INIT
// =============================================
// Render immediately — account data is static, no Supabase queries needed.
bindEvents();
render();

// Init admin shell for tab nav, auth UI, version info (runs async).
initAdminPage({
  activeTab: 'accounts',
  requiredRole: 'admin',
  section: 'admin',
});
