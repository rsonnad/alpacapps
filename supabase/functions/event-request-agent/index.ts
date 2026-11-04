/**
 * event-request-agent: "Let my AI assistant fill this out" for /rentals/hostevent/.
 *
 * Same mechanics as Spotka's "Let my AI assistant onboard me": the page mints
 * a key on an explicit tap and shows paste-in instructions; the guest pastes
 * them into their own assistant (Claude, ChatGPT, Gemini, Grok...), which asks
 * them the form questions in a chat and saves the confirmed answers here; the
 * page reads them back into the form.
 *
 * The assistant only ever writes a DRAFT (event_request_drafts). It cannot
 * tick acknowledgments, apply a partner code, pay or submit: the guest does
 * that on the page. Field rules are shared with event-intake-voice.
 *
 * Two ways in, one key:
 *   REST  POST <base>  with X-API-Key (or key=) and do=<verb>; GET <base> = manifest
 *   MCP   POST <base>/mcp  (streamable HTTP, JSON responses), key as X-API-Key,
 *         Authorization: Bearer <key>, or ?key=
 *
 * Deploy: npx supabase functions deploy event-request-agent --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkIpRateLimit, checkRateLimit, getClientIp } from "../_shared/function-wrapper.ts";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { clean, EVENT_TYPES, REQUIRED_FIELDS, STRING_FIELDS, validateField } from "../_shared/event-intake-fields.ts";

const BASE_URL = "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/event-request-agent";
const PAGE_URL = "https://alpacaplayhouse.com/rentals/hostevent/";
const KEY_PREFIX = "aph_ev_";

// ── Field catalog: what the assistant is told about every field ──────────

interface FieldInfo { name: string; label: string; section: string; type: string; hint?: string }

const FIELDS: FieldInfo[] = [
  { name: "first_name", label: "First name", section: "you", type: "text" },
  { name: "last_name", label: "Last name", section: "you", type: "text" },
  { name: "email", label: "Email", section: "you", type: "email" },
  { name: "phone", label: "Phone", section: "you", type: "phone" },
  { name: "organization_name", label: "Organization name", section: "you", type: "text", hint: "Leave empty if hosting personally." },
  { name: "has_hosted_before", label: "Has hosted an event at Alpaca Playhouse before", section: "you", type: "boolean" },
  { name: "event_name", label: "Event name", section: "event", type: "text", hint: "e.g. Sarah's 30th Birthday, Yoga Workshop" },
  { name: "event_type", label: "Event type", section: "event", type: "choice" },
  { name: "expected_guests", label: "Expected guests (including the host and staff)", section: "event", type: "integer 1-100" },
  { name: "event_date", label: "Event date", section: "event", type: "date YYYY-MM-DD, today or later (Austin time)" },
  { name: "event_start_time", label: "Start time", section: "event", type: "time HH:MM, 24-hour" },
  { name: "event_end_time", label: "End time", section: "event", type: "time HH:MM, 24-hour" },
  { name: "event_description", label: "Event description", section: "event", type: "text", hint: "What they are planning, the purpose, any special requirements." },
  { name: "is_ticketed", label: "Ticketed event", section: "event", type: "boolean" },
  { name: "ticket_price_range", label: "Ticket price range", section: "event", type: "text", hint: "Only if ticketed, e.g. $20-50 or sliding scale $10-30." },
  { name: "setup_staff_name", label: "Setup coordinator name", section: "staffing", type: "text", hint: "Can be the host." },
  { name: "setup_staff_phone", label: "Setup coordinator phone", section: "staffing", type: "phone" },
  { name: "cleanup_staff_name", label: "Cleanup coordinator name", section: "staffing", type: "text", hint: "Can be the host." },
  { name: "cleanup_staff_phone", label: "Cleanup coordinator phone", section: "staffing", type: "phone" },
  { name: "parking_manager_name", label: "Parking coordinator name", section: "staffing", type: "text", hint: "Can be the host." },
  { name: "parking_manager_phone", label: "Parking coordinator phone", section: "staffing", type: "phone" },
  { name: "marketing_materials_link", label: "Link to marketing materials", section: "extras", type: "url" },
  { name: "special_requests", label: "Special requests or questions", section: "extras", type: "text" },
];
const FIELD_NAMES = new Set(FIELDS.map((f) => f.name));
const REQUIRED = new Set(Object.keys(REQUIRED_FIELDS));

const HOUSE_RULES = [
  "Do not post the venue address publicly; send guests to alpacaplayhouse.com/visiting.",
  "Manage parking so no cars park in front of neighbors' houses (gravel lot inside the gate, never on grass).",
  "Keep outdoor noise and music low after 9:30pm.",
  "No alcohol inside the house (weddings excepted).",
  "No cooking or storing meat inside; the back patio grill is fine.",
  "No RVs on the property.",
  "No animals inside the house or back yard; dogs may be tied in the front yard.",
  "The host cleans up, finished by 1:01pm the day after; wash used linens, put furniture back.",
  "Propane used is deducted from the deposit.",
];

// ── Helpers ──────────────────────────────────────────────────────────────

function corsHeaders(req: Request): Record<string, string> {
  // Assistants call from servers (no Origin); the page calls from our origin.
  // The key is the access control, not CORS.
  const origin = req.headers.get("origin") || "";
  const base = getCorsHeaders(req);
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) base["Access-Control-Allow-Origin"] = origin;
  base["Access-Control-Allow-Headers"] += ", mcp-session-id, mcp-protocol-version";
  base["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
  return base;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public hint?: string) { super(message); }
}

function austinToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newKey(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return KEY_PREFIX + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(s)) return true;
  if (["false", "no", "0", "n"].includes(s)) return false;
  return null;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean); } catch { /* fall through */ }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

// ── Spaces and availability (same rule the page uses) ────────────────────

interface Space { id: string; name: string }

async function loadSpaces(sb: SupabaseClient): Promise<Space[]> {
  const { data, error } = await sb.from("spaces").select("id,name").eq("can_be_event", true).eq("is_archived", false).order("name");
  if (error) throw new ApiError("spaces_unavailable", "Could not load the event spaces.", 500);
  return data || [];
}

/** Space ids booked on `date`, by the same assignments overlap rule as the page. */
async function bookedOn(sb: SupabaseClient, date: string): Promise<Set<string>> {
  const { data, error } = await sb.from("assignments")
    .select("start_date,end_date,desired_departure_date,desired_departure_listed,assignment_spaces(space_id)")
    .in("status", ["active", "pending_contract", "contract_sent"]);
  if (error) throw new ApiError("availability_unavailable", "Could not check availability.", 500);
  const booked = new Set<string>();
  for (const a of data || []) {
    const end = a.desired_departure_listed && a.desired_departure_date ? a.desired_departure_date : a.end_date;
    if (a.start_date <= date && (!end || end >= date)) {
      for (const s of a.assignment_spaces || []) booked.add(s.space_id);
    }
  }
  return booked;
}

async function spacesFor(sb: SupabaseClient, date: string | null, selected: string[] = []) {
  const spaces = await loadSpaces(sb);
  const booked = date ? await bookedOn(sb, date) : null;
  const sel = new Set(selected);
  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    available: booked ? !booked.has(s.id) : null,
    selected: sel.has(s.id),
  }));
}

// ── Drafts ───────────────────────────────────────────────────────────────

interface Draft { id: string; fields: Record<string, unknown>; space_ids: string[]; expires_at: string; updated_at: string }

async function draftForKey(sb: SupabaseClient, key: string | null): Promise<Draft> {
  if (!key) throw new ApiError("missing_key", "Send your key as the X-API-Key header (or key=).", 401, "The key starts with aph_ev_ and comes from the 'Let my AI assistant fill this out' link on " + PAGE_URL);
  if (!key.startsWith(KEY_PREFIX)) throw new ApiError("invalid_key", "That is not an event form key.", 401);
  const { data } = await sb.from("event_request_drafts").select("id,fields,space_ids,expires_at,updated_at").eq("key_hash", await sha256(key)).maybeSingle();
  if (!data) throw new ApiError("invalid_key", "That key is not known.", 401, "Ask the person to create a new key on " + PAGE_URL);
  if (new Date(data.expires_at) < new Date()) throw new ApiError("key_expired", "This key has expired.", 401, "Ask the person to create a new key on " + PAGE_URL);
  sb.from("event_request_drafts").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return data as Draft;
}

function missingOf(d: Pick<Draft, "fields" | "space_ids">): string[] {
  return Object.entries(REQUIRED_FIELDS)
    .filter(([k]) => k === "spaces" ? !(d.space_ids || []).length : (d.fields[k] === undefined || d.fields[k] === null || d.fields[k] === ""))
    .map(([, label]) => label);
}

// ── Verbs ────────────────────────────────────────────────────────────────

async function keyCreate(sb: SupabaseClient, req: Request) {
  if (!(await checkIpRateLimit(sb, "event-request-agent-key", req, 10, 3600)) ||
      !(await checkRateLimit(sb, "event-request-agent-key-global", "all", 500, 86400))) {
    throw new ApiError("rate_limited", "Too many keys created. Try again later.", 429);
  }
  const key = newKey();
  const { data, error } = await sb.from("event_request_drafts")
    .insert({ key_hash: await sha256(key), key_prefix: key.slice(0, 11), created_ip: getClientIp(req) })
    .select("expires_at").single();
  if (error) throw new ApiError("key_create_failed", "Could not create a key.", 500);
  return { ok: true, key, expires_at: data.expires_at, paste_text: pasteText(key) };
}

async function questions(sb: SupabaseClient, d: Draft) {
  const date = (d.fields.event_date as string) || null;
  const spaces = await spacesFor(sb, date, d.space_ids);
  return {
    ok: true,
    today: austinToday(),
    fields: FIELDS.map((f) => ({
      name: f.name,
      label: f.label,
      section: f.section,
      required: REQUIRED.has(f.name),
      type: f.type,
      ...(f.name === "event_type" ? { options: EVENT_TYPES } : {}),
      ...(f.hint ? { hint: f.hint } : {}),
      value: d.fields[f.name] ?? null,
    })),
    spaces: {
      required: true,
      how: date
        ? "Save with do=update space_ids=<id,id> (or space_names). Only spaces with available=true on the event date can be picked."
        : "Set event_date first; then each space shows whether it is free that day.",
      list: spaces,
    },
    house_rules: HOUSE_RULES,
    missing: missingOf(d),
    ready: missingOf(d).length === 0,
    next_step_for_person: `When nothing is missing, the person goes back to ${PAGE_URL}, presses "My assistant has finished", reviews the form, ticks the acknowledgments and pays the reservation deposit. You cannot do those steps.`,
    expires_at: d.expires_at,
  };
}

async function update(sb: SupabaseClient, d: Draft, params: Record<string, unknown>) {
  const today = austinToday();
  const typeValues = EVENT_TYPES.map((t) => t.value);
  const fields = { ...d.fields };
  const saved: string[] = [];
  const rejected: Array<{ field: string; why: string }> = [];
  const forbidden = Object.keys(params).filter((k) => /^ack_|deposit|partner|reservation_code|card|payment|submit/i.test(k));
  for (const k of forbidden) rejected.push({ field: k, why: "The person does this on the page themselves; an assistant cannot." });

  for (const [name, raw] of Object.entries(params)) {
    if (!FIELD_NAMES.has(name)) continue;
    if (raw === "" || raw === null) { // clear
      if (REQUIRED.has(name)) { rejected.push({ field: name, why: "Required; cannot be cleared." }); continue; }
      delete fields[name]; saved.push(name); continue;
    }
    let v: unknown;
    if (name === "has_hosted_before" || name === "is_ticketed") v = asBool(raw);
    else v = validateField(name, raw, typeValues, today);
    if (v === null || v === undefined) {
      const why = name === "event_type" ? `Must be one of: ${typeValues.join(", ")}.`
        : name === "event_date" ? `Must be YYYY-MM-DD, ${today} or later.`
        : name === "expected_guests" ? "Must be a whole number from 1 to 100."
        : /time$/.test(name) ? "Must be HH:MM, 24-hour (7pm = 19:00)."
        : /phone$/.test(name) ? "Must be a phone number with at least 7 digits."
        : name === "email" ? "Must be a valid email address."
        : name === "marketing_materials_link" ? "Must be a web link."
        : "Not a valid value.";
      rejected.push({ field: name, why });
      continue;
    }
    fields[name] = v;
    saved.push(name);
  }
  if (fields.is_ticketed === false) delete fields.ticket_price_range;

  let spaceIds = d.space_ids || [];
  const wantIds = asList(params.space_ids);
  const wantNames = asList(params.space_names ?? params.spaces);
  const dateChanged = fields.event_date !== d.fields.event_date;
  if (wantIds.length || wantNames.length || (dateChanged && spaceIds.length)) {
    const date = (fields.event_date as string) || null;
    if (!date) {
      rejected.push({ field: "space_ids", why: "Set event_date first, so availability can be checked." });
    } else {
      const spaces = await spacesFor(sb, date);
      const want = (wantIds.length || wantNames.length)
        ? spaces.filter((s) => wantIds.includes(s.id) || wantNames.some((n) => n.toLowerCase() === s.name.toLowerCase()))
        : spaces.filter((s) => spaceIds.includes(s.id));
      const unknown = [...wantIds.filter((id) => !spaces.some((s) => s.id === id)), ...wantNames.filter((n) => !spaces.some((s) => s.name.toLowerCase() === n.toLowerCase()))];
      for (const u of unknown) rejected.push({ field: "space_ids", why: `Unknown space: ${u}. Call do=questions for the list.` });
      const booked = want.filter((s) => !s.available);
      for (const b of booked) rejected.push({ field: "space_ids", why: `${b.name} is booked on ${date}.` });
      const next = want.filter((s) => s.available).map((s) => s.id);
      if (wantIds.length || wantNames.length || next.length !== spaceIds.length) {
        spaceIds = next;
        saved.push("space_ids");
      }
    }
  }

  const agent = clean(params.agent, 60);
  if (saved.length || agent) {
    const { error } = await sb.from("event_request_drafts")
      .update({ fields, space_ids: spaceIds, updated_at: new Date().toISOString(), ...(agent ? { agent_name: agent } : {}) })
      .eq("id", d.id);
    if (error) throw new ApiError("save_failed", "Could not save.", 500);
  }
  const missing = missingOf({ fields, space_ids: spaceIds });
  return {
    ok: rejected.length === 0,
    saved,
    rejected,
    missing,
    ready: missing.length === 0,
    ...(rejected.length ? { hint: "Fix each rejected field and send it again. Nothing rejected was saved." } : {}),
    ...(missing.length === 0 ? { next_step_for_person: `Everything is filled in. Tell the person to go back to ${PAGE_URL}, press "My assistant has finished", review, tick the acknowledgments and pay the deposit.` } : {}),
  };
}

/** What the page reads back. Same shape the page's applyResult() takes. */
function status(d: Draft) {
  return { ok: true, fields: d.fields, space_ids: d.space_ids || [], missing: missingOf(d), updated_at: d.updated_at, expires_at: d.expires_at };
}

async function availability(sb: SupabaseClient, params: Record<string, unknown>) {
  const date = validateField("event_date", params.date, [], austinToday()) as string | null;
  if (!date) throw new ApiError("invalid_date", "date must be YYYY-MM-DD, today or later.", 400);
  return { ok: true, date, spaces: (await spacesFor(sb, date)).map(({ id, name, available }) => ({ id, name, available })) };
}

// ── Paste text and manifest ──────────────────────────────────────────────

function pasteText(key: string): string {
  return [
    "Please help me fill out an event request for Alpaca Playhouse, a home venue with alpacas, a sauna and indoor and outdoor spaces in Cedar Creek, near Austin, Texas. You will ask me the questions in this chat and save my answers to the form through its API. I will review and send the form myself.",
    "",
    `Base URL: ${BASE_URL}`,
    `My key: ${key}`,
    "Send the key as the header X-API-Key and a do= parameter (POST form fields or JSON). If you can only open a URL, add key=... as a parameter. Every reply is JSON; a rejected field says why. MCP clients can connect to the same URL with /mcp at the end.",
    "",
    "What the form asks:",
    "- About me: first name, last name, email, phone, organization (optional, blank if personal), whether I have hosted here before.",
    `- The event: name, type (${EVENT_TYPES.map((t) => t.value).join(", ")}), expected guests including me and staff (1-100), date (YYYY-MM-DD), start and end time (24-hour HH:MM), a description of what I am planning, whether it is ticketed and the price range.`,
    "- Spaces: which spaces I want. Only spaces free on my date can be picked, so set the date first.",
    "- Staffing: name and phone of a setup coordinator, a cleanup coordinator and a parking coordinator. Any of them can be me.",
    "- Extras (optional): a link to marketing materials, special requests or questions.",
    "",
    "Do this:",
    "1. Call do=questions. It lists every field with its allowed values, what is already saved, the spaces with their availability, the house rules and what is still missing.",
    "2. Start from what you already know about me and my plans from our conversations. Suggest answers and ask me to confirm or correct them, one or two at a time, in a friendly conversation. Ask me directly about anything you do not know, and offer the options listed. Never save an answer I have not confirmed, and never make up names or phone numbers.",
    "3. Save confirmed answers with do=update and the field names, for example do=update first_name=Maya event_type=party expected_guests=40 event_date=2026-12-12 event_start_time=18:00 event_end_time=22:00. Save the date before the spaces, then do=update space_ids=<id,id> (or space_names=<name,name>). Add agent=<your name> once.",
    "4. Staff contacts are other people's names and phone numbers: check with me that it is fine to share them before saving.",
    "5. Look at the house rules from do=questions. If my plans clash with one (alcohol or cooking meat inside, animals, RVs, loud music outside after 9:30pm), tell me while we talk.",
    "6. Call do=questions again until missing is empty. Then tell me to go back to the Alpaca Playhouse page, press \"My assistant has finished\", review the form, tick the acknowledgments and pay the reservation deposit.",
    "",
    "You cannot tick the acknowledgments, enter a partner code, pay or submit the request; I do that on the page. Please do not ask me for card details. The key only fills this one form and expires in 3 days.",
  ].join("\n");
}

function manifest() {
  return {
    ok: true,
    name: "Alpaca Playhouse event request form (assistant API)",
    what: "Lets a guest's own AI assistant fill in the event request form on " + PAGE_URL + ". The assistant writes a draft; the guest reviews, ticks acknowledgments, pays the deposit and submits on the page.",
    base_url: BASE_URL,
    mcp_url: BASE_URL + "/mcp",
    get_a_key: `On ${PAGE_URL}, the "Let my AI assistant fill this out" link, then "Create key and instructions".`,
    how_to_call: "POST form fields or JSON to the base URL with do=<verb>. Key in the X-API-Key header (preferred) or key= parameter.",
    verbs: [
      { do: "questions", what: "Every field with label, type, allowed values and saved value; spaces with availability on the saved date; house rules; what is missing." },
      { do: "update", what: "Save confirmed answers. Any field names from questions; space_ids or space_names (comma separated). Empty string clears an optional field. Rejected fields come back with why.", params: Object.fromEntries(FIELDS.map((f) => [f.name, f.type])) },
      { do: "availability", what: "Which spaces are free on a date.", params: { date: "YYYY-MM-DD" } },
      { do: "status", what: "The saved draft: fields, space_ids, missing." },
    ],
    cannot: ["tick acknowledgments", "apply a partner code", "pay the deposit", "submit the request"],
  };
}

// ── MCP (streamable HTTP, JSON responses only) ───────────────────────────

const MCP_TOOLS = [
  {
    name: "questions",
    description: "List every event request field with allowed values and what is already saved, the spaces with availability on the saved date, the house rules, and what is still missing. Call first, and again to check progress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update",
    description: "Save answers the person has confirmed. Pass any field names from questions. Save event_date before space_ids. Empty string clears an optional field. Cannot tick acknowledgments, pay or submit.",
    inputSchema: {
      type: "object",
      properties: {
        ...Object.fromEntries(FIELDS.map((f) => [f.name, {
          type: f.type === "boolean" ? "boolean" : f.type.startsWith("integer") ? "integer" : "string",
          description: f.label + (f.hint ? ". " + f.hint : "") + (f.name === "event_type" ? ". One of: " + EVENT_TYPES.map((t) => t.value).join(", ") : "") + (f.type.includes("YYYY") || f.type.includes("HH:MM") ? ". " + f.type : ""),
        }])),
        space_ids: { type: "array", items: { type: "string" }, description: "Space ids from questions (only ones available on the date)." },
        space_names: { type: "array", items: { type: "string" }, description: "Or space names instead of ids." },
        agent: { type: "string", description: "Your name, e.g. Claude, ChatGPT." },
      },
    },
  },
  {
    name: "availability",
    description: "Which event spaces are free on a date.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } }, required: ["date"] },
  },
];

async function handleMcp(req: Request, sb: SupabaseClient, key: string | null): Promise<Response> {
  if (req.method === "GET") return new Response(null, { status: 405, headers: corsHeaders(req) });
  if (req.method === "DELETE") return new Response(null, { status: 200, headers: corsHeaders(req) });
  let msg: any;
  try { msg = await req.json(); } catch { return json(req, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out: unknown[] = [];
  for (const m of batch) {
    const r = await mcpOne(m, sb, key);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers: corsHeaders(req) });
  return json(req, Array.isArray(msg) ? out : out[0]);
}

async function mcpOne(m: any, sb: SupabaseClient, key: string | null): Promise<unknown | null> {
  const id = m?.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  if (m?.id === undefined) return null; // notification
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "alpaca-playhouse-event-request", version: "1.0.0" },
        instructions: "Help the person fill out an Alpaca Playhouse event request. Call questions first. Ask the person for each missing answer, suggest from what you know, save only what they confirm. They tick acknowledgments, pay and submit on " + PAGE_URL + " themselves.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = m.params?.name;
      const args = m.params?.arguments || {};
      try {
        let result: unknown;
        if (name === "availability") result = await availability(sb, args);
        else {
          const d = await draftForKey(sb, key);
          if (name === "questions") result = await questions(sb, d);
          else if (name === "update") result = await update(sb, d, args);
          else return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        }
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: result });
      } catch (e) {
        const err = e instanceof ApiError ? { error: e.code, message: e.message, hint: e.hint } : { error: "server_error", message: "Something went wrong." };
        return ok({ content: [{ type: "text", text: JSON.stringify({ ok: false, ...err }) }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}

// ── Entry ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  const url = new URL(req.url);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const headerKey = req.headers.get("x-api-key") || (bearer.startsWith(KEY_PREFIX) ? bearer : "") || url.searchParams.get("key");

  try {
    if (url.pathname.replace(/\/+$/, "").endsWith("/mcp")) return await handleMcp(req, sb, headerKey);

    let params: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      const text = await req.text();
      if (text) {
        if (ct.includes("json") || /^\s*[{[]/.test(text)) {
          try { params = { ...params, ...JSON.parse(text) }; } catch { throw new ApiError("bad_json", "The body is not valid JSON."); }
        } else {
          params = { ...params, ...Object.fromEntries(new URLSearchParams(text)) };
        }
      }
    }
    const verb = String(params.do || "").trim();
    delete params.do;
    const key = headerKey || (typeof params.key === "string" ? params.key : null);
    delete params.key;

    if (!verb) return json(req, manifest());
    if (verb === "key_create") return json(req, await keyCreate(sb, req));
    if (verb === "availability") return json(req, await availability(sb, params));

    const d = await draftForKey(sb, key);
    switch (verb) {
      case "questions": return json(req, await questions(sb, d));
      case "update": return json(req, await update(sb, d, params));
      case "status": return json(req, status(d));
      default:
        throw new ApiError("unknown_verb", `Unknown do=${verb}.`, 400, "Use questions, update, availability or status. GET the base URL for the full list.");
    }
  } catch (e) {
    if (e instanceof ApiError) return json(req, { ok: false, error: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }, e.status);
    console.error("[event-request-agent]", e);
    return json(req, { ok: false, error: "server_error", message: "Something went wrong." }, 500);
  }
});
