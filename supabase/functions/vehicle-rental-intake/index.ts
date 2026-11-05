/**
 * Vehicle Rental Intake — the renter fills in their own details, then signs.
 *
 * For rentals where the owner doesn't have the renter's details yet (a
 * short-term rental arranged over chat). The owner creates the
 * vehicle_rentals row with the terms and a contract_terms.intake_token, and
 * sends the renter https://alpacaplayhouse.com/rentals/car/?t=<token>.
 *
 *   POST application/json { action: 'get', token }
 *     → the rental terms to show on the form, plus the open signing link if
 *       the renter already submitted.
 *
 *   POST multipart/form-data { token, legal_name, email, phone, address, dob,
 *       dl_number, dl_state, fsd ('1'|'0'), license_front, license_back? }
 *     → stores the license photos in the private identity-documents bucket,
 *       writes the renter's details, renders and freezes the agreement into a
 *       vehicle_rental_signings row (same as send-vehicle-rental-signing), and
 *       returns the signing URL. Resubmitting before signing replaces the
 *       open link.
 *
 * Auth: the intake token. Deploy with --no-verify-jwt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeadersOpen } from "../_shared/api-helpers.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import {
  renderVehicleRentalAgreement, escapeHtml, shortTermTotal, SHORT_TERM_TEMPLATE_TYPE,
} from "../_shared/vehicle-rental-agreement.ts";

const SIGNING_PAGE_BASE = 'https://alpacaplayhouse.com/rentals/signing/';
const OWNER_INBOX = 'alpacaplayhouse@gmail.com';
const TOKEN_EXPIRY_DAYS = 14;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersOpen });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const { data: allowed } = await supabase.rpc('check_rate_limit', {
      p_bucket: 'vehicle_rental_intake', p_ip: ip, p_max_attempts: 40, p_window_seconds: 600,
    });
    if (allowed === false) return json({ error: 'Too many attempts — please wait a few minutes.' }, 429);
  } catch (_e) { /* fail open */ }

  try {
    const isMultipart = (req.headers.get('content-type') || '').includes('multipart/form-data');
    if (!isMultipart) {
      const body = await req.json().catch(() => ({}));
      if (body.action !== 'get') return json({ error: 'Unknown action' }, 400);
      const rental = await loadRental(supabase, String(body.token || ''));
      if (rental instanceof Response) return rental;
      return json(await publicView(supabase, rental));
    }

    const form = await req.formData();
    const rental = await loadRental(supabase, String(form.get('token') || ''));
    if (rental instanceof Response) return rental;
    if (rental.agreement_status === 'signed') return json({ error: 'This agreement has already been signed.' }, 409);

    // ── Validate the renter's input ──
    const field = (k: string, max = 300) => String(form.get(k) || '').trim().slice(0, max);
    const legalName = field('legal_name', 120);
    const email = field('email', 200).toLowerCase();
    const phone = field('phone', 40);
    const address = field('address', 300);
    const dob = field('dob', 10);
    const dlNumber = field('dl_number', 40);
    const dlState = field('dl_state', 40);
    const fsd = form.get('fsd') === '1';
    const front = form.get('license_front');
    const back = form.get('license_back');

    const errors: string[] = [];
    if (legalName.split(/\s+/).length < 2) errors.push('full legal name (first and last)');
    if (!EMAIL_RE.test(email)) errors.push('a valid email');
    if (phone.replace(/\D/g, '').length < 7) errors.push('a phone number');
    if (address.length < 8) errors.push('your full address');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || ageOn(dob, new Date()) < 18 || ageOn(dob, new Date()) > 110) {
      errors.push('a valid date of birth (18 or older)');
    }
    if (dlNumber.length < 4) errors.push('your driver\'s license number');
    if (!dlState) errors.push('the state or country that issued your license');
    if (!(front instanceof File) || front.size === 0) errors.push('a photo of the front of your license');
    for (const f of [front, back]) {
      if (f instanceof File && f.size > 0) {
        if (!f.type.startsWith('image/')) errors.push('license photos must be images');
        if (f.size > MAX_PHOTO_BYTES) errors.push('license photos must be under 12 MB');
      }
    }
    if (errors.length) return json({ error: `Please provide ${[...new Set(errors)].join(', ')}.` }, 400);

    // ── Store license photos (private bucket) ──
    const stamp = Date.now();
    const photoPaths: string[] = [];
    for (const [label, f] of [['front', front], ['back', back]] as const) {
      if (!(f instanceof File) || f.size === 0) continue;
      const ext = (f.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
      const path = `vehicle-rental-${rental.id}/license-${label}-${stamp}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('identity-documents')
        .upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
      if (upErr) {
        console.error('License upload failed:', upErr);
        return json({ error: 'Could not save your license photo. Please try again.' }, 500);
      }
      photoPaths.push(path);
    }

    // ── Write the renter's details ──
    const now = new Date().toISOString();
    const terms = {
      ...(rental.contract_terms || {}),
      renter_dob: dob,
      fsd_selected: fsd,
      license_photo_paths: photoPaths,
      intake_submitted_at: now,
      intake_ip: ip,
    };
    const { error: updErr } = await supabase
      .from('vehicle_rentals')
      .update({
        renter_name: legalName,
        renter_email: email,
        renter_phone: phone,
        renter_address: address,
        renter_dl_number: dlNumber,
        renter_dl_state: dlState,
        contract_terms: terms,
        updated_at: now,
      })
      .eq('id', rental.id);
    if (updErr) throw updErr;

    // ── Render, freeze, and open a signing link ──
    const rendered = await renderVehicleRentalAgreement(supabase, rental.id);

    const { data: lastSigned } = await supabase
      .from('vehicle_rental_signings')
      .select('signing_version')
      .eq('vehicle_rental_id', rental.id)
      .eq('status', 'signed')
      .order('signing_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const signingVersion = (lastSigned?.signing_version || 0) + 1;

    const { error: supersedeErr } = await supabase
      .from('vehicle_rental_signings')
      .update({ status: 'superseded' })
      .eq('vehicle_rental_id', rental.id)
      .eq('status', 'sent');
    if (supersedeErr) throw supersedeErr;

    const signingToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86_400_000);
    const ccEmails = [OWNER_INBOX].filter((c) => c !== email);
    const { error: insErr } = await supabase
      .from('vehicle_rental_signings')
      .insert({
        vehicle_rental_id: rental.id,
        signing_token: signingToken,
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
        sent_at: now,
        sent_by: 'renter_intake',
      });
    if (insErr) {
      if (insErr.code === '23505') return json({ error: 'Another signing link was just issued — please reload.' }, 409);
      throw insErr;
    }

    await supabase
      .from('vehicle_rentals')
      .update({ agreement_status: 'sent', agreement_sent_at: now })
      .eq('id', rental.id);

    const signingUrl = `${SIGNING_PAGE_BASE}?token=${signingToken}`;
    await notifyOwner(supabase, {
      rentalId: rental.id, legalName, email, phone, address, dob, dlNumber, dlState, fsd,
      total: shortTermTotal(terms), vehicleLabel: rendered.vehicleLabel, photoPaths, signingUrl,
    });

    return json({ success: true, signing_url: signingUrl });
  } catch (e) {
    console.error('vehicle-rental-intake error:', e);
    return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
  }
});

async function loadRental(supabase: any, token: string): Promise<any | Response> {
  if (!UUID_RE.test(token)) return json({ error: 'This link is not valid.' }, 404);
  const { data: rental } = await supabase
    .from('vehicle_rentals')
    .select('id, vehicle_id, renter_name, renter_email, vehicle_year, vehicle_make, vehicle_model, vehicle_color, accident_deductible_max, mileage_overage_rate, late_return_hourly_rate, agreement_status, contract_terms')
    .eq('contract_terms->>intake_token', token)
    .maybeSingle();
  if (!rental || rental.contract_terms?.template_type !== SHORT_TERM_TEMPLATE_TYPE) {
    return json({ error: 'This link is not valid.' }, 404);
  }
  const exp = rental.contract_terms?.intake_expires_at;
  if (exp && new Date(exp) < new Date()) {
    return json({ error: 'This link has expired. Please ask for a new one.' }, 410);
  }
  return rental;
}

async function publicView(supabase: any, rental: any) {
  const t = rental.contract_terms || {};
  let vehicleName = '';
  if (rental.vehicle_id) {
    const { data: v } = await supabase.from('vehicles').select('name').eq('id', rental.vehicle_id).maybeSingle();
    vehicleName = v?.name || '';
  }
  let openSigningUrl: string | null = null;
  if (rental.agreement_status !== 'signed') {
    const { data: open } = await supabase
      .from('vehicle_rental_signings')
      .select('signing_token, token_expires_at')
      .eq('vehicle_rental_id', rental.id)
      .eq('status', 'sent')
      .maybeSingle();
    if (open && new Date(open.token_expires_at) > new Date()) {
      openSigningUrl = `${SIGNING_PAGE_BASE}?token=${open.signing_token}`;
    }
  }
  const submitted = !!t.intake_submitted_at;
  return {
    vehicle: {
      label: [rental.vehicle_year, rental.vehicle_make, rental.vehicle_model].filter(Boolean).join(' '),
      name: vehicleName,
      color: rental.vehicle_color || '',
    },
    pickup_at: t.pickup_at,
    return_at: t.return_at,
    pickup_location: t.pickup_location,
    return_location: t.return_location || t.pickup_location,
    base_price: Number(t.base_price || 0),
    fsd_price: Number(t.fsd_price || 0),
    mileage_included: Number(t.mileage_included ?? 1000),
    overage_rate: Number(rental.mileage_overage_rate ?? 0.15),
    deductible: Number(rental.accident_deductible_max ?? 1000),
    late_fee: Number(rental.late_return_hourly_rate ?? 20),
    signed: rental.agreement_status === 'signed',
    open_signing_url: openSigningUrl,
    // Prefill: only the name/email the owner typed in, or what the renter
    // already submitted. Never echo DOB, license number or address back.
    prefill: {
      legal_name: rental.renter_name || '',
      email: rental.renter_email || '',
      fsd: submitted ? !!t.fsd_selected : false,
    },
  };
}

async function notifyOwner(supabase: any, o: {
  rentalId: string; legalName: string; email: string; phone: string; address: string; dob: string;
  dlNumber: string; dlState: string; fsd: boolean; total: number; vehicleLabel: string;
  photoPaths: string[]; signingUrl: string;
}) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return;
  try {
    const links: string[] = [];
    for (const p of o.photoPaths) {
      const { data } = await supabase.storage.from('identity-documents').createSignedUrl(p, 60 * 60 * 24 * 30);
      if (data?.signedUrl) links.push(`<a href="${data.signedUrl}">${escapeHtml(p.split('/').pop())}</a>`);
    }
    const e = escapeHtml;
    const row = (k: string, v: string) => `<tr><td style="padding:4px 10px;color:#666;">${k}</td><td style="padding:4px 10px;"><strong>${v}</strong></td></tr>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        to: [OWNER_INBOX],
        reply_to: o.email,
        subject: `Car rental details in: ${o.legalName} — ${o.vehicleLabel}`,
        html: `
          <h2>Rental details submitted</h2>
          <p>${e(o.legalName)} filled in the rental form for the <strong>${e(o.vehicleLabel)}</strong> and was sent to sign. You'll get the executed copy when they sign.</p>
          <table style="border-collapse:collapse;font-size:0.95em;">
            ${row('Legal name', e(o.legalName))}
            ${row('Email', e(o.email))}
            ${row('Phone', e(o.phone))}
            ${row('Address', e(o.address))}
            ${row('Date of birth', e(o.dob))}
            ${row('License', e(`${o.dlNumber} (${o.dlState})`))}
            ${row('FSD add-on', o.fsd ? 'Yes' : 'No')}
            ${row('Total due', `$${o.total.toFixed(2)}`)}
          </table>
          <p>License photos (links valid 30 days): ${links.join(' · ') || 'none'}</p>
          <p style="color:#888;font-size:0.85em;">Rental id ${e(o.rentalId)}</p>
        `,
      }),
    });
    if (!res.ok) console.error('Owner intake email failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('Owner intake email error:', err);
  }
}

function ageOn(dob: string, at: Date): number {
  const d = new Date(`${dob}T12:00:00Z`);
  if (isNaN(d.getTime())) return -1;
  let age = at.getUTCFullYear() - d.getUTCFullYear();
  const m = at.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

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
