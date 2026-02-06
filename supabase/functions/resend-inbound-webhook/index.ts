import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const RESEND_API_URL = "https://api.resend.com";

/**
 * Routing rules for inbound emails to *@alpacaplayhouse.com
 *
 * prefix → { action, forwardTo?, specialLogic? }
 *
 * auto@ = automated system replies (bug reports, error digests, identity verification)
 * team@ = human-facing team replies (rental, events, payments, invitations)
 */
const ROUTING_RULES: Record<string, { action: string; forwardTo?: string; specialLogic?: string }> = {
  "haydn":   { action: "forward", forwardTo: "hrsonnad@gmail.com" },
  "rahulio": { action: "forward", forwardTo: "rahulioson@gmail.com" },
  "sonia":   { action: "forward", forwardTo: "sonia245g@gmail.com" },
  "herd":    { action: "special", specialLogic: "herd" },
  "auto":    { action: "special", specialLogic: "auto" },
  "team":    { action: "forward", forwardTo: "alpacaplayhouse@gmail.com" },
};

const DEFAULT_ROUTE = { action: "forward", forwardTo: "alpacaplayhouse@gmail.com" };

/**
 * Extract the local part (prefix) from an email address.
 * e.g. "haydn@mail.alpacaplayhouse.com" → "haydn"
 */
function extractPrefix(email: string): string {
  return email.split("@")[0].toLowerCase().trim();
}

/**
 * Verify Resend webhook signature (SVIX-based).
 * Returns true if signature is valid.
 */
async function verifyWebhookSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): Promise<boolean> {
  try {
    // Remove "whsec_" prefix from secret and decode base64
    const secretBytes = base64Decode(secret.replace("whsec_", ""));

    // Construct signed content: {msg_id}.{timestamp}.{body}
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(signedContent));
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

    // svix-signature can contain multiple signatures separated by spaces: "v1,sig1 v1,sig2"
    const signatures = svixSignature.split(" ");
    for (const sig of signatures) {
      const sigValue = sig.split(",")[1]; // Remove "v1," prefix
      if (sigValue === expectedSignature) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Signature verification error:", error.message);
    return false;
  }
}

/**
 * Fetch full email content (body) from Resend API.
 * The webhook payload doesn't include the body — we need to fetch it separately.
 */
async function fetchEmailContent(emailId: string, apiKey: string): Promise<{ html: string; text: string } | null> {
  try {
    const res = await fetch(`${RESEND_API_URL}/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`Failed to fetch email content: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return { html: data.html || "", text: data.text || "" };
  } catch (error) {
    console.error("Error fetching email content:", error.message);
    return null;
  }
}

/**
 * Forward an email via Resend send API.
 */
async function forwardEmail(
  apiKey: string,
  to: string,
  originalFrom: string,
  subject: string,
  html: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${originalFrom.replace(/<.*>/, '').trim() || originalFrom} <notifications@alpacaplayhouse.com>`,
        to: [to],
        reply_to: originalFrom,
        subject: subject,
        html: html || `<pre>${text}</pre>`,
        text: text || "(HTML-only email)",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Forward failed: ${res.status} ${errText}`);
      return false;
    }

    console.log(`Forwarded to ${to}`);
    return true;
  } catch (error) {
    console.error("Forward error:", error.message);
    return false;
  }
}

/**
 * Handle special logic for herd@ and auto@ addresses.
 *
 * auto@ handles replies to automated system emails:
 * - Bug report replies (subject contains "Bug by") → creates a follow-up bug report
 *   so the bug fixer worker picks it up for another fix attempt
 * - Other auto@ emails → forwarded to admin for manual review
 */
async function handleSpecialLogic(
  type: string,
  emailRecord: any,
  supabase: any,
  resendApiKey: string
): Promise<void> {
  console.log(`Special logic triggered: type=${type}, from=${emailRecord.from_address}, subject=${emailRecord.subject}`);

  if (type === "auto") {
    await handleAutoReply(emailRecord, supabase, resendApiKey);
  }

  // herd@ - not yet implemented
}

/**
 * Handle replies to auto@ (bug reports, error digests, etc.)
 *
 * Bug report replies: tries to find the original bug report by subject,
 * then creates a new follow-up bug report referencing the original.
 * The bug fixer worker on DigitalOcean will pick it up.
 */
async function handleAutoReply(
  emailRecord: any,
  supabase: any,
  resendApiKey: string
): Promise<void> {
  const subject = emailRecord.subject || "";
  const body = emailRecord.body_text || emailRecord.body_html || "";
  const from = emailRecord.from_address || "";

  // Check if this is a reply to a bug report email
  // Bug report subjects look like: "Re: Bug by John: Something is broken..."
  // or "Re: Screenshot of the Fix" etc.
  const bugReplyMatch = subject.match(/Re:\s*(?:Bug by .+?:\s*|Screenshot of the Fix)/i);

  if (bugReplyMatch) {
    console.log("Detected bug report reply, creating follow-up bug report");

    // Try to find the original bug report by matching the subject
    // Extract the original description from "Bug by Name: <description>"
    const descMatch = subject.match(/Bug by .+?:\s*(.+)/i);
    let originalBugId: string | null = null;

    if (descMatch) {
      const originalDesc = descMatch[1].trim();
      // Search for matching bug report
      const { data: matchingBugs } = await supabase
        .from("bug_reports")
        .select("id, page_url")
        .ilike("description", `%${originalDesc.substring(0, 40)}%`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (matchingBugs && matchingBugs.length > 0) {
        originalBugId = matchingBugs[0].id;
        console.log(`Matched to original bug report: ${originalBugId}`);
      }
    }

    // Extract sender name from email "Name <email@domain>" format
    const nameMatch = from.match(/^([^<]+)/);
    const senderName = nameMatch ? nameMatch[1].trim() : from.split("@")[0];
    const senderEmail = from.match(/<(.+)>/)?.[1] || from;

    // Strip email reply chains — try to get just the new message
    let replyBody = body;
    // Remove common reply markers
    const replyMarkers = [
      /On .+ wrote:/i,
      /-----Original Message-----/i,
      /From:.*\nSent:.*\nTo:/i,
      /_{5,}/,
    ];
    for (const marker of replyMarkers) {
      const idx = replyBody.search(marker);
      if (idx > 0) {
        replyBody = replyBody.substring(0, idx).trim();
        break;
      }
    }

    // Create a new follow-up bug report for the worker
    const { error: insertError } = await supabase
      .from("bug_reports")
      .insert({
        description: `[Follow-up${originalBugId ? ` to bug ${originalBugId}` : ""}] ${replyBody.substring(0, 2000)}`,
        reporter_name: senderName,
        reporter_email: senderEmail,
        page_url: originalBugId
          ? (await supabase.from("bug_reports").select("page_url").eq("id", originalBugId).single())?.data?.page_url
          : null,
        status: "pending",
      });

    if (insertError) {
      console.error("Failed to create follow-up bug report:", insertError);
    } else {
      console.log("Follow-up bug report created from email reply");
    }
  } else {
    // Not a bug report reply — forward to admin for manual review
    console.log("Non-bug auto@ email, forwarding to admin");
    await forwardEmail(
      resendApiKey,
      "alpacaplayhouse@gmail.com",
      from,
      `[auto@ reply] ${subject}`,
      emailRecord.body_html || "",
      emailRecord.body_text || ""
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const rawBody = await req.text();

    // Verify webhook signature
    const svixId = req.headers.get("svix-id") || "";
    const svixTimestamp = req.headers.get("svix-timestamp") || "";
    const svixSignature = req.headers.get("svix-signature") || "";

    if (svixId && svixTimestamp && svixSignature) {
      const isValid = await verifyWebhookSignature(rawBody, svixId, svixTimestamp, svixSignature, webhookSecret);
      if (!isValid) {
        console.error("Invalid webhook signature — rejecting");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      console.log("Webhook signature verified");
    } else {
      console.warn("Missing SVIX headers — skipping signature check");
    }

    const webhook = JSON.parse(rawBody);

    // Only process email.received events
    if (webhook.type !== "email.received") {
      console.log("Ignoring event type:", webhook.type);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = webhook.data;
    const emailId = data.email_id;
    const from = data.from || "";
    const toList: string[] = data.to || [];
    const cc: string[] = data.cc || [];
    const subject = data.subject || "(no subject)";
    const attachments = data.attachments || [];

    console.log("Inbound email received:", { emailId, from, to: toList, subject });

    // Fetch full email body from Resend API
    let html = "";
    let text = "";
    const content = await fetchEmailContent(emailId, resendApiKey);
    if (content) {
      html = content.html;
      text = content.text;
    }

    // Process each recipient (there could be multiple to addresses)
    for (const toAddr of toList) {
      const prefix = extractPrefix(toAddr);
      const route = ROUTING_RULES[prefix] || DEFAULT_ROUTE;

      console.log(`Routing ${toAddr} (prefix=${prefix}): action=${route.action}, forward=${route.forwardTo || "none"}`);

      // Store in database
      const { data: record, error: insertError } = await supabase
        .from("inbound_emails")
        .insert({
          resend_email_id: emailId,
          from_address: from,
          to_address: toAddr,
          cc,
          subject,
          body_html: html,
          body_text: text,
          attachments: attachments.length > 0 ? attachments : null,
          route_action: route.action,
          forwarded_to: route.forwardTo || null,
          special_logic_type: route.specialLogic || null,
          raw_payload: data,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error storing inbound email:", insertError);
        continue;
      }

      // Forward if applicable
      if (route.action === "forward" && route.forwardTo) {
        const forwarded = await forwardEmail(resendApiKey, route.forwardTo, from, subject, html, text);
        if (forwarded) {
          await supabase
            .from("inbound_emails")
            .update({ forwarded_at: new Date().toISOString() })
            .eq("id", record.id);
        }
      }

      // Special logic if applicable
      if (route.action === "special" && route.specialLogic) {
        await handleSpecialLogic(route.specialLogic, record, supabase, resendApiKey);
        await supabase
          .from("inbound_emails")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", record.id);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error.message);

    // Return 200 to prevent Resend retries
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
