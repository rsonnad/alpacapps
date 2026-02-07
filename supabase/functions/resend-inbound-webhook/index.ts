import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const RESEND_API_URL = "https://api.resend.com";

/**
 * Special-logic prefixes that are NOT simple forwards.
 * These are handled by handleSpecialLogic() instead of forwarding.
 */
const SPECIAL_PREFIXES: Record<string, string> = {
  "herd": "herd",
  "auto": "auto",
};

/**
 * Load forwarding rules from the email_forwarding_config table.
 * Returns a map of prefix → array of forward-to addresses.
 * Falls back to hardcoded defaults if the DB query fails.
 */
async function loadForwardingRules(supabase: any): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase
      .from("email_forwarding_config")
      .select("address_prefix, forward_to")
      .eq("is_active", true);

    if (error) throw error;

    const rules: Record<string, string[]> = {};
    for (const row of data || []) {
      const prefix = row.address_prefix.toLowerCase();
      if (!rules[prefix]) rules[prefix] = [];
      rules[prefix].push(row.forward_to);
    }
    return rules;
  } catch (err) {
    console.error("Failed to load forwarding rules from DB, using defaults:", err);
    return {
      team: ["alpacaplayhouse@gmail.com"],
    };
  }
}

const DEFAULT_FORWARD_TO = "alpacaplayhouse@gmail.com";

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
 * Retries with delay because the body may not be available immediately
 * (race condition when sending to our own domain).
 */
async function fetchEmailContent(emailId: string, apiKey: string): Promise<{ html: string; text: string } | null> {
  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retry ${attempt}/${MAX_ATTEMPTS} fetching email body (waiting ${DELAY_MS}ms)...`);
        await new Promise(r => setTimeout(r, DELAY_MS));
      }

      // Use the Received Emails API endpoint (not /emails/ which is for outbound only)
      const res = await fetch(`${RESEND_API_URL}/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error(`Failed to fetch email content: ${res.status} ${res.statusText} - ${errBody}`);
        if (attempt === MAX_ATTEMPTS) return null;
        continue;
      }
      const data = await res.json();
      const html = data.html || "";
      const text = data.text || "";

      // If body is empty and we have retries left, try again
      if (!html && !text && attempt < MAX_ATTEMPTS) {
        console.warn(`Email body empty on attempt ${attempt}, will retry...`);
        continue;
      }

      return { html, text };
    } catch (error) {
      console.error("Error fetching email content:", error.message);
      if (attempt === MAX_ATTEMPTS) return null;
    }
  }
  return null;
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
      DEFAULT_FORWARD_TO,
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

    // Load forwarding rules from database
    const forwardingRules = await loadForwardingRules(supabase);

    // Process each recipient (there could be multiple to addresses)
    for (const toAddr of toList) {
      const prefix = extractPrefix(toAddr);
      const specialLogic = SPECIAL_PREFIXES[prefix] || null;
      const forwardTargets = forwardingRules[prefix] || (specialLogic ? [] : [DEFAULT_FORWARD_TO]);
      const action = specialLogic ? "special" : "forward";

      console.log(`Routing ${toAddr} (prefix=${prefix}): action=${action}, forward=${forwardTargets.join(",") || "none"}, special=${specialLogic || "none"}`);

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
          route_action: action,
          forwarded_to: forwardTargets.length > 0 ? forwardTargets[0] : null,
          special_logic_type: specialLogic,
          raw_payload: data,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error storing inbound email:", insertError);
        continue;
      }

      // Forward to all configured targets
      if (forwardTargets.length > 0) {
        let anyForwarded = false;
        for (const target of forwardTargets) {
          const forwarded = await forwardEmail(resendApiKey, target, from, subject, html, text);
          if (forwarded) anyForwarded = true;
        }
        if (anyForwarded) {
          await supabase
            .from("inbound_emails")
            .update({ forwarded_at: new Date().toISOString() })
            .eq("id", record.id);
        }
      }

      // Special logic if applicable
      if (specialLogic) {
        await handleSpecialLogic(specialLogic, record, supabase, resendApiKey);
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
