#!/usr/bin/env node
/**
 * alpuca-static-media-server.js
 *
 * Tiny static file server for /Volumes/rvault20/media on Alpuca.
 * Bound to localhost:8200 — exposed publicly via the cloudflared tunnel
 * already configured at files.alpacaplayhouse.com (see ~/.cloudflared/config.yml).
 *
 * Adds permissive CORS so the alpacaplayhouse.com kiosk slideshow can fetch
 * manifest.json + images from a different subdomain.
 *
 * Run via the launchd plist com.alpacaplayhouse.media-server.plist.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.MEDIA_ROOT || '/Volumes/rvault20/media';
const PORT = parseInt(process.env.PORT || '8200', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.png':  'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4':  'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'public, max-age=300',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safe = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  let full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(full, (err, st) => {
    if (err) return send(res, 404, 'not found');
    if (st.isDirectory()) {
      // Auto-list directories as JSON for debugging
      try {
        const entries = fs.readdirSync(full).map((n) => {
          const s = fs.statSync(path.join(full, n));
          return { name: n, dir: s.isDirectory(), size: s.size };
        });
        return send(res, 200, JSON.stringify({ path: reqPath, entries }, null, 2),
          { 'Content-Type': MIME['.json'] });
      } catch (e) {
        return send(res, 500, 'list failed');
      }
    }
    const ext = path.extname(full).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
    };
    if (req.method === 'HEAD') return send(res, 200, '', headers);
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
      ...headers,
    });
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[media-server] serving ${ROOT} on http://${HOST}:${PORT}`);
});
