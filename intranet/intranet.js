// Intranet TOC — landing page listing every internal page the current user
// can open: Devices, Residents, Associates, Staff, Admin, DevControl.
// Always renders chrome and a TOC; auth state changes which cards (or status
// message) are visible. We never blank the page or auto-redirect.
import { initAuth, getAuthState, onAuthStateChange } from '../shared/auth.js';
import { renderHeader, initSiteComponents, initPublicHeaderAuth } from '../shared/site-components.js';
import { setupVersionInfo } from '../shared/version-info.js';
import { ALL_ADMIN_TABS, TAB_ICONS as ADMIN_ICONS } from '../shared/admin-shell.js';
import { DEVICE_SUBTABS, RESIDENT_CORE_TABS, TAB_ICONS as RESIDENT_ICONS } from '../shared/resident-tabs.js';
import { getEnabledFeatures } from '../shared/feature-registry.js';
import { ROUTES } from '../shared/routes.js';

const _i = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EXTRA_ICONS = {
  worktracking: ADMIN_ICONS.hours,
  projects:   _i('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  inquiry:    _i('<path d="M4 4h16v12H5.17L4 17.17z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="12" x2="13" y2="12"/>'),
  permitting: _i('<path d="M9 2h6a1 1 0 011 1v2h3a1 1 0 011 1v15a2 2 0 01-2 2H6a2 2 0 01-2-2V6a1 1 0 011-1h3V3a1 1 0 011-1z"/><path d="M9 14l2 2 4-4"/>'),
  siteplan:   _i('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>'),
  paiimagery: _i('<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>'),
  aiCosts:    _i('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  devdocs:    _i('<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>'),
};
const ICON = (id) => ADMIN_ICONS[id] || RESIDENT_ICONS[id] || EXTRA_ICONS[id] || '';

// Section icons (24px badges in section headers)
const SECTION_ICONS = {
  devices:    RESIDENT_ICONS.homeauto,
  residents:  ADMIN_ICONS.spaces,
  associates: ADMIN_ICONS.hours,
  staff:      ADMIN_ICONS.inventory,
  admin:      ADMIN_ICONS.settings,
  devcontrol: ADMIN_ICONS.devcontrol,
};

const DEVICE_DESCRIPTIONS = {
  list:       'Every device on the property in one searchable list.',
  homeauto:   'Lights, scenes, and groups across every building.',
  music:      'Sonos zones, playlists, and volume.',
  cameras:    'Live camera feeds and recent motion.',
  climate:    'Thermostats, temperatures, and HVAC modes.',
  appliances: 'Oven, washer, dryer, and other smart appliances.',
  cars:       'Vehicle locations, charge levels, and controls.',
  sensors:    'Motion, door, and environment sensors.',
  printer3d:  '3D printer status, jobs, and camera.',
};
const DEVICE_LABELS = { list: 'All Devices' };

const RESIDENT_DESCRIPTIONS = {
  profile:     'Your name, contact info, photo, and preferences.',
  'my-access': 'Door codes, Wi-Fi, and what you can unlock.',
  bookkeeping: 'Your charges, payments, and balance.',
  media:       'Your photos and generated imagery.',
  askpai:      'Chat with PAI, the house assistant.',
};

const STAFF_ROLES = ['staff', 'admin', 'oracle'];
const adminTab = (id) => ALL_ADMIN_TABS.find((t) => t.id === id);
const adminTabs = (...ids) => ids.map(adminTab).filter(Boolean);

// Staff pages that aren't in the admin tab bar but are worth surfacing.
// They gate on staff role only (initAdminPage with no requiredPermission).
const STAFF_EXTRAS = {
  projects:   { id: 'projects',   label: 'Projects',         href: '/staff/projects.html',        staffRole: true, description: 'Property projects, scopes, and progress.' },
  paiimagery: { id: 'paiimagery', label: 'PAI Imagery',      href: '/staff/pai-imagery.html',     staffRole: true, feature: 'pai', description: 'Review and curate AI-generated imagery.' },
  permitting: { id: 'permitting', label: 'Permitting Plan',  href: '/staff/permittingplan.html',  staffRole: true, description: 'Permit roadmap, phases, and cost estimate.' },
  siteplan:   { id: 'siteplan',   label: 'Site Plan Editor', href: '/staff/siteplan-editor.html', staffRole: true, description: 'Edit the property site plan drawing.' },
};

// Section → groups → items. Order follows the context-switcher nav.
const SECTIONS = [
  {
    id: 'devices', tone: 'teal', title: 'Devices', tagline: 'Control the house — lights, music, cameras, climate.',
    groups: [{ items: DEVICE_SUBTABS.map((t) => ({
      ...t,
      label: DEVICE_LABELS[t.id] || t.label,
      description: DEVICE_DESCRIPTIONS[t.id] || '',
    })) }],
  },
  {
    id: 'residents', tone: 'violet', title: 'Residents', tagline: 'Your own account, access, and assistant.',
    groups: [{ items: RESIDENT_CORE_TABS.map((t) => ({ ...t, description: RESIDENT_DESCRIPTIONS[t.id] || '' })) }],
  },
  {
    id: 'associates', tone: 'amber', title: 'Associates', tagline: 'Clock in, log work, and track projects.',
    groups: [{ items: [
      { id: 'worktracking', label: 'Work Tracking',   href: ROUTES.associates.worktracking,   associate: true, description: 'Clock in and out, log hours, and upload work photos.' },
      { id: 'projects',     label: 'My Projects',     href: ROUTES.associates.projects,       associate: true, description: 'Projects you are assigned to.' },
      { id: 'inquiry',      label: 'Project Inquiry', href: ROUTES.associates.projectInquiry, associate: true, description: 'Propose or ask about a new project.' },
    ] }],
  },
  {
    id: 'staff', tone: 'orange', title: 'Staff', tagline: 'Run the property day to day.',
    groups: [
      { title: 'Property',        items: adminTabs('spaces', 'phyprop', 'inventory', 'vendors', 'purchases') },
      { title: 'Rentals & Events', items: adminTabs('rentals', 'reservations', 'events') },
      { title: 'Team & Pay',      items: [...adminTabs('hours', 'payments', 'todo'), STAFF_EXTRAS.projects] },
      { title: 'Comms & AI',      items: [...adminTabs('sms', 'voice', 'faq', 'media'), STAFF_EXTRAS.paiimagery] },
      { title: 'Planning & Dev',  items: [STAFF_EXTRAS.permitting, STAFF_EXTRAS.siteplan, ...adminTabs('appdev')] },
    ],
  },
  {
    id: 'admin', tone: 'rose', title: 'Admin', tagline: 'People, money, documents, and system config.',
    groups: [
      { title: 'People & Access', items: adminTabs('users', 'passwords') },
      { title: 'Leasing',         items: adminTabs('applications', 'signatures', 'templates') },
      { title: 'Finance',         items: adminTabs('accounting', 'aiCosts') },
      { title: 'System',          items: adminTabs('settings', 'notifications', 'brand', 'releases') },
      { title: 'AI Agents',       items: adminTabs('lifeofpai', 'openclaw') },
      { title: 'Testing',         items: adminTabs('testsuite', 'testdev') },
    ],
  },
  {
    id: 'devcontrol', tone: 'blue', title: 'DevControl', tagline: 'Engineering: schema, deploys, docs, infra.',
    groups: [{ items: [
      ...adminTabs('devcontrol'),
      { id: 'devdocs', label: 'Dev Docs', href: '/devcontrol/devdocs/', permission: 'view_devcontrol', description: 'Schema, patterns, deploy, and integration docs.' },
    ] }],
  },
];

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function el(id) { return document.getElementById(id); }

function makeCanAccess(state, enabledFeatures) {
  const role = state?.appUser?.role;
  const isAdminRole = ['admin', 'oracle'].includes(role);
  const isStaffRole = STAFF_ROLES.includes(role);
  const permissionsLoaded = state?.permissions?.size > 0;
  const has = (p) => !!state?.hasPermission?.(p);

  return (item) => {
    if (item.feature && !enabledFeatures[item.feature]) return false;
    if (!state?.isAuthenticated) return true;               // preview-friendly
    if (isAdminRole) return true;
    if (item.associate) return isStaffRole || has('clock_in_out') || has('view_own_hours');
    if (item.staffRole) return isStaffRole;
    if (!permissionsLoaded && isStaffRole) return true;     // perms still loading
    if (item.permissionsAny) return item.permissionsAny.some(has);
    if (item.permission) return has(item.permission);
    return isStaffRole;
  };
}

function cardHtml(item) {
  const label = item.description ? `${item.label} — ${item.description}` : item.label;
  const search = `${item.label} ${item.description || ''}`.toLowerCase();
  return `
    <a class="ix-card" href="${item.href}" aria-label="${escapeHtml(label)}" data-search="${escapeHtml(search)}">
      <span class="ix-card-icon" aria-hidden="true">${ICON(item.id)}</span>
      <span class="ix-card-body">
        <span class="ix-card-title">${escapeHtml(item.label)}</span>
        <span class="ix-card-desc">${escapeHtml(item.description || '')}</span>
      </span>
    </a>`;
}

function renderSections(canAccess) {
  const visible = SECTIONS.map((section) => {
    const groups = section.groups
      .map((g) => ({ ...g, items: g.items.filter(canAccess) }))
      .filter((g) => g.items.length);
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    return { ...section, groups, count };
  }).filter((s) => s.count);

  el('intranetSections').innerHTML = visible.map((s) => `
    <section class="ix-section" id="sec-${s.id}" data-section="${s.id}" data-tone="${s.tone}">
      <div class="ix-section-head">
        <span class="ix-section-icon" aria-hidden="true">${SECTION_ICONS[s.id] || ''}</span>
        <div class="ix-section-text">
          <h2 class="ix-section-title">${escapeHtml(s.title)} <span class="ix-section-count">${s.count}</span></h2>
          <p class="ix-section-tagline">${escapeHtml(s.tagline)}</p>
        </div>
      </div>
      <div class="ix-groups${s.groups.length > 1 ? ' ix-groups--multi' : ''}">
        ${s.groups.map((g) => `
          <div class="ix-group">
            ${g.title ? `<h3 class="ix-group-title">${escapeHtml(g.title)}</h3>` : ''}
            <div class="ix-grid">${g.items.map(cardHtml).join('')}</div>
          </div>`).join('')}
      </div>
    </section>`).join('');

  el('intranetJump').innerHTML = visible.map((s) => `
    <a class="ix-chip" href="#sec-${s.id}" data-section="${s.id}" data-tone="${s.tone}">
      ${escapeHtml(s.title)}<span class="ix-chip-count">${s.count}</span>
    </a>`).join('');

  applyFilter();
  return visible.reduce((n, s) => n + s.count, 0);
}

// ---- Search filter ----------------------------------------------------------
function applyFilter() {
  const q = (el('intranetSearch')?.value || '').trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.ix-section').forEach((section) => {
    let sectionShown = 0;
    section.querySelectorAll('.ix-group').forEach((group) => {
      let groupShown = 0;
      group.querySelectorAll('.ix-card').forEach((card) => {
        const match = !q || card.dataset.search.includes(q);
        card.classList.toggle('hidden', !match);
        if (match) groupShown++;
      });
      group.classList.toggle('hidden', !groupShown);
      sectionShown += groupShown;
    });
    section.classList.toggle('hidden', !sectionShown);
    document.querySelector(`.ix-chip[data-section="${section.dataset.section}"]`)
      ?.classList.toggle('ix-chip--dim', !sectionShown);
    shown += sectionShown;
  });
  el('intranetNoMatch')?.classList.toggle('hidden', !q || shown > 0);
}

function wireSearch() {
  const input = el('intranetSearch');
  if (!input) return;
  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!input.value.trim()) return;
      const first = document.querySelector('.ix-card:not(.hidden)');
      if (first) window.location.href = first.getAttribute('href');
    } else if (e.key === 'Escape') {
      input.value = '';
      applyFilter();
      input.blur();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
    }
  });
}

// Sections render after load, so the browser can't jump to #sec-* itself.
// /staff/, /admin/, /devices/ redirect here with those hashes.
function scrollToHashSection() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id.startsWith('sec-')) return;
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: 'start' });
  document.querySelectorAll('.ix-section--focus').forEach((n) => n.classList.remove('ix-section--focus'));
  target.classList.add('ix-section--focus');
}

// ---- Status ----------------------------------------------------------------
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
  const total = renderSections(makeCanAccess(state, enabledFeatures));

  if (!state || !state.isAuthenticated) {
    showStatus('You are not signed in. <a href="/login/?redirect=%2Fintranet%2F">Sign in</a> to open these pages.');
    el('intranetGreeting').textContent = 'Intranet';
    el('intranetSubtitle').textContent = 'Preview of every internal page. Sign in to open them.';
  } else if (total === 0) {
    showStatus('Your account doesn\'t have access to any internal pages yet. Ask an admin to grant access.');
  } else {
    hideStatus();
    const name = state.appUser?.display_name || state.appUser?.email || '';
    el('intranetGreeting').textContent = name ? `Hi ${name.split(/\s+/)[0]}` : 'Intranet';
    el('intranetSubtitle').textContent = `${total} pages you can open. Press / to search.`;
  }
}

// Same site header as the staff/admin shells (logo, wordmark, nav, user menu).
function injectSiteHeader() {
  const target = el('siteHeader');
  if (!target) return;
  const version = document.querySelector('[data-site-version]')?.textContent?.trim() || '';
  target.innerHTML = renderHeader({ transparent: false, light: false, version, showRoleBadge: true });
  initSiteComponents();
  setupVersionInfo();
  initPublicHeaderAuth({ authContainerId: 'aapHeaderAuth', signInLinkId: 'aapSignInLink' });
}

async function boot() {
  injectSiteHeader();
  wireSearch();
  window.addEventListener('hashchange', scrollToHashSection);
  // Render immediately with no auth state so the page is never blank.
  await renderTOC(null);
  scrollToHashSection();

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

  await renderTOC(state);
  scrollToHashSection();

  onAuthStateChange((s) => renderTOC(s));
}

document.addEventListener('DOMContentLoaded', boot);
