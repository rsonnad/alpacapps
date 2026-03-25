/**
 * DevControl — AI development tools and activity dashboard
 * Sub-tabs: Overview, Releases, Sessions, Tokens, Context, Backups
 */
import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { getAuthState } from '../../shared/auth.js';

// ═══════════════════════════════════════════════════════════
// CONFIG — project-specific values
// ═══════════════════════════════════════════════════════════
const SESSIONS_API = 'https://claude-sessions.alpacapps.workers.dev';
const SESSIONS_TOKEN = 'alpaca-sessions-2026';
const PROJECT_FILTER = 'genalpaca'; // Only show this project's sessions
const GH_OWNER = 'rsonnad';
const GH_REPO = 'alpacapps';
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}`;
const CONTEXT_WINDOW = 200_000;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
const fmt = (n) => n ? n.toLocaleString() : '0';
const fmtCost = (n) => n ? `$${n.toFixed(2)}` : '$0.00';
const fmtTokensShort = (n) => { if (!n) return ''; return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n); };
const charsToTokens = (c) => Math.round(c / 4);
const fmtDate = (iso) => {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const fmtDuration = (s) => {
  if (!s) return '\u2014';
  return s < 60 ? `${s}s` : s % 60 > 0 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s / 60}m`;
};

const sessionHeaders = { Authorization: `Bearer ${SESSIONS_TOKEN}` };

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ═══════════════════════════════════════════════════════════
// SUB-TAB ROUTING
// ═══════════════════════════════════════════════════════════
let activeSubtab = 'overview';
const loadedTabs = new Set();

function initSubtabs() {
  const hash = location.hash.replace('#', '');
  if (hash && document.getElementById(`dc-panel-${hash}`)) activeSubtab = hash;

  document.querySelectorAll('.dc-manage-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); switchTab(btn.dataset.tab); });
  });
  switchTab(activeSubtab);
}

function switchTab(tab) {
  activeSubtab = tab;
  location.hash = tab === 'overview' ? '' : tab;

  document.querySelectorAll('.dc-manage-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.dc-panel').forEach((p) => { p.style.display = p.id === `dc-panel-${tab}` ? '' : 'none'; });

  if (!loadedTabs.has(tab)) {
    loadedTabs.add(tab);
    const loaders = { overview: loadOverview, releases: loadReleases, sessions: loadSessions, tokens: loadTokens, context: loadContext, backups: loadBackups, planlist: loadPlanList };
    loaders[tab]?.();
  }
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════
function loadOverview() {
  const cards = [
    { tab: 'releases', label: 'Releases', desc: 'Every PR shipped, with version numbers and line counts', icon: '<path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>' },
    { tab: 'sessions', label: 'Sessions', desc: 'AI development session history for this project', icon: '<path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/>' },
    { tab: 'tokens', label: 'Tokens & Cost', desc: 'Token usage, costs, and session analytics', icon: '<path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>' },
    { tab: 'context', label: 'Context Window', desc: 'What files load into Claude\'s context and how much space they use', icon: '<path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>' },
    { tab: 'backups', label: 'Backups', desc: 'Database and file storage backup status', icon: '<path d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"/>' },
    { tab: 'planlist', label: 'PlanList', desc: 'Development todo items, checklists, and project tasks', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>' },
  ];

  const panel = document.getElementById('dc-panel-overview');
  panel.innerHTML = `
    <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">DevControl</h2>
    <p style="color:var(--text-muted,#888);font-size:0.875rem;margin-bottom:1.5rem;">AI-powered development tools and activity</p>
    <div class="dc-overview-grid">
      ${cards.map((c) => `
        <div class="dc-overview-card" data-goto="${c.tab}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
          <div><h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p></div>
        </div>
      `).join('')}
    </div>`;

  panel.querySelectorAll('[data-goto]').forEach((card) => {
    card.addEventListener('click', () => switchTab(card.dataset.goto));
  });
}

// ═══════════════════════════════════════════════════════════
// RELEASES TAB  (GitHub PR changelog)
// ═══════════════════════════════════════════════════════════
async function loadReleases() {
  const panel = document.getElementById('dc-panel-releases');
  panel.innerHTML = '<div class="dc-empty">Loading changelog...</div>';

  try {
    const [prListRes, commitsRes] = await Promise.all([
      fetch(`${GH_API}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
      fetch(`${GH_API}/commits?per_page=100`),
    ]);
    if (!prListRes.ok) throw new Error(`GitHub API ${prListRes.status}`);

    const prList = (await prListRes.json()).filter((pr) => pr.merged_at);
    const commits = commitsRes.ok ? await commitsRes.json() : [];

    // Map PR numbers to version bump SHAs
    const prToVersionSha = {};
    for (let i = 0; i < commits.length; i++) {
      if (commits[i].commit.message.startsWith('chore: bump version')) {
        const next = commits[i + 1];
        if (next) {
          const m = next.commit.message.match(/Merge pull request #(\d+)/);
          if (m) prToVersionSha[parseInt(m[1])] = commits[i].sha;
        }
      }
    }

    // Fetch PR details + version.json in parallel
    const detailPromises = prList.map((pr) =>
      fetch(`${GH_API}/pulls/${pr.number}`).then((r) => r.ok ? r.json() : null).catch(() => null)
    );
    const versionShas = [...new Set(Object.values(prToVersionSha))];
    const versionPromises = versionShas.map((sha) =>
      fetch(`${RAW_BASE}/${sha}/version.json`).then((r) => r.ok ? r.json() : null).catch(() => null)
    );

    const [prDetails, ...versionResults] = await Promise.all([Promise.all(detailPromises), ...versionPromises]);
    const shaToVersion = {};
    versionShas.forEach((sha, i) => { if (versionResults[i]?.version) shaToVersion[sha] = versionResults[i].version; });

    const enriched = prList.map((pr, idx) => {
      const d = prDetails[idx];
      const vSha = prToVersionSha[pr.number];
      return { ...pr, additions: d?.additions ?? 0, deletions: d?.deletions ?? 0, changed_files: d?.changed_files ?? 0, version: vSha ? shaToVersion[vSha] : undefined };
    });

    const totalLines = enriched.reduce((s, pr) => s + pr.additions + pr.deletions, 0);

    // Group by date
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const groups = new Map();
    for (const pr of enriched) {
      const d = new Date(pr.merged_at).toDateString();
      const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(pr.merged_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(pr);
    }

    function categorize(title) {
      const t = title.toLowerCase();
      if (t.startsWith('fix') || t.includes('bug')) return { label: 'Fix', cls: 'dc-release-tag-fix' };
      if (t.includes('add') || t.includes('new')) return { label: 'New', cls: 'dc-release-tag-new' };
      if (t.includes('rewrite') || t.includes('refactor') || t.includes('redesign')) return { label: 'Rewrite', cls: 'dc-release-tag-rewrite' };
      return { label: 'Update', cls: 'dc-release-tag-update' };
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <h2 style="font-size:1.375rem;font-weight:700;margin:0;">Changelog</h2>
          <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin:0.25rem 0 0;">${enriched.length} changes shipped &middot; ${totalLines.toLocaleString()} lines changed</p>
        </div>
        <a href="https://github.com/${GH_OWNER}/${GH_REPO}/pulls?q=is%3Apr+is%3Amerged" target="_blank" rel="noopener" style="font-size:0.8125rem;color:var(--text-muted,#888);">View on GitHub &rarr;</a>
      </div>`;

    for (const [label, prs] of groups) {
      html += `<div class="dc-release-group-label">${esc(label)}</div>`;
      for (const pr of prs) {
        const cat = categorize(pr.title);
        const lines = pr.additions + pr.deletions;
        html += `
          <a href="${esc(pr.html_url)}" target="_blank" rel="noopener" class="dc-release-item">
            <span class="dc-release-tag ${cat.cls}">${cat.label}</span>
            <span class="dc-release-title">${esc(pr.title)}</span>
            <div class="dc-release-meta">
              ${pr.version ? `<span class="dc-release-version">${esc(pr.version)}</span>` : ''}
              ${lines > 0 ? `<span class="dc-release-lines"><span class="plus">+${pr.additions}</span> <span class="minus">-${pr.deletions}</span></span>` : ''}
              <span>#${pr.number}</span>
              <span>${fmtDate(pr.merged_at)}</span>
            </div>
          </a>`;
      }
    }
    panel.innerHTML = html || '<div class="dc-empty">No changes recorded yet.</div>';
  } catch (err) {
    panel.innerHTML = `<div class="dc-empty">Failed to load changelog: ${esc(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// SESSIONS TAB  (single-project only)
// ═══════════════════════════════════════════════════════════
let sessionsState = { items: [], stats: null, search: '', dateFrom: '', dateTo: '', expandedId: null, transcriptCache: {} };

async function loadSessions() {
  const panel = document.getElementById('dc-panel-sessions');

  // Stats
  try {
    const res = await fetch(`${SESSIONS_API}/stats?project=${PROJECT_FILTER}`, { headers: sessionHeaders });
    if (res.ok) sessionsState.stats = await res.json();
  } catch {}

  renderSessionsUI(panel);
  await fetchSessions(panel);
}

function renderSessionsUI(panel) {
  const s = sessionsState.stats;
  panel.innerHTML = `
    <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Sessions</h2>
    <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">AI development session history for this project</p>
    ${s ? `<div class="dc-stats">
      <div class="dc-stat"><div class="dc-stat-value" style="color:#7c3aed">${fmt(s.total_sessions)}</div><div class="dc-stat-label">Sessions</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#059669">${fmt(s.total_tokens)}</div><div class="dc-stat-label">Tokens</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#2563eb">${s.total_minutes ? Math.round(s.total_minutes / 60) + 'h' : '\u2014'}</div><div class="dc-stat-label">Total Hours</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#d97706">${s.avg_duration ? Math.round(s.avg_duration / 60) + 'm' : '\u2014'}</div><div class="dc-stat-label">Avg Duration</div></div>
    </div>` : ''}
    <div class="dc-filters">
      <input type="text" id="dc-sess-search" placeholder="Search sessions..." value="${esc(sessionsState.search)}">
      <input type="date" id="dc-sess-from" value="${sessionsState.dateFrom}">
      <input type="date" id="dc-sess-to" value="${sessionsState.dateTo}">
      <button class="dc-btn-primary" id="dc-sess-go">Search</button>
      <button class="dc-btn-secondary" id="dc-sess-clear">Clear</button>
    </div>
    <div id="dc-sess-list" class="dc-session-list"><div class="dc-empty">Loading...</div></div>`;

  panel.querySelector('#dc-sess-go').addEventListener('click', () => {
    sessionsState.search = panel.querySelector('#dc-sess-search').value;
    sessionsState.dateFrom = panel.querySelector('#dc-sess-from').value;
    sessionsState.dateTo = panel.querySelector('#dc-sess-to').value;
    fetchSessions(panel);
  });
  panel.querySelector('#dc-sess-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') panel.querySelector('#dc-sess-go').click();
  });
  panel.querySelector('#dc-sess-clear').addEventListener('click', () => {
    sessionsState.search = ''; sessionsState.dateFrom = ''; sessionsState.dateTo = '';
    panel.querySelector('#dc-sess-search').value = '';
    panel.querySelector('#dc-sess-from').value = '';
    panel.querySelector('#dc-sess-to').value = '';
    fetchSessions(panel);
  });
}

async function fetchSessions(panel) {
  const list = panel.querySelector('#dc-sess-list');
  list.innerHTML = '<div class="dc-empty">Loading...</div>';

  try {
    const params = new URLSearchParams({ limit: '50', project: PROJECT_FILTER });
    if (sessionsState.search) params.set('search', sessionsState.search);
    if (sessionsState.dateFrom) params.set('from', sessionsState.dateFrom);
    if (sessionsState.dateTo) params.set('to', sessionsState.dateTo);

    const res = await fetch(`${SESSIONS_API}/sessions?${params}`, { headers: sessionHeaders });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    sessionsState.items = data.sessions || data || [];
    renderSessionList(list);
  } catch (err) {
    list.innerHTML = `<div class="dc-empty">Failed to load sessions: ${esc(err.message)}</div>`;
  }
}

function renderSessionList(container) {
  if (!sessionsState.items.length) {
    container.innerHTML = '<div class="dc-empty">No sessions found</div>';
    return;
  }

  container.innerHTML = sessionsState.items.map((s) => {
    const model = s.model ? s.model.replace('claude-', '').split('-202')[0] : '';
    const tokens = fmtTokensShort(s.token_count);
    return `
      <div class="dc-session-card" data-id="${esc(s.id)}">
        <div class="dc-session-header">
          <span class="dc-session-summary">${esc(s.summary || 'No summary')}</span>
          <div class="dc-session-meta">
            <span class="dc-pill dc-pill-date">${esc(fmtDate(s.started_at))}</span>
            ${model ? `<span class="dc-pill dc-pill-model">${esc(model)}</span>` : ''}
            ${s.duration_mins > 0 ? `<span class="dc-pill dc-pill-duration">${s.duration_mins}m</span>` : ''}
            ${tokens ? `<span class="dc-pill dc-pill-tokens">${tokens}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.dc-session-header').forEach((hdr) => {
    hdr.addEventListener('click', () => toggleSession(hdr.closest('.dc-session-card')));
  });
}

async function toggleSession(card) {
  const id = card.dataset.id;
  const existing = card.querySelector('.dc-session-transcript');
  if (existing) { existing.remove(); sessionsState.expandedId = null; return; }

  // Collapse any other
  document.querySelectorAll('.dc-session-transcript').forEach((el) => el.remove());
  sessionsState.expandedId = id;

  // Fetch full transcript
  if (!sessionsState.transcriptCache[id]) {
    try {
      const res = await fetch(`${SESSIONS_API}/sessions/${id}`, { headers: sessionHeaders });
      if (res.ok) { const data = await res.json(); sessionsState.transcriptCache[id] = data.transcript || ''; }
    } catch {}
  }

  const transcript = sessionsState.transcriptCache[id] || '';
  const messages = parseTranscript(transcript);

  const div = document.createElement('div');
  div.className = 'dc-session-transcript';
  div.innerHTML = `
    <div class="dc-transcript-actions">
      <button class="dc-copy-btn" data-copy-full>Copy Full Session</button>
    </div>
    <div class="dc-transcript-messages">
      ${messages.length ? messages.map((m, i) => `
        <div class="dc-msg ${m.role === 'USER' ? 'dc-msg-user' : 'dc-msg-assistant'}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="dc-msg-role">${m.role}</span>
            <button class="dc-copy-btn" data-copy-idx="${i}">Copy</button>
          </div>
          <div style="font-family:inherit;white-space:pre-wrap;font-size:0.8125rem;line-height:1.6;">${esc(m.content.length > 3000 ? m.content.substring(0, 3000) + '\n\n... [truncated]' : m.content)}</div>
        </div>
      `).join('') : '<div class="dc-empty">No transcript available</div>'}
    </div>`;

  div.querySelector('[data-copy-full]')?.addEventListener('click', function () {
    copyToClipboard(messages.map((m) => `### ${m.role}\n\n${m.content}`).join('\n\n---\n\n'), this);
  });
  div.querySelectorAll('[data-copy-idx]').forEach((btn) => {
    btn.addEventListener('click', function () { copyToClipboard(messages[parseInt(this.dataset.copyIdx)].content, this); });
  });

  card.appendChild(div);
}

function parseTranscript(text) {
  if (!text) return [];
  return text.split(/\n---\n/).map((part) => {
    part = part.trim();
    if (!part) return null;
    const role = part.startsWith('## User') ? 'USER' : 'ASSISTANT';
    const content = part.replace(/^## (User|Assistant)\n?/, '').trim();
    return { role, content };
  }).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════
// TOKENS TAB
// ═══════════════════════════════════════════════════════════
async function loadTokens() {
  const panel = document.getElementById('dc-panel-tokens');
  panel.innerHTML = '<div class="dc-empty">Loading token analytics...</div>';

  try {
    const [statsRes, sessionsRes] = await Promise.all([
      fetch(`${SESSIONS_API}/stats?project=${PROJECT_FILTER}`, { headers: sessionHeaders }),
      fetch(`${SESSIONS_API}/sessions?limit=200&project=${PROJECT_FILTER}`, { headers: sessionHeaders }),
    ]);

    const stats = statsRes.ok ? await statsRes.json() : {};
    const sessData = sessionsRes.ok ? await sessionsRes.json() : {};
    const sessions = sessData.sessions || sessData || [];

    // Group by day
    const byDay = {};
    for (const s of sessions) {
      const d = s.started_at ? new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'unknown';
      if (!byDay[d]) byDay[d] = { tokens: 0, sessions: 0 };
      byDay[d].tokens += s.token_count || 0;
      byDay[d].sessions += 1;
    }
    const dayEntries = Object.entries(byDay).map(([date, data]) => ({ date, ...data })).reverse();
    const maxDayTokens = Math.max(...dayEntries.map((d) => d.tokens), 1);

    // Group by model
    const byModel = {};
    for (const s of sessions) {
      const k = s.model ? s.model.replace('claude-', '').split('-202')[0] : 'unknown';
      if (!byModel[k]) byModel[k] = { tokens: 0, sessions: 0 };
      byModel[k].tokens += s.token_count || 0;
      byModel[k].sessions += 1;
    }
    const modelEntries = Object.entries(byModel).map(([key, data]) => ({ key, ...data })).sort((a, b) => b.tokens - a.tokens);

    panel.innerHTML = `
      <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Tokens & Cost</h2>
      <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">Token usage and session analytics for this project</p>

      <div class="dc-stats">
        <div class="dc-stat"><div class="dc-stat-value" style="color:#059669">${fmt(stats.total_tokens || 0)}</div><div class="dc-stat-label">Total Tokens</div></div>
        <div class="dc-stat"><div class="dc-stat-value" style="color:#d97706">${fmtCost(stats.total_cost || 0)}</div><div class="dc-stat-label">Total Cost</div></div>
        <div class="dc-stat"><div class="dc-stat-value" style="color:#2563eb">${fmt(Math.round(stats.avg_tokens || 0))}</div><div class="dc-stat-label">Avg / Session</div></div>
        <div class="dc-stat"><div class="dc-stat-value" style="color:#7c3aed">${fmt(stats.total_sessions || 0)}</div><div class="dc-stat-label">Sessions</div></div>
      </div>

      ${dayEntries.length ? `
        <h3 class="dc-section-header">Daily Token Usage</h3>
        <div style="border:1px solid var(--border,#e2e0db);border-radius:12px;padding:1rem;background:var(--bg-card,#fff);margin-bottom:1.5rem;">
          ${dayEntries.map((d) => `
            <div class="dc-bar-row">
              <span class="dc-bar-label">${esc(d.date)}</span>
              <div class="dc-bar-track"><div class="dc-bar-fill" style="width:${(d.tokens / maxDayTokens) * 100}%"></div></div>
              <span class="dc-bar-value">${fmt(d.tokens)}</span>
            </div>
          `).join('')}
        </div>` : ''}

      ${modelEntries.length ? `
        <h3 class="dc-section-header">By Model</h3>
        <div class="dc-table-wrap">
          <table class="dc-table">
            <thead><tr><th>Model</th><th class="text-right">Sessions</th><th class="text-right">Tokens</th></tr></thead>
            <tbody>
              ${modelEntries.map((r) => `<tr><td class="mono">${esc(r.key)}</td><td class="text-right tabular">${r.sessions}</td><td class="text-right tabular">${fmt(r.tokens)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}`;
  } catch (err) {
    panel.innerHTML = `<div class="dc-empty">Failed to load token data: ${esc(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// CONTEXT TAB
// ═══════════════════════════════════════════════════════════

function renderTokenHistoryChart(snapshots, currentAlways) {
  if (snapshots.length === 0 && !currentAlways) return '';

  const today = new Date().toISOString().split('T')[0];
  const points = [...snapshots.filter((s) => s.snapshot_date !== today)];
  if (currentAlways > 0) {
    points.push({ snapshot_date: today, always_loaded_tokens: currentAlways, total_tokens: 0 });
  }
  if (points.length < 2) {
    return `
      <div style="border:1px solid var(--border,#e2e0db);border-radius:12px;padding:1.25rem;background:var(--bg-card,#fff);margin-bottom:1.5rem;">
        <h3 class="dc-section-header" style="margin-bottom:0.25rem;">Always-Loaded Tokens — Last 90 Days</h3>
        <p style="color:var(--text-muted,#aaa);font-size:0.75rem;">Not enough data yet. Check back tomorrow.</p>
      </div>`;
  }

  points.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const values = points.map((p) => p.always_loaded_tokens);
  const minVal = Math.min(...values) * 0.9;
  const maxVal = Math.max(...values) * 1.1;
  const range = maxVal - minVal || 1;

  const W = 700, H = 180;
  const PAD = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xScale = (i) => PAD.left + (i / (points.length - 1)) * plotW;
  const yScale = (v) => PAD.top + plotH - ((v - minVal) / range) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.always_loaded_tokens).toFixed(1)}`).join(' ');
  const area = `${line} L${xScale(points.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${PAD.left},${(PAD.top + plotH).toFixed(1)} Z`;

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount }, (_, i) => minVal + (range * i) / (tickCount - 1));
  const labelInterval = Math.max(1, Math.floor(points.length / 5));

  function fmtTokShort(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString(); }

  const latest = values[values.length - 1];
  const earliest = values[0];
  const delta = latest - earliest;
  const deltaPct = earliest > 0 ? ((delta / earliest) * 100).toFixed(1) : '0';
  const deltaColor = delta > 0 ? '#ef4444' : delta < 0 ? '#10b981' : '#94a3b8';
  const deltaSign = delta > 0 ? '+' : '';

  let gridLines = '';
  for (const v of yTicks) {
    gridLines += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yScale(v).toFixed(1)}" y2="${yScale(v).toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5"/>`;
    gridLines += `<text x="${PAD.left - 6}" y="${(yScale(v) + 3).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="9">${fmtTokShort(Math.round(v))}</text>`;
  }

  let dataDots = '';
  const dotR = points.length > 30 ? 1.5 : 3;
  for (let i = 0; i < points.length; i++) {
    dataDots += `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(points[i].always_loaded_tokens).toFixed(1)}" r="${dotR}" fill="#6366f1"/>`;
  }

  let xLabels = '';
  for (let i = 0; i < points.length; i++) {
    if (i % labelInterval === 0 || i === points.length - 1) {
      const d = new Date(points[i].snapshot_date + 'T00:00:00');
      xLabels += `<text x="${xScale(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" fill="#94a3b8" font-size="9">${d.getMonth() + 1}/${d.getDate()}</text>`;
    }
  }

  return `
    <div style="border:1px solid var(--border,#e2e0db);border-radius:12px;padding:1.25rem;background:var(--bg-card,#fff);margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <div>
          <h3 style="font-size:0.875rem;font-weight:600;color:var(--text,#1e1e1e);margin:0;">Always-Loaded Tokens — Last 90 Days</h3>
          <p style="color:var(--text-muted,#aaa);font-size:0.75rem;margin:0.125rem 0 0;">${points.length} data points</p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.125rem;font-weight:700;color:var(--text,#1e1e1e);font-variant-numeric:tabular-nums;">${fmtTokShort(latest)}</div>
          <div style="font-size:0.75rem;font-weight:500;color:${deltaColor};font-variant-numeric:tabular-nums;">${deltaSign}${fmtTokShort(delta)} (${deltaSign}${deltaPct}%)</div>
        </div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:200px;">
        ${gridLines}
        <defs><linearGradient id="ctxAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity="0.15"/><stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/></linearGradient></defs>
        <path d="${area}" fill="url(#ctxAreaGrad)"/>
        <path d="${line}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round"/>
        ${dataDots}
        ${xLabels}
      </svg>
    </div>`;
}

async function loadContext() {
  const panel = document.getElementById('dc-panel-context');
  panel.innerHTML = '<div class="dc-empty">Loading file sizes...</div>';

  const CONTEXT_FILES = [
    { name: 'Global CLAUDE.md', path: '~/.claude/CLAUDE.md', category: 'instructions',
      desc: 'User\'s private global instructions for all projects. Contains project identity checks (keyword-to-directory mapping), Bitwarden CLI unlock helpers, and gstack skill routing. Loaded in every session regardless of project.' },
    { name: 'Project CLAUDE.md', path: './CLAUDE.md', category: 'instructions', gh: 'CLAUDE.md',
      desc: 'Project-specific directives and code guards for AlpacApps. Defines mandatory behaviors (version stamping, push-on-change, CI versioning), code guards (media_spaces naming, showToast, Tailwind aap-* tokens, hero banner protection), on-demand doc loading triggers, and quick refs for the tech stack (Vanilla HTML/JS, Tailwind v4, Supabase, GitHub Pages, Capacitor 8).' },
    { name: 'CLAUDE.local.md', path: './CLAUDE.local.md', category: 'instructions',
      desc: 'Local overrides not committed to the repo. Contains machine-specific settings, experimental flags, or temporary behavioral overrides that only apply to one developer\'s environment. Loaded at startup but invisible to other contributors.' },
    { name: 'MEMORY.md', path: 'memory/MEMORY.md', category: 'memory', gh: 'memory/MEMORY.md',
      desc: 'Persistent memory index that carries context across conversations. Contains home automation endpoints (Sonos, WiZ lights, Music Assistant), data lookup routing (which Supabase table answers which question), quick DB query templates, SSH access gotchas, and pointers to detailed memory files for sessions, service access, and cloud infrastructure.' },
    { name: 'System prompt', path: '(built-in)', category: 'system',
      desc: 'Claude\'s built-in system prompt including tool definitions, environment detection, safety guidelines, and behavioral instructions. This is fixed by Anthropic and not editable. It defines how Claude reasons, uses tools, handles permissions, and interacts with the filesystem. Always present in every conversation.' },
    { name: 'SCHEMA.md', path: 'docs/SCHEMA.md', category: 'docs', gh: 'docs/SCHEMA.md',
      desc: 'Complete Supabase database schema reference. Documents every table (spaces, people, assignments, password_vault, nest_devices, vehicles, camera_streams, stripe_payments, sms_messages, inbound_emails, amazon_orders, etc.), their columns, types, foreign keys, RLS policies, and indexes. Essential for writing correct SQL queries, debugging data issues, and understanding entity relationships.' },
    { name: 'PATTERNS.md', path: 'docs/PATTERNS.md', category: 'docs', gh: 'docs/PATTERNS.md',
      desc: 'UI development patterns and Tailwind styling conventions. Defines the aap-* design token system (colors, spacing, typography, border radius), component patterns (cards, modals, toasts, tables, lightbox), shared JS utilities (showToast, openLightbox, initAdminPage), responsive breakpoints, and testing checklists. The authoritative guide for writing frontend code that matches the existing design system.' },
    { name: 'KEY-FILES.md', path: 'docs/KEY-FILES.md', category: 'docs', gh: 'docs/KEY-FILES.md',
      desc: 'Project structure and file location index. Maps the full directory tree — shared/ (auth, navigation, Supabase client), spaces/admin/ (management dashboards), jackie/ (property management pages), residents/ (tenant-facing views), vendor/ (third-party libs), edge functions, and static assets. Use this to find where code lives before making changes.' },
    { name: 'DEPLOY.md', path: 'docs/DEPLOY.md', category: 'docs', gh: 'docs/DEPLOY.md',
      desc: 'Deployment pipeline documentation. Covers the GitHub Pages deploy flow (push to main triggers build), CI version bumping (automated vYYMMDD.NN format), edge function deployment via Supabase CLI, DNS/domain configuration, cache invalidation, and rollback procedures. Read this before pushing changes or troubleshooting deploy failures.' },
    { name: 'INTEGRATIONS.md', path: 'docs/INTEGRATIONS.md', category: 'docs', gh: 'docs/INTEGRATIONS.md',
      desc: 'External API and vendor integration reference. Documents Supabase (auth, storage, realtime, edge functions), Stripe (payments, webhooks), Telnyx (SMS), Resend (email), Google (OAuth, Maps), Nest (thermostats), Tesla (vehicles), UniFi (cameras, sensors), Govee/WiZ (smart lights), LG (appliances), and Capacitor (mobile). Includes API keys location, webhook URLs, rate limits, and pricing notes.' },
    { name: 'CHANGELOG.md', path: 'docs/CHANGELOG.md', category: 'docs', gh: 'docs/CHANGELOG.md',
      desc: 'Chronological record of significant changes, features, and fixes. Organized by date with version numbers, affected files, and migration notes. Use this to understand what changed recently, why a migration was done, or what context led to a particular architectural decision. Critical for onboarding and debugging regressions.' },
    { name: 'CAD.md', path: 'docs/CAD.md', category: 'docs', gh: 'docs/CAD.md',
      desc: 'CAD and 3D modeling tool reference for the property site plan system. Documents installed software on Paca's Mac mini (192.168.1.100): Blender 4.5.7 (3D modeling, rendering, Grease Pencil drafting), QGIS 4.0.0 (GIS parcel data, map composition), LibreCAD 2.x (2D DXF drafting), GDAL 3.12.0 (format conversion). Lists Blender add-ons (Bonsai/BlenderBIM, BlenderGIS, CAD Sketcher, Archipack, MeasureIt-ARCH), GIS data sources for Bastrop County, and quick-start workflows for site plans, 2D drafting, and headless rendering.' },
    { name: 'CAD-SITE-PLANS.md', path: 'docs/CAD-SITE-PLANS.md', category: 'docs', gh: 'docs/CAD-SITE-PLANS.md',
      desc: 'End-to-end site plan generation guide for 160 Still Forest Drive, Cedar Creek TX (Bastrop County). Covers the two-machine pipeline (Almaca design workstation + Hostinger VPS automation backend), all deliverables (county permit sheets, 3D renders, interactive maps, automated permit packets), step-by-step workflows (QGIS base map → Blender 3D scene → BlenderBIM permit sheets → presentation renders → packet assembly), GIS data sources (TNRIS, USGS 3DEP LiDAR, FEMA flood, TCEQ environmental), and AlpacApps integration plans (live property map, on-demand render API, automated permit packet generation).' },
  ];

  const SYSTEM_PROMPT_TOKENS = 8000;
  const CAT = {
    instructions: { label: 'Instructions', bar: '#3b82f6' },
    memory: { label: 'Memory', bar: '#8b5cf6' },
    docs: { label: 'On-Demand Docs', bar: '#d97706' },
    system: { label: 'System', bar: '#6b7280' },
  };

  // Fetch last 90 days of snapshots
  let snapshots = [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const { data } = await supabase
      .from('context_snapshots')
      .select('snapshot_date, always_loaded_tokens, total_tokens')
      .gte('snapshot_date', cutoff.toISOString().split('T')[0])
      .order('snapshot_date');
    if (data) snapshots = data;
  } catch {}

  const items = await Promise.all(CONTEXT_FILES.map(async (f) => {
    if (f.category === 'system') return { ...f, tokens: SYSTEM_PROMPT_TOKENS };
    if (f.gh) {
      try {
        const res = await fetch(`${RAW_BASE}/main/${f.gh}`);
        if (res.ok) { const text = await res.text(); return { ...f, tokens: charsToTokens(text.length) }; }
      } catch {}
    }
    const estimates = { 'Global CLAUDE.md': 1048, 'CLAUDE.local.md': 800, 'MEMORY.md': 600 };
    return { ...f, tokens: charsToTokens(estimates[f.name] || 200) };
  }));

  const alwaysLoaded = items.filter((i) => i.category !== 'docs');
  const onDemand = items.filter((i) => i.category === 'docs');
  const alwaysTokens = alwaysLoaded.reduce((s, i) => s + i.tokens, 0);
  const onDemandTokens = onDemand.reduce((s, i) => s + i.tokens, 0);
  const totalTokens = alwaysTokens + onDemandTokens;
  const alwaysPct = ((alwaysTokens / CONTEXT_WINDOW) * 100).toFixed(1);
  const totalPct = ((totalTokens / CONTEXT_WINDOW) * 100).toFixed(1);

  // Record today's snapshot
  try {
    const breakdown = {};
    for (const i of items) breakdown[i.category] = (breakdown[i.category] || 0) + i.tokens;
    await supabase.from('context_snapshots').upsert(
      { snapshot_date: new Date().toISOString().split('T')[0], always_loaded_tokens: alwaysTokens, total_tokens: totalTokens, breakdown },
      { onConflict: 'snapshot_date' }
    );
  } catch {}

  const catTotals = {};
  for (const i of items) catTotals[i.category] = (catTotals[i.category] || 0) + i.tokens;
  const catSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  function fmtTok(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString(); }

  // Cache for fetched file contents
  const contentCache = {};

  function renderFileTable(files, label, sublabel) {
    const total = files.reduce((s, f) => s + f.tokens, 0);
    const tableId = label.replace(/\s+/g, '-').toLowerCase();
    return `
      <h3 class="dc-section-header">${esc(label)}</h3>
      ${sublabel ? `<p class="dc-section-sub">${esc(sublabel)}</p>` : ''}
      <div class="dc-table-wrap">
        <table class="dc-table" id="ctx-table-${tableId}">
          <thead><tr><th>File</th><th>Description</th><th class="text-right">Tokens</th><th class="text-right">% of Window</th></tr></thead>
          <tbody>
            ${files.sort((a, b) => b.tokens - a.tokens).map((f, idx) => {
              const expandId = `ctx-expand-${tableId}-${idx}`;
              const canExpand = !!f.gh;
              return `
              <tr class="${canExpand ? 'dc-expandable-row' : ''}" ${canExpand ? `data-gh="${esc(f.gh)}" data-expand-id="${expandId}" onclick="window._toggleContextRow(this)"` : ''} style="${canExpand ? 'cursor:pointer;' : ''}">
                <td>
                  ${canExpand ? `<span class="dc-expand-arrow" style="display:inline-block;width:12px;margin-right:4px;font-size:0.6rem;color:var(--text-muted,#888);transition:transform 0.15s;">&#9654;</span>` : `<span style="display:inline-block;width:16px;"></span>`}
                  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CAT[f.category]?.bar || '#999'};margin-right:6px;vertical-align:middle;"></span><span class="mono">${esc(f.name)}</span>
                </td>
                <td style="color:var(--text-muted,#888);font-size:0.75rem;">${esc(f.desc)}</td>
                <td class="text-right tabular" style="font-weight:500;">${fmtTok(f.tokens)}</td>
                <td class="text-right tabular" style="font-size:0.75rem;color:var(--text-muted,#888);">${((f.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%</td>
              </tr>
              <tr id="${expandId}" class="dc-expand-content" style="display:none;">
                <td colspan="4" style="padding:0;">
                  <div class="dc-file-preview"><div class="dc-empty" style="padding:1rem;">Click to load content...</div></div>
                </td>
              </tr>`;
            }).join('')}
            <tr class="total-row"><td style="font-weight:600;">Total</td><td></td><td class="text-right tabular" style="font-weight:700;">${fmtTok(total)}</td><td class="text-right tabular" style="font-size:0.75rem;font-weight:600;">${((total / CONTEXT_WINDOW) * 100).toFixed(1)}%</td></tr>
          </tbody>
        </table>
      </div>`;
  }

  // Toggle expand/collapse for context file rows
  window._toggleContextRow = async function(tr) {
    const expandId = tr.getAttribute('data-expand-id');
    const ghPath = tr.getAttribute('data-gh');
    const expandRow = document.getElementById(expandId);
    const arrow = tr.querySelector('.dc-expand-arrow');
    if (!expandRow) return;

    const isOpen = expandRow.style.display !== 'none';
    if (isOpen) {
      expandRow.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      return;
    }

    expandRow.style.display = '';
    if (arrow) arrow.style.transform = 'rotate(90deg)';

    const previewDiv = expandRow.querySelector('.dc-file-preview');
    if (contentCache[ghPath]) {
      previewDiv.innerHTML = contentCache[ghPath];
      return;
    }

    previewDiv.innerHTML = '<div class="dc-empty" style="padding:1rem;">Loading...</div>';
    try {
      const res = await fetch(`${RAW_BASE}/main/${ghPath}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      const lines = text.split('\n');
      const preview = lines.slice(0, 80).join('\n');
      const truncated = lines.length > 80;
      const html = `<pre class="dc-file-content">${esc(preview)}${truncated ? `\n\n<span style="color:var(--text-muted,#888);font-style:italic;">... ${lines.length - 80} more lines — <a href="https://github.com/${GH_OWNER}/${GH_REPO}/blob/main/${ghPath}" target="_blank" style="color:var(--accent,#b8a88a);">view full file on GitHub</a></span>` : ''}</pre>`;
      contentCache[ghPath] = html;
      previewDiv.innerHTML = html;
    } catch (err) {
      previewDiv.innerHTML = `<div class="dc-empty" style="padding:1rem;color:#c62828;">Failed to load: ${esc(err.message)}</div>`;
    }
  };

  function renderDocReferenceMap() {
    const catColors = { instructions: '#3b82f6', memory: '#8b5cf6', system: '#6b7280', docs: '#d97706' };
    function nodeColor(name) {
      const f = CONTEXT_FILES.find(f => f.name === name);
      return f ? (catColors[f.category] || '#d97706') : '#999';
    }

    function tag(name, hint) {
      const c = nodeColor(name);
      const hintSpan = hint ? `<span style="color:var(--text-muted,#999);font-weight:400;margin-left:0.375rem;font-size:0.6875rem;">${hint}</span>` : '';
      return `<span style="display:inline-flex;align-items:center;gap:0.25rem;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;"></span><span style="font-weight:600;font-size:0.8125rem;">${name}</span>${hintSpan}</span>`;
    }

    // Tree structure: each node can have children with relationship labels
    const treeHTML = `
      <div class="dc-ref-tree">
        <style>
          .dc-ref-tree { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 0.8125rem; }
          .dc-ref-tree ul { list-style: none; margin: 0; padding-left: 1.5rem; }
          .dc-ref-tree > ul { padding-left: 0; }
          .dc-ref-tree li { position: relative; padding: 0.25rem 0; }
          .dc-ref-tree li::before { content: ''; position: absolute; left: -1rem; top: 0; bottom: 0.75rem; width: 1px; border-left: 1px solid var(--border, #ddd); }
          .dc-ref-tree li::after { content: ''; position: absolute; left: -1rem; top: 0.9rem; width: 0.75rem; height: 1px; border-bottom: 1px solid var(--border, #ddd); }
          .dc-ref-tree li:last-child::before { bottom: auto; height: 0.9rem; }
          .dc-ref-tree > ul > li::before, .dc-ref-tree > ul > li::after { display: none; }
          .dc-ref-tree .dc-tree-group { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted, #aaa); margin-top: 0.75rem; margin-bottom: 0.125rem; }
          .dc-ref-tree .dc-tree-group:first-child { margin-top: 0; }
        </style>
        <ul>
          <li>
            <div class="dc-tree-group">Always Loaded</div>
            <ul>
              <li>${tag('Global CLAUDE.md', 'user-level rules')}</li>
              <li>
                ${tag('Project CLAUDE.md', 'project directives — on-demand loader')}
                <ul>
                  <li>${tag('SCHEMA.md', 'load for queries')}
                    <ul><li>${tag('INTEGRATIONS.md', 'table ↔ API mapping')}</li></ul>
                  </li>
                  <li>${tag('PATTERNS.md', 'load for UI code')}
                    <ul><li>${tag('KEY-FILES.md', 'component locations')}</li></ul>
                  </li>
                  <li>${tag('KEY-FILES.md', 'load for file search')}</li>
                  <li>${tag('DEPLOY.md', 'load for deploys')}
                    <ul><li>${tag('CHANGELOG.md', 'version history')}</li></ul>
                  </li>
                  <li>${tag('INTEGRATIONS.md', 'load for APIs')}</li>
                  <li>${tag('CHANGELOG.md', 'load for history')}</li>
                  <li>${tag('CAD.md', 'load for 3D/CAD')}
                    <ul><li>${tag('CAD-SITE-PLANS.md', 'tool ref → workflow')}
                      <ul><li>${tag('INTEGRATIONS.md', 'Supabase/edge fns')}</li></ul>
                    </li></ul>
                  </li>
                  <li>${tag('CAD-SITE-PLANS.md', 'load for site plans')}</li>
                </ul>
              </li>
              <li>${tag('CLAUDE.local.md', 'local overrides')}</li>
              <li>
                ${tag('MEMORY.md', 'persistent memory index')}
                <ul>
                  <li>${tag('SCHEMA.md', 'data lookup routing')}</li>
                  <li>${tag('INTEGRATIONS.md', 'service access refs')}</li>
                </ul>
              </li>
              <li>${tag('System prompt', 'Claude context')}</li>
            </ul>
          </li>
        </ul>
      </div>`;

    return `
      <h3 class="dc-section-header" style="margin-top:1.5rem;">Document Reference Map</h3>
      <p class="dc-section-sub">How context documents reference and depend on each other</p>
      <div class="dc-table-wrap" style="padding:1.25rem;overflow-x:auto;">
        ${treeHTML}
      </div>`;
  }

  panel.innerHTML = `
    <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Context Window</h2>
    <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">${fmtTok(alwaysTokens)} tokens loaded on startup (${alwaysPct}% of ${fmtTok(CONTEXT_WINDOW)} window)</p>

    ${renderTokenHistoryChart(snapshots, alwaysTokens)}

    <div class="dc-context-bar-wrap">
      <div class="dc-context-bar-header"><span>Context Window Usage</span><span>${fmtTok(CONTEXT_WINDOW)} total capacity</span></div>
      <div class="dc-context-bar">
        ${catSorted.map(([cat, tokens]) => `<div style="width:${(tokens / CONTEXT_WINDOW) * 100}%;height:100%;background:${CAT[cat]?.bar || '#999'}" title="${CAT[cat]?.label}: ${fmtTok(tokens)} tokens"></div>`).join('')}
      </div>
      <div class="dc-context-legend">
        ${catSorted.map(([cat, tokens]) => `
          <div class="dc-context-legend-item">
            <div class="dc-context-legend-dot" style="background:${CAT[cat]?.bar || '#999'}"></div>
            <span style="font-weight:500;">${CAT[cat]?.label}</span>
            <span style="color:var(--text-muted,#aaa);">${fmtTok(tokens)} (${((tokens / CONTEXT_WINDOW) * 100).toFixed(1)}%)</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="dc-stats">
      <div class="dc-stat"><div class="dc-stat-value" style="color:#059669">${fmtTok(alwaysTokens)}</div><div class="dc-stat-label">Always Loaded</div><div class="dc-stat-sub">${alwaysPct}%</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#d97706">${fmtTok(onDemandTokens)}</div><div class="dc-stat-label">On-Demand Docs</div><div class="dc-stat-sub">loaded as needed</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#2563eb">${fmtTok(totalTokens)}</div><div class="dc-stat-label">Total if All Loaded</div><div class="dc-stat-sub">${totalPct}%</div></div>
      <div class="dc-stat"><div class="dc-stat-value" style="color:#7c3aed">${fmtTok(CONTEXT_WINDOW - alwaysTokens)}</div><div class="dc-stat-label">Remaining for Chat</div><div class="dc-stat-sub">${(100 - parseFloat(alwaysPct)).toFixed(1)}%</div></div>
    </div>

    ${renderFileTable(alwaysLoaded, 'Always Loaded at Startup')}
    ${renderFileTable(onDemand, 'On-Demand Docs', 'Loaded when the task matches \u2014 not always in context')}
    ${renderDocReferenceMap()}`;
}

// ═══════════════════════════════════════════════════════════
// BACKUPS TAB
// ═══════════════════════════════════════════════════════════
async function loadBackups() {
  const panel = document.getElementById('dc-panel-backups');
  panel.innerHTML = '<div class="dc-empty">Loading backup logs...</div>';

  try {
    const { data: logs, error } = await supabase
      .from('backup_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const last = (logs || []).find((l) => l.backup_type === 'full-to-rvault');
    const lastDays = last ? daysSince(last.created_at) : null;
    const d = last?.details || {};

    function agoBadge(days) {
      if (days === null) return '';
      const text = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      return `<span class="${days > 8 ? 'dc-stale-badge' : ''}" style="font-size:0.75rem;margin-left:0.5rem;">${text}</span>`;
    }

    function svcBadge(svc) {
      const s = d[svc];
      if (!s) return '<span style="font-size:0.6875rem;color:var(--text-muted,#aaa);">no data</span>';
      const color = s.status === 'success' ? '#2e7d32' : s.status === 'error' ? '#c62828' : '#e65100';
      const bg = s.status === 'success' ? '#e8f5e9' : s.status === 'error' ? '#ffebee' : '#fff3e0';
      return `<span style="font-size:0.6875rem;padding:1px 6px;border-radius:999px;color:${color};background:${bg}">${s.status}</span>`;
    }

    function svcDetail(svc) {
      const s = d[svc];
      if (!s?.detail) return '';
      if (typeof s.detail === 'string') return `<span style="font-size:0.75rem;color:var(--text-muted,#aaa);">${esc(s.detail)}</span>`;
      if (s.detail.files != null) return `<span style="font-size:0.75rem;color:var(--text-muted,#aaa);">${s.detail.files} files (${s.detail.size || '?'})</span>`;
      if (s.detail.commits != null) return `<span style="font-size:0.75rem;color:var(--text-muted,#aaa);">${s.detail.commits} commits, ${s.detail.branches} branches</span>`;
      return '';
    }

    const services = [
      { key: 'supabase', icon: '🗄', label: 'Supabase DB', desc: 'pg_dump → gzip → RVAULT20' },
      { key: 'r2',       icon: '☁', label: 'Cloudflare R2', desc: 'S3 sync alpacapps bucket' },
      { key: 'd1',       icon: '📋', label: 'Cloudflare D1', desc: 'claude-sessions export' },
      { key: 'github',   icon: '🔀', label: 'GitHub Repo', desc: 'Bare mirror of rsonnad/alpacapps' },
    ];

    panel.innerHTML = `
      <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Backups</h2>
      <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:0.5rem;">Weekly automated backups to RVAULT20 external drive — Mondays 1:00 AM.</p>
      ${last ? `<p style="font-size:0.8125rem;margin-bottom:1.25rem;">Last run: <strong>${fmtDate(last.created_at)}</strong>${agoBadge(lastDays)} · ${fmtDuration(last.duration_seconds)}${d.total_size ? ` · ${d.total_size} total` : ''}</p>` : '<p style="font-size:0.8125rem;color:var(--text-muted,#aaa);margin-bottom:1.25rem;">No backups recorded yet.</p>'}

      <div class="dc-backup-grid">
        ${services.map(svc => `
          <div class="dc-backup-card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h3>${svc.icon} ${svc.label}</h3>
              ${last ? svcBadge(svc.key) : ''}
            </div>
            <p>${svc.desc}</p>
            ${last ? `<div class="dc-backup-last">${svcDetail(svc.key)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div style="margin-bottom:1.5rem;">
        <p style="font-size:0.75rem;color:var(--text-muted,#aaa);">
          <strong>Storage:</strong> /Volumes/RVAULT20/backups/alpacapps/ · <strong>Cron:</strong> Almaca · <strong>Retention:</strong> 12 DB dumps, 12 D1 exports, full R2 mirror, bare Git mirror
        </p>
      </div>

      <h3 class="dc-section-header">Activity Log</h3>
      ${!logs?.length ? '<div class="dc-empty">No backup logs yet.</div>' : `
        <div class="dc-table-wrap">
          <table class="dc-table">
            <thead><tr><th>Date</th><th>Status</th><th>Duration</th><th>Services</th><th>Size</th></tr></thead>
            <tbody>
              ${logs.map((l) => {
                const det = l.details || {};
                const statusCls = l.status === 'success' ? 'color:#2e7d32;background:#e8f5e9' : l.status === 'error' ? 'color:#c62828;background:#ffebee' : '';
                const shortDate = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                const svcNames = { supabase: 'DB', r2: 'R2', d1: 'D1', github: 'Git' };
                const svcHtml = ['supabase','r2','d1','github'].map(k => {
                  const s = det[k];
                  if (!s) return `<span style="color:var(--text-muted,#ccc);">${svcNames[k]}</span>`;
                  const c = s.status === 'success' ? '#2e7d32' : s.status === 'error' ? '#c62828' : '#e65100';
                  const icon = s.status === 'success' ? '✓' : s.status === 'error' ? '✗' : '—';
                  return `<span style="color:${c};">${icon} ${svcNames[k]}</span>`;
                }).join('<span style="color:var(--border,#e2e0db);margin:0 0.25rem;">|</span>');
                return `<tr>
                  <td style="white-space:nowrap">${esc(shortDate)}</td>
                  <td><span style="font-size:0.75rem;padding:2px 8px;border-radius:999px;${statusCls}">${esc(l.status)}</span></td>
                  <td>${fmtDuration(l.duration_seconds)}</td>
                  <td style="font-size:0.75rem;">${svcHtml}</td>
                  <td style="font-size:0.75rem;">${det.total_size || '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}`;
  } catch (err) {
    if (err.message?.includes('backup_logs')) {
      panel.innerHTML = `
        <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Backups</h2>
        <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">Weekly automated backups to RVAULT20 external drive — Mondays 1:00 AM.</p>
        <div class="dc-empty">Backup system not set up yet. Run the <code>backup_logs</code> migration to enable.</div>`;
    } else {
      panel.innerHTML = `<div class="dc-empty">Failed to load backups: ${esc(err.message)}</div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// PLANLIST TAB
// ═══════════════════════════════════════════════════════════
// PLANLIST (TODO) — full CRUD checklist
// ═══════════════════════════════════════════════════════════
let todoCategories = [];
let todoAllItems = [];
let todoSearchQuery = '';

const todoDefaultIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
const todoIcons = {
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  chevron: '<svg class="todo-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
};

function todoTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function todoItemMatchesSearch(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (item.title || '').toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q) || (item.badge || '').toLowerCase().includes(q);
}

function todoHighlightText(text, query) {
  if (!query || !text) return esc(text);
  const escaped = esc(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${q})`, 'gi'), '<span class="todo-search-highlight">$1</span>');
}

function todoHighlightHtml(html, query) {
  if (!query || !html) return html;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(new RegExp(`(${q})`, 'gi'), '<span class="todo-search-highlight">$1</span>');
  });
}

async function loadTodoData() {
  try {
    const [catRes, itemRes] = await Promise.all([
      supabase.from('todo_categories').select('*').order('display_order'),
      supabase.from('todo_items').select('*').order('display_order'),
    ]);
    if (catRes.error) showToast('Failed to load categories: ' + catRes.error.message, 'error');
    if (itemRes.error) showToast('Failed to load items: ' + itemRes.error.message, 'error');
    todoAllItems = itemRes.data || [];
    todoCategories = (catRes.data || []).map(cat => ({
      ...cat,
      items: todoAllItems.filter(i => i.category_id === cat.id)
    }));
  } catch (err) {
    showToast('Error loading data: ' + err.message, 'error');
  }
  renderTodo();
}

function renderTodo() {
  const panel = document.getElementById('dc-panel-planlist');
  const total = todoAllItems.length;
  const done = todoAllItems.filter(i => i.is_checked).length;
  const remaining = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  panel.innerHTML = `
    <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">PlanList</h2>
    <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">Development todo items, implementation plans, and project checklists</p>

    <div class="todo-summary">
      <div class="todo-summary-stat"><span class="todo-summary-value total">${total}</span><span class="todo-summary-label">Total</span></div>
      <div class="todo-summary-stat"><span class="todo-summary-value done">${done}</span><span class="todo-summary-label">Done</span></div>
      <div class="todo-summary-stat"><span class="todo-summary-value remaining">${remaining}</span><span class="todo-summary-label">Remaining</span></div>
      <div class="todo-summary-stat"><span class="todo-summary-value" style="color:${pct === 100 ? 'var(--success)' : 'var(--text)'}">${pct}%</span><span class="todo-summary-label">Progress</span></div>
    </div>
    <div class="todo-progress-bar"><div class="todo-progress-fill" style="width:${pct}%"></div></div>

    <div class="todo-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="todoSearch" placeholder="Search tasks..." autocomplete="off" value="${esc(todoSearchQuery)}">
      <span class="todo-search-count" id="todoSearchCount"></span>
      <button class="todo-search-clear ${todoSearchQuery ? '' : 'hidden'}" id="todoSearchClear">&times;</button>
    </div>

    <div class="todo-actions">
      <button class="btn-small btn-secondary" id="resetAllBtn">Reset All</button>
      <button class="btn-small btn-primary" id="addCategoryBtn">+ Category</button>
    </div>

    <div id="todoContainer">${todoCategories.map(cat => {
      const visibleItems = cat.items.filter(i => todoItemMatchesSearch(i, todoSearchQuery));
      const catHidden = todoSearchQuery && visibleItems.length === 0;
      const catDone = cat.items.filter(i => i.is_checked).length;
      const catTotal = cat.items.length;
      const allDone = catDone === catTotal && catTotal > 0;
      const collapsed = todoSearchQuery ? false : allDone;
      return `
        <div class="todo-category${collapsed ? ' collapsed' : ''}${catHidden ? ' search-hidden' : ''}" data-cat="${cat.id}">
          <div class="todo-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
            ${cat.icon_svg || todoDefaultIcon}
            <h2>${esc(cat.title)}</h2>
            <span class="todo-category-progress"><span class="${allDone ? 'done' : ''}">${todoSearchQuery ? `${visibleItems.length}/` : ''}${catDone}/${catTotal}</span></span>
            <div class="todo-cat-actions" onclick="event.stopPropagation()">
              <button class="todo-action-btn" title="Add item" data-action="add-item" data-cat-id="${cat.id}">${todoIcons.plus}</button>
              <button class="todo-action-btn" title="Edit" data-action="edit-cat" data-cat-id="${cat.id}">${todoIcons.edit}</button>
              <button class="todo-action-btn" title="Move up" data-action="move-cat-up" data-cat-id="${cat.id}">${todoIcons.up}</button>
              <button class="todo-action-btn" title="Move down" data-action="move-cat-down" data-cat-id="${cat.id}">${todoIcons.down}</button>
            </div>
            ${todoIcons.chevron}
          </div>
          <div class="todo-items">
            ${cat.items.map((item, idx) => {
              const matches = todoItemMatchesSearch(item, todoSearchQuery);
              const checked = item.is_checked;
              const badgeHtml = item.badge ? `<span class="todo-badge ${item.badge}">${item.badge}</span>` : '';
              const checkedInfo = checked && item.checked_at ? `<div class="todo-checked-info">${todoTimeAgo(item.checked_at)}</div>` : '';
              const titleHtml = todoSearchQuery ? todoHighlightText(item.title, todoSearchQuery) : esc(item.title);
              const descHtml = item.description ? (todoSearchQuery ? todoHighlightHtml(item.description, todoSearchQuery) : item.description) : '';
              return `
                <div class="todo-item${checked ? ' checked' : ''}${!matches ? ' search-hidden' : ''}">
                  <input type="checkbox" class="todo-checkbox" data-id="${item.id}" ${checked ? 'checked' : ''}>
                  <div class="todo-item-content">
                    <div class="todo-item-title">${titleHtml}</div>
                    ${descHtml ? `<div class="todo-item-desc">${descHtml}</div>` : ''}
                    ${checkedInfo}
                  </div>
                  ${badgeHtml}
                  <button class="todo-item-edit-btn" title="Edit" data-action="edit-item" data-item-id="${item.id}">${todoIcons.edit}</button>
                  <div class="todo-item-actions" onclick="event.stopPropagation()">
                    <button class="todo-action-btn" title="Move up" data-action="move-item-up" data-item-id="${item.id}" ${idx === 0 ? 'disabled' : ''}>${todoIcons.up}</button>
                    <button class="todo-action-btn" title="Move down" data-action="move-item-down" data-item-id="${item.id}" ${idx === cat.items.length - 1 ? 'disabled' : ''}>${todoIcons.down}</button>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}</div>

    <!-- Todo CRUD Modal -->
    <div id="todoModal" class="modal hidden">
      <div class="modal-content" style="max-width:560px">
        <div class="modal-header">
          <h2 id="todoModalTitle">Add Category</h2>
          <button class="modal-close" id="todoModalClose">&times;</button>
        </div>
        <div class="modal-body" id="todoModalBody"></div>
        <div class="modal-footer">
          <button class="btn-secondary" id="todoModalDelete" style="display:none;margin-right:auto;color:#991b1b">Delete</button>
          <button class="btn-secondary" id="todoModalCancel">Cancel</button>
          <button class="btn-primary" id="todoModalSave">Save</button>
        </div>
      </div>
    </div>`;

  // Bind events after render
  setupTodoEvents();

  // Update search count
  if (todoSearchQuery) {
    const matchCount = todoAllItems.filter(i => todoItemMatchesSearch(i, todoSearchQuery)).length;
    const countEl = document.getElementById('todoSearchCount');
    if (countEl) countEl.textContent = `${matchCount}/${todoAllItems.length}`;
  }
}

function setupTodoEvents() {
  const container = document.getElementById('todoContainer');
  if (!container) return;

  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-checkbox')) todoToggleItem(e.target.dataset.id);
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, catId, itemId } = btn.dataset;
    switch (action) {
      case 'add-item': todoOpenItemModal(catId); break;
      case 'edit-cat': { const c = todoCategories.find(x => x.id === catId); if (c) todoOpenCategoryModal(c); break; }
      case 'move-cat-up': todoMoveCategory(catId, 'up'); break;
      case 'move-cat-down': todoMoveCategory(catId, 'down'); break;
      case 'edit-item': { const i = todoAllItems.find(x => x.id === itemId); if (i) todoOpenItemModal(i.category_id, i); break; }
      case 'move-item-up': todoMoveItem(itemId, 'up'); break;
      case 'move-item-down': todoMoveItem(itemId, 'down'); break;
    }
  });

  const searchInput = document.getElementById('todoSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => { todoSearchQuery = searchInput.value.trim(); renderTodo(); });
    // Re-focus after re-render
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
  document.getElementById('todoSearchClear')?.addEventListener('click', () => { todoSearchQuery = ''; renderTodo(); });
  document.getElementById('resetAllBtn')?.addEventListener('click', todoHandleResetAll);
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => todoOpenCategoryModal());
  document.getElementById('todoModalClose')?.addEventListener('click', todoCloseModal);
  document.getElementById('todoModalCancel')?.addEventListener('click', todoCloseModal);
  document.getElementById('todoModal')?.addEventListener('click', (e) => { if (e.target.id === 'todoModal') todoCloseModal(); });
}

async function todoToggleItem(itemId) {
  const item = todoAllItems.find(i => i.id === itemId);
  if (!item) return;
  const auth = getAuthState();
  const newChecked = !item.is_checked;
  item.is_checked = newChecked;
  item.checked_at = newChecked ? new Date().toISOString() : null;
  renderTodo();
  const { error } = await supabase.from('todo_items').update({
    is_checked: newChecked,
    checked_by: newChecked ? (auth?.appUser?.id || null) : null,
    checked_at: newChecked ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq('id', itemId);
  if (error) { item.is_checked = !newChecked; renderTodo(); showToast('Failed to update', 'error'); }
}

function todoOpenCategoryModal(category = null) {
  const modal = document.getElementById('todoModal');
  const title = document.getElementById('todoModalTitle');
  const body = document.getElementById('todoModalBody');
  const saveBtn = document.getElementById('todoModalSave');
  const deleteBtn = document.getElementById('todoModalDelete');
  title.textContent = category ? 'Edit Category' : 'Add Category';
  body.innerHTML = `
    <label for="catTitle">Title</label>
    <input type="text" id="catTitle" value="${esc(category?.title || '')}" placeholder="Category name">
    <label for="catIcon">Icon SVG</label>
    <textarea id="catIcon" rows="3" style="font-family:monospace;font-size:0.8rem" placeholder="Paste SVG element">${esc(category?.icon_svg || todoDefaultIcon)}</textarea>
    <small style="color:var(--text-muted);display:block;margin-top:0.25rem">Paste a Feather Icons SVG or leave default</small>`;
  deleteBtn.style.display = category ? '' : 'none';
  deleteBtn.onclick = async () => {
    if (!confirm(`Delete "${category.title}" and all its items?`)) return;
    const { error } = await supabase.from('todo_categories').delete().eq('id', category.id);
    if (error) { showToast('Delete failed', 'error'); return; }
    todoCloseModal(); showToast('Category deleted', 'info'); await loadTodoData();
  };
  saveBtn.onclick = async () => {
    const t = document.getElementById('catTitle').value.trim();
    const icon = document.getElementById('catIcon').value.trim();
    if (!t) { showToast('Title is required', 'error'); return; }
    if (category) {
      const { error } = await supabase.from('todo_categories').update({ title: t, icon_svg: icon, updated_at: new Date().toISOString() }).eq('id', category.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Category updated', 'success');
    } else {
      const maxOrder = todoCategories.reduce((max, c) => Math.max(max, c.display_order), -1);
      const { error } = await supabase.from('todo_categories').insert({ title: t, icon_svg: icon, display_order: maxOrder + 1 });
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Category added', 'success');
    }
    todoCloseModal(); await loadTodoData();
  };
  modal.classList.remove('hidden');
}

function todoOpenItemModal(categoryId, item = null) {
  const modal = document.getElementById('todoModal');
  const title = document.getElementById('todoModalTitle');
  const body = document.getElementById('todoModalBody');
  const saveBtn = document.getElementById('todoModalSave');
  const deleteBtn = document.getElementById('todoModalDelete');
  title.textContent = item ? 'Edit Item' : 'Add Item';
  const catOptions = todoCategories.map(c =>
    `<option value="${c.id}" ${c.id === (item?.category_id || categoryId) ? 'selected' : ''}>${esc(c.title)}</option>`
  ).join('');
  body.innerHTML = `
    <label for="itemTitle">Title</label>
    <input type="text" id="itemTitle" value="${esc(item?.title || '')}" placeholder="Task title">
    <label for="itemDesc">Description <small style="font-weight:400;color:var(--text-muted)">(HTML allowed)</small></label>
    <textarea id="itemDesc" rows="3" placeholder="Optional description...">${item?.description || ''}</textarea>
    <label for="itemBadge">Priority</label>
    <select id="itemBadge">
      <option value="" ${!item?.badge ? 'selected' : ''}>None</option>
      <option value="critical" ${item?.badge === 'critical' ? 'selected' : ''}>Critical</option>
      <option value="important" ${item?.badge === 'important' ? 'selected' : ''}>Important</option>
      <option value="nice" ${item?.badge === 'nice' ? 'selected' : ''}>Nice to Have</option>
      <option value="blocked" ${item?.badge === 'blocked' ? 'selected' : ''}>Blocked</option>
    </select>
    <label for="itemCategory">Category</label>
    <select id="itemCategory">${catOptions}</select>`;
  deleteBtn.style.display = item ? '' : 'none';
  deleteBtn.onclick = async () => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    const { error } = await supabase.from('todo_items').delete().eq('id', item.id);
    if (error) { showToast('Delete failed', 'error'); return; }
    todoCloseModal(); showToast('Item deleted', 'info'); await loadTodoData();
  };
  saveBtn.onclick = async () => {
    const t = document.getElementById('itemTitle').value.trim();
    const desc = document.getElementById('itemDesc').value.trim();
    const badge = document.getElementById('itemBadge').value || null;
    const catId = document.getElementById('itemCategory').value;
    if (!t) { showToast('Title is required', 'error'); return; }
    if (item) {
      const { error } = await supabase.from('todo_items').update({ title: t, description: desc || null, badge, category_id: catId, updated_at: new Date().toISOString() }).eq('id', item.id);
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Item updated', 'success');
    } else {
      const catItems = todoAllItems.filter(i => i.category_id === catId);
      const maxOrder = catItems.reduce((max, i) => Math.max(max, i.display_order), -1);
      const { error } = await supabase.from('todo_items').insert({ category_id: catId, title: t, description: desc || null, badge, display_order: maxOrder + 1 });
      if (error) { showToast('Save failed', 'error'); return; }
      showToast('Item added', 'success');
    }
    todoCloseModal(); await loadTodoData();
  };
  modal.classList.remove('hidden');
}

function todoCloseModal() { document.getElementById('todoModal')?.classList.add('hidden'); }

async function todoMoveCategory(catId, direction) {
  const idx = todoCategories.findIndex(c => c.id === catId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= todoCategories.length) return;
  const a = todoCategories[idx], b = todoCategories[swapIdx];
  await Promise.all([
    supabase.from('todo_categories').update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from('todo_categories').update({ display_order: a.display_order }).eq('id', b.id)
  ]);
  await loadTodoData();
}

async function todoMoveItem(itemId, direction) {
  const cat = todoCategories.find(c => c.items.some(i => i.id === itemId));
  if (!cat) return;
  const items = cat.items;
  const idx = items.findIndex(i => i.id === itemId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  const a = items[idx], b = items[swapIdx];
  await Promise.all([
    supabase.from('todo_items').update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from('todo_items').update({ display_order: a.display_order }).eq('id', b.id)
  ]);
  await loadTodoData();
}

async function todoHandleResetAll() {
  if (!confirm('Reset all checkboxes? This will uncheck everything.')) return;
  const { error } = await supabase.from('todo_items').update({
    is_checked: false, checked_by: null, checked_at: null, updated_at: new Date().toISOString()
  }).eq('is_checked', true);
  if (error) { showToast('Reset failed', 'error'); return; }
  showToast('All tasks reset', 'info');
  await loadTodoData();
}

async function loadPlanList() {
  const panel = document.getElementById('dc-panel-planlist');
  panel.innerHTML = '<div class="dc-empty">Loading tasks...</div>';
  await loadTodoData();
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'devcontrol',
    requiredRole: 'admin',
    section: 'devcontrol',
    onReady: () => { renderDevControlTabs(); initSubtabs(); },
  });
});

function renderDevControlTabs() {
  const tabsContainer = document.querySelector('.manage-tabs');
  if (!tabsContainer) return;
  const subtabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'releases', label: 'Releases' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'tokens', label: 'Tokens' },
    { id: 'context', label: 'Context' },
    { id: 'backups', label: 'Backups' },
    { id: 'planlist', label: 'PlanList' },
  ];
  tabsContainer.innerHTML = subtabs.map(tab =>
    `<a href="#${tab.id === 'overview' ? '' : tab.id}" class="manage-tab dc-manage-tab" data-tab="${tab.id}">${tab.label}</a>`
  ).join('');
}
