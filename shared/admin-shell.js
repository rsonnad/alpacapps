/**
 * Admin Shell - Shared module for all admin pages
 * Provides: auth flow, tab navigation, toast notifications, lightbox
 */

import { initAuth, getAuthState, signOut, onAuthStateChange, hasAnyPermission } from './auth.js';
import { errorLogger } from './error-logger.js';
import { renderHeader, initSiteComponents } from './site-components.js';
import { setupVersionInfo } from './version-info.js';

// =============================================
// TAB DEFINITIONS
// =============================================
// Permission keys for staff/admin section detection
const STAFF_PERMISSION_KEYS = [
  'view_spaces', 'view_rentals', 'view_events', 'view_media', 'view_sms',
  'view_hours', 'view_faq', 'view_voice', 'view_todo', 'view_projects',
];
const ADMIN_PERMISSION_KEYS = [
  'view_users', 'view_passwords', 'view_settings', 'view_templates', 'view_accounting',
];

const ALL_ADMIN_TABS = [
  // Staff section
  { id: 'spaces', label: 'Spaces', href: 'spaces.html', permission: 'view_spaces', section: 'staff' },
  { id: 'rentals', label: 'Rentals', href: 'rentals.html', permission: 'view_rentals', section: 'staff' },
  { id: 'events', label: 'Events', href: 'events.html', permission: 'view_events', section: 'staff' },
  { id: 'media', label: 'Media', href: 'media.html', permission: 'view_media', section: 'staff' },
  { id: 'sms', label: 'SMS', href: 'sms-messages.html', permission: 'view_sms', section: 'staff' },
  { id: 'hours', label: 'Hours', href: 'worktracking.html', permission: 'view_hours', section: 'staff' },
  { id: 'faq', label: 'FAQ/AI', href: 'faq.html', permission: 'view_faq', section: 'staff' },
  { id: 'voice', label: 'Concierge', href: 'voice.html', permission: 'view_voice', section: 'staff' },
  { id: 'todo', label: 'Todo', href: 'todo.html', permission: 'view_todo', section: 'staff' },
  { id: 'projects', label: 'Projects', href: 'projects.html', permission: 'view_projects', section: 'staff' },
  // Admin section
  { id: 'users', label: 'Users', href: 'users.html', permission: 'view_users', section: 'admin' },
  { id: 'passwords', label: 'Passwords', href: 'passwords.html', permission: 'view_passwords', section: 'admin' },
  { id: 'settings', label: 'Settings', href: 'settings.html', permission: 'view_settings', section: 'admin' },
  { id: 'templates', label: 'Templates', href: 'templates.html', permission: 'view_templates', section: 'admin' },
  { id: 'accounting', label: 'Accounting', href: 'accounting.html', permission: 'view_accounting', section: 'admin' },
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
export function renderTabNav(activeTab, authState, section = 'staff') {
  const tabsContainer = document.querySelector('.manage-tabs');
  if (!tabsContainer) return;

  // Show context switcher for users with any staff/admin permissions
  const switcher = document.getElementById('contextSwitcher');
  if (switcher) {
    const hasStaffPerms = authState.hasAnyPermission?.(...STAFF_PERMISSION_KEYS);
    const hasAdminPerms = authState.hasAnyPermission?.(...ADMIN_PERMISSION_KEYS);
    if (hasStaffPerms || hasAdminPerms) {
      switcher.classList.remove('hidden');
    }
  }

  // Filter tabs by section AND permission
  const tabs = ALL_ADMIN_TABS
    .filter(tab => tab.section === section)
    .filter(tab => authState.hasPermission?.(tab.permission));

  tabsContainer.innerHTML = tabs.map(tab => {
    const isActive = tab.id === activeTab;
    return `<a href="${tab.href}" class="manage-tab${isActive ? ' active' : ''}">${tab.label}</a>`;
  }).join('');
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

  el.innerHTML = `
    <button class="user-menu-trigger" aria-haspopup="true" aria-expanded="false">
      ${avatarHtml}<span class="user-profile-name">${escapeHtml(name)}</span>
    </button>
    <div class="user-menu-dropdown hidden">
      <a href="${profileHref}" class="user-menu-item">Profile</a>
      <button class="user-menu-item user-menu-signout" id="headerSignOutBtn">Sign Out</button>
    </div>`;

  const trigger = el.querySelector('.user-menu-trigger');
  const dropdown = el.querySelector('.user-menu-dropdown');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', open);
    trigger.setAttribute('aria-expanded', !open);
  });
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
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
// CONTEXT SWITCHER (Resident / Associate / Staff / Admin)
// =============================================
function renderContextSwitcher(userRole, activeSection = 'staff') {
  const switcher = document.getElementById('contextSwitcher');
  if (!switcher) return;

  // Show context switcher if user has any staff or admin permissions
  const hasStaffPerms = hasAnyPermission(...STAFF_PERMISSION_KEYS);
  const hasAdminPerms = hasAnyPermission(...ADMIN_PERMISSION_KEYS);
  if (!hasStaffPerms && !hasAdminPerms) {
    switcher.classList.add('hidden');
    return;
  }

  const tabs = [
    { id: 'resident', label: 'Residents', href: '/residents/' },
    { id: 'associate', label: 'Associates', href: '/associates/worktracking.html' },
    { id: 'staff', label: 'Staff', href: '/spaces/admin/' },
    { id: 'admin', label: 'Admin', href: '/spaces/admin/users.html' },
  ];

  const safeSection = hasAdminPerms && activeSection === 'admin' ? 'admin' : 'staff';
  switcher.innerHTML = tabs.map(tab => {
    if (tab.id === 'admin' && !hasAdminPerms) {
      return `<span class="context-switcher-btn disabled">${tab.label}</span>`;
    }
    const isActive = tab.id === safeSection || (tab.id === 'resident' && safeSection === 'resident');
    const activeClass = isActive ? ' active' : '';
    return `<a href="${tab.href}" class="context-switcher-btn${activeClass}">${tab.label}</a>`;
  }).join('');
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
 * Initialize an admin page with auth flow.
 * @param {Object} options
 * @param {string} options.activeTab - Which tab to highlight in nav
 * @param {string} options.requiredRole - Minimum role required ('staff' or 'admin'). Default: 'staff'
 * @param {Function} options.onReady - Called with authState when authorized
 * @returns {Promise<Object>} authState
 */
export async function initAdminPage({ activeTab, requiredRole = 'staff', requiredPermission, section = 'staff', onReady }) {
  // Set up global error handlers
  errorLogger.setupGlobalHandlers();

  await initAuth();
  let authState = getAuthState();
  let pageContentShown = false;
  let onReadyCalled = false;

  function handleAuthState(state) {
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
    } else if (userRole === 'demon') {
      const tabDef = ALL_ADMIN_TABS.find(t => t.id === activeTab);
      const tabPermission = tabDef?.permission;
      meetsRequirement = !!(tabPermission && state.hasPermission?.(tabPermission));
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
        renderUserInfo(siteAuthEl, state.appUser, '/residents/profile.html');
        siteAuthEl.classList.add('user-info');
        // Hide Sign In link
        const signInLink = document.getElementById('aapSignInLink');
        if (signInLink) signInLink.style.display = 'none';
        const mobileSignInLink = document.getElementById('aapMobileSignInLink');
        if (mobileSignInLink) mobileSignInLink.closest('li')?.remove();
        // Hide legacy user info container if site nav is active
        if (legacyUserInfo) legacyUserInfo.style.display = 'none';
      } else if (legacyUserInfo) {
        renderUserInfo(legacyUserInfo, state.appUser, '/residents/profile.html');
      }

      // Update role badge and admin-only visibility
      const roleBadge = document.getElementById('roleBadge');
      if (roleBadge) {
        const role = state.appUser.role || 'staff';
        roleBadge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        roleBadge.className = 'role-badge ' + role;
        roleBadge.style.display = '';
      }
      if (['admin', 'oracle'].includes(state.appUser.role)) {
        document.body.classList.add('is-admin');
      } else {
        document.body.classList.remove('is-admin');
      }
      if (state.appUser.role === 'demon') {
        document.body.classList.add('is-demo-mode');
      } else {
        document.body.classList.remove('is-demo-mode');
      }

      const userIsAdmin = ['admin', 'oracle'].includes(state.appUser.role);
      const isDemo = state.appUser.role === 'demon';
      const hasAdminPerms = state.hasAnyPermission?.(...ADMIN_PERMISSION_KEYS);
      const resolvedSection = section === 'admin' && (userIsAdmin || hasAdminPerms) ? 'admin' : 'staff';

      renderContextSwitcher(state.appUser?.role, resolvedSection);
      renderTabNav(activeTab, state, resolvedSection);

      let demoBanner = document.getElementById('demoModeBanner');
      if (isDemo && document.getElementById('appContent')) {
        const appContent = document.getElementById('appContent');
        if (!demoBanner) {
          demoBanner = document.createElement('div');
          demoBanner.id = 'demoModeBanner';
          demoBanner.className = 'demo-mode-banner';
          demoBanner.setAttribute('role', 'status');
          demoBanner.textContent = "You're viewing the app in demo mode. Names and dollar amounts are sample data only.";
          appContent.insertBefore(demoBanner, appContent.firstChild);
        }
        demoBanner.classList.remove('hidden');
      } else if (demoBanner) {
        demoBanner.classList.add('hidden');
      }

      if (!pageContentShown) {
        const handleSignOut = async () => {
          await signOut();
          window.location.href = '/login/';
        };
        document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);
        document.getElementById('headerSignOutBtn')?.addEventListener('click', handleSignOut);
      }

      pageContentShown = true;
      if (onReady && !onReadyCalled) {
        onReadyCalled = true;
        onReady(state);
      }
    } else if (state.appUser || (state.isAuthenticated && state.isUnauthorized)) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      const emailEl = document.getElementById('unauthorizedEmail');
      const email = state.user?.email || state.appUser?.email;
      if (emailEl && email) emailEl.textContent = `Signed in as ${email}`;
      document.getElementById('unauthorizedOverlay').classList.remove('hidden');
    } else if (!state.isAuthenticated && !pageContentShown) {
      // Only redirect to login if we haven't already shown page content.
      // Prevents disruptive redirects when Supabase session expires while
      // cached auth was keeping the page functional.
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
