/**
 * Event Photo Review (AI)
 *
 * mode "before": checks that every area on the host's cleaning checklist has clear before photos,
 *   and records anything already dirty or damaged (the baseline the after photos are judged against).
 * mode "after": compares after photos with before photos area by area, estimates remaining cleanup
 *   for the inspector, and when an area is missing or can't be judged, asks the host for more photos
 *   (saved on the request and emailed).
 *
 * The AI is advisory only: it never passes/fails an inspection or sets a charge.
 *
 * POST { event_request_id, mode: "before" | "after", notify?: boolean }
 * Auth: the event's host (associate profile linked to the request) or staff/admin.
 *
 * Deploy: supabase functions deploy event-photo-review
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { resolveFunctionCaller } from "../_shared/require-auth.ts";
import { checkRateLimit } from "../_shared/function-wrapper.ts";
import { fetchImageBase64, geminiJson, type GeminiImage } from "../_shared/gemini-json.ts";

const SITE = "https://alpacaplayhouse.com";
const MAX_PER_AREA_PHASE = 3;
const MAX_IMAGES = 36;

interface Area { area_key: string; area_name: string; needs_photos: boolean; tasks: { key: string; text: string }[] }
interface Photo { id: string; photo_type: string; cleaning_area_key: string | null; created_at: string; url: string }

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const who = await resolveFunctionCaller(req, sb);
  if (who.response || !who.caller) return who.response!;

  try {
    const body = await req.json().catch(() => ({}));
    const requestId = String(body.event_request_id || "");
    const mode = body.mode === "after" ? "after" : "before";
    const notify = body.notify !== false;
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "event_request_id required" }, 400);

    const { data: r } = await sb
      .from("event_hosting_requests")
      .select("id, event_name, event_date, event_type, event_description, associate_profile_id, cleaning_checklist, before_photo_review, inspection_status, person:person_id(first_name, email)")
      .eq("id", requestId)
      .single();
    if (!r) return json({ error: "Event request not found" }, 404);

    // Host of this event, or staff
    const role = who.caller.appUser?.role;
    const isStaff = who.caller.isServiceRole || ["admin", "oracle", "staff"].includes(role || "");
    if (!isStaff) {
      const { data: prof } = await sb.from("associate_profiles").select("id").eq("app_user_id", who.caller.appUser?.id).maybeSingle();
      if (!prof || prof.id !== r.associate_profile_id) return json({ error: "Not your event" }, 403);
    }
    if (!(await checkRateLimit(sb, "event-photo-review", requestId, 30, 3600))) {
      return json({ error: "Too many reviews for this event, try again in a bit" }, 429);
    }

    const checklist: Area[] = r.cleaning_checklist || [];
    const photoAreas = checklist.filter((a) => a.needs_photos);
    if (!photoAreas.length) return json({ error: "This event has no cleaning checklist yet" }, 409);

    const { data: rows } = await sb
      .from("work_photos")
      .select("id, photo_type, cleaning_area_key, created_at, media:media_id(url)")
      .eq("event_request_id", requestId)
      .order("created_at", { ascending: false });
    const photos: Photo[] = (rows || []).map((p: any) => ({ ...p, url: p.media?.url })).filter((p: Photo) => p.url);

    const phases = mode === "after" ? ["before", "after"] : ["before"];
    const picked: { label: string; photo: Photo }[] = [];
    const missing: { area_key: string; area_name: string; reason: string }[] = [];
    for (const a of photoAreas) {
      for (const phase of phases) {
        const list = photos.filter((p) => p.photo_type === phase && p.cleaning_area_key === a.area_key).slice(0, MAX_PER_AREA_PHASE);
        if (!list.length && phase === mode) missing.push({ area_key: a.area_key, area_name: a.area_name, reason: `No ${phase} photo yet` });
        list.forEach((p, i) => picked.push({ label: `${a.area_key} | ${phase} | photo ${i + 1}`, photo: p }));
      }
    }
    const limited = picked.slice(0, MAX_IMAGES);
    const images = await Promise.all(limited.map((x) => fetchImageBase64(x.photo.url)));
    const sent: { label: string; img: GeminiImage }[] = [];
    limited.forEach((x, i) => { if (images[i]) sent.push({ label: x.label, img: images[i]! }); });

    const areasForPrompt = photoAreas.map((a) => ({ area_key: a.area_key, area_name: a.area_name, tasks: a.tasks.map((t) => t.text) }));
    const imageIndex = sent.map((s, i) => `Image ${i + 1}: ${s.label}`).join("\n");

    let review: any = null;
    if (sent.length) {
      const prompt = mode === "before"
        ? `You review BEFORE photos a host took of Alpaca Playhouse before their event "${r.event_name}" (${r.event_type}).
They establish what each area looked like before guests arrived.

Areas that need photos:
${JSON.stringify(areasForPrompt, null, 1)}

Images, in order:
${imageIndex}

For each area decide:
- "status": "ok" if the photos clearly show the area (lit, in focus, wide enough to judge cleanliness), "unclear" if they don't, "missing" if no image is labelled with that area.
- "notes": one short sentence. If unclear, say exactly what photo to retake (e.g. "Too dark — turn on the lights and shoot the whole counter").
- "baseline_issues": anything already dirty, damaged or out of place BEFORE the event (so the host isn't blamed later). Empty array if none.
- "wrong_area": true if the photo clearly shows a different space than the label.

Return JSON: {"areas":[{"area_key":string,"status":"ok"|"unclear"|"missing","notes":string,"baseline_issues":[string],"wrong_area":boolean}],"summary":string}
summary = one or two sentences to the host.`
        : `You compare BEFORE and AFTER photos of Alpaca Playhouse for the event "${r.event_name}" (${r.event_type}).
The host had to clean using this checklist:
${JSON.stringify(areasForPrompt, null, 1)}

What the before photos showed (baseline issues the host is not responsible for):
${JSON.stringify(r.before_photo_review?.areas?.map((a: any) => ({ area_key: a.area_key, baseline_issues: a.baseline_issues })) || [], null, 1)}

Images, in order:
${imageIndex}

For each area:
- "photo_quality": "clear" if the after photos let you judge cleanliness, "unclear" if not (dark, blurry, too close, wrong area), "missing" if no after photo.
- "clean_status": "clean", "needs_work", or "cant_tell".
- "issues": concrete things still not done (trash left, dishes, towels not folded, furniture moved vs the before photo...). Empty if none.
- "retake": if photo_quality is not "clear", exactly what photo the host should take. Otherwise "".
- "est_minutes": minutes a cleaner would need to finish this area (0 if clean).

Return JSON:
{"areas":[{"area_key":string,"photo_quality":"clear"|"unclear"|"missing","clean_status":"clean"|"needs_work"|"cant_tell","issues":[string],"retake":string,"est_minutes":number}],
 "likely_pass": boolean, "est_cleanup_minutes": number,
 "inspector_summary": string,   // 1-3 sentences for the cleaning inspector
 "host_message": string}        // 1-2 friendly sentences to the host`;
      review = await geminiJson<any>({ prompt, images: sent.map((s) => s.img), maxOutputTokens: 6000 });
    }

    const areaName = (k: string) => photoAreas.find((a) => a.area_key === k)?.area_name || k;
    const reviewAreas: any[] = Array.isArray(review?.areas) ? review.areas : [];
    const now = new Date().toISOString();

    if (mode === "before") {
      const retakes = reviewAreas
        .filter((a) => a.status === "unclear" || a.wrong_area)
        .map((a) => ({ area_key: a.area_key, area_name: areaName(a.area_key), reason: a.notes || "Photo is unclear" }));
      const result = {
        reviewed_at: now,
        images_reviewed: sent.length,
        areas: photoAreas.map((a) => {
          const ai = reviewAreas.find((x) => x.area_key === a.area_key);
          const isMissing = missing.some((m) => m.area_key === a.area_key);
          return {
            area_key: a.area_key, area_name: a.area_name,
            status: isMissing ? "missing" : (ai?.wrong_area ? "unclear" : ai?.status || "ok"),
            notes: isMissing ? "No before photo yet" : ai?.notes || "",
            baseline_issues: ai?.baseline_issues || [],
          };
        }),
        needs: [...missing, ...retakes],
        summary: review?.summary || (missing.length ? "Some areas still need before photos." : ""),
      };
      await sb.from("event_hosting_requests")
        .update({ before_photo_review: result, before_photos_reviewed_at: now, updated_at: now })
        .eq("id", requestId);
      if (notify && isStaff && result.needs.length) await emailHost(r, "before", result.needs, result.summary);
      return json({ success: true, review: result });
    }

    // after
    const needMore = [
      ...missing,
      ...reviewAreas
        .filter((a) => a.photo_quality === "unclear" || a.clean_status === "cant_tell")
        .filter((a) => !missing.some((m) => m.area_key === a.area_key))
        .map((a) => ({ area_key: a.area_key, area_name: areaName(a.area_key), reason: a.retake || "We can't tell if this area is clean from the photo" })),
    ];
    const result = {
      reviewed_at: now,
      images_reviewed: sent.length,
      areas: photoAreas.map((a) => {
        const ai = reviewAreas.find((x) => x.area_key === a.area_key);
        const isMissing = missing.some((m) => m.area_key === a.area_key);
        return {
          area_key: a.area_key, area_name: a.area_name,
          photo_quality: isMissing ? "missing" : ai?.photo_quality || "clear",
          clean_status: isMissing ? "cant_tell" : ai?.clean_status || "cant_tell",
          issues: ai?.issues || [],
          est_minutes: Number(ai?.est_minutes || 0),
        };
      }),
      likely_pass: needMore.length ? null : !!review?.likely_pass,
      est_cleanup_minutes: Number(review?.est_cleanup_minutes || 0),
      inspector_summary: review?.inspector_summary || "",
      host_message: review?.host_message || "",
      needs: needMore,
    };
    const upd: Record<string, unknown> = { after_photo_review: result, after_photos_reviewed_at: now, updated_at: now };
    if (needMore.length) {
      upd.more_photos_requested_at = now;
      upd.more_photos_request = needMore;
    } else {
      upd.more_photos_request = null;
    }
    await sb.from("event_hosting_requests").update(upd).eq("id", requestId);
    if (notify && needMore.length) await emailHost(r, "after", needMore, result.host_message);

    return json({ success: true, review: result });
  } catch (e) {
    console.error("event-photo-review error", e);
    return json({ error: (e as Error).message }, 500);
  }

  async function emailHost(r: any, phase: string, needs: { area_name: string; reason: string }[], message: string) {
    const to = r.person?.email;
    if (!to) return;
    const link = `${SITE}/associates/eventcleaning.html?event=${r.id}`;
    const html = `
      <p>Hi ${esc(r.person?.first_name || "there")},</p>
      <p>${esc(message || `We need a few more ${phase} photos for "${r.event_name}" to check the house.`)}</p>
      <ul>${needs.map((n) => `<li><strong>${esc(n.area_name)}:</strong> ${esc(n.reason)}</li>`).join("")}</ul>
      <p style="margin:20px 0;"><a href="${link}" style="background:#2d6a4f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Add the photos</a></p>
      <p style="font-size:13px;color:#555;">Missing before or after photos cost $35 from your deposit, so it's worth the minute.</p>`;
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        type: "event_notification",
        to,
        subject: `More ${phase} photos needed: ${r.event_name}`,
        data: { _raw_html: html, subject: `More ${phase} photos needed: ${r.event_name}`, text: needs.map((n) => `${n.area_name}: ${n.reason}`).join("\n") + `\n\n${link}` },
      }),
    });
    if (!res.ok) console.error("send-email failed", res.status);
  }
});
