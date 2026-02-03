// Login page application
import { supabase } from '../shared/supabase.js';
import { initAuth, signInWithGoogle, signOut, getAuthState } from '../shared/auth.js';

// DOM elements
const loginContent = document.getElementById('loginContent');
const loadingContent = document.getElementById('loadingContent');
const errorContent = document.getElementById('errorContent');
const unauthorizedContent = document.getElementById('unauthorizedContent');
const googleSignInBtn = document.getElementById('googleSignIn');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');

// Get redirect URL from query params
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect') || '/spaces/admin/';

/**
 * Show a specific UI state
 */
function showState(state, message = '') {
  loginContent.classList.add('hidden');
  loadingContent.classList.add('hidden');
  errorContent.classList.add('hidden');
  unauthorizedContent.classList.add('hidden');

  switch (state) {
    case 'login':
      loginContent.classList.remove('hidden');
      break;
    case 'loading':
      loadingContent.classList.remove('hidden');
      break;
    case 'error':
      errorContent.classList.remove('hidden');
      errorMessage.textContent = message || 'An error occurred';
      break;
    case 'unauthorized':
      unauthorizedContent.classList.remove('hidden');
      break;
  }
}

/**
 * Initialize the login page
 */
async function init() {
  showState('loading');

  try {
    await initAuth();
    const state = getAuthState();

    if (state.isAuthenticated) {
      if (state.isAuthorized) {
        // User is authenticated and authorized - redirect to intended destination
        window.location.href = redirectUrl;
      } else if (state.isUnauthorized) {
        // User is authenticated but not in app_users - show unauthorized message
        showState('unauthorized');
      } else {
        // Shouldn't happen, but show login form
        showState('login');
      }
    } else {
      // Not authenticated - show login form
      showState('login');
    }
  } catch (error) {
    console.error('Auth init error:', error);
    showState('error', error.message);
  }
}

// Event listeners
googleSignInBtn.addEventListener('click', async () => {
  showState('loading');

  try {
    // Redirect URL should include the original intended destination
    const loginRedirect = window.location.origin + '/login/?redirect=' + encodeURIComponent(redirectUrl);
    await signInWithGoogle(loginRedirect);
    // Note: signInWithGoogle redirects to Google, so this line won't execute
  } catch (error) {
    console.error('Sign in error:', error);
    showState('error', error.message);
  }
});

retryBtn.addEventListener('click', () => {
  showState('login');
});

// Sign out button (for unauthorized users to try another account)
const signOutBtn = document.getElementById('signOutBtn');
if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    showState('loading');
    try {
      await signOut();
      showState('login');
    } catch (error) {
      console.error('Sign out error:', error);
      showState('error', error.message);
    }
  });
}

// Initialize on page load
init();
