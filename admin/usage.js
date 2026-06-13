/**
 * AI Costs — Gemini API token usage & estimated spend.
 * Reads gemini_usage_daily (synced daily from Cloud Monitoring by the
 * gemini-cost-sync edge function). "Sync now" re-triggers that function.
 */

import { supabase } from '../shared/supabase.js';
import { initAdminPage, showToast } from '../shared/admin-shell.js';

let authState = null;
let rows = [];

const PROJECT_LABELS = {
  'gen-lang-client-0847727434': 'Main edge-function key',
  'aiclaw-486101': 'OpenClaw / agent workers',
  'gen-lang-client-0541772148': 'Image generation',
  'gen-lang-client-0323600525': 'Other (gen-lang …525)',
  'finleg': 'FinLeg project',
};

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'aiCosts',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async () => {
      document.getElementById('syncBtn').addEventListener('click', syncNow);
      await loadData();
    },
  });
});

async function loadData() {
  const since = isoDaysAgo(30);
  const { data, error } = await supabase
    .from('gemini_usage_daily')
    .select('*')
    .gte('usage_date', since)
    .order('usage_date', { ascending: true });

  if (error) {
    showToast('Failed to load usage data', 'error');
    console.error(error);
    return;
  }
  rows = data || [];
  renderSummary();
  renderByModel();
  renderByProject();
  renderTrend();
  renderDetail();
  renderSyncMeta();
}

// ─── helpers ───────────────────────────────────────────────────────
function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
const num = (n) => (Number(n) || 0).toLocaleString();
function sumCost(list) { return list.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0); }

function groupBy(list, key) {
  const m = new Map();
  for (const r of list) {
    const k = r[key];
    const g = m.get(k) || { key: k, input: 0, output: 0, cost: 0 };
    g.input += Number(r.input_tokens || 0);
    g.output += Number(r.output_tokens || 0);
    g.cost += Number(r.estimated_cost_usd || 0);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

function barRows(groups, labelFn) {
  const max = Math.max(...groups.map((g) => g.cost), 0.0001);
  const total = groups.reduce((s, g) => s + g.cost, 0) || 1;
  return groups.map((g) => {
    const pct = (g.cost / total * 100).toFixed(0);
    const w = (g.cost / max * 100).toFixed(1);
    return `<div class="bar-row">
      <div class="bar-label" title="${labelFn(g.key)}">${labelFn(g.key)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
      <div class="bar-amt">${usd(g.cost)} · ${pct}%</div>
    </div>`;
  }).join('');
}

// ─── renderers ─────────────────────────────────────────────────────
function renderSummary() {
  const c30 = sumCost(rows);
  const since7 = isoDaysAgo(7);
  const c7 = sumCost(rows.filter((r) => r.usage_date >= since7));
  const cToday = sumCost(rows.filter((r) => r.usage_date === todayISO()));
  const projectedMonth = (c30 / 30) * 30; // 30-day total ≈ monthly run-rate
  document.getElementById('summaryCards').innerHTML = `
    <div class="usage-card"><div class="label">Last 30 days</div><div class="value">${usd(c30)}</div><div class="sub">all keys, estimated</div></div>
    <div class="usage-card"><div class="label">Last 7 days</div><div class="value">${usd(c7)}</div><div class="sub">${usd(c7 / 7)}/day avg</div></div>
    <div class="usage-card"><div class="label">Today (so far)</div><div class="value">${usd(cToday)}</div><div class="sub">UTC, partial</div></div>
    <div class="usage-card"><div class="label">~Monthly run-rate</div><div class="value">${usd(projectedMonth)}</div><div class="sub">30-day total</div></div>`;
}

function renderByModel() {
  const el = document.getElementById('byModel');
  if (!rows.length) { el.textContent = 'No data yet.'; return; }
  el.innerHTML = barRows(groupBy(rows, 'model'), (k) => k);
}

function renderByProject() {
  const el = document.getElementById('byProject');
  if (!rows.length) { el.textContent = 'No data yet.'; return; }
  el.innerHTML = barRows(groupBy(rows, 'gcp_project'), (k) => PROJECT_LABELS[k] || k);
}

function renderTrend() {
  const el = document.getElementById('trend');
  // build full 30-day axis so empty days show as gaps
  const byDay = new Map();
  for (const r of rows) byDay.set(r.usage_date, (byDay.get(r.usage_date) || 0) + Number(r.estimated_cost_usd || 0));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = isoDaysAgo(i);
    days.push({ day: d, cost: byDay.get(d) || 0 });
  }
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  el.innerHTML = days.map((d) => {
    const h = (d.cost / max * 100).toFixed(1);
    return `<div class="trend-col" title="${d.day}: ${usd(d.cost)}">
      <div class="trend-bar" style="height:${h}%"></div>
      <div class="trend-day">${d.day.slice(5)}</div>
    </div>`;
  }).join('');
  document.getElementById('trendNote').textContent =
    `Peak day: ${usd(max)}. Bars scaled to peak.`;
}

function renderDetail() {
  const el = document.getElementById('detailTable');
  if (!rows.length) { el.textContent = 'No data yet.'; return; }
  const recent = [...rows].sort((a, b) =>
    b.usage_date.localeCompare(a.usage_date) || b.estimated_cost_usd - a.estimated_cost_usd).slice(0, 60);
  el.innerHTML = `<table class="usage-tbl">
    <thead><tr><th>Date</th><th>Project</th><th>Model</th><th>Input tok</th><th>Output tok</th><th>Est. cost</th></tr></thead>
    <tbody>${recent.map((r) => `<tr>
      <td>${r.usage_date}</td>
      <td title="${r.gcp_project}">${PROJECT_LABELS[r.gcp_project] || r.gcp_project}</td>
      <td>${r.model}</td>
      <td>${num(r.input_tokens)}</td>
      <td>${num(r.output_tokens)}</td>
      <td>${usd(r.estimated_cost_usd)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderSyncMeta() {
  const last = rows.reduce((mx, r) => (r.synced_at > mx ? r.synced_at : mx), '');
  const el = document.getElementById('syncMeta');
  el.textContent = last
    ? `Last synced ${new Date(last).toLocaleString()}. Auto-syncs daily ~8:20 AM Central.`
    : 'No sync recorded yet.';
}

async function syncNow() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true; btn.textContent = 'Syncing…';
  try {
    const { data, error } = await supabase.functions.invoke('gemini-cost-sync', { body: { days: 3 } });
    if (error) throw error;
    showToast(`Synced ${data?.rows_upserted ?? 0} rows`, 'success');
    await loadData();
  } catch (e) {
    console.error(e);
    showToast('Sync failed: ' + (e.message || e), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Sync now';
  }
}
