/**
 * wiz-watchdog — Cloudflare Worker, cron-triggered every 5 minutes.
 *
 * Why: WiZ bulbs frequently drop "unavailable" in Home Assistant. When a bulb
 * in a group (e.g. master_bathroom_lights) is unavailable, Alexa group commands
 * hang or partially fail. Symptom: "Alexa, turn off the master bath lights"
 * stops working until someone manually power-cycles bulbs or reloads HA.
 *
 * What: every 5 minutes, query HA for WiZ light entities in state=unavailable
 * and call homeassistant.reload_config_entry on each. HA then re-attempts the
 * bulb's setup. For transient network glitches this recovers the bulb within
 * ~30 seconds. For hard failures (bulb powered off, persistent network issue)
 * the metrics in Supabase show the pattern so the user can investigate.
 *
 * Secrets (set via `wrangler secret put`):
 *   HA_TOKEN                     — Home Assistant long-lived access token
 *   SUPABASE_SERVICE_ROLE_KEY    — for writing metrics to system_commands
 */

const HA_URL = "https://ha.alpacaplayhouse.com";
const SUPABASE_URL = "https://aphrrfprbixmhissnjfn.supabase.co";

async function haGET(path, token) {
  const r = await fetch(`${HA_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`HA GET ${path} → ${r.status}`);
  return r.json();
}

async function haPOST(path, token, body) {
  const r = await fetch(`${HA_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status };
}

async function logToSupabase(env, payload) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/system_commands`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // metrics-only; never block on a Supabase failure
  }
}

async function runWatchdog(env) {
  const startedAt = new Date().toISOString();
  const token = env.HA_TOKEN;
  if (!token) throw new Error("HA_TOKEN secret not set");

  const states = await haGET("/api/states", token);
  // WiZ entities all share the entity_id prefix `light.smart_*` on this install.
  const wiz = states.filter((e) => e.entity_id.startsWith("light.smart_"));
  const unavailable = wiz.filter((e) => e.state === "unavailable");

  const result = {
    started_at: startedAt,
    wiz_total: wiz.length,
    unavailable_count: unavailable.length,
    reloads_attempted: 0,
    reloads_failed: 0,
    unavailable_entities: unavailable.map((e) => e.entity_id),
    failures: [],
  };

  for (const e of unavailable) {
    const r = await haPOST(
      "/api/services/homeassistant/reload_config_entry",
      token,
      { entity_id: e.entity_id },
    );
    if (r.ok) {
      result.reloads_attempted++;
    } else {
      result.reloads_failed++;
      result.failures.push({ entity_id: e.entity_id, http_status: r.status });
    }
    // throttle so we don't slam HA
    await new Promise((res) => setTimeout(res, 250));
  }

  await logToSupabase(env, {
    target: "alpuca",
    command: "wiz_watchdog",
    requested_by: "cloudflare-worker-cron",
    status: "completed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    result,
  });

  return result;
}

export default {
  // Manual / debug invocation: visit the Worker URL to run on-demand
  async fetch(req, env) {
    try {
      const result = await runWatchdog(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(`ERROR: ${err.message}`, { status: 500 });
    }
  },

  // Cron trigger — see wrangler.toml [triggers] crons
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWatchdog(env));
  },
};
