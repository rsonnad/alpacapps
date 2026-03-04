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
const net = require('net');

const PORT = parseInt(process.env.PRINTER_PROXY_PORT || '8903', 10);
const HEALTH_PORT = parseInt(process.env.PRINTER_HEALTH_PORT || '8904', 10);
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const DEFAULT_PRINTER_IP = process.env.DEFAULT_PRINTER_IP || '192.168.1.106';
const DEFAULT_TCP_PORT = parseInt(process.env.DEFAULT_TCP_PORT || '8899', 10);
const TCP_TIMEOUT = parseInt(process.env.TCP_TIMEOUT || '8000', 10);

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

  // M27 also returns printing status
  if (raw.includes('Not SD printing')) {
    status.printing = false;
  } else if (progressMatch) {
    status.printing = true;
  }

  // Machine status from M119 or general status
  const statusMatch = raw.match(/MachineStatus:\s*(\w+)/);
  if (statusMatch) status.machineStatus = statusMatch[1];

  // Move mode
  const moveMatch = raw.match(/MoveMode:\s*(\w+)/);
  if (moveMatch) status.moveMode = moveMatch[1];

  // LED state
  const ledMatch = raw.match(/LED:\s*(\w+)/);
  if (ledMatch) status.ledOn = ledMatch[1].toLowerCase() === 'on';

  // Current file
  const fileMatch = raw.match(/CurrentFile:\s*(.+)/);
  if (fileMatch && fileMatch[1].trim()) status.currentFile = fileMatch[1].trim();

  return status;
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

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown action. Use /status, /command, /control, or /sequence' }));
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
