// Supabase client configuration with auth support
const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk';

// Wait for Supabase to be available (handles race condition with script loading)
function waitForSupabase(maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      if (window.supabase?.createClient) {
        resolve(window.supabase);
      } else if (attempts >= maxAttempts) {
        reject(new Error('Supabase library failed to load'));
      } else {
        attempts++;
        setTimeout(check, 100);
      }
    };
    check();
  });
}

/**
 * If the vendor bundle never loads, this module throws during evaluation and
 * every module that imports it (auth, resident-shell, the page script) is
 * skipped silently — the page sits on its loading spinner forever with no
 * message and no redirect. Replace the spinner with something a resident can
 * act on, so a missing <script src=".../supabase-js-*.min.js"> tag surfaces
 * immediately instead of looking like a hang.
 */
function reportSupabaseLoadFailure() {
  console.error(
    '[supabase] Vendor bundle not found on window.supabase — the page is missing ' +
    '<script src="/vendor/supabase-js-2.39.3.min.js"></script> before its module script, ' +
    'or that file failed to load.'
  );
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  overlay.innerHTML =
    '<div style="max-width:26rem;padding:1.5rem;text-align:center;font:400 0.95rem/1.55 system-ui,sans-serif;color:#4a423f;">' +
    "<p style=\"margin:0 0 0.75rem;font-weight:600;\">This page didn't finish loading.</p>" +
    '<p style="margin:0 0 0.75rem;">Please reload. If it keeps happening, text Jon at ' +
    '<a href="sms:+12396665815">(239) 666-5815</a>.</p>' +
    '<p style="margin:0;"><a href="/login/">Go to sign in</a></p>' +
    '</div>';
}

// Initialize Supabase client with auth configuration
let supabase;

// If supabase is already available, create client immediately
if (window.supabase?.createClient) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'genalpaca-auth',
      flowType: 'pkce',
    },
  });
} else {
  // Wait for it to load
  try {
    await waitForSupabase();
  } catch (err) {
    reportSupabaseLoadFailure();
    throw err;
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'genalpaca-auth',
      flowType: 'pkce',
    },
  });
}

/**
 * Lightweight connectivity probe (HEAD request to REST endpoint).
 * Returns true if Supabase is reachable, false otherwise.
 * Used by supabase-health.js for recovery detection.
 */
async function pingSupabase() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_config?select=id&limit=1`, {
      method: 'HEAD',
      headers: { 'apikey': SUPABASE_ANON_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

// Proactively refresh the session when the page returns from background.
// Mobile browsers suspend tabs when backgrounded — the auto-refresh timer
// doesn't fire, so the JWT can expire. This handler ensures the refresh
// token is exchanged for a new JWT as soon as the user comes back.
if (typeof document !== 'undefined') {
  let lastVisibleAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const elapsed = Date.now() - lastVisibleAt;
      // Only bother refreshing if backgrounded for > 5 minutes
      if (elapsed > 5 * 60 * 1000) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data?.session) {
            // No session — try an explicit refresh using the stored refresh token
            supabase.auth.refreshSession();
          }
        });
      }
      lastVisibleAt = Date.now();
    } else {
      lastVisibleAt = Date.now();
    }
  });
}

// Export for use in other modules
export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, pingSupabase };
