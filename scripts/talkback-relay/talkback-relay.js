#!/usr/bin/env node
/**
 * Camera Talkback Relay — WebSocket → ffmpeg → UDP relay for UniFi camera two-way audio
 *
 * Protocol:
 *   Browser (PCM S16LE 48kHz mono) → WebSocket → ffmpeg → AAC-ADTS 22.05kHz → UDP → Camera:7004
 *
 * WebSocket URL format: ws://host:8902/talkback/{protectCameraId}
 *
 * Messages (JSON):
 *   Client → Server:  { type: "start", cameraId: "..." }   Start talkback session
 *                      { type: "stop" }                      Stop talkback session
 *                      { type: "pong" }                      Keepalive response
 *                      (binary)                              PCM S16LE audio frames
 *   Server → Client:  { type: "started", cameraId: "..." }  Session active
 *                      { type: "error", message: "..." }     Error
 *                      { type: "stopped" }                   Session ended
 *                      { type: "ping" }                      Keepalive
 *
 * Deploy: ~/talkback-relay/ on Alpaca Mac
 * LaunchAgent: com.talkback-relay.plist
 */

const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const dgram = require('dgram');

const PORT = parseInt(process.env.TALKBACK_PORT) || 8902;
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT) || 8903;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Camera IPs on LAN (protectCameraId → LAN IP)
const CAMERA_IPS = {
  '694c550400317503e400044b': '192.168.1.173', // Alpacamera
  '696534fc003eed03e4028eee': '192.168.1.182', // Front Of House
  '696537cc0067ed03e402929c': '192.168.1.110', // Side Yard
};
const CAMERA_PORT = 7004;

// Active sessions: cameraId → { ws, ffmpeg, udpSocket }
const activeSessions = new Map();

// =============================================
// WebSocket Server
// =============================================
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

wss.on('listening', () => {
  console.log(`[Talkback] WebSocket server listening on 0.0.0.0:${PORT}`);
  console.log(`[Talkback] Cameras: ${Object.keys(CAMERA_IPS).length}`);
});

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[Talkback] New connection from ${ip}`);

  let session = null;

  ws.on('message', (data, isBinary) => {
    if (isBinary || Buffer.isBuffer(data)) {
      // Binary audio frame — pipe to ffmpeg
      if (session && session.ffmpeg && !session.ffmpeg.stdin.destroyed) {
        try {
          session.ffmpeg.stdin.write(data);
        } catch (err) {
          console.error('[Talkback] ffmpeg write error:', err.message);
        }
      }
      return;
    }

    // JSON control message
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error('[Talkback] Invalid JSON');
      return;
    }

    if (msg.type === 'start') {
      session = startSession(ws, msg.cameraId);
    } else if (msg.type === 'stop') {
      stopSession(session);
      session = null;
    } else if (msg.type === 'pong') {
      // keepalive ack
    }
  });

  ws.on('close', () => {
    console.log(`[Talkback] Connection closed from ${ip}`);
    if (session) {
      stopSession(session);
      session = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[Talkback] WS error:', err.message);
  });

  // Keepalive ping every 30s
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      sendJSON(ws, { type: 'ping' });
    }
  }, 30000);
  ws.on('close', () => clearInterval(pingInterval));
});

// =============================================
// Session Management
// =============================================
function startSession(ws, cameraId) {
  if (!cameraId || !CAMERA_IPS[cameraId]) {
    console.error(`[Talkback] Invalid camera ID: ${cameraId}`);
    sendJSON(ws, { type: 'error', message: 'Invalid camera ID' });
    return null;
  }

  if (activeSessions.has(cameraId)) {
    console.warn(`[Talkback] Camera ${cameraId} already in use`);
    sendJSON(ws, { type: 'error', message: 'Camera in use by another user' });
    return null;
  }

  const cameraIp = CAMERA_IPS[cameraId];
  console.log(`[Talkback] Starting session → ${cameraIp}:${CAMERA_PORT}`);

  // Create UDP socket for sending to camera
  const udpSocket = dgram.createSocket('udp4');
  udpSocket.on('error', (err) => {
    console.error(`[Talkback] UDP error:`, err.message);
  });

  // Spawn ffmpeg: PCM S16LE 48kHz mono → AAC-ADTS 22.05kHz mono
  const ffmpeg = spawn(FFMPEG_PATH, [
    '-f', 's16le',       // input format: raw PCM
    '-ar', '48000',      // input sample rate
    '-ac', '1',          // mono
    '-i', 'pipe:0',      // read from stdin
    '-c:a', 'aac',       // encode to AAC
    '-ar', '22050',      // output sample rate (camera requirement)
    '-ac', '1',          // mono
    '-b:a', '32k',       // 32kbps (sufficient for speech)
    '-f', 'adts',        // AAC-ADTS container
    '-fflags', '+nobuffer',
    '-flags', '+low_delay',
    'pipe:1',            // write to stdout
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Pipe ffmpeg AAC output → UDP to camera
  ffmpeg.stdout.on('data', (chunk) => {
    udpSocket.send(chunk, CAMERA_PORT, cameraIp);
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    // Skip noisy ffmpeg banner lines
    if (msg && !msg.startsWith('Press [q]') && !msg.startsWith('  lib') && !msg.startsWith('  built') && !msg.startsWith('  configuration') && !msg.startsWith('ffmpeg version')) {
      console.log(`[ffmpeg] ${msg.substring(0, 200)}`);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[Talkback] ffmpeg spawn error:', err.message);
    sendJSON(ws, { type: 'error', message: 'Audio service unavailable (ffmpeg not found)' });
    cleanup(cameraId);
  });

  ffmpeg.on('exit', (code, signal) => {
    console.log(`[Talkback] ffmpeg exited: code=${code} signal=${signal}`);
    // Only cleanup if session wasn't already stopped
    if (activeSessions.has(cameraId)) {
      cleanup(cameraId);
    }
  });

  const session = { ws, ffmpeg, udpSocket, cameraId };
  activeSessions.set(cameraId, session);

  sendJSON(ws, { type: 'started', cameraId });
  console.log(`[Talkback] Session active. Total: ${activeSessions.size}`);
  return session;
}

function stopSession(session) {
  if (!session) return;
  console.log(`[Talkback] Stopping session for ${session.cameraId}`);

  // Gracefully close ffmpeg stdin
  try {
    if (session.ffmpeg && !session.ffmpeg.stdin.destroyed) {
      session.ffmpeg.stdin.end();
    }
  } catch (err) {
    // ignore
  }

  if (session.ws.readyState === WebSocket.OPEN) {
    sendJSON(session.ws, { type: 'stopped' });
  }

  cleanup(session.cameraId);
}

function cleanup(cameraId) {
  const session = activeSessions.get(cameraId);
  if (!session) return;

  if (session.ffmpeg && !session.ffmpeg.killed) {
    try { session.ffmpeg.kill('SIGTERM'); } catch (e) {}
  }
  if (session.udpSocket) {
    try { session.udpSocket.close(); } catch (e) {}
  }

  activeSessions.delete(cameraId);
  console.log(`[Talkback] Cleaned up. Total: ${activeSessions.size}`);
}

function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// =============================================
// Health Check HTTP Server
// =============================================
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeSessions: activeSessions.size,
      cameras: Object.keys(CAMERA_IPS).length,
      uptime: Math.round(process.uptime()),
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {
  console.log(`[Health] http://127.0.0.1:${HEALTH_PORT}/health`);
});

// =============================================
// Graceful Shutdown
// =============================================
process.on('SIGTERM', () => {
  console.log('[Talkback] SIGTERM — shutting down');
  activeSessions.forEach((session) => stopSession(session));
  wss.close();
  healthServer.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Talkback] SIGINT — shutting down');
  activeSessions.forEach((session) => stopSession(session));
  wss.close();
  healthServer.close();
  process.exit(0);
});
