/**
 * Demo mode redaction: only applies when current user has role 'demo'.
 * Does not change behavior for any other role.
 */

import { getAuthState } from './auth.js';

const MASK_CHAR = '\u2587'; // ▇ block
const MASK_EVERY_NTH = 4;   // every 4th character

// Only these types are redacted in demo mode. Other data (emails, phones, etc.) stays as-is unless there is clear downside.
const FAKE = {
  name: 'Jane Doe',
  amount: '$1,234.56',
  password: '••••••',
  code: '••••••',
  generic: '••••••',
};

/**
 * @returns {boolean} True only if current user role is 'demo'. Other roles unchanged.
 */
export function isDemoUser() {
  const state = getAuthState();
  return state?.appUser?.role === 'demo';
}

/**
 * Redact for demo: names, $ amounts, passwords, codes only. Other types return original when not demo.
 * Plausible fake + mask every Nth character so it's obvious data is not real.
 * @param {string} value - Original value (or null/undefined)
 * @param {'name'|'amount'|'password'|'code'|'generic'} [type] - What to redact (names, $ amounts, passwords, codes)
 * @returns {string}
 */
export function redactString(value, type = 'generic') {
  if (!isDemoUser()) return value ?? '';
  const str = String(value ?? '').trim();
  if (!str) return FAKE[type] ?? FAKE.generic;
  const fake = FAKE[type] ?? FAKE.generic;
  const masked = [...fake].map((ch, i) => (i > 0 && (i + 1) % MASK_EVERY_NTH === 0 ? MASK_CHAR : ch)).join('');
  return masked;
}

/**
 * Mask every Nth character of a string (for demo). Returns original when not demo.
 * @param {string} value
 * @param {number} [everyNth]
 * @returns {string}
 */
export function maskString(value, everyNth = MASK_EVERY_NTH) {
  if (!isDemoUser()) return value ?? '';
  const str = String(value ?? '');
  if (!str) return str;
  return [...str].map((ch, i) => ((i + 1) % everyNth === 0 ? MASK_CHAR : ch)).join('');
}

/**
 * Redact common fields on an object for demo. Only runs when isDemoUser().
 * Schema types: 'name' | 'amount' | 'password' | 'code' | 'generic' (names, $ amounts, passwords, codes only).
 * @param {object} obj - Single object
 * @param {object} schema - Map of field name to type
 * @returns {object} New object with redacted values, or same reference when not demo
 */
export function redactObject(obj, schema) {
  if (!obj || !isDemoUser()) return obj;
  const out = { ...obj };
  for (const [key, type] of Object.entries(schema)) {
    if (key in out && out[key] != null) out[key] = redactString(out[key], type);
  }
  return out;
}

/**
 * Redact an array of objects for demo.
 * @param {object[]} list
 * @param {object} schema - Same as redactObject
 * @returns {object[]}
 */
export function redactList(list, schema) {
  if (!list || !isDemoUser()) return list ?? [];
  return (list || []).map(item => redactObject(item, schema));
}
