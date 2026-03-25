/**
 * Weekly Schedule Report Edge Function
 *
 * Triggered by pg_cron every Sunday at 7:00 PM Central (00:00 UTC Monday).
 * Queries the upcoming week's schedule for each active associate and sends
 * a summary email to configured recipients.
 *
 * Currently configured for:
 *   - Justin Gilbertson's schedule
 *   - Recipients: sheppardsustainable@gmail.com (Jon Sheppard), rahulioson@gmail.com
 *
 * Deploy: supabase functions deploy weekly-schedule-report --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Recipients for the weekly schedule report
const SCHEDULE_REPORT_RECIPIENTS = [
  "sheppardsustainable@gmail.com",
  "rahulioson@gmail.com",
];

// Associates to include in the report (by email)
const TRACKED_ASSOCIATES = [
  "justin.gilbertson1@gmail.com",
];

serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  const results: { associate: string; status: string; days?: number }[] = [];

  try {
    // Calculate the upcoming work week using Central Time
    // When called Sunday night: show Mon-Sun of the coming week
    // When called mid-week (manual/test): show remaining days through end of week + next week
    const centralNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const centralDateStr = centralNow.toISOString().split("T")[0]; // today in Central

    // Find next Monday from today (Central)
    const dayOfWeek = centralNow.getDay(); // 0=Sun
    const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : (8 - dayOfWeek);
    const nextMonday = new Date(centralNow);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);

    // For the query range: include today through end of next week
    const startStr = centralDateStr;
    const endStr = nextSunday.toISOString().split("T")[0];
    const weekLabel = `${nextMonday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${nextSunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

    // Find tracked associates
    for (const email of TRACKED_ASSOCIATES) {
      const { data: user } = await sb
        .from("app_users")
        .select("id, first_name, last_name, display_name, email")
        .ilike("email", email)
        .single();

      if (!user) {
        results.push({ associate: email, status: "user_not_found" });
        continue;
      }

      const { data: profile } = await sb
        .from("associate_profiles")
        .select("id")
        .eq("app_user_id", user.id)
        .single();

      if (!profile) {
        results.push({ associate: email, status: "no_associate_profile" });
        continue;
      }

      const associateName = user.display_name ||
        `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unknown";

      // Get schedule for the upcoming week
      const { data: schedule, error: schedErr } = await sb
        .from("associate_schedules")
        .select("schedule_date, start_time, end_time, scheduled_minutes")
        .eq("associate_id", profile.id)
        .gte("schedule_date", startStr)
        .lte("schedule_date", endStr)
        .order("schedule_date", { ascending: true });

      if (schedErr) {
        console.error(`Error loading schedule for ${associateName}:`, schedErr);
        results.push({ associate: associateName, status: "error" });
        continue;
      }

      // Send via send-email edge function
      const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;
      const emailResp = await fetch(sendEmailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: "weekly_associate_schedule",
          to: SCHEDULE_REPORT_RECIPIENTS,
          data: {
            associate_name: associateName,
            week_label: weekLabel,
            schedule_days: schedule || [],
          },
        }),
      });

      const emailResult = await emailResp.json();
      if (emailResp.ok) {
        results.push({
          associate: associateName,
          status: "sent",
          days: schedule?.length || 0,
        });
      } else {
        console.error(`Failed to send schedule for ${associateName}:`, emailResult);
        results.push({ associate: associateName, status: "email_failed" });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Weekly schedule report error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
