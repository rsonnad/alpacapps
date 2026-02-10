import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { uploadToR2 } from "../_shared/r2-upload.ts";

const RESEND_API_URL = "https://api.resend.com";

/**
 * Special-logic prefixes that are NOT simple forwards.
 * These are handled by handleSpecialLogic() instead of forwarding.
 */
const SPECIAL_PREFIXES: Record<string, string> = {
  "herd": "herd",
  "auto": "auto",
  "payments": "payments",
  "pai": "pai",
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
  } else if (type === "payments") {
    await handlePaymentEmail(emailRecord, supabase, resendApiKey);
  } else if (type === "pai") {
    await handlePaiEmail(emailRecord, supabase, resendApiKey);
  }

  // herd@ - not yet implemented
}

// =============================================
// PAI EMAIL HANDLER
// =============================================

type PaiEmailClassification = "question" | "document" | "command" | "spam" | "other";

/** Spam emails per rolling window that triggers an admin alert. */
const PAI_SPAM_ALERT_THRESHOLD = 10;
const PAI_SPAM_WINDOW_HOURS = 24;

interface PaiClassificationResult {
  type: PaiEmailClassification;
  confidence: number;
  summary: string;
}

/**
 * Classify an inbound email using Gemini.
 * Returns the email type (question, document, command, other) with confidence.
 */
async function classifyPaiEmail(
  subject: string,
  bodyText: string,
  hasAttachments: boolean
): Promise<PaiClassificationResult> {
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.warn("GEMINI_API_KEY not set, defaulting to 'other'");
    return { type: hasAttachments ? "document" : "question", confidence: 0.5, summary: "No Gemini key" };
  }

  const prompt = `You are an email classifier for PAI (Property AI Assistant) at Alpaca Playhouse, a residential property.

Classify this email into ONE of these categories:
- "spam" — Unsolicited marketing, phishing, scams, newsletters the recipient didn't sign up for, SEO pitches, link spam, crypto spam, adult content, automated bot messages, or any clearly unwanted bulk email. When in doubt between spam and other, lean toward spam.
- "question" — A real person asking about the property, amenities, policies, move-in, availability, etc.
- "document" — A real person sending a document (manual, guide, receipt, etc.) for storage/reference. Has attachments or mentions sending a file.
- "command" — A real person requesting a smart home action (lights, music, thermostat, locks, etc.)
- "other" — Legitimate but unrelated email that doesn't fit the above categories.

Email subject: ${subject}
Email body (first 1000 chars): ${bodyText.substring(0, 1000)}
Has attachments: ${hasAttachments}

Respond with ONLY a JSON object: {"type": "spam|question|document|command|other", "confidence": 0.0-1.0, "summary": "brief one-line summary"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      }
    );

    if (!res.ok) {
      console.error(`Gemini classification failed: ${res.status}`);
      return { type: hasAttachments ? "document" : "question", confidence: 0.5, summary: "Gemini API error" };
    }

    const result = await res.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Log usage for cost tracking
    const usage = result.usageMetadata;
    if (usage) {
      console.log(`Gemini classification tokens: in=${usage.promptTokenCount}, out=${usage.candidatesTokenCount}`);
    }

    // Parse JSON from response (may be wrapped in ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        type: ["question", "document", "command", "spam", "other"].includes(parsed.type) ? parsed.type : "other",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        summary: parsed.summary || "",
      };
    }

    return { type: hasAttachments ? "document" : "question", confidence: 0.5, summary: "Could not parse" };
  } catch (err) {
    console.error("Gemini classification error:", err.message);
    return { type: hasAttachments ? "document" : "question", confidence: 0.5, summary: err.message };
  }
}

/**
 * Check recent spam volume and send admin alert if threshold is crossed.
 * Only alerts once per window (checks if an alert was already sent recently).
 */
async function checkSpamThresholdAndAlert(
  supabase: any,
  senderEmail: string,
  summary: string
): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - PAI_SPAM_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    // Count spam in the rolling window
    const { count, error } = await supabase
      .from("inbound_emails")
      .select("id", { count: "exact", head: true })
      .eq("special_logic_type", "pai")
      .eq("route_action", "spam_blocked")
      .gte("created_at", windowStart);

    if (error) {
      console.error("Error checking spam count:", error);
      return;
    }

    const spamCount = count || 0;
    console.log(`PAI spam count in last ${PAI_SPAM_WINDOW_HOURS}h: ${spamCount}`);

    // Only alert at the threshold crossing (not on every spam after)
    if (spamCount === PAI_SPAM_ALERT_THRESHOLD) {
      console.log(`PAI spam threshold (${PAI_SPAM_ALERT_THRESHOLD}) reached, alerting admin`);

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

      // Get admin emails
      const { data: admins } = await supabase
        .from("app_users")
        .select("email")
        .eq("role", "admin");
      const adminEmails = admins?.map((a: any) => a.email) || ["alpacaplayhouse@gmail.com"];

      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          type: "pai_email_reply",
          to: adminEmails,
          data: {
            reply_body: `<strong>Spam Alert:</strong> pai@alpacaplayhouse.com has received <strong>${spamCount} spam emails</strong> in the last ${PAI_SPAM_WINDOW_HOURS} hours.\n\nMost recent: from ${senderEmail} — "${summary}"\n\nAll spam is being silently dropped (no replies sent). If this continues, consider removing the address from public-facing pages or adding domain-level filtering.`,
            original_subject: "PAI Spam Alert",
            original_body: "",
          },
          sender_type: "auto",
          subject: `PAI Spam Alert: ${spamCount} spam emails in ${PAI_SPAM_WINDOW_HOURS}h`,
        }),
      });
    }
  } catch (err) {
    console.error("Spam threshold check error:", err.message);
  }
}

/**
 * Call the send-email edge function to send a PAI reply.
 * Uses service role key so the invocation is accepted; passes from/reply_to so reply is from PAI.
 */
async function sendPaiReply(
  supabase: any,
  to: string,
  replyBody: string,
  originalSubject: string,
  originalBody: string
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      type: "pai_email_reply",
      to,
      data: {
        reply_body: replyBody,
        original_subject: originalSubject,
        original_body: originalBody.substring(0, 500),
      },
      from: "PAI <pai@alpacaplayhouse.com>",
      reply_to: "pai@alpacaplayhouse.com",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to send PAI reply: ${res.status} ${errText}`);
  } else {
    console.log(`PAI reply sent to ${to}`);
  }
}

/**
 * Send admin notification about uploaded documents.
 */
async function sendPaiDocumentNotification(
  supabase: any,
  senderName: string,
  senderEmail: string,
  originalSubject: string,
  messageBody: string,
  files: Array<{ name: string; type: string; size: string }>
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  // Get admin emails
  const { data: admins } = await supabase
    .from("app_users")
    .select("email")
    .eq("role", "admin");

  const adminEmails = admins?.map((a: any) => a.email) || ["alpacaplayhouse@gmail.com"];

  const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      type: "pai_document_received",
      to: adminEmails,
      data: {
        sender_name: senderName,
        sender_email: senderEmail,
        original_subject: originalSubject,
        message_body: messageBody,
        files,
        file_count: files.length,
        admin_url: "https://alpacaplayhouse.com/spaces/admin/manage.html",
      },
      sender_type: "auto",
    }),
  });

  if (!res.ok) {
    console.error(`Failed to send document notification: ${res.status}`);
  }
}

/**
 * Download attachment from Resend and return as Uint8Array.
 */
async function downloadResendAttachment(
  resendApiKey: string,
  emailId: string,
  attachmentIndex: number
): Promise<{ data: Uint8Array; filename: string; contentType: string } | null> {
  try {
    // Fetch the full email to get attachment download URLs
    const res = await fetch(`${RESEND_API_URL}/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    });

    if (!res.ok) {
      console.error(`Failed to fetch email for attachments: ${res.status}`);
      return null;
    }

    const emailData = await res.json();
    const attachments = emailData.attachments || [];
    if (attachmentIndex >= attachments.length) {
      console.error(`Attachment index ${attachmentIndex} out of range (${attachments.length} attachments)`);
      return null;
    }

    const att = attachments[attachmentIndex];
    const filename = att.filename || `attachment-${attachmentIndex}`;
    const contentType = att.content_type || "application/octet-stream";

    // Attachment content is base64-encoded in the Resend response
    if (att.content) {
      const data = base64Decode(att.content);
      return { data: new Uint8Array(data), filename, contentType };
    }

    console.error(`No content found for attachment ${attachmentIndex}`);
    return null;
  } catch (err) {
    console.error(`Error downloading attachment: ${err.message}`);
    return null;
  }
}

/**
 * Format file size in human-readable form.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Heuristic: treat short "other" emails that look like questions as questions so we still reply.
 */
function looksLikeQuestion(subject: string, body: string): boolean {
  const combined = `${(subject || "").trim()} ${(body || "").trim()}`.toLowerCase();
  if (combined.length > 500) return false;
  if (combined.includes("?")) return true;
  const questionPhrases = ["can i ", "can we ", "could i ", "may i ", "how do ", "how can ", "is it ok", "is it okay", "are we ", "do you ", "does the ", "should i ", "would it "];
  return questionPhrases.some((p) => combined.includes(p));
}

/**
 * Handle inbound email to pai@alpacaplayhouse.com.
 *
 * 1. Classify via Gemini (question/document/command/other)
 * 2. Questions & commands → forward to PAI chat, send reply email
 * 3. Documents → download attachments, upload to R2, index, notify admin
 */
async function handlePaiEmail(
  emailRecord: any,
  supabase: any,
  resendApiKey: string
): Promise<void> {
  const subject = emailRecord.subject || "";
  const bodyText = emailRecord.body_text || "";
  const bodyHtml = emailRecord.body_html || "";
  const from = emailRecord.from_address || "";
  const emailId = emailRecord.resend_email_id || "";
  const rawPayload = emailRecord.raw_payload || {};
  const attachmentsMetadata = emailRecord.attachments || rawPayload.attachments || [];

  // Extract sender info
  const senderName = (from.match(/^([^<]+)/)?.[1] || "").trim() || from.split("@")[0];
  const senderEmail = (from.match(/<(.+)>/)?.[1] || from).trim();

  const hasAttachments = attachmentsMetadata.length > 0;

  console.log(`PAI email from ${senderEmail}: subject="${subject}", attachments=${attachmentsMetadata.length}`);

  // Classify the email
  const classification = await classifyPaiEmail(subject, bodyText || bodyHtml, hasAttachments);
  console.log(`PAI classification: type=${classification.type}, confidence=${classification.confidence}, summary="${classification.summary}"`);

  // Log usage for cost tracking
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiApiKey) {
    await supabase.from("api_usage_log").insert({
      vendor: "gemini",
      category: "pai_email_classification",
      endpoint: "generateContent",
      estimated_cost_usd: 0.0001, // ~100 input tokens + ~50 output tokens on flash
      metadata: {
        model: "gemini-2.0-flash",
        email_from: senderEmail,
        classification: classification.type,
        confidence: classification.confidence,
      },
    });
  }

  // Handle based on classification
  if (classification.type === "spam") {
    // === SPAM: Silently drop, log, check threshold ===
    console.log(`PAI email classified as spam, dropping silently: "${classification.summary}"`);

    // Update the inbound_emails record to mark as spam
    await supabase
      .from("inbound_emails")
      .update({ route_action: "spam_blocked" })
      .eq("id", emailRecord.id);

    // Check if we've crossed the alert threshold
    await checkSpamThresholdAndAlert(supabase, senderEmail, classification.summary);
    return;
  }

  if (classification.type === "document" && hasAttachments) {
    // === DOCUMENT: Download, upload to R2, index, notify admin ===
    const uploadedFiles: Array<{ name: string; type: string; size: string }> = [];

    for (let i = 0; i < attachmentsMetadata.length; i++) {
      const att = attachmentsMetadata[i];
      const filename = att.filename || att.name || `attachment-${i}`;
      const contentType = att.content_type || att.type || "application/octet-stream";

      // Skip non-document types (e.g., inline images, signatures)
      if (contentType.startsWith("image/") && !filename.match(/\.(pdf|doc|docx|xls|xlsx|csv|txt)$/i)) {
        console.log(`Skipping inline image: ${filename}`);
        continue;
      }

      try {
        // Download from Resend
        const downloaded = await downloadResendAttachment(resendApiKey, emailId, i);
        if (!downloaded) continue;

        // Generate R2 key
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
        const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const r2Key = `documents/email-uploads/${datePrefix}/${sanitizedFilename}`;

        // Upload to R2
        const publicUrl = await uploadToR2(r2Key, downloaded.data, downloaded.contentType);
        console.log(`Uploaded to R2: ${r2Key} → ${publicUrl}`);

        // Create document_index entry (inactive pending admin review)
        const fileExt = filename.split(".").pop()?.toLowerCase() || "";
        await supabase.from("document_index").insert({
          title: filename,
          description: `Uploaded via email by ${senderName} (${senderEmail}). Subject: ${subject}`,
          keywords: [fileExt, "email-upload", senderName.toLowerCase()],
          source_url: publicUrl,
          file_type: fileExt,
          file_size_bytes: downloaded.data.length,
          storage_backend: "r2",
          is_active: false, // Pending admin review
        });

        uploadedFiles.push({
          name: filename,
          type: contentType,
          size: formatFileSize(downloaded.data.length),
        });

        // Log R2 upload cost
        await supabase.from("api_usage_log").insert({
          vendor: "cloudflare_r2",
          category: "r2_document_upload",
          endpoint: "PutObject",
          units: 1,
          unit_type: "api_calls",
          estimated_cost_usd: 0, // Free tier
          metadata: { key: r2Key, size_bytes: downloaded.data.length, source: "pai_email" },
        });
      } catch (err) {
        console.error(`Error processing attachment ${filename}:`, err.message);
      }
    }

    if (uploadedFiles.length > 0) {
      // Notify admin
      await sendPaiDocumentNotification(
        supabase,
        senderName,
        senderEmail,
        subject,
        (bodyText || bodyHtml || "").substring(0, 500),
        uploadedFiles
      );

      // Auto-reply to sender
      const fileNames = uploadedFiles.map(f => f.name).join(", ");
      await sendPaiReply(
        supabase,
        senderEmail,
        `Thank you for sending ${uploadedFiles.length === 1 ? "the document" : `${uploadedFiles.length} documents`} (${fileNames}). I've received ${uploadedFiles.length === 1 ? "it" : "them"} and ${uploadedFiles.length === 1 ? "it's" : "they're"} now pending admin review before being added to my knowledge base.\n\nYou'll be able to ask me about ${uploadedFiles.length === 1 ? "this document" : "these documents"} once ${uploadedFiles.length === 1 ? "it's" : "they're"} approved.`,
        subject,
        bodyText || bodyHtml || ""
      );
    }
  } else if (
    classification.type === "question" ||
    classification.type === "command" ||
    (classification.type === "other" && looksLikeQuestion(subject, bodyText || bodyHtml))
  ) {
    // === QUESTION or COMMAND (or other that looks like a question): Forward to PAI, send reply ===
    const message = bodyText || bodyHtml || subject;

    try {
      // Call the alpaca-pai edge function directly
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

      const paiRes = await fetch(`${supabaseUrl}/functions/v1/alpaca-pai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          message: `[Email from ${senderName}] ${message.substring(0, 2000)}`,
          context: { source: "email", sender: senderEmail, subject },
        }),
      });

      let replyText = "";

      if (paiRes.ok) {
        const paiData = await paiRes.json();
        replyText = paiData.reply || paiData.response || paiData.text || "";
      }

      if (!replyText) {
        replyText = `Thank you for your email. I've received your ${classification.type === "command" ? "request" : "question"} and I'll have someone from the team follow up with you.\n\nFor faster responses, you can chat with me directly at https://alpacaplayhouse.com/residents/ (requires resident login).`;
      }

      await sendPaiReply(supabase, senderEmail, replyText, subject, bodyText || bodyHtml || "");
    } catch (err) {
      console.error(`PAI response error: ${err.message}`);
      // Send generic reply on error
      await sendPaiReply(
        supabase,
        senderEmail,
        "Thank you for your email. I've received your message and the team will review it shortly.\n\nFor immediate assistance, you can call us or chat with me at https://alpacaplayhouse.com/residents/.",
        subject,
        bodyText || bodyHtml || ""
      );
    }
  } else {
    // === OTHER: Forward to admin ===
    console.log(`PAI email classified as 'other', forwarding to admin`);
    // Just forward — the normal forwarding logic handles this since we don't set forwardTargets for special logic
    // But since special logic handlers don't forward by default, let's manually forward
    const adminEmail = "alpacaplayhouse@gmail.com";
    const forwardRes = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `PAI Forward <notifications@alpacaplayhouse.com>`,
        to: [adminEmail],
        reply_to: senderEmail,
        subject: `[PAI Forward] ${subject}`,
        html: bodyHtml || `<pre>${bodyText}</pre>`,
        text: bodyText || "(HTML-only email)",
      }),
    });

    if (!forwardRes.ok) {
      console.error(`PAI forward failed: ${forwardRes.status}`);
    } else {
      console.log(`PAI email forwarded to admin (classified as 'other')`);
    }
  }
}

// =============================================
// ZELLE PAYMENT AUTO-RECORDING
// =============================================

interface ZellePayment {
  amount: number;
  senderName: string;
  confirmationNumber: string | null;
  bank: string;
}

/**
 * Normalize a name for consistent matching.
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9\s]/g, "");
}

/**
 * Parse Zelle payment details from email body text.
 */
function parseZellePayment(bodyText: string): ZellePayment | null {
  // Normalize: collapse all whitespace (newlines, tabs, multiple spaces) into single spaces
  // Gmail forwarding and email clients insert line breaks mid-sentence
  const normalized = bodyText.replace(/\s+/g, " ");

  // Charles Schwab format:
  // "deposited the $130.00 payment from MAYA WHITE (confirmation number 4864859525)"
  const schwabPattern = /deposited the \$([\d,]+\.\d{2}) payment from (.+?) \(confirmation number (\d+)\)/i;
  const schwabMatch = normalized.match(schwabPattern);
  if (schwabMatch) {
    return {
      amount: parseFloat(schwabMatch[1].replace(/,/g, "")),
      senderName: schwabMatch[2].trim(),
      confirmationNumber: schwabMatch[3],
      bank: "schwab",
    };
  }

  // Chase format: "sent you $X.XX" or "You received $X.XX from NAME"
  const chasePattern = /(?:received|sent you) \$([\d,]+\.\d{2}).*?(?:from|by)\s+(.+?)(?:\s*\.|$)/im;
  const chaseMatch = normalized.match(chasePattern);
  if (chaseMatch) {
    return {
      amount: parseFloat(chaseMatch[1].replace(/,/g, "")),
      senderName: chaseMatch[2].trim(),
      confirmationNumber: null,
      bank: "chase",
    };
  }

  // Bank of America format: "A Zelle payment of $X.XX was received from NAME"
  const boaPattern = /Zelle payment of \$([\d,]+\.\d{2}) was received from (.+?)(?:\s*\.|$)/im;
  const boaMatch = normalized.match(boaPattern);
  if (boaMatch) {
    return {
      amount: parseFloat(boaMatch[1].replace(/,/g, "")),
      senderName: boaMatch[2].trim(),
      confirmationNumber: null,
      bank: "boa",
    };
  }

  return null;
}

/**
 * Try to match a Zelle sender name to a person in the people table.
 */
async function matchByName(
  supabase: any,
  senderName: string
): Promise<{ person_id: string; name: string } | null> {
  const normalized = normalizeName(senderName);

  // 1. Check payment_sender_mappings cache
  const { data: cached } = await supabase
    .from("payment_sender_mappings")
    .select("person_id")
    .eq("sender_name_normalized", normalized)
    .single();

  if (cached) {
    const { data: person } = await supabase
      .from("people")
      .select("id, first_name, last_name")
      .eq("id", cached.person_id)
      .single();
    if (person) {
      return { person_id: person.id, name: `${person.first_name} ${person.last_name}` };
    }
  }

  // 2. Load all people for matching
  const { data: people } = await supabase
    .from("people")
    .select("id, first_name, last_name");

  if (!people) return null;

  // 3. Exact full-name match (case-insensitive)
  for (const person of people) {
    const fullName = `${person.first_name} ${person.last_name}`;
    if (normalizeName(fullName) === normalized) {
      // Save mapping for future
      await supabase.from("payment_sender_mappings").upsert(
        {
          sender_name: senderName,
          sender_name_normalized: normalized,
          person_id: person.id,
          confidence_score: 1.0,
          match_source: "zelle_email_exact",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sender_name_normalized" }
      );
      return { person_id: person.id, name: fullName };
    }
  }

  // 4. Fuzzy: check if all parts of person's name appear in sender name parts
  //    Handles multi-word first names like "Maya Nicole" matching "MAYA WHITE"
  //    by checking if first-name parts AND last-name parts all exist in sender parts
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    for (const person of people) {
      const firstParts = (person.first_name || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      const lastParts = (person.last_name || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (firstParts.length === 0 || lastParts.length === 0) continue;
      // At minimum, first part of first name AND last part of last name must appear
      const firstMatch = firstParts.some((fp: string) => parts.includes(fp));
      const lastMatch = lastParts.some((lp: string) => parts.includes(lp));
      if (firstMatch && lastMatch) {
        await supabase.from("payment_sender_mappings").upsert(
          {
            sender_name: senderName,
            sender_name_normalized: normalized,
            person_id: person.id,
            confidence_score: 0.8,
            match_source: "zelle_email_fuzzy",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "sender_name_normalized" }
        );
        return { person_id: person.id, name: `${person.first_name} ${person.last_name}` };
      }
    }
  }

  return null;
}

/**
 * Find an active rental application with unpaid deposits for a person.
 */
async function findDepositApplication(supabase: any, personId: string): Promise<any | null> {
  const { data } = await supabase
    .from("rental_applications")
    .select("*, person:person_id(id, first_name, last_name, email)")
    .eq("person_id", personId)
    .in("deposit_status", ["pending", "requested", "partial"])
    .neq("is_archived", true)
    .neq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(1);

  return data && data.length > 0 ? data[0] : null;
}

/**
 * Auto-record a deposit payment on a rental application.
 * Splits across move-in and security deposits, flags overpayment.
 */
async function autoRecordDeposit(
  supabase: any,
  application: any,
  parsed: ZellePayment,
  resendApiKey: string
): Promise<void> {
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  let remaining = parsed.amount;
  const personName = `${application.person.first_name} ${application.person.last_name}`;

  // Deduplicate: check if this confirmation number was already recorded
  if (parsed.confirmationNumber) {
    const { data: existing } = await supabase
      .from("rental_payments")
      .select("id")
      .eq("transaction_id", parsed.confirmationNumber)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`Duplicate payment detected (conf#${parsed.confirmationNumber}), skipping`);
      await sendPaymentNotification(resendApiKey, "duplicate", {
        parsed,
        personName,
        applicationId: application.id,
      });
      return;
    }
  }

  // Record move-in deposit first
  const moveInUnpaid = !application.move_in_deposit_paid && (application.move_in_deposit_amount || 0) > 0;
  if (moveInUnpaid && remaining > 0) {
    const moveInAmt = application.move_in_deposit_amount;
    const applyAmt = Math.min(remaining, moveInAmt);

    const { data: rpData } = await supabase
      .from("rental_payments")
      .insert({
        rental_application_id: application.id,
        payment_type: "move_in_deposit",
        amount_due: moveInAmt,
        amount_paid: applyAmt,
        paid_date: today,
        payment_method: "zelle",
        transaction_id: parsed.confirmationNumber,
      })
      .select()
      .single();

    await supabase
      .from("rental_applications")
      .update({
        move_in_deposit_paid: true,
        move_in_deposit_paid_at: now,
        move_in_deposit_method: "zelle",
        updated_at: now,
      })
      .eq("id", application.id);

    await supabase.from("ledger").insert({
      direction: "income",
      category: "move_in_deposit",
      amount: applyAmt,
      payment_method: "zelle",
      transaction_date: today,
      person_id: application.person_id,
      person_name: personName,
      rental_application_id: application.id,
      rental_payment_id: rpData?.id,
      status: "completed",
      description: `Move-in deposit via Zelle (auto-recorded, conf#${parsed.confirmationNumber || "N/A"})`,
      recorded_by: "system:zelle-email",
    });

    remaining -= applyAmt;
    console.log(`Recorded move-in deposit: $${applyAmt} for ${personName}`);
  }

  // Record security deposit
  const securityUnpaid = !application.security_deposit_paid && (application.security_deposit_amount || 0) > 0;
  if (securityUnpaid && remaining > 0) {
    const secAmt = application.security_deposit_amount;
    const applyAmt = Math.min(remaining, secAmt);

    const { data: rpData } = await supabase
      .from("rental_payments")
      .insert({
        rental_application_id: application.id,
        payment_type: "security_deposit",
        amount_due: secAmt,
        amount_paid: applyAmt,
        paid_date: today,
        payment_method: "zelle",
        transaction_id: parsed.confirmationNumber,
      })
      .select()
      .single();

    await supabase
      .from("rental_applications")
      .update({
        security_deposit_paid: true,
        security_deposit_paid_at: now,
        security_deposit_method: "zelle",
        updated_at: now,
      })
      .eq("id", application.id);

    await supabase.from("ledger").insert({
      direction: "income",
      category: "security_deposit",
      amount: applyAmt,
      payment_method: "zelle",
      transaction_date: today,
      person_id: application.person_id,
      person_name: personName,
      rental_application_id: application.id,
      rental_payment_id: rpData?.id,
      status: "completed",
      description: `Security deposit via Zelle (auto-recorded, conf#${parsed.confirmationNumber || "N/A"})`,
      recorded_by: "system:zelle-email",
    });

    remaining -= applyAmt;
    console.log(`Recorded security deposit: $${applyAmt} for ${personName}`);
  }

  // Update overall deposit status
  const { data: updatedApp } = await supabase
    .from("rental_applications")
    .select("move_in_deposit_paid, security_deposit_paid, security_deposit_amount")
    .eq("id", application.id)
    .single();

  if (updatedApp) {
    const allPaid =
      updatedApp.move_in_deposit_paid &&
      (updatedApp.security_deposit_paid || (updatedApp.security_deposit_amount || 0) === 0);
    const anyPaid = updatedApp.move_in_deposit_paid || updatedApp.security_deposit_paid;

    const newStatus = allPaid ? "received" : anyPaid ? "partial" : "requested";
    await supabase
      .from("rental_applications")
      .update({ deposit_status: newStatus, updated_at: now })
      .eq("id", application.id);
  }

  // Record any overpayment as rent credit
  const overpayment = remaining > 0 ? remaining : 0;
  if (overpayment > 0) {
    const { data: rpData } = await supabase
      .from("rental_payments")
      .insert({
        rental_application_id: application.id,
        payment_type: "rent_credit",
        amount_due: 0,
        amount_paid: overpayment,
        paid_date: today,
        payment_method: "zelle",
        transaction_id: parsed.confirmationNumber,
        notes: `Overpayment credit from $${parsed.amount.toFixed(2)} Zelle payment (deposits totaled $${(parsed.amount - overpayment).toFixed(2)})`,
      })
      .select()
      .single();

    await supabase.from("ledger").insert({
      direction: "income",
      category: "rent",
      amount: overpayment,
      payment_method: "zelle",
      transaction_date: today,
      person_id: application.person_id,
      person_name: personName,
      rental_application_id: application.id,
      rental_payment_id: rpData?.id,
      status: "completed",
      description: `Rent prepayment / overpayment credit via Zelle (auto-recorded, conf#${parsed.confirmationNumber || "N/A"})`,
      recorded_by: "system:zelle-email",
    });

    console.log(`Recorded overpayment credit: $${overpayment.toFixed(2)} for ${personName}`);
  }

  // Build payment summary for receipt email
  const chargeLines: { label: string; amount: number }[] = [];
  if (moveInUnpaid) chargeLines.push({ label: "Move-in Deposit", amount: application.move_in_deposit_amount || 0 });
  if (securityUnpaid) chargeLines.push({ label: "Security Deposit", amount: application.security_deposit_amount || 0 });
  const totalCharges = chargeLines.reduce((sum, l) => sum + l.amount, 0);
  const balance = totalCharges - parsed.amount; // Negative = credit, positive = still owed

  // Send receipt email to the tenant
  if (application.person?.email) {
    await sendTenantReceipt(resendApiKey, {
      tenantEmail: application.person.email,
      tenantName: application.person.first_name,
      paymentAmount: parsed.amount,
      confirmationNumber: parsed.confirmationNumber,
      chargeLines,
      totalCharges,
      balance,
      overpayment,
    });
  }

  // Notify admin
  await sendPaymentNotification(resendApiKey, "auto_recorded", {
    parsed,
    personName,
    applicationId: application.id,
    overpayment,
    moveInRecorded: moveInUnpaid,
    securityRecorded: securityUnpaid,
  });
}

/**
 * Send a payment receipt email to the tenant.
 */
async function sendTenantReceipt(
  resendApiKey: string,
  details: {
    tenantEmail: string;
    tenantName: string;
    paymentAmount: number;
    confirmationNumber: string | null;
    chargeLines: { label: string; amount: number }[];
    totalCharges: number;
    balance: number;
    overpayment: number;
  }
): Promise<void> {
  const chargeRowsHtml = details.chargeLines
    .map(
      (l) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${l.label}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${l.amount.toFixed(2)}</td></tr>`
    )
    .join("");

  const balanceColor = details.balance > 0 ? "#e74c3c" : details.balance < 0 ? "#2d7d46" : "#333";
  const balanceLabel =
    details.balance > 0
      ? `$${details.balance.toFixed(2)} remaining`
      : details.balance < 0
      ? `$${Math.abs(details.balance).toFixed(2)} credit on account`
      : "$0.00 — Paid in full";

  const subject = `Payment Received — $${details.paymentAmount.toFixed(2)}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2d7d46;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">&#x2705; Payment Received</h2>
        <p style="margin:8px 0 0;opacity:0.9;">Thank you, ${details.tenantName}!</p>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
          <tr style="background:#f8f9fa;">
            <td style="padding:10px 12px;font-weight:bold;border-bottom:2px solid #ddd;">Description</td>
            <td style="padding:10px 12px;font-weight:bold;border-bottom:2px solid #ddd;text-align:right;">Amount</td>
          </tr>
          ${chargeRowsHtml}
          <tr style="background:#f8f9fa;">
            <td style="padding:10px 12px;font-weight:bold;border-top:2px solid #ddd;">Total Charges</td>
            <td style="padding:10px 12px;font-weight:bold;border-top:2px solid #ddd;text-align:right;">$${details.totalCharges.toFixed(2)}</td>
          </tr>
        </table>

        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">Payment Received (Zelle)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#2d7d46;font-weight:bold;">-$${details.paymentAmount.toFixed(2)}</td>
          </tr>
          ${details.confirmationNumber ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#999;font-size:0.85rem;">Confirmation #${details.confirmationNumber}</td><td></td></tr>` : ""}
        </table>

        <div style="background:#f8f9fa;border-radius:6px;padding:14px 16px;text-align:center;">
          <span style="font-size:0.85rem;color:#666;">Balance</span><br/>
          <span style="font-size:1.4rem;font-weight:bold;color:${balanceColor};">${balanceLabel}</span>
        </div>

        <p style="color:#999;font-size:0.8rem;margin-top:20px;text-align:center;">
          GenAlpaca Residency &bull; This is an automated receipt.
        </p>
      </div>
    </div>
  `;

  try {
    const res = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "GenAlpaca <noreply@alpacaplayhouse.com>",
        to: [details.tenantEmail],
        bcc: ["alpacaautomatic@gmail.com"],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Failed to send tenant receipt:", await res.text());
    } else {
      console.log(`Sent payment receipt to ${details.tenantEmail}`);
    }
  } catch (err) {
    console.error("Error sending tenant receipt:", err.message);
  }
}

/**
 * Find applications where outstanding deposit amount matches the payment.
 */
async function matchByAmount(supabase: any, amount: number): Promise<any[]> {
  const { data: apps } = await supabase
    .from("rental_applications")
    .select("*, person:person_id(id, first_name, last_name, email)")
    .in("deposit_status", ["pending", "requested", "partial"])
    .neq("is_archived", true)
    .neq("is_test", true);

  const matches: any[] = [];
  for (const app of apps || []) {
    const moveInDue = !app.move_in_deposit_paid ? (app.move_in_deposit_amount || 0) : 0;
    const securityDue = !app.security_deposit_paid ? (app.security_deposit_amount || 0) : 0;
    const totalDue = moveInDue + securityDue;

    if (
      (totalDue > 0 && Math.abs(amount - totalDue) < 0.01) ||
      (totalDue > 0 && amount > totalDue && amount <= totalDue * 3) ||  // Mild overpayment (up to 3x)
      (moveInDue > 0 && Math.abs(amount - moveInDue) < 0.01) ||
      (securityDue > 0 && Math.abs(amount - securityDue) < 0.01)
    ) {
      matches.push(app);
    }
  }

  return matches;
}

/**
 * Create a confirmation request for Tier 2 (amount match, name mismatch).
 */
async function createConfirmationRequest(
  supabase: any,
  resendApiKey: string,
  parsed: ZellePayment,
  application: any,
  inboundEmailId: string
): Promise<void> {
  const { data: conf } = await supabase
    .from("deposit_payment_confirmations")
    .insert({
      sender_name: parsed.senderName,
      amount: parsed.amount,
      confirmation_number: parsed.confirmationNumber,
      payment_method: "zelle",
      rental_application_id: application.id,
      person_id: application.person_id,
      inbound_email_id: inboundEmailId,
    })
    .select()
    .single();

  if (!conf) {
    console.error("Failed to create confirmation record");
    return;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const confirmUrl = `${supabaseUrl}/functions/v1/confirm-deposit-payment?token=${conf.token}`;
  const personName = `${application.person.first_name} ${application.person.last_name}`;

  await sendPaymentNotification(resendApiKey, "confirm_request", {
    parsed,
    personName,
    applicationId: application.id,
    confirmUrl,
  });
}

/**
 * Send payment notification emails to admin.
 */
async function sendPaymentNotification(
  resendApiKey: string,
  type: string,
  details: any
): Promise<void> {
  const adminEmail = "team@alpacaplayhouse.com";
  const { parsed, personName, applicationId } = details;
  const adminUrl = `https://alpacaplayhouse.com/spaces/admin/rentals.html#applicant=${applicationId}`;

  let subject = "";
  let html = "";

  if (type === "auto_recorded") {
    const overpayStr = details.overpayment > 0
      ? `<p style="color:#e74c3c;font-weight:bold;">&#x26A0; Overpayment: $${details.overpayment.toFixed(2)} exceeds deposits owed. May need manual handling.</p>`
      : "";
    subject = `Zelle Payment Recorded: $${parsed.amount.toFixed(2)} from ${parsed.senderName}`;
    html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;">
        <h2 style="color:#2d7d46;">&#x2705; Payment Auto-Recorded</h2>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">$${parsed.amount.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">From</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.senderName}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Matched To</td><td style="padding:8px;border-bottom:1px solid #eee;">${personName}</td></tr>
          ${parsed.confirmationNumber ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Confirmation #</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.confirmationNumber}</td></tr>` : ""}
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Method</td><td style="padding:8px;border-bottom:1px solid #eee;">Zelle (${parsed.bank})</td></tr>
        </table>
        ${details.moveInRecorded ? "<p>&#x2705; Move-in deposit marked as paid</p>" : ""}
        ${details.securityRecorded ? "<p>&#x2705; Security deposit marked as paid</p>" : ""}
        ${overpayStr}
        <p><a href="${adminUrl}" style="display:inline-block;padding:10px 20px;background:#2d7d46;color:white;text-decoration:none;border-radius:4px;margin-top:10px;">View Application</a></p>
      </div>
    `;
  } else if (type === "confirm_request") {
    subject = `Confirm Zelle Payment: $${parsed.amount.toFixed(2)} from ${parsed.senderName} → ${personName}?`;
    html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;">
        <h2 style="color:#e67e22;">&#x1F4B0; Payment Needs Confirmation</h2>
        <p>A Zelle payment was received but the sender name didn't match anyone exactly. However, the <strong>amount matches</strong> an outstanding deposit.</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">$${parsed.amount.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Zelle Sender</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.senderName}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Suggested Match</td><td style="padding:8px;border-bottom:1px solid #eee;">${personName}</td></tr>
          ${parsed.confirmationNumber ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Confirmation #</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.confirmationNumber}</td></tr>` : ""}
        </table>
        <p style="margin-top:20px;">
          <a href="${details.confirmUrl}" style="display:inline-block;padding:12px 30px;background:#2d7d46;color:white;text-decoration:none;border-radius:4px;font-size:16px;font-weight:bold;">Confirm Payment</a>
        </p>
        <p style="color:#999;font-size:0.85rem;">This link expires in 7 days. If this is not the right match, you can ignore this email and record it manually in the <a href="${adminUrl}">admin panel</a>.</p>
      </div>
    `;
  } else if (type === "no_match") {
    subject = `Unmatched Zelle Payment: $${parsed.amount.toFixed(2)} from ${parsed.senderName}`;
    html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;">
        <h2 style="color:#e74c3c;">&#x2753; Unmatched Payment</h2>
        <p>A Zelle payment was received but could not be matched to any tenant or outstanding deposit.</p>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">$${parsed.amount.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Zelle Sender</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.senderName}</td></tr>
          ${parsed.confirmationNumber ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Confirmation #</td><td style="padding:8px;border-bottom:1px solid #eee;">${parsed.confirmationNumber}</td></tr>` : ""}
        </table>
        <p>Please record this payment manually in the admin panel.</p>
        ${details.pendingApps ? `<p><strong>Current applications with pending deposits:</strong></p><ul>${details.pendingApps}</ul>` : ""}
      </div>
    `;
  } else if (type === "duplicate") {
    subject = `Duplicate Zelle Payment Detected: $${parsed.amount.toFixed(2)} from ${parsed.senderName}`;
    html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;">
        <h2 style="color:#e67e22;">&#x26A0; Duplicate Payment</h2>
        <p>A Zelle payment notification was received but confirmation #${parsed.confirmationNumber} was already recorded. No action taken.</p>
        <p><a href="${adminUrl}">View Application</a></p>
      </div>
    `;
  } else if (type === "unparseable") {
    subject = "Unrecognized Payment Email";
    html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;">
        <h2 style="color:#999;">&#x2709; Unrecognized Payment Email</h2>
        <p>An email was sent to payments@ but could not be parsed as a Zelle payment. It has been forwarded for manual review.</p>
      </div>
    `;
  }

  if (!subject) return;

  try {
    await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Alpaca Payments <noreply@alpacaplayhouse.com>",
        to: [adminEmail],
        subject,
        html,
      }),
    });
    console.log(`Payment notification sent: ${type}`);
  } catch (err) {
    console.error("Failed to send payment notification:", err);
  }
}

/**
 * Main handler for payments@ emails.
 */
async function handlePaymentEmail(
  emailRecord: any,
  supabase: any,
  resendApiKey: string
): Promise<void> {
  const bodyText = emailRecord.body_text || "";

  // 1. Parse the Zelle payment
  const parsed = parseZellePayment(bodyText);
  if (!parsed) {
    console.log("Could not parse Zelle payment from email, notifying admin");
    await sendPaymentNotification(resendApiKey, "unparseable", {
      parsed: { amount: 0, senderName: "Unknown", confirmationNumber: null },
      personName: "",
      applicationId: "",
    });
    return;
  }

  console.log(`Parsed Zelle payment: $${parsed.amount} from ${parsed.senderName}, conf#${parsed.confirmationNumber}`);

  // 2. Tier 1: Name match
  const nameMatch = await matchByName(supabase, parsed.senderName);

  if (nameMatch) {
    const application = await findDepositApplication(supabase, nameMatch.person_id);
    if (application) {
      console.log(`Tier 1 match: ${parsed.senderName} → ${nameMatch.name}, app=${application.id}`);
      await autoRecordDeposit(supabase, application, parsed, resendApiKey);
      return;
    }
    console.log(`Name matched ${nameMatch.name} but no pending deposit application found`);
  }

  // 3. Tier 2: Amount match
  const amountMatches = await matchByAmount(supabase, parsed.amount);

  if (amountMatches.length === 1) {
    console.log(`Tier 2 match: amount $${parsed.amount} matches ${amountMatches[0].person.first_name} ${amountMatches[0].person.last_name}`);
    await createConfirmationRequest(supabase, resendApiKey, parsed, amountMatches[0], emailRecord.id);
    return;
  }

  if (amountMatches.length > 1) {
    console.log(`Tier 2: multiple amount matches (${amountMatches.length}), falling through to Tier 3`);
  }

  // 4. Tier 3: No match — notify admin
  console.log("Tier 3: no match found, notifying admin");

  // Build list of pending applications for reference
  const { data: pendingApps } = await supabase
    .from("rental_applications")
    .select("id, person:person_id(first_name, last_name), move_in_deposit_amount, security_deposit_amount, deposit_status")
    .in("deposit_status", ["pending", "requested", "partial"])
    .neq("is_archived", true)
    .neq("is_test", true);

  let pendingAppsHtml = "";
  if (pendingApps && pendingApps.length > 0) {
    pendingAppsHtml = pendingApps
      .map((a: any) => {
        const name = `${a.person.first_name} ${a.person.last_name}`;
        const total = (a.move_in_deposit_amount || 0) + (a.security_deposit_amount || 0);
        return `<li>${name} — $${total.toFixed(2)} (${a.deposit_status})</li>`;
      })
      .join("");
  }

  await sendPaymentNotification(resendApiKey, "no_match", {
    parsed,
    personName: "",
    applicationId: "",
    pendingApps: pendingAppsHtml,
  });
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

  // Ignore emails FROM or TO auto@ or noreply@ (automated system emails looping back)
  const toAddr = emailRecord.to_address || "";
  // Extract email address from "Name <email>" format, normalize to lowercase
  const fromEmail = (from.match(/<(.+)>/)?.[1] || from).toLowerCase().trim();
  const toEmail = (toAddr.match(/<(.+)>/)?.[1] || toAddr).toLowerCase().trim();

  if (fromEmail.includes("auto@alpacaplayhouse.com") || fromEmail.includes("noreply@alpacaplayhouse.com") ||
      toEmail.includes("auto@alpacaplayhouse.com") || toEmail.includes("noreply@alpacaplayhouse.com")) {
    console.log("Ignoring automated email reply loop", { from: fromEmail, to: toEmail });
    return;
  }

  // Additional safety: ignore if body contains automated email template markers
  // Check for nested "YOUR REPORT:" which appears in forwarded/replied automated emails
  if (body && (body.includes("YOUR REPORT:") || body.includes("Your bug report has been automatically"))) {
    console.log("Ignoring automated bug notification email (body template detected)", { subject });
    return;
  }

  // Ignore replies to automated bug fix/update notifications (these are NOT user bug reports)
  // Matches: "Re: Bug by...", "Re: [Follow-up]", "Re: Bug Fixed", "Re: Bug Report Update", "Re: Screenshot of the Fix"
  // Also matches subjects WITHOUT "Re:" (forwards, loops): "Bug Fixed!", "[Follow-up]", "Bug Report Update"
  if (subject.match(/(?:Re:\s*)?(?:Bug by|Bug Fix|Bug Report|Screenshot of the Fix|\[Follow-up\])/i)) {
    console.log("Ignoring automated bug notification or reply", { subject });
    return;
  }

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
    // Remove common reply markers AND automated email content
    const replyMarkers = [
      /YOUR REPORT:/i,  // Strip automated bug report email content
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

    // ==============================================
    // LOOP GUARD: Reject emails from our own domain to auto@
    // This prevents feedback loops where Bug Scout notifications
    // to auto@ get re-processed as new bug reports endlessly.
    // ==============================================
    const fromLower = from.toLowerCase();
    const fromAddr = (fromLower.match(/<(.+)>/)?.[1] || fromLower).trim();
    if (fromAddr.endsWith("@alpacaplayhouse.com")) {
      const toAutoOrNoreply = toList.some(t => {
        const p = extractPrefix(t);
        return p === "auto" || p === "noreply" || p === "pai";
      });
      if (toAutoOrNoreply) {
        console.log(`LOOP GUARD: Blocking self-sent email from ${fromAddr} to ${toList.join(",")}, subject: ${subject}`);
        await supabase.from("inbound_emails").insert({
          resend_email_id: emailId,
          from_address: from,
          to_address: toList[0],
          subject,
          route_action: "blocked_loop",
          special_logic_type: "loop_guard",
          raw_payload: data,
        });
        return new Response(JSON.stringify({ ok: true, blocked: "loop_guard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

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
