(function () {
  // Don't inject on the rahulio/pages/ index itself.
  var p = location.pathname.replace(/\/+$/, '/');
  if (p === '/rahulio/pages/' || p === '/rahulio/pages/index.html') return;

  var style = document.createElement('style');
  style.textContent = [
    'body { padding-top: 38px !important; }',
    '#rahulio-page-header { position: fixed; top: 0; left: 0; right: 0; height: 38px; background: #1c1618; color: #f5f0e8; display: flex; align-items: center; justify-content: space-between; padding: 0 0.9rem; font: 500 0.78rem/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; z-index: 99999; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }',
    '#rahulio-page-header a.rph-back { color: #d4883a; text-decoration: none; font-weight: 600; white-space: nowrap; }',
    '#rahulio-page-header a.rph-back:hover { color: #f0a050; }',
    '#rahulio-page-header .rph-title { flex: 1; text-align: center; opacity: 0.85; padding: 0 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '#rahulio-page-header .rph-version { background: #33282b; color: #e8d8b8; padding: 0.28rem 0.55rem; border-radius: 4px; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.72rem; white-space: nowrap; }',
    '@media print { #rahulio-page-header { display: none !important; } body { padding-top: 0 !important; } }'
  ].join('\n');

  var bar = document.createElement('div');
  bar.id = 'rahulio-page-header';
  bar.innerHTML =
    '<a class="rph-back" href="/rahulio/pages/">← rahulio</a>' +
    '<span class="rph-title"></span>' +
    '<span class="rph-version">…</span>';

  function init() {
    if (!document.head) {
      setTimeout(init, 10);
      return;
    }
    document.head.appendChild(style);
    if (!document.body) {
      setTimeout(function () { document.body.insertBefore(bar, document.body.firstChild); attach(); }, 10);
      return;
    }
    document.body.insertBefore(bar, document.body.firstChild);
    attach();
  }

  function attach() {
    var titleEl = bar.querySelector('.rph-title');
    var verEl = bar.querySelector('.rph-version');
    titleEl.textContent = (document.title || '').replace(/\s+—.*$/, '').trim() || document.title || '';
    fetch('/version.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (v) { verEl.textContent = v && v.version ? v.version : '—'; })
      .catch(function () { verEl.textContent = '—'; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
