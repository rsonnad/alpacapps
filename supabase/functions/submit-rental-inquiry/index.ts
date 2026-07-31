/**
 * Submit Rental Inquiry (AA17 #10 + #20)
 *
 * Public-facing endpoint that:
 *   1. Honeypot + (optional) Cloudflare Turnstile check  ──── #10 spam
 *   2. Per-IP rate limit (5 / hour, 20 / day)            ──── #10 rate
 *   3. Atomic person + rental_application insert via RPC ──── #20 atomic
 *   4. Returns the status_token for the applicant-facing
 *      /rentals/status page.                              ──── #23
 *
 * Trusts only the body fields the RPC whitelists. The client may also
 * pass `turnstile_token` (verified server-side) and a `hp` honeypot
 * field which MUST be empty.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { withCors, jsonOk, jsonError, checkRateLimit, getClientIp } from '../_shared/function-wrapper.ts';
import { screenRentalInquiry } from '../_shared/rental-inquiry-screening.ts';

interface Body {
  person?: Record<string, unknown>;
  application?: Record<string, unknown>;
  turnstile_token?: string;
  hp?: string;  // honeypot — must be empty
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const body = await req.json() as Body;
  const { person = {}, application = {}, turnstile_token, hp } = body;

  // Honeypot — bots tend to fill in everything.
  if (hp && String(hp).trim().length > 0) {
    console.log('Honeypot triggered, silently dropping');
    return jsonOk({ success: true, dropped: 'honeypot' });
  }

  // Required fields the schema enforces but worth surfacing nicely.
  const firstName = String((person as any).first_name || '').trim();
  const email = String((person as any).email || '').trim();
  if (!firstName) return jsonError('First name is required', 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonError('A valid email is required', 400);
  }

  const ip = getClientIp(req);

  // Rate limit — 5/hour AND 20/day per IP.
  const okHour = await checkRateLimit(supabase, 'submit_rental_inquiry_hour', ip, 5, 3600);
  if (!okHour) return jsonError('Too many submissions — please try again later.', 429);
  const okDay = await checkRateLimit(supabase, 'submit_rental_inquiry_day', ip, 20, 86400);
  if (!okDay) return jsonError('Daily submission limit reached for your network.', 429);

  // Screen before storing the submission or sending any notification. Put this
  // behind the rate limit so a bot cannot use OpenRouter as an expensive oracle.
  // The AI check is conservative and fails open; obvious generated tokens are
  // caught deterministically even if OpenRouter is unavailable.
  const screening = await screenRentalInquiry(person);
  if (!screening.allowed) {
    console.warn('Blocked gibberish rental inquiry', { source: screening.source });
    return jsonError('Please enter a name and responses that we can understand, then try again.', 422);
  }

  // Optional Turnstile verification — only enforced if the secret is set.
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (turnstileSecret) {
    if (!turnstile_token) {
      return jsonError('Captcha verification required', 400);
    }
    const tsForm = new FormData();
    tsForm.append('secret', turnstileSecret);
    tsForm.append('response', turnstile_token);
    tsForm.append('remoteip', ip);
    try {
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: tsForm,
      });
      const tsJson = await tsRes.json();
      if (!tsJson.success) {
        return jsonError('Captcha verification failed', 400, { codes: tsJson['error-codes'] || [] });
      }
    } catch (e) {
      // Fail open on transient errors so applications still flow during outages,
      // but log loudly.
      console.error('Turnstile verify error (failing open):', e);
    }
  }

  // #20 atomic insert via RPC.
  const { data, error } = await supabase.rpc('submit_rental_inquiry', {
    p_person: person,
    p_app: application,
  });

  if (error) {
    console.error('submit_rental_inquiry RPC error:', error);
    return jsonError(error.message || 'Submission failed', 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  // Keep notifications on the authoritative path. This ensures a rejected
  // inquiry never generates an admin email, even when callers bypass the UI.
  const accommodationLabels: Record<string, string> = {
    bed_shared_room: 'Bed in a shared room', private_room: 'Private room',
    private_suite: 'Private suite / studio', rv_van: 'RV / Van spot',
    tent_camping: 'Tent / Camping', flexible: 'Flexible / Open to anything',
  };
  const emailData = {
    name: `${firstName} ${String((person as any).last_name || '').trim()}`.trim(), email,
    phone: String((person as any).phone || ''), dob: String((person as any).date_of_birth || ''),
    accommodation: accommodationLabels[String((person as any).preferred_accommodation || '')] || String((person as any).preferred_accommodation || ''),
    timeframe: String((person as any).desired_timeframe || ''),
    volunteer: String((person as any).volunteer_interest || 'Not specified'),
    referral: String((person as any).referral_source || ''),
    coliving_experience: String((person as any).coliving_experience || ''),
    life_focus: String((person as any).life_focus || ''),
    visiting_guide: String((person as any).visiting_guide_response || ''),
    photo_url: String((person as any).photo_url || ''),
  };
  const sendEmail = (type: string, to: string[], data: Record<string, unknown>) => fetch(
    `${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseServiceKey}`, apikey: supabaseServiceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, to, data }),
    },
  );
  try {
    const [adminResult, confirmationResult] = await Promise.all([
      sendEmail('community_fit_inquiry', ['team@alpacaplayhouse.com'], emailData),
      sendEmail('community_fit_confirmation', [email], { name: firstName, accommodation: emailData.accommodation, timeframe: emailData.timeframe }),
    ]);
    if (!adminResult.ok || !confirmationResult.ok) console.error('Inquiry email notification failed', { admin: adminResult.status, confirmation: confirmationResult.status });
  } catch (error) {
    // The already-saved application remains successful if email is transiently unavailable.
    console.error('Inquiry email notification error:', error);
  }

  return jsonOk({
    success: true,
    person_id: row.person_id,
    application_id: row.application_id,
    status_token: row.status_token,
    status_url: `https://alpacaplayhouse.com/rentals/status.html?token=${row.status_token}`,
  });
}));
