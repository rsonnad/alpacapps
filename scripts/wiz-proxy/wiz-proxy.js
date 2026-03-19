#!/usr/bin/env node
/**
 * WiZ Light Proxy — HTTP server translating REST requests to WiZ UDP commands
 * Runs on Alpaca Mac (192.168.1.74), port 8902
 *
 * Routes:
 *   POST /group/power       — body: { ips: string[], on: boolean }
 *   POST /group/brightness   — body: { ips: string[], brightness: 1-100 }
 *   POST /group/color        — body: { ips: string[], r, g, b, dimming? }
 *   POST /group/temperature  — body: { ips: string[], temp: 2200-6500 }
 *   POST /bulb/state         — body: { ip: string } — get single bulb state
 *   GET  /health             — returns { ok: true, uptime }
 *
 * Auth: Bearer token via WIZ_PROXY_TOKEN env var
 * Deploy to: ~/wiz-proxy/ on Alpaca Mac
 * LaunchAgent: com.alpacapps.wiz-proxy.plist
 */

const http = require('http');
const dgram = require('dgram');

const PORT = process.env.WIZ_PORT || 8902;
const AUTH_TOKEN = process.env.WIZ_PROXY_TOKEN || '';
const WIZ_UDP_PORT = 38899;
const UDP_TIMEOUT_MS = 2000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://rsonnad.github.io,https://alpacaplayhouse.com,https://www.alpacaplayhouse.com').split(',');

function getCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGINS[0];
  }
  return headers;
}

function jsonResponse(res, data, status = 200, origin) {
  const cors = getCorsHeaders(origin);
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Send a UDP message to a WiZ bulb and wait for response
function sendWizUdp(ip, message) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const payload = Buffer.from(JSON.stringify(message));
    const timer = setTimeout(() => {
      client.close();
      reject(new Error(`UDP timeout for ${ip}`));
    }, UDP_TIMEOUT_MS);

    client.on('message', (msg) => {
      clearTimeout(timer);
      client.close();
      try {
        resolve(JSON.parse(msg.toString()));
      } catch {
        resolve({ raw: msg.toString() });
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      client.close();
      reject(err);
    });

    client.send(payload, WIZ_UDP_PORT, ip, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        reject(err);
      }
    });
  });
}

// Send command to multiple IPs with retry on failure
async function sendToGroup(ips, message) {
  const results = [];
  const failed = [];

  // First pass
  await Promise.all(ips.map(async (ip) => {
    try {
      const resp = await sendWizUdp(ip, message);
      results.push({ ip, ok: true, response: resp });
    } catch (err) {
      failed.push(ip);
      results.push({ ip, ok: false, error: err.message, attempt: 1 });
    }
  }));

  // Retry failed IPs once (UDP is lossy)
  if (failed.length > 0) {
    await Promise.all(failed.map(async (ip) => {
      try {
        const resp = await sendWizUdp(ip, message);
        // Update the result for this IP
        const idx = results.findIndex(r => r.ip === ip);
        results[idx] = { ip, ok: true, response: resp, retried: true };
      } catch (err) {
        const idx = results.findIndex(r => r.ip === ip);
        results[idx] = { ip, ok: false, error: err.message, attempt: 2 };
      }
    }));
  }

  const okCount = results.filter(r => r.ok).length;
  return {
    total: ips.length,
    okCount,
    failedCount: ips.length - okCount,
    results,
  };
}

async function parseBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

function checkAuth(req) {
  if (!AUTH_TOKEN) return true; // no token configured = open (dev mode)
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${AUTH_TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = getCorsHeaders(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    return jsonResponse(res, { ok: true, uptime: process.uptime() }, 200, origin);
  }

  // Auth check
  if (!checkAuth(req)) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401, origin);
  }

  try {
    // POST /bulb/state — query single bulb
    if (req.url === '/bulb/state' && req.method === 'POST') {
      const { ip } = await parseBody(req);
      if (!ip) return jsonResponse(res, { error: 'ip is required' }, 400, origin);

      const resp = await sendWizUdp(ip, { method: 'getPilot', params: {} });
      return jsonResponse(res, { ok: true, ip, state: resp }, 200, origin);
    }

    // POST /group/{mode}
    const routeMatch = req.url.match(/^\/group\/(\w+)$/);
    if (routeMatch && req.method === 'POST') {
      const mode = routeMatch[1];
      const body = await parseBody(req);
      const { ips } = body;

      if (!Array.isArray(ips) || ips.length === 0) {
        return jsonResponse(res, { error: 'ips array is required' }, 400, origin);
      }

      let message;

      switch (mode) {
        case 'power':
          message = {
            method: 'setState',
            params: { state: !!body.on },
          };
          break;

        case 'brightness':
          message = {
            method: 'setState',
            params: {
              state: true,
              dimming: Math.max(1, Math.min(100, Math.round(body.brightness || 50))),
            },
          };
          break;

        case 'color':
          message = {
            method: 'setState',
            params: {
              state: true,
              r: Math.max(0, Math.min(255, Math.round(body.r || 0))),
              g: Math.max(0, Math.min(255, Math.round(body.g || 0))),
              b: Math.max(0, Math.min(255, Math.round(body.b || 0))),
              dimming: Math.max(1, Math.min(100, Math.round(body.dimming || 70))),
            },
          };
          break;

        case 'temperature':
          message = {
            method: 'setState',
            params: {
              state: true,
              temp: Math.max(2200, Math.min(6500, Math.round(body.temp || 4000))),
              dimming: Math.max(1, Math.min(100, Math.round(body.dimming || 100))),
            },
          };
          break;

        default:
          return jsonResponse(res, { error: `Unknown mode: ${mode}` }, 400, origin);
      }

      console.log(`[${new Date().toISOString()}] ${mode} → ${ips.length} bulbs`);
      const result = await sendToGroup(ips, message);
      return jsonResponse(res, result, 200, origin);
    }

    return jsonResponse(res, { error: 'Not found' }, 404, origin);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
    return jsonResponse(res, { error: err.message }, 500, origin);
  }
});

server.listen(PORT, () => {
  console.log(`WiZ Light Proxy listening on port ${PORT}`);
  console.log(`Auth: ${AUTH_TOKEN ? 'enabled' : 'disabled (no WIZ_PROXY_TOKEN set)'}`);
});
