#!/usr/bin/env node
/**
 * Create a scoped API key row in `api_keys` and print the plaintext key once.
 *
 * The `api` edge function (supabase/functions/api/index.ts) authenticates
 * X-API-Key callers by looking up the sha256 hash of the header value in
 * `api_keys`. Only the hash is ever stored -- this script is the only place
 * the plaintext key exists, so save it (e.g. Bitwarden) immediately.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-api-key.js \
 *     --name "Meta Muse Vehicle Registration Agent" \
 *     --level 2 \
 *     --resources vehicles \
 *     --actions list,get,update
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const name = arg('name');
const level = parseInt(arg('level', '1'), 10);
const resources = (arg('resources', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const actions = (arg('actions', 'list,get') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!name) {
  console.error('Error: --name is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const secret = crypto.randomBytes(24).toString('base64url'); // ~32 chars, URL-safe
  const prefix = 'amk_'; // AlpacApps Meta-muse Key
  const plaintextKey = `${prefix}${secret}`;
  const keyHash = crypto.createHash('sha256').update(plaintextKey).digest('hex');
  const keyPrefix = plaintextKey.slice(0, 12); // for display in admin UI, e.g. "amk_AbCdEfGh"

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      permission_level: level,
      allowed_resources: resources.length ? resources : null,
      allowed_actions: actions,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Insert failed:', error.message);
    process.exit(1);
  }

  console.log('Created API key row:', data.id);
  console.log('');
  console.log('PLAINTEXT KEY (shown once -- save it now, it is not recoverable):');
  console.log('');
  console.log(`  ${plaintextKey}`);
  console.log('');
  console.log('Usage:');
  console.log('  curl -X POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/api \\');
  console.log(`    -H "X-API-Key: ${plaintextKey}" \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"resource":"vehicles","action":"update","id":"<vehicle-uuid-or-id>","data":{"registration_state":"TX","registration_expiry":"2027-03-01"}}\'');
}

main();
