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
  "payments": "payments",
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
  }

  // herd@ - not yet implemented
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

  // Notify admin
  const overpayment = remaining > 0 ? remaining : 0;
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
  // Extract email address from "Name <email>" format
  const fromEmail = from.match(/<(.+)>/)?.[1] || from;
  const toEmail = toAddr.match(/<(.+)>/)?.[1] || toAddr;

  if (fromEmail.includes("auto@alpacaplayhouse.com") || fromEmail.includes("noreply@alpacaplayhouse.com") ||
      toEmail.includes("auto@alpacaplayhouse.com") || toEmail.includes("noreply@alpacaplayhouse.com")) {
    console.log("Ignoring automated email reply loop", { from: fromEmail, to: toEmail });
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
