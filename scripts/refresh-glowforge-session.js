#!/usr/bin/env node
/*
 * Refresh the cached Glowforge session from a trusted local machine.
 *
 * Why this exists:
 * Glowforge accepts sessions created from this Mac, but currently rejects
 * sessions created directly inside Supabase Edge with "User not found".
 * This script logs in locally, verifies the machines API, then stores only the
 * resulting session cookies in glowforge_config for glowforge-control to use.
 *
 * Requirements:
 * - Bitwarden CLI unlocked (`bw unlock` / BW_SESSION)
 * - psql installed (`/opt/homebrew/opt/libpq/bin/psql` or `psql` on PATH)
 */

const { spawnSync } = require('node:child_process');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_GLOWFORGE_ITEM = 'Glowforge — Laser Cutter API';
const DEFAULT_SUPABASE_ITEM = 'Supabase — AlpacApps Project';
const DEFAULT_PSQL = '/opt/homebrew/opt/libpq/bin/psql';

function usage() {
  console.log(`Usage: node scripts/refresh-glowforge-session.js [--dry-run]

Logs into Glowforge locally, verifies the machines endpoint, and updates
glowforge_config.session_cookies in Supabase.

Environment overrides:
  GLOWFORGE_BW_ITEM       Bitwarden item name or id (default: ${DEFAULT_GLOWFORGE_ITEM})
  SUPABASE_BW_ITEM        Bitwarden item name or id (default: ${DEFAULT_SUPABASE_ITEM})
  PSQL_BIN                psql binary path (default: ${DEFAULT_PSQL}, fallback: psql)
`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function bwGetItem(itemNameOrId) {
  try {
    return JSON.parse(run('bw', ['get', 'item', itemNameOrId]));
  } catch (err) {
    if (String(err.message || '').includes('More than one result')) {
      const items = JSON.parse(run('bw', ['list', 'items', '--search', itemNameOrId]));
      const withEmailPassword = items.find((item) =>
        Array.isArray(item.fields) &&
        item.fields.some((f) => f.name === 'Email') &&
        item.fields.some((f) => f.name === 'Password')
      );
      if (withEmailPassword) return withEmailPassword;
    }
    throw err;
  }
}

function field(item, name) {
  const match = item.fields?.find((f) => f.name === name);
  return match?.value || '';
}

function requireValue(value, label) {
  if (!value) throw new Error(`Missing required value: ${label}`);
  return value;
}

function collectCookies(resp, cookies) {
  const headers = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  for (const header of headers) {
    const cookie = header.split(';')[0];
    if (cookie.includes('=')) cookies.push(cookie);
  }
}

function dedupeCookies(cookies) {
  const map = new Map();
  for (const cookie of cookies) {
    const eq = cookie.indexOf('=');
    if (eq > 0) map.set(cookie.slice(0, eq), cookie);
  }
  return [...map.values()].join('; ');
}

function cookieNames(cookieString) {
  return cookieString
    .split(';')
    .map((cookie) => cookie.trim().split('=')[0])
    .filter(Boolean);
}

async function glowforgeLogin(email, password) {
  const signInResp = await fetch('https://accounts.glowforge.com/users/sign_in', {
    headers: { 'User-Agent': BROWSER_UA },
    redirect: 'follow',
  });
  const signInHtml = await signInResp.text();
  const csrfToken = signInHtml.match(/name="authenticity_token"\s+value="([^"]+)"/)?.[1];
  if (!csrfToken) throw new Error('Could not extract Glowforge CSRF token');

  const cookies = [];
  collectCookies(signInResp, cookies);

  const body = new URLSearchParams({
    authenticity_token: csrfToken,
    'user[email]': email,
    'user[password]': password,
    'user[remember_me]': '1',
    commit: 'Sign in',
  });

  const loginResp = await fetch('https://accounts.glowforge.com/users/sign_in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': BROWSER_UA,
      Cookie: cookies.join('; '),
    },
    body: body.toString(),
    redirect: 'manual',
  });
  collectCookies(loginResp, cookies);

  let location = loginResp.headers.get('location');
  if (!location || loginResp.status < 300 || loginResp.status >= 400) {
    throw new Error(`Glowforge login did not redirect after sign-in: ${loginResp.status}`);
  }

  for (let hops = 0; location && hops < 5; hops++) {
    const redirectUrl = new URL(location, 'https://accounts.glowforge.com').toString();
    const redirectResp = await fetch(redirectUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Cookie: dedupeCookies(cookies),
      },
      redirect: 'manual',
    });
    collectCookies(redirectResp, cookies);
    location = redirectResp.headers.get('location');
  }

  return dedupeCookies(cookies);
}

async function fetchMachines(cookies) {
  const resp = await fetch('https://api.glowforge.com/gfcore/users/machines', {
    headers: {
      'User-Agent': BROWSER_UA,
      Cookie: cookies,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://app.glowforge.com',
      Referer: 'https://app.glowforge.com/',
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Glowforge machines API returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.machines)) return data.machines;
  if (Array.isArray(data.data)) return data.data;
  return data.id || data.serial || data.name ? [data] : [];
}

function updateSupabaseSession(supabaseItem, cookies) {
  const host = requireValue(field(supabaseItem, 'Host'), 'Supabase Host');
  const port = requireValue(field(supabaseItem, 'Port'), 'Supabase Port');
  const database = requireValue(field(supabaseItem, 'Database'), 'Supabase Database');
  const user = requireValue(field(supabaseItem, 'User'), 'Supabase User');
  const password = requireValue(field(supabaseItem, 'psql Password'), 'Supabase psql Password');
  const psqlBin = process.env.PSQL_BIN || DEFAULT_PSQL;

  const sql = `
update public.glowforge_config
set session_cookies = :'cookies',
    session_expires_at = now() + interval '7 days',
    last_error = null,
    updated_at = now()
where id = 1;
`;

  const args = [
    '-h', host,
    '-p', port,
    '-U', user,
    '-d', database,
    '-v', 'ON_ERROR_STOP=1',
    '-v', `cookies=${cookies}`,
  ];

  try {
    run(psqlBin, args, { input: sql, env: { ...process.env, PGPASSWORD: password } });
  } catch (err) {
    if (psqlBin === DEFAULT_PSQL) {
      run('psql', args, { input: sql, env: { ...process.env, PGPASSWORD: password } });
      return;
    }
    throw err;
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const dryRun = process.argv.includes('--dry-run');
  const glowforgeItem = bwGetItem(process.env.GLOWFORGE_BW_ITEM || DEFAULT_GLOWFORGE_ITEM);
  const supabaseItem = bwGetItem(process.env.SUPABASE_BW_ITEM || DEFAULT_SUPABASE_ITEM);

  const email = requireValue(field(glowforgeItem, 'Email') || glowforgeItem.login?.username, 'Glowforge Email');
  const password = requireValue(field(glowforgeItem, 'Password') || glowforgeItem.login?.password, 'Glowforge Password');

  const cookies = await glowforgeLogin(email, password);
  const machines = await fetchMachines(cookies);

  console.log(`Glowforge login ok. Cookies: ${cookieNames(cookies).join(', ')}`);
  console.log(`Glowforge machines found: ${machines.length}`);
  for (const machine of machines) {
    console.log(`- ${machine.name || 'Glowforge'} ${machine.serial || machine.id || ''} ${machine.type || machine.model || ''}`.trim());
  }

  if (dryRun) {
    console.log('Dry run only; glowforge_config was not updated.');
    return;
  }

  updateSupabaseSession(supabaseItem, cookies);
  console.log('Updated glowforge_config.session_cookies and session_expires_at.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
