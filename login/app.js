// Login page application
import { supabase } from '../shared/supabase.js';
import { initAuth, signInWithGoogle, signOut, getAuthState } from '../shared/auth.js';

const CACHED_AUTH_KEY = 'genalpaca-cached-auth';

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

console.log('[LOGIN]', 'Page loaded', { redirectUrl, href: window.location.href });

/**
 * Show a specific UI state
 */
function showState(state, message = '') {
  console.log('[LOGIN]', `showState(${state})`, message || '');
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
  // Fast path: check cached auth first for instant redirect
  try {
    const raw = localStorage.getItem(CACHED_AUTH_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      const age = Date.now() - (cached.timestamp || 0);
      if (age < 30 * 24 * 60 * 60 * 1000 && (cached.role === 'admin' || cached.role === 'staff')) {
        console.log('[LOGIN]', 'Cached auth found, redirecting immediately', { email: cached.email, role: cached.role });
        window.location.href = redirectUrl;
        return;
      }
    }
  } catch (e) {
    // ignore cache errors
  }

  showState('loading');

  try {
    // Check if we already have a Supabase session
    console.log('[LOGIN]', 'Checking for existing Supabase session...');
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      console.log('[LOGIN]', 'Active session found, redirecting', { email: session.user.email });
      window.location.href = redirectUrl;
      return;
    }

    // No existing session, wait for auth init (handles OAuth callback)
    console.log('[LOGIN]', 'No session, running initAuth() (handles OAuth callback)...');
    await initAuth();
    checkAuthAndRedirect();
  } catch (error) {
    console.error('[LOGIN]', 'Auth init error:', error);
    showState('error', error.message);
  }
}

function checkAuthAndRedirect() {
  const state = getAuthState();
  console.log('[LOGIN]', 'checkAuthAndRedirect()', {
    isAuthenticated: state.isAuthenticated,
    isAuthorized: state.isAuthorized,
    isUnauthorized: state.isUnauthorized,
    role: state.role,
    email: state.user?.email,
  });

  if (state.isAuthenticated) {
    if (state.isAuthorized) {
      console.log('[LOGIN]', 'Authorized — redirecting to:', redirectUrl);
      window.location.href = redirectUrl;
    } else if (state.isUnauthorized) {
      console.log('[LOGIN]', 'Authenticated but unauthorized');
      showState('unauthorized');
    } else {
      console.log('[LOGIN]', 'Unexpected auth state, showing login');
      showState('login');
    }
  } else {
    console.log('[LOGIN]', 'Not authenticated, showing login form');
    showState('login');
  }
}

// Event listeners
googleSignInBtn.addEventListener('click', async () => {
  console.log('[LOGIN]', 'Google sign-in button clicked');
  showState('loading');

  try {
    // Redirect URL should include the original intended destination
    const loginRedirect = window.location.origin + '/login/?redirect=' + encodeURIComponent(redirectUrl);
    console.log('[LOGIN]', 'Calling signInWithGoogle()', { loginRedirect });
    await signInWithGoogle(loginRedirect);
    // Note: signInWithGoogle redirects to Google, so this line won't execute
  } catch (error) {
    console.error('[LOGIN]', 'Sign in error:', error);
    showState('error', error.message);
  }
});

retryBtn.addEventListener('click', () => {
  console.log('[LOGIN]', 'Retry clicked');
  showState('login');
});

// Sign out button (for unauthorized users to try another account)
const signOutBtn = document.getElementById('signOutBtn');
if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    console.log('[LOGIN]', 'Sign out clicked');
    showState('loading');
    try {
      await signOut();
      showState('login');
    } catch (error) {
      console.error('[LOGIN]', 'Sign out error:', error);
      showState('error', error.message);
    }
  });
}

// Initialize on page load
init();
