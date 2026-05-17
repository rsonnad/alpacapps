// Intranet TOC — landing page showing all tabs the current user can access.
import { initAuth, getAuthState, onAuthStateChange } from '../shared/auth.js';
import { ALL_ADMIN_TABS, TAB_ICONS } from '../shared/admin-shell.js';
import { getEnabledFeatures } from '../shared/feature-registry.js';
import { renderHeader, initSiteComponents } from '../shared/site-components.js';
import { errorLogger } from '../shared/error-logger.js';

const SECTION_TITLES = { staff: 'Staff', admin: 'Admin' };

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function injectSiteHeader() {
  const target = document.getElementById('siteHeader');
  if (!target || target.dataset.rendered === '1') return;
  target.innerHTML = renderHeader({ currentPath: '/intranet/' });
  target.dataset.rendered = '1';
  initSiteComponents();
}

function renderSection(sectionId, gridEl, titleEl, tabs) {
  if (!tabs.length) {
    gridEl.innerHTML = '';
    titleEl.hidden = true;
    return 0;
  }
  titleEl.hidden = false;
  titleEl.textContent = SECTION_TITLES[sectionId] || sectionId;
  gridEl.innerHTML = tabs.map((tab) => {
    const icon = TAB_ICONS[tab.id] || '';
    return `
      <a class="intranet-card" href="${tab.href}">
        <div class="intranet-card-head">
          <span class="intranet-card-icon">${icon}</span>
          <span class="intranet-card-title">${escapeHtml(tab.label)}</span>
        </div>
        <div class="intranet-card-desc">${escapeHtml(tab.description || '')}</div>
      </a>
    `;
  }).join('');
  return tabs.length;
}

async function renderTOC(state) {
  const enabledFeatures = await getEnabledFeatures();
  const userRole = state.appUser?.role;
  const permissionsLoaded = state.permissions?.size > 0;
  const isAdminRole = ['admin', 'oracle'].includes(userRole);

  const accessible = ALL_ADMIN_TABS.filter((tab) => {
    if (tab.feature && !enabledFeatures[tab.feature]) return false;
    if (!permissionsLoaded && isAdminRole) return true;
    return state.hasPermission?.(tab.permission);
  });

  const staffTabs = accessible.filter((t) => t.section === 'staff');
  const adminTabs = accessible.filter((t) => t.section === 'admin');

  const staffCount = renderSection('staff',
    document.getElementById('staffGrid'),
    document.getElementById('staffSectionTitle'),
    staffTabs);
  const adminCount = renderSection('admin',
    document.getElementById('adminGrid'),
    document.getElementById('adminSectionTitle'),
    adminTabs);

  const emptyEl = document.getElementById('intranetEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', (staffCount + adminCount) > 0);
}

function showApp() {
  document.getElementById('loadingOverlay')?.classList.add('hidden');
  document.getElementById('appContent')?.classList.remove('hidden');
}

function redirectToLogin() {
  const next = encodeURIComponent('/intranet/');
  window.location.href = `/login/?redirect=${next}`;
}

function redirectUnauthorized(role) {
  // Non-staff users (resident/associate/public) shouldn't see the intranet TOC.
  if (['resident', 'associate'].includes(role)) {
    window.location.href = '/residents/';
  } else if (role === 'public') {
    window.location.href = '/rentals/';
  } else {
    redirectToLogin();
  }
}

async function boot() {
  errorLogger.setupGlobalHandlers?.();

  try {
    await initAuth();
  } catch (err) {
    console.error('[INTRANET]', 'initAuth failed', err);
    redirectToLogin();
    return;
  }

  let state = getAuthState();

  // Wait for pending → resolved (auth pipeline still loading permissions)
  if (state.isAuthenticated && state.isPending) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      const unsub = onAuthStateChange((s) => {
        if (!s.isPending) { clearTimeout(t); unsub(); resolve(); }
      });
    });
    state = getAuthState();
  }

  if (!state.isAuthenticated) { redirectToLogin(); return; }
  if (!state.isStaff) { redirectUnauthorized(state.role); return; }

  injectSiteHeader();
  showApp();
  await renderTOC(state);

  // Re-render if permissions arrive after initial paint
  onAuthStateChange((newState) => {
    if (newState.isAuthenticated && newState.isStaff) {
      renderTOC(newState);
    }
  });
}

document.addEventListener('DOMContentLoaded', boot);
