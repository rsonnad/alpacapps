// Authentication module for Google SSO with role-based access control
import { supabase } from './supabase.js';

// Timeout configuration
const AUTH_TIMEOUT_MS = 10000; // 10 seconds for auth operations

/**
 * Wrap a promise with a timeout to prevent indefinite hangs
 */
function withTimeout(promise, ms = AUTH_TIMEOUT_MS, errorMessage = 'Auth operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    )
  ]);
}

// Auth state
let currentUser = null;
let currentAppUser = null;
let currentRole = 'public';
let authStateListeners = [];

/**
 * Initialize authentication and check for existing session
 * @returns {Promise<{user: object|null, role: string}>}
 */
export async function initAuth() {
  // Check for existing session (with timeout to prevent hangs)
  let session = null;
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      AUTH_TIMEOUT_MS,
      'Session check timed out'
    );
    if (error) {
      console.error('Error getting session:', error);
    }
    session = data?.session;
  } catch (timeoutError) {
    console.warn('Auth session check timed out, continuing without session:', timeoutError.message);
  }

  if (session) {
    await handleAuthChange(session);
  }

  // Listen for auth changes (login, logout, token refresh)
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state changed:', event);

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      await handleAuthChange(session);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentAppUser = null;
      currentRole = 'public';
      notifyListeners();
    }
  });

  return { user: currentUser, role: currentRole };
}

/**
 * Handle auth state changes - fetch user role from app_users
 */
async function handleAuthChange(session) {
  if (!session?.user) {
    currentUser = null;
    currentAppUser = null;
    currentRole = 'public';
    notifyListeners();
    return;
  }

  currentUser = session.user;

  // Fetch user record from app_users table (with timeout)
  let appUser = null;
  let fetchError = null;
  try {
    const result = await withTimeout(
      supabase
        .from('app_users')
        .select('id, role, display_name, email')
        .eq('auth_user_id', session.user.id)
        .single(),
      AUTH_TIMEOUT_MS,
      'Fetching user record timed out'
    );
    appUser = result.data;
    fetchError = result.error;
  } catch (timeoutError) {
    console.warn('User record fetch timed out:', timeoutError.message);
    fetchError = timeoutError;
  }

  if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error('Error fetching app_user:', fetchError);
  }

  if (appUser) {
    currentAppUser = appUser;
    currentRole = appUser.role;
    currentUser.displayName = appUser.display_name || currentUser.user_metadata?.full_name || currentUser.email;

    // Update last login timestamp (fire and forget with timeout - don't block auth)
    withTimeout(
      supabase
        .from('app_users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('auth_user_id', session.user.id),
      5000,
      'Last login update timed out'
    ).catch(err => console.warn('Failed to update last login:', err.message));
  } else {
    // User not in app_users - check for pending invitation (with timeout)
    const userEmail = session.user.email?.toLowerCase();
    let invitation = null;
    let invError = null;

    try {
      const result = await withTimeout(
        supabase
          .from('user_invitations')
          .select('*')
          .eq('email', userEmail)
          .eq('status', 'pending')
          .single(),
        AUTH_TIMEOUT_MS,
        'Invitation check timed out'
      );
      invitation = result.data;
      invError = result.error;
    } catch (timeoutError) {
      console.warn('Invitation check timed out:', timeoutError.message);
      invError = timeoutError;
    }

    if (invitation && !invError) {
      // Found a pending invitation - automatically create app_users record
      const displayName = session.user.user_metadata?.full_name || userEmail.split('@')[0];

      let newAppUser = null;
      let createError = null;
      try {
        const result = await withTimeout(
          supabase
            .from('app_users')
            .insert({
              auth_user_id: session.user.id,
              email: userEmail,
              display_name: displayName,
              role: invitation.role,
              invited_by: invitation.invited_by,
            })
            .select()
            .single(),
          AUTH_TIMEOUT_MS,
          'User creation timed out'
        );
        newAppUser = result.data;
        createError = result.error;
      } catch (timeoutError) {
        console.warn('User creation timed out:', timeoutError.message);
        createError = timeoutError;
      }

      if (!createError && newAppUser) {
        // Mark invitation as accepted (fire and forget - don't block auth)
        withTimeout(
          supabase
            .from('user_invitations')
            .update({ status: 'accepted' })
            .eq('id', invitation.id),
          5000,
          'Invitation update timed out'
        ).catch(err => console.warn('Failed to mark invitation accepted:', err.message));

        currentAppUser = newAppUser;
        currentRole = newAppUser.role;
        currentUser.displayName = displayName;
      } else {
        console.error('Error creating app_user from invitation:', createError);
        currentAppUser = null;
        currentRole = 'unauthorized';
        currentUser.displayName = session.user.user_metadata?.full_name || session.user.email;
      }
    } else {
      // No invitation - unauthorized
      currentAppUser = null;
      currentRole = 'unauthorized';
      currentUser.displayName = session.user.user_metadata?.full_name || session.user.email;
    }
  }

  notifyListeners();
}

/**
 * Sign in with Google OAuth
 * @param {string} redirectTo - URL to redirect to after sign in
 */
export async function signInWithGoogle(redirectTo) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo || window.location.origin + '/spaces/admin/',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    console.error('Sign in error:', error);
    throw error;
  }

  return data;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Sign out error:', error);
    throw error;
  }

  currentUser = null;
  currentAppUser = null;
  currentRole = 'public';
  notifyListeners();
}

/**
 * Get the current authentication state
 * @returns {{user: object|null, appUser: object|null, role: string, isAuthenticated: boolean, isAdmin: boolean, isStaff: boolean, isAuthorized: boolean}}
 */
export function getAuthState() {
  return {
    user: currentUser,
    appUser: currentAppUser,
    role: currentRole,
    isAuthenticated: currentUser !== null,
    isAdmin: currentRole === 'admin',
    isStaff: currentRole === 'staff' || currentRole === 'admin',
    isAuthorized: currentRole === 'admin' || currentRole === 'staff',
    isUnauthorized: currentRole === 'unauthorized',
  };
}

/**
 * Subscribe to auth state changes
 * @param {function} callback - Called with auth state on changes
 * @returns {function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  authStateListeners.push(callback);

  // Return unsubscribe function
  return () => {
    authStateListeners = authStateListeners.filter(cb => cb !== callback);
  };
}

/**
 * Notify all listeners of auth state change
 */
function notifyListeners() {
  const state = getAuthState();
  authStateListeners.forEach(cb => cb(state));
}

/**
 * Guard: Require authentication, redirect to login if not authenticated
 * @param {string} redirectUrl - URL to redirect to if not authenticated
 * @returns {boolean} True if authenticated
 */
export function requireAuth(redirectUrl = '/login/') {
  const state = getAuthState();

  if (!state.isAuthenticated) {
    const currentPath = window.location.pathname;
    window.location.href = redirectUrl + '?redirect=' + encodeURIComponent(currentPath);
    return false;
  }

  return true;
}

/**
 * Guard: Require a specific role, redirect if insufficient permissions
 * @param {string} role - Required role ('admin' or 'staff')
 * @param {string} redirectUrl - URL to redirect to if unauthorized
 * @returns {boolean} True if user has required role
 */
export function requireRole(role, redirectUrl = '/spaces/') {
  const state = getAuthState();

  if (!state.isAuthenticated) {
    const currentPath = window.location.pathname;
    window.location.href = '/login/?redirect=' + encodeURIComponent(currentPath);
    return false;
  }

  if (state.isUnauthorized) {
    // User logged in but not in app_users - show unauthorized message
    return false;
  }

  if (role === 'admin' && !state.isAdmin) {
    alert('Admin access required');
    window.location.href = redirectUrl;
    return false;
  }

  if (role === 'staff' && !state.isStaff) {
    alert('Staff access required');
    window.location.href = redirectUrl;
    return false;
  }

  return true;
}

/**
 * Check if user can perform admin actions (for conditional UI)
 * @returns {boolean}
 */
export function canEdit() {
  return getAuthState().isAdmin;
}

/**
 * Check if user can view all data including unlisted/secret
 * @returns {boolean}
 */
export function canViewAll() {
  return getAuthState().isStaff;
}
