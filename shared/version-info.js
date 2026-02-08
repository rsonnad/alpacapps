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

function showVersionModal(info) {
  document.getElementById('versionInfoModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'versionInfoModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

  if (!info) {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:1.5rem;max-width:400px;width:90%;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 style="margin:0;font-size:1rem;">Build Info</h3>
          <button style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#333;line-height:1" data-close>&times;</button>
        </div>
        <p style="color:#666;font-size:0.85rem;margin:0;">No version.json found. Run <code>bump-version.sh</code> to generate.</p>
      </div>`;
  } else {
    const inc = (info.included || []).map(b =>
      `<div style="font-size:0.8rem;padding:3px 0;display:flex;align-items:center;gap:6px;">
        <span style="color:#27ae60;">&#10003;</span> <span style="font-family:monospace;word-break:break-all;">${esc(b)}</span>
      </div>`
    ).join('') || '<div style="font-size:0.8rem;color:#666;">None</div>';

    const pend = (info.pending || []).map(b =>
      `<div style="font-size:0.8rem;padding:3px 0;display:flex;align-items:center;gap:6px;">
        <span style="color:#f59e0b;">&#9675;</span> <span style="font-family:monospace;word-break:break-all;">${esc(b)}</span>
      </div>`
    ).join('') || '<div style="font-size:0.8rem;color:#666;">None</div>';

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:1.5rem;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 style="margin:0;font-size:1rem;">Build Info</h3>
          <button style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#333;line-height:1" data-close>&times;</button>
        </div>
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.95rem;font-weight:600;">${esc(info.version)}</div>
          <div style="color:#666;font-size:0.75rem;font-family:monospace;margin-top:2px;">${esc(info.commit || '?')}</div>
          ${info.timestamp ? `<div style="color:#666;font-size:0.7rem;margin-top:2px;">${esc(info.timestamp)}</div>` : ''}
        </div>
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px;color:#27ae60;">Included branches (${(info.included || []).length})</div>
          ${inc}
        </div>
        <div>
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px;color:#f59e0b;">Pending branches (${(info.pending || []).length})</div>
          ${pend}
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

  // Hover tooltip
  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:absolute;background:#1a1a2e;color:#e0e0e0;padding:6px 10px;border-radius:6px;font-size:0.7rem;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  tooltip.textContent = 'Loading...';
  document.body.appendChild(tooltip);

  span.addEventListener('mouseenter', async (e) => {
    const info = await fetchVersionInfo();
    if (!info) {
      tooltip.textContent = 'Build info unavailable';
    } else {
      const inc = (info.included || []).length;
      const pend = (info.pending || []).length;
      tooltip.textContent = `${info.commit || '?'}  ·  ${inc} branch${inc !== 1 ? 'es' : ''} included  ·  ${pend} pending`;
    }
    const rect = span.getBoundingClientRect();
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = (rect.bottom + 6) + 'px';
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
