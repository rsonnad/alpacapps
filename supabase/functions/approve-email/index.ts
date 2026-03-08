/**
 * Email Approval Handler
 *
 * GET /functions/v1/approve-email?token=XXX&action=approve_one
 * GET /functions/v1/approve-email?token=XXX&action=approve_all
 *
 * Deploy: supabase functions deploy approve-email --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const RESEND_API_URL = "https://api.resend.com/emails";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const action = url.searchParams.get("action");

    if (!token || !action || !["approve_one", "approve_all"].includes(action)) {
      return htmlResponse("Invalid Request", "Missing or invalid token/action.", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Look up pending approval
    const { data: approval, error } = await sb
      .from("pending_email_approvals")
      .select("*")
      .eq("approval_token", token)
      .single();

    if (error || !approval) {
      return htmlResponse("Not Found", "This approval link is invalid or has expired.", 404);
    }

    if (approval.status !== "pending") {
      return htmlResponse(
        "Already Processed",
        `This email was already ${approval.status} on ${new Date(approval.approved_at || approval.created_at).toLocaleString()}.`,
        200,
      );
    }

    if (new Date(approval.expires_at) < new Date()) {
      await sb.from("pending_email_approvals").update({ status: "expired" }).eq("id", approval.id);
      return htmlResponse("Expired", "This approval link has expired (7-day limit).", 410);
    }

    // Send the original email via Resend
    const sendPayload: Record<string, unknown> = {
      from: approval.from_address,
      to: approval.to_addresses,
      subject: approval.subject,
      html: approval.html,
      text: approval.text_content || undefined,
    };
    if (approval.reply_to) sendPayload.reply_to = approval.reply_to;
    if (approval.cc?.length) sendPayload.cc = approval.cc;
    if (approval.bcc?.length) sendPayload.bcc = approval.bcc;

    const sendRes = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendPayload),
    });

    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      console.error("Resend send failed:", errBody);
      return htmlResponse("Send Failed", `Failed to send email: ${sendRes.status}`, 500);
    }

    const sendResult = await sendRes.json();

    // Mark as approved
    await sb.from("pending_email_approvals").update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "button",
    }).eq("id", approval.id);

    // Log usage
    const recipientCount = approval.to_addresses.length;
    await sb.from("api_usage_log").insert({
      vendor: "resend",
      category: `email_${approval.email_type}`,
      endpoint: "POST /emails",
      units: recipientCount,
      unit_type: "emails",
      estimated_cost_usd: recipientCount * 0.00028,
      metadata: {
        resend_id: sendResult.id,
        email_type: approval.email_type,
        recipient_count: recipientCount,
        approved_via: action,
        approval_id: approval.id,
      },
    });

    let extraMessage = "";

    // If approve_all, disable approval for this type going forward
    if (action === "approve_all") {
      await sb.from("email_type_approval_config").update({
        requires_approval: false,
        auto_approved_at: new Date().toISOString(),
        auto_approved_by: "admin_button",
        updated_at: new Date().toISOString(),
      }).eq("email_type", approval.email_type);

      const typeLabel = approval.email_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      extraMessage = `<p style="margin-top:16px;padding:12px 16px;background:#fff8e1;border-left:4px solid #f9a825;border-radius:0 8px 8px 0;font-size:14px;">
        All future <strong>${typeLabel}</strong> emails will now send automatically without approval.
      </p>`;
    }

    const recipientDisplay = approval.to_addresses.join(", ");
    return htmlResponse(
      "Email Approved & Sent",
      `<p>The email "<strong>${approval.subject}</strong>" has been sent to <strong>${recipientDisplay}</strong>.</p>${extraMessage}`,
      200,
    );
  } catch (err) {
    console.error("Approve-email error:", err);
    return htmlResponse("Error", `An unexpected error occurred: ${(err as Error).message}`, 500);
  }
});

function htmlResponse(title: string, body: string, status: number): Response {
  const ok = status >= 200 && status < 300;
  const icon = ok ? "&#10003;" : "&#10007;";
  const color = ok ? "#54a326" : "#e53935";

  return new Response(
    `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title} - AlpacApps</title></head>
<body style="margin:0;padding:40px 16px;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="font-size:48px;color:${color};margin-bottom:16px;">${icon}</div>
    <h1 style="color:#1c1618;font-size:22px;margin:0 0 16px;">${title}</h1>
    <div style="color:#555;font-size:15px;line-height:1.6;">${body}</div>
    <p style="margin-top:24px;color:#999;font-size:12px;">AlpacApps Email Approval System</p>
  </div>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
