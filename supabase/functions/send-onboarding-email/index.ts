/**
 * Send Onboarding Email — Edge Function
 *
 * Triggered by pg_cron daily at 9:00 AM Central (14:00 UTC).
 * Finds rental applications where onboarding_email_send_at <= now()
 * and onboarding_email_sent_at IS NULL, then sends the move_in_confirmed
 * email for each and marks them sent.
 *
 * Deploy: supabase functions deploy send-onboarding-email --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  const results: { name: string; email: string; status: string }[] = [];

  try {
    // Find applications due for onboarding email
    const { data: apps, error: queryErr } = await sb
      .from("rental_applications")
      .select(`
        id,
        approved_move_in,
        approved_lease_end,
        approved_rate,
        check_in_time,
        check_out_time,
        person:person_id(id, first_name, last_name, email),
        approved_space:approved_space_id(id, name, resident_guide),
        desired_space:desired_space_id(id, name, resident_guide)
      `)
      .not("onboarding_email_send_at", "is", null)
      .is("onboarding_email_sent_at", null)
      .lte("onboarding_email_send_at", new Date().toISOString());

    if (queryErr) throw new Error(`Query failed: ${queryErr.message}`);
    if (!apps || apps.length === 0) {
      return jsonResponse({ success: true, message: "No onboarding emails due", results });
    }

    for (const app of apps) {
      const person = app.person as any;
      if (!person?.email) {
        results.push({ name: "unknown", email: "none", status: "skipped — no email" });
        continue;
      }

      const space = (app.approved_space || app.desired_space) as any;
      const name = `${person.first_name || ""} ${person.last_name || ""}`.trim();

      // Calculate if monthly
      const moveIn = app.approved_move_in ? new Date(app.approved_move_in) : null;
      const leaseEnd = app.approved_lease_end ? new Date(app.approved_lease_end) : null;
      const stayDays = (moveIn && leaseEnd)
        ? Math.round((leaseEnd.getTime() - moveIn.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const isMonthly = stayDays === null || stayDays > 30;

      // Format date for display
      const formatDate = (d: string | null) => {
        if (!d) return null;
        return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        });
      };

      try {
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            type: "move_in_confirmed",
            to: person.email,
            data: {
              first_name: person.first_name,
              email: person.email,
              space_name: space?.name || "your space",
              space_id: space?.id || null,
              move_in_date: formatDate(app.approved_move_in),
              lease_end_date: app.approved_lease_end ? formatDate(app.approved_lease_end) : null,
              monthly_rate: app.approved_rate,
              rent_due_day: "1st",
              is_monthly: isMonthly,
              check_in_time: app.check_in_time || null,
              check_out_time: app.check_out_time || null,
              resident_guide: space?.resident_guide || null,
            },
          }),
        });

        if (!sendRes.ok) {
          const errText = await sendRes.text();
          results.push({ name, email: person.email, status: `send failed: ${errText}` });
          continue;
        }

        // Mark as sent
        await sb
          .from("rental_applications")
          .update({ onboarding_email_sent_at: new Date().toISOString() })
          .eq("id", app.id);

        results.push({ name, email: person.email, status: "sent" });
      } catch (sendErr: any) {
        results.push({ name, email: person.email, status: `error: ${sendErr.message}` });
      }
    }

    return jsonResponse({ success: true, sent: results.filter(r => r.status === "sent").length, results });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message, results }, 500);
  }
});

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
