/**
 * Blink Camera Snapshot Poller
 * Authenticates to Blink cloud API, periodically fetches camera thumbnails,
 * and uploads them to Supabase Storage for display on the cameras page.
 *
 * Deploy to: /opt/blink-poller/ on DO droplet
 * Systemd: blink-poller.service
 *
 * Environment variables:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for storage uploads
 *   BLINK_EMAIL               - Blink account email
 *   BLINK_PASSWORD            - Blink account password
 *   BLINK_UNIQUE_ID           - Persistent client UUID (avoids repeated 2FA)
 *   POLL_INTERVAL_MS          - Snapshot poll interval (default: 60000 = 60s)
 *
 * First-run 2FA:
 *   Run interactively: node worker.js --setup
 *   Enter the PIN sent to your email/phone when prompted.
 *   Credentials are saved to .blink-cred.json for future sessions.
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createInterface } from 'readline';

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BLINK_EMAIL = process.env.BLINK_EMAIL;
const BLINK_PASSWORD = process.env.BLINK_PASSWORD;
const BLINK_UNIQUE_ID = process.env.BLINK_UNIQUE_ID || 'AlpacAPPs_00000000-0000-0000-0000-000000000001';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000');
const CRED_FILE = '.blink-cred.json';
const STORAGE_BUCKET = 'housephotos';
const SNAPSHOT_PATH = 'cameras/blink-latest.jpg';

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}
if (!BLINK_EMAIL || !BLINK_PASSWORD) {
  console.error('BLINK_EMAIL and BLINK_PASSWORD environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// Logging
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

// ============================================
// Blink API Client
// ============================================
const BLINK_BASE = 'https://rest-prod.immedia-semi.com';
let blinkAuth = null;  // { token, accountId, clientId, tier, regionBase }
let blinkCameras = []; // [{ id, name, networkId, thumbnail }]

async function blinkRequest(url, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (blinkAuth?.token) {
    headers['TOKEN_AUTH'] = blinkAuth.token;
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  return resp;
}

async function blinkLogin() {
  log('INFO', 'Authenticating to Blink API...');

  // Try loading saved credentials first
  let savedCred = null;
  if (existsSync(CRED_FILE)) {
    try {
      savedCred = JSON.parse(await readFile(CRED_FILE, 'utf-8'));
      log('INFO', 'Loaded saved credentials');
    } catch { /* ignore */ }
  }

  const loginBody = {
    email: BLINK_EMAIL,
    password: BLINK_PASSWORD,
    unique_id: BLINK_UNIQUE_ID,
  };

  // If we have saved creds, try reauth
  if (savedCred?.token) {
    loginBody.reauth = 'true';
  }

  const resp = await blinkRequest(`${BLINK_BASE}/api/v5/account/login`, 'POST', loginBody);
  const data = await resp.json();

  if (data.message) {
    log('ERROR', `Login failed: ${data.message}`);
    throw new Error(data.message);
  }

  const accountId = data.account?.account_id;
  const clientId = data.account?.client_id;
  const tier = data.account?.tier;
  const token = data.auth?.token;
  const needsVerify = data.account?.client_verification_required;

  if (!token || !accountId) {
    log('ERROR', 'Missing token or account_id in login response');
    throw new Error('Invalid login response');
  }

  const regionBase = tier ? `https://rest-${tier}.immedia-semi.com` : BLINK_BASE;

  blinkAuth = { token, accountId, clientId, tier, regionBase };

  // Save credentials
  await writeFile(CRED_FILE, JSON.stringify({ token, accountId, clientId, tier }));

  if (needsVerify) {
    log('WARN', '2FA verification required! Run with --setup flag interactively.');
    if (process.argv.includes('--setup')) {
      await handle2FA(accountId, clientId);
    } else {
      throw new Error('Client verification required — run: node worker.js --setup');
    }
  }

  log('INFO', `Blink auth success. Account: ${accountId}, Tier: ${tier}`);
}

async function handle2FA(accountId, clientId) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const pin = await new Promise(resolve => {
    rl.question('Enter 2FA PIN from email/phone: ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const verifyResp = await blinkRequest(
    `${blinkAuth.regionBase}/api/v4/account/${accountId}/client/${clientId}/pin/verify`,
    'POST',
    { pin }
  );

  const verifyData = await verifyResp.json();
  if (verifyResp.ok && verifyData.valid) {
    log('INFO', '2FA verification successful!');
    // Re-save credentials
    await writeFile(CRED_FILE, JSON.stringify({
      token: blinkAuth.token,
      accountId,
      clientId,
      tier: blinkAuth.tier,
      verified: true,
    }));
  } else {
    log('ERROR', '2FA verification failed', verifyData);
    throw new Error('2FA verification failed');
  }
}

async function fetchHomescreen() {
  const resp = await blinkRequest(
    `${blinkAuth.regionBase}/api/v3/accounts/${blinkAuth.accountId}/homescreen`
  );

  if (resp.status === 401) {
    log('WARN', 'Token expired, re-authenticating...');
    await blinkLogin();
    return fetchHomescreen();
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Homescreen fetch failed: ${resp.status} ${text.substring(0, 200)}`);
  }

  return resp.json();
}

async function discoverCameras() {
  const homescreen = await fetchHomescreen();

  blinkCameras = [];

  // Parse cameras from homescreen
  const cameras = homescreen.cameras || [];
  for (const cam of cameras) {
    blinkCameras.push({
      id: cam.id,
      name: cam.name,
      networkId: cam.network_id,
      thumbnail: cam.thumbnail,
      status: cam.status,
    });
  }

  log('INFO', `Discovered ${blinkCameras.length} Blink camera(s)`, {
    cameras: blinkCameras.map(c => c.name),
  });
}

async function requestNewThumbnail(cam) {
  try {
    const resp = await blinkRequest(
      `${blinkAuth.regionBase}/network/${cam.networkId}/camera/${cam.id}/thumbnail`,
      'POST'
    );

    if (resp.ok) {
      log('INFO', `Requested new thumbnail for ${cam.name}`);
    } else {
      log('WARN', `Thumbnail request failed for ${cam.name}: ${resp.status}`);
    }
  } catch (err) {
    log('WARN', `Thumbnail request error for ${cam.name}: ${err.message}`);
  }
}

async function fetchThumbnailJpeg(cam) {
  // Thumbnail URL from homescreen is relative, needs auth
  if (!cam.thumbnail) {
    log('WARN', `No thumbnail URL for ${cam.name}`);
    return null;
  }

  // Thumbnail path may or may not start with /
  const thumbPath = cam.thumbnail.startsWith('/') ? cam.thumbnail : `/${cam.thumbnail}`;
  const thumbUrl = `${blinkAuth.regionBase}${thumbPath}.jpg`;

  const resp = await blinkRequest(thumbUrl);

  if (!resp.ok) {
    log('WARN', `Thumbnail fetch failed for ${cam.name}: ${resp.status}`);
    return null;
  }

  const buffer = await resp.arrayBuffer();
  return new Uint8Array(buffer);
}

// ============================================
// Supabase Storage Upload
// ============================================
async function uploadSnapshot(jpegData, filename = SNAPSHOT_PATH) {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, jpegData, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '30', // 30s cache
    });

  if (error) {
    log('ERROR', `Storage upload failed: ${error.message}`);
    return null;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filename);

  return urlData?.publicUrl;
}

// ============================================
// Update camera_streams with latest snapshot URL
// ============================================
async function updateSnapshotTimestamp() {
  // Update the camera_streams row to trigger UI refresh
  const { error } = await supabase
    .from('camera_streams')
    .update({ updated_at: new Date().toISOString() })
    .eq('camera_model', 'Blink');

  if (error) {
    log('WARN', `Failed to update camera_streams timestamp: ${error.message}`);
  }
}

// ============================================
// API Usage Logging
// ============================================
async function logApiUsage(endpoint, category = 'blink_snapshot_poll') {
  try {
    await supabase.from('api_usage_log').insert({
      vendor: 'blink',
      category,
      endpoint,
      units: 1,
      unit_type: 'api_calls',
      estimated_cost_usd: 0, // Free (no paid API)
      metadata: { cameras: blinkCameras.map(c => c.name) },
    });
  } catch { /* non-critical */ }
}

// ============================================
// Poll Loop
// ============================================
async function pollOnce() {
  try {
    // Refresh homescreen to get latest thumbnails
    await discoverCameras();
    await logApiUsage('homescreen');

    if (!blinkCameras.length) {
      log('WARN', 'No Blink cameras found');
      return;
    }

    // Fetch and upload thumbnail for each camera
    for (const cam of blinkCameras) {
      const jpeg = await fetchThumbnailJpeg(cam);
      if (jpeg) {
        // Use camera name in path for multi-camera support
        const safeName = cam.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const path = `cameras/blink-${safeName}-latest.jpg`;
        const url = await uploadSnapshot(jpeg, path);
        if (url) {
          log('INFO', `Uploaded snapshot for ${cam.name}`, { url: url.substring(0, 80) });
        }

        // Also upload as the "latest" for the first/primary camera
        if (cam === blinkCameras[0]) {
          await uploadSnapshot(jpeg, SNAPSHOT_PATH);
        }
      }
    }

    await updateSnapshotTimestamp();

    // Periodically request new thumbnails (every 5th poll = every ~5 min)
    if (Math.random() < 0.2) {
      for (const cam of blinkCameras) {
        await requestNewThumbnail(cam);
        await logApiUsage('thumbnail_request', 'blink_snapshot_request');
      }
    }
  } catch (err) {
    log('ERROR', `Poll error: ${err.message}`);
    // Re-auth on next cycle if token expired
    if (err.message.includes('401') || err.message.includes('Token expired')) {
      blinkAuth = null;
    }
  }
}

async function startPolling() {
  log('INFO', `Blink Poller starting. Poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Initial auth
  await blinkLogin();
  await discoverCameras();

  // First poll immediately
  await pollOnce();

  // Then poll on interval
  setInterval(pollOnce, POLL_INTERVAL_MS);
  log('INFO', 'Polling loop started');
}

// ============================================
// Main
// ============================================
if (process.argv.includes('--setup')) {
  log('INFO', '=== Blink 2FA Setup Mode ===');
  try {
    await blinkLogin();
    await discoverCameras();
    log('INFO', 'Setup complete! Credentials saved. You can now run without --setup.');
  } catch (err) {
    log('ERROR', `Setup failed: ${err.message}`);
    process.exit(1);
  }
} else {
  startPolling().catch(err => {
    log('ERROR', `Fatal: ${err.message}`);
    process.exit(1);
  });
}
