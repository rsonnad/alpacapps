/**
 * Mobile App - Auth, tab switching, lazy initialization
 * Single-page app orchestrator for the Alpaca Playhouse mobile app.
 */

import { initAuth, getAuthState, signOut, onAuthStateChange } from '../../shared/auth.js';
import { userHasTeslaAccount } from '../../shared/services/cars-data.js';

// =============================================
// STATE
// =============================================
let currentTab = 'cameras';
let tabsInitialized = {};
let appUser = null;

// Tab modules (lazy-loaded)
const tabModules = {};

// =============================================
// AUTH FLOW
// =============================================
async function initApp() {
  await initAuth();
  let authState = getAuthState();

  function handleAuth(state) {
    authState = state;
    const userRole = state.appUser?.role;
    const ROLE_LEVEL = { admin: 3, staff: 2, resident: 1, associate: 1 };
    const userLevel = ROLE_LEVEL[userRole] || 0;

    if (state.appUser && userLevel >= 1) {
      // Authorized resident+
      appUser = state.appUser;
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('appContent').classList.remove('hidden');
      document.getElementById('userInfo').textContent = state.appUser.display_name || state.appUser.email;

      // Check cars tab visibility
      checkCarsVisibility(state);

      // Initialize current tab
      initTab(currentTab);

    } else if (state.appUser || (state.isAuthenticated && state.isUnauthorized)) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      document.getElementById('unauthorizedOverlay').classList.remove('hidden');
    } else if (!state.isAuthenticated) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(window.location.pathname);
    }
  }

  onAuthStateChange(handleAuth);
  handleAuth(authState);

  // Sign out handler
  document.getElementById('signOutBtn')?.addEventListener('click', () => signOut());
}

// =============================================
// CARS TAB VISIBILITY
// =============================================
async function checkCarsVisibility(authState) {
  const role = authState.appUser?.role;
  const carsBtn = document.getElementById('carsTabBtn');
  if (!carsBtn) return;

  // Staff/admin always see cars tab
  if (['staff', 'admin'].includes(role)) {
    carsBtn.classList.remove('hidden');
    return;
  }

  // Resident: only show if they have a linked Tesla account
  const hasTesla = await userHasTeslaAccount(authState.appUser?.id);
  if (hasTesla) {
    carsBtn.classList.remove('hidden');
  } else {
    carsBtn.classList.add('hidden');
    // If currently on cars tab, switch away
    if (currentTab === 'cars') switchTab('cameras');
  }
}

// =============================================
// TAB SWITCHING
// =============================================
function switchTab(tabId) {
  if (currentTab === tabId) return;

  // Update content sections
  document.querySelectorAll('.m-tab-content').forEach(s => s.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');

  // Update tab bar buttons
  document.querySelectorAll('.m-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  currentTab = tabId;
  initTab(tabId);
}

function setupTabBar() {
  document.getElementById('tabBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.m-tab-btn');
    if (!btn || btn.classList.contains('hidden')) return;
    const tab = btn.dataset.tab;
    if (tab) switchTab(tab);
  });
}

// =============================================
// LAZY TAB INITIALIZATION
// =============================================
async function initTab(tabId) {
  if (tabsInitialized[tabId]) return;
  tabsInitialized[tabId] = true;

  try {
    switch (tabId) {
      case 'cameras': {
        const mod = await import('./tabs/cameras-tab.js');
        tabModules.cameras = mod;
        mod.init(appUser);
        break;
      }
      case 'music': {
        const mod = await import('./tabs/music-tab.js');
        tabModules.music = mod;
        mod.init(appUser);
        break;
      }
      case 'lights': {
        const mod = await import('./tabs/lights-tab.js');
        tabModules.lights = mod;
        mod.init(appUser);
        break;
      }
      case 'climate': {
        const mod = await import('./tabs/climate-tab.js');
        tabModules.climate = mod;
        mod.init(appUser);
        break;
      }
      case 'cars': {
        const mod = await import('./tabs/cars-tab.js');
        tabModules.cars = mod;
        mod.init(appUser);
        break;
      }
    }
  } catch (err) {
    console.error(`Failed to init tab ${tabId}:`, err);
    const container = document.getElementById(`${tabId}Content`);
    if (container) {
      container.innerHTML = `<div class="m-error">Failed to load ${tabId}. Pull down to retry.</div>`;
    }
    tabsInitialized[tabId] = false;
  }
}

// =============================================
// BOOTSTRAP
// =============================================
setupTabBar();
initApp();
