#!/usr/bin/env node
/**
 * FlashForge Printer Proxy — HTTP→TCP Bridge
 *
 * Runs on Alpaca Mac. Accepts HTTP POST requests from Supabase edge functions
 * (via Caddy/Tailscale) and forwards them as raw TCP commands to the printer.
 *
 * Usage: PROXY_SECRET=xxx node printer-proxy.js
 * Ports: 8903 (HTTP API), 8904 (health check)
 */

const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');

const PORT = parseInt(process.env.PRINTER_PROXY_PORT || '8903', 10);
const HEALTH_PORT = parseInt(process.env.PRINTER_HEALTH_PORT || '8904', 10);
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const DEFAULT_PRINTER_IP = process.env.DEFAULT_PRINTER_IP || '192.168.1.106';
const DEFAULT_TCP_PORT = parseInt(process.env.DEFAULT_TCP_PORT || '8899', 10);
const DEFAULT_HTTP_PORT = parseInt(process.env.DEFAULT_HTTP_PORT || '8898', 10);
const TCP_TIMEOUT = parseInt(process.env.TCP_TIMEOUT || '8000', 10);
const UPLOAD_TIMEOUT = parseInt(process.env.UPLOAD_TIMEOUT || '60000', 10);

/**
 * Send a raw TCP command to the printer and collect the response.
 * FlashForge TCP protocol: send command terminated by \r\n, read until "ok\r\n" or timeout.
 */
function sendTcpCommand(ip, port, command, timeout = TCP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        sock.destroy();
        // Return whatever we have so far (partial response is still useful)
        resolve(buffer || '(timeout, no data)');
      }
    }, timeout);

    sock.connect(port, ip, () => {
      sock.write(command.endsWith('\r\n') ? command : command + '\r\n');
    });

    sock.on('data', (data) => {
      buffer += data.toString();
      // FlashForge responses end with "ok\r\n" or "ok\n"
      if (buffer.includes('ok\r\n') || buffer.includes('ok\n')) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          resolve(buffer);
        }
      }
    });

    sock.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    sock.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(buffer || '(connection closed, no data)');
      }
    });
  });
}

/**
 * Send multiple commands sequentially on a single TCP connection.
 * Used for control sequences: M601 S1 → command → M602
 */
function sendTcpSequence(ip, port, commands, timeout = TCP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const results = [];
    let currentCmd = 0;
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        sock.destroy();
        resolve(results.concat(buffer ? [{ command: commands[currentCmd], response: buffer }] : []));
      }
    }, timeout);

    function sendNext() {
      if (currentCmd >= commands.length) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          resolve(results);
        }
        return;
      }
      buffer = '';
      const cmd = commands[currentCmd];
      sock.write(cmd.endsWith('\r\n') ? cmd : cmd + '\r\n');
    }

    sock.connect(port, ip, () => {
      sendNext();
    });

    sock.on('data', (data) => {
      buffer += data.toString();
      if (buffer.includes('ok\r\n') || buffer.includes('ok\n')) {
        results.push({ command: commands[currentCmd], response: buffer.trim() });
        currentCmd++;
        // Small delay between commands
        setTimeout(sendNext, 50);
      }
    });

    sock.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    sock.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(results);
      }
    });
  });
}

/**
 * Parse a FlashForge status response into structured JSON.
 */
function parseStatusResponse(raw) {
  const status = {};

  // M115 response: Machine Type, Machine Name, Firmware, SN, etc.
  const machineType = raw.match(/Machine Type:\s*(.+)/);
  if (machineType) status.machineType = machineType[1].trim();

  const machineName = raw.match(/Machine Name:\s*(.+)/);
  if (machineName) status.machineName = machineName[1].trim();

  const firmware = raw.match(/Firmware:\s*(.+)/);
  if (firmware) status.firmwareVersion = firmware[1].trim();

  const sn = raw.match(/SN:\s*(.+)/);
  if (sn) status.serialNumber = sn[1].trim();

  const buildVol = raw.match(/X:\s*(\d+)\s*Y:\s*(\d+)\s*Z:\s*(\d+)/);
  if (buildVol) status.buildVolume = { x: +buildVol[1], y: +buildVol[2], z: +buildVol[3] };

  // M105 response: temperatures
  const nozzleMatch = raw.match(/T0:(\d+\.?\d*)\s*\/(\d+\.?\d*)/);
  if (nozzleMatch) {
    status.nozzle = { current: parseFloat(nozzleMatch[1]), target: parseFloat(nozzleMatch[2]) };
  }

  const bedMatch = raw.match(/B:(\d+\.?\d*)\s*\/(\d+\.?\d*)/);
  if (bedMatch) {
    status.bed = { current: parseFloat(bedMatch[1]), target: parseFloat(bedMatch[2]) };
  }

  // M27 response: print progress
  const progressMatch = raw.match(/SD printing byte\s+(\d+)\/(\d+)/);
  if (progressMatch) {
    const current = parseInt(progressMatch[1]);
    const total = parseInt(progressMatch[2]);
    status.printProgress = {
      bytesSent: current,
      bytesTotal: total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
    };
  }

  // Machine status from M119 or general status
  const statusMatch = raw.match(/MachineStatus:\s*(\w+)/);
  if (statusMatch) status.machineStatus = statusMatch[1];

  // M27 also returns printing status — use MachineStatus to disambiguate
  // "SD printing byte 0/100" with MachineStatus READY means idle (not printing)
  if (raw.includes('Not SD printing')) {
    status.printing = false;
  } else if (progressMatch) {
    const machineReady = status.machineStatus === 'READY';
    const noProgress = parseInt(progressMatch[1]) === 0;
    status.printing = !(machineReady && noProgress);
  }

  // Move mode
  const moveMatch = raw.match(/MoveMode:\s*(\w+)/);
  if (moveMatch) status.moveMode = moveMatch[1];

  // LED state — FlashForge returns "LED: 0" or "LED: 1" (numeric) or "on"/"off"
  const ledMatch = raw.match(/LED:\s*(\S+)/);
  if (ledMatch) {
    const val = ledMatch[1].toLowerCase();
    status.ledOn = val === 'on' || val === '1';
  }

  // Current file — filter out "ok" which appears when no file is loaded
  const fileMatch = raw.match(/CurrentFile:\s*(.+)/);
  if (fileMatch) {
    const fname = fileMatch[1].trim();
    if (fname && fname !== 'ok' && !fname.startsWith('ok')) {
      status.currentFile = fname;
    }
  }

  return status;
}

/**
 * Upload a G-code file to the printer via its HTTP API (port 8898).
 * The Adventurer 5M Pro uses HTTP multipart upload instead of TCP M28/M29.
 * Requires the printer to be in LAN mode with a valid checkCode.
 */
function uploadGcode(ip, httpPort, filename, gcodeBuffer, serialNumber, checkCode, timeout = UPLOAD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const safeName = path.basename(filename);

    // Build multipart body
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, gcodeBuffer, footer]);

    const options = {
      hostname: ip,
      port: httpPort,
      path: '/uploadGcode',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout,
    };

    // Add auth headers if provided
    if (serialNumber) options.headers['serialNumber'] = serialNumber;
    if (checkCode) options.headers['checkCode'] = checkCode;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upload timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Upload a G-code file from the local filesystem to the printer.
 * Used when the proxy has direct access to sliced files.
 */
async function uploadLocalFile(ip, httpPort, localPath, serialNumber, checkCode, timeout = UPLOAD_TIMEOUT) {
  const fs = require('fs');
  const filename = path.basename(localPath);
  const gcodeBuffer = fs.readFileSync(localPath);
  return uploadGcode(ip, httpPort, filename, gcodeBuffer, serialNumber, checkCode, timeout);
}

// Main HTTP server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Auth check
  if (PROXY_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${PROXY_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  // Read body
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const ip = payload.ip || DEFAULT_PRINTER_IP;
  const port = payload.port || DEFAULT_TCP_PORT;

  try {
    // Route: /status — get full printer status
    if (req.url === '/status' || payload.action === 'status') {
      const commands = ['~M115', '~M105', '~M27', '~M119'];
      const results = await sendTcpSequence(ip, port, commands, TCP_TIMEOUT);
      const rawAll = results.map(r => r.response).join('\n');
      const parsed = parseStatusResponse(rawAll);
      parsed.raw = results;
      parsed.timestamp = new Date().toISOString();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(parsed));
      return;
    }

    // Route: /command — send raw command(s)
    if (req.url === '/command' || payload.action === 'command') {
      const command = payload.command;
      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing command' }));
        return;
      }

      const result = await sendTcpCommand(ip, port, command, TCP_TIMEOUT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: result.trim(), timestamp: new Date().toISOString() }));
      return;
    }

    // Route: /control — send a control sequence (M601 S1 → commands → M602)
    if (req.url === '/control' || payload.action === 'control') {
      const commands = payload.commands;
      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing commands array' }));
        return;
      }

      const sequence = ['~M601 S1', ...commands, '~M602'];
      const results = await sendTcpSequence(ip, port, sequence, TCP_TIMEOUT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results, timestamp: new Date().toISOString() }));
      return;
    }

    // Route: /sequence — send multiple commands without M601/M602 wrapping
    if (req.url === '/sequence' || payload.action === 'sequence') {
      const commands = payload.commands;
      if (!commands || !Array.isArray(commands)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing commands array' }));
        return;
      }

      const results = await sendTcpSequence(ip, port, commands, TCP_TIMEOUT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results, timestamp: new Date().toISOString() }));
      return;
    }

    // Route: /upload — upload G-code to printer via HTTP API (port 8898)
    // Body: { filename, gcode (base64), serialNumber, checkCode }
    if (req.url === '/upload' || payload.action === 'upload') {
      const { filename, gcode, serialNumber, checkCode } = payload;
      if (!filename || !gcode) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing filename or gcode (base64)' }));
        return;
      }

      const gcodeBuffer = Buffer.from(gcode, 'base64');
      console.log(`Uploading ${filename} (${gcodeBuffer.length} bytes) to ${ip}:${DEFAULT_HTTP_PORT}`);

      const result = await uploadGcode(ip, DEFAULT_HTTP_PORT, filename, gcodeBuffer, serialNumber, checkCode, UPLOAD_TIMEOUT);
      console.log(`Upload result: ${JSON.stringify(result)}`);

      res.writeHead(result.statusCode === 200 ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, timestamp: new Date().toISOString() }));
      return;
    }

    // Route: /upload-local — upload a file already on Alpaca Mac's filesystem
    // Body: { localPath, serialNumber, checkCode }
    if (req.url === '/upload-local' || payload.action === 'upload-local') {
      const { localPath, serialNumber, checkCode } = payload;
      if (!localPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing localPath' }));
        return;
      }

      const fs = require('fs');
      if (!fs.existsSync(localPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File not found: ${localPath}` }));
        return;
      }

      const filename = path.basename(localPath);
      const gcodeBuffer = fs.readFileSync(localPath);
      console.log(`Uploading local file ${localPath} (${gcodeBuffer.length} bytes) to ${ip}:${DEFAULT_HTTP_PORT}`);

      const result = await uploadGcode(ip, DEFAULT_HTTP_PORT, filename, gcodeBuffer, serialNumber, checkCode, UPLOAD_TIMEOUT);
      console.log(`Upload result: ${JSON.stringify(result)}`);

      res.writeHead(result.statusCode === 200 ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown action. Use /status, /command, /control, /sequence, /upload, or /upload-local' }));
  } catch (err) {
    console.error('Printer proxy error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// Health check server
const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'printer-proxy', uptime: process.uptime() }));
});

server.listen(PORT, () => {
  console.log(`Printer proxy listening on port ${PORT}`);
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`Health check on port ${HEALTH_PORT}`);
});
