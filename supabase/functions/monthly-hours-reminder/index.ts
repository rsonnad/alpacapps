/**
 * Monthly Hours Reminder Edge Function
 *
 * Triggered by pg_cron every Friday 23:00 UTC (5pm CST / 6pm CDT).
 * For each active associate with associate_profiles.monthly_min_hours set,
 * compares hours logged this calendar month (America/Chicago) plus the hours
 * still scheduled after today against the minimum. If that total falls short,
 * emails the associate (cc the owner) how many hours they still need by the
 * end of the month.
 *
 * Body (all optional):
 *   dry_run: true      → compute and return results, send nothing
 *   test_to: "a@b.com" → send only to this address (no cc)
 *   force: true        → with test_to only: send even when on track (preview)
 *
 * Deploy: npx supabase functions deploy monthly-hours-reminder --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireCronOrRoles } from "../_shared/require-auth.ts";

const OWNER_CC = ["rahulioson@gmail.com"];
const TZ = "America/Chicago";

/** YYYY-MM-DD for an instant, in Central time. */
function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function fmtHours(h: number): string {
  return (Math.round(h * 100) / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
}

function fmtDate(ymd: string): string {
  return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);
  const auth = await requireCronOrRoles(req, sb, ["admin", "oracle"]);
  if (auth.response) return auth.response;

  let body: { dry_run?: boolean; test_to?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body */ }

  try {
    const today = centralDate(new Date());               // e.g. 2026-11-20
    const [y, m] = today.split("-").map(Number);
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
    const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

    const { data: profiles, error: profErr } = await sb
      .from("associate_profiles")
      .select("id, monthly_min_hours, app_users!associate_profiles_app_user_id_fkey(email, first_name, display_name)")
      .eq("is_active", true)
      .not("monthly_min_hours", "is", null)
      .gt("monthly_min_hours", 0);
    if (profErr) throw profErr;

    const results: Record<string, unknown>[] = [];

    for (const p of profiles || []) {
      const user = (p as any).app_users;
      const name = user?.display_name || user?.first_name || "Associate";
      const firstName = user?.first_name || name.split(" ")[0];
      const minHours = Number(p.monthly_min_hours);

      // Completed, visible time entries whose clock-in falls in this Central month.
      // Query a day early in UTC, then filter by Central date.
      const fromUtc = new Date(Date.UTC(y, m - 1, 1) - 24 * 3600 * 1000).toISOString();
      const { data: entries, error: teErr } = await sb
        .from("time_entries")
        .select("clock_in, clock_out, duration_minutes, is_hidden")
        .eq("associate_id", p.id)
        .gte("clock_in", fromUtc)
        .not("clock_out", "is", null);
      if (teErr) throw teErr;

      let workedMin = 0;
      for (const e of entries || []) {
        if (e.is_hidden) continue;
        const d = centralDate(new Date(e.clock_in));
        if (d < monthStart || d > monthEnd) continue;
        workedMin += e.duration_minutes != null
          ? Number(e.duration_minutes)
          : (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000;
      }
      const worked = workedMin / 60;

      // Scheduled shifts after today, through month end.
      const { data: sched, error: sErr } = await sb
        .from("associate_schedules")
        .select("schedule_date, start_time, end_time, scheduled_minutes")
        .eq("associate_id", p.id)
        .gt("schedule_date", today)
        .lte("schedule_date", monthEnd)
        .order("schedule_date");
      if (sErr) throw sErr;
      const scheduled = (sched || []).reduce((s, r) => s + (r.scheduled_minutes || 0), 0) / 60;

      const needed = Math.max(0, minHours - worked);
      const onTrack = worked + scheduled >= minHours;
      const result: Record<string, unknown> = {
        associate: name, min_hours: minHours, worked: +worked.toFixed(2),
        scheduled_remaining: +scheduled.toFixed(2), still_needed: +needed.toFixed(2),
        on_track: onTrack, month_end: monthEnd,
      };

      // force (test only, requires test_to) sends even when on track.
      const force = !!(body.force && body.test_to);
      if ((onTrack && !force) || body.dry_run) {
        result.status = onTrack ? "on_track_no_email" : "dry_run_would_send";
        results.push(result);
        continue;
      }
      if (!user?.email && !body.test_to) {
        results.push({ ...result, status: "no_email_address" });
        continue;
      }

      const gap = Math.max(0, needed - scheduled);
      const schedLines = (sched || []).map((r) =>
        `<li>${fmtDate(r.schedule_date)}: ${fmtHours((r.scheduled_minutes || 0) / 60)}h</li>`).join("");
      const subject = `Hours check: ${fmtHours(needed)} more hours needed by ${fmtDate(monthEnd)}`;
      const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#2a1f23;max-width:560px;">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Quick check on your ${monthName} hours. The minimum is <strong>${fmtHours(minHours)} hours</strong> for the month.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
    <tr><td style="padding:6px 16px 6px 0;color:#7d6f74;">Logged so far</td><td style="padding:6px 0;font-weight:600;">${fmtHours(worked)}h</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#7d6f74;">Still needed</td><td style="padding:6px 0;font-weight:600;">${fmtHours(needed)}h by ${fmtDate(monthEnd)}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#7d6f74;">Scheduled for the rest of ${monthName}</td><td style="padding:6px 0;font-weight:600;">${fmtHours(scheduled)}h</td></tr>
  </table>
  ${schedLines ? `<p style="margin:8px 0 4px;">Your remaining scheduled days:</p><ul style="margin:0 0 12px;">${schedLines}</ul>` : ""}
  <p>Please add at least <strong>${fmtHours(gap)} more hours</strong> to your schedule before the end of the month.</p>
  <p style="color:#7d6f74;font-size:13px;margin-top:24px;">Automated weekly reminder from Alpaca Playhouse.</p>
</div>`;
      const text = `Hi ${firstName},\n\n${monthName} minimum: ${fmtHours(minHours)}h. Logged so far: ${fmtHours(worked)}h. ` +
        `Still needed: ${fmtHours(needed)}h by ${fmtDate(monthEnd)}. Scheduled for the rest of the month: ${fmtHours(scheduled)}h.\n\n` +
        `Please add at least ${fmtHours(gap)} more hours to your schedule before the end of the month.\n\n— Alpaca Playhouse`;

      const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({
          type: "custom",
          to: body.test_to ? [body.test_to] : [user.email],
          ...(body.test_to ? {} : { cc: OWNER_CC }),
          data: { subject, html, text },
        }),
      });
      const out = await resp.json().catch(() => ({}));
      results.push({ ...result, status: resp.ok ? (out.status || "sent") : "email_failed", detail: resp.ok ? undefined : out });
    }

    return new Response(JSON.stringify({ success: true, today, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("monthly-hours-reminder error:", err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
