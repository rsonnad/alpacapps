// Smoke test against a running Worker:  node smoke-test.mjs http://localhost:8787 [ADMIN_TOKEN]
// (start it with: npm run db:local && npx wrangler dev --var ADMIN_TOKEN:dev-admin-token)
import assert from "node:assert/strict";

const base = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const admin = process.argv[3] || "dev-admin-token";
const installId = crypto.randomUUID();
const key = crypto.randomUUID() + crypto.randomUUID(); // 72 random-ish characters; apps use a CSPRNG
const app = { "x-install-id": installId, authorization: `Bearer ${key}`, "content-type": "application/json" };
// A 1x1 PNG.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const call = async (method, path, headers, body) => {
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, body: type.includes("json") ? await r.json() : await r.arrayBuffer() };
};

const issue = {
  client_issue_id: 1,
  kind: "bug",
  description: "The Save button does nothing on the settings screen.",
  created_at: Date.now(),
  context: { app_version: "1.2.3", build_type: "release", device_model: "Pixel 9", os_name: "android", os_version: "16", screen: "Settings" },
  log: [{ at: Date.now(), level: "E", tag: "Settings", msg: "save failed: timeout" }],
  images: [{ mime: "image/png", data_base64: png }],
};

let r = await call("GET", "/health");
assert.equal(r.status, 200);

r = await call("POST", "/v1/issues", app, issue);
assert.equal(r.status, 201, JSON.stringify(r.body));
const id = r.body.id;

r = await call("POST", "/v1/issues", app, issue);
assert.equal(r.status, 200);
assert.equal(r.body.duplicate, true);
assert.equal(r.body.id, id);

r = await call("POST", "/v1/issues", { ...app, authorization: "Bearer " + "x".repeat(40) }, { ...issue, client_issue_id: 2 });
assert.equal(r.status, 401, "a different key for the same install is refused");

r = await call("POST", "/v1/issues", app, { ...issue, client_issue_id: 3, kind: "complaint" });
assert.equal(r.status, 400);

r = await call("POST", "/v1/issues", app, { ...issue, client_issue_id: 4, kind: "feature", description: "Dark mode, please.", images: [] });
assert.equal(r.status, 201);

r = await call("GET", "/v1/admin/issues", { authorization: "Bearer wrong" });
assert.equal(r.status, 401);

const team = { authorization: `Bearer ${admin}`, "content-type": "application/json" };
r = await call("GET", "/v1/admin/issues?limit=10", team);
assert.equal(r.status, 200);
assert.ok(r.body.issues.some((i) => i.id === id));

r = await call("GET", `/v1/admin/issues/${id}/images/1`, team);
assert.equal(r.status, 200);
assert.equal(r.body.byteLength, Buffer.from(png, "base64").length);

r = await call("PATCH", `/v1/admin/issues/${id}`, team, { status: "fixed", team_note: "Fixed in 1.2.4." });
assert.equal(r.status, 200);
assert.equal(r.body.status, "fixed");

r = await call("GET", "/v1/issues/updates?since=0", app);
assert.equal(r.status, 200);
assert.equal(r.body.updates.length, 1);
assert.equal(r.body.updates[0].team_note, "Fixed in 1.2.4.");

r = await call("GET", `/v1/issues/updates?since=${r.body.cursor}&since_id=${r.body.cursor_id}`, app);
assert.equal(r.body.updates.length, 0, "the cursor moves past what was already seen");

console.log("smoke test passed: issue", id);
