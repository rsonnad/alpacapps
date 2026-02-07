#!/usr/bin/env node
/**
 * PTZ Proxy — Tiny HTTP server that proxies PTZ commands to UniFi Protect API
 * Runs on DO droplet, accessed via Caddy reverse proxy at cam.alpacaplayhouse.com/ptz/
 *
 * Routes:
 *   POST /ptz/{cameraId}  — body: { action: "move", x, y, z } or { action: "goto", slot }
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

// =============================================
// HTTPS helper (ignores self-signed cert)
// =============================================
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    options.rejectAuthorized = false;
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
// HTTP Server
// =============================================
function getCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
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

  // Parse path: /ptz/{cameraId}
  const match = req.url.match(/^\/ptz\/([a-f0-9]+)/i);
  if (!match || req.method !== 'POST') {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /ptz/{cameraId}' }));
    return;
  }

  const cameraId = match[1];

  // Read body
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

  try {
    let result;

    if (payload.action === 'move') {
      // Clamp values to valid range
      const x = Math.max(-750, Math.min(750, Number(payload.x) || 0));
      const y = Math.max(-750, Math.min(750, Number(payload.y) || 0));
      const z = Math.max(-750, Math.min(750, Number(payload.z) || 0));
      result = await ptzMove(cameraId, x, y, z);
    } else if (payload.action === 'goto') {
      const slot = Number(payload.slot) ?? -1;
      result = await ptzGoto(cameraId, slot);
    } else {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown action. Use "move" or "goto".' }));
      return;
    }

    // If auth expired (401), retry once
    if (result.status === 401) {
      console.log('[PTZ] Got 401, re-authenticating...');
      sessionCookie = null;
      await ensureAuth();
      result = payload.action === 'move'
        ? await ptzMove(cameraId, payload.x || 0, payload.y || 0, payload.z || 0)
        : await ptzGoto(cameraId, payload.slot ?? -1);
    }

    const statusCode = result.status >= 200 && result.status < 300 ? 200 : result.status;
    res.writeHead(statusCode, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: statusCode === 200, status: result.status }));

  } catch (err) {
    console.error('[PTZ] Error:', err.message);
    res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PTZ Proxy listening on 127.0.0.1:${PORT}`);
  console.log(`UDM Host: ${UDM_HOST}`);
  // Pre-auth on startup
  authenticate().catch(err => console.error('[Auth] Startup auth failed:', err.message));
});
