/**
 * Resident Shell - Shared module for all resident pages
 * Provides: auth flow, tab navigation, toast notifications, lightbox
 * Cloned from admin-shell.js with resident-specific tab config
 */

import { initAuth, getAuthState, signOut, onAuthStateChange } from './auth.js';
import { errorLogger } from './error-logger.js';
import { initPaiWidget } from './pai-widget.js';

// =============================================
// TAB DEFINITIONS
// =============================================
const RESIDENT_TABS = [
  { id: 'homeauto', label: 'Lighting', href: 'lighting.html' },
  { id: 'music', label: 'Music', href: 'sonos.html' },
  { id: 'cameras', label: 'Cameras', href: 'cameras.html' },
  { id: 'climate', label: 'Climate', href: 'climate.html' },
  { id: 'laundry', label: 'Laundry', href: 'laundry.html' },
  { id: 'cars', label: 'Cars', href: 'cars.html' },
  // Future tabs:
  // { id: 'info', label: 'House Info', href: 'info.html' },
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
function renderResidentTabNav(activeTab, userRole) {
  const tabsContainer = document.querySelector('.manage-tabs');
  if (!tabsContainer) return;

  // Show context switcher for staff+ users (HTML is in page, hidden by default)
  const switcher = document.getElementById('contextSwitcher');
  if (switcher) {
    if (['staff', 'admin'].includes(userRole)) {
      switcher.classList.remove('hidden');
    }
  }

  tabsContainer.innerHTML = RESIDENT_TABS.map(tab => {
    const isActive = tab.id === activeTab;
    return `<a href="${tab.href}" class="manage-tab${isActive ? ' active' : ''}">${tab.label}</a>`;
  }).join('');
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
export async function initResidentPage({ activeTab, requiredRole = 'resident', onReady }) {
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

    // Check if user meets the required role
    // Role hierarchy: admin > staff > resident = associate
    const userRole = state.appUser?.role;
    const ROLE_LEVEL = { admin: 3, staff: 2, resident: 1, associate: 1 };
    const userLevel = ROLE_LEVEL[userRole] || 0;
    const requiredLevel = ROLE_LEVEL[requiredRole] || 0;
    const meetsRoleRequirement = userLevel >= requiredLevel;

    if (state.appUser && meetsRoleRequirement) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('appContent').classList.remove('hidden');
      document.getElementById('userInfo').textContent = state.appUser.display_name || state.appUser.email;

      // Update role badge and admin-only visibility
      const roleBadge = document.getElementById('roleBadge');
      if (roleBadge) {
        const role = state.appUser.role || 'resident';
        roleBadge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        roleBadge.className = 'role-badge ' + role;
      }
      if (state.appUser.role === 'admin') {
        document.body.classList.add('is-admin');
      } else {
        document.body.classList.remove('is-admin');
      }

      // Render tab navigation
      renderResidentTabNav(activeTab, state.appUser?.role);

      // Sign out handlers + PAI widget + version info (only bind once)
      if (!pageContentShown) {
        document.getElementById('signOutBtn')?.addEventListener('click', () => signOut());
        document.getElementById('headerSignOutBtn')?.addEventListener('click', () => signOut());
        initPaiWidget();
        setupVersionInfo();
      }

      pageContentShown = true;
      if (onReady && !onReadyCalled) {
        onReadyCalled = true;
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

// =============================================
// VERSION INFO (hover tooltip + click modal)
// =============================================
let versionInfoCache = null;

function findVersionSpan() {
  const pat = /^v\d{6}\.\d{2}/;
  for (const span of document.querySelectorAll('.header-left span')) {
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

function setupVersionInfo() {
  const span = findVersionSpan();
  if (!span) return;

  span.style.cursor = 'pointer';
  span.style.textDecoration = 'underline dotted';
  span.style.textUnderlineOffset = '2px';

  // Hover: show tooltip with commit hash + quick branch count
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

  // Click: full modal with branch lists
  span.addEventListener('click', async () => {
    tooltip.style.opacity = '0';
    const info = await fetchVersionInfo();
    showVersionModal(info);
  });
}

function showVersionModal(info) {
  document.getElementById('versionInfoModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'versionInfoModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

  if (!info) {
    overlay.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:12px;padding:1.5rem;max-width:400px;width:90%;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 style="margin:0;font-size:1rem;">Build Info</h3>
          <button style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text,#333);line-height:1" data-close>&times;</button>
        </div>
        <p style="color:var(--text-muted,#666);font-size:0.85rem;margin:0;">No version.json found. Run <code>bump-version.sh</code> to generate.</p>
      </div>`;
  } else {
    const inc = (info.included || []).map(b =>
      `<div style="font-size:0.8rem;padding:3px 0;display:flex;align-items:center;gap:6px;">
        <span style="color:var(--available,#27ae60);">&#10003;</span> <span style="font-family:monospace;word-break:break-all;">${esc(b)}</span>
      </div>`
    ).join('') || '<div style="font-size:0.8rem;color:var(--text-muted,#666);">None</div>';

    const pend = (info.pending || []).map(b =>
      `<div style="font-size:0.8rem;padding:3px 0;display:flex;align-items:center;gap:6px;">
        <span style="color:#f59e0b;">&#9675;</span> <span style="font-family:monospace;word-break:break-all;">${esc(b)}</span>
      </div>`
    ).join('') || '<div style="font-size:0.8rem;color:var(--text-muted,#666);">None</div>';

    overlay.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:12px;padding:1.5rem;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 style="margin:0;font-size:1rem;">Build Info</h3>
          <button style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text,#333);line-height:1" data-close>&times;</button>
        </div>
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.95rem;font-weight:600;">${esc(info.version)}</div>
          <div style="color:var(--text-muted,#666);font-size:0.75rem;font-family:monospace;margin-top:2px;">${esc(info.commit || '?')}</div>
          ${info.timestamp ? `<div style="color:var(--text-muted,#666);font-size:0.7rem;margin-top:2px;">${esc(info.timestamp)}</div>` : ''}
        </div>
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px;color:var(--available,#27ae60);">Included branches (${(info.included || []).length})</div>
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

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
