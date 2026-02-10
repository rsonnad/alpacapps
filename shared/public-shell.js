/**
 * Public Shell - injects shared header + mobile nav
 */
import { renderHeader, initSiteComponents } from './site-components.js';
import { setupVersionInfo } from './version-info.js';

export function initPublicPage(options = {}) {
  const headerTarget = document.getElementById('siteHeader');
  if (!headerTarget) return;

  const versionEl = document.querySelector('[data-site-version]');
  const version = versionEl?.textContent?.trim() || '';

  headerTarget.innerHTML = renderHeader({
    transparent: false,
    light: true,
    activePage: '',
    showMistiq: false,
    version,
    ...options,
  });

  initSiteComponents();
  setupVersionInfo();
}

if (typeof window !== 'undefined') {
  window.aapPublic = { initPublicPage };
}
