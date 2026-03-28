#!/usr/bin/env node
/**
 * WiZ UDP proxy for remote automation control.
 *
 * Runs on a host that can reach WiZ bulbs on LAN (for this project: DO droplet
 * forwarding over SSH to Alpaca Mac is preferred, but this can run directly on
 * Alpaca Mac too).
 */
const http = require("http");
const dgram = require("dgram");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 8910);
const AUTH_TOKEN = process.env.WIZ_PROXY_TOKEN || "";
const REQUEST_TIMEOUT_MS = Number(process.env.WIZ_UDP_TIMEOUT_MS || 1200);
const WIZ_SSH_TARGET = process.env.WIZ_SSH_TARGET || "";
const WIZ_SSH_CONNECT_TIMEOUT_MS = Number(
  process.env.WIZ_SSH_CONNECT_TIMEOUT_MS || 6000,
);

if (!AUTH_TOKEN) {
  console.error("Missing WIZ_PROXY_TOKEN");
  process.exit(1);
}

function sendWiz(ip, payload) {
  if (WIZ_SSH_TARGET) return sendWizViaSsh(ip, payload);
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      resolve({ ip, ok: false, error: "timeout" });
    }, REQUEST_TIMEOUT_MS);

    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.close();
      resolve({ ip, ok: false, error: err.message });
    });

    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve({ ip, ok: true, response: msg.toString("utf8") });
    });

    socket.send(
      Buffer.from(JSON.stringify(payload), "utf8"),
      38899,
      ip,
      (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          resolve({ ip, ok: false, error: err.message });
        }
      },
    );
  });
}

function sendWizViaSsh(ip, payload) {
  const ipValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  if (!ipValid) {
    return Promise.resolve({ ip, ok: false, error: "invalid_ip" });
  }

  const payloadJson = JSON.stringify(payload).replace(/'/g, "'\\''");
  const remoteCmd = `echo '${payloadJson}' | nc -u -w1 ${ip} 38899`;

  return new Promise((resolve) => {
    execFile(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ConnectTimeout=5",
        WIZ_SSH_TARGET,
        remoteCmd,
      ],
      { timeout: WIZ_SSH_CONNECT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            ip,
            ok: false,
            error: stderr?.trim() || error.message,
          });
          return;
        }
        resolve({ ip, ok: true, response: (stdout || "").trim() });
      },
    );
  });
}

async function handleGroupPower(ips, on) {
  const payload = { method: "setPilot", params: { state: !!on } };
  return Promise.all(ips.map((ip) => sendWiz(ip, payload)));
}

async function handleGroupBrightness(ips, brightness) {
  const dimming = Math.max(1, Math.min(100, Number(brightness || 100)));
  const payload = { method: "setPilot", params: { state: true, dimming } };
  return Promise.all(ips.map((ip) => sendWiz(ip, payload)));
}

async function handleGroupColor(ips, r, g, b, dimming) {
  const rr = Math.max(0, Math.min(255, Number(r ?? 255)));
  const gg = Math.max(0, Math.min(255, Number(g ?? 0)));
  const bb = Math.max(0, Math.min(255, Number(b ?? 0)));
  const dd = Math.max(1, Math.min(100, Number(dimming ?? 20)));
  const payload = {
    method: "setPilot",
    params: { state: true, r: rr, g: gg, b: bb, dimming: dd },
  };
  return Promise.all(ips.map((ip) => sendWiz(ip, payload)));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const body = await parseBody(req);
    const ips = Array.isArray(body.ips)
      ? body.ips.map((v) => String(v).trim()).filter(Boolean)
      : [];
    if (ips.length === 0) {
      writeJson(res, 400, { error: "Missing ips[]" });
      return;
    }

    if (req.url === "/group/power") {
      const results = await handleGroupPower(ips, !!body.on);
      writeJson(res, 200, { ok: true, mode: "power", results });
      return;
    }

    if (req.url === "/group/brightness") {
      const results = await handleGroupBrightness(ips, body.brightness);
      writeJson(res, 200, { ok: true, mode: "brightness", results });
      return;
    }

    if (req.url === "/group/color") {
      const results = await handleGroupColor(
        ips,
        body.r,
        body.g,
        body.b,
        body.dimming,
      );
      writeJson(res, 200, { ok: true, mode: "color", results });
      return;
    }

    writeJson(res, 404, { error: "Unknown route" });
  } catch (err) {
    writeJson(res, 500, { error: err.message || "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`wiz-proxy listening on :${PORT}`);
});
