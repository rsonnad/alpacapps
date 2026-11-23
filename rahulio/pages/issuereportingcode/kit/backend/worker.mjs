// Issue reporting kit: the backend, one Cloudflare Worker file + a D1 database.
// Derived from Bridgit's feedback service, slimmed down so anyone can copy and change it.
// MIT licence (see ../LICENSE).
//
// App routes (signed with the install's own key, trust on first use):
//   POST /v1/issues                      file a bug report or feature request (idempotent)
//   GET  /v1/issues/updates?since=&since_id=   what the team changed on this install's issues
// Team routes (Authorization: Bearer <ADMIN_TOKEN>):
//   GET   /v1/admin/issues?status=&limit=&before=   list issues, newest first
//   GET   /v1/admin/issues/:id                       one issue with context and log
//   GET   /v1/admin/issues/:id/images/:idx           a screenshot
//   PATCH /v1/admin/issues/:id   {status, team_note} change status / reply to the reporter
// Open:
//   GET /health

export const LIMITS = {
  BODY_BYTES: 10 * 1024 * 1024,   // whole request
  DESCRIPTION: 10_000,            // characters
  IMAGES: 5,
  IMAGE_BYTES: 1_500_000,         // the app sends <= 1 MB; D1 allows 2 MB per value
  JSON_FIELD: 200_000,            // context / log, serialized
  PER_INSTALL_PER_HOUR: 60,
  NEW_INSTALLS_PER_ADDRESS_PER_DAY: 20,
  NOTE: 1000,
  UPDATES_PAGE: 200,
};

export const KINDS = new Set(["bug", "feature"]);
export const STATUSES = new Set(["new", "seen", "in_progress", "fixed", "wont_fix", "duplicate"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: "internal", message: "Something went wrong." }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = request.method;

  if (p === "/health") return json({ ok: true });
  if (p === "/v1/issues" && m === "POST") return createIssue(request, env);
  if (p === "/v1/issues/updates" && m === "GET") return teamUpdates(request, url, env);

  if (p.startsWith("/v1/admin/")) {
    await requireAdmin(request, env);
    if (p === "/v1/admin/issues" && m === "GET") return listIssues(url, env);
    let mm;
    if ((mm = p.match(/^\/v1\/admin\/issues\/(\d+)$/))) {
      if (m === "GET") return getIssue(Number(mm[1]), env);
      if (m === "PATCH") return updateIssue(Number(mm[1]), request, env);
    }
    if ((mm = p.match(/^\/v1\/admin\/issues\/(\d+)\/images\/(\d+)$/)) && m === "GET") return getImage(Number(mm[1]), Number(mm[2]), env);
  }
  throw new HttpError(404, "not_found", "No such route.");
}

// ---- Helpers ------------------------------------------------------------------------------

async function readBody(request, cap = LIMITS.BODY_BYTES) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > cap) throw new HttpError(413, "payload_too_large", "The issue is over 10 MB.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > cap) throw new HttpError(413, "payload_too_large", "The issue is over 10 MB.");
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes) || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "invalid_json", "The body must be a JSON object.");
  }
}

const int = (v) => (Number.isSafeInteger(v) ? v : typeof v === "string" && /^-?\d{1,15}$/.test(v) ? Number(v) : null);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function jsonField(v, fallback) {
  const s = JSON.stringify(v ?? fallback);
  if (s.length > LIMITS.JSON_FIELD) throw new HttpError(413, "payload_too_large", "context or log is too large.");
  return s;
}

/** A time the device claims; ignored if it is in the future or more than a year old. */
const sensibleTime = (t, now) => (t !== null && t <= now + 60_000 && t > now - 365 * 86_400_000 ? t : now);

export function decodeImage(v, i) {
  const b64 = typeof v === "string" ? v : v?.data_base64;
  if (typeof b64 !== "string" || !b64.length) throw new HttpError(400, "invalid_parameter", `images[${i}] needs data_base64.`);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new HttpError(400, "invalid_parameter", `images[${i}] is not base64.`);
  }
  if (bin.length > LIMITS.IMAGE_BYTES) throw new HttpError(413, "payload_too_large", `images[${i}] is over 1.5 MB.`);
  const bytes = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
  const mime = v?.mime === "image/png" ? "image/png" : "image/jpeg";
  return { bytes, mime };
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two strings (compares their hashes). */
async function sameString(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** The caller's address as a keyed hash that changes every day; the address itself is never stored. */
async function addressHash(request, env, now) {
  const day = Math.floor(now / 86_400_000);
  return sha256Hex(`${env.ADMIN_TOKEN || ""}:${day}:${request.headers.get("cf-connecting-ip") || "unknown"}`);
}

async function requireAdmin(request, env) {
  const key = bearer(request);
  if (!env.ADMIN_TOKEN || !key || !(await sameString(key, env.ADMIN_TOKEN))) throw new HttpError(401, "unauthorized", "Team routes need Authorization: Bearer <ADMIN_TOKEN>.");
}

/**
 * Who is calling. The app sends X-Install-Id (a UUID it made once) and Authorization: Bearer <install key>
 * (32+ random characters it made once and keeps in secure storage). The first upload registers the pair;
 * after that the key must match. `deferRegister` returns the INSERT so it lands in the same transaction as
 * the first valid issue: a rejected issue leaves no install row behind.
 */
async function authInstall(request, env, now, { register = true, deferRegister = false } = {}) {
  const installId = (request.headers.get("x-install-id") || "").toLowerCase();
  const key = bearer(request);
  if (!UUID.test(installId) || key.length < 32 || key.length > 200)
    throw new HttpError(401, "unauthorized", "Send X-Install-Id (a UUID) and Authorization: Bearer <install key, 32+ characters>.");
  const hash = await sha256Hex(key);
  const row = await env.DB.prepare("SELECT key_hash, blocked FROM installs WHERE install_id = ?").bind(installId).first();
  if (row && !(await sameString(row.key_hash, hash))) throw new HttpError(401, "unauthorized", "Wrong key for this install.");
  if (row?.blocked) throw new HttpError(403, "install_blocked", "This install has been blocked.");
  if (row) return { installId };
  if (!register) throw new HttpError(401, "unauthorized", "Unknown install. Upload an issue first.");

  // A handful of new installs per address a day, so one machine can't mint thousands of identities.
  const ip = await addressHash(request, env, now);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM installs WHERE ip_hash = ? AND created_at > ?").bind(ip, now - 86_400_000).first();
  if ((recent?.n ?? 0) >= LIMITS.NEW_INSTALLS_PER_ADDRESS_PER_DAY) throw new HttpError(429, "rate_limited", "Too many new installs from this address today.");
  const insert = env.DB.prepare("INSERT OR IGNORE INTO installs (install_id, key_hash, created_at, last_seen_at, ip_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(installId, hash, now, now, ip);
  if (deferRegister) return { installId, register: { insert, hash } };
  await insert.run();
  const again = await env.DB.prepare("SELECT key_hash FROM installs WHERE install_id = ?").bind(installId).first();
  if (!again || !(await sameString(again.key_hash, hash))) throw new HttpError(401, "unauthorized", "Wrong key for this install.");
  return { installId };
}

// ---- App routes ---------------------------------------------------------------------------

async function createIssue(request, env) {
  const now = Date.now();
  const auth = await authInstall(request, env, now, { deferRegister: true });
  const { installId } = auth;
  const b = await readBody(request);

  const clientId = int(b.client_issue_id);
  if (clientId === null || clientId < 1) throw new HttpError(400, "invalid_parameter", "client_issue_id must be a positive integer.");

  // A retry of an issue we already have returns the same row (idempotent on install + client id).
  const existing = await env.DB.prepare("SELECT id FROM issues WHERE install_id = ? AND client_issue_id = ?").bind(installId, clientId).first();
  if (existing) return json({ id: existing.id, duplicate: true }, 200);

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM issues WHERE install_id = ? AND received_at > ?").bind(installId, now - 3_600_000).first();
  if ((recent?.n ?? 0) >= LIMITS.PER_INSTALL_PER_HOUR) throw new HttpError(429, "rate_limited", `At most ${LIMITS.PER_INSTALL_PER_HOUR} issues per hour from this install.`);

  const kind = b.kind === "feature_request" ? "feature" : b.kind;
  if (!KINDS.has(kind)) throw new HttpError(400, "invalid_parameter", "kind must be bug or feature.");
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!description) throw new HttpError(400, "invalid_parameter", "description is required.");
  if (description.length > LIMITS.DESCRIPTION) throw new HttpError(400, "invalid_parameter", "description is limited to 10,000 characters.");
  const images = Array.isArray(b.images) ? b.images : [];
  if (images.length > LIMITS.IMAGES) throw new HttpError(400, "invalid_parameter", `Up to ${LIMITS.IMAGES} images.`);
  const decoded = images.map(decodeImage);
  const ctx = b.context && typeof b.context === "object" && !Array.isArray(b.context) ? b.context : {};
  const log = Array.isArray(b.log) ? b.log : [];

  const insert = env.DB.prepare(
    `INSERT INTO issues (install_id, client_issue_id, kind, description, created_at, received_at,
       app_version, build_type, device_model, os_name, os_version, screen, context_json, log_json, image_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (install_id, client_issue_id) DO NOTHING`,
  ).bind(
    installId, clientId, kind, description, sensibleTime(int(b.created_at), now), now,
    str(ctx.app_version, 60), str(ctx.build_type, 20), str(ctx.device_model, 120), str(ctx.os_name, 20), str(ctx.os_version, 40),
    str(ctx.screen, 120), jsonField(ctx, {}), jsonField(log, []), decoded.length,
  );
  const sub = "(SELECT id FROM issues WHERE install_id = ? AND client_issue_id = ?)";
  const imageInserts = decoded.map((img, i) =>
    env.DB.prepare(`INSERT OR IGNORE INTO images (issue_id, idx, mime, size_bytes, bytes) VALUES (${sub}, ?, ?, ?, ?)`)
      .bind(installId, clientId, i + 1, img.mime, img.bytes.length, img.bytes),
  );
  const touch = env.DB.prepare("UPDATE installs SET last_seen_at = ?, app_version = ?, device_model = ?, os_version = ? WHERE install_id = ?")
    .bind(now, str(ctx.app_version, 60), str(ctx.device_model, 120), str(ctx.os_version, 40), installId);

  // One transaction: the install (first time), the issue and its screenshots land together or not at all.
  await env.DB.batch([...(auth.register ? [auth.register.insert] : []), insert, ...imageInserts, touch]);
  const row = await env.DB.prepare("SELECT id FROM issues WHERE install_id = ? AND client_issue_id = ?").bind(installId, clientId).first();

  if (auth.register) {
    // Trust on first use: if another key claimed this install id in a race, this issue isn't kept.
    const owner = await env.DB.prepare("SELECT key_hash FROM installs WHERE install_id = ?").bind(installId).first();
    if (!owner || !(await sameString(owner.key_hash, auth.register.hash))) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM images WHERE issue_id = ?").bind(row.id),
        env.DB.prepare("DELETE FROM issues WHERE id = ?").bind(row.id),
      ]);
      throw new HttpError(401, "unauthorized", "Wrong key for this install.");
    }
  }
  await notify(env, { id: row.id, kind, description, app_version: str(ctx.app_version, 60), device_model: str(ctx.device_model, 120) });
  return json({ id: row.id, duplicate: false }, 201);
}

/**
 * The app asks what the team changed on its own issues since its cursor (epoch ms, plus the last issue id
 * at that time, so a page that ends among same-time changes doesn't skip the rest).
 */
async function teamUpdates(request, url, env) {
  const { installId } = await authInstall(request, env, Date.now(), { register: false });
  const rawSince = url.searchParams.get("since") || "0";
  const since = /^\d{1,15}$/.test(rawSince) ? Number(rawSince) : NaN;
  if (Number.isNaN(since)) throw new HttpError(400, "invalid_parameter", "since must be epoch milliseconds (the last cursor).");
  const rawId = url.searchParams.get("since_id");
  const sinceId = rawId == null ? Number.MAX_SAFE_INTEGER : /^\d{1,15}$/.test(rawId) ? Number(rawId) : NaN;
  if (Number.isNaN(sinceId)) throw new HttpError(400, "invalid_parameter", "since_id must be the last cursor_id.");
  const { results } = await env.DB.prepare(
    `SELECT id, client_issue_id, status, team_note, team_updated_at FROM issues
     WHERE install_id = ? AND (team_updated_at > ? OR (team_updated_at = ? AND id > ?))
     ORDER BY team_updated_at, id LIMIT ${LIMITS.UPDATES_PAGE}`,
  ).bind(installId, since, since, sinceId).all();
  const last = results[results.length - 1];
  return json({
    updates: results,
    cursor: last ? last.team_updated_at : since,
    cursor_id: last ? last.id : rawId == null ? null : sinceId,
    more: results.length === LIMITS.UPDATES_PAGE,
  });
}

// ---- Team routes --------------------------------------------------------------------------

async function listIssues(url, env) {
  const status = url.searchParams.get("status");
  if (status && !STATUSES.has(status)) throw new HttpError(400, "invalid_parameter", `status must be one of ${[...STATUSES].join(", ")}.`);
  const limit = Math.min(Math.max(int(url.searchParams.get("limit")) ?? 50, 1), 200);
  const before = int(url.searchParams.get("before")) ?? Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare(
    `SELECT id, kind, status, substr(description, 1, 300) AS description, created_at, received_at, app_version,
            device_model, os_name, os_version, screen, image_count, team_note
     FROM issues WHERE id < ? ${status ? "AND status = ?" : ""} ORDER BY id DESC LIMIT ?`,
  ).bind(...[before, ...(status ? [status] : []), limit]).all();
  return json({ issues: results, next_before: results.length === limit ? results[results.length - 1].id : null });
}

async function getIssue(id, env) {
  const row = await env.DB.prepare("SELECT * FROM issues WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "not_found", `No issue ${id}.`);
  const { context_json, log_json, ...rest } = row;
  return json({ ...rest, context: JSON.parse(context_json), log: JSON.parse(log_json), images: Array.from({ length: row.image_count }, (_, i) => `/v1/admin/issues/${id}/images/${i + 1}`) });
}

async function getImage(id, idx, env) {
  const img = await env.DB.prepare("SELECT mime, bytes FROM images WHERE issue_id = ? AND idx = ?").bind(id, idx).first();
  if (!img) throw new HttpError(404, "not_found", "No such image.");
  return new Response(new Uint8Array(img.bytes), { headers: { "content-type": img.mime, "cache-control": "private, max-age=3600" } });
}

async function updateIssue(id, request, env) {
  const b = await readBody(request, 64 * 1024);
  const sets = [];
  const binds = [];
  if (b.status !== undefined) {
    if (!STATUSES.has(b.status)) throw new HttpError(400, "invalid_parameter", `status must be one of ${[...STATUSES].join(", ")}.`);
    sets.push("status = ?");
    binds.push(b.status);
  }
  if (b.team_note !== undefined) {
    if (b.team_note !== null && typeof b.team_note !== "string") throw new HttpError(400, "invalid_parameter", "team_note must be text or null.");
    sets.push("team_note = ?");
    binds.push(b.team_note === null ? null : b.team_note.trim().slice(0, LIMITS.NOTE) || null);
  }
  if (!sets.length) throw new HttpError(400, "invalid_parameter", "Send status and/or team_note.");
  const res = await env.DB.prepare(`UPDATE issues SET ${sets.join(", ")}, team_updated_at = ? WHERE id = ?`).bind(...binds, Date.now(), id).run();
  if (!res.meta?.changes) throw new HttpError(404, "not_found", `No issue ${id}.`);
  return getIssue(id, env);
}

// ---- Optional: tell the team -------------------------------------------------------------

/** Posts a one-line summary to NOTIFY_WEBHOOK_URL (Slack/Discord-style {text}) if set. Never blocks filing. */
async function notify(env, issue) {
  if (!env.NOTIFY_WEBHOOK_URL) return;
  const text = `New ${issue.kind} #${issue.id} (${issue.app_version || "?"}, ${issue.device_model || "?"}): ${issue.description.slice(0, 200)}`;
  try {
    await fetch(env.NOTIFY_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }) });
  } catch (e) {
    console.warn("notify failed", e);
  }
}
