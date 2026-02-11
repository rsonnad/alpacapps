// Email service for sending notifications via Resend
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { formatDateAustin } from './timezone.js';

const SEND_EMAIL_URL = `${SUPABASE_URL}/functions/v1/send-email`;

/**
 * Email types supported by the service
 */
export const EMAIL_TYPES = {
  // Rental notifications
  APPLICATION_SUBMITTED: 'application_submitted',
  APPLICATION_APPROVED: 'application_approved',
  APPLICATION_DENIED: 'application_denied',
  LEASE_GENERATED: 'lease_generated',
  LEASE_SENT: 'lease_sent',
  LEASE_SIGNED: 'lease_signed',
  DEPOSIT_REQUESTED: 'deposit_requested',
  DEPOSIT_RECEIVED: 'deposit_received',
  DEPOSITS_CONFIRMED: 'deposits_confirmed',
  MOVE_IN_CONFIRMED: 'move_in_confirmed',
  // Payment notifications
  PAYMENT_REMINDER: 'payment_reminder',
  PAYMENT_OVERDUE: 'payment_overdue',
  PAYMENT_RECEIVED: 'payment_received',
  // Invitations
  EVENT_INVITATION: 'event_invitation',
  GENERAL_INVITATION: 'general_invitation',
  STAFF_INVITATION: 'staff_invitation',
  PROSPECT_INVITATION: 'prospect_invitation',
  // Rental invite
  INVITE_TO_APPLY: 'invite_to_apply',
  // Identity verification
  DL_UPLOAD_LINK: 'dl_upload_link',
  DL_VERIFIED: 'dl_verified',
  DL_MISMATCH: 'dl_mismatch',
  // Payment statement
  PAYMENT_STATEMENT: 'payment_statement',
};

/**
 * Send an email using the Resend edge function
 * @param {string} type - Email type from EMAIL_TYPES
 * @param {string|string[]} to - Recipient email(s)
 * @param {object} data - Template data
 * @param {object} options - Optional overrides (subject, from, reply_to)
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export async function sendEmail(type, to, data, options = {}) {
  try {
    const response = await fetch(SEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type,
        to,
        data,
        ...options,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Email send failed:', result);
      return { success: false, error: result.error || 'Failed to send email' };
    }

    return { success: true, id: result.id };
  } catch (error) {
    console.error('Email service error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Email service with convenience methods for each notification type
 */
export const emailService = {
  // ===== RENTAL NOTIFICATIONS =====

  /**
   * Send application submitted confirmation
   * @param {object} application - Rental application with person data
   * @param {string} spaceName - Optional space name
   */
  async sendApplicationSubmitted(application, spaceName = null) {
    const person = application.person || application;
    return sendEmail(EMAIL_TYPES.APPLICATION_SUBMITTED, person.email, {
      first_name: person.first_name,
      space_name: spaceName,
    });
  },

  /**
   * Send application approved notification
   * @param {object} application - Rental application with person and terms
   */
  async sendApplicationApproved(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.APPLICATION_APPROVED, person.email, {
      first_name: person.first_name,
      space_name: application.space?.name || application.desired_space,
      monthly_rate: application.approved_rate,
      move_in_date: formatDate(application.approved_move_in_date),
      lease_end_date: application.approved_end_date ? formatDate(application.approved_end_date) : null,
    });
  },

  /**
   * Send application denied notification
   * @param {object} application - Rental application with person
   * @param {string} reason - Optional denial reason
   */
  async sendApplicationDenied(application, reason = null) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.APPLICATION_DENIED, person.email, {
      first_name: person.first_name,
      reason,
    });
  },

  /**
   * Send lease generated notification
   * @param {object} application - Rental application with person
   */
  async sendLeaseGenerated(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.LEASE_GENERATED, person.email, {
      first_name: person.first_name,
    });
  },

  /**
   * Send lease sent for signature notification
   * @param {object} application - Rental application with person
   */
  async sendLeaseSent(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.LEASE_SENT, person.email, {
      first_name: person.first_name,
    });
  },

  /**
   * Send lease signed confirmation
   * @param {object} application - Rental application with person and deposit info
   */
  async sendLeaseSigned(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.LEASE_SIGNED, person.email, {
      first_name: person.first_name,
      move_in_deposit: application.move_in_deposit || application.approved_rate,
      security_deposit: application.security_deposit,
      monthly_rate: application.approved_rate,
    });
  },

  /**
   * Send deposit request
   * @param {object} application - Rental application with person and deposit info
   * @param {string} dueDate - Optional due date
   */
  async sendDepositRequested(application, dueDate = null) {
    const person = application.person;
    const moveInDeposit = application.move_in_deposit || application.approved_rate || 0;
    const securityDeposit = application.security_deposit || 0;
    const totalDue = moveInDeposit + securityDeposit;

    return sendEmail(EMAIL_TYPES.DEPOSIT_REQUESTED, person.email, {
      first_name: person.first_name,
      move_in_deposit: moveInDeposit,
      security_deposit: securityDeposit,
      total_due: totalDue,
      due_date: dueDate ? formatDate(dueDate) : null,
    });
  },

  /**
   * Send deposit received confirmation
   * @param {object} application - Rental application with person
   * @param {number} amount - Amount received
   * @param {number} remainingBalance - Remaining balance
   */
  async sendDepositReceived(application, amount, remainingBalance = 0) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.DEPOSIT_RECEIVED, person.email, {
      first_name: person.first_name,
      amount,
      remaining_balance: remainingBalance,
    });
  },

  /**
   * Send deposits confirmed notification
   * @param {object} application - Rental application with person
   */
  async sendDepositsConfirmed(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.DEPOSITS_CONFIRMED, person.email, {
      first_name: person.first_name,
      move_in_date: formatDate(application.approved_move_in_date),
    });
  },

  /**
   * Send move-in confirmed welcome email
   * @param {object} application - Rental application with full details
   */
  async sendMoveInConfirmed(application) {
    const person = application.person;
    return sendEmail(EMAIL_TYPES.MOVE_IN_CONFIRMED, person.email, {
      first_name: person.first_name,
      space_name: application.space?.name || application.desired_space,
      move_in_date: formatDate(application.approved_move_in_date),
      monthly_rate: application.approved_rate,
      rent_due_day: '1st',
    });
  },

  // ===== PAYMENT NOTIFICATIONS =====

  /**
   * Send payment reminder
   * @param {object} tenant - Person object with email and name
   * @param {number} amount - Amount due
   * @param {string} dueDate - Due date
   * @param {string} period - Payment period (e.g., "February 2025 rent")
   */
  async sendPaymentReminder(tenant, amount, dueDate, period = null) {
    return sendEmail(EMAIL_TYPES.PAYMENT_REMINDER, tenant.email, {
      first_name: tenant.first_name,
      amount,
      due_date: formatDate(dueDate),
      period,
    });
  },

  /**
   * Send payment overdue notice
   * @param {object} tenant - Person object with email and name
   * @param {number} amount - Amount due
   * @param {string} dueDate - Original due date
   * @param {number} daysOverdue - Days past due
   * @param {number} lateFee - Optional late fee
   */
  async sendPaymentOverdue(tenant, amount, dueDate, daysOverdue, lateFee = null) {
    const totalDue = lateFee ? amount + lateFee : amount;
    return sendEmail(EMAIL_TYPES.PAYMENT_OVERDUE, tenant.email, {
      first_name: tenant.first_name,
      amount,
      due_date: formatDate(dueDate),
      days_overdue: daysOverdue,
      late_fee: lateFee,
      total_due: totalDue,
    });
  },

  /**
   * Send payment received confirmation
   * @param {object} tenant - Person object with email and name
   * @param {number} amount - Amount received
   * @param {string} period - Payment period (e.g., "February 2025 rent")
   */
  async sendPaymentReceived(tenant, amount, period = null) {
    return sendEmail(EMAIL_TYPES.PAYMENT_RECEIVED, tenant.email, {
      first_name: tenant.first_name,
      amount,
      period,
    });
  },

  /**
   * Send payment statement with full ledger summary
   * @param {string} email - Recipient email
   * @param {object} data - Statement data
   * @param {string} data.first_name - Tenant first name
   * @param {string} data.space_name - Space name
   * @param {Array} data.line_items - [{date, description, amount, status}]
   * @param {number} data.balance_due - Outstanding balance
   * @param {string} data.overdue_since - Date balance became overdue
   * @param {number} data.upcoming_amount - Next payment amount
   * @param {string} data.upcoming_date - Next payment due date
   */
  async sendPaymentStatement(email, data) {
    return sendEmail(EMAIL_TYPES.PAYMENT_STATEMENT, email, data);
  },

  // ===== INVITATIONS =====

  /**
   * Send event invitation
   * @param {object} recipient - Person with email and name
   * @param {object} event - Event details
   */
  async sendEventInvitation(recipient, event) {
    return sendEmail(EMAIL_TYPES.EVENT_INVITATION, recipient.email, {
      first_name: recipient.first_name,
      event_name: event.name,
      event_date: formatDate(event.date),
      event_time: event.time,
      location: event.location,
      description: event.description,
      rsvp_link: event.rsvp_link,
    });
  },

  /**
   * Send general invitation
   * @param {object} recipient - Person with email and name
   * @param {object} invitation - Invitation details (subject, message, action_url, action_text)
   */
  async sendGeneralInvitation(recipient, invitation) {
    return sendEmail(EMAIL_TYPES.GENERAL_INVITATION, recipient.email, {
      first_name: recipient.first_name,
      subject: invitation.subject,
      message: invitation.message,
      message_text: invitation.message_text || stripHtml(invitation.message),
      action_url: invitation.action_url,
      action_text: invitation.action_text,
    }, {
      subject: invitation.subject,
    });
  },

  /**
   * Send staff/admin invitation email
   * @param {string} email - Email address to invite
   * @param {string} role - Role being assigned ('admin' or 'staff')
   * @param {string} loginUrl - URL for the invitee to sign in
   */
  async sendStaffInvitation(email, role, loginUrl) {
    return sendEmail(EMAIL_TYPES.STAFF_INVITATION, email, {
      email,
      role,
      login_url: loginUrl,
    });
  },

  /**
   * Send prospect invitation email with access link (no login required)
   * @param {string} email - Recipient email
   * @param {string} firstName - Prospect's first name (optional)
   * @param {string} accessUrl - The access link URL
   */
  async sendProspectInvitation(email, firstName, accessUrl) {
    return sendEmail(EMAIL_TYPES.PROSPECT_INVITATION, email, {
      first_name: firstName || '',
      access_url: accessUrl,
    });
  },

  /**
   * Send invite-to-apply email with link to complete application
   * @param {object} application - Rental application with person data
   * @param {string} continueUrl - URL for the applicant to continue their application
   */
  async sendInviteToApply(application, continueUrl) {
    const person = application.person || application;
    return sendEmail(EMAIL_TYPES.INVITE_TO_APPLY, person.email, {
      first_name: person.first_name,
      continue_url: continueUrl,
    });
  },

  // ===== IDENTITY VERIFICATION =====

  /**
   * Send DL upload link to applicant
   * @param {object} person - Person with email and first_name
   * @param {string} uploadUrl - The unique upload URL
   */
  async sendDLUploadLink(person, uploadUrl) {
    return sendEmail(EMAIL_TYPES.DL_UPLOAD_LINK, person.email, {
      first_name: person.first_name,
      upload_url: uploadUrl,
    });
  },

  /**
   * Send bulk emails to multiple recipients
   * @param {string} type - Email type
   * @param {Array} recipients - Array of {email, ...data} objects
   * @param {object} sharedData - Data shared across all emails
   * @returns {Promise<{sent: number, failed: number, errors: Array}>}
   */
  async sendBulk(type, recipients, sharedData = {}) {
    const results = { sent: 0, failed: 0, errors: [] };

    for (const recipient of recipients) {
      const { email, ...recipientData } = recipient;
      const result = await sendEmail(type, email, { ...sharedData, ...recipientData });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ email, error: result.error });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  },
};

// Helper functions
function formatDate(dateStr) {
  if (!dateStr) return null;
  return formatDateAustin(dateStr, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

export default emailService;
