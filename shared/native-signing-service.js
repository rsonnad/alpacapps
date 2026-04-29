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

  // Send signing email via send-email edge function or Resend directly
  await sendSigningEmail(recipientEmail, recipientName, signingUrl, 'rental');

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

  await sendSigningEmail(recipientEmail, recipientName, signingUrl, 'event', eventName);

  return { token, signing_url: signingUrl, expires_at: expiresAt };
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

async function sendSigningEmail(toEmail, recipientName, signingUrl, docType, eventName) {
  const firstName = recipientName.split(' ')[0];
  const docLabel = docType === 'rental' ? 'Lease Agreement' : `Event Agreement for ${eventName || 'your event'}`;

  // Use the send-email edge function
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: toEmail,
        subject: `Please Sign: ${docLabel} - Alpaca Playhouse`,
        sender: 'pai',
        html: `
          <h2>Your ${docLabel} Is Ready to Sign</h2>
          <p>Hi ${firstName},</p>
          <p>Your agreement is ready for your review and signature. Please click the button below to review the document and sign electronically.</p>

          <div style="text-align: center; margin: 2rem 0;">
            <a href="${signingUrl}" style="display: inline-block; background: #3d8b7a; color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.1em;">
              Review & Sign Document
            </a>
          </div>

          <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 0.9em;">
            <p style="margin: 0 0 8px 0;"><strong>What to expect:</strong></p>
            <ul style="margin: 0; padding-left: 20px;">
              <li>You'll review the full ${docType === 'rental' ? 'lease agreement' : 'event agreement'}</li>
              ${docType === 'rental' ? '<li>A liability waiver will follow the lease (if applicable)</li>' : ''}
              <li>Draw your signature at the bottom of the page</li>
              <li>You'll receive a confirmation email with your signature record</li>
            </ul>
          </div>

          <p style="color: #888; font-size: 0.85em;">
            This link will expire in ${TOKEN_EXPIRY_DAYS} days. If you have any questions before signing, reply to this email or contact us at team@alpacaplayhouse.com.
          </p>

          <p style="color: #888; font-size: 0.8em; margin-top: 2rem;">
            If the button above doesn't work, copy and paste this link into your browser:<br>
            <a href="${signingUrl}" style="color: #3d8b7a; word-break: break-all;">${signingUrl}</a>
          </p>

          <div style="text-align: center; padding: 16px;"><img src="https://alpacaplayhouse.com/assets/branding/alpaca-head-white-transparent.png" alt="" style="height: 40px; margin: 0 8px;" /><img src="https://alpacaplayhouse.com/assets/Alpaca%20Playhouse%20Highlights/Alpaca.jpg" alt="" style="height: 80px; border-radius: 8px; margin: 0 8px;" /></div>
        `,
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
