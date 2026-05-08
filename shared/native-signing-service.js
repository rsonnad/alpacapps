/**
 * Native Signing Service
 * Replaces SignWell with in-house e-signature flow.
 *
 * Admin-side service that:
 * 1. Generates a unique signing token
 * 2. Stores it on the rental_application or event_hosting_request
 * 3. Sends an email to the tenant/guest with the signing link
 *
 * The tenant opens the link → sees the lease rendered as HTML → signs with signature_pad →
 * the process-signature edge function handles the rest (audit log, status update, emails).
 */

import { supabase } from './supabase.js';

const SIGNING_PAGE_BASE = 'https://alpacaplayhouse.com/rentals/signing/';
const SUPABASE_FUNCTIONS_URL = 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1';

// Token expires in 14 days
const TOKEN_EXPIRY_DAYS = 14;

/**
 * Generate a UUID v4 signing token
 */
function generateToken() {
  return crypto.randomUUID();
}

/**
 * Send a rental lease for signature
 * Creates a signing token, stores it, and emails the tenant.
 *
 * @param {number} applicationId - rental_applications.id
 * @param {string} recipientEmail - Tenant email
 * @param {string} recipientName - Tenant full name
 * @returns {Object} { token, signing_url, expires_at }
 */
async function sendForSignature(applicationId, recipientEmail, recipientName) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const signingUrl = `${SIGNING_PAGE_BASE}?token=${token}`;

  // Store token on the application
  const { error } = await supabase
    .from('rental_applications')
    .update({
      signing_token: token,
      signing_token_expires_at: expiresAt,
      agreement_status: 'sent',
      agreement_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  if (error) throw error;

  // Fetch the rendered lease HTML + payment methods so the email is self-contained.
  // Tenant can read everything inline and only follow the Sign button when ready.
  const { documentHtml, waiverHtml } = await fetchSigningDocument(token);
  const paymentMethodsHtml = await fetchPaymentMethodsHtml();
  const paymentSummaryHtml = await buildRentalPaymentSummary(applicationId);

  await sendSigningEmail(recipientEmail, recipientName, signingUrl, 'rental', null, {
    documentHtml,
    waiverHtml,
    paymentMethodsHtml,
    paymentSummaryHtml,
  });

  return { token, signing_url: signingUrl, expires_at: expiresAt };
}

/**
 * Send an event agreement for signature
 */
async function sendEventForSignature(eventRequestId, recipientEmail, recipientName, eventName) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const signingUrl = `${SIGNING_PAGE_BASE}?token=${token}`;

  const { error } = await supabase
    .from('event_hosting_requests')
    .update({
      signing_token: token,
      signing_token_expires_at: expiresAt,
      agreement_status: 'sent',
      agreement_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventRequestId);

  if (error) throw error;

  const { documentHtml, waiverHtml } = await fetchSigningDocument(token);
  const paymentMethodsHtml = await fetchPaymentMethodsHtml();

  await sendSigningEmail(recipientEmail, recipientName, signingUrl, 'event', eventName, {
    documentHtml,
    waiverHtml,
    paymentMethodsHtml,
  });

  return { token, signing_url: signingUrl, expires_at: expiresAt };
}

// ── Helpers: fetch lease + payment context ─────────────────────────

async function fetchSigningDocument(token) {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/get-signing-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      console.warn('fetchSigningDocument: non-OK', res.status);
      return { documentHtml: '', waiverHtml: '' };
    }
    const data = await res.json();
    return {
      documentHtml: data.document_html || '',
      waiverHtml: data.waiver_html || '',
    };
  } catch (err) {
    console.warn('fetchSigningDocument failed:', err);
    return { documentHtml: '', waiverHtml: '' };
  }
}

/**
 * Build a Payment Summary HTML block for a rental application.
 * Shows: reservation deposit (due now), security deposit (due at move-in),
 * first-month rent (prorated, with reservation-deposit credit applied),
 * and the recurring monthly cadence (1st of each month).
 *
 * Returns '' if essential data is missing — caller renders no summary in that case.
 */
async function buildRentalPaymentSummary(applicationId) {
  try {
    const { data: app, error } = await supabase
      .from('rental_applications')
      .select('approved_rate, approved_rate_term, approved_move_in, approved_lease_end, security_deposit_amount, move_in_deposit_amount, reservation_deposit_amount, application_fee_paid, application_fee_amount')
      .eq('id', applicationId)
      .single();
    if (error || !app) return '';

    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const fmtDate = (d) => d
      ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
      : 'TBD';

    const rate = Number(app.approved_rate || 0);
    const term = app.approved_rate_term || 'monthly';
    const isMonthly = term === 'monthly';
    const reservationDeposit = Number(app.reservation_deposit_amount || 0);
    const securityDeposit = Number(app.security_deposit_amount || 0);
    const appFeePaid = (app.application_fee_paid && app.application_fee_amount) ? Number(app.application_fee_amount) : 0;

    // Prorated first month's rent if monthly + we have a move-in date
    let proratedRent = 0;
    let prorationNote = '';
    if (isMonthly && app.approved_move_in) {
      const moveIn = new Date(app.approved_move_in + 'T12:00:00');
      const y = moveIn.getFullYear(), m = moveIn.getMonth();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const daysRemaining = daysInMonth - moveIn.getDate() + 1; // inclusive of move-in day
      proratedRent = Math.round((rate * daysRemaining / daysInMonth) * 100) / 100;
      prorationNote = `Prorated for ${daysRemaining} of ${daysInMonth} days in ${moveIn.toLocaleDateString('en-US', { month: 'long' })}.`;
    } else {
      proratedRent = rate;
    }

    const credits = reservationDeposit + appFeePaid;
    const firstMonthBalance = Math.max(0, proratedRent - credits);

    const moveInLabel = fmtDate(app.approved_move_in);

    const rows = [];
    if (reservationDeposit > 0) {
      rows.push({ label: 'Reservation Deposit', amount: fmt(reservationDeposit), when: 'Due now — holds your space', note: 'Credited toward first month\'s rent.' });
    }
    if (securityDeposit > 0) {
      rows.push({ label: 'Security Deposit', amount: fmt(securityDeposit), when: `Due by move-in (${moveInLabel})`, note: 'Refundable at end of lease, less any deductions.' });
    }
    rows.push({
      label: isMonthly ? 'First Month\'s Rent' : 'Rent',
      amount: fmt(proratedRent),
      when: `Due by move-in (${moveInLabel})`,
      note: [prorationNote, credits > 0 ? `Less ${fmt(credits)} credits already paid → balance owed at move-in: ${fmt(firstMonthBalance)}.` : null].filter(Boolean).join(' '),
    });
    if (isMonthly) {
      rows.push({
        label: 'Monthly Rent (thereafter)',
        amount: `${fmt(rate)} / month`,
        when: 'Due on the 1st of each month',
        note: 'Recurring until lease ends.',
      });
    }

    const trs = rows.map(r => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top;"><strong>${r.label}</strong>${r.note ? `<br><span style="color:#666;font-size:0.85em;">${r.note}</span>` : ''}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap; vertical-align: top;"><strong>${r.amount}</strong></td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top; color: #555; font-size: 0.9em;">${r.when}</td>
      </tr>
    `).join('');

    return `
      <div style="background: #f8f6f1; border: 1px solid #e6dec9; border-radius: 10px; padding: 18px 20px; margin: 0 0 24px;">
        <h3 style="margin: 0 0 8px 0; color: #1c1618;">Payment Summary</h3>
        <p style="margin: 0 0 12px 0; color: #555; font-size: 0.92em;">Here's what's due and when. Full lease text and payment methods are below.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.95em;">
          <thead>
            <tr style="background: #f0eadb;">
              <th style="text-align: left; padding: 8px 12px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e3f;">Item</th>
              <th style="text-align: right; padding: 8px 12px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e3f;">Amount</th>
              <th style="text-align: left; padding: 8px 12px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e3f;">When</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.warn('buildRentalPaymentSummary failed:', err);
    return '';
  }
}

async function fetchPaymentMethodsHtml() {
  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('name, method_type, account_identifier, instructions')
      .eq('is_active', true)
      .order('display_order');
    if (error || !data || data.length === 0) return '';

    const items = data.map(pm => {
      let line = `<li style="margin-bottom: 10px;"><strong>${pm.name}</strong>`;
      if (pm.account_identifier) line += `: <code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;">${pm.account_identifier}</code>`;
      if (pm.instructions) line += `<br><span style="color: #666; font-size: 0.9em;">${pm.instructions.replace(/\n/g, '<br>')}</span>`;
      return line + '</li>';
    }).join('\n');

    return `<ul style="margin: 0; padding-left: 20px;">${items}</ul>`;
  } catch (err) {
    console.warn('fetchPaymentMethodsHtml failed:', err);
    return '';
  }
}

/**
 * Resend a signing link (regenerates token)
 */
async function resendSigningLink(applicationId, recipientEmail, recipientName) {
  return sendForSignature(applicationId, recipientEmail, recipientName);
}

/**
 * Check signing status for a rental application
 * Returns the current agreement_status from the database.
 */
async function checkSigningStatus(applicationId) {
  const { data, error } = await supabase
    .from('rental_applications')
    .select('agreement_status, agreement_signed_at, signing_token')
    .eq('id', applicationId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get the signing URL for an existing token
 */
async function getSigningUrl(applicationId) {
  const { data, error } = await supabase
    .from('rental_applications')
    .select('signing_token, signing_token_expires_at')
    .eq('id', applicationId)
    .single();

  if (error) throw error;

  if (!data.signing_token) return null;

  // Check if expired
  if (data.signing_token_expires_at && new Date(data.signing_token_expires_at) < new Date()) {
    return null;
  }

  return `${SIGNING_PAGE_BASE}?token=${data.signing_token}`;
}

/**
 * Get signature audit log entries for a rental application
 */
async function getAuditLog(applicationId) {
  const { data, error } = await supabase
    .from('signature_audit_log')
    .select('*')
    .eq('rental_application_id', applicationId)
    .order('signed_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ── Email sending ──────────────────────────────────────────────────

async function sendSigningEmail(toEmail, recipientName, signingUrl, docType, eventName, context = {}) {
  const firstName = recipientName.split(' ')[0];
  const docLabel = docType === 'rental' ? 'Lease Agreement' : `Event Agreement for ${eventName || 'your event'}`;
  const { documentHtml = '', waiverHtml = '', paymentMethodsHtml = '', paymentSummaryHtml = '' } = context;

  // Use the send-email edge function
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    const subject = `Please Sign: ${docLabel} - Alpaca Playhouse`;

    const signCta = `
      <div style="text-align: center; margin: 2rem 0;">
        <a href="${signingUrl}" style="display: inline-block; background: #3d8b7a; color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.1em;">
          Review & Sign Document
        </a>
      </div>`;

    const paymentSection = paymentMethodsHtml ? `
      <h3 style="margin-top: 2rem; color: #1c1618;">How to Pay Your Deposits</h3>
      <p>Once you sign, please send the reservation deposit using one of these methods. Include your name and "${docType === 'rental' ? 'rental deposit' : 'event deposit'}" in the note.</p>
      ${paymentMethodsHtml}
      <p style="color: #666; font-size: 0.9em; margin-top: 12px;">A confirmation email will be sent automatically once your payment is received.</p>
    ` : '';

    const fullDocSection = documentHtml ? `
      <hr style="border: none; border-top: 2px solid #e0e0e0; margin: 2.5rem 0 1.5rem;">
      <h3 style="margin: 0 0 0.5rem; color: #1c1618;">Full Agreement (for your records)</h3>
      <p style="color: #666; font-size: 0.9em; margin: 0 0 1.5rem;">Below is the complete text of the agreement you'll be signing. You can read it here in your inbox at your own pace, then click the Sign button above when you're ready.</p>
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; background: #fdfdfd; font-size: 0.95em; line-height: 1.55;">
        ${documentHtml}
        ${waiverHtml ? `<hr style="margin: 2rem 0; border: none; border-top: 1px solid #ddd;">${waiverHtml}` : ''}
      </div>
    ` : '';

    const cosignNote = `
      <div style="background: #f1f8f4; border-left: 4px solid #3d8b7a; padding: 10px 14px; margin: 16px 0; font-size: 0.92em; color: #1c4a3e;">
        <strong>Pre-signed by Landlord.</strong> The Landlord (Rahul Sonnad) has already countersigned this lease. Your signature, applied through the secure link below, completes execution.
      </div>`;

    const html = `
      <h2>Your ${docLabel} Is Ready to Sign</h2>
      <p>Hi ${firstName},</p>
      <p>Your agreement is ready for your review and signature. The full text is included below — read it at your own pace, then click the <strong>Review &amp; Sign Document</strong> button when you're ready to sign.</p>

      ${paymentSummaryHtml}

      ${cosignNote}

      ${signCta}

      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 0.9em;">
        <p style="margin: 0 0 8px 0;"><strong>What to expect:</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          <li>Review the full ${docType === 'rental' ? 'lease agreement' : 'event agreement'} (included below)</li>
          ${docType === 'rental' ? '<li>A liability waiver will follow the lease (if applicable)</li>' : ''}
          <li>Draw your signature at the bottom of the signing page</li>
          <li>You'll receive a confirmation email with your signature record once complete</li>
        </ul>
      </div>

      ${paymentSection}

      <p style="color: #888; font-size: 0.85em; margin-top: 2rem;">
        This link will expire in ${TOKEN_EXPIRY_DAYS} days. If you have any questions before signing, reply to this email or contact us at team@alpacaplayhouse.com.
      </p>

      <p style="color: #888; font-size: 0.8em;">
        If the button above doesn't work, copy and paste this link into your browser:<br>
        <a href="${signingUrl}" style="color: #3d8b7a; word-break: break-all;">${signingUrl}</a>
      </p>

      <div style="text-align: center; padding: 16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height: 40px; margin: 0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height: 80px; border-radius: 8px; margin: 0 8px;" /></div>

      ${fullDocSection}
    `;

    const text = `Hi ${firstName},\n\nYour ${docLabel} is ready to sign:\n${signingUrl}\n\nThis link expires in ${TOKEN_EXPIRY_DAYS} days. The full agreement text is included in the HTML version of this email.\n\n— Alpaca Playhouse`;

    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: 'custom',
        to: toEmail,
        subject,
        data: { subject, html, text },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Failed to send signing email:', err);
      throw new Error(err.error || 'Failed to send signing email');
    }

    console.log('Signing email sent to', toEmail);
  } catch (err) {
    console.error('Error sending signing email:', err);
    throw err;
  }
}

export const nativeSigningService = {
  sendForSignature,
  sendEventForSignature,
  resendSigningLink,
  checkSigningStatus,
  getSigningUrl,
  getAuditLog,
};
