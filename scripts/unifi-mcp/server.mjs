#!/usr/bin/env node
/**
 * UniFi MCP bridge — lets hosted chat clients (Claude Duet, claude.ai custom connectors) read and
 * change the UDM Pro through a fixed list of tools, without ever seeing a UDM password.
 *
 * Runs on ALPUCA (127.0.0.1:8941), published by its own Cloudflare tunnel at
 *   https://unifi-mcp.alpacaplayhouse.com/mcp
 *
 * Auth for clients (same shape as the Bridgit relay, bridgit-cloud relay/src/worker.mjs):
 *   - OAuth 2.1 for hosted clients: discovery metadata, dynamic client registration (public
 *     clients, allow-listed redirect URIs), PKCE S256, and an /authorize page where the owner
 *     pastes the bridge key. Access tokens last 1 h, refresh tokens 30 days, both HMAC-signed.
 *   - Or the bridge key itself as `Authorization: Bearer <key>` for headless clients.
 *   Revoke everything: replace ~/.unifi-mcp/signing_key (and the owner key) and restart.
 *
 * Auth to the UDM: a local UniFi OS account read from ~/.unifi-mcp/udm.json
 *   {"username": "...", "password": "..."} (chmod 600). Re-read on every login, so a rotated
 *   password needs no restart. Canonical copies in Bitwarden — see scripts/unifi-mcp/README.md.
 *
 * Deliberately NOT exposed: UniFi OS admin/user management, firmware, backup/restore, factory
 * reset, controller settings (SSH, remote access, management), Wi-Fi passphrases. Read results
 * redact every `x_*` field (UniFi's convention for secrets). Every write is appended to the audit log.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.UNIFI_MCP_HOME || path.join(os.homedir(), '.unifi-mcp');
const PORT = Number(process.env.UNIFI_MCP_PORT || 8941);
const BIND = process.env.UNIFI_MCP_BIND || '127.0.0.1';
const PUBLIC_URL = (process.env.UNIFI_MCP_PUBLIC_URL || 'https://unifi-mcp.alpacaplayhouse.com').replace(/\/$/, '');
const UDM_HOST = process.env.UDM_HOST || '192.168.1.1';
const SITE = process.env.UNIFI_SITE || 'default';
const AUDIT_LOG = process.env.UNIFI_MCP_AUDIT_LOG || path.join(os.homedir(), 'Library/Logs/unifi-mcp-audit.log');
const NET = `/proxy/network/api/s/${SITE}`;
const NET2 = `/proxy/network/v2/api/site/${SITE}`;

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const REDIRECTS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
const ACCESS_TTL = 3600e3;
const REFRESH_TTL = 30 * 864e5;
const CODE_TTL = 300e3;

const readSecret = (name) => fs.readFileSync(path.join(HOME, name), 'utf8').trim();
const OWNER_KEY = readSecret('owner_key');
const SIGNING_KEY = readSecret('signing_key');
if (OWNER_KEY.length < 32 || SIGNING_KEY.length < 32) throw new Error('owner_key/signing_key too short');

// ---------------------------------------------------------------- helpers
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const hmac = (s) => crypto.createHmac('sha256', SIGNING_KEY).update(s).digest('base64url');
const safeEq = (a, b) => {
  const x = sha256(String(a)), y = sha256(String(b));
  return crypto.timingSafeEqual(x, y);
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function sign(obj) {
  const p = b64url(JSON.stringify(obj));
  return `${p}.${hmac(p)}`;
}
function verify(tok, kind) {
  if (typeof tok !== 'string') return null;
  const i = tok.lastIndexOf('.');
  if (i < 1) return null;
  const p = tok.slice(0, i);
  if (!safeEq(hmac(p), tok.slice(i + 1))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (o.k !== kind || !(o.exp > Date.now())) return null;
    return o;
  } catch { return null; }
}

function redirectAllowed(uri) {
  if (REDIRECTS.includes(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.hash;
  } catch { return false; }
}

function audit(entry) {
  try { fs.appendFileSync(AUDIT_LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n'); } catch (e) { log('audit write failed', e.message); }
}

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = /^x_/.test(k) || /passphrase|password|psk|secret|private_?key/i.test(k) ? '[redacted]' : redact(x);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- UDM client
let udmCookie = null, udmCsrf = null, udmUntil = 0, loginBlockedUntil = 0, lastLoginError = null;

function udmRaw(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      host: UDM_HOST, port: 443, path: p, method, rejectUnauthorized: false, timeout: 20000,
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('UDM request timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function udmLogin() {
  // Failed logins can lock the account; back off for 10 minutes after a rejected password.
  if (Date.now() < loginBlockedUntil) throw new Error(`UDM login paused after a rejected password: ${lastLoginError}. Update ~/.unifi-mcp/udm.json on ALPUCA.`);
  let cred;
  try { cred = JSON.parse(readSecret('udm.json')); } catch { throw new Error('No UDM credentials on ALPUCA (~/.unifi-mcp/udm.json missing or invalid).'); }
  const r = await udmRaw('POST', '/api/auth/login', { username: cred.username, password: cred.password, rememberMe: true });
  if (r.status !== 200) {
    lastLoginError = `HTTP ${r.status} ${r.text.slice(0, 120)}`;
    if (r.status === 401 || r.status === 403) loginBlockedUntil = Date.now() + 600e3;
    throw new Error(`UDM login failed: ${lastLoginError}`);
  }
  const tok = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('TOKEN='));
  if (!tok) throw new Error('UDM login returned no TOKEN cookie');
  udmCookie = tok;
  udmCsrf = r.headers['x-csrf-token'] || null;
  try { udmCsrf = udmCsrf || JSON.parse(Buffer.from(tok.slice(6).split('.')[1], 'base64url').toString()).csrfToken; } catch {}
  udmUntil = Date.now() + 6 * 3600e3;
  lastLoginError = null;
  log('UDM login ok as', cred.username);
}

async function udm(method, p, body) {
  if (!udmCookie || Date.now() > udmUntil) await udmLogin();
  const go = () => udmRaw(method, p, body, { Cookie: udmCookie, ...(udmCsrf ? { 'X-CSRF-Token': udmCsrf } : {}) });
  let r = await go();
  if (r.status === 401) { udmCookie = null; await udmLogin(); r = await go(); }
  if (r.headers['x-updated-csrf-token']) udmCsrf = r.headers['x-updated-csrf-token'];
  let json = null;
  try { json = JSON.parse(r.text); } catch {}
  if (r.status >= 400) {
    const msg = json?.meta?.msg || json?.message || json?.errorCode || r.text.slice(0, 300);
    const e = new Error(`UDM ${method} ${p} → HTTP ${r.status}: ${msg}`);
    e.status = r.status;
    throw e;
  }
  if (json && json.meta && json.meta.rc && json.meta.rc !== 'ok') throw new Error(`UDM ${method} ${p}: ${json.meta.msg || json.meta.rc}`);
  return json && Array.isArray(json.data) && json.meta ? json.data : json ?? r.text;
}

// ---------------------------------------------------------------- tools
const MAC = { type: 'string', description: 'Client or device MAC address, e.g. aa:bb:cc:dd:ee:ff' };
const normMac = (m) => {
  const s = String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (s.length !== 12) throw new Error(`Not a MAC address: ${m}`);
  return s.match(/../g).join(':');
};
const READ_PREFIXES = [`${NET}/stat/`, `${NET}/rest/`, `${NET}/list/`, `${NET2}/`];
const READ_DENY = [/\/rest\/(admin|setting)/i, /\/stat\/(admin|sysinfo|ccode)/i, /\/cmd\//i, /backup/i, /\/list\/admin/i, /\/(admins?|users?\/self|api-?keys?|settings?)(\/|$|\?)/i];

const PF_FIELDS = ['name', 'enabled', 'proto', 'dst_port', 'fwd', 'fwd_port', 'src', 'log', 'pfwd_interface', 'destination_ip', 'src_limiting_enabled', 'src_limiting_type', 'src_firewall_group_id'];
const pickPf = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => PF_FIELDS.includes(k)));

async function firewallApi() {
  // Both endpoints answer 200 on Network 10.x; zones only exist once the zone-based firewall is on.
  try {
    const z = await udm('GET', `${NET2}/firewall/zone`);
    return (Array.isArray(z) ? z.length : Array.isArray(z?.data) ? z.data.length : 0) ? 'policies' : 'rules';
  } catch (e) { if (e.status === 404) return 'rules'; throw e; }
}

function slimClient(c) {
  return {
    mac: c.mac, name: c.name || c.hostname || null, hostname: c.hostname, ip: c.ip || c.last_ip, fixed_ip: c.use_fixedip ? c.fixed_ip : undefined,
    network: c.network || c.last_connection_network_name, ssid: c.essid, wired: c.is_wired, blocked: c.blocked || undefined,
    oui: c.oui, uptime_s: c.uptime, last_seen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : undefined,
    signal: c.signal, ap_mac: c.ap_mac, sw_port: c.sw_port, note: c.note || undefined, user_id: c.user_id || c._id,
  };
}
function slimDevice(d) {
  return {
    mac: d.mac, name: d.name, model: d.model, type: d.type, ip: d.ip, version: d.version, state: d.state === 1 ? 'online' : d.state,
    uptime_s: d.uptime, clients: d.num_sta, upgradable: d.upgradable || undefined, id: d._id,
  };
}

const TOOLS = [
  // ---------- read
  { name: 'unifi_health', description: 'Overall network health: WAN, LAN, WLAN, VPN subsystems with status and counts.', write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async () => redact(await udm('GET', `${NET}/stat/health`)) },
  { name: 'unifi_list_clients', description: 'List network clients. Online clients by default; include_offline adds every known client. Optional search filters by name, hostname, IP, MAC or vendor.', write: false,
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, include_offline: { type: 'boolean' } } },
    run: async ({ search, include_offline }) => {
      let list = (await udm('GET', `${NET}/stat/sta`)).map(slimClient);
      if (include_offline) {
        const online = new Set(list.map((c) => c.mac));
        const known = (await udm('GET', `${NET}/rest/user`)).filter((u) => !online.has(u.mac)).map((u) => ({ ...slimClient(u), online: false }));
        list = list.map((c) => ({ ...c, online: true })).concat(known);
      }
      if (search) { const q = String(search).toLowerCase(); list = list.filter((c) => JSON.stringify(c).toLowerCase().includes(q)); }
      return { count: list.length, clients: list };
    } },
  { name: 'unifi_list_devices', description: 'List UniFi devices (gateway, switches, access points) with model, IP, firmware, state and client count.', write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await udm('GET', `${NET}/stat/device`)).map(slimDevice) },
  { name: 'unifi_list_port_forwards', description: 'List port-forwarding rules.', write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async () => redact(await udm('GET', `${NET}/rest/portforward`)) },
  { name: 'unifi_list_firewall', description: 'List firewall policies (zone-based firewall) or legacy firewall rules, whichever this controller uses, plus firewall groups.', write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const api = await firewallApi();
      const rules = api === 'policies' ? await udm('GET', `${NET2}/firewall-policies`) : await udm('GET', `${NET}/rest/firewallrule`);
      const groups = await udm('GET', `${NET}/rest/firewallgroup`).catch(() => []);
      const zones = api === 'policies' ? await udm('GET', `${NET2}/firewall/zone`).catch(() => []) : undefined;
      return redact({ api, rules, groups, zones });
    } },
  { name: 'unifi_list_networks', description: 'List networks/VLANs and Wi-Fi networks (passphrases redacted).', write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async () => redact({ networks: await udm('GET', `${NET}/rest/networkconf`), wifi: await udm('GET', `${NET}/rest/wlanconf`) }) },
  { name: 'unifi_get', description: `Read-only GET of any UniFi Network or Protect API path, for things the other tools do not cover (e.g. ${NET}/rest/routing, ${NET}/rest/dynamicdns, ${NET2}/trafficrules). Path must start with ${READ_PREFIXES.join(', ')}. Secrets are redacted.`, write: false,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path: p }) => {
      p = String(p || '');
      // Plain paths only: encoded characters, backslashes, empty or dot segments could slip past the checks below.
      const plain = /^\/[A-Za-z0-9/_.\-?=&]*$/.test(p) && !p.includes('//') && !/(^|\/)\.\.?(\/|$|\?)/.test(p);
      if (!plain || !READ_PREFIXES.some((x) => p.startsWith(x)) || READ_DENY.some((r) => r.test(p))) throw new Error(`Path not allowed. Use a plain path (no %, //, ..) under: ${READ_PREFIXES.join(', ')}`);
      return redact(await udm('GET', p));
    } },

  // ---------- write
  { name: 'unifi_port_forward_create', description: 'Create a port-forwarding rule. Required: name, dst_port (external port or range), fwd (internal IP), fwd_port. proto is tcp_udp (default), tcp or udp. src limits the source (default any).', write: true,
    inputSchema: { type: 'object', required: ['name', 'dst_port', 'fwd', 'fwd_port'], properties: {
      name: { type: 'string' }, dst_port: { type: 'string' }, fwd: { type: 'string', description: 'Internal IP' }, fwd_port: { type: 'string' },
      proto: { type: 'string', enum: ['tcp_udp', 'tcp', 'udp'] }, enabled: { type: 'boolean' }, src: { type: 'string' }, log: { type: 'boolean' } } },
    run: async (a) => {
      const body = { enabled: true, proto: 'tcp_udp', src: 'any', log: false, pfwd_interface: 'wan', destination_ip: 'any', ...pickPf(a) };
      body.dst_port = String(body.dst_port); body.fwd_port = String(body.fwd_port);
      return await udm('POST', `${NET}/rest/portforward`, body);
    } },
  { name: 'unifi_port_forward_update', description: 'Change fields of a port-forwarding rule by id (name, enabled, proto, dst_port, fwd, fwd_port, src, log).', write: true,
    inputSchema: { type: 'object', required: ['id', 'changes'], properties: { id: { type: 'string' }, changes: { type: 'object' } } },
    run: async ({ id, changes }) => {
      const cur = (await udm('GET', `${NET}/rest/portforward`)).find((r) => r._id === id);
      if (!cur) throw new Error(`No port forward with id ${id}`);
      return await udm('PUT', `${NET}/rest/portforward/${encodeURIComponent(id)}`, { ...cur, ...pickPf(changes) });
    } },
  { name: 'unifi_port_forward_delete', description: 'Delete a port-forwarding rule by id.', write: true, destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    run: async ({ id }) => { await udm('DELETE', `${NET}/rest/portforward/${encodeURIComponent(id)}`); return { deleted: id }; } },
  { name: 'unifi_client_block', description: 'Block a client from the network by MAC.', write: true, destructive: true,
    inputSchema: { type: 'object', required: ['mac'], properties: { mac: MAC } },
    run: async ({ mac }) => udm('POST', `${NET}/cmd/stamgr`, { cmd: 'block-sta', mac: normMac(mac) }) },
  { name: 'unifi_client_unblock', description: 'Unblock a previously blocked client by MAC.', write: true,
    inputSchema: { type: 'object', required: ['mac'], properties: { mac: MAC } },
    run: async ({ mac }) => udm('POST', `${NET}/cmd/stamgr`, { cmd: 'unblock-sta', mac: normMac(mac) }) },
  { name: 'unifi_client_reconnect', description: 'Disconnect a wireless client so it reconnects (kick).', write: true,
    inputSchema: { type: 'object', required: ['mac'], properties: { mac: MAC } },
    run: async ({ mac }) => udm('POST', `${NET}/cmd/stamgr`, { cmd: 'kick-sta', mac: normMac(mac) }) },
  { name: 'unifi_client_update', description: 'Set a known client\'s alias name, note, or fixed IP (fixed_ip: "" removes the reservation). network_id is required by UniFi when setting a fixed IP; it defaults to the client\'s current network.', write: true,
    inputSchema: { type: 'object', required: ['mac'], properties: { mac: MAC, name: { type: 'string' }, note: { type: 'string' }, fixed_ip: { type: 'string' }, network_id: { type: 'string' } } },
    run: async ({ mac, name, note, fixed_ip, network_id }) => {
      mac = normMac(mac);
      const u = (await udm('GET', `${NET}/rest/user`)).find((x) => x.mac === mac);
      if (!u) throw new Error(`No known client with MAC ${mac}`);
      const ch = {};
      if (name !== undefined) ch.name = name;
      if (note !== undefined) { ch.note = note; ch.noted = !!note; }
      if (fixed_ip !== undefined) {
        if (fixed_ip === '') ch.use_fixedip = false;
        else { ch.use_fixedip = true; ch.fixed_ip = fixed_ip; ch.network_id = network_id || u.network_id || u.last_connection_network_id; }
      }
      if (!Object.keys(ch).length) throw new Error('Nothing to change');
      return slimClient((await udm('PUT', `${NET}/rest/user/${u._id}`, ch))[0] || { ...u, ...ch });
    } },
  { name: 'unifi_device_restart', description: 'Restart a UniFi switch or access point by MAC. Refuses the gateway itself (that would cut this connection).', write: true, destructive: true,
    inputSchema: { type: 'object', required: ['mac'], properties: { mac: MAC } },
    run: async ({ mac }) => {
      mac = normMac(mac);
      const d = (await udm('GET', `${NET}/stat/device`)).find((x) => x.mac === mac);
      if (!d) throw new Error(`No UniFi device with MAC ${mac}`);
      if (['udm', 'ugw', 'uxg'].includes(d.type)) throw new Error('Refusing to restart the gateway from here.');
      return udm('POST', `${NET}/cmd/devmgr`, { cmd: 'restart', mac });
    } },
  { name: 'unifi_firewall_upsert', description: 'Create (no id) or update (with id) a firewall policy (zone-based firewall) or legacy firewall rule — use unifi_list_firewall first to see the format this controller uses, and copy an existing entry\'s shape. For updates, only the given fields change.', write: true,
    inputSchema: { type: 'object', required: ['rule'], properties: { id: { type: 'string' }, rule: { type: 'object' } } },
    run: async ({ id, rule }) => {
      const api = await firewallApi();
      const base = api === 'policies' ? `${NET2}/firewall-policies` : `${NET}/rest/firewallrule`;
      if (!id) return udm('POST', base, rule);
      const cur = (await udm('GET', base)).find((r) => r._id === id || r.id === id);
      if (!cur) throw new Error(`No firewall ${api === 'policies' ? 'policy' : 'rule'} with id ${id}`);
      if (cur.predefined) throw new Error('Built-in policies cannot be changed here.');
      return udm('PUT', `${base}/${encodeURIComponent(id)}`, { ...cur, ...rule });
    } },
  { name: 'unifi_firewall_delete', description: 'Delete a firewall policy or legacy rule by id.', write: true, destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    run: async ({ id }) => {
      const api = await firewallApi();
      if (api === 'policies') await udm('POST', `${NET2}/firewall-policies/batch-delete`, [id]);
      else await udm('DELETE', `${NET}/rest/firewallrule/${encodeURIComponent(id)}`);
      return { deleted: id, api };
    } },
];
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------- MCP
async function mcpHandle(msg, who) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid request');
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize': {
      const v = MCP_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : MCP_VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'alpaca-unifi', title: 'Alpaca UniFi (UDM Pro)', version: '1.0.0' },
        instructions: 'Tools for the Alpaca Playhouse UniFi Dream Machine Pro network. Read tools are safe. Write tools change the live home network: say what you will change and confirm with the user before calling one, and prefer the smallest change. Use unifi_list_* before updating or deleting so ids are real.' });
    }
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.write, destructiveHint: !!t.destructive, idempotentHint: !t.write, openWorldHint: false } })) });
    case 'tools/call': {
      const t = TOOL_MAP.get(params?.name);
      if (!t) return err(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      try {
        const out = await t.run(args);
        if (t.write) audit({ who, tool: t.name, args, ok: true });
        return ok({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
      } catch (e) {
        if (t.write) audit({ who, tool: t.name, args, ok: false, error: e.message });
        log('tool error', t.name, e.message);
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    default: return err(-32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------- OAuth
const codes = new Map(); // hash(code) -> {client, redirect, challenge, resource, until}
let authFailures = [];

function authorizePage(q, client, error) {
  const name = esc(client?.n || new URL(q.get('redirect_uri')).host);
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'response_type']
    .map((k) => q.get(k) != null ? `<input type="hidden" name="${k}" value="${esc(q.get(k))}">` : '').join('');
  const css = 'body{font:16px system-ui,sans-serif;background:#f6f5f2;color:#222;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}main{background:#fff;border-radius:14px;padding:28px;max-width:380px;width:100%;box-shadow:0 2px 12px #0001}h1{font-size:20px;margin:.2em 0}.host{color:#666;font-size:14px;margin-top:0}.warn{font-size:14px;background:#fff6e0;border-radius:8px;padding:10px}label{display:block;font-weight:600;margin:16px 0 6px}input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#2a6;color:#fff;font-size:16px;font-weight:600;cursor:pointer}.err{color:#b00;font-size:14px}';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${name} · Alpaca UniFi</title><style>${css}</style><main><p>Alpaca UniFi</p><h1>Connect ${name}</h1><p class="host">${esc(new URL(q.get('redirect_uri')).host)}</p><p class="warn">This gives the app read and write access to the home network (clients, port forwards, firewall).</p><form method="post"><label for="key">Bridge key</label><input id="key" name="key" type="password" autocomplete="off" required autofocus>${error ? `<p class="err">${esc(error)}</p>` : ''}${hidden}<button>Allow</button></form></main></html>`;
}

function clientFromId(id) {
  if (typeof id !== 'string' || !id.startsWith('c_')) return null;
  const s = id.slice(2), i = s.lastIndexOf('.');
  if (i < 1 || !safeEq(hmac('client:' + s.slice(0, i)), s.slice(i + 1))) return null;
  try {
    const c = JSON.parse(Buffer.from(s.slice(0, i), 'base64url').toString());
    return Array.isArray(c.u) && c.u.every(redirectAllowed) ? c : null;
  } catch { return null; }
}

// Client ID Metadata Documents (CIMD): the client_id is an https URL serving the client's own metadata,
// which is what claude.ai's default "Use Claude's published identity" option sends.
const cimdCache = new Map();
async function getClient(id) {
  const reg = clientFromId(id);
  if (reg) return reg;
  let u;
  try { u = new URL(id); } catch { return null; }
  // Only Claude's own hosts: redirects are limited to Claude callbacks anyway, and this keeps ALPUCA
  // from fetching arbitrary (possibly internal) URLs on a stranger's behalf.
  const hostOk = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/.test(u.hostname);
  if (u.protocol !== 'https:' || !hostOk || u.port || u.username || u.password || u.hash || u.pathname === '/') return null;
  const hit = cimdCache.get(id);
  if (hit && hit.until > Date.now()) return hit.c;
  try {
    const r = await fetch(id, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    if (!r.ok || text.length > 16384) return null;
    const d = JSON.parse(text);
    const uris = d.redirect_uris;
    if (d.client_id !== id || !Array.isArray(uris) || !uris.length || !uris.every((x) => typeof x === 'string' && redirectAllowed(x))) return null;
    const c = { u: uris, n: typeof d.client_name === 'string' ? d.client_name.slice(0, 60) : u.host };
    cimdCache.set(id, { c, until: Date.now() + 3600e3 });
    return c;
  } catch (e) { log('cimd fetch failed', u.host, e.message); return null; }
}

async function checkAuthRequest(q) {
  const client = await getClient(q.get('client_id'));
  if (!client) throw Object.assign(new Error('invalid_client'), { status: 400 });
  if (q.get('response_type') !== 'code' || !client.u.includes(q.get('redirect_uri')) || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') || ''))
    throw Object.assign(new Error('invalid_request'), { status: 400 });
  return client;
}

function issueTokens(client, resource) {
  const now = Date.now();
  return {
    access_token: 'umo_' + sign({ k: 'access', c: client, r: resource, exp: now + ACCESS_TTL, n: crypto.randomUUID() }),
    token_type: 'Bearer', expires_in: ACCESS_TTL / 1000,
    refresh_token: 'umr_' + sign({ k: 'refresh', c: client, r: resource, exp: now + REFRESH_TTL, n: crypto.randomUUID() }),
    scope: 'unifi',
  };
}

function bearerOk(req) {
  const tok = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]?.trim();
  if (!tok) return null;
  if (safeEq(tok, OWNER_KEY)) return 'owner-key';
  if (tok.startsWith('umo_')) { const o = verify(tok.slice(4), 'access'); if (o) return 'oauth:' + o.c; }
  return null;
}

// ---------------------------------------------------------------- HTTP
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
function parseForm(req, text) {
  if ((req.headers['content-type'] || '').includes('application/json')) { try { return new URLSearchParams(Object.entries(JSON.parse(text || '{}')).map(([k, v]) => [k, String(v)])); } catch { return new URLSearchParams(); } }
  return new URLSearchParams(text);
}
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', CORS);
    if (p === '/health') return send(res, 200, { ok: true, udm_session: !!udmCookie && Date.now() < udmUntil, udm_login_failing: !!lastLoginError });

    if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')
      return send(res, 200, { resource: PUBLIC_URL + '/mcp', authorization_servers: [PUBLIC_URL], scopes_supported: ['unifi'], bearer_methods_supported: ['header'], resource_name: 'Alpaca UniFi' }, CORS);
    if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')
      return send(res, 200, { issuer: PUBLIC_URL, authorization_endpoint: PUBLIC_URL + '/authorize', token_endpoint: PUBLIC_URL + '/token', registration_endpoint: PUBLIC_URL + '/register',
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['unifi'], authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true }, CORS);

    if (p === '/register' && req.method === 'POST') {
      let b; try { b = JSON.parse(await readBody(req, 8192)); } catch { return send(res, 400, { error: 'invalid_client_metadata' }, CORS); }
      const uris = b.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 4 || !uris.every((u) => typeof u === 'string' && redirectAllowed(u)))
        return send(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uri not allowed' }, CORS);
      if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none') return send(res, 400, { error: 'invalid_client_metadata' }, CORS);
      const n = typeof b.client_name === 'string' ? b.client_name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60) : undefined;
      const payload = b64url(JSON.stringify({ u: uris, n }));
      return send(res, 201, { client_id: `c_${payload}.${hmac('client:' + payload)}`, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: uris,
        ...(n ? { client_name: n } : {}), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, CORS);
    }

    if (p === '/authorize' && (req.method === 'GET' || req.method === 'POST')) {
      const q = req.method === 'GET' ? url.searchParams : new URLSearchParams(await readBody(req, 16384));
      let client;
      try { client = await checkAuthRequest(q); } catch (e) { return send(res, 400, `<p>Invalid authorization request (${esc(e.message)}).</p>`); }
      const csp = { 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(q.get('redirect_uri')).origin}; frame-ancestors 'none'; base-uri 'none'`, 'X-Frame-Options': 'DENY' };
      if (req.method === 'GET') return send(res, 200, authorizePage(q, client), csp);
      authFailures = authFailures.filter((t) => t > Date.now() - 900e3);
      if (authFailures.length >= 10) return send(res, 429, authorizePage(q, client, 'Too many wrong keys. Try again in 15 minutes.'), csp);
      if (!safeEq((q.get('key') || '').trim(), OWNER_KEY)) { authFailures.push(Date.now()); log('authorize: wrong key'); return send(res, 401, authorizePage(q, client, 'Wrong bridge key'), csp); }
      const code = crypto.randomBytes(32).toString('base64url');
      for (const [k, v] of codes) if (v.until < Date.now()) codes.delete(k);
      codes.set(sha256(code).toString('hex'), { client: q.get('client_id'), redirect: q.get('redirect_uri'), challenge: q.get('code_challenge'), resource: q.get('resource') || PUBLIC_URL + '/mcp', until: Date.now() + CODE_TTL });
      const target = new URL(q.get('redirect_uri'));
      target.searchParams.set('code', code);
      if (q.get('state') != null) target.searchParams.set('state', q.get('state'));
      target.searchParams.set('iss', PUBLIC_URL);
      log('authorize: approved', client.n || target.host);
      return send(res, 303, '', { Location: target.toString() });
    }

    if (p === '/token' && req.method === 'POST') {
      const b = parseForm(req, await readBody(req, 8192));
      const fail = (e = 'invalid_grant') => send(res, 400, { error: e }, CORS);
      if (b.get('grant_type') === 'refresh_token') {
        const o = verify((b.get('refresh_token') || '').replace(/^umr_/, ''), 'refresh');
        if (!o || o.c !== b.get('client_id') || !(await getClient(o.c))) return fail();
        return send(res, 200, issueTokens(o.c, o.r), CORS);
      }
      if (b.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type');
      const key = sha256(b.get('code') || '').toString('hex'), c = codes.get(key);
      const verifier = b.get('code_verifier') || '';
      if (!c || c.until < Date.now() || c.client !== b.get('client_id') || c.redirect !== b.get('redirect_uri') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return fail();
      if (b64url(sha256(verifier)) !== c.challenge) return fail();
      codes.delete(key);
      return send(res, 200, issueTokens(c.client, c.resource), CORS);
    }

    if (p === '/mcp') {
      const who = bearerOk(req);
      if (!who) return send(res, 401, { error: 'unauthorized' }, { ...CORS, 'WWW-Authenticate': `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"` });
      if (req.method === 'GET') return send(res, 405, { error: 'SSE stream not offered; POST JSON-RPC instead' }, { ...CORS, Allow: 'POST' });
      if (req.method === 'DELETE') return send(res, 204, '', CORS);
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, CORS);
      let msg; try { msg = JSON.parse(await readBody(req)); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, CORS); }
      const sid = req.headers['mcp-session-id'] || crypto.randomUUID();
      const out = Array.isArray(msg) ? (await Promise.all(msg.map((m) => mcpHandle(m, who)))).filter(Boolean) : await mcpHandle(msg, who);
      if (out === null || (Array.isArray(out) && !out.length)) return send(res, 202, '', { ...CORS, 'Mcp-Session-Id': sid });
      return send(res, 200, out, { ...CORS, 'Mcp-Session-Id': sid });
    }

    if (p === '/') return send(res, 200, '<p>Alpaca UniFi MCP bridge. Add <code>' + esc(PUBLIC_URL) + '/mcp</code> as a custom connector.</p>');
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', p, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
  }
});

server.listen(PORT, BIND, () => log(`unifi-mcp listening on ${BIND}:${PORT}, public ${PUBLIC_URL}`));
