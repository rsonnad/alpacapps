/**
 * DevControl — AI development tools and activity dashboard
 * Sub-tabs: Overview, Releases, Sessions, Tokens, Context, Backups
 */
import { supabase } from '../../shared/supabase.js';
import { initAdminPage } from '../../shared/admin-shell.js';

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

  document.querySelectorAll('.dc-subtab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  switchTab(activeSubtab);
}

function switchTab(tab) {
  activeSubtab = tab;
  location.hash = tab === 'overview' ? '' : tab;

  document.querySelectorAll('.dc-subtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.dc-panel').forEach((p) => { p.style.display = p.id === `dc-panel-${tab}` ? '' : 'none'; });

  if (!loadedTabs.has(tab)) {
    loadedTabs.add(tab);
    const loaders = { overview: loadOverview, releases: loadReleases, sessions: loadSessions, tokens: loadTokens, context: loadContext, backups: loadBackups };
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
    { name: 'Global CLAUDE.md', path: '~/.claude/CLAUDE.md', category: 'instructions', desc: 'User\'s private global instructions' },
    { name: 'Project CLAUDE.md', path: './CLAUDE.md', category: 'instructions', desc: 'Project-specific directives, code guards', gh: 'CLAUDE.md' },
    { name: 'CLAUDE.local.md', path: './CLAUDE.local.md', category: 'instructions', desc: 'Local overrides (not in repo)' },
    { name: 'MEMORY.md', path: 'memory/MEMORY.md', category: 'memory', desc: 'Memory index — pointers to saved memories' },
    { name: 'System prompt', path: '(built-in)', category: 'system', desc: 'Claude base prompt, tool defs, environment' },
    { name: 'SCHEMA.md', path: 'docs/SCHEMA.md', category: 'docs', desc: 'Database schema — loaded for queries', gh: 'docs/SCHEMA.md' },
    { name: 'PATTERNS.md', path: 'docs/PATTERNS.md', category: 'docs', desc: 'UI code, Tailwind styling patterns', gh: 'docs/PATTERNS.md' },
    { name: 'KEY-FILES.md', path: 'docs/KEY-FILES.md', category: 'docs', desc: 'Project structure and file locations', gh: 'docs/KEY-FILES.md' },
    { name: 'DEPLOY.md', path: 'docs/DEPLOY.md', category: 'docs', desc: 'Deployment, pushing, version management', gh: 'docs/DEPLOY.md' },
    { name: 'INTEGRATIONS.md', path: 'docs/INTEGRATIONS.md', category: 'docs', desc: 'External APIs, vendor setup', gh: 'docs/INTEGRATIONS.md' },
    { name: 'CHANGELOG.md', path: 'docs/CHANGELOG.md', category: 'docs', desc: 'Recent changes, migration context', gh: 'docs/CHANGELOG.md' },
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

  function renderFileTable(files, label, sublabel) {
    const total = files.reduce((s, f) => s + f.tokens, 0);
    return `
      <h3 class="dc-section-header">${esc(label)}</h3>
      ${sublabel ? `<p class="dc-section-sub">${esc(sublabel)}</p>` : ''}
      <div class="dc-table-wrap">
        <table class="dc-table">
          <thead><tr><th>File</th><th>Description</th><th class="text-right">Tokens</th><th class="text-right">% of Window</th></tr></thead>
          <tbody>
            ${files.sort((a, b) => b.tokens - a.tokens).map((f) => `
              <tr>
                <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CAT[f.category]?.bar || '#999'};margin-right:6px;vertical-align:middle;"></span><span class="mono">${esc(f.name)}</span></td>
                <td style="color:var(--text-muted,#888);font-size:0.75rem;">${esc(f.desc)}</td>
                <td class="text-right tabular" style="font-weight:500;">${fmtTok(f.tokens)}</td>
                <td class="text-right tabular" style="font-size:0.75rem;color:var(--text-muted,#888);">${((f.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%</td>
              </tr>
            `).join('')}
            <tr class="total-row"><td style="font-weight:600;">Total</td><td></td><td class="text-right tabular" style="font-weight:700;">${fmtTok(total)}</td><td class="text-right tabular" style="font-size:0.75rem;font-weight:600;">${((total / CONTEXT_WINDOW) * 100).toFixed(1)}%</td></tr>
          </tbody>
        </table>
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
    ${renderFileTable(onDemand, 'On-Demand Docs', 'Loaded when the task matches \u2014 not always in context')}`;
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

    const lastDb = (logs || []).find((l) => l.backup_type === 'db-to-r2');
    const lastRvault = (logs || []).find((l) => l.backup_type === 'r2-to-rvault');
    const dbDays = lastDb ? daysSince(lastDb.created_at) : null;
    const rvaultDays = lastRvault ? daysSince(lastRvault.created_at) : null;

    function agoBadge(days) {
      if (days === null) return '';
      const text = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      return `<span class="${days > 8 ? 'dc-stale-badge' : ''}" style="font-size:0.75rem;margin-left:0.5rem;">${text}</span>`;
    }

    panel.innerHTML = `
      <h2 style="font-size:1.375rem;font-weight:700;margin-bottom:0.25rem;">Backups</h2>
      <p style="color:var(--text-muted,#888);font-size:0.8125rem;margin-bottom:1.25rem;">Weekly automated backups of Supabase database and Cloudflare R2 file storage.</p>

      <div class="dc-backup-grid">
        <div class="dc-backup-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3>Database &rarr; R2</h3>
            <span style="font-size:0.75rem;color:var(--text-muted,#888);">Hostinger VPS</span>
          </div>
          <p>pg_dump &rarr; gzip &rarr; Cloudflare R2 (alpacapps-backups bucket)</p>
          <p style="font-size:0.75rem;color:var(--text-muted,#aaa);">Schedule: Sundays 3:00 AM UTC</p>
          ${lastDb ? `<div class="dc-backup-last">Last: <strong>${fmtDate(lastDb.created_at)}</strong>${agoBadge(dbDays)}${lastDb.details?.size ? `<br><span style="font-size:0.75rem;color:var(--text-muted,#aaa);">Size: ${lastDb.details.size}</span>` : ''}</div>` : ''}
        </div>
        <div class="dc-backup-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3>R2 &rarr; RVAULT20</h3>
            <span style="font-size:0.75rem;color:var(--text-muted,#888);">Alpaca Mac</span>
          </div>
          <p>Sync all R2 buckets + DB dump to external drive</p>
          <p style="font-size:0.75rem;color:var(--text-muted,#aaa);">Schedule: Sundays 5:00 AM local</p>
          ${lastRvault ? `<div class="dc-backup-last">Last: <strong>${fmtDate(lastRvault.created_at)}</strong>${agoBadge(rvaultDays)}</div>` : ''}
        </div>
      </div>

      <h3 class="dc-section-header">Activity Log</h3>
      ${!logs?.length ? '<div class="dc-empty">No backup logs yet.</div>' : `
        <div class="dc-table-wrap">
          <table class="dc-table">
            <thead><tr><th>Date</th><th>Type</th><th>Source</th><th>Status</th><th>Duration</th><th>Details</th></tr></thead>
            <tbody>
              ${logs.map((l) => {
                const typeLbl = l.backup_type === 'db-to-r2' ? 'DB \u2192 R2' : l.backup_type === 'r2-to-rvault' ? 'R2 \u2192 RVAULT20' : l.backup_type;
                const srcLbl = l.source === 'hostinger' ? 'Hostinger VPS' : l.source === 'alpaca-mac' ? 'Alpaca Mac' : l.source;
                const statusCls = l.status === 'success' ? 'color:#2e7d32;background:#e8f5e9' : l.status === 'error' ? 'color:#c62828;background:#ffebee' : '';
                return `<tr>
                  <td style="white-space:nowrap">${fmtDate(l.created_at)}</td>
                  <td><span class="mono" style="background:#f0ede8;padding:2px 6px;border-radius:4px;">${esc(typeLbl)}</span></td>
                  <td>${esc(srcLbl)}</td>
                  <td><span style="font-size:0.75rem;padding:2px 8px;border-radius:999px;${statusCls}">${esc(l.status)}</span></td>
                  <td>${fmtDuration(l.duration_seconds)}</td>
                  <td style="font-size:0.75rem;">
                    ${l.r2_key ? `<span class="mono">${esc(l.r2_key)}</span>` : ''}
                    ${l.details?.size ? ` (${l.details.size})` : ''}
                    ${l.details?.total_size ? `${l.details.total_size} synced` : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}`;
  } catch (err) {
    panel.innerHTML = `<div class="dc-empty">Failed to load backups: ${esc(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'devcontrol',
    requiredRole: 'admin',
    section: 'admin',
    onReady: () => { initSubtabs(); },
  });
});
