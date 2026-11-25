/**
 * Confirm Deposit Payment Edge Function
 *
 * Handles admin clicking the "Confirm" link from a Zelle payment notification email.
 * Looks up the pending confirmation by token, records the deposit payment,
 * and returns an HTML success/error page.
 *
 * Deploy with: supabase functions deploy confirm-deposit-payment --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import { ROUTES, absoluteUrl } from "../_shared/routes.ts";

const RESEND_API_URL = "https://api.resend.com";

function htmlPage(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Alpaca Playhouse</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; background: #faf9f6; color: #333; }
    .card { background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .success { border-left: 4px solid #2d7d46; }
    .error { border-left: 4px solid #e74c3c; }
    h2 { margin-top: 0; }
    .btn { display: inline-block; padding: 10px 20px; background: #c8a96e; color: white; text-decoration: none; border-radius: 4px; margin-top: 15px; }
    table { border-collapse: collapse; width: 100%; margin: 15px 0; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    td:first-child { font-weight: bold; width: 40%; }
  </style>
</head>
<body>
  <div class="card ${title === 'Payment Confirmed' ? 'success' : 'error'}">
    ${body}
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return htmlPage("Error", "<h2>Missing Token</h2><p>No confirmation token provided.</p>");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Look up confirmation
    const { data: conf, error } = await supabase
      .from("deposit_payment_confirmations")
      .select("*, application:rental_application_id(*, person:person_id(id, first_name, last_name, email))")
      .eq("token", token)
      .single();

    if (error || !conf) {
      return htmlPage("Not Found", "<h2>Confirmation Not Found</h2><p>This link may have already been used or is invalid.</p>");
    }

    if (conf.status !== "pending") {
      return htmlPage("Already Processed", `<h2>Already ${conf.status.charAt(0).toUpperCase() + conf.status.slice(1)}</h2><p>This payment confirmation was already processed.</p>`);
    }

    if (new Date(conf.expires_at) < new Date()) {
      await supabase
        .from("deposit_payment_confirmations")
        .update({ status: "expired" })
        .eq("id", conf.id);
      return htmlPage("Expired", "<h2>Link Expired</h2><p>This confirmation link has expired. Please record the payment manually in the admin panel.</p>");
    }

    const application = conf.application;
    if (!application || !application.person) {
      return htmlPage("Error", "<h2>Application Not Found</h2><p>The linked rental application could not be found.</p>");
    }

    const { data: result, error: applyError } = await supabase.rpc('apply_deposit_confirmation', { p_token: token });
    if (applyError) throw applyError;
    if (result.status !== 'applied') return htmlPage('Already processed', '<p>This confirmation has already been processed.</p>');
    const depositsRecorded: string[] = result.lines;
    const personName = `${application.person.first_name} ${application.person.last_name}`;

    // Save name mapping for future payments
    const normalized = conf.sender_name.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9\s]/g, "");
    await supabase.from("payment_sender_mappings").upsert(
      {
        sender_name: conf.sender_name,
        sender_name_normalized: normalized,
        person_id: application.person_id,
        confidence_score: 1.0,
        match_source: "zelle_admin_confirmed",
        updated_at: now,
      },
      { onConflict: "sender_name_normalized" }
    );

    // Send notification to admin
    const adminUrl = `${absoluteUrl(ROUTES.staff.rentals)}#applicant=${application.id}`;

    try {
      await fetch(`${RESEND_API_URL}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: SENDER_MAP.pai.from,
          reply_to: SENDER_MAP.pai.reply_to,
          to: ["team@alpacaplayhouse.com"],
          subject: `Payment Confirmed: $${conf.amount} from ${conf.sender_name} → ${personName}`,
          html: `
            <div style="font-family:-apple-system,sans-serif;">
              <h2 style="color:#2d7d46;">Payment Confirmed by Admin</h2>
              <p>$${Number(conf.amount).toFixed(2)} from ${conf.sender_name} has been recorded for ${personName}.</p>
              <ul>${depositsRecorded.map((d: string) => `<li>${d}</li>`).join("")}</ul>
              <p><a href="${adminUrl}">View Application</a></p>
            </div>
          `,
        }),
      });
    } catch (emailErr) {
      console.error("Failed to send confirmation notification:", emailErr);
    }

    // Return success page
    return htmlPage(
      "Payment Confirmed",
      `
      <h2>&#x2705; Payment Confirmed!</h2>
      <table>
        <tr><td>Amount</td><td>$${Number(conf.amount).toFixed(2)}</td></tr>
        <tr><td>From</td><td>${conf.sender_name}</td></tr>
        <tr><td>Recorded For</td><td>${personName}</td></tr>
        ${conf.confirmation_number ? `<tr><td>Confirmation #</td><td>${conf.confirmation_number}</td></tr>` : ""}
      </table>
      <ul>${depositsRecorded.map((d: string) => `<li>&#x2705; ${d}</li>`).join("")}</ul>
      <a href="${adminUrl}" class="btn">View Application</a>
    `
    );
  } catch (err) {
    console.error("Confirm deposit payment error:", err);
    return htmlPage("Error", `<h2>Something went wrong</h2><p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
  }
});
