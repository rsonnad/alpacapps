/**
 * Property configuration loader.
 * Fetches operational identity from `property_config` table.
 * Same caching pattern as brand-config.js — 5-min TTL with hardcoded fallback.
 */
import { getSupabase } from './supabase.js';

let cachedConfig = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

const FALLBACK_CONFIG = {
  property: {
    name: 'Alpaca Playhouse',
    short_name: 'AlpacApps',
    tagline: 'We put the AI into Alpacas',
    address: '160 Still Forest Dr, Cedar Creek, TX 78612',
    city: 'Cedar Creek',
    state: 'TX',
    zip: '78612',
    country: 'US',
    latitude: 30.13,
    longitude: -97.46,
    timezone: 'America/Chicago',
  },
  domain: {
    primary: 'alpacaplayhouse.com',
    github_pages: 'rsonnad.github.io/alpacapps',
    camera_proxy: 'cam.alpacaplayhouse.com',
  },
  email: {
    team: 'team@alpacaplayhouse.com',
    admin_gmail: 'alpacaplayhouse@gmail.com',
    notifications_from: 'notifications@alpacaplayhouse.com',
    noreply_from: 'noreply@alpacaplayhouse.com',
    automation: 'alpacaautomatic@gmail.com',
  },
  payment: {
    zelle_email: 'alpacaplayhouse@gmail.com',
    venmo_handle: '@AlpacaPlayhouse',
  },
  ai_assistant: {
    name: 'PAI',
    full_name: 'Prompt Alpaca Intelligence',
    personality: 'the AI assistant for the property',
    email_from: 'pai@alpacaplayhouse.com',
  },
  wifi: {
    network_name: 'Black Rock City',
  },
  mobile_app: {
    name: 'Alpaca Playhouse',
    id: 'com.alpacaplayhouse.app',
  },
};

export async function getPropertyConfig() {
  const now = Date.now();
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('property_config')
      .select('config')
      .eq('id', 1)
      .single();

    if (error || !data?.config) {
      console.warn('property_config fetch failed, using fallback:', error?.message);
      cachedConfig = FALLBACK_CONFIG;
    } else {
      cachedConfig = { ...FALLBACK_CONFIG, ...data.config };
    }
  } catch (e) {
    console.warn('property_config fetch error, using fallback:', e.message);
    cachedConfig = FALLBACK_CONFIG;
  }
  cacheTimestamp = Date.now();
  return cachedConfig;
}

/** Shorthand accessors for common config paths */
export async function getPropertyName() {
  return (await getPropertyConfig()).property?.name ?? FALLBACK_CONFIG.property.name;
}

export async function getDomain() {
  return (await getPropertyConfig()).domain?.primary ?? FALLBACK_CONFIG.domain.primary;
}

export async function getTimezone() {
  return (await getPropertyConfig()).property?.timezone ?? FALLBACK_CONFIG.property.timezone;
}
