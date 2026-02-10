import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { renderTemplate, SENDER_MAP } from "../_shared/template-engine.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

// In-memory template cache (survives within a single edge function instance)
const templateCache = new Map<string, { template: any; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Email template types
type EmailType =
  // Rental notifications
  | "application_submitted"
  | "application_approved"
  | "application_denied"
  | "lease_generated"
  | "lease_sent"
  | "lease_signed"
  | "deposit_requested"
  | "deposit_received"
  | "deposits_confirmed"
  | "move_in_confirmed"
  // Payment notifications
  | "payment_reminder"
  | "payment_overdue"
  | "payment_received"
  // Invitations
  | "event_invitation"
  | "general_invitation"
  | "staff_invitation"
  // Admin notifications
  | "admin_event_request"
  | "admin_rental_application"
  // FAQ notifications
  | "faq_unanswered"
  // Contact form
  | "contact_form"
  | "community_fit_inquiry"
  // Bug reports
  | "bug_report_received"
  | "bug_report_fixed"
  | "bug_report_failed"
  | "bug_report_verified"
  // Rental invite
  | "invite_to_apply"
  // Identity verification
  | "dl_upload_link"
  | "dl_verified"
  | "dl_mismatch"
  // Feature builder
  | "feature_review"
  // PAI email
  | "pai_email_reply"
  | "pai_document_received";

interface EmailRequest {
  type: EmailType;
  to: string | string[];
  data: Record<string, any>;
  // Optional overrides
  subject?: string;
  from?: string;
  reply_to?: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

// Template generators
function getTemplate(type: EmailType, data: Record<string, any>): EmailTemplate {
  switch (type) {
    // ===== RENTAL NOTIFICATIONS =====
    case "application_submitted":
      return {
        subject: "Application Received - Alpaca Playhouse",
        html: `
          <h2>Thank you for your application!</h2>
          <p>Hi ${data.first_name},</p>
          <p>We've received your rental application for <strong>${data.space_name || "Alpaca Playhouse"}</strong>.</p>
          <p>We'll review your application and get back to you within 2-3 business days.</p>
          <p><strong>What's next?</strong></p>
          <ul>
            <li>Our team will review your application</li>
            <li>We may reach out for additional information</li>
            <li>You'll receive an email once a decision is made</li>
          </ul>
          <p>If you have any questions, feel free to reply to this email.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Thank you for your application!

Hi ${data.first_name},

We've received your rental application for ${data.space_name || "Alpaca Playhouse"}.

We'll review your application and get back to you within 2-3 business days.

What's next?
- Our team will review your application
- We may reach out for additional information
- You'll receive an email once a decision is made

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse`
      };

    case "application_approved":
      return {
        subject: "Congratulations! Your Application is Approved - Alpaca Playhouse",
        html: `
          <h2>Great news, ${data.first_name}!</h2>
          <p>Your rental application has been <strong style="color: green;">approved</strong>!</p>
          <h3>Lease Terms</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.space_name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Rate:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.monthly_rate}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Move-in Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.move_in_date}</td></tr>
            ${data.lease_end_date ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease End:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.lease_end_date}</td></tr>` : ''}
          </table>
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>Review the lease agreement (we'll send it shortly)</li>
            <li>Sign the lease electronically</li>
            <li>Submit required deposits</li>
          </ol>
          <p>We're excited to welcome you to Alpaca Playhouse!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Great news, ${data.first_name}!

Your rental application has been APPROVED!

Lease Terms:
- Space: ${data.space_name}
- Monthly Rate: $${data.monthly_rate}
- Move-in Date: ${data.move_in_date}
${data.lease_end_date ? `- Lease End: ${data.lease_end_date}` : ''}

Next Steps:
1. Review the lease agreement (we'll send it shortly)
2. Sign the lease electronically
3. Submit required deposits

We're excited to welcome you to Alpaca Playhouse!

Best regards,
Alpaca Playhouse`
      };

    case "application_denied":
      return {
        subject: "Application Update - Alpaca Playhouse",
        html: `
          <p>Hi ${data.first_name},</p>
          <p>We're sorry but we are not able to approve you to apply for housing at the Alpaca Playhouse at this time. This may be due to our gender balance goals, or it may be due to other reasons related to our assessment of community fit at this specific time.</p>
          <p>If you have questions, please contact a community manager.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Hi ${data.first_name},

We're sorry but we are not able to approve you to apply for housing at the Alpaca Playhouse at this time. This may be due to our gender balance goals, or it may be due to other reasons related to our assessment of community fit at this specific time.

If you have questions, please contact a community manager.

Best regards,
Alpaca Playhouse`
      };

    case "lease_generated":
      return {
        subject: "Your Lease Agreement is Ready - Alpaca Playhouse",
        html: `
          <h2>Your Lease is Ready for Review</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your lease agreement has been prepared and is ready for your review.</p>
          <p>Please take a moment to review the terms. We'll send you a signature request shortly.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Your Lease is Ready for Review

Hi ${data.first_name},

Your lease agreement has been prepared and is ready for your review.

Please take a moment to review the terms. We'll send you a signature request shortly.

Best regards,
Alpaca Playhouse`
      };

    case "lease_sent":
      return {
        subject: "Action Required: Sign Your Lease Agreement - Alpaca Playhouse",
        html: `
          <h2>Please Sign Your Lease Agreement</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your lease agreement has been sent for electronic signature.</p>
          <p>Please check your email from SignWell and complete the signing process at your earliest convenience.</p>
          <p><strong>Important:</strong> The lease must be signed before we can proceed with your move-in.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Please Sign Your Lease Agreement

Hi ${data.first_name},

Your lease agreement has been sent for electronic signature.

Please check your email from SignWell and complete the signing process at your earliest convenience.

Important: The lease must be signed before we can proceed with your move-in.

Best regards,
Alpaca Playhouse`
      };

    case "lease_signed":
      return {
        subject: "Lease Signed Successfully - Alpaca Playhouse",
        html: `
          <h2>Lease Signing Complete!</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your lease agreement has been successfully signed. A copy will be provided for your records.</p>
          <p><strong>Next Steps:</strong></p>
          <ul>
            <li>Submit your move-in deposit: <strong>$${data.move_in_deposit || data.monthly_rate}</strong></li>
            ${data.security_deposit ? `<li>Submit your security deposit: <strong>$${data.security_deposit}</strong></li>` : ''}
          </ul>
          <p>Once deposits are received, we'll confirm your move-in date.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Lease Signing Complete!

Hi ${data.first_name},

Your lease agreement has been successfully signed. A copy will be provided for your records.

Next Steps:
- Submit your move-in deposit: $${data.move_in_deposit || data.monthly_rate}
${data.security_deposit ? `- Submit your security deposit: $${data.security_deposit}` : ''}

Once deposits are received, we'll confirm your move-in date.

Best regards,
Alpaca Playhouse`
      };

    case "deposit_requested":
      return {
        subject: "Deposit Request - Alpaca Playhouse",
        html: `
          <h2>Deposit Payment Request</h2>
          <p>Hi ${data.first_name},</p>
          <p>Please submit the following deposits to secure your rental:</p>
          <table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 20px 0;">
            ${data.move_in_deposit ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Move-in Deposit:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.move_in_deposit}</td></tr>` : ''}
            ${data.security_deposit ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Security Deposit:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.security_deposit}</td></tr>` : ''}
            <tr><td style="padding: 8px; font-weight: bold;"><strong>Total Due:</strong></td><td style="padding: 8px; font-weight: bold;">$${data.total_due}</td></tr>
          </table>
          ${data.due_date ? `<p><strong>Due Date:</strong> ${data.due_date}</p>` : ''}
          <p><strong>Payment Methods:</strong></p>
          <ul>
            <li>Venmo: @AlpacaPlayhouse</li>
            <li>Zelle: alpacaplayhouse@gmail.com</li>
          </ul>
          <p>Please include your name in the payment memo.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Deposit Payment Request

Hi ${data.first_name},

Please submit the following deposits to secure your rental:

${data.move_in_deposit ? `Move-in Deposit: $${data.move_in_deposit}` : ''}
${data.security_deposit ? `Security Deposit: $${data.security_deposit}` : ''}
Total Due: $${data.total_due}
${data.due_date ? `Due Date: ${data.due_date}` : ''}

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

Please include your name in the payment memo.

Best regards,
Alpaca Playhouse`
      };

    case "deposit_received":
      return {
        subject: "Deposit Received - Alpaca Playhouse",
        html: `
          <h2>Payment Received</h2>
          <p>Hi ${data.first_name},</p>
          <p>We've received your deposit payment of <strong>$${data.amount}</strong>.</p>
          ${data.remaining_balance > 0 ? `<p><strong>Remaining Balance:</strong> $${data.remaining_balance}</p>` : '<p>All deposits have been received!</p>'}
          <p>Thank you!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Payment Received

Hi ${data.first_name},

We've received your deposit payment of $${data.amount}.
${data.remaining_balance > 0 ? `Remaining Balance: $${data.remaining_balance}` : 'All deposits have been received!'}

Thank you!

Best regards,
Alpaca Playhouse`
      };

    case "deposits_confirmed":
      return {
        subject: "Deposits Confirmed - Ready for Move-in! - Alpaca Playhouse",
        html: `
          <h2>You're All Set!</h2>
          <p>Hi ${data.first_name},</p>
          <p>All your deposits have been received and confirmed.</p>
          <p><strong>Move-in Date:</strong> ${data.move_in_date}</p>
          <p>We'll be in touch with move-in details and key handoff arrangements.</p>
          <p>Welcome to Alpaca Playhouse!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `You're All Set!

Hi ${data.first_name},

All your deposits have been received and confirmed.

Move-in Date: ${data.move_in_date}

We'll be in touch with move-in details and key handoff arrangements.

Welcome to Alpaca Playhouse!

Best regards,
Alpaca Playhouse`
      };

    case "move_in_confirmed":
      return {
        subject: "Welcome Home! Move-in Confirmed - Alpaca Playhouse",
        html: `
          <h2>Welcome to Alpaca Playhouse!</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your move-in is confirmed and your lease is now active!</p>
          <h3>Your Rental Details</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.space_name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease Start:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.move_in_date}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Rent:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.monthly_rate}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Rent Due:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.rent_due_day || '1st'} of each month</td></tr>
          </table>
          <p><strong>Payment Methods:</strong></p>
          <ul>
            <li>Venmo: @AlpacaPlayhouse</li>
            <li>Zelle: alpacaplayhouse@gmail.com</li>
          </ul>
          <p>If you have any questions or need anything, don't hesitate to reach out!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Welcome to Alpaca Playhouse!

Hi ${data.first_name},

Your move-in is confirmed and your lease is now active!

Your Rental Details:
- Space: ${data.space_name}
- Lease Start: ${data.move_in_date}
- Monthly Rent: $${data.monthly_rate}
- Rent Due: ${data.rent_due_day || '1st'} of each month

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

If you have any questions or need anything, don't hesitate to reach out!

Best regards,
Alpaca Playhouse`
      };

    // ===== PAYMENT NOTIFICATIONS =====
    case "payment_reminder":
      return {
        subject: `Rent Reminder - Due ${data.due_date} - Alpaca Playhouse`,
        html: `
          <h2>Friendly Rent Reminder</h2>
          <p>Hi ${data.first_name},</p>
          <p>This is a friendly reminder that your rent payment of <strong>$${data.amount}</strong> is due on <strong>${data.due_date}</strong>.</p>
          <p><strong>Payment Methods:</strong></p>
          <ul>
            <li>Venmo: @AlpacaPlayhouse</li>
            <li>Zelle: alpacaplayhouse@gmail.com</li>
          </ul>
          <p>Please include your name and "${data.period || 'rent'}" in the payment memo.</p>
          <p>Thank you!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Friendly Rent Reminder

Hi ${data.first_name},

This is a friendly reminder that your rent payment of $${data.amount} is due on ${data.due_date}.

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

Please include your name and "${data.period || 'rent'}" in the payment memo.

Thank you!

Best regards,
Alpaca Playhouse`
      };

    case "payment_overdue":
      return {
        subject: `URGENT: Rent Payment Overdue - Alpaca Playhouse`,
        html: `
          <h2 style="color: #c00;">Rent Payment Overdue</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your rent payment of <strong>$${data.amount}</strong> was due on <strong>${data.due_date}</strong> and is now <strong>${data.days_overdue} day${data.days_overdue > 1 ? 's' : ''} overdue</strong>.</p>
          ${data.late_fee ? `<p><strong>Late Fee:</strong> $${data.late_fee}</p><p><strong>Total Due:</strong> $${data.total_due}</p>` : ''}
          <p>Please submit payment as soon as possible to avoid any additional fees or action.</p>
          <p><strong>Payment Methods:</strong></p>
          <ul>
            <li>Venmo: @AlpacaPlayhouse</li>
            <li>Zelle: alpacaplayhouse@gmail.com</li>
          </ul>
          <p>If you're experiencing difficulties, please reach out to discuss options.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `RENT PAYMENT OVERDUE

Hi ${data.first_name},

Your rent payment of $${data.amount} was due on ${data.due_date} and is now ${data.days_overdue} day${data.days_overdue > 1 ? 's' : ''} overdue.
${data.late_fee ? `\nLate Fee: $${data.late_fee}\nTotal Due: $${data.total_due}` : ''}

Please submit payment as soon as possible to avoid any additional fees or action.

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

If you're experiencing difficulties, please reach out to discuss options.

Best regards,
Alpaca Playhouse`
      };

    case "payment_received":
      return {
        subject: "Payment Received - Thank You! - Alpaca Playhouse",
        html: `
          <h2>Payment Received</h2>
          <p>Hi ${data.first_name},</p>
          <p>We've received your payment of <strong>$${data.amount}</strong>${data.period ? ` for <strong>${data.period}</strong>` : ''}.</p>
          <p>Thank you for your prompt payment!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Payment Received

Hi ${data.first_name},

We've received your payment of $${data.amount}${data.period ? ` for ${data.period}` : ''}.

Thank you for your prompt payment!

Best regards,
Alpaca Playhouse`
      };

    // ===== INVITATIONS =====
    case "event_invitation":
      return {
        subject: `You're Invited: ${data.event_name} - Alpaca Playhouse`,
        html: `
          <h2>You're Invited!</h2>
          <p>Hi ${data.first_name},</p>
          <p>You're invited to <strong>${data.event_name}</strong> at Alpaca Playhouse!</p>
          <table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 20px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_date}</td></tr>
            ${data.event_time ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_time}</td></tr>` : ''}
            ${data.location ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Location:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.location}</td></tr>` : ''}
          </table>
          ${data.description ? `<p>${data.description}</p>` : ''}
          ${data.rsvp_link ? `<p><a href="${data.rsvp_link}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">RSVP Now</a></p>` : ''}
          <p>We hope to see you there!</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `You're Invited!

Hi ${data.first_name},

You're invited to ${data.event_name} at Alpaca Playhouse!

Date: ${data.event_date}
${data.event_time ? `Time: ${data.event_time}` : ''}
${data.location ? `Location: ${data.location}` : ''}

${data.description || ''}

${data.rsvp_link ? `RSVP: ${data.rsvp_link}` : ''}

We hope to see you there!

Best regards,
Alpaca Playhouse`
      };

    case "general_invitation":
      return {
        subject: data.subject || "Invitation from Alpaca Playhouse",
        html: `
          <p>Hi ${data.first_name},</p>
          ${data.message || '<p>You have been invited!</p>'}
          ${data.action_url ? `<p><a href="${data.action_url}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.action_text || 'Learn More'}</a></p>` : ''}
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Hi ${data.first_name},

${data.message_text || 'You have been invited!'}

${data.action_url ? `${data.action_text || 'Learn More'}: ${data.action_url}` : ''}

Best regards,
Alpaca Playhouse`
      };

    case "staff_invitation":
      const roleLabel = data.role === 'admin' ? 'an admin' : 'a staff member';
      const roleDescription = data.role === 'admin'
        ? 'full admin access (view all spaces, occupant details, edit spaces, manage photos, and invite users)'
        : 'staff access (view all spaces and occupant details)';
      return {
        subject: "You're Invited to GenAlpaca Spaces",
        html: `
          <h2>You've Been Invited!</h2>
          <p>Hi,</p>
          <p>You've been invited to access <strong>GenAlpaca Spaces</strong> as ${roleLabel}.</p>
          <p>You will have ${roleDescription}.</p>
          <h3>Getting Started</h3>
          <ol>
            <li>Click the button below to go to the login page</li>
            <li>Sign in with Google using this email address (<strong>${data.email}</strong>)</li>
          </ol>
          <p>Your access has already been pre-approved, so you'll have immediate access once you sign in.</p>
          <p style="margin: 30px 0;">
            <a href="${data.login_url}" style="background: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Sign In to GenAlpaca</a>
          </p>
          <p style="color: #666; font-size: 14px;">If you have any questions, reply to this email.</p>
          <p>Best regards,<br>GenAlpaca Team</p>
        `,
        text: `You've Been Invited!

Hi,

You've been invited to access GenAlpaca Spaces as ${roleLabel}.

You will have ${roleDescription}.

Getting Started:
1. Go to: ${data.login_url}
2. Click "Sign in with Google" using this email address (${data.email})

Your access has already been pre-approved, so you'll have immediate access once you sign in.

If you have any questions, reply to this email.

Best regards,
GenAlpaca Team`
      };

    // ===== RENTAL INVITE =====
    case "invite_to_apply":
      return {
        subject: "You're Invited to Apply - Alpaca Playhouse",
        html: `
          <h2>Great news, ${data.first_name}!</h2>
          <p>Thank you for your interest in joining the Alpaca Playhouse community. We've reviewed your inquiry and feel you would be a great fit for the Alpaca Playhouse community. We would love to invite you to apply for a rental space when you are ready and have clarity on your dates.</p>
          <p>Please review the <a href="https://rsonnad.github.io/alpacapps/spaces/">available spaces here</a> or click the button below to finish your application.</p>
          <p style="margin: 30px 0; text-align: center;">
            <a href="${data.continue_url}" style="background: #3b8132; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 16px;">Complete Your Application</a>
          </p>
          <p>We are excited by the potential to have you join us at the Alpaca Playhouse. Where our mission is to let your Alpaca Dreams run free. Our goal is to redefine your idea of what an Alpaca Playhouse can be. When it comes to selecting an Alpaca Playhouse, we feel no one need settle.</p>
          <p>Yours,<br>The Alpaca Playhouse Community Team</p>
        `,
        text: `Great news, ${data.first_name}!

Thank you for your interest in joining the Alpaca Playhouse community. We've reviewed your inquiry and feel you would be a great fit for the Alpaca Playhouse community. We would love to invite you to apply for a rental space when you are ready and have clarity on your dates.

Please review the available spaces here: https://rsonnad.github.io/alpacapps/spaces/

Or complete your application here: ${data.continue_url}

We are excited by the potential to have you join us at the Alpaca Playhouse. Where our mission is to let your Alpaca Dreams run free. Our goal is to redefine your idea of what an Alpaca Playhouse can be. When it comes to selecting an Alpaca Playhouse, we feel no one need settle.

Yours,
The Alpaca Playhouse Community Team`
      };

    // ===== ADMIN NOTIFICATIONS =====
    case "admin_event_request":
      return {
        subject: `New Event Request: ${data.event_name} - ${data.event_date}`,
        html: `
          <h2>New Event Hosting Request</h2>
          <p>A new event hosting request has been submitted.</p>

          <p style="margin: 20px 0;">
            <a href="https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#events" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">View in Events Pipeline</a>
          </p>

          <h3>Host Information</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.first_name} ${data.last_name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:${data.email}">${data.email}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:${data.phone}">${data.phone}</a></td></tr>
            ${data.organization_name ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Organization:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.organization_name}</td></tr>` : ''}
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Hosted Before:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.has_hosted_before ? 'Yes' : 'No'}</td></tr>
          </table>

          <h3>Event Details</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Event Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Event Type:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_type}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_date}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.event_start_time} - ${data.event_end_time}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Expected Guests:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.expected_guests}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Ticketed Event:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.is_ticketed ? 'Yes' : 'No'}</td></tr>
          </table>

          <h3>Event Description</h3>
          <p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${data.event_description}</p>

          <h3>Staffing Contacts</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Setup:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.setup_staff_name} - <a href="tel:${data.setup_staff_phone}">${data.setup_staff_phone}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Cleanup:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.cleanup_staff_name} - <a href="tel:${data.cleanup_staff_phone}">${data.cleanup_staff_phone}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Parking:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.parking_manager_name} - <a href="tel:${data.parking_manager_phone}">${data.parking_manager_phone}</a></td></tr>
          </table>

          ${data.marketing_materials_link ? `<p><strong>Marketing Materials:</strong> <a href="${data.marketing_materials_link}">${data.marketing_materials_link}</a></p>` : ''}
          ${data.special_requests ? `<h3>Special Requests</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${data.special_requests}</p>` : ''}

          <p style="margin-top: 20px; color: #666; font-size: 14px;">All required acknowledgments have been confirmed by the applicant.</p>
        `,
        text: `New Event Hosting Request

View in Events Pipeline: https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#events

HOST INFORMATION
Name: ${data.first_name} ${data.last_name}
Email: ${data.email}
Phone: ${data.phone}
${data.organization_name ? `Organization: ${data.organization_name}` : ''}
Hosted Before: ${data.has_hosted_before ? 'Yes' : 'No'}

EVENT DETAILS
Event Name: ${data.event_name}
Event Type: ${data.event_type}
Date: ${data.event_date}
Time: ${data.event_start_time} - ${data.event_end_time}
Expected Guests: ${data.expected_guests}
Ticketed Event: ${data.is_ticketed ? 'Yes' : 'No'}

EVENT DESCRIPTION
${data.event_description}

STAFFING CONTACTS
Setup: ${data.setup_staff_name} - ${data.setup_staff_phone}
Cleanup: ${data.cleanup_staff_name} - ${data.cleanup_staff_phone}
Parking: ${data.parking_manager_name} - ${data.parking_manager_phone}

${data.marketing_materials_link ? `Marketing Materials: ${data.marketing_materials_link}` : ''}
${data.special_requests ? `SPECIAL REQUESTS\n${data.special_requests}` : ''}

All required acknowledgments have been confirmed by the applicant.`
      };

    case "admin_rental_application":
      return {
        subject: `New Rental Application: ${data.first_name} ${data.last_name}${data.space_name ? ` for ${data.space_name}` : ''}`,
        html: `
          <h2>New Rental Application</h2>
          <p>A new rental application has been submitted.</p>

          <p style="margin: 20px 0;">
            <a href="https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#rentals" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">View in Rentals Pipeline</a>
          </p>

          <h3>Applicant Information</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.first_name} ${data.last_name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:${data.email}">${data.email}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:${data.phone}">${data.phone}</a></td></tr>
            ${data.current_location ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Current Location:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.current_location}</td></tr>` : ''}
          </table>

          <h3>Rental Details</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            ${data.space_name ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.space_name}</td></tr>` : ''}
            ${data.desired_move_in ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Desired Move-in:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.desired_move_in}</td></tr>` : ''}
            ${data.desired_lease_length ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease Length:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.desired_lease_length}</td></tr>` : ''}
            ${data.budget ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Budget:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.budget}/month</td></tr>` : ''}
          </table>

          ${data.employment_status || data.occupation ? `
          <h3>Employment</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            ${data.employment_status ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.employment_status}</td></tr>` : ''}
            ${data.occupation ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Occupation:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.occupation}</td></tr>` : ''}
            ${data.employer ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Employer:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.employer}</td></tr>` : ''}
            ${data.monthly_income ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Income:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${data.monthly_income}</td></tr>` : ''}
          </table>
          ` : ''}

          ${data.about_yourself ? `<h3>About Themselves</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${data.about_yourself}</p>` : ''}
          ${data.why_interested ? `<h3>Why Interested</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${data.why_interested}</p>` : ''}
          ${data.additional_notes ? `<h3>Additional Notes</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${data.additional_notes}</p>` : ''}

          ${data.emergency_contact_name ? `
          <h3>Emergency Contact</h3>
          <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.emergency_contact_name}</td></tr>
            ${data.emergency_contact_phone ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:${data.emergency_contact_phone}">${data.emergency_contact_phone}</a></td></tr>` : ''}
            ${data.emergency_contact_relationship ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Relationship:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.emergency_contact_relationship}</td></tr>` : ''}
          </table>
          ` : ''}
        `,
        text: `New Rental Application

View in Rentals Pipeline: https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#rentals

APPLICANT INFORMATION
Name: ${data.first_name} ${data.last_name}
Email: ${data.email}
Phone: ${data.phone}
${data.current_location ? `Current Location: ${data.current_location}` : ''}

RENTAL DETAILS
${data.space_name ? `Space: ${data.space_name}` : ''}
${data.desired_move_in ? `Desired Move-in: ${data.desired_move_in}` : ''}
${data.desired_lease_length ? `Lease Length: ${data.desired_lease_length}` : ''}
${data.budget ? `Budget: $${data.budget}/month` : ''}

${data.employment_status || data.occupation ? `EMPLOYMENT
${data.employment_status ? `Status: ${data.employment_status}` : ''}
${data.occupation ? `Occupation: ${data.occupation}` : ''}
${data.employer ? `Employer: ${data.employer}` : ''}
${data.monthly_income ? `Monthly Income: $${data.monthly_income}` : ''}` : ''}

${data.about_yourself ? `ABOUT THEMSELVES\n${data.about_yourself}` : ''}
${data.why_interested ? `\nWHY INTERESTED\n${data.why_interested}` : ''}
${data.additional_notes ? `\nADDITIONAL NOTES\n${data.additional_notes}` : ''}

${data.emergency_contact_name ? `EMERGENCY CONTACT
Name: ${data.emergency_contact_name}
${data.emergency_contact_phone ? `Phone: ${data.emergency_contact_phone}` : ''}
${data.emergency_contact_relationship ? `Relationship: ${data.emergency_contact_relationship}` : ''}` : ''}`
      };

    // ===== FAQ NOTIFICATIONS =====
    case "faq_unanswered":
      return {
        subject: "New Question Needs an Answer - Alpaca Playhouse",
        html: `
          <h2>New Unanswered Question</h2>
          <p>Someone asked a question that our AI assistant couldn't confidently answer:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; font-style: italic;">"${data.question}"</p>
          </div>
          ${data.user_email && data.user_email !== 'Not provided' ? `<p><strong>User email for follow-up:</strong> <a href="mailto:${data.user_email}">${data.user_email}</a></p>` : ''}
          <p>Add an answer to improve our knowledge base:</p>
          <p style="margin: 20px 0;">
            <a href="${data.faq_admin_url}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">Answer This Question</a>
          </p>
          <p style="color: #666; font-size: 14px;">After answering, remember to recompile the context so future visitors get better responses.</p>
        `,
        text: `New Unanswered Question

Someone asked a question that our AI assistant couldn't confidently answer:

"${data.question}"

${data.user_email && data.user_email !== 'Not provided' ? `User email for follow-up: ${data.user_email}` : ''}

Add an answer to improve our knowledge base:
${data.faq_admin_url}

After answering, remember to recompile the context so future visitors get better responses.`
      };

    // ===== CONTACT FORM =====
    case "contact_form":
      return {
        subject: `[Website Contact] ${data.subject || 'General Inquiry'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333; margin-bottom: 4px;">${data.name || 'Someone'} submitted a message from alpacaplayhouse.com</h2>
            <p style="color: #888; font-size: 13px; margin-top: 0;">${data.subject || 'General Inquiry'}</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; width: 80px; vertical-align: top;">Name</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.name || 'Not provided'}</td></tr>
              ${data.email ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Email</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="mailto:${data.email}" style="color: #2563eb;">${data.email}</a></td></tr>` : ''}
              ${data.phone ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Phone</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="tel:${data.phone}" style="color: #2563eb;">${data.phone}</a></td></tr>` : ''}
            </table>
            ${data.message ? `
            <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 16px 0; white-space: pre-wrap; line-height: 1.5; color: #333;">${data.message}</div>
            ` : ''}
            ${data.email ? `<p style="margin-top: 20px;"><a href="mailto:${data.email}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 14px;">Reply to ${data.name || data.email}</a></p>` : ''}
          </div>
        `,
        text: `${data.name || 'Someone'} submitted a message from alpacaplayhouse.com

Name: ${data.name || 'Not provided'}
Email: ${data.email || 'Not provided'}
Phone: ${data.phone || 'Not provided'}
Subject: ${data.subject || 'General Inquiry'}

Message:
${data.message || 'No message'}`
      };

    // ===== COMMUNITY FIT INQUIRY =====
    case "community_fit_inquiry":
      return {
        subject: `[Community Fit] ${data.name || 'New Inquiry'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333; margin-bottom: 4px;">${data.name || 'Someone'} submitted an inquiry from alpacaplayhouse.com</h2>
            <p style="color: #888; font-size: 13px; margin-top: 0;">Community Fit Inquiry</p>

            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; width: 110px; vertical-align: top;">Name</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.name || 'Not provided'}</td></tr>
              ${data.email ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Email</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="mailto:${data.email}" style="color: #2563eb;">${data.email}</a></td></tr>` : ''}
              ${data.phone ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Phone</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="tel:${data.phone}" style="color: #2563eb;">${data.phone}</a></td></tr>` : ''}
              ${data.dob ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">DOB</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.dob}</td></tr>` : ''}
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Accommodation</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.accommodation || 'Not specified'}</td></tr>
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Timeframe</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.timeframe || 'Not specified'}</td></tr>
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Volunteer</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.volunteer || 'Not specified'}</td></tr>
              <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Referral</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${data.referral || 'Not specified'}</td></tr>
            </table>

            ${data.coliving_experience ? `
            <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Co-living Experience</h3>
            <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">${data.coliving_experience}</div>
            ` : ''}

            ${data.life_focus ? `
            <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Life Focus / Goals</h3>
            <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">${data.life_focus}</div>
            ` : ''}

            ${data.visiting_guide ? `
            <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Visiting Guide Response</h3>
            <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">${data.visiting_guide}</div>
            ` : ''}

            ${data.photo_url ? `
            <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Photo</h3>
            <img src="${data.photo_url}" style="max-width: 200px; border-radius: 8px; border: 1px solid #eee;" />
            ` : ''}

            ${data.email ? `<p style="margin-top: 24px;"><a href="mailto:${data.email}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 14px;">Reply to ${data.name || data.email}</a></p>` : ''}
          </div>
        `,
        text: `${data.name || 'Someone'} submitted an inquiry from alpacaplayhouse.com

Name: ${data.name || 'Not provided'}
Email: ${data.email || 'Not provided'}
Phone: ${data.phone || 'Not provided'}
DOB: ${data.dob || 'Not provided'}
Accommodation: ${data.accommodation || 'Not specified'}
Timeframe: ${data.timeframe || 'Not specified'}
Volunteer: ${data.volunteer || 'Not specified'}
Referral: ${data.referral || 'Not specified'}

Co-living Experience:
${data.coliving_experience || 'Not provided'}

Life Focus / Goals:
${data.life_focus || 'Not provided'}

Visiting Guide Response:
${data.visiting_guide || 'Not provided'}

${data.photo_url ? `Photo: ${data.photo_url}` : ''}`
      };

    // ===== BUG REPORT NOTIFICATIONS =====
    case "bug_report_received":
      return {
        subject: `Bug by ${data.reporter_name || 'Unknown'}: ${(data.description || '').replace(/[\r\n]+/g, ' ').substring(0, 50)}`,
        html: `
          <h2 style="color: #2980b9;">Bug Report Received</h2>
          <p>Hi ${data.reporter_name},</p>
          <p>We've received your bug report and our automated system is working on a fix right now.</p>

          <h3>Your Report</h3>
          <p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">${data.description}</p>
          ${data.page_url ? `<p><strong>Page:</strong> <a href="${data.page_url}">${data.page_url}</a></p>` : ''}

          ${data.screenshot_url ? `
          <h3>Your Screenshot</h3>
          <p><img src="${data.screenshot_url}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
          ` : ''}

          <p style="color: #666; font-size: 13px; margin-top: 20px;">You'll receive another email when the fix is deployed or if we need to escalate to a human.</p>
        `,
        text: `Bug Report Received

Hi ${data.reporter_name},

We've received your bug report and our automated system is working on a fix right now.

YOUR REPORT:
${data.description}
${data.page_url ? `Page: ${data.page_url}` : ''}

You'll receive another email when the fix is deployed or if we need to escalate to a human.`
      };

    case "bug_report_fixed":
      return {
        subject: `Re: Bug by ${data.reporter_name || 'Unknown'}: ${(data.description || '').replace(/[\r\n]+/g, ' ').substring(0, 50)}`,
        html: `
          <h2 style="color: #27ae60;">Bug Fixed!</h2>
          <p>Hi ${data.reporter_name},</p>
          <p>Your bug report has been automatically fixed and deployed.</p>

          <h3>Your Report</h3>
          <p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">${data.description}</p>
          ${data.page_url ? `<p><strong>Page:</strong> <a href="${data.page_url}">${data.page_url}</a></p>` : ''}

          ${data.screenshot_url ? `
          <h3>Your Screenshot</h3>
          <p><img src="${data.screenshot_url}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
          ` : ''}

          <h3>What Was Fixed</h3>
          <p style="background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60;">${data.fix_summary || 'The issue has been resolved.'}</p>

          ${data.fix_commit_sha ? `<p><strong>Commit:</strong> <a href="https://github.com/rsonnad/alpacapps/commit/${data.fix_commit_sha}">${data.fix_commit_sha.substring(0, 7)}</a></p>` : ''}

          <p>The fix is live now. Please verify at:<br>
          <a href="${data.page_url || 'https://rsonnad.github.io/alpacapps/spaces/'}" style="background: #27ae60; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 8px;">View Live Site</a></p>

          <p style="color: #666; font-size: 13px; margin-top: 20px;">If the fix doesn't look right, submit another bug report and we'll take another look.</p>
        `,
        text: `Bug Fixed!

Hi ${data.reporter_name},

Your bug report has been automatically fixed and deployed.

YOUR REPORT:
${data.description}
${data.page_url ? `Page: ${data.page_url}` : ''}

WHAT WAS FIXED:
${data.fix_summary || 'The issue has been resolved.'}

${data.fix_commit_sha ? `Commit: https://github.com/rsonnad/alpacapps/commit/${data.fix_commit_sha}` : ''}

The fix is live now. Please verify at:
${data.page_url || 'https://rsonnad.github.io/alpacapps/spaces/'}

If the fix doesn't look right, submit another bug report and we'll take another look.`
      };

    case "bug_report_failed":
      return {
        subject: `Re: Bug by ${data.reporter_name || 'Unknown'}: ${(data.description || '').replace(/[\r\n]+/g, ' ').substring(0, 50)}`,
        html: `
          <h2 style="color: #e67e22;">Bug Report Update</h2>
          <p>Hi ${data.reporter_name},</p>
          <p>We received your bug report but the automated fix was not successful. A human will take a look.</p>

          <h3>Your Report</h3>
          <p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">${data.description}</p>
          ${data.page_url ? `<p><strong>Page:</strong> <a href="${data.page_url}">${data.page_url}</a></p>` : ''}

          ${data.screenshot_url ? `
          <h3>Your Screenshot</h3>
          <p><img src="${data.screenshot_url}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
          ` : ''}

          ${data.error_message ? `
          <h3>What Went Wrong</h3>
          <p style="background: #fef3e2; padding: 15px; border-radius: 8px; border-left: 4px solid #e67e22;">${data.error_message}</p>
          ` : ''}

          <p>We'll review this manually and follow up. Thank you for reporting!</p>
        `,
        text: `Bug Report Update

Hi ${data.reporter_name},

We received your bug report but the automated fix was not successful. A human will take a look.

YOUR REPORT:
${data.description}
${data.page_url ? `Page: ${data.page_url}` : ''}

${data.error_message ? `WHAT WENT WRONG:\n${data.error_message}` : ''}

We'll review this manually and follow up. Thank you for reporting!`
      };

    case "bug_report_verified":
      return {
        subject: `Re: Bug by ${data.reporter_name || 'Unknown'}: ${(data.description || '').replace(/[\r\n]+/g, ' ').substring(0, 50)}`,
        html: `
          <h2 style="color: #27ae60;">Screenshot of the Fix</h2>
          <p>Hi ${data.reporter_name},</p>
          <p>Here's a screenshot of the page after the fix was deployed:</p>

          ${data.verification_screenshot_url ? `
          <p><img src="${data.verification_screenshot_url}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Screenshot after fix"></p>
          ` : ''}

          ${data.page_url ? `<p><strong>Page:</strong> <a href="${data.page_url}">${data.page_url}</a></p>` : ''}

          ${data.fix_summary ? `
          <h3>What Was Fixed</h3>
          <p style="background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60;">${data.fix_summary}</p>
          ` : ''}

          <p style="color: #666; font-size: 13px; margin-top: 20px;">If the fix doesn't look right, submit another bug report and we'll take another look.</p>
        `,
        text: `Screenshot of the Fix

Hi ${data.reporter_name},

Here's a screenshot of the page after the fix was deployed.

${data.page_url ? `Page: ${data.page_url}` : ''}

${data.fix_summary ? `WHAT WAS FIXED:\n${data.fix_summary}` : ''}

If the fix doesn't look right, submit another bug report and we'll take another look.`
      };

    // ===== FEATURE BUILDER =====
    case "feature_review": {
      const riskAss = data.risk_assessment || {};
      const filesStr = (data.files_created || []).join(', ');
      const filesModStr = (data.files_modified || []).join(', ');
      const compareUrl = data.branch_name ? `https://github.com/rsonnad/alpacapps/compare/${data.branch_name}` : '';
      return {
        subject: `PAI Feature Review: ${(data.description || 'New Feature').substring(0, 60)}`,
        html: `
          <h2 style="color: #e67e22;">Feature Ready for Review</h2>
          <p><strong>${data.requester_name}</strong> (${data.requester_role}) asked PAI to build:</p>
          <p style="background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #e67e22;">${data.description}</p>

          <h3>Build Summary</h3>
          <p>${data.build_summary || 'No summary available.'}</p>

          ${filesStr ? `<p><strong>Files created:</strong> ${filesStr}</p>` : ''}
          ${filesModStr ? `<p><strong>Files modified:</strong> <span style="color: #e74c3c;">${filesModStr}</span></p>` : ''}
          ${data.branch_name ? `<p><strong>Branch:</strong> <code>${data.branch_name}</code></p>` : ''}

          <h3>Risk Assessment</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Reason</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">${riskAss.reason || 'N/A'}</td></tr>
            <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Touches existing functionality</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">${riskAss.touches_existing_functionality ? 'Yes' : 'No'}</td></tr>
            <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Could confuse users</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">${riskAss.could_confuse_users ? 'Yes' : 'No'}</td></tr>
            <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Removes or changes features</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">${riskAss.removes_or_changes_features ? 'Yes' : 'No'}</td></tr>
          </table>

          ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}

          <div style="margin: 20px 0;">
            ${compareUrl ? `<a href="${compareUrl}" style="background: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold; margin-right: 10px;">Review Changes on GitHub</a>` : ''}
          </div>

          <p style="color: #666; font-size: 13px; margin-top: 20px;">
            <strong>To deploy:</strong> merge the branch to main, run bump-version.sh, push.<br>
            <strong>To reject:</strong> delete the branch on GitHub.
          </p>
        `,
        text: `PAI Feature Ready for Review

${data.requester_name} (${data.requester_role}) asked PAI to build:
${data.description}

BUILD SUMMARY:
${data.build_summary || 'No summary available.'}

${filesStr ? `Files created: ${filesStr}` : ''}
${filesModStr ? `Files modified: ${filesModStr}` : ''}
${data.branch_name ? `Branch: ${data.branch_name}` : ''}

RISK ASSESSMENT:
- Reason: ${riskAss.reason || 'N/A'}
- Touches existing functionality: ${riskAss.touches_existing_functionality ? 'Yes' : 'No'}
- Could confuse users: ${riskAss.could_confuse_users ? 'Yes' : 'No'}
- Removes or changes features: ${riskAss.removes_or_changes_features ? 'Yes' : 'No'}

${data.notes ? `Notes: ${data.notes}` : ''}

${compareUrl ? `Review: ${compareUrl}` : ''}

To deploy: merge the branch to main, run bump-version.sh, push.
To reject: delete the branch on GitHub.`
      };
    }

    // ===== IDENTITY VERIFICATION =====
    case "dl_upload_link":
      return {
        subject: "Action Required: Identity Verification - Alpaca Playhouse",
        html: `
          <h2>Identity Verification Required</h2>
          <p>Hi ${data.first_name},</p>
          <p>As part of your rental application, we need to verify your identity. Please upload a clear photo of your driver's license or state ID or other valid government ID.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.upload_url}" style="background: #3d8b7a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.1em; display: inline-block;">Upload Your ID</a>
          </div>
          <p style="color: #666; font-size: 0.9em;">This link will expire in 7 days. If you need a new link, please let us know.</p>
          <p><strong>Tips for a good photo:</strong></p>
          <ul>
            <li>Use good lighting - avoid glare and shadows</li>
            <li>Make sure all text is readable</li>
            <li>Include the full card in the frame</li>
          </ul>
          <p>If you have any questions, feel free to reply to this email.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Identity Verification Required

Hi ${data.first_name},

As part of your rental application, we need to verify your identity. Please upload a clear photo of your driver's license or state ID or other valid government ID.

Upload your ID here: ${data.upload_url}

This link will expire in 7 days. If you need a new link, please let us know.

Tips for a good photo:
- Use good lighting - avoid glare and shadows
- Make sure all text is readable
- Include the full card in the frame

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse`
      };

    case "dl_verified":
      return {
        subject: "Identity Verified - Alpaca Playhouse",
        html: `
          <h2 style="color: #27ae60;">Identity Verified!</h2>
          <p>Hi ${data.first_name},</p>
          <p>Your identity has been successfully verified. Thank you for completing this step!</p>
          <p>We'll continue processing your rental application and will be in touch with next steps soon.</p>
          <p>If you have any questions, feel free to reply to this email.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Identity Verified!

Hi ${data.first_name},

Your identity has been successfully verified. Thank you for completing this step!

We'll continue processing your rental application and will be in touch with next steps soon.

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse`
      };

    case "dl_mismatch":
      return {
        subject: `Identity Verification Flagged: ${data.applicant_name}`,
        html: `
          <h2 style="color: #e67e22;">Identity Verification Flagged</h2>
          <p>An identity verification needs your review.</p>
          <div style="background: #fef9e7; border-radius: 8px; padding: 15px; margin: 15px 0;">
            <table style="border-collapse: collapse; width: 100%;">
              <tr>
                <td style="padding: 6px 0;"><strong>Application Name:</strong></td>
                <td style="padding: 6px 0;">${data.applicant_name}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;"><strong>Name on ID:</strong></td>
                <td style="padding: 6px 0;">${data.extracted_name || 'Could not extract'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;"><strong>Match Score:</strong></td>
                <td style="padding: 6px 0;">${data.match_score}%</td>
              </tr>
              ${data.is_expired ? '<tr><td style="padding: 6px 0;"><strong>Note:</strong></td><td style="padding: 6px 0; color: #c0392b;">ID appears to be expired</td></tr>' : ''}
            </table>
          </div>
          <p><a href="${data.admin_url}" style="background: #3d8b7a; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Review in Admin</a></p>
        `,
        text: `Identity Verification Flagged

An identity verification needs your review.

Application Name: ${data.applicant_name}
Name on ID: ${data.extracted_name || 'Could not extract'}
Match Score: ${data.match_score}%
${data.is_expired ? 'Note: ID appears to be expired' : ''}

Review in Admin: ${data.admin_url}`
      };

    // ===== PAI EMAIL =====
    case "pai_email_reply":
      return {
        subject: `Re: ${data.original_subject || 'Your message to PAI'}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1a1a2e; padding: 20px; border-radius: 12px 12px 0 0;">
              <h2 style="color: #e0d68a; margin: 0;">PAI</h2>
              <p style="color: #aaa; margin: 4px 0 0 0; font-size: 13px;">Property AI Assistant</p>
            </div>
            <div style="background: #fff; padding: 24px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px;">
              <div style="white-space: pre-wrap; line-height: 1.6;">${data.reply_body || ''}</div>
              ${data.original_body ? `
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0 16px;">
              <p style="color: #888; font-size: 12px; margin-bottom: 8px;">Your original message:</p>
              <div style="color: #999; font-size: 13px; border-left: 3px solid #ddd; padding-left: 12px;">${data.original_body}</div>
              ` : ''}
            </div>
            <p style="color: #999; font-size: 11px; text-align: center; margin-top: 12px;">
              This is an automated reply from PAI at Alpaca Playhouse. Reply to this email to continue the conversation.
            </p>
          </div>
        `,
        text: `PAI - Property AI Assistant

${data.reply_body || ''}

${data.original_body ? `---\nYour original message:\n${data.original_body}` : ''}

This is an automated reply from PAI at Alpaca Playhouse.`
      };

    case "pai_document_received": {
      const fileList = (data.files || []).map((f: any) => `• ${f.name} (${f.type}, ${f.size})`).join('\n');
      const fileListHtml = (data.files || []).map((f: any) => `<li><strong>${f.name}</strong> (${f.type}, ${f.size})</li>`).join('');
      return {
        subject: `PAI Document Upload: ${data.file_count || 1} file(s) from ${data.sender_name || data.sender_email}`,
        html: `
          <h2 style="color: #3d8b7a;">Document Received via PAI Email</h2>
          <p><strong>${data.sender_name || 'Unknown'}</strong> (${data.sender_email}) sent ${data.file_count || 1} document(s) to <code>pai@alpacaplayhouse.com</code>.</p>

          <div style="background: #f0faf7; padding: 15px; border-radius: 8px; border-left: 4px solid #3d8b7a; margin: 15px 0;">
            <strong>Subject:</strong> ${data.original_subject || '(none)'}<br>
            ${data.message_body ? `<strong>Message:</strong> ${data.message_body.substring(0, 500)}` : ''}
          </div>

          <h3>Uploaded Files</h3>
          <ul>${fileListHtml}</ul>

          <p>Files have been uploaded to R2 and added to the <strong>document index</strong> as <strong>inactive</strong> (pending admin review).</p>
          <p><a href="${data.admin_url || 'https://alpacaplayhouse.com/spaces/admin/manage.html'}" style="background: #3d8b7a; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Review in Admin</a></p>
        `,
        text: `PAI Document Upload

${data.sender_name || 'Unknown'} (${data.sender_email}) sent ${data.file_count || 1} document(s) to pai@alpacaplayhouse.com.

Subject: ${data.original_subject || '(none)'}
${data.message_body ? `Message: ${data.message_body.substring(0, 500)}` : ''}

Files:
${fileList}

Files have been uploaded to R2 and added to the document index as inactive (pending admin review).`
      };
    }

    default:
      throw new Error(`Unknown email type: ${type}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Try to load a template from the DB (with cache), fall back to hardcoded.
 * Returns { subject, html, text, sender_type } with placeholders already rendered.
 */
async function getRenderedTemplate(
  type: EmailType,
  data: Record<string, any>
): Promise<{ subject: string; html: string; text: string; senderType: string }> {
  // 1. Try DB template (cached)
  const cached = templateCache.get(type);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    const t = cached.template;
    return {
      subject: renderTemplate(t.subject_template, data),
      html: renderTemplate(t.html_template, data),
      text: renderTemplate(t.text_template, data),
      senderType: t.sender_type || "team",
    };
  }

  // 2. Fetch from DB
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: dbTemplate, error } = await supabase
      .from("email_templates")
      .select("subject_template, html_template, text_template, sender_type")
      .eq("template_key", type)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    if (dbTemplate && !error) {
      templateCache.set(type, { template: dbTemplate, fetchedAt: Date.now() });
      return {
        subject: renderTemplate(dbTemplate.subject_template, data),
        html: renderTemplate(dbTemplate.html_template, data),
        text: renderTemplate(dbTemplate.text_template, data),
        senderType: dbTemplate.sender_type || "team",
      };
    }
  } catch (e) {
    console.error(`DB template fetch failed for ${type}, using hardcoded fallback:`, e);
  }

  // 3. Fall back to hardcoded template (evaluated with JS template literals)
  const fallback = getTemplate(type, data);
  return {
    subject: fallback.subject,
    html: fallback.html,
    text: fallback.text,
    senderType: "team", // fallback doesn't know sender_type, will be overridden below
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const body: EmailRequest = await req.json();
    const { type, to, data, subject: customSubject, from, reply_to } = body;

    if (!type || !to || !data) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: type, to, data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get rendered template (DB first, then hardcoded fallback)
    const rendered = await getRenderedTemplate(type, data);

    // Determine sender from DB template's sender_type, with fallback
    const sender = SENDER_MAP[rendered.senderType] || SENDER_MAP.team;

    // Send email via Resend
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from || sender.from,
        to: Array.isArray(to) ? to : [to],
        reply_to: reply_to || sender.reply_to,
        subject: customSubject || rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Resend API error:", result);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: result }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Email sent successfully:", { type, to, id: result.id });

    // Log to api_usage_log (fire-and-forget, don't block response)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const recipientCount = Array.isArray(to) ? to.length : 1;
      sb.from("api_usage_log").insert({
        vendor: "resend",
        category: `email_${type}`,
        endpoint: "POST /emails",
        units: recipientCount,
        unit_type: "emails",
        estimated_cost_usd: recipientCount * 0.00028,
        metadata: { resend_id: result.id, email_type: type, recipient_count: recipientCount },
      }).then(() => {});
    } catch (_) { /* non-critical */ }

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
