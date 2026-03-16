/**
 * Feature registry — declarative feature flag system.
 * Core features are always enabled; optional features can be toggled
 * per deployment via property_config `features` JSONB column.
 */
import { getPropertyConfig } from './config-loader.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedFeatures = null;
let cacheTimestamp = 0;

/**
 * Master feature catalog.
 * Each feature has: label, core (always on), description.
 * Optional features (core: false) can be toggled per deployment.
 */
export const FEATURES = {
  // Cannot be disabled
  spaces:        { label: 'Spaces',            core: true,  description: 'Space/room management' },
  people:        { label: 'People',            core: true,  description: 'People directory' },
  assignments:   { label: 'Assignments',       core: true,  description: 'Space assignments' },
  media:         { label: 'Media',             core: true,  description: 'Photo & media management' },
  auth:          { label: 'Authentication',    core: true,  description: 'User authentication & roles' },

  // Optional — toggled per deployment via property_config features JSONB
  // Communication
  email:         { label: 'Email',             core: false, description: 'Email notifications' },
  sms:           { label: 'SMS',               core: false, description: 'SMS messaging' },
  whatsapp:      { label: 'WhatsApp',          core: false, description: 'WhatsApp messaging' },
  voice:         { label: 'Voice',             core: false, description: 'Voice calls' },

  // Payments
  payments_stripe:  { label: 'Stripe',         core: false, description: 'Stripe payments' },
  payments_square:  { label: 'Square',         core: false, description: 'Square payments' },
  payments_paypal:  { label: 'PayPal',         core: false, description: 'PayPal payments' },

  // Documents
  esignatures:   { label: 'E-Signatures',     core: false, description: 'Electronic signatures' },
  documents:     { label: 'Documents',         core: false, description: 'Document management' },

  // Smart home
  lighting:      { label: 'Lighting',          core: false, description: 'Smart lighting control' },
  cameras:       { label: 'Cameras',           core: false, description: 'Security cameras' },
  music:         { label: 'Music',             core: false, description: 'Music / Sonos control' },
  climate:       { label: 'Climate',           core: false, description: 'Climate / thermostat control' },
  laundry:       { label: 'Laundry',           core: false, description: 'Laundry machines' },
  oven:          { label: 'Oven',              core: false, description: 'Smart oven control' },

  // Maker tools
  printer_3d:    { label: '3D Printer',        core: false, description: '3D printer management' },
  glowforge:     { label: 'Glowforge',         core: false, description: 'Glowforge laser cutter' },

  // Vehicles
  vehicles:      { label: 'Vehicles',          core: false, description: 'Vehicle management' },

  // Property operations
  rentals:       { label: 'Rentals',           core: false, description: 'Rental pipeline' },
  events:        { label: 'Events',            core: false, description: 'Event hosting' },
  associates:    { label: 'Associates',        core: false, description: 'Associate management' },
  residents:     { label: 'Residents',         core: false, description: 'Resident portal' },
  airbnb:        { label: 'Airbnb',            core: false, description: 'Airbnb sync' },

  // AI
  pai:           { label: 'PAI',               core: false, description: 'Prompt Alpaca Intelligence' },
  alexa:         { label: 'Alexa',             core: false, description: 'Alexa integration' },
};

/**
 * Get the set of enabled feature keys for this deployment.
 * Core features are always included; optional features come from property_config.
 */
export async function getEnabledFeatures() {
  const now = Date.now();
  if (cachedFeatures && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedFeatures;
  }

  // Start with core features (always enabled)
  const enabled = new Set(
    Object.entries(FEATURES).filter(([, v]) => v.core).map(([k]) => k)
  );

  try {
    const config = await getPropertyConfig();
    const configFeatures = config?.features || {};
    // Add optional features that are enabled in config
    for (const [key, value] of Object.entries(configFeatures)) {
      if (value === true && FEATURES[key]) {
        enabled.add(key);
      }
    }
  } catch (err) {
    console.warn('[feature-registry] Failed to load config, using core features only:', err.message);
  }

  cachedFeatures = enabled;
  cacheTimestamp = Date.now();
  return enabled;
}

/**
 * Check if a specific feature is enabled.
 */
export async function isFeatureEnabled(featureKey) {
  const enabled = await getEnabledFeatures();
  return enabled.has(featureKey);
}

/**
 * Reset the feature cache (e.g. after config changes).
 */
export function resetFeatureCache() {
  cachedFeatures = null;
  cacheTimestamp = 0;
}
