/**
 * Feature Registry — defines core vs optional platform modules.
 *
 * Core modules are always enabled. Optional modules can be toggled per-deployment
 * via the `features` JSONB column on the property_config or orgs table.
 *
 * Usage:
 *   import { isFeatureEnabled, FEATURES } from './feature-registry.js';
 *   if (await isFeatureEnabled('cameras')) { ... }
 */
import { getPropertyConfig } from './config-loader.js';

export const FEATURES = {
  // Core platform — always enabled, cannot be disabled
  spaces:     { label: 'Spaces',     core: true,  description: 'Space/unit management' },
  people:     { label: 'People',     core: true,  description: 'Tenant & guest records' },
  assignments:{ label: 'Assignments',core: true,  description: 'Booking & lease assignments' },
  media:      { label: 'Media',      core: true,  description: 'Photo & media library' },
  payments:   { label: 'Payments',   core: true,  description: 'Payment processing & ledger' },
  auth:       { label: 'Auth',       core: true,  description: 'User authentication & roles' },
  documents:  { label: 'Documents',  core: true,  description: 'Lease templates & e-signatures' },
  email:      { label: 'Email',      core: true,  description: 'Email notifications' },

  // Optional — property-specific or hardware-dependent
  lighting:   { label: 'Lighting',   core: false, description: 'Govee / smart light control' },
  cameras:    { label: 'Cameras',    core: false, description: 'Security camera feeds & PTZ' },
  music:      { label: 'Music',      core: false, description: 'Sonos / Music Assistant control' },
  climate:    { label: 'Climate',    core: false, description: 'Nest thermostat control' },
  vehicles:   { label: 'Vehicles',   core: false, description: 'Tesla Fleet API integration' },
  laundry:    { label: 'Laundry',    core: false, description: 'LG ThinQ washer/dryer monitoring' },
  oven:       { label: 'Oven',       core: false, description: 'Anova precision oven control' },
  printer_3d: { label: '3D Printer', core: false, description: 'FlashForge 3D printer control' },
  glowforge:  { label: 'Glowforge',  core: false, description: 'Glowforge laser cutter status' },
  pai:        { label: 'PAI',        core: false, description: 'AI assistant (chat, voice, email)' },
  sms:        { label: 'SMS',        core: false, description: 'Telnyx SMS notifications' },
  voice:      { label: 'Voice',      core: false, description: 'Vapi voice calling' },
  alexa:      { label: 'Alexa',      core: false, description: 'Alexa skill integration' },
  airbnb:     { label: 'Airbnb',     core: false, description: 'Airbnb iCal calendar sync' },
};

let _enabledCache = null;

/**
 * Returns the set of enabled features for this deployment.
 * Core features are always included. Optional features come from property_config.
 */
export async function getEnabledFeatures() {
  if (_enabledCache) return _enabledCache;

  const config = await getPropertyConfig();
  const overrides = config.features || {};

  const enabled = {};
  for (const [key, def] of Object.entries(FEATURES)) {
    if (def.core) {
      enabled[key] = true;
    } else {
      enabled[key] = overrides[key] !== undefined ? !!overrides[key] : true;
    }
  }

  _enabledCache = enabled;
  return enabled;
}

/**
 * Check if a specific feature is enabled.
 */
export async function isFeatureEnabled(featureKey) {
  const enabled = await getEnabledFeatures();
  return !!enabled[featureKey];
}

/**
 * Reset the cache (e.g. after config update).
 */
export function resetFeatureCache() {
  _enabledCache = null;
}
