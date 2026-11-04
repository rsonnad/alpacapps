/**
 * Event Intake Voice Edge Function
 *
 * Powers the "Talk to fill this in" panel on /rentals/hostevent/.
 * Takes one conversation turn (recorded audio or typed text) plus the current
 * form values, asks Gemini which form fields the guest just gave us, and
 * returns validated field values, a short reply to speak back, and the list of
 * required fields still missing.
 *
 * The AI only ever proposes values. This function whitelists and validates
 * every field, and it never returns acknowledgments, deposit, partner code or
 * card data: those stay a manual step for the guest.
 *
 * Deploy: npx supabase functions deploy event-intake-voice --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkIpRateLimit, checkRateLimit } from "../_shared/function-wrapper.ts";
import { getCorsHeaders } from "../_shared/api-helpers.ts";

const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // ~ several minutes of opus; base64 is checked below
const MAX_TEXT_CHARS = 2000;
const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/aac"];

// Fields the AI may fill. Anything else it returns is dropped.
const STRING_FIELDS = [
  "first_name", "last_name", "email", "phone", "organization_name",
  "event_name", "event_type", "event_date", "event_start_time", "event_end_time",
  "event_description", "ticket_price_range",
  "setup_staff_name", "setup_staff_phone", "cleanup_staff_name", "cleanup_staff_phone",
  "parking_manager_name", "parking_manager_phone",
  "marketing_materials_link", "special_requests",
] as const;

const REQUIRED_FIELDS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  email: "email",
  phone: "phone",
  event_name: "event name",
  event_type: "event type",
  expected_guests: "number of guests",
  event_date: "event date",
  event_start_time: "start time",
  event_end_time: "end time",
  event_description: "event description",
  spaces: "spaces",
  setup_staff_name: "setup coordinator name",
  setup_staff_phone: "setup coordinator phone",
  cleanup_staff_name: "cleanup coordinator name",
  cleanup_staff_phone: "cleanup coordinator phone",
  parking_manager_name: "parking coordinator name",
  parking_manager_phone: "parking coordinator phone",
};

// Local dev servers are allowed too, so the panel can be tested before deploy.
// This endpoint is public and rate limited, so CORS is not its access control.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const base = getCorsHeaders(req);
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

interface SpaceInfo { id: string; name: string; available: boolean }
interface TurnBody {
  audio?: { data: string; mimeType: string };
  text?: string;
  history?: Array<{ role: "guest" | "assistant"; text: string }>;
  form?: Record<string, unknown>;
  selectedSpaceIds?: string[];
  eventTypes?: Array<{ value: string; label: string }>;
  spaces?: SpaceInfo[];
  today?: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING", description: "What the guest said this turn, transcribed (or the typed text)." },
    fields: {
      type: "OBJECT",
      description: "Only fields the guest gave or corrected in THIS turn. Omit everything else.",
      properties: {
        ...Object.fromEntries(STRING_FIELDS.map((f) => [f, { type: "STRING", nullable: true }])),
        expected_guests: { type: "INTEGER", nullable: true },
        is_ticketed: { type: "BOOLEAN", nullable: true },
      },
    },
    space_ids: {
      type: "ARRAY",
      nullable: true,
      description: "Full list of space ids the guest wants, only when they talked about spaces this turn.",
      items: { type: "STRING" },
    },
    reply: { type: "STRING", description: "One or two short, friendly spoken sentences." },
    done: { type: "BOOLEAN", description: "True when the guest says they are finished." },
  },
  required: ["heard", "fields", "reply", "done"],
};

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function clean(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** Validate one proposed field value. Returns null to drop it. */
function validateField(name: string, raw: unknown, eventTypes: string[], today: string): unknown {
  if (raw === null || raw === undefined) return null;
  switch (name) {
    case "expected_guests": {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
    }
    case "is_ticketed":
      return typeof raw === "boolean" ? raw : null;
    case "email": {
      const s = clean(raw, 200)?.toLowerCase().replace(/\s/g, "") ?? null;
      return s && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s) ? s : null;
    }
    case "event_type": {
      const s = clean(raw, 40)?.toLowerCase() ?? null;
      return s && eventTypes.includes(s) ? s : null;
    }
    case "event_date": {
      const s = clean(raw, 10);
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + "T12:00:00Z"))) return null;
      return s >= today ? s : null;
    }
    case "event_start_time":
    case "event_end_time": {
      const m = clean(raw, 8)?.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const h = Number(m[1]), min = Number(m[2]);
      return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
    }
    case "marketing_materials_link": {
      const s = clean(raw, 300);
      return s && !/\s/.test(s) && /\.[a-z]{2,}/i.test(s) && !/^(javascript|data):/i.test(s) ? s : null;
    }
    case "event_description":
    case "special_requests":
      return clean(raw, 2000);
    default:
      if (name.endsWith("_phone") || name === "phone") {
        const s = clean(raw, 40);
        return s && (s.match(/\d/g) || []).length >= 7 ? s : null;
      }
      return clean(raw, 200);
  }
}

function buildPrompt(b: TurnBody, eventTypes: Array<{ value: string; label: string }>, spaces: SpaceInfo[], today: string) {
  const form = b.form || {};
  const filled = Object.entries(form)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `  ${k}: ${String(v).slice(0, 300)}`)
    .join("\n") || "  (nothing yet)";
  const selected = new Set(b.selectedSpaceIds || []);
  const spaceLines = spaces.length
    ? spaces.map((s) => `  ${s.id} | ${s.name} | ${!form.event_date ? "date not picked yet" : s.available ? "available" : "BOOKED"}${selected.has(s.id) ? " | selected" : ""}`).join("\n")
    : "  (none loaded)";
  const history = (b.history || []).slice(-8)
    .map((h) => `${h.role === "guest" ? "Guest" : "You"}: ${String(h.text).slice(0, 500)}`)
    .join("\n") || "(this is the first turn)";

  return `You help a guest fill in an event-hosting request form for Alpaca Playhouse, a home venue near Austin, Texas, by voice.
Today is ${today} (America/Chicago). Resolve relative dates ("next Saturday", "the 14th") to YYYY-MM-DD on or after today. Times are 24-hour HH:MM ("7pm" = 19:00).

Fields you may fill: first_name, last_name, email, phone, organization_name, event_name, event_type, expected_guests (1-100, include hosts and staff), event_date, event_start_time, event_end_time, event_description, is_ticketed, ticket_price_range, setup_staff_name, setup_staff_phone, cleanup_staff_name, cleanup_staff_phone, parking_manager_name, parking_manager_phone, marketing_materials_link, special_requests.
event_type must be one of: ${eventTypes.map((t) => `${t.value} (${t.label})`).join(", ")}.
If the guest says they will handle setup, cleanup or parking themselves, use their own name and phone for that coordinator.
If they did not name the event, you may suggest a short event_name from what they described (e.g. "Maya's 30th Birthday").
Write event_description as a clear 1-3 sentence summary in the guest's own terms, adding to what is already there rather than dropping it.

Spaces (id | name | availability | selected):
${spaceLines}
Only put AVAILABLE space ids in space_ids, and return the full wanted list including ones already selected. If they want a booked space, say it is booked that day. If no date is picked yet, do not return space_ids; ask for the date first.

Never fill or mention filling the house-rule acknowledgment checkboxes, the deposit, partner codes or card details. If asked, say the guest ticks those and pays at the bottom of the form themselves.

Current form values:
${filled}

Conversation so far:
${history}

For this turn: return in "fields" only what the guest just gave or corrected. In "reply", briefly confirm what you filled, then ask for the next one or two missing things (most important first: name and contact, event type, date and times, guests, description, spaces, then coordinators). Speak naturally, no lists, no markdown, under 40 words. If everything required is filled, tell them to review the form, tick the acknowledgments and pay the deposit. Set done=true only if they say they are finished.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (
      !(await checkIpRateLimit(supabase, "event-intake-voice", req, 60, 3600)) ||
      !(await checkRateLimit(supabase, "event-intake-voice-global", "all", 1500, 86400))
    ) {
      return json(req, { error: "Too many requests. Please fill in the form by hand for now." }, 429);
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const b: TurnBody = await req.json().catch(() => ({}));
    const text = clean(b.text, MAX_TEXT_CHARS);
    let audioPart: { inline_data: { mime_type: string; data: string } } | null = null;
    if (b.audio?.data) {
      const mime = String(b.audio.mimeType || "").split(";")[0].trim().toLowerCase();
      if (!AUDIO_TYPES.includes(mime)) return json(req, { error: "Unsupported audio format" }, 415);
      const data = String(b.audio.data);
      if (data.length * 0.75 > MAX_AUDIO_BYTES || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        return json(req, { error: "Recording too long. Try a shorter answer." }, 413);
      }
      audioPart = { inline_data: { mime_type: mime, data } };
    }
    if (!audioPart && !text) return json(req, { error: "Say or type something first" }, 400);

    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(b.today || ""))
      ? String(b.today)
      : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const eventTypes = (Array.isArray(b.eventTypes) ? b.eventTypes : [])
      .slice(0, 20)
      .map((t) => ({ value: String(t.value).slice(0, 40), label: String(t.label).slice(0, 60) }))
      .filter((t) => t.value);
    const spaces: SpaceInfo[] = (Array.isArray(b.spaces) ? b.spaces : [])
      .slice(0, 60)
      .map((s) => ({ id: String(s.id).slice(0, 64), name: String(s.name).slice(0, 80), available: !!s.available }));

    const parts: unknown[] = [{ text: buildPrompt(b, eventTypes, spaces, today) }];
    if (audioPart) parts.push({ text: "The guest's spoken answer for this turn:" }, audioPart);
    if (text) parts.push({ text: `The guest typed: ${text}` });

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiBody = JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody });
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
      console.warn(`Gemini ${res.status} (attempt ${attempt + 1}), retrying`);
      await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
    }
    if (!res || !res.ok) {
      const err = res ? await res.text().catch(() => "") : "";
      console.error("Gemini error:", res?.status, err.slice(0, 500));
      return json(req, { error: "The assistant is busy. Please try again in a moment." }, 502);
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
    let ai: { heard?: string; fields?: Record<string, unknown>; space_ids?: string[] | null; reply?: string; done?: boolean };
    try {
      ai = JSON.parse(raw);
    } catch {
      console.error("Unparseable Gemini output:", raw.slice(0, 300));
      return json(req, { error: "Sorry, I didn't catch that. Could you say it again?" }, 502);
    }

    // Validate every proposed value against the whitelist
    const typeValues = eventTypes.map((t) => t.value);
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(ai.fields || {})) {
      if (![...STRING_FIELDS, "expected_guests", "is_ticketed"].includes(name as never)) continue;
      const v = validateField(name, value, typeValues, today);
      if (v !== null) fields[name] = v;
    }

    let spaceIds: string[] | null = null;
    if (Array.isArray(ai.space_ids)) {
      const ok = new Set(spaces.filter((s) => s.available).map((s) => s.id));
      spaceIds = [...new Set(ai.space_ids.map(String))].filter((id) => ok.has(id));
    }

    // Work out what is still missing after this turn's updates
    const merged: Record<string, unknown> = { ...(b.form || {}), ...fields };
    const selectedAfter = spaceIds ?? (b.selectedSpaceIds || []);
    const missing = Object.entries(REQUIRED_FIELDS)
      .filter(([k]) => (k === "spaces" ? selectedAfter.length === 0 : !merged[k]))
      .map(([, label]) => label);

    return json(req, {
      heard: clean(ai.heard, 1000) || text || "",
      fields,
      space_ids: spaceIds,
      reply: clean(ai.reply, 400) || "Got it. What else can you tell me about your event?",
      missing,
      done: !!ai.done,
    });
  } catch (error) {
    console.error("event-intake-voice error:", (error as Error).message);
    return json(req, { error: "Something went wrong. You can still fill in the form by hand." }, 500);
  }
});
