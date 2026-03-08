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
      return redirectToConfirmation("error", "Invalid Request", "Missing or invalid token/action.");
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
      return redirectToConfirmation("error", "Not Found", "This approval link is invalid or has expired.");
    }

    if (approval.status !== "pending") {
      const ts = new Date(approval.approved_at || approval.created_at)
        .toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
      return redirectToConfirmation(
        "warning",
        "Already Processed",
        `This email was already ${approval.status} on ${ts} CT.`,
      );
    }

    if (new Date(approval.expires_at) < new Date()) {
      await sb.from("pending_email_approvals").update({ status: "expired" }).eq("id", approval.id);
      return redirectToConfirmation("warning", "Expired", "This approval link has expired (7-day limit).");
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
      return redirectToConfirmation("error", "Send Failed", `Failed to send email (${sendRes.status}). Please try again or contact support.`);
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

    let autoType = "";

    // If approve_all, disable approval for this type going forward
    if (action === "approve_all") {
      await sb.from("email_type_approval_config").update({
        requires_approval: false,
        auto_approved_at: new Date().toISOString(),
        auto_approved_by: "admin_button",
        updated_at: new Date().toISOString(),
      }).eq("email_type", approval.email_type);

      autoType = approval.email_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    }

    const recipientDisplay = approval.to_addresses.join(", ");
    return redirectToConfirmation("success",
      "Email Approved & Sent",
      `The email "<strong>${approval.subject}</strong>" has been sent to <strong>${recipientDisplay}</strong>.`,
      autoType,
    );
  } catch (err) {
    console.error("Approve-email error:", err);
    return redirectToConfirmation("error", "Error", `An unexpected error occurred: ${(err as Error).message}`);
  }
});

const CONFIRM_PAGE = "https://alpacaplayhouse.com/admin/email-approved.html";

function redirectToConfirmation(status: string, title: string, message: string, autoType?: string): Response {
  const url = new URL(CONFIRM_PAGE);
  url.searchParams.set("status", status);
  url.searchParams.set("title", title);
  url.searchParams.set("message", message);
  if (autoType) url.searchParams.set("auto_type", autoType);
  return Response.redirect(url.toString(), 302);
}

function htmlFallback(title: string, message: string, status: number): Response {
  return new Response(
    `${title}: ${message.replace(/<[^>]*>/g, "")}`,
    { status, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
