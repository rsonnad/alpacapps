/**
 * Process Signature
 * Receives a completed signature from the tenant-facing signing page.
 * Validates the token, stores the signature, generates a signed PDF,
 * updates the application status, records audit log, and sends emails.
 *
 * POST {
 *   token: string,
 *   signature_image: string,  // base64 PNG of the signature
 *   document_hash: string,    // SHA-256 of the document HTML the signer saw
 *   document_html?: string,   // optional archival snapshot
 *   contact_info_update?: object,
 * }
 *
 * NOTE: signer_name and signer_email are intentionally ignored if sent —
 * they are resolved server-side from the signing token's person record
 * (see #8 in AA17). Don't trust the body for signer identity.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeadersOpen } from "../_shared/api-helpers.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersOpen });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    // #8: ignore client-supplied signer_name/signer_email — we look them up
    // from the token. Keep document_hash + signature_image + contact_info_update.
    const { token, signature_image, document_hash, document_html, contact_info_update } = body;

    if (!token || !signature_image || !document_hash) {
      return jsonError('Missing required fields', 400);
    }

    // Get client IP and user-agent for audit trail
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // #7 rate-limit signing attempts per IP — 20 / 10 minutes is plenty
    // for retries while still cutting off scripted abuse. Failures are
    // non-fatal (degrade open).
    try {
      const { data: allowed } = await supabase.rpc('check_rate_limit', {
        p_bucket: 'process_signature',
        p_ip: ipAddress,
        p_max_attempts: 20,
        p_window_seconds: 600
      });
      if (allowed === false) return jsonError('Too many signing attempts — please wait a few minutes and try again.', 429);
    } catch (_e) { /* fail-open */ }

    // ── Find the document ──────────────────────────────────────────

    // Try rental_applications
    const { data: rentalApp } = await supabase
      .from('rental_applications')
      .select(`
        id,
        signing_token_expires_at,
        agreement_status,
        agreement_document_url,
        signing_version,
        approved_rate,
        approved_rate_term,
        security_deposit_amount,
        reservation_deposit_amount,
        application_fee_paid,
        application_fee_amount,
        approved_move_in,
        waiver_template_id,
        approved_space:approved_space_id (id, name),
        person:person_id (id, first_name, last_name, email, current_address, emergency_contact_name, emergency_contact_phone)
      `)
      .eq('signing_token', token)
      .single();

    const { data: eventReq } = !rentalApp ? await supabase
      .from('event_hosting_requests')
      .select(`
        id,
        signing_token_expires_at,
        agreement_status,
        event_name,
        event_date,
        event_start_time,
        event_end_time,
        rental_fee,
        reservation_fee,
        cleaning_deposit,
        reservation_fee_paid,
        cleaning_deposit_paid,
        agreement_document_url,
        person:person_id (id, first_name, last_name, email)
      `)
      .eq('signing_token', token)
      .single() : { data: null };

    const app = rentalApp || eventReq;
    const docType = rentalApp ? 'rental' : 'event';

    if (!app) {
      return jsonError('Invalid signing token', 404);
    }

    // Validate token
    if (app.signing_token_expires_at && new Date(app.signing_token_expires_at) < new Date()) {
      return jsonError('Signing link has expired', 410);
    }
    if (app.agreement_status === 'signed') {
      return jsonError('Document already signed', 409);
    }

    const person = app.person as any;
    const signedAt = new Date().toISOString();

    // ── Store signature image ──────────────────────────────────────

    // Decode base64 signature to binary
    const base64Data = signature_image.replace(/^data:image\/\w+;base64,/, '');
    const signatureBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const sigPath = `signatures/sig-${docType}-${app.id}-${Date.now()}.png`;
    const { error: sigUploadErr } = await supabase.storage
      .from('lease-documents')
      .upload(sigPath, signatureBytes, {
        contentType: 'image/png',
        upsert: true,
      });

    if (sigUploadErr) {
      console.error('Signature upload error:', sigUploadErr);
      throw new Error('Failed to store signature');
    }

    const { data: sigUrlData } = supabase.storage
      .from('lease-documents')
      .getPublicUrl(sigPath);
    const signatureImageUrl = sigUrlData.publicUrl;

    // ── Resolve template provenance (#17) ──────────────────────────
    // Look up the active lease + waiver templates so we can stamp their
    // id+version into the audit log row. Mirrors what get-signing-document
    // rendered. The waiver_template_id may be explicitly set on the app.
    let leaseTemplate: any = null;
    let waiverTemplate: any = null;
    if (docType === 'rental') {
      const { data: lease } = await supabase
        .from('lease_templates')
        .select('id, version')
        .eq('is_active', true).eq('type', 'lease')
        .order('version', { ascending: false }).limit(1).single();
      leaseTemplate = lease;
      if ((rentalApp as any)?.waiver_template_id) {
        const { data: w } = await supabase
          .from('lease_templates')
          .select('id, version')
          .eq('id', (rentalApp as any).waiver_template_id)
          .single();
        waiverTemplate = w;
      } else {
        const { data: w } = await supabase
          .from('lease_templates')
          .select('id, version')
          .eq('is_active', true).eq('type', 'renter_waiver')
          .order('version', { ascending: false }).limit(1).maybeSingle();
        waiverTemplate = w;
      }
    } else {
      const { data: et } = await supabase
        .from('lease_templates')
        .select('id, version')
        .eq('is_active', true).eq('type', 'event_waiver')
        .order('version', { ascending: false }).limit(1).maybeSingle();
      leaseTemplate = et;
    }

    // #8 signer_name / signer_email come from the server-side person
    // record, not the client body.
    const serverSignerName = `${person?.first_name || ''} ${person?.last_name || ''}`.trim();
    const serverSignerEmail = person?.email || '';

    // ── Persist contact info collected on the signing page ─────────
    //
    // For RENTAL signings we REQUIRE current_address + emergency contact
    // (name + phone). The signing page collects these client-side, but
    // we must enforce server-side too so the API can't be called directly
    // to sign before we have these on file.

    if (contact_info_update && person?.id) {
      // Whitelist the columns we accept from the client to avoid mass-assignment.
      const allowed: Record<string, unknown> = {};
      const fields = ['current_address', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_email', 'emergency_contact_relationship'];
      for (const k of fields) {
        const v = (contact_info_update as Record<string, unknown>)[k];
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (trimmed) allowed[k] = trimmed;
        }
      }
      if (Object.keys(allowed).length > 0) {
        // people has no updated_at column — write only the whitelisted fields.
        const { error: piError } = await supabase
          .from('people')
          .update(allowed)
          .eq('id', person.id);
        if (piError) {
          console.error('Failed to update person contact info:', piError);
          return jsonError('Failed to save contact information. Please try again.', 500);
        }
      }
    }

    // Re-read the canonical fields on people AFTER the (optional) update,
    // so we evaluate against the persisted truth, not the client-supplied
    // payload. For rental signings, hard-block if any required field is
    // still blank.
    if (docType === 'rental' && person?.id) {
      const { data: refreshed, error: refreshErr } = await supabase
        .from('people')
        .select('current_address, emergency_contact_name, emergency_contact_phone')
        .eq('id', person.id)
        .single();
      if (refreshErr || !refreshed) {
        console.error('Failed to re-read person record:', refreshErr);
        return jsonError('Could not verify tenant record. Please try again.', 500);
      }
      const missing: string[] = [];
      if (!refreshed.current_address || !refreshed.current_address.trim()) missing.push('current address');
      if (!refreshed.emergency_contact_name || !refreshed.emergency_contact_name.trim()) missing.push('emergency contact name');
      if (!refreshed.emergency_contact_phone || !refreshed.emergency_contact_phone.trim()) missing.push('emergency contact phone');
      if (missing.length > 0) {
        return jsonError(
          `Cannot sign yet — please complete the Required Information form. Missing: ${missing.join(', ')}.`,
          422,
        );
      }
    }

    // ── Persist the fully-signed lease as a static HTML file ───────
    //
    // Both parties get a pointer to the same archival file
    // (rental_applications.agreement_document_url). The file embeds
    // the landlord's pre-signature, the tenant's drawn signature,
    // and the audit metadata, so opening the URL later shows the
    // executed agreement exactly as it was at signing time.
    if (!document_html?.trim()) {
      return jsonError('Cannot complete signing without an archival copy of the agreement.', 422);
    }

    let signedDocUrl: string | null = null;
    try {
      const fullSignedHtml = buildArchivalLeaseHtml({
        documentHtml: document_html || '',
        signerName: serverSignerName,
        signerEmail: serverSignerEmail,
        signedAt,
        ipAddress,
        userAgent,
        documentHash: document_hash,
        signatureImageUrl,
      });
      const objectPath = `signed/${app.id}-${Date.now()}.html`;
      const { error: uploadErr } = await supabase.storage
        .from('lease-documents')
        .upload(objectPath, new Blob([fullSignedHtml], { type: 'text/html; charset=utf-8' }), {
          cacheControl: '31536000', upsert: false,
        });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('lease-documents').getPublicUrl(objectPath);
      signedDocUrl = urlData?.publicUrl || null;
      if (!signedDocUrl) throw new Error('Unable to resolve archival lease URL');
    } catch (e) {
      console.error('Archival HTML save failed:', e);
      return jsonError('Could not preserve the executed lease. Nothing was marked signed; please try again.', 500);
    }

    // ── Record audit log only after the immutable agreement exists ──
    // A signature is not a completed execution until the exact document the
    // signer saw is safely retained. Each reissue has its own version.
    const signingVersion = docType === 'rental'
      ? Number((rentalApp as any)?.signing_version || 1)
      : 1;
    const tenantAuditEntry: Record<string, unknown> = {
      document_type: docType,
      rental_application_id: docType === 'rental' ? app.id : null,
      event_hosting_request_id: docType === 'event' ? app.id : null,
      signer_name: serverSignerName,
      signer_email: serverSignerEmail,
      signer_role: 'tenant',
      ip_address: ipAddress,
      user_agent: userAgent,
      document_hash,
      signature_image_url: signatureImageUrl,
      document_html,
      signed_at: signedAt,
      template_id: leaseTemplate?.id || null,
      template_version: leaseTemplate?.version || null,
      waiver_template_id: waiverTemplate?.id || null,
      waiver_template_version: waiverTemplate?.version || null,
      signing_version: signingVersion,
    };
    const { error: auditErr } = await supabase.from('signature_audit_log').insert(tenantAuditEntry);
    if (auditErr) {
      console.error('Tenant audit log error:', auditErr);
      return jsonError(auditErr.code === '23505' ? 'This document has already been signed.' : 'Could not preserve the signature audit trail.', auditErr.code === '23505' ? 409 : 500);
    }

    if (docType === 'rental') {
      let landlordUserId: string | null = null;
      let signingTokenIssuedAt: string | null = null;
      try {
        const { data: appRow } = await supabase
          .from('rental_applications')
          .select('last_activity_by, agreement_sent_at')
          .eq('id', app.id)
          .single();
        if (appRow?.last_activity_by && /^[0-9a-f-]{36}$/i.test(appRow.last_activity_by)) {
          landlordUserId = appRow.last_activity_by;
        }
        signingTokenIssuedAt = appRow?.agreement_sent_at || null;
      } catch (_e) { /* best-effort */ }

      const landlordAudit: Record<string, unknown> = {
        document_type: docType,
        rental_application_id: app.id,
        signer_name: 'Rahul Sonnad',
        signer_email: 'alpacaplayhouse@gmail.com',
        signer_role: 'landlord',
        ip_address: 'auto-signed (pre-authorized at send)',
        user_agent: 'AlpacApps Native Signing System',
        document_hash,
        document_html,
        signed_at: signedAt,
        template_id: leaseTemplate?.id || null,
        template_version: leaseTemplate?.version || null,
        waiver_template_id: waiverTemplate?.id || null,
        waiver_template_version: waiverTemplate?.version || null,
        landlord_user_id: landlordUserId,
        signing_token_issued_at: signingTokenIssuedAt,
        signing_version: signingVersion,
      };
      const { error: landlordAuditErr } = await supabase.from('signature_audit_log').insert(landlordAudit);
      if (landlordAuditErr) {
        console.error('Landlord audit log error:', landlordAuditErr);
        return jsonError('Could not preserve the landlord signature audit trail.', 500);
      }
    }

    // ── Update application status ──────────────────────────────────

    if (docType === 'rental') {
      const { error: appUpdateErr } = await supabase
        .from('rental_applications')
        .update({
          agreement_status: 'signed',
          agreement_signed_at: signedAt,
          signing_token: null, // Invalidate token
          signing_token_expires_at: null,
          ...(signedDocUrl ? { agreement_document_url: signedDocUrl } : {}),
          updated_at: signedAt,
        })
        .eq('id', app.id)
        .eq('signing_token', token);
      if (appUpdateErr) throw appUpdateErr;

      // Record waiver signature if applicable
      if (rentalApp?.waiver_template_id) {
        try {
          const { data: waiverTemplate } = await supabase
            .from('lease_templates')
            .select('id, version, type')
            .eq('id', rentalApp.waiver_template_id)
            .single();

          await supabase.from('waiver_signatures').insert({
            waiver_type: 'renter_waiver',
            template_version: waiverTemplate?.version || 1,
            signer_name: serverSignerName,
            signer_email: serverSignerEmail,
            person_id: person?.id || null,
            rental_application_id: app.id,
            signed_pdf_url: signatureImageUrl, // Link to signature for now
            signed_at: signedAt,
          });
        } catch (waiverErr) {
          console.error('Error recording waiver signature:', waiverErr);
        }
      }
    } else {
      await supabase
        .from('event_hosting_requests')
        .update({
          agreement_status: 'signed',
          agreement_signed_at: signedAt,
          signing_token: null,
          signing_token_expires_at: null,
          updated_at: signedAt,
        })
        .eq('id', app.id);
    }

    // ── Send emails ────────────────────────────────────────────────

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (RESEND_API_KEY && person?.email) {
      // Get payment methods
      const { data: paymentMethods } = await supabase
        .from('payment_methods')
        .select('name, method_type, account_identifier, instructions')
        .eq('is_active', true)
        .order('display_order');

      const paymentMethodsHtml = (paymentMethods || []).map((pm: any) => {
        let line = `<li><strong>${pm.name}</strong>`;
        if (pm.account_identifier) line += `: ${pm.account_identifier}`;
        if (pm.instructions) line += `<br><span style="color: #666; font-size: 0.9em;">${pm.instructions}</span>`;
        return line + '</li>';
      }).join('\n');

      if (docType === 'rental') {
        const spaceName = (rentalApp?.approved_space as any)?.name || 'your space';
        const reservationDeposit = rentalApp?.reservation_deposit_amount || rentalApp?.approved_rate || 0;

        let moveInDateFormatted = 'TBD';
        if (rentalApp?.approved_move_in) {
          moveInDateFormatted = new Date(rentalApp.approved_move_in + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
          });
        }

        const rateTermDisplay = rentalApp?.approved_rate_term === 'weekly' ? 'week'
          : rentalApp?.approved_rate_term === 'nightly' ? 'night' : 'month';

        await sendSignedEmail(RESEND_API_KEY, {
          to: person.email,
          firstName: person.first_name,
          subject: 'Lease Signed - Reservation Deposit Due - Alpaca Playhouse',
          spaceName,
          reservationDeposit,
          moveInDate: moveInDateFormatted,
          rate: rentalApp?.approved_rate,
          rateTerm: rateTermDisplay,
          paymentMethodsHtml,
          signatureImageUrl,
          signedAt,
          ipAddress,
          userAgent,
          documentHash: document_hash,
          archivalUrl: signedDocUrl,  // AA17 #19: link to executed lease
        });

        // Send vehicle registration email
        await sendVehicleEmail(supabase, RESEND_API_KEY, person);

      } else {
        const rentalFee = eventReq?.rental_fee || 295;
        const cleaningDeposit = eventReq?.cleaning_deposit || 195;

        let eventDateFormatted = 'TBD';
        let paymentDueDate = 'at least 7 days before your event';
        if (eventReq?.event_date) {
          const eventDate = new Date(eventReq.event_date + 'T12:00:00');
          eventDateFormatted = eventDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
          });
          const dueDate = new Date(eventDate);
          dueDate.setDate(dueDate.getDate() - 7);
          paymentDueDate = dueDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
          });
        }

        await sendEventSignedEmail(RESEND_API_KEY, {
          to: person.email,
          firstName: person.first_name,
          eventName: eventReq?.event_name || 'Event',
          eventDate: eventDateFormatted,
          rentalFee,
          cleaningDeposit,
          paymentDueDate,
          paymentMethodsHtml,
          signatureImageUrl,
          signedAt,
          ipAddress,
          userAgent,
          documentHash: document_hash,
          archivalUrl: signedDocUrl,  // AA17 #19
        });

        // Admin notification
        const hostName = `${person.first_name || ''} ${person.last_name || ''}`.trim();
        await sendAdminNotification(RESEND_API_KEY, {
          hostName,
          hostEmail: person.email,
          eventName: eventReq?.event_name || 'Event',
          eventDate: eventDateFormatted,
          signedAt,
          ipAddress,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Document signed successfully',
      document_type: docType,
      signed_at: signedAt,
    }), {
      headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('process-signature error:', error);
    return jsonError(error instanceof Error ? error.message : 'Internal error', 500);
  }
});

// ── Helper functions ─────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short',
  });
}

// Build the e-signature audit block HTML used in all post-signing emails
/**
 * Wrap the rendered lease HTML the tenant signed (which already has the
 * landlord's pre-signature embedded) plus an audit footer into a complete
 * standalone HTML document suitable for archival in lease-documents/signed/.
 * Both parties (tenant and landlord) reference the same file via
 * rental_applications.agreement_document_url.
 */
function buildArchivalLeaseHtml(opts: {
  documentHtml: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  ipAddress: string;
  userAgent: string;
  documentHash: string;
  signatureImageUrl: string;
}): string {
  const audit = auditBlockHtml(opts);
  const titleSafe = (opts.signerName || 'Signed Lease').replace(/[<>&]/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed Lease — ${titleSafe}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 820px; margin: 32px auto; padding: 0 20px 60px; color: #1c1618; line-height: 1.55; }
  h1 { font-size: 24px; }
  h2 { font-size: 18px; margin-top: 1.6em; }
  h3 { font-size: 15px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.6em 0; }
  .archival-banner { background:#f1f8f4; border-left: 4px solid #3d8b7a; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; color:#1c4a3e; }
</style>
</head>
<body>
  <div class="archival-banner"><strong>Executed Lease Agreement</strong> — signed by ${titleSafe} on ${formatDateTime(opts.signedAt)}. This file is the canonical archival record; both parties have the same URL on file.</div>
  ${opts.documentHtml}
  ${audit}
</body>
</html>`;
}

function landlordSignatureSvg(name: string, dateLabel: string): string {
  // Inline SVG renders reliably in Gmail web (the primary inbox we send to)
  // and most modern clients. Falls back gracefully — even when stripped,
  // the lease text below still names Rahul Sonnad as the pre-signing landlord.
  const safeName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg width="260" height="64" viewBox="0 0 260 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Landlord signature: ${safeName}">
    <text x="6" y="46" font-family="'Brush Script MT','Lucida Handwriting','Snell Roundhand',cursive" font-style="italic" font-size="38" fill="#1c4a3e">${safeName}</text>
    <line x1="0" y1="56" x2="260" y2="56" stroke="#aaa" stroke-width="0.5"/>
    <text x="0" y="63" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" fill="#888">Pre-signed ${dateLabel}</text>
  </svg>`;
}

function auditBlockHtml(opts: { signedAt: string; ipAddress: string; userAgent: string; documentHash: string; signatureImageUrl: string }): string {
  const landlordSig = landlordSignatureSvg('Rahul Sonnad', formatDateTime(opts.signedAt).split(',')[0] || formatDateTime(opts.signedAt));
  return `
    <div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <h3 style="margin-top: 0; color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Electronic Signature Record</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Signed at</td><td style="padding: 6px 0;">${formatDateTime(opts.signedAt)}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">IP Address</td><td style="padding: 6px 0;">${opts.ipAddress}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Browser</td><td style="padding: 6px 0; word-break: break-all; font-size: 11px;">${opts.userAgent}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Document Hash</td><td style="padding: 6px 0; font-family: monospace; font-size: 11px; word-break: break-all;">${opts.documentHash}</td></tr>
      </table>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px solid #eee; padding-top: 12px;">
        <tr>
          <td style="vertical-align: top; padding: 12px 8px 0 0; width: 50%;">
            <p style="color: #888; font-size: 12px; margin: 0 0 6px 0;">Landlord signature</p>
            <div style="border: 1px solid #eee; border-radius: 4px; padding: 6px 10px; background: #fff;">${landlordSig}</div>
            <p style="color: #555; font-size: 11px; margin: 6px 0 0 0;">Rahul Sonnad — Admin, Revocable Trust of Subhash Sonnad</p>
          </td>
          <td style="vertical-align: top; padding: 12px 0 0 8px; width: 50%;">
            <p style="color: #888; font-size: 12px; margin: 0 0 6px 0;">Tenant signature</p>
            <img src="${opts.signatureImageUrl}" alt="Tenant signature" style="max-width: 260px; max-height: 64px; height: auto; border: 1px solid #eee; border-radius: 4px; padding: 6px 10px; background: #fff;">
          </td>
        </tr>
      </table>
      <p style="color: #999; font-size: 11px; margin: 12px 0 0 0;">
        This document was signed electronically in compliance with the ESIGN Act (15 U.S.C. § 7001) and the Texas Uniform Electronic Transactions Act (Tex. Bus. & Com. Code Ch. 322).
      </p>
    </div>`;
}

async function sendSignedEmail(apiKey: string, opts: any) {
  try {
    const rateTermDisplay = opts.rateTerm || 'month';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: [opts.to],
        // Both parties receive the same executed agreement and archival link.
        cc: ['alpacaplayhouse@gmail.com'],
        reply_to: SENDER_MAP.pai.reply_to,
        subject: opts.subject,
        html: `
          <h2>Lease Signing Complete!</h2>
          <p>Hi ${opts.firstName},</p>
          <p>Your lease agreement for <strong>${opts.spaceName}</strong> has been successfully signed.</p>

          ${opts.archivalUrl ? `<p style="margin: 12px 0 18px 0;"><a href="${opts.archivalUrl}" style="display:inline-block;background:#3d8b7a;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;">View signed lease (HTML)</a></p>` : ''}

          ${auditBlockHtml(opts)}

          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #3d8b7a;">Reservation Deposit Due</h3>
            <p>To secure your space, please submit your reservation deposit:</p>
            <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
              <tr>
                <td style="padding: 8px 0;"><strong>Reservation Deposit:</strong></td>
                <td style="padding: 8px 0; text-align: right; font-size: 1.2em; font-weight: bold; color: #3d8b7a;">$${opts.reservationDeposit}</td>
              </tr>
            </table>
            <p style="font-size: 0.9em; color: #666; margin-bottom: 0;">This amount will be credited toward your first month's rent.</p>
          </div>

          <h3>Payment Options</h3>
          <ul style="line-height: 1.8;">${opts.paymentMethodsHtml}</ul>
          <p><strong>Important:</strong> Please include your name and "Reservation Deposit" in the payment memo.</p>

          <div style="background: #e5f4f1; border-left: 4px solid #3d8b7a; padding: 15px; margin: 20px 0;">
            <strong>Move-in Date:</strong> ${opts.moveInDate}<br>
            <strong>Monthly Rent:</strong> $${opts.rate || 'TBD'}/${rateTermDisplay}
          </div>

          <div style="background: #f0f7ff; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #3d8b7a;">Set Up Your Resident Profile</h3>
            <p>Fill out your resident profile so your housemates can get to know you!</p>
            <p style="margin-bottom: 0;"><a href="https://alpacaplayhouse.com/residents/profile.html" style="display: inline-block; background: #3d8b7a; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Complete Your Profile</a></p>
          </div>

          <p>Once we receive your reservation deposit, we'll send confirmation and prepare for your arrival.</p>
          <p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
          <div style="text-align: center; padding: 16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height: 40px; margin: 0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height: 80px; border-radius: 8px; margin: 0 8px;" /></div>
        `,
      }),
    });
    console.log('Rental signed email sent to', opts.to);
  } catch (e) {
    console.error('Error sending rental signed email:', e);
  }
}

async function sendEventSignedEmail(apiKey: string, opts: any) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: [opts.to],
        bcc: ['alpacaplayhouse@gmail.com'],
        reply_to: SENDER_MAP.pai.reply_to,
        subject: 'Event Agreement Signed - Outstanding Fees Due - Alpaca Playhouse',
        html: `
          <h2>Event Agreement Signed!</h2>
          <p>Hi ${opts.firstName},</p>
          <p>Your event agreement for <strong>${opts.eventName}</strong> has been successfully signed.</p>

          ${opts.archivalUrl ? `<p style="margin: 12px 0 18px 0;"><a href="${opts.archivalUrl}" style="display:inline-block;background:#3d8b7a;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;">View signed agreement (HTML)</a></p>` : ''}

          ${auditBlockHtml(opts)}

          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #3d8b7a;">Outstanding Fees Due 7 Days Before Event</h3>
            <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
              <tr><td style="padding: 8px 0;"><strong>Cleaning Deposit:</strong></td><td style="padding: 8px 0; text-align: right; font-weight: bold; color: #3d8b7a;">$${opts.cleaningDeposit}</td></tr>
              <tr style="border-bottom: 1px solid #ddd;"><td style="padding: 8px 0;"><strong>Rental Fee:</strong></td><td style="padding: 8px 0; text-align: right; font-weight: bold; color: #3d8b7a;">$${opts.rentalFee}</td></tr>
              <tr><td style="padding: 8px 0;"><strong>Total Due:</strong></td><td style="padding: 8px 0; text-align: right; font-size: 1.3em; font-weight: bold; color: #3d8b7a;">$${opts.cleaningDeposit + opts.rentalFee}</td></tr>
              <tr><td style="padding: 8px 0;"><strong>Due By:</strong></td><td style="padding: 8px 0; text-align: right; color: #e07a5f; font-weight: bold;">${opts.paymentDueDate}</td></tr>
            </table>
          </div>

          <h3>Payment Options</h3>
          <ul style="line-height: 1.8;">${opts.paymentMethodsHtml}</ul>

          <div style="background: #e5f4f1; border-left: 4px solid #3d8b7a; padding: 15px; margin: 20px 0;">
            <strong>Event:</strong> ${opts.eventName}<br>
            <strong>Date:</strong> ${opts.eventDate}
          </div>

          <p><strong>Reminders:</strong></p>
          <ul>
            <li>Setup crew must arrive 90 minutes before your event</li>
            <li>Direct attendees to <a href="https://alpacaplayhouse.com/visiting">alpacaplayhouse.com/visiting</a> for directions</li>
            <li>Cleanup must be completed by 1:01pm the day after your event</li>
          </ul>

          <p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
          <div style="text-align: center; padding: 16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height: 40px; margin: 0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height: 80px; border-radius: 8px; margin: 0 8px;" /></div>
        `,
      }),
    });
    console.log('Event signed email sent to', opts.to);
  } catch (e) {
    console.error('Error sending event signed email:', e);
  }
}

async function sendAdminNotification(apiKey: string, opts: any) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: ['alpacaplayhouse@gmail.com'],
        subject: `Agreement SIGNED by ${opts.hostName} - ${opts.eventName}`,
        html: `
          <h2>Agreement Signed!</h2>
          <p><strong>${opts.hostName}</strong> (${opts.hostEmail}) has signed the agreement.</p>
          <div style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0;">
            <strong>Event:</strong> ${opts.eventName}<br>
            <strong>Date:</strong> ${opts.eventDate}<br>
            <strong>Signed at:</strong> ${formatDateTime(opts.signedAt)}<br>
            <strong>IP:</strong> ${opts.ipAddress}
          </div>
          <p><a href="https://alpacaplayhouse.com/admin/events.html">View in Admin</a></p>
        `,
      }),
    });
  } catch (e) {
    console.error('Error sending admin notification:', e);
  }
}

async function sendVehicleEmail(supabase: any, apiKey: string, person: any) {
  try {
    const { data: driverRecords } = await supabase
      .from('vehicle_drivers')
      .select('vehicle:vehicle_id (make, model, year, color, vin, name)')
      .eq('person_id', person.id);

    const profileUrl = 'https://alpacaplayhouse.com/residents/profile.html#vehicles';
    const hasVehicle = driverRecords?.length > 0 && (driverRecords[0].vehicle as any)?.make;
    const v = hasVehicle ? driverRecords[0].vehicle as any : null;
    const vehicleLabel = v ? `${v.year} ${v.make} ${v.model}`.trim() : '';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: [person.email],
        reply_to: SENDER_MAP.pai.reply_to,
        subject: hasVehicle ? `Your Vehicle: ${vehicleLabel} - Alpaca Playhouse` : 'Register Your Vehicle - Alpaca Playhouse',
        html: `
          <h2>${hasVehicle ? 'Your Vehicle Information' : 'Register Your Vehicle'}</h2>
          <p>Hi ${person.first_name},</p>
          <p>${hasVehicle
            ? 'Now that your agreement is signed, here are the details for your assigned vehicle.'
            : 'Now that your lease is signed, please take a moment to register your vehicle so we can manage parking.'
          }</p>
          ${hasVehicle ? `
          <div style="background: #fdf6ee; border-left: 4px solid #d4883a; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #d4883a;">Your Assigned Vehicle</h3>
            <p><strong>${vehicleLabel}</strong>${v.color ? ` — ${v.color}` : ''}</p>
          </div>` : ''}
          <p style="text-align: center; margin: 20px 0;">
            <a href="${profileUrl}" style="display: inline-block; background: #3d8b7a; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">${hasVehicle ? 'View My Vehicle' : 'Register My Vehicle'}</a>
          </p>
          <p>Questions? Reply to this email.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
          <div style="text-align: center; padding: 16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height: 40px; margin: 0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height: 80px; border-radius: 8px; margin: 0 8px;" /></div>
        `,
      }),
    });
    console.log('Vehicle registration email sent to', person.email);
  } catch (e) {
    console.error('Error sending vehicle email:', e);
  }
}
