// Intranet TOC — landing page showing all tabs the current user can access.
// Always renders chrome and a TOC; auth state changes which cards (or status
// message) are visible. We never blank the page or auto-redirect.
import { initAuth, getAuthState, onAuthStateChange, signOut } from '../shared/auth.js';
import { ALL_ADMIN_TABS, TAB_ICONS } from '../shared/admin-shell.js';
import { getEnabledFeatures } from '../shared/feature-registry.js';

const SECTION_TITLES = { staff: 'Staff', admin: 'Admin' };

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function el(id) { return document.getElementById(id); }

function renderSection(gridEl, titleEl, sectionId, tabs) {
  if (!tabs.length) {
    gridEl.innerHTML = '';
    titleEl.classList.add('hidden');
    return 0;
  }
  titleEl.classList.remove('hidden');
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

function showStatus(html) {
  const node = el('intranetStatus');
  if (!node) return;
  node.innerHTML = html;
  node.classList.remove('hidden');
}

function hideStatus() {
  el('intranetStatus')?.classList.add('hidden');
}

async function renderTOC(state) {
  const enabledFeatures = await getEnabledFeatures();
  const userRole = state?.appUser?.role;
  const permissionsLoaded = state?.permissions?.size > 0;
  const isAdminRole = ['admin', 'oracle'].includes(userRole);
  const isStaffRole = ['staff', 'admin', 'oracle'].includes(userRole);

  // Pick which tabs to surface based on auth state. For unauthenticated /
  // preview users we still render every tab so the page is never blank.
  const accessible = ALL_ADMIN_TABS.filter((tab) => {
    if (tab.feature && !enabledFeatures[tab.feature]) return false;
    if (!state?.isAuthenticated) return true;             // preview-friendly
    if (isAdminRole) return true;
    if (!permissionsLoaded && isStaffRole) return true;   // perms still loading
    if (!isStaffRole) return false;
    return state.hasPermission?.(tab.permission);
  });

  const staffTabs = accessible.filter((t) => t.section === 'staff');
  const adminTabs = accessible.filter((t) => t.section === 'admin');

  const total =
    renderSection(el('staffGrid'), el('staffSectionTitle'), 'staff', staffTabs) +
    renderSection(el('adminGrid'), el('adminSectionTitle'), 'admin', adminTabs);

  // Status messaging
  if (!state || !state.isAuthenticated) {
    showStatus('You are not signed in. <a href="/login/?redirect=%2Fintranet%2F">Sign in</a> to access these tools.');
    el('intranetGreeting').textContent = 'Intranet preview';
    el('intranetSubtitle').textContent = 'Sign in to actually open any of these.';
  } else if (!isStaffRole) {
    showStatus('Your account does not have staff access. Contact an admin if you think this is wrong.');
  } else if (total === 0) {
    showStatus('You don\'t have permission to view any sections yet. Ask an admin to grant access.');
  } else {
    hideStatus();
    const name = state.appUser?.display_name || state.appUser?.email || '';
    if (name) el('intranetGreeting').textContent = `Hi ${escapeHtml(name.split(/\s+/)[0])} — pick a section`;
    el('intranetSubtitle').textContent = 'Everything in the staff and admin areas, in one place.';
  }
}

function wireSignOut() {
  const btn = el('signOutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await signOut();
    } finally {
      window.location.href = '/login/';
    }
  });
}

async function boot() {
  // Render immediately with no auth state so the page is never blank.
  await renderTOC(null);
  wireSignOut();

  try {
    await initAuth();
  } catch (err) {
    console.error('[INTRANET]', 'initAuth failed', err);
    return;
  }

  let state = getAuthState();
  if (state.isAuthenticated && state.isPending) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      const unsub = onAuthStateChange((s) => {
        if (!s.isPending) { clearTimeout(t); unsub(); resolve(); }
      });
    });
    state = getAuthState();
  }

  if (state.isAuthenticated) el('signOutBtn')?.classList.remove('hidden');
  await renderTOC(state);

  onAuthStateChange((s) => {
    if (s.isAuthenticated) el('signOutBtn')?.classList.remove('hidden');
    else el('signOutBtn')?.classList.add('hidden');
    renderTOC(s);
  });
}

document.addEventListener('DOMContentLoaded', boot);
