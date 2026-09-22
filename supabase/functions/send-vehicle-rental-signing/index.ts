/**
 * Send Vehicle Rental for Signature
 *
 * Renders the vehicle rental agreement, freezes it, and emails the renter a
 * signing link. The owner's signature is pre-applied; the renter's signature
 * on the native signing page (rentals/signing/) completes execution.
 *
 * POST {
 *   vehicle_rental_id: string,
 *   cc?: string[],          // copied on this email and on the executed copy
 *   dry_run?: boolean,      // render only — no token, no writes, no email
 * }
 *
 * Auth: admin / oracle session, or the service role.
 *
 * Why this runs server-side (unlike native-signing-service.js for leases):
 * vehicle_rentals is readable and writable by the public anon role, so the
 * signing token and the signed text cannot live on it. Both go into
 * vehicle_rental_signings, which only the service role can reach, and the
 * rendered HTML stored there is what the renter signs — edits to
 * vehicle_rentals after sending cannot change it.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeadersOpen } from "../_shared/api-helpers.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import { renderVehicleRentalAgreement, escapeHtml } from "../_shared/vehicle-rental-agreement.ts";

const SIGNING_PAGE_BASE = 'https://alpacaplayhouse.com/rentals/signing/';
const OWNER_INBOX = 'alpacaplayhouse@gmail.com';
const TOKEN_EXPIRY_DAYS = 14;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersOpen });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const auth = await requireFunctionRoles(req, supabase, ['admin', 'oracle']);
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const vehicleRentalId = String(body.vehicle_rental_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(vehicleRentalId)) return json({ error: 'vehicle_rental_id is required' }, 400);

    const rendered = await renderVehicleRentalAgreement(supabase, vehicleRentalId);

    if (!EMAIL_RE.test(rendered.signerEmail)) {
      return json({ error: `Renter email looks invalid: ${rendered.signerEmail}` }, 422);
    }

    if (body.dry_run === true) {
      return json({
        dry_run: true,
        document_html: rendered.html,
        signer_name: rendered.signerName,
        signer_email: rendered.signerEmail,
        template_id: rendered.templateId,
        template_version: rendered.templateVersion,
      });
    }

    const requestedCc: string[] = Array.isArray(body.cc) ? body.cc.map((s: unknown) => String(s).trim()) : [];
    const badCc = requestedCc.filter((c) => !EMAIL_RE.test(c));
    if (badCc.length) return json({ error: `Invalid cc address: ${badCc.join(', ')}` }, 400);
    const signerLower = rendered.signerEmail.toLowerCase();
    const ccEmails = [...new Set([...requestedCc, OWNER_INBOX].map((c) => c.toLowerCase()))]
      .filter((c) => c !== signerLower);

    // A new link replaces any link still open for this rental. Its version is
    // one past the last *completed* execution — audit rows are unique per
    // (rental, version, role), so reusing an executed version would make the
    // new signature collide with the old one. Superseded, never-signed links
    // hold no audit rows, so they don't consume a version.
    const { data: lastSigned } = await supabase
      .from('vehicle_rental_signings')
      .select('signing_version')
      .eq('vehicle_rental_id', vehicleRentalId)
      .eq('status', 'signed')
      .order('signing_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const signingVersion = (lastSigned?.signing_version || 0) + 1;

    const { error: supersedeErr } = await supabase
      .from('vehicle_rental_signings')
      .update({ status: 'superseded' })
      .eq('vehicle_rental_id', vehicleRentalId)
      .eq('status', 'sent');
    if (supersedeErr) throw supersedeErr;

    const token = crypto.randomUUID();
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + TOKEN_EXPIRY_DAYS * 86_400_000);
    const signingUrl = `${SIGNING_PAGE_BASE}?token=${token}`;
    const sentBy = auth.caller?.isServiceRole ? 'service_role' : (auth.caller?.appUser?.id || 'admin');

    const { data: signing, error: insertErr } = await supabase
      .from('vehicle_rental_signings')
      .insert({
        vehicle_rental_id: vehicleRentalId,
        signing_token: token,
        token_expires_at: expiresAt.toISOString(),
        status: 'sent',
        signing_version: signingVersion,
        signer_name: rendered.signerName,
        signer_email: rendered.signerEmail,
        cc_emails: ccEmails,
        document_html: rendered.html,
        document_hash: await sha256Hex(rendered.html),
        template_id: rendered.templateId,
        template_version: rendered.templateVersion,
        sent_at: sentAt.toISOString(),
        sent_by: sentBy,
      })
      .select('id')
      .single();
    if (insertErr) {
      // 23505 on idx_vehicle_rental_signings_one_open: a concurrent send won.
      if (insertErr.code === '23505') return json({ error: 'Another signing link was just issued for this rental' }, 409);
      throw insertErr;
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

    const { data: rental } = await supabase
      .from('vehicle_rentals')
      .select('current_monthly_rate, security_deposit_amount, start_date, contract_terms')
      .eq('id', vehicleRentalId)
      .single();

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: [rendered.signerEmail],
        cc: ccEmails,
        // §5 and §14 direct the renter's license and insurance documents to
        // the owner inbox — make a plain reply land there too.
        reply_to: OWNER_INBOX,
        subject: 'Please Sign: Vehicle Rental Agreement - Alpaca Playhouse',
        html: signingEmailHtml({
          firstName: rendered.signerName.split(' ')[0],
          vehicleLabel: rendered.vehicleLabel,
          signingUrl,
          documentHtml: rendered.html,
          rate: Number(rental?.current_monthly_rate || 0),
          deposit: Number(rental?.security_deposit_amount || 0),
          insuranceStart: rental?.contract_terms?.insurance_start_date,
          firstMonthLabel: rental?.start_date
            ? new Date(`${rental.start_date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' })
            : 'First month',
        }),
        text: `Hi ${rendered.signerName.split(' ')[0]},\n\nYour vehicle rental agreement for the ${rendered.vehicleLabel} is ready to sign:\n${signingUrl}\n\nThe owner has already signed; your signature completes the agreement. This link expires in ${TOKEN_EXPIRY_DAYS} days. The full agreement text is in the HTML version of this email.\n\n— Alpaca Playhouse`,
      }),
    });
    const emailBody = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      // Don't leave a live link nobody was told about.
      await supabase.from('vehicle_rental_signings').update({ status: 'superseded' }).eq('id', signing.id);
      return json({ error: `Signing email failed: ${emailBody?.message || emailRes.status}` }, 502);
    }

    await supabase
      .from('vehicle_rentals')
      .update({ agreement_status: 'sent', agreement_sent_at: sentAt.toISOString(), updated_at: sentAt.toISOString() })
      .eq('id', vehicleRentalId);

    return json({
      success: true,
      signing_id: signing.id,
      signing_url: signingUrl,
      expires_at: expiresAt.toISOString(),
      signing_version: signingVersion,
      sent_to: rendered.signerEmail,
      cc: ccEmails,
      email_id: emailBody?.id || null,
    });
  } catch (e) {
    console.error('send-vehicle-rental-signing error:', e);
    return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function signingEmailHtml(o: {
  firstName: string; vehicleLabel: string; signingUrl: string; documentHtml: string;
  rate: number; deposit: number; insuranceStart?: string; firstMonthLabel: string;
}): string {
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const insurance = o.insuranceStart
    ? new Date(`${o.insuranceStart}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
    : '';
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${value}</td></tr>`;

  return `
    <h2>Your Vehicle Rental Agreement Is Ready to Sign</h2>
    <p>Hi ${escapeHtml(o.firstName)},</p>
    <p>Your rental agreement for the <strong>${escapeHtml(o.vehicleLabel)}</strong> is ready for your review and signature. The full text is included below — read it at your own pace, then click <strong>Review &amp; Sign Document</strong> when you're ready.</p>

    <div style="background:#f8f6f1;border:1px solid #e6dec9;border-radius:10px;padding:16px 18px;margin:0 0 20px;">
      <h3 style="margin:0 0 8px;color:#1c1618;">What's due on signing</h3>
      <table style="width:100%;border-collapse:collapse;font-size:0.95em;">
        ${row('Security deposit', money(o.deposit))}
        ${row(`${escapeHtml(o.firstMonthLabel)} rent`, money(o.rate))}
        <tr style="background:#efe9d8;"><td style="padding:10px 12px;"><strong>Total due on execution</strong></td><td style="padding:10px 12px;text-align:right;font-size:1.1em;"><strong>${money(o.deposit + o.rate)}</strong></td></tr>
        ${row('Monthly rent thereafter', `${money(o.rate)} on the 1st`)}
      </table>
      <p style="margin:12px 0 0;color:#555;font-size:0.9em;">Payments: <a href="https://alpacaplayhouse.com/pay" style="color:#3d8b7a;">alpacaplayhouse.com/pay</a></p>
    </div>

    <div style="background:#fdf6ee;border-left:4px solid #d4883a;padding:12px 16px;margin:0 0 20px;font-size:0.93em;color:#5a3d1c;">
      <strong>Also due when you sign</strong> (reply to this email with them):
      <ul style="margin:6px 0 0;padding-left:20px;">
        <li>A copy of your driver's license</li>
        <li>Your insurance policy documents, including the declarations page, showing coverage in force from <strong>${insurance || 'the date in Section 5'}</strong> with Rahul Sonnad listed as owner/beneficiary</li>
      </ul>
    </div>

    <div style="background:#f1f8f4;border-left:4px solid #3d8b7a;padding:10px 14px;margin:0 0 16px;font-size:0.92em;color:#1c4a3e;">
      <strong>Pre-signed by the Owner.</strong> Rahul Sonnad has already signed this agreement. Your signature, applied through the secure link below, completes it.
    </div>

    <div style="text-align:center;margin:2rem 0;">
      <a href="${o.signingUrl}" style="display:inline-block;background:#3d8b7a;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:1.1em;">Review &amp; Sign Document</a>
    </div>

    <p style="color:#888;font-size:0.85em;">This link expires in ${TOKEN_EXPIRY_DAYS} days. Questions before signing? Just reply to this email.</p>
    <p style="color:#888;font-size:0.8em;">If the button doesn't work, paste this link into your browser:<br><a href="${o.signingUrl}" style="color:#3d8b7a;word-break:break-all;">${o.signingUrl}</a></p>

    <div style="text-align:center;padding:16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height:40px;margin:0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height:80px;border-radius:8px;margin:0 8px;" /></div>

    <hr style="border:none;border-top:2px solid #e0e0e0;margin:2.5rem 0 1.5rem;">
    <h3 style="margin:0 0 0.5rem;color:#1c1618;">Full Agreement (for your records)</h3>
    <p style="color:#666;font-size:0.9em;margin:0 0 1.5rem;">This is the complete text you'll be signing — identical to what the signing page shows.</p>
    <div style="border:1px solid #e0e0e0;border-radius:8px;padding:24px;background:#fdfdfd;font-size:0.95em;line-height:1.55;">
      ${o.documentHtml}
    </div>
  `;
}
