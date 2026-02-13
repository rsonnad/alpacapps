/**
 * Resident Shell - Shared module for all resident pages
 * Provides: auth flow, tab navigation, toast notifications, lightbox
 * Cloned from admin-shell.js with resident-specific tab config
 */

import { supabase } from './supabase.js';
import { initAuth, getAuthState, signOut, onAuthStateChange, hasAnyPermission } from './auth.js';
import { errorLogger } from './error-logger.js';
import { supabaseHealth } from './supabase-health.js';
import { initPaiWidget } from './pai-widget.js';
import { setupVersionInfo } from './version-info.js';
import { renderHeader, initSiteComponents } from './site-components.js';

// =============================================
// TAB DEFINITIONS
// =============================================
// Permission keys for staff/admin section detection (context switcher)
const STAFF_PERMISSION_KEYS = [
  'view_spaces', 'view_rentals', 'view_events', 'view_media', 'view_sms',
  'view_hours', 'view_faq', 'view_voice', 'view_todo',
];
const ADMIN_PERMISSION_KEYS = [
  'view_users', 'view_passwords', 'view_settings', 'view_templates', 'view_accounting', 'admin_pai_settings',
];

const DEVICE_PERMISSION_KEYS = ['view_lighting', 'view_music', 'view_cameras', 'view_climate', 'view_laundry', 'view_cars'];

const DEVICE_PAGE_PATHS = new Set([
  'devices.html', 'devices',
  'lighting.html', 'lighting',
  'sonos.html', 'sonos',
  'cameras.html', 'cameras',
  'climate.html', 'climate',
  'appliances.html', 'appliances',
  'laundry.html', 'laundry', // redirect stub compat
  'cars.html', 'cars',
  'sensors.html', 'sensors',
]);

const DEVICE_SUBTABS = [
  { id: 'list', label: 'List', href: 'devices.html', permissionsAny: DEVICE_PERMISSION_KEYS },
  { id: 'homeauto', label: 'Lighting', href: 'lighting.html', permission: 'view_lighting' },
  { id: 'music', label: 'Music', href: 'sonos.html', permission: 'view_music' },
  { id: 'cameras', label: 'Cameras', href: 'cameras.html', permission: 'view_cameras' },
  { id: 'climate', label: 'Climate', href: 'climate.html', permission: 'view_climate' },
  { id: 'appliances', label: 'Appliances', href: 'appliances.html', permission: 'view_laundry' },
  { id: 'cars', label: 'Cars', href: 'cars.html', permission: 'view_cars' },
  { id: 'sensors', label: 'Sensors', href: 'sensors.html', permission: 'view_cameras' },
];

const RESIDENT_CORE_TABS = [
  { id: 'profile', label: 'Profile', href: 'profile.html', permission: 'view_profile' },
  { id: 'bookkeeping', label: 'Bookkeeping', href: 'bookkeeping.html', permission: 'view_profile' },
  { id: 'media', label: 'Imagery', href: 'media.html', permission: 'view_profile' },
  { id: 'askpai', label: 'Ask PAI', href: 'ask-pai.html', permission: 'view_profile' },
];

const RESIDENT_STAFF_TABS = [
  { id: 'profile', label: 'Profile', href: 'profile.html', permission: 'view_profile' },
  { id: 'bookkeeping', label: 'Bookkeeping', href: 'bookkeeping.html', permission: 'view_profile' },
  { id: 'media', label: 'Imagery', href: 'media.html', permission: 'view_profile' },
  { id: 'askpai', label: 'Ask PAI', href: 'ask-pai.html', permission: 'view_profile' },
];

// =============================================
// TOAST NOTIFICATIONS
// =============================================
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
}

// =============================================
// TAB NAVIGATION
// =============================================
function renderResidentTabNav(activeTab, authState) {
  const tabsContainer = document.querySelector('.manage-tabs');
  if (!tabsContainer) return;

  // Show context switcher for users with any staff/admin permissions (or admin/oracle role)
  const role = authState.appUser?.role;
  const isAdminRole = role === 'admin' || role === 'oracle';
  const switcher = document.getElementById('contextSwitcher');
  if (switcher) {
    const hasStaffPerms = isAdminRole || authState.hasAnyPermission?.(...STAFF_PERMISSION_KEYS);
    const hasAdminPerms = isAdminRole || authState.hasAnyPermission?.(...ADMIN_PERMISSION_KEYS);
    if (hasStaffPerms || hasAdminPerms) {
      switcher.classList.remove('hidden');
    }
  }

  const hasStaffPerms = isAdminRole || authState.hasAnyPermission?.(...STAFF_PERMISSION_KEYS);
  const hasAdminPerms = isAdminRole || authState.hasAnyPermission?.(...ADMIN_PERMISSION_KEYS);
  const isStaffContext = hasStaffPerms || hasAdminPerms;
  const availableTabs = isStaffContext ? RESIDENT_STAFF_TABS : RESIDENT_CORE_TABS;

  // On device pages, hide resident-level tabs — only show device sub-tabs
  const currentPath = normalizeRouteToken(window.location.pathname.split('/').pop() || '');
  const isDevicePage = activeTab === 'devices' || DEVICE_PAGE_PATHS.has(currentPath);

  if (isDevicePage) {
    tabsContainer.innerHTML = '';
    tabsContainer.style.display = 'none';
    renderDeviceSubTabNav(activeTab, authState);
    return;
  }

  // Filter tabs by permission
  const tabs = availableTabs.filter((tab) => {
    if (Array.isArray(tab.permissionsAny) && tab.permissionsAny.length > 0) {
      return tab.permissionsAny.some((perm) => authState.hasPermission?.(perm));
    }
    return authState.hasPermission?.(tab.permission);
  });

  tabsContainer.innerHTML = tabs.map(tab => {
    const isActive = tab.id === activeTab;
    return `<a href="${tab.href}" class="manage-tab${isActive ? ' active' : ''}">${tab.label}</a>`;
  }).join('');
}

function hasTabAccess(tab, authState) {
  // Admin/oracle users bypass permission checks — they have access to everything
  const role = authState.appUser?.role;
  if (role === 'admin' || role === 'oracle') return true;

  if (Array.isArray(tab.permissionsAny) && tab.permissionsAny.length > 0) {
    return tab.permissionsAny.some((perm) => authState.hasPermission?.(perm));
  }
  return authState.hasPermission?.(tab.permission);
}

function renderDeviceSubTabNav(activeTab, authState) {
  const currentPath = normalizeRouteToken(window.location.pathname.split('/').pop() || '');
  const devicePageToTab = {
    'devices.html': 'list',
    devices: 'list',
    'lighting.html': 'homeauto',
    lighting: 'homeauto',
    'sonos.html': 'music',
    sonos: 'music',
    'cameras.html': 'cameras',
    cameras: 'cameras',
    'climate.html': 'climate',
    climate: 'climate',
    'appliances.html': 'appliances',
    appliances: 'appliances',
    'laundry.html': 'appliances',
    laundry: 'appliances',
    'cars.html': 'cars',
    cars: 'cars',
    'sensors.html': 'sensors',
    sensors: 'sensors',
  };
  const activeDeviceSubTab = devicePageToTab[currentPath] || (activeTab === 'devices' ? 'list' : null);
  const shouldRenderDeviceSubtabs = activeTab === 'devices' || Boolean(devicePageToTab[currentPath]);

  let subTabContainer = document.getElementById('deviceSubTabNav');
  if (!shouldRenderDeviceSubtabs) {
    if (subTabContainer) subTabContainer.remove();
    return;
  }

  const visibleSubtabs = DEVICE_SUBTABS.filter((tab) => hasTabAccess(tab, authState));
  if (visibleSubtabs.length === 0) {
    if (subTabContainer) subTabContainer.remove();
    return;
  }

  if (!subTabContainer) {
    subTabContainer = document.createElement('div');
    subTabContainer.id = 'deviceSubTabNav';
    subTabContainer.className = 'manage-tabs';
    const tabsContainer = document.querySelector('.manage-tabs');
    tabsContainer.insertAdjacentElement('afterend', subTabContainer);
  }

  subTabContainer.innerHTML = visibleSubtabs.map((tab) => {
    const isActive = tab.id === activeDeviceSubTab;
    return `<a href="${tab.href}" class="manage-tab${isActive ? ' active' : ''}">${tab.label}</a>`;
  }).join('');
}

function normalizeRouteToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.endsWith('.html') ? normalized : normalized;
}

// =============================================
// CONTEXT SWITCHER (Devices / Resident / Associate / Staff / Admin)
// =============================================
function renderContextSwitcher(authState) {
  const switcher = document.getElementById('contextSwitcher');
  if (!switcher) return;

  // Admin/oracle users always see the context switcher regardless of granular permissions
  const role = authState?.appUser?.role;
  const isAdminRole = role === 'admin' || role === 'oracle';
  const hasStaffPerms = hasAnyPermission(...STAFF_PERMISSION_KEYS);
  const hasAdminPerms = hasAnyPermission(...ADMIN_PERMISSION_KEYS);
  if (!isAdminRole && !hasStaffPerms && !hasAdminPerms) {
    switcher.classList.add('hidden');
    return;
  }

  const tabs = [
    { id: 'devices', label: 'Devices', href: '/residents/devices.html' },
    { id: 'resident', label: 'Residents', href: '/residents/' },
    { id: 'associate', label: 'Associates', href: '/associates/worktracking.html' },
    { id: 'staff', label: 'Staff', href: '/spaces/admin/' },
    { id: 'admin', label: 'Admin', href: '/spaces/admin/users.html' },
  ];

  const currentPath = normalizeRouteToken(window.location.pathname.split('/').pop() || '');
  const activeContext = DEVICE_PAGE_PATHS.has(currentPath) ? 'devices' : 'resident';

  const btns = tabs.map(tab => {
    if (tab.id === 'admin' && !hasAdminPerms) {
      return `<span class="context-switcher-btn disabled">${tab.label}</span>`;
    }
    const isActive = tab.id === activeContext;
    const activeClass = isActive ? ' active' : '';
    return `<a href="${tab.href}" class="context-switcher-btn${activeClass}">${tab.label}</a>`;
  }).join('');
  switcher.innerHTML = `<div class="context-switcher-pill">${btns}</div>`;
}

// =============================================
// USER INFO (HEADER AVATAR + NAME)
// =============================================

function renderUserInfo(el, appUser, profileHref) {
  if (!el) return;
  const name = appUser.display_name || appUser.email;
  const initials = getInitials(name);
  const avatarUrl = appUser.avatar_url;

  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" alt="" class="user-avatar">`
    : `<span class="user-avatar user-avatar--initials">${initials}</span>`;

  // Role-based navigation links
  const role = appUser.role || '';
  const isStaffOrAdmin = ['admin', 'oracle', 'staff'].includes(role);
  const manageLink = isStaffOrAdmin
    ? `<a href="/spaces/admin/spaces.html" class="user-menu-item">Manage</a>`
    : '';

  el.innerHTML = `
    <button class="user-menu-trigger" aria-haspopup="true" aria-expanded="false">
      ${avatarHtml}<span class="user-profile-name">${escapeHtml(name)}</span>
    </button>
    <div class="user-menu-dropdown hidden">
      <div id="roleBadge" class="role-badge dropdown-role-badge" style="display:none"></div>
      <a href="${profileHref}" class="user-menu-item">Profile</a>
      ${manageLink}
      <button type="button" class="user-menu-item user-menu-signout" id="headerSignOutBtn">Sign Out</button>
    </div>`;

  const trigger = el.querySelector('.user-menu-trigger');
  const dropdown = el.querySelector('.user-menu-dropdown');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', open);
    trigger.setAttribute('aria-expanded', !open);
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && trigger !== e.target && !trigger.contains(e.target)) {
      dropdown.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name[0].toUpperCase();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// =============================================
// SITE NAV INJECTION
// =============================================
let siteNavInitialized = false;

function injectSiteNav() {
  if (siteNavInitialized) return;
  const target = document.getElementById('siteHeader');
  if (!target) return;

  const versionEl = document.querySelector('[data-site-version]');
  const version = versionEl?.textContent?.trim() || '';

  target.innerHTML = renderHeader({
    transparent: false,
    light: false,
    version,
    showRoleBadge: true,
  });

  initSiteComponents();
  setupVersionInfo();
  siteNavInitialized = true;
}

// =============================================
// AUTH & PAGE INITIALIZATION
// =============================================

/**
 * Initialize a resident page with auth flow.
 * @param {Object} options
 * @param {string} options.activeTab - Which tab to highlight in nav
 * @param {string} options.requiredRole - Minimum role required ('resident', 'staff', or 'admin'). Default: 'resident'
 * @param {Function} options.onReady - Called with authState when authorized
 * @returns {Promise<Object>} authState
 */
export async function initResidentPage({ activeTab, requiredRole = 'resident', requiredPermission, onReady }) {
  // Set up global error handlers + health banner
  errorLogger.setupGlobalHandlers();
  supabaseHealth.injectBanner();

  await initAuth();
  let authState = getAuthState();
  let pageContentShown = false;
  let onReadyCalled = false;

  async function handleAuthState(state) {
    authState = state;

    // Set user context for error logging
    if (state.appUser) {
      errorLogger.setUserContext({
        userId: state.appUser.id,
        role: state.appUser.role,
        email: state.appUser.email,
      });
    }

    // Check if user meets the required permission or role
    const userRole = state.appUser?.role;
    let meetsRequirement;
    if (requiredPermission) {
      meetsRequirement = state.hasPermission?.(requiredPermission);
      // If permissions haven't loaded yet (empty set from cache/timeout) but the user's
      // role would normally grant access, don't deny — keep loading and wait for fresh perms.
      if (!meetsRequirement && state.permissions?.size === 0) {
        const ROLE_LEVEL = { oracle: 4, admin: 3, staff: 2, demon: 2, resident: 1, associate: 1 };
        const userLevel = ROLE_LEVEL[userRole] || 0;
        const requiredLevel = ROLE_LEVEL[requiredRole] || 0;
        if (userLevel >= requiredLevel) {
          return;
        }
      }
    } else {
      const ROLE_LEVEL = { oracle: 4, admin: 3, staff: 2, demon: 2, resident: 1, associate: 1 };
      const userLevel = ROLE_LEVEL[userRole] || 0;
      const requiredLevel = ROLE_LEVEL[requiredRole] || 0;
      meetsRequirement = userLevel >= requiredLevel;
    }

    if (state.appUser && meetsRequirement) {
      injectSiteNav();
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('unauthorizedOverlay')?.classList.add('hidden');
      document.getElementById('appContent').classList.remove('hidden');

      // Render user info into site nav auth container (replaces Sign In link)
      const siteAuthEl = document.getElementById('aapHeaderAuth');
      const legacyUserInfo = document.getElementById('userInfo');
      if (siteAuthEl) {
        renderUserInfo(siteAuthEl, state.appUser, 'profile.html');
        siteAuthEl.classList.add('user-info');
        const signInLink = document.getElementById('aapSignInLink');
        if (signInLink) signInLink.style.display = 'none';
        const mobileSignInLink = document.getElementById('aapMobileSignInLink');
        if (mobileSignInLink) mobileSignInLink.closest('li')?.remove();
        if (legacyUserInfo) legacyUserInfo.style.display = 'none';
      } else if (legacyUserInfo) {
        renderUserInfo(legacyUserInfo, state.appUser, 'profile.html');
      }

      // Update role badge and admin-only visibility
      const roleBadge = document.getElementById('roleBadge');
      if (roleBadge) {
        const role = state.appUser.role || 'resident';
        roleBadge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        roleBadge.className = 'role-badge ' + role;
        roleBadge.style.display = '';
      }
      if (['admin', 'oracle'].includes(state.appUser.role)) {
        document.body.classList.add('is-admin');
      } else {
        document.body.classList.remove('is-admin');
      }

      renderContextSwitcher(state);
      // Render tab navigation (pass full auth state for permission checks)
      renderResidentTabNav(activeTab, state);

      // Sign out handlers + PAI widget + version info (only bind once). Use delegation on userInfo so header dropdown Sign Out is reliable.
      if (!pageContentShown) {
        const handleSignOut = async () => {
          await signOut();
          window.location.href = '/login/';
        };
        document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);
        const userInfo = document.getElementById('userInfo');
        userInfo?.addEventListener('click', (e) => {
          if (e.target.closest('#headerSignOutBtn') || e.target.closest('.user-menu-signout')) {
            e.preventDefault();
            e.stopPropagation();
            handleSignOut();
          }
        });
        initPaiWidget();
        setupVersionInfo();
      }

      pageContentShown = true;
      if (onReady && !onReadyCalled) {
        onReadyCalled = true;
        // Ensure Supabase has a real session before onReady queries RLS-protected tables.
        // Cached auth resolves initAuth() before the JWT is ready, so getSession() forces
        // the client to establish the actual session first.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          // Session expired — cached auth kept the UI alive but we have no JWT.
          // Force re-login so RLS-protected queries work.
          console.warn('[resident-shell] No active session despite cached auth — redirecting to login');
          try { localStorage.removeItem('genalpaca-cached-auth'); } catch (e) { /* ignore */ }
          window.location.href = '/login/?redirect=' + encodeURIComponent(window.location.pathname);
          return;
        }
        onReady(state);
      }
    } else if (state.appUser || (state.isAuthenticated && state.isUnauthorized)) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('unauthorizedOverlay').classList.remove('hidden');
    } else if (!state.isAuthenticated && !pageContentShown) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(window.location.pathname);
    }
  }

  onAuthStateChange(handleAuthState);
  handleAuthState(authState);

  return authState;
}

// =============================================
// LIGHTBOX
// =============================================
let lightboxGallery = [];
let lightboxIndex = 0;
let currentGalleryUrls = [];

export function setCurrentGallery(photos) {
  currentGalleryUrls = photos.map(p => p.url);
}

export function openLightbox(imageUrl, galleryUrls = null) {
  const lightbox = document.getElementById('imageLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  if (lightbox && lightboxImage) {
    if (galleryUrls && galleryUrls.length > 0) {
      lightboxGallery = [...galleryUrls];
      lightboxIndex = lightboxGallery.indexOf(imageUrl);
      if (lightboxIndex === -1) lightboxIndex = 0;
    } else if (currentGalleryUrls.length > 0 && currentGalleryUrls.includes(imageUrl)) {
      lightboxGallery = [...currentGalleryUrls];
      lightboxIndex = lightboxGallery.indexOf(imageUrl);
    } else {
      lightboxGallery = [imageUrl];
      lightboxIndex = 0;
    }
    lightboxImage.src = imageUrl;
    lightbox.classList.remove('hidden');
    updateLightboxNav();
  }
}

function updateLightboxNav() {
  const prevBtn = document.getElementById('lightboxPrev');
  const nextBtn = document.getElementById('lightboxNext');
  if (prevBtn && nextBtn) {
    const showNav = lightboxGallery.length > 1;
    prevBtn.style.display = showNav ? 'flex' : 'none';
    nextBtn.style.display = showNav ? 'flex' : 'none';
  }
}

export function lightboxPrev() {
  if (lightboxIndex > 0) {
    lightboxIndex--;
    document.getElementById('lightboxImage').src = lightboxGallery[lightboxIndex];
    updateLightboxNav();
  }
}

export function lightboxNext() {
  if (lightboxIndex < lightboxGallery.length - 1) {
    lightboxIndex++;
    document.getElementById('lightboxImage').src = lightboxGallery[lightboxIndex];
    updateLightboxNav();
  }
}

export function closeLightbox() {
  const lightbox = document.getElementById('imageLightbox');
  if (lightbox) {
    lightbox.classList.add('hidden');
    document.getElementById('lightboxImage').src = '';
    lightboxGallery = [];
    lightboxIndex = 0;
  }
}

/**
 * Set up lightbox event listeners. Call once on page init.
 */
export function setupLightbox() {
  const lightbox = document.getElementById('imageLightbox');
  if (!lightbox) return;

  lightbox.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.getElementById('lightboxPrev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxPrev();
  });
  document.getElementById('lightboxNext')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxNext();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('hidden')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxPrev();
      if (e.key === 'ArrowRight') lightboxNext();
    }
  });
}
