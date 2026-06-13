/**
 * Gemini Cost Sync Edge Function
 *
 * Pulls per-model Gemini (Generative Language API) token usage from Google
 * Cloud Monitoring for every billed GCP project, computes estimated cost, and
 * upserts daily rows into `gemini_usage_daily`.
 *
 * Why Cloud Monitoring (not app-side logging): the AlpacApps Gemini spend is
 * fragmented across multiple API keys/projects (edge functions, the OpenClaw /
 * agent workers, dev tooling). Monitoring already records token counts for ALL
 * of them with zero app changes, so this catches 100% of usage.
 *
 * Auth: a GCP service account (alpacapps-automation@aiclaw-486101) with
 * roles/monitoring.viewer on each project. Its key JSON is stored base64 in the
 * Supabase secret GCP_MONITORING_SA_KEY_B64.
 *
 * Trigger: daily via pg_cron (see migration), or manually with
 *   POST { "days": N }   — re-syncs the last N UTC days (default 3, max 60).
 *
 * Deploy with: supabase functions deploy gemini-cost-sync
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "../_shared/api-helpers.ts";

// ─── Projects billed for Gemini (rolled up under AlpacAppsBill) ──────
const PROJECTS = [
  "gen-lang-client-0847727434", // main edge-function key (SponicGardensGen)
  "aiclaw-486101",              // OpenClaw / agent workers (alpaca-mar19, OpenClaw key)
  "gen-lang-client-0541772148", // image gen (ClaudeImage / FINLEG GCS AI)
  "gen-lang-client-0323600525",
  "finleg",
];

// ─── Pricing per model, USD per 1M tokens (paid tier; update as needed) ──
// out = output tokens (incl. image/audio output, which bill as output tokens)
const PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "gemini-2.5-flash-tts": { in: 0.50, out: 10.0 },
  "gemini-2.5-flash-image": { in: 0.30, out: 30.0 },
  "gemini-2.5-flash-preview-image": { in: 0.30, out: 30.0 },
  "gemini-2.5-pro": { in: 1.25, out: 10.0 },
  "gemini-2.0-flash": { in: 0.10, out: 0.40 },
  "gemini-3.5-flash": { in: 0.30, out: 2.50 },
  "gemini-3.1-pro": { in: 1.25, out: 10.0 },
  "gemini-3.1-flash-lite": { in: 0.10, out: 0.40 },
  "gemini-3-flash-live": { in: 0.50, out: 2.0 },
  "antigravity": { in: 0.30, out: 2.50 },
};
const DEFAULT_PRICE = { in: 0.30, out: 2.50 };

const MONITORING = "https://monitoring.googleapis.com/v3";
const OUTPUT_METRIC = "generativelanguage.googleapis.com/generate_content_usage_output_token_count";
const INPUT_METRICS = [
  "generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage",
  "generativelanguage.googleapis.com/quota/generate_content_paid_tier_2_input_token_count/usage",
  "generativelanguage.googleapis.com/quota/generate_content_paid_tier_3_input_token_count/usage",
];

// ─── base64url helpers ──────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Mint a Google OAuth access token from the service-account key ───
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/monitoring.read",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = `${header}.${claims}`;

  // import PKCS8 private key
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput),
  ));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const resp = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await resp.json();
  if (!json.access_token) throw new Error("token exchange failed: " + JSON.stringify(json));
  return json.access_token;
}

// ─── Query one metric for one project/day; returns { model: tokens } ─
async function fetchMetric(
  token: string, project: string, metric: string, startISO: string, endISO: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      "filter": `metric.type="${metric}"`,
      "interval.startTime": startISO,
      "interval.endTime": endISO,
      "aggregation.alignmentPeriod": "86400s",
      "aggregation.perSeriesAligner": "ALIGN_SUM",
      "aggregation.crossSeriesReducer": "REDUCE_SUM",
      "aggregation.groupByFields": "metric.label.model",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await fetch(`${MONITORING}/projects/${project}/timeSeries?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    if (j.error) {
      // Metric not present on this project (e.g. tier not used) → skip quietly
      if (j.error.code === 404 || j.error.code === 400) return out;
      throw new Error(`monitoring ${project} ${metric}: ${j.error.message}`);
    }
    for (const s of j.timeSeries || []) {
      const model = s.metric?.labels?.model || "(unknown)";
      let sum = 0;
      for (const p of s.points || []) {
        sum += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0);
      }
      out[model] = (out[model] || 0) + sum;
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

function nextDay(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };

  try {
    const b64 = Deno.env.get("GCP_MONITORING_SA_KEY_B64");
    if (!b64) throw new Error("GCP_MONITORING_SA_KEY_B64 not set");
    const sa = JSON.parse(atob(b64));

    let days = 3;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && Number.isFinite(body.days)) days = body.days;
      } catch { /* empty body ok */ }
    } else {
      const q = new URL(req.url).searchParams.get("days");
      if (q) days = Number(q);
    }
    days = Math.max(1, Math.min(60, Math.floor(days)));

    const token = await getAccessToken(sa);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Build list of UTC day strings to sync (oldest → newest, incl. today)
    const dayList: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dayList.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }

    const rows: any[] = [];
    let totalCost = 0;
    for (const project of PROJECTS) {
      for (const day of dayList) {
        const start = `${day}T00:00:00Z`;
        const end = `${nextDay(day)}T00:00:00Z`;
        const outTok = await fetchMetric(token, project, OUTPUT_METRIC, start, end);
        const inTok: Record<string, number> = {};
        for (const m of INPUT_METRICS) {
          const r = await fetchMetric(token, project, m, start, end);
          for (const [model, v] of Object.entries(r)) inTok[model] = (inTok[model] || 0) + v;
        }
        const models = new Set([...Object.keys(outTok), ...Object.keys(inTok)]);
        for (const model of models) {
          const input = Math.round(inTok[model] || 0);
          const output = Math.round(outTok[model] || 0);
          if (input === 0 && output === 0) continue;
          const price = PRICING[model] || DEFAULT_PRICE;
          const cost = (input * price.in + output * price.out) / 1_000_000;
          totalCost += cost;
          rows.push({
            usage_date: day,
            gcp_project: project,
            model,
            input_tokens: input,
            output_tokens: output,
            estimated_cost_usd: Number(cost.toFixed(4)),
          });
        }
      }
    }

    if (rows.length) {
      const { error } = await supabase
        .from("gemini_usage_daily")
        .upsert(rows, { onConflict: "usage_date,gcp_project,model" });
      if (error) throw new Error("upsert: " + error.message);
    }

    return new Response(JSON.stringify({
      success: true,
      days_synced: dayList,
      rows_upserted: rows.length,
      estimated_cost_usd: Number(totalCost.toFixed(2)),
    }), { headers: cors });
  } catch (e) {
    console.error("gemini-cost-sync error:", e);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }),
      { status: 500, headers: cors });
  }
});
