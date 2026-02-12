#!/usr/bin/env node
/**
 * Generate styled HTML report from PAI test suite results.
 * Reads results.json and outputs testrun1.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsPath = path.join(__dirname, 'results.json');
const outputPath = path.join(__dirname, 'testrun1.html');

if (!fs.existsSync(resultsPath)) {
  console.error('results.json not found. Run pai-test-suite.js first.');
  process.exit(1);
}

const { summary, results } = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(score) {
  if (score >= 0.8) return '#10b981';  // green
  if (score >= 0.5) return '#f59e0b';  // amber
  return '#ef4444';  // red
}

function categoryIcon(cat) {
  const icons = {
    property_info: '🏠', identity: '🦙', spaces: '🛏️', amenities: '✨',
    lighting: '💡', climate: '🌡️', vehicles: '🚗', cameras: '📷',
    policies: '📋', documents: '📄', music: '🎵', edge_case: '⚠️',
    complex: '🧩', personality: '💬',
  };
  return icons[cat] || '❓';
}

// Build category summary rows
const categoryRows = Object.entries(summary.categoryScores).map(([cat, stats]) => `
  <tr>
    <td>${categoryIcon(cat)} ${cat.replace(/_/g, ' ')}</td>
    <td>${stats.total}</td>
    <td>${stats.passed}/${stats.total}</td>
    <td style="color: ${scoreColor(parseFloat(stats.avgScore))}">${stats.avgScore}</td>
    <td>${stats.avgResponseTimeMs}ms</td>
  </tr>
`).join('');

// Build individual result rows
const resultRows = results.map(r => `
  <div class="result-card ${r.pass ? 'pass' : 'fail'}">
    <div class="result-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="result-status ${r.pass ? 'status-pass' : 'status-fail'}">${r.pass ? 'PASS' : 'FAIL'}</div>
      <div class="result-meta">
        <span class="result-num">#${r.index}</span>
        <span class="result-category">${categoryIcon(r.category)} ${r.category.replace(/_/g, ' ')}</span>
        <span class="result-difficulty">${r.difficulty}</span>
      </div>
      <div class="result-question">${escapeHtml(r.question || '(empty message)')}</div>
      <div class="result-stats">
        <span class="score" style="color: ${scoreColor(r.score)}">${r.score.toFixed(1)}</span>
        <span class="response-time">${r.responseTimeMs}ms</span>
      </div>
    </div>
    <div class="result-details">
      <div class="detail-section">
        <h4>Response</h4>
        <div class="reply-text">${escapeHtml(r.reply)}</div>
      </div>
      ${r.expectedKeywords?.length ? `
      <div class="detail-section">
        <h4>Expected Keywords</h4>
        <div class="keywords">${r.expectedKeywords.map(k => `<span class="keyword ${r.reply?.toLowerCase().includes(k.toLowerCase()) ? 'matched' : 'missed'}">${escapeHtml(k)}</span>`).join('')}</div>
      </div>` : ''}
      <div class="detail-section">
        <h4>Scoring</h4>
        <p>${escapeHtml(r.scoreReason)}</p>
      </div>
      ${r.actions?.length ? `
      <div class="detail-section">
        <h4>Actions Taken</h4>
        <pre>${escapeHtml(JSON.stringify(r.actions, null, 2))}</pre>
      </div>` : ''}
      ${r.error ? `
      <div class="detail-section error-section">
        <h4>Error</h4>
        <p>${escapeHtml(r.error)}</p>
      </div>` : ''}
      <div class="detail-section">
        <h4>Timestamp</h4>
        <p>${r.timestamp}</p>
      </div>
    </div>
  </div>
`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAI Test Suite Report - Run #1</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface2: #334155;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --border: #475569;
      --green: #10b981;
      --red: #ef4444;
      --amber: #f59e0b;
      --blue: #3b82f6;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    .header {
      text-align: center;
      padding: 40px 20px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-radius: 16px;
      border: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, var(--blue), var(--purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .header .subtitle { color: var(--text-muted); font-size: 0.95rem; }
    .header .run-info {
      margin-top: 12px;
      display: flex;
      justify-content: center;
      gap: 24px;
      flex-wrap: wrap;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      margin: 4px 0;
    }
    .stat-card .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Category Table */
    .section { margin-bottom: 24px; }
    .section h2 {
      font-size: 1.3rem;
      margin-bottom: 12px;
      padding-left: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: var(--surface2);
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    td { font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    td:first-child { text-transform: capitalize; }

    /* Result Cards */
    .result-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 8px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .result-card:hover { border-color: var(--blue); }
    .result-card.pass { border-left: 3px solid var(--green); }
    .result-card.fail { border-left: 3px solid var(--red); }

    .result-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      user-select: none;
    }
    .result-header:hover { background: var(--surface2); }

    .result-status {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .status-pass { background: rgba(16, 185, 129, 0.15); color: var(--green); }
    .status-fail { background: rgba(239, 68, 68, 0.15); color: var(--red); }

    .result-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .result-num { font-weight: 600; color: var(--text-muted); font-size: 0.8rem; }
    .result-category { font-size: 0.8rem; color: var(--text-muted); }
    .result-difficulty {
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--surface2);
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .result-question {
      flex: 1;
      font-size: 0.9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .result-stats {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }
    .score { font-weight: 700; font-size: 0.9rem; }
    .response-time { font-size: 0.8rem; color: var(--text-muted); }

    /* Expandable Details */
    .result-details {
      display: none;
      padding: 0 16px 16px;
      border-top: 1px solid var(--border);
    }
    .result-card.expanded .result-details { display: block; }

    .detail-section {
      margin-top: 12px;
    }
    .detail-section h4 {
      font-size: 0.8rem;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .reply-text {
      background: var(--bg);
      padding: 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }
    .keywords { display: flex; flex-wrap: wrap; gap: 6px; }
    .keyword {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .keyword.matched { background: rgba(16, 185, 129, 0.2); color: var(--green); }
    .keyword.missed { background: rgba(239, 68, 68, 0.2); color: var(--red); }
    .error-section p { color: var(--red); }
    pre {
      background: var(--bg);
      padding: 12px;
      border-radius: 8px;
      font-size: 0.8rem;
      overflow-x: auto;
    }

    /* Filters */
    .filters {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .filter-btn {
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s;
    }
    .filter-btn:hover, .filter-btn.active {
      background: var(--blue);
      border-color: var(--blue);
      color: white;
    }

    /* Response time chart */
    .chart-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 120px;
      padding-top: 20px;
    }
    .bar {
      flex: 1;
      border-radius: 3px 3px 0 0;
      min-width: 6px;
      position: relative;
      transition: opacity 0.2s;
    }
    .bar:hover { opacity: 0.8; }
    .bar .tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface2);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      white-space: nowrap;
      z-index: 10;
    }
    .bar:hover .tooltip { display: block; }

    @media (max-width: 768px) {
      body { padding: 12px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .result-header { flex-wrap: wrap; }
      .result-question { white-space: normal; width: 100%; order: 10; margin-top: 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PAI Test Suite Report</h1>
      <p class="subtitle">Automated quality assessment of PAI (Prompt Alpaca Intelligence)</p>
      <div class="run-info">
        <span>Run #1</span>
        <span>Started: ${new Date(summary.runStart).toLocaleString()}</span>
        <span>Duration: ${summary.durationFormatted}</span>
        <span>Channel: API</span>
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Queries</div>
        <div class="stat-value">${summary.totalQueries}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pass Rate</div>
        <div class="stat-value" style="color: ${parseFloat(summary.passRate) >= 80 ? 'var(--green)' : parseFloat(summary.passRate) >= 50 ? 'var(--amber)' : 'var(--red)'}">${summary.passRate}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Score</div>
        <div class="stat-value" style="color: ${scoreColor(parseFloat(summary.avgScore))}">${summary.avgScore}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Response Time</div>
        <div class="stat-value">${summary.avgResponseTimeMs}<small>ms</small></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Passed</div>
        <div class="stat-value" style="color: var(--green)">${summary.passed}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Failed</div>
        <div class="stat-value" style="color: ${summary.failed > 0 ? 'var(--red)' : 'var(--green)'}">${summary.failed}</div>
      </div>
    </div>

    <!-- Response Time Chart -->
    <div class="chart-container">
      <h2 style="margin-bottom: 12px; font-size: 1rem;">Response Times</h2>
      <div class="bar-chart">
        ${results.map(r => {
          const maxTime = Math.max(...results.map(x => x.responseTimeMs));
          const height = Math.max(4, (r.responseTimeMs / maxTime) * 100);
          const color = r.pass ? 'var(--green)' : 'var(--red)';
          return `<div class="bar" style="height: ${height}%; background: ${color}">
            <div class="tooltip">#${r.index}: ${r.responseTimeMs}ms</div>
          </div>`;
        }).join('')}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: var(--text-muted)">
        <span>Min: ${summary.minResponseTimeMs}ms</span>
        <span>Avg: ${summary.avgResponseTimeMs}ms</span>
        <span>Max: ${summary.maxResponseTimeMs}ms</span>
      </div>
    </div>

    <!-- Category Breakdown -->
    <div class="section">
      <h2>Category Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Queries</th>
            <th>Passed</th>
            <th>Avg Score</th>
            <th>Avg Response Time</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRows}
        </tbody>
      </table>
    </div>

    <!-- Individual Results -->
    <div class="section">
      <h2>Individual Query Results</h2>
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 12px;">Click any result to expand details</p>

      <div class="filters">
        <button class="filter-btn active" onclick="filterResults('all')">All (${results.length})</button>
        <button class="filter-btn" onclick="filterResults('pass')">Passed (${summary.passed})</button>
        <button class="filter-btn" onclick="filterResults('fail')">Failed (${summary.failed})</button>
        ${Object.keys(summary.categoryScores).map(cat =>
          `<button class="filter-btn" onclick="filterResults('${cat}')">${categoryIcon(cat)} ${cat.replace(/_/g, ' ')}</button>`
        ).join('')}
      </div>

      <div id="results-container">
        ${resultRows}
      </div>
    </div>

    <div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 24px 0;">
      Generated ${new Date().toISOString()} | PAI Test Suite v1.0 | AlpacApps
    </div>
  </div>

  <script>
    function filterResults(type) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      document.querySelectorAll('.result-card').forEach(card => {
        if (type === 'all') {
          card.style.display = '';
        } else if (type === 'pass') {
          card.style.display = card.classList.contains('pass') ? '' : 'none';
        } else if (type === 'fail') {
          card.style.display = card.classList.contains('fail') ? '' : 'none';
        } else {
          // Category filter
          const category = card.querySelector('.result-category')?.textContent?.trim().replace(/ /g, '_') || '';
          // Strip emoji from front
          const catClean = category.replace(/^[^a-zA-Z]+/, '');
          card.style.display = catClean === type ? '' : 'none';
        }
      });
    }
  </script>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`Report generated: ${outputPath}`);
console.log(`${results.length} queries, ${summary.passRate} pass rate, avg ${summary.avgResponseTimeMs}ms`);
