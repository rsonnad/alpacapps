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

  await sendSigningEmail(recipientEmail, recipientName, signingUrl, 'rental', null, {
    documentHtml,
    waiverHtml,
    paymentMethodsHtml,
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
  const { documentHtml = '', waiverHtml = '', paymentMethodsHtml = '' } = context;

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

    const html = `
      <h2>Your ${docLabel} Is Ready to Sign</h2>
      <p>Hi ${firstName},</p>
      <p>Your agreement is ready for your review and signature. The full text is included below — read it at your own pace, then click the <strong>Review &amp; Sign Document</strong> button when you're ready to sign.</p>

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
