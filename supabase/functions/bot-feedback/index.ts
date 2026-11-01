// Bot Feedback Edge Function
// Public endpoint for feedback and feature requests about the public bots.
// Bots POST JSON; the form at alpacaplayhouse.com/bots/feedback/ posts
// form-urlencoded. No sign-in. Stored in public.bot_feedback (service role).
// Deploy with --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Open CORS on purpose: bots call this from anywhere and it uses no cookies or
// sign-in. Same values as corsHeadersOpen in _shared/api-helpers.ts, kept here
// so the function deploys on its own.
const corsHeadersOpen: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TYPES = ["feedback", "feature_request", "bug"];
const MAX_MESSAGE = 5000;
const LIMIT_PER_HOUR = 10;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const headers = { ...corsHeadersOpen, "Content-Type": "application/json" };
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

// Plain text only: drop tags and control characters, keep line breaks.
function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("BOT_FEEDBACK_IP_SALT") || "";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function forwardedByWorker(req: Request): boolean {
  const expected = Deno.env.get("BOT_FEEDBACK_FORWARD_SECRET") || "";
  const given = req.headers.get("x-forward-secret") || "";
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersOpen });
  if (req.method !== "POST") return reply(405, { ok: false, error: "Please send feedback with POST." });

  let body: Record<string, unknown>;
  let isForm = false;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      isForm = true;
      body = Object.fromEntries(new URLSearchParams(await req.text()));
    } else {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    }
  } catch {
    return reply(400, { ok: false, error: "Send a JSON object, or a form, with a message." });
  }

  // Honeypot (form only): a bot filled the hidden field. Pretend it worked.
  if (isForm && plain(body.zq_hp)) return reply(201, { ok: true, id: null });

  const message = plain(body.message);
  if (!message) return reply(400, { ok: false, error: "message is required" });
  if (message.length > MAX_MESSAGE) {
    return reply(400, { ok: false, error: `message is too long (at most ${MAX_MESSAGE} characters)` });
  }

  const type = plain(body.type) || "feedback";
  if (!TYPES.includes(type)) {
    return reply(400, { ok: false, error: "type must be feedback, feature_request or bug" });
  }

  const email = plain(body.email) || null;
  if (email && (email.length > 254 || !EMAIL.test(email))) {
    return reply(400, { ok: false, error: "email does not look like an email address" });
  }

  const botName = plain(body.bot_name).slice(0, 200) || null;
  const botVersion = plain(body.bot_version).slice(0, 50) || null;
  const source = plain(body.source) === "web" || isForm ? "web" : "bot";

  // Calls through alpacaplayhouse.com/bots/feedback arrive from the Cloudflare
  // Worker (cloudflare/bot-feedback), which passes the caller's IP in
  // X-Client-IP. Trust it only with the shared secret.
  const ip = (forwardedByWorker(req) && req.headers.get("x-client-ip"))
    || req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
  const ipHash = await hashIp(ip);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("bot_feedback")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (countError) {
    console.error("bot-feedback rate check failed:", countError);
    return reply(500, { ok: false, error: "Could not save feedback right now. Please try again later." });
  }
  if ((count ?? 0) >= LIMIT_PER_HOUR) {
    return reply(429, { ok: false, error: "Too much feedback from this address in the last hour. Please try again later." });
  }

  const { data, error } = await supabase
    .from("bot_feedback")
    .insert({ message, type, email, bot_name: botName, bot_version: botVersion, source, ip_hash: ipHash })
    .select("id")
    .single();
  if (error) {
    console.error("bot-feedback insert failed:", error);
    return reply(500, { ok: false, error: "Could not save feedback right now. Please try again later." });
  }

  return reply(201, { ok: true, id: data.id });
});
