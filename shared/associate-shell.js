/**
 * Associate Shell - Shared module for all associate pages
 * Provides: auth flow, tab navigation, context switcher, toast notifications
 * Cloned from resident-shell.js with associate-specific tab config
 */

import { supabase } from './supabase.js';
import { initAuth, getAuthState, signOut, onAuthStateChange, hasAnyPermission } from './auth.js';
import { errorLogger } from './error-logger.js';
import { setupVersionInfo } from './version-info.js';

// =============================================
// TAB DEFINITIONS
// =============================================
// Permission keys for staff/admin section detection (context switcher)
const STAFF_PERMISSION_KEYS = [
  'view_spaces', 'view_rentals', 'view_events', 'view_media', 'view_sms',
  'view_hours', 'view_faq', 'view_voice', 'view_todo', 'view_projects',
];
const ADMIN_PERMISSION_KEYS = [
  'view_users', 'view_passwords', 'view_settings', 'view_templates', 'view_accounting',
];

const ASSOCIATE_TABS = [
  { id: 'hours', label: 'Work Planning', href: 'worktracking.html' },
  { id: 'projects', label: 'Projects', href: 'projects.html' },
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
function renderAssociateTabNav(activeTab) {
  const tabsContainer = document.querySelector('.manage-tabs');
  if (!tabsContainer) return;

  tabsContainer.innerHTML = ASSOCIATE_TABS.map(tab => {
    const isActive = tab.id === activeTab;
    return `<a href="${tab.href}" class="manage-tab${isActive ? ' active' : ''}">${tab.label}</a>`;
  }).join('');
}

// =============================================
// CONTEXT SWITCHER (Resident / Associate / Staff / Admin)
// =============================================
function renderContextSwitcher() {
  const switcher = document.getElementById('contextSwitcher');
  if (!switcher) return;

  const hasStaffPerms = hasAnyPermission(...STAFF_PERMISSION_KEYS);
  const hasAdminPerms = hasAnyPermission(...ADMIN_PERMISSION_KEYS);
  if (!hasStaffPerms && !hasAdminPerms) {
    // Still show switcher for associates (they can see Resident + Associate at minimum)
    // but hide Staff/Admin if no perms
  }

  const tabs = [
    { id: 'resident', label: 'Residents', href: '/residents/' },
    { id: 'associate', label: 'Associates', href: '/associates/worktracking.html' },
    { id: 'staff', label: 'Staff', href: '/spaces/admin/' },
    { id: 'admin', label: 'Admin', href: '/spaces/admin/users.html' },
  ];

  switcher.innerHTML = tabs.map(tab => {
    if (tab.id === 'admin' && !hasAdminPerms) {
      return `<span class="context-switcher-btn disabled">${tab.label}</span>`;
    }
    if (tab.id === 'staff' && !hasStaffPerms) {
      return `<span class="context-switcher-btn disabled">${tab.label}</span>`;
    }
    const isActive = tab.id === 'associate';
    const activeClass = isActive ? ' active' : '';
    return `<a href="${tab.href}" class="context-switcher-btn${activeClass}">${tab.label}</a>`;
  }).join('');

  switcher.classList.remove('hidden');
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
// AUTH & PAGE INITIALIZATION
// =============================================

/**
 * Initialize an associate page with auth flow.
 * @param {Object} options
 * @param {string} options.activeTab - Which tab to highlight in nav
 * @param {Function} options.onReady - Called with authState when authorized
 * @returns {Promise<Object>} authState
 */
export async function initAssociatePage({ activeTab, onReady }) {
  // Set up global error handlers
  errorLogger.setupGlobalHandlers();

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

    // Associates, staff, admin, and oracle can access associate pages
    const userRole = state.appUser?.role;
    const allowedRoles = ['associate', 'staff', 'admin', 'oracle', 'demon'];
    const meetsRequirement = allowedRoles.includes(userRole);

    if (state.appUser && meetsRequirement) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('appContent').classList.remove('hidden');
      renderUserInfo(document.getElementById('userInfo'), state.appUser, '/residents/profile.html');

      // Update role badge
      const roleBadge = document.getElementById('roleBadge');
      if (roleBadge) {
        const role = state.appUser.role || 'associate';
        roleBadge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        roleBadge.className = 'role-badge ' + role;
      }

      renderContextSwitcher();
      renderAssociateTabNav(activeTab);

      // Sign out handlers + version info (only bind once). Use delegation on userInfo so header dropdown Sign Out is reliable.
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
        setupVersionInfo();
      }

      pageContentShown = true;
      if (onReady && !onReadyCalled) {
        onReadyCalled = true;
        // Ensure Supabase has a real session before onReady queries RLS-protected tables.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          console.warn('[associate-shell] No active session despite cached auth — redirecting to login');
          try { localStorage.removeItem('genalpaca-cached-auth'); } catch (e) { /* ignore */ }
          window.location.href = '/login/?redirect=' + encodeURIComponent(window.location.pathname);
          return;
        }
        onReady(state);
      }
    } else if (state.appUser || (state.isAuthenticated && state.isUnauthorized)) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('unauthorizedOverlay')?.classList.remove('hidden');
    } else if (!state.isAuthenticated && !pageContentShown) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(window.location.pathname);
    }
  }

  onAuthStateChange(handleAuthState);
  handleAuthState(authState);

  return authState;
}
