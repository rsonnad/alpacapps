/**
 * Version Info - Standalone module for version hover tooltip + click modal.
 * Works on any page. Finds the version span by matching the vYYMMDD.NN pattern.
 * Auto-initializes on DOMContentLoaded.
 *
 * Include as: <script type="module" src="/shared/version-info.js"></script>
 * Or import: import { setupVersionInfo } from './version-info.js';
 */

let versionInfoCache = null;

function findVersionSpan() {
  const pat = /^v\d{6}\.\d{2}/;
  // Check known classes first, then fall back to scanning spans
  const candidates = [
    ...document.querySelectorAll('.aap-header__version'),
    ...document.querySelectorAll('.site-nav__version'),
    ...document.querySelectorAll('.login-card__version'),
    ...document.querySelectorAll('.header-left span'),
  ];
  for (const el of candidates) {
    if (pat.test(el.textContent.trim())) return el;
  }
  // Broader fallback
  for (const span of document.querySelectorAll('span')) {
    if (pat.test(span.textContent.trim())) return span;
  }
  return null;
}

async function fetchVersionInfo() {
  if (versionInfoCache) return versionInfoCache;
  try {
    const resp = await fetch('/version.json?_=' + Date.now());
    if (!resp.ok) return null;
    versionInfoCache = await resp.json();
    return versionInfoCache;
  } catch { return null; }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Extract short ID from bugfix branch name like "bugfix/20260209-79aa46b3-..." → "79aa46b3" */
function branchId(name) {
  const m = name.match(/bugfix\/\d{8}-([a-f0-9]{8})/);
  return m ? m[1] : null;
}

/** Format branch name for display: strip origin/ prefix, shorten UUIDs */
function shortBranch(name) {
  return name
    .replace(/^origin\//, '')
    .replace(/(bugfix\/\d{8}-[a-f0-9]{8})-[a-f0-9-]+$/, '$1…')
    .replace(/(feature\/\d{8}-[a-f0-9]{8}).*$/, '$1…');
}

/** Format ISO timestamp to readable local time */
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
  } catch { return iso; }
}

function injectStyles() {
  if (document.getElementById('vi-styles')) return;
  const style = document.createElement('style');
  style.id = 'vi-styles';
  style.textContent = `
    #vi-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; animation: vi-fadeIn 0.15s ease-out;
    }
    @keyframes vi-fadeIn { from { opacity: 0; } to { opacity: 1; } }
    #vi-modal {
      background: #fff; border-radius: 14px; padding: 0;
      max-width: 520px; width: 94%; max-height: 85vh; overflow-y: auto;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #vi-modal * { box-sizing: border-box; }
    .vi-header {
      padding: 1.25rem 1.5rem 1rem;
      border-bottom: 1px solid #eee;
      display: flex; justify-content: space-between; align-items: flex-start;
    }
    .vi-header h2 { margin: 0; font-size: 1.5rem; font-weight: 700; color: #111; }
    .vi-header .vi-version-sub {
      font-size: 0.85rem; color: #666; font-family: monospace; margin-top: 2px;
    }
    .vi-close {
      background: none; border: none; font-size: 1.8rem; cursor: pointer;
      color: #999; line-height: 1; padding: 0 0 0 8px; transition: color 0.15s;
    }
    .vi-close:hover { color: #333; }
    .vi-body { padding: 1rem 1.5rem 1.5rem; }
    .vi-section { margin-bottom: 1.25rem; }
    .vi-section:last-child { margin-bottom: 0; }
    .vi-section-title {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.5rem; display: flex;
      align-items: center; gap: 6px;
    }
    .vi-section-title .vi-count {
      background: #eee; border-radius: 10px; padding: 1px 7px;
      font-size: 0.7rem; font-weight: 600;
    }
    .vi-item {
      padding: 6px 0; border-bottom: 1px solid #f5f5f5;
      display: flex; align-items: flex-start; gap: 8px;
      font-size: 0.9rem; line-height: 1.4;
    }
    .vi-item:last-child { border-bottom: none; }
    .vi-item-icon {
      flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; margin-top: 2px;
    }
    .vi-icon-bug { background: #dcfce7; color: #16a34a; }
    .vi-icon-feat { background: #dbeafe; color: #2563eb; }
    .vi-icon-change { background: #f3f4f6; color: #6b7280; }
    .vi-icon-pending { background: #fef3c7; color: #d97706; }
    .vi-item-text { flex: 1; min-width: 0; }
    .vi-item-desc { color: #333; word-break: break-word; }
    .vi-item-meta {
      font-size: 0.75rem; color: #999; font-family: monospace;
      margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .vi-empty { font-size: 0.85rem; color: #999; font-style: italic; padding: 4px 0; }
    .vi-tooltip {
      position: fixed; background: #1a1a2e; color: #f0f0f0;
      padding: 10px 16px; border-radius: 10px; font-size: 0.95rem;
      pointer-events: none; opacity: 0; transition: opacity 0.15s;
      z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      max-width: 360px; line-height: 1.5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .vi-tooltip-version { font-size: 1.1rem; font-weight: 700; margin-bottom: 4px; }
    .vi-tooltip-stats { font-size: 0.8rem; color: #aaa; }
    .vi-tooltip-stats span { color: #7dd3fc; }
  `;
  document.head.appendChild(style);
}

function showVersionModal(info) {
  document.getElementById('vi-modal-overlay')?.remove();
  injectStyles();

  const overlay = document.createElement('div');
  overlay.id = 'vi-modal-overlay';

  if (!info) {
    overlay.innerHTML = `
      <div id="vi-modal">
        <div class="vi-header">
          <div><h2>Build Info</h2></div>
          <button class="vi-close" data-close>&times;</button>
        </div>
        <div class="vi-body">
          <p style="color:#666;font-size:0.95rem;">No version.json found. Run <code>bump-version.sh</code> to generate.</p>
        </div>
      </div>`;
  } else {
    const bugfixes = info.bugfixes || {};
    const features = info.features || {};
    const branchMeta = info.branch_meta || {};
    const changes = info.changes || [];
    const included = info.included || [];
    const pending = info.pending || [];
    const models = info.models || {};
    const machine = info.machine || '';

    /** Render a small colored model badge for a branch */
    function modelBadge(branch) {
      const m = models[branch];
      if (!m) return '';
      return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:600;background:#fef3e2;color:#d4883a;margin-left:6px;vertical-align:middle;">${esc(m)}</span>`;
    }

    // Build bug fixes section — match included bugfix branches to descriptions
    const bugfixBranches = included.filter(b => b.includes('bugfix/'));
    let bugfixHtml = '';
    if (bugfixBranches.length > 0) {
      bugfixHtml = bugfixBranches.map(b => {
        const bid = branchId(b);
        const bugInfo = bid && bugfixes[bid];
        const desc = bugInfo ? bugInfo.desc : shortBranch(b);
        const page = bugInfo && bugInfo.page ? bugInfo.page : '';
        const pageName = page ? page.replace(/.*\//, '').replace('.html', '') : '';
        const meta = branchMeta[b];
        const timeLabel = meta?.commit_time ? ` · ${fmtTime(meta.commit_time)}` : '';
        return `<div class="vi-item">
          <div class="vi-item-icon vi-icon-bug">&#10003;</div>
          <div class="vi-item-text">
            <div class="vi-item-desc">${esc(desc)}${modelBadge(b)}</div>
            <div class="vi-item-meta">${bid || shortBranch(b)}${pageName ? ' · ' + esc(pageName) : ''}${timeLabel}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      bugfixHtml = '<div class="vi-empty">No bug fixes in this build</div>';
    }

    // Build recent changes section (non-bugfix commits)
    let changesHtml = '';
    if (changes.length > 0) {
      changesHtml = changes.map(c => `<div class="vi-item">
        <div class="vi-item-icon vi-icon-change">&#8226;</div>
        <div class="vi-item-text">
          <div class="vi-item-desc">${esc(c.msg)}</div>
          <div class="vi-item-meta">${esc(c.hash)}</div>
        </div>
      </div>`).join('');
    } else {
      changesHtml = '<div class="vi-empty">No recent changes</div>';
    }

    // Build pending section
    let pendingHtml = '';
    if (pending.length > 0) {
      pendingHtml = pending.map(b => {
        const featDesc = features[b] || '';
        const bid = branchId(b);
        const meta = branchMeta[b];
        const timeLabel = meta?.commit_time ? ` · ${fmtTime(meta.commit_time)}` : '';
        return `<div class="vi-item">
          <div class="vi-item-icon vi-icon-pending">&#9675;</div>
          <div class="vi-item-text">
            <div class="vi-item-desc">${featDesc ? esc(featDesc) : esc(shortBranch(b))}${modelBadge(b)}</div>
            <div class="vi-item-meta">${esc(shortBranch(b))}${timeLabel}</div>
          </div>
        </div>`;
      }).join('');
    }

    // Other included branches (non-bugfix)
    const otherBranches = included.filter(b => !b.includes('bugfix/') && !b.includes('main'));
    let otherHtml = '';
    if (otherBranches.length > 0) {
      otherHtml = otherBranches.map(b => {
        const meta = branchMeta[b];
        const timeLabel = meta?.commit_time ? ` · ${fmtTime(meta.commit_time)}` : '';
        return `<div class="vi-item">
          <div class="vi-item-icon vi-icon-feat">&#10003;</div>
          <div class="vi-item-text">
            <div class="vi-item-desc">${esc(shortBranch(b))}${modelBadge(b)}</div>
            <div class="vi-item-meta">${esc(shortBranch(b))}${timeLabel}</div>
          </div>
        </div>`;
      }).join('');
    }

    // Build model summary line
    const uniqueModels = [...new Set(Object.values(models))].filter(Boolean);
    const modelSummaryLine = info.model
      ? `<span style="color:#d4883a;font-weight:600;">${esc(info.model)}</span>`
      : (uniqueModels.length > 0 ? `<span style="color:#d4883a;">${uniqueModels.join(', ')}</span>` : '');

    overlay.innerHTML = `
      <div id="vi-modal">
        <div class="vi-header">
          <div>
            <h2>${esc(info.version)}</h2>
            <div class="vi-version-sub">${fmtTime(info.timestamp)} · ${esc(info.commit || '?')}</div>
          </div>
          <button class="vi-close" data-close>&times;</button>
        </div>
        <div class="vi-body">
          ${changes.length > 0 ? `
          <div class="vi-section">
            <div class="vi-section-title" style="color:#374151;">
              Recent Changes <span class="vi-count">${changes.length}</span>
            </div>
            ${changesHtml}
          </div>` : ''}

          <div class="vi-section">
            <div class="vi-section-title" style="color:#16a34a;">
              Bug Fixes <span class="vi-count">${bugfixBranches.length}</span>
            </div>
            ${bugfixHtml}
          </div>

          ${otherBranches.length > 0 ? `
          <div class="vi-section">
            <div class="vi-section-title" style="color:#2563eb;">
              Feature Branches <span class="vi-count">${otherBranches.length}</span>
            </div>
            ${otherHtml}
          </div>` : ''}

          ${pending.length > 0 ? `
          <div class="vi-section">
            <div class="vi-section-title" style="color:#d97706;">
              Pending <span class="vi-count">${pending.length}</span>
            </div>
            ${pendingHtml}
          </div>` : ''}
        </div>
      </div>`;
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });

  document.body.appendChild(overlay);
}

export function setupVersionInfo() {
  const span = findVersionSpan();
  if (!span) return;

  span.style.cursor = 'pointer';
  span.style.textDecoration = 'underline dotted';
  span.style.textUnderlineOffset = '2px';

  // Bump version font size slightly
  const computed = getComputedStyle(span);
  const currentSize = parseFloat(computed.fontSize);
  if (currentSize < 10) span.style.fontSize = '0.55rem';

  // Fetch version info and append dynamic model badge
  fetchVersionInfo().then(info => {
    if (!span.querySelector('.vi-model-badge')) {
      const badge = document.createElement('span');
      badge.className = 'vi-model-badge';
      const modelCode = (info && info.model) ? info.model : '';
      badge.textContent = modelCode ? ` ${modelCode}` : '';
      badge.style.cssText = 'color:#d4883a;font-weight:600;';
      span.appendChild(badge);
    }
  });

  injectStyles();

  // Hover tooltip — bigger, shows model and branch info
  const tooltip = document.createElement('div');
  tooltip.className = 'vi-tooltip';
  tooltip.innerHTML = '<div class="vi-tooltip-version">Loading...</div>';
  document.body.appendChild(tooltip);

  span.addEventListener('mouseenter', async () => {
    const info = await fetchVersionInfo();
    if (!info) {
      tooltip.innerHTML = '<div class="vi-tooltip-version">Build info unavailable</div>';
    } else {
      const bugCount = (info.included || []).filter(b => b.includes('bugfix/')).length;
      const changeCount = (info.changes || []).length;
      const pendCount = (info.pending || []).length;
      const modelLabel = info.model ? `<span style="color:#d4883a;font-weight:600;">${esc(info.model)}</span> · ` : '';

      // Build model summary from models map
      const models = info.models || {};
      const uniqueModels = [...new Set(Object.values(models))].filter(Boolean);
      const modelSummary = uniqueModels.length > 0
        ? `<div style="margin-top:4px;font-size:0.75rem;color:#9ca3af;">Models: ${uniqueModels.map(m => `<span style="color:#d4883a">${esc(m)}</span>`).join(', ')}</div>`
        : '';

      tooltip.innerHTML = `
        <div class="vi-tooltip-version">${esc(info.version)}</div>
        <div class="vi-tooltip-stats">
          ${modelLabel}<span>${bugCount}</span> bug fix${bugCount !== 1 ? 'es' : ''}
          · <span>${changeCount}</span> change${changeCount !== 1 ? 's' : ''}
          ${pendCount > 0 ? `· <span style="color:#fbbf24">${pendCount}</span> pending` : ''}
          · ${esc(info.commit || '?')}
        </div>
        <div class="vi-tooltip-stats" style="margin-top:4px;">
          ${modelSummaryLine ? `Model: ${modelSummaryLine}` : 'Model: unknown'}${machine ? ` · Machine: ${esc(machine)}` : ''}
        </div>
        ${modelSummary}
      `;
    }
    const rect = span.getBoundingClientRect();
    tooltip.style.left = Math.min(rect.left, window.innerWidth - 370) + 'px';
    tooltip.style.top = (rect.bottom + 8) + 'px';
    tooltip.style.opacity = '1';
  });

  span.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  // Click: full modal
  span.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    tooltip.style.opacity = '0';
    const info = await fetchVersionInfo();
    showVersionModal(info);
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setupVersionInfo());
} else {
  setupVersionInfo();
}
