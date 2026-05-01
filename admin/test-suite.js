import { initAdminPage, showToast } from '../shared/admin-shell.js';
import { supabase } from '../shared/supabase.js';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
// initAdminPage's onReady state does not expose `.supabase`; import the singleton
// directly (same pattern as admin/users.js, admin/accounting.js, etc).
const supabaseClient = supabase;
let authState = null;
let currentCategory = '';

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'testsuite',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async (state) => {
      authState = state;
      bindEvents();
      await loadLatestRun();
      await loadRunHistory();
    },
  });
});

function bindEvents() {
  document.getElementById('runAllBtn')?.addEventListener('click', runAllTests);
  document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
    currentCategory = e.target.value;
    renderCurrentResults();
  });
}

// ─── Run tests ────────────────────────────────────────────────────

let latestResults = [];
let latestRunId = null;

async function runAllTests() {
  const btn = document.getElementById('runAllBtn');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6" stroke-dasharray="28" stroke-dashoffset="8"/></svg> Running...';
  showToast('Running test suite...', 'info', 0);

  try {
    const session = authState?.session;
    const token = session?.access_token;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/run-nightly-tests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    latestResults = data.results || [];
    latestRunId = data.run_id;

    renderSummary(data);
    renderCurrentResults();
    updateLastRunTime(new Date());

    const msg = data.failed > 0
      ? `${data.failed} test(s) failed`
      : `All ${data.passed} tests passed`;
    showToast(msg, data.failed > 0 ? 'error' : 'success');

    // Refresh history
    await loadRunHistory();
  } catch (err) {
    console.error('Failed to run tests:', err);
    showToast(`Test run failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 3v10l7-5z"/></svg> Run All';
  }
}

// ─── Load latest run from DB ──────────────────────────────────────

async function loadLatestRun() {
  try {
    // Get the most recent run_id
    const { data: latest, error } = await supabaseClient
      .from('nightly_test_runs')
      .select('run_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !latest) {
      document.getElementById('testResults').innerHTML =
        '<div class="text-center py-aap-8 text-aap-text-muted">No test runs yet. Click "Run All" to start.</div>';
      return;
    }

    latestRunId = latest.run_id;

    // Get all results for that run
    const { data: results, error: rErr } = await supabaseClient
      .from('nightly_test_runs')
      .select('*')
      .eq('run_id', latest.run_id)
      .order('test_category', { ascending: true });

    if (rErr) throw rErr;

    latestResults = (results || []).map(r => ({
      test_name: r.test_name,
      test_category: r.test_category,
      status: r.status,
      message: r.message,
      details: r.details,
      duration_ms: r.duration_ms,
    }));

    const passed = latestResults.filter(r => r.status === 'pass').length;
    const failed = latestResults.filter(r => r.status === 'fail').length;
    const warned = latestResults.filter(r => r.status === 'warn').length;

    renderSummary({ total: latestResults.length, passed, failed, warned });
    renderCurrentResults();
    updateLastRunTime(new Date(latest.created_at));
  } catch (err) {
    console.error('Failed to load latest run:', err);
    document.getElementById('testResults').innerHTML =
      '<div class="text-center py-aap-8 text-aap-text-muted">Failed to load results.</div>';
  }
}

// ─── Render ─────────────────────────────────────────��────────────

function renderSummary(data) {
  const el = (id) => document.getElementById(id);
  el('statTotal').textContent = data.total || 0;
  el('statPass').textContent = data.passed || 0;
  el('statFail').textContent = data.failed || 0;
  el('statWarn').textContent = data.warned || 0;
}

function updateLastRunTime(date) {
  const el = document.getElementById('lastRunTime');
  if (!el) return;
  el.textContent = `Last run: ${fmtDateTime(date)}`;
}

function renderCurrentResults() {
  const container = document.getElementById('testResults');
  if (!container) return;

  const filtered = currentCategory
    ? latestResults.filter(r => r.test_category === currentCategory)
    : latestResults;

  if (!filtered.length) {
    container.innerHTML = '<div class="text-center py-aap-8 text-aap-text-muted">No results to show.</div>';
    return;
  }

  // Group by category
  const groups = {};
  for (const r of filtered) {
    const cat = r.test_category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r);
  }

  let html = '';
  for (const [category, tests] of Object.entries(groups)) {
    html += `<div class="mb-aap-4">
      <h3 class="text-aap-sm font-aap-semibold text-aap-text-muted uppercase tracking-wide mb-aap-2">${esc(category)}</h3>
      <div class="bg-white rounded-aap shadow-aap-sm divide-y divide-aap-border overflow-hidden">
        ${tests.map(renderTestRow).join('')}
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

function renderTestRow(t) {
  const statusConfig = {
    pass: { icon: '&#10003;', color: 'text-aap-success', bg: 'bg-aap-success-light', label: 'PASS' },
    fail: { icon: '&#10007;', color: 'text-aap-error', bg: 'bg-aap-error-light', label: 'FAIL' },
    warn: { icon: '&#9888;', color: 'text-aap-warning', bg: 'bg-aap-warning-light', label: 'WARN' },
    skip: { icon: '&#8212;', color: 'text-aap-text-muted', bg: 'bg-aap-cream-muted', label: 'SKIP' },
  };

  const s = statusConfig[t.status] || statusConfig.skip;
  const detailsHtml = t.details
    ? `<details class="mt-aap-1"><summary class="text-aap-xs text-aap-text-muted cursor-pointer hover:text-aap-amber">Details</summary><pre class="text-aap-xs text-aap-text-muted mt-aap-1 overflow-x-auto">${esc(JSON.stringify(t.details, null, 2))}</pre></details>`
    : '';

  return `
    <div class="flex items-start gap-aap-3 px-aap-4 py-aap-3">
      <span class="inline-flex items-center justify-center w-6 h-6 rounded-aap-full ${s.bg} ${s.color} text-aap-xs font-aap-bold shrink-0 mt-0.5">${s.icon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-aap-2">
          <span class="font-aap-medium text-aap-text text-aap-sm">${esc(t.test_name)}</span>
          <span class="text-aap-xs ${s.color} font-aap-semibold">${s.label}</span>
          ${t.duration_ms ? `<span class="text-aap-xs text-aap-text-muted">${t.duration_ms}ms</span>` : ''}
        </div>
        <p class="text-aap-xs text-aap-text-muted mt-0.5">${esc(t.message)}</p>
        ${detailsHtml}
      </div>
    </div>
  `;
}

// ─── Run history ──────────────────────────────────────────────────

async function loadRunHistory() {
  const container = document.getElementById('runHistory');
  if (!container) return;

  try {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data, error } = await supabaseClient
      .from('nightly_test_runs')
      .select('run_id, status, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by run_id
    const runs = {};
    for (const row of (data || [])) {
      if (!runs[row.run_id]) {
        runs[row.run_id] = { run_id: row.run_id, created_at: row.created_at, pass: 0, fail: 0, warn: 0, skip: 0, total: 0 };
      }
      runs[row.run_id][row.status]++;
      runs[row.run_id].total++;
    }

    const runList = Object.values(runs).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!runList.length) {
      container.innerHTML = '<div class="text-center py-aap-4 text-aap-text-muted text-aap-sm">No runs in last 14 days.</div>';
      return;
    }

    container.innerHTML = runList.map(run => {
      const allPassed = run.fail === 0 && run.warn === 0;
      const hasFails = run.fail > 0;
      const borderColor = hasFails ? 'border-l-aap-error' : allPassed ? 'border-l-aap-success' : 'border-l-aap-warning';
      const isCurrentRun = run.run_id === latestRunId;

      return `
        <div class="flex items-center gap-aap-3 px-aap-4 py-aap-3 bg-white rounded-aap shadow-aap-sm border-l-4 ${borderColor} ${isCurrentRun ? 'ring-2 ring-aap-amber ring-opacity-30' : ''} cursor-pointer hover:shadow-aap transition-shadow" data-run-id="${run.run_id}">
          <div class="flex-1 min-w-0">
            <span class="text-aap-sm font-aap-medium text-aap-text">${fmtDateTime(new Date(run.created_at))}</span>
            ${isCurrentRun ? '<span class="text-aap-xs text-aap-amber font-aap-semibold ml-aap-2">Latest</span>' : ''}
          </div>
          <div class="flex items-center gap-aap-3 text-aap-xs shrink-0">
            <span class="text-aap-success font-aap-semibold">${run.pass}P</span>
            ${run.fail ? `<span class="text-aap-error font-aap-semibold">${run.fail}F</span>` : ''}
            ${run.warn ? `<span class="text-aap-warning font-aap-semibold">${run.warn}W</span>` : ''}
            <span class="text-aap-text-muted">${run.total} tests</span>
          </div>
        </div>
      `;
    }).join('');

    // Click to load a specific run
    container.querySelectorAll('[data-run-id]').forEach(el => {
      el.addEventListener('click', () => loadRun(el.dataset.runId));
    });
  } catch (err) {
    console.error('Failed to load run history:', err);
    container.innerHTML = '<div class="text-center py-aap-4 text-aap-text-muted text-aap-sm">Failed to load history.</div>';
  }
}

async function loadRun(runId) {
  try {
    const { data, error } = await supabaseClient
      .from('nightly_test_runs')
      .select('*')
      .eq('run_id', runId)
      .order('test_category', { ascending: true });

    if (error) throw error;

    latestResults = (data || []).map(r => ({
      test_name: r.test_name,
      test_category: r.test_category,
      status: r.status,
      message: r.message,
      details: r.details,
      duration_ms: r.duration_ms,
    }));
    latestRunId = runId;

    const passed = latestResults.filter(r => r.status === 'pass').length;
    const failed = latestResults.filter(r => r.status === 'fail').length;
    const warned = latestResults.filter(r => r.status === 'warn').length;

    renderSummary({ total: latestResults.length, passed, failed, warned });
    renderCurrentResults();

    if (data?.length) updateLastRunTime(new Date(data[0].created_at));

    // Re-render history to update "Latest" badge
    await loadRunHistory();

    showToast('Loaded run results', 'info', 1500);
  } catch (err) {
    showToast('Failed to load run', 'error');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function fmtDateTime(date) {
  try {
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Chicago',
    });
  } catch { return String(date); }
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
