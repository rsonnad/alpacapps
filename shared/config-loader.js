/**
 * Property configuration loader.
 * Fetches operational identity from `property_config` table.
 * Same caching pattern as brand-config.js — 5-min TTL with hardcoded fallback.
 */
import { supabase } from './supabase.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Hardcoded fallback config (used when DB is unreachable)
const FALLBACK_CONFIG = {
  property_name: 'Alpaca Playhouse Austin',
  domain: 'alpacaplayhouse.com',
  timezone: 'America/Chicago',
};

let cachedConfig = null;
let cacheTimestamp = 0;
let fetchPromise = null;

/**
 * Fetch property config from DB with caching.
 * Returns cached value if within TTL, otherwise fetches fresh.
 */
export async function getPropertyConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  // Deduplicate concurrent fetches
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('property_config')
        .select('*')
        .single();

      if (error) {
        console.warn('[config-loader] Failed to fetch property config, using fallback:', error.message);
        cachedConfig = FALLBACK_CONFIG;
      } else {
        cachedConfig = data || FALLBACK_CONFIG;
      }
      cacheTimestamp = Date.now();
      return cachedConfig;
    } catch (err) {
      console.warn('[config-loader] Error fetching property config, using fallback:', err.message);
      cachedConfig = FALLBACK_CONFIG;
      cacheTimestamp = Date.now();
      return cachedConfig;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/** Shorthand accessors for common config paths */
export async function getPropertyName() {
  const config = await getPropertyConfig();
  return config.property_name || FALLBACK_CONFIG.property_name;
}

export async function getDomain() {
  const config = await getPropertyConfig();
  return config.domain || FALLBACK_CONFIG.domain;
}

export async function getTimezone() {
  const config = await getPropertyConfig();
  return config.timezone || FALLBACK_CONFIG.timezone;
}
