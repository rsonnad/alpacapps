/**
 * Event Host Onboard
 *
 * Run when an event request is approved (staff button, or staff/events.js right after approval).
 *   1. Works out whether the host is a house resident.
 *   2. Asks Gemini for (a) a cleaning checklist tailored to the event and its spaces, starting from
 *      event_cleaning_area_templates, and (b) our maximum cleanup exposure. Residents get a
 *      $35–$75 cleaning deposit set from that estimate.
 *   3. Gives the host access: an associate profile (profile_kind = 'event_host') if they already
 *      have an account, otherwise a pending 'associate' invitation that turns into one on first sign-in.
 *   4. Emails the host the checklist, the photo rules and the upload link.
 *
 * POST { event_request_id, send_email?: boolean = true, regenerate?: boolean = false }
 * Auth: staff/admin/oracle JWT or service role.
 *
 * Deploy: supabase functions deploy event-host-onboard
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
import { geminiJson } from "../_shared/gemini-json.ts";

const SITE = "https://alpacaplayhouse.com";
const RESIDENT_DEPOSIT_MIN = 35;
const RESIDENT_DEPOSIT_MAX = 75;

interface ChecklistArea {
  area_key: string;
  area_name: string;
  tasks: { key: string; text: string }[];
  needs_photos: boolean;
}

interface RiskAssessment {
  max_exposure: number;
  likely_cost: number;
  cleanup_hours_worst: number;
  recommended_deposit: number;
  factors: string[];
  summary: string;
}

interface AiResult {
  checklist: { area_key: string; area_name: string; tasks: string[]; needs_photos?: boolean }[];
  risk: RiskAssessment;
  email_intro: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

function normalizeChecklist(raw: AiResult["checklist"]): ChecklistArea[] {
  const seen = new Set<string>();
  return (raw || [])
    .filter((a) => a && a.area_name && Array.isArray(a.tasks) && a.tasks.length)
    .map((a) => {
      let key = slug(a.area_key || a.area_name) || "area";
      while (seen.has(key)) key += "_2";
      seen.add(key);
      return {
        area_key: key,
        area_name: String(a.area_name).slice(0, 80),
        needs_photos: a.needs_photos !== false,
        tasks: a.tasks.slice(0, 15).map((t, i) => ({ key: `${key}:${i + 1}`, text: String(t).slice(0, 240) })),
      };
    });
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const auth = await requireFunctionRoles(req, sb, ["admin", "oracle", "staff"]);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const requestId = String(body.event_request_id || "");
    const sendEmail = body.send_email !== false;
    const regenerate = body.regenerate === true;
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "event_request_id required" }, 400);

    const { data: r, error: rErr } = await sb
      .from("event_hosting_requests")
      .select("*, person:person_id(id, first_name, last_name, email, phone)")
      .eq("id", requestId)
      .single();
    if (rErr || !r) return json({ error: "Event request not found" }, 404);
    const email = String(r.person?.email || "").toLowerCase().trim();
    if (!email.includes("@")) return json({ error: "Host has no email address" }, 400);

    const { data: spaceRows } = await sb
      .from("event_request_spaces")
      .select("space_type, space:space_id(name)")
      .eq("event_request_id", requestId);
    const spaceNames = (spaceRows || [])
      .filter((s: any) => s.space_type !== "excluded")
      .map((s: any) => s.space?.name)
      .filter(Boolean) as string[];

    // ── Resident? ──
    const { data: appUser } = await sb
      .from("app_users")
      .select("id, email, role, is_current_resident")
      .ilike("email", email)
      .maybeSingle();
    const isResident = !!appUser?.is_current_resident;

    const updates: Record<string, unknown> = {
      is_resident_host: isResident,
      cleaning_base_fee: isResident ? 15 : 30,
      cleaning_min_charge: isResident ? 20 : 35,
      cleaning_rate_per_hour: 30,
      updated_at: new Date().toISOString(),
    };

    // ── AI checklist + exposure ──
    let checklist: ChecklistArea[] = r.cleaning_checklist || [];
    let risk: RiskAssessment | null = r.risk_assessment || null;
    let emailIntro = "";
    let aiError: string | null = null;

    if (regenerate || !checklist.length || !risk) {
      const { data: templates } = await sb
        .from("event_cleaning_area_templates")
        .select("area_key, area_name, space_names, always_include, tasks")
        .eq("is_active", true)
        .order("sort_order");
      const relevant = (templates || []).filter((t: any) =>
        t.always_include || (t.space_names || []).some((n: string) => spaceNames.includes(n))
      );

      const hours = r.event_start_time && r.event_end_time
        ? `${r.event_start_time}–${r.event_end_time}` : "unknown";
      const prompt = `You plan post-event cleanup for Alpaca Playhouse, a shared house in Austin with alpacas, used for events.

EVENT
- Name: ${r.event_name}
- Type: ${r.event_type}
- Description: ${r.event_description || ""}
- Special requests: ${r.special_requests || "none"}
- Date and hours: ${r.event_date} ${hours}
- Expected guests: ${r.expected_guests}
- Ticketed: ${r.is_ticketed ? "yes" : "no"}
- Spaces booked: ${spaceNames.join(", ") || "none listed"}
- Host is a house resident: ${isResident ? "yes" : "no"}

STANDARD CLEANING AREAS AND TASKS (start from these):
${JSON.stringify(relevant.map((t: any) => ({ area_key: t.area_key, area_name: t.area_name, tasks: t.tasks })), null, 1)}

Cleanup is billed at $30/hour for our cleaner. House rules: no meat cooked inside, no alcohol inside, quiet after 9:30pm, cleaning done by 1:01pm the day after.

Return JSON:
{
  "checklist": [ { "area_key": string, "area_name": string, "tasks": [string], "needs_photos": boolean } ],
  "risk": {
    "max_exposure": number,        // worst realistic total cost to us in USD (cleaning labor, laundry, replacing consumables, minor damage)
    "likely_cost": number,         // typical cost if the host cleans reasonably well
    "cleanup_hours_worst": number, // cleaner hours if the host does no cleanup at all
    "recommended_deposit": number, // deposit that covers the realistic exposure
    "factors": [string],           // the 2-5 things driving the number
    "summary": string              // one sentence for staff
  },
  "email_intro": string            // 2-3 friendly sentences to the host, by first name (${r.person?.first_name || "there"}), explaining they are responsible for cleaning after the event and that photos protect their deposit. No markdown.
}

Checklist rules:
- Keep only areas this event will actually use; add an area if the event clearly needs one that is missing.
- Tailor tasks to the event. Example: sauna or spa use means every towel and robe must be washed, dried, folded and put back. Food means dishes, counters, compost. Kids mean toys and sticky surfaces. Dancing means floors.
- Each task is one short, concrete, checkable instruction. Keep supply locations exactly as the template states them; never invent where anything is kept (no sheds, deck boxes or closets the template doesn't mention).
- needs_photos=true for every physical area guests use (before and after photos are required); false only for process items like trash or laundry.
- Keep it to what a host can do in 30-90 minutes with a few helpers.
- SAFETY: never tell the host to drain, refill, add chemicals to, or adjust any hot tub, swim spa, cold plunge or sauna; the most they do is turn things off and cover them. Trash stays in tied black bags at the house (never "to the curb"). Areas you add that have no template get only generic tasks (tidy, wipe surfaces, sweep, trash in bags, towels to laundry).`;

      try {
        const ai = await geminiJson<AiResult>({ prompt, maxOutputTokens: 6000 });
        const normalized = normalizeChecklist(ai.checklist);
        if (normalized.length) checklist = normalized;
        if (ai.risk && typeof ai.risk.max_exposure === "number") {
          risk = {
            max_exposure: Math.round(ai.risk.max_exposure),
            likely_cost: Math.round(ai.risk.likely_cost || 0),
            cleanup_hours_worst: Number(ai.risk.cleanup_hours_worst || 0),
            recommended_deposit: Math.round(ai.risk.recommended_deposit || 0),
            factors: (ai.risk.factors || []).slice(0, 6).map(String),
            summary: String(ai.risk.summary || ""),
          };
        }
        emailIntro = String(ai.email_intro || "").slice(0, 800);
      } catch (e) {
        aiError = (e as Error).message;
        console.error("AI checklist failed, using templates:", aiError);
      }

      if (!checklist.length) {
        // Fallback: the templates as they are
        checklist = normalizeChecklist(relevant.map((t: any) => ({
          area_key: t.area_key, area_name: t.area_name, tasks: t.tasks, needs_photos: !["trash", "laundry"].includes(t.area_key),
        })));
      }
      updates.cleaning_checklist = checklist;
      updates.cleaning_checklist_generated_at = new Date().toISOString();
      if (risk) {
        updates.risk_assessment = risk;
        updates.risk_assessed_at = new Date().toISOString();
      }
    }

    // Residents: deposit between $35 and $75, set from the exposure estimate, unless already paid
    if (isResident && !r.cleaning_deposit_paid) {
      const rec = risk?.recommended_deposit ?? RESIDENT_DEPOSIT_MIN;
      updates.cleaning_deposit = Math.min(RESIDENT_DEPOSIT_MAX, Math.max(RESIDENT_DEPOSIT_MIN, Math.round(rec / 5) * 5));
    }

    // ── Account / payout identity ──
    let access: "linked" | "invited" | "invite_pending" = "invited";
    if (appUser) {
      let { data: profile } = await sb.from("associate_profiles").select("id").eq("app_user_id", appUser.id).maybeSingle();
      if (!profile) {
        const ins = await sb.from("associate_profiles").insert({
          app_user_id: appUser.id, hourly_rate: 0, is_active: true, profile_kind: "event_host",
          notes: "Event host: receives deposit refunds",
        }).select("id").single();
        if (ins.error) throw new Error(`Could not create host profile: ${ins.error.message}`);
        profile = ins.data;
      }
      updates.associate_profile_id = profile!.id;
      access = "linked";
    } else {
      const { data: pending } = await sb.from("user_invitations")
        .select("id").eq("email", email).eq("status", "pending").limit(1);
      if (pending?.length) {
        access = "invite_pending";
      } else {
        const expires = new Date(Date.now() + 90 * 86400_000).toISOString();
        const inv = await sb.from("user_invitations").insert({
          email, role: "associate",
          invited_by: auth.caller?.isServiceRole ? null : auth.caller?.appUser?.id,
          expires_at: expires,
        });
        if (inv.error) throw new Error(`Could not create invitation: ${inv.error.message}`);
      }
    }

    const { error: upErr } = await sb.from("event_hosting_requests").update(updates).eq("id", requestId);
    if (upErr) throw new Error(`Could not save: ${upErr.message}`);

    // ── Email ──
    let emailed = false;
    if (sendEmail) {
      const link = `${SITE}/associates/eventcleaning.html?event=${requestId}`;
      const loginLink = `${SITE}/login/?redirect=${encodeURIComponent(`/associates/eventcleaning.html?event=${requestId}`)}`;
      const first = r.person?.first_name || "there";
      const deposit = Number(updates.cleaning_deposit ?? r.cleaning_deposit ?? 0);
      const baseFee = Number(updates.cleaning_base_fee);
      const minCharge = Number(updates.cleaning_min_charge);
      const intro = emailIntro ||
        `Hi ${first}, your event "${r.event_name}" is approved. You and your crew are responsible for cleaning up afterwards, and photos are how you get your deposit back.`;
      const areasHtml = checklist.map((a) => `
        <h3 style="margin:18px 0 6px;font-size:15px;">${esc(a.area_name)}${a.needs_photos ? ' <span style="font-weight:normal;color:#7a7d8c;font-size:12px;">(before + after photos)</span>' : ""}</h3>
        <ul style="margin:0;padding-left:20px;">${a.tasks.map((t) => `<li style="margin:3px 0;">${esc(t.text)}</li>`).join("")}</ul>`).join("");
      const html = `
        <p>${esc(intro)}</p>
        <p style="margin:20px 0;"><a href="${link}" style="background:#2d6a4f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Open your cleaning checklist &amp; photo upload</a></p>
        <p style="font-size:13px;color:#555;">Sign in with <strong>${esc(email)}</strong> (Google, or create a password on the <a href="${loginLink}">sign-in page</a>). That account is also how we pay your deposit refund.</p>
        <h2 style="font-size:17px;margin-top:24px;">How it works</h2>
        <ol style="padding-left:20px;">
          <li><strong>Before guests arrive:</strong> photograph every area on the list. Our AI checks them and tells you if any are missing or unclear.</li>
          <li><strong>After the event:</strong> work through the checklist below. Everything must be done by <strong>1:01pm the day after</strong>.</li>
          <li><strong>When you're done:</strong> photograph every area again from the same angles and press "Submit for inspection". If a photo is unclear we'll ask for another.</li>
          <li><strong>Get paid back:</strong> set up your payout on the same page. A cleaning inspector checks the house and your refund goes out.</li>
        </ol>
        <h2 style="font-size:17px;margin-top:24px;">Charges</h2>
        <ul style="padding-left:20px;">
          <li>No before photos, or no after photos: <strong>$35</strong>.</li>
          <li>If the inspector finds it isn't clean, we finish the job and deduct <strong>$${baseFee} + $30/hour</strong> (minimum $${minCharge}), up to the full cost of cleaning.</li>
          ${deposit ? `<li>Your cleaning deposit: <strong>$${deposit}</strong>, refunded minus any charges.</li>` : ""}
        </ul>
        <h2 style="font-size:17px;margin-top:24px;">Your cleaning checklist</h2>
        ${areasHtml}
        <p style="margin-top:24px;font-size:13px;color:#555;">Questions? Just reply to this email.</p>`;
      const text = `${intro}\n\nOpen your checklist and photo upload: ${link}\nSign in with ${email}.\n\n` +
        `Before guests arrive: photograph every area. After: do the checklist by 1:01pm the next day, photograph again and submit.\n` +
        `Missing before or after photos: $35. Not clean on inspection: $${baseFee} + $30/hour (min $${minCharge}).\n\n` +
        checklist.map((a) => `${a.area_name}\n${a.tasks.map((t) => `- ${t.text}`).join("\n")}`).join("\n\n");

      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          type: "event_notification",
          to: email,
          subject: `Your event "${r.event_name}": cleaning checklist and photo upload`,
          data: { _raw_html: html, text, subject: `Your event "${r.event_name}": cleaning checklist and photo upload` },
        }),
      });
      emailed = res.ok;
      if (!res.ok) console.error("send-email failed", res.status, await res.text().catch(() => ""));
      if (emailed) {
        await sb.from("event_hosting_requests").update({ cleaning_portal_sent_at: new Date().toISOString() }).eq("id", requestId);
      }
    }

    return json({
      success: true,
      is_resident: isResident,
      access,
      areas: checklist.length,
      risk,
      cleaning_deposit: updates.cleaning_deposit ?? r.cleaning_deposit,
      emailed,
      ai_error: aiError,
    });
  } catch (e) {
    console.error("event-host-onboard error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
