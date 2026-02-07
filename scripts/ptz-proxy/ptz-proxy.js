#!/usr/bin/env node
/**
 * Camera Control Proxy — HTTP server proxying PTZ + camera controls to UniFi Protect API
 * Runs on DO droplet, accessed via Caddy reverse proxy at cam.alpacaplayhouse.com
 *
 * Routes:
 *   POST /ptz/{cameraId}              — body: { action: "move", x, y, z } or { action: "goto", slot }
 *   GET  /camera/{cameraId}/snapshot   — returns JPEG snapshot
 *   GET  /camera/{cameraId}/settings   — returns filtered camera settings JSON
 *   PATCH /camera/{cameraId}/settings  — update whitelisted camera settings
 *
 * Auth to UniFi Protect:
 *   Cookie-based with CSRF token from JWT. Caches session for reuse.
 *
 * Deploy to: /opt/ptz-proxy/ on DO droplet
 * Systemd: ptz-proxy.service
 */

const http = require('http');
const https = require('https');

const PORT = process.env.PTZ_PORT || 8901;
const UDM_HOST = process.env.UDM_HOST || '192.168.1.1';
const UDM_USER = process.env.UDM_USER || 'alpacaauto';
const UDM_PASS = process.env.UDM_PASS || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://rsonnad.github.io,https://alpacaplayhouse.com,https://www.alpacaplayhouse.com').split(',');

// Cached auth state
let sessionCookie = null;
let csrfToken = null;
let authExpiry = 0; // timestamp when auth expires

// Snapshot rate limiting: 1 per second per camera
const snapshotTimestamps = {};

// Settings PATCH whitelist
const SETTINGS_WHITELIST = ['irLedMode', 'statusLightEnabled', 'hdrModeEnabled', 'micVolume'];

// =============================================
// HTTPS helpers (ignores self-signed cert)
// =============================================
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    options.agent = agent;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, setCookie: res.headers['set-cookie'] }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsRequestBinary(options) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    options.agent = agent;

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// =============================================
// UniFi Protect Authentication
// =============================================
async function authenticate() {
  console.log('[Auth] Authenticating to UniFi Protect...');

  const authBody = JSON.stringify({ username: UDM_USER, password: UDM_PASS });

  const res = await httpsRequest({
    hostname: UDM_HOST,
    port: 443,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(authBody),
    },
  }, authBody);

  if (res.status !== 200) {
    throw new Error(`Auth failed: ${res.status} ${res.body.substring(0, 200)}`);
  }

  // Extract cookie
  const cookies = res.setCookie || [];
  const tokenCookie = cookies.find(c => c.startsWith('TOKEN='));
  if (!tokenCookie) {
    throw new Error('No TOKEN cookie in auth response');
  }

  sessionCookie = tokenCookie.split(';')[0]; // "TOKEN=xxx"

  // Extract CSRF from JWT payload
  const jwt = sessionCookie.replace('TOKEN=', '');
  const payloadB64 = jwt.split('.')[1];
  const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString());
  csrfToken = payload.csrfToken;

  // Sessions last ~24h, refresh every 12h to be safe
  authExpiry = Date.now() + 12 * 60 * 60 * 1000;

  console.log(`[Auth] Success. CSRF: ${csrfToken.substring(0, 20)}...`);
}

async function ensureAuth() {
  if (!sessionCookie || !csrfToken || Date.now() > authExpiry) {
    await authenticate();
  }
}

// =============================================
// PTZ Commands
// =============================================
async function ptzMove(cameraId, x, y, z) {
  await ensureAuth();

  const body = JSON.stringify({
    type: 'continuous',
    payload: { x: Number(x), y: Number(y), z: Number(z) },
  });

  const res = await httpsRequest({
    hostname: UDM_HOST,
    port: 443,
    path: `/proxy/protect/api/cameras/${cameraId}/move`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cookie': sessionCookie,
      'X-CSRF-Token': csrfToken,
    },
  }, body);

  return res;
}

async function ptzGoto(cameraId, slot) {
  await ensureAuth();

  const res = await httpsRequest({
    hostname: UDM_HOST,
    port: 443,
    path: `/proxy/protect/api/cameras/${cameraId}/ptz/goto/${slot}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
      'X-CSRF-Token': csrfToken,
    },
  });

  return res;
}

// =============================================
// Camera Settings
// =============================================
async function getCameraSettings(cameraId) {
  await ensureAuth();

  const res = await httpsRequest({
    hostname: UDM_HOST,
    port: 443,
    path: `/proxy/protect/api/cameras/${cameraId}`,
    method: 'GET',
    headers: {
      'Cookie': sessionCookie,
      'X-CSRF-Token': csrfToken,
    },
  });

  return res;
}

async function patchCameraSettings(cameraId, settings) {
  await ensureAuth();

  const body = JSON.stringify(settings);

  const res = await httpsRequest({
    hostname: UDM_HOST,
    port: 443,
    path: `/proxy/protect/api/cameras/${cameraId}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cookie': sessionCookie,
      'X-CSRF-Token': csrfToken,
    },
  }, body);

  return res;
}

// =============================================
// Snapshot
// =============================================
async function getSnapshot(cameraId) {
  await ensureAuth();

  const ts = Date.now();

  const res = await httpsRequestBinary({
    hostname: UDM_HOST,
    port: 443,
    path: `/proxy/protect/api/cameras/${cameraId}/snapshot?ts=${ts}`,
    method: 'GET',
    headers: {
      'Cookie': sessionCookie,
      'X-CSRF-Token': csrfToken,
    },
  });

  return res;
}

// =============================================
// HTTP Server
// =============================================
function getCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

// Helper to retry on 401
async function withAuthRetry(fn) {
  let result = await fn();
  if (result.status === 401) {
    console.log('[Proxy] Got 401, re-authenticating...');
    sessionCookie = null;
    await ensureAuth();
    result = await fn();
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  try {
    // ---- Route: POST /ptz/{cameraId} ----
    const ptzMatch = req.url.match(/^\/ptz\/([a-f0-9]+)/i);
    if (ptzMatch && req.method === 'POST') {
      const cameraId = ptzMatch[1];

      let body = '';
      for await (const chunk of req) body += chunk;

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      let result;

      if (payload.action === 'move') {
        const x = Math.max(-750, Math.min(750, Number(payload.x) || 0));
        const y = Math.max(-750, Math.min(750, Number(payload.y) || 0));
        const z = Math.max(-750, Math.min(750, Number(payload.z) || 0));
        result = await withAuthRetry(() => ptzMove(cameraId, x, y, z));
      } else if (payload.action === 'goto') {
        const slot = Number(payload.slot) ?? -1;
        result = await withAuthRetry(() => ptzGoto(cameraId, slot));
      } else {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action. Use "move" or "goto".' }));
        return;
      }

      const statusCode = result.status >= 200 && result.status < 300 ? 200 : result.status;
      res.writeHead(statusCode, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: statusCode === 200, status: result.status }));
      return;
    }

    // ---- Route: GET /camera/{cameraId}/snapshot ----
    const snapshotMatch = req.url.match(/^\/camera\/([a-f0-9]+)\/snapshot/i);
    if (snapshotMatch && req.method === 'GET') {
      const cameraId = snapshotMatch[1];

      // Rate limit: 1 snapshot per second per camera
      const now = Date.now();
      if (snapshotTimestamps[cameraId] && now - snapshotTimestamps[cameraId] < 1000) {
        res.writeHead(429, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limited. Max 1 snapshot per second per camera.' }));
        return;
      }
      snapshotTimestamps[cameraId] = now;

      const result = await withAuthRetry(() => getSnapshot(cameraId));

      if (result.status !== 200) {
        res.writeHead(result.status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Snapshot failed: ${result.status}` }));
        return;
      }

      res.writeHead(200, {
        ...cors,
        'Content-Type': result.headers['content-type'] || 'image/jpeg',
        'Content-Length': result.body.length,
        'Content-Disposition': `attachment; filename="snapshot-${Date.now()}.jpg"`,
      });
      res.end(result.body);
      return;
    }

    // ---- Route: GET/PATCH /camera/{cameraId}/settings ----
    const settingsMatch = req.url.match(/^\/camera\/([a-f0-9]+)\/settings/i);
    if (settingsMatch && (req.method === 'GET' || req.method === 'PATCH')) {
      const cameraId = settingsMatch[1];

      if (req.method === 'GET') {
        const result = await withAuthRetry(() => getCameraSettings(cameraId));

        if (result.status !== 200) {
          res.writeHead(result.status, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Settings fetch failed: ${result.status}` }));
          return;
        }

        // Filter to only safe fields
        let full;
        try {
          full = JSON.parse(result.body);
        } catch {
          res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid response from Protect API' }));
          return;
        }

        const filtered = {
          id: full.id,
          name: full.name,
          irLedMode: full.irLedMode,
          statusLightEnabled: full.statusLightEnabled !== undefined ? full.statusLightEnabled : null,
          hdrModeEnabled: full.hdrModeEnabled !== undefined ? full.hdrModeEnabled : null,
          micVolume: full.micVolume,
          isPtzSupported: full.featureFlags?.isPtz || false,
          isDarkForceEnabled: full.isDark,
        };

        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(filtered));
        return;
      }

      if (req.method === 'PATCH') {
        let body = '';
        for await (const chunk of req) body += chunk;

        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }

        // Strict whitelist
        const safeSettings = {};
        for (const key of SETTINGS_WHITELIST) {
          if (payload[key] !== undefined) {
            safeSettings[key] = payload[key];
          }
        }

        if (Object.keys(safeSettings).length === 0) {
          res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No valid settings. Allowed: ${SETTINGS_WHITELIST.join(', ')}` }));
          return;
        }

        console.log(`[Settings] PATCH camera ${cameraId}:`, JSON.stringify(safeSettings));

        const result = await withAuthRetry(() => patchCameraSettings(cameraId, safeSettings));

        const statusCode = result.status >= 200 && result.status < 300 ? 200 : result.status;
        res.writeHead(statusCode, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: statusCode === 200, status: result.status }));
        return;
      }
    }

    // ---- 404 ----
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Routes: POST /ptz/{id}, GET /camera/{id}/snapshot, GET|PATCH /camera/{id}/settings' }));

  } catch (err) {
    console.error('[Proxy] Error:', err.message);
    res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Camera Control Proxy listening on 127.0.0.1:${PORT}`);
  console.log(`UDM Host: ${UDM_HOST}`);
  console.log(`Routes: POST /ptz/{id}, GET /camera/{id}/snapshot, GET|PATCH /camera/{id}/settings`);
  // Pre-auth on startup
  authenticate().catch(err => console.error('[Auth] Startup auth failed:', err.message));
});
