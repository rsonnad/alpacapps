import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

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
  | "faq_unanswered";

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
          <p>Thank you for your interest in Alpaca Playhouse.</p>
          <p>After careful review, we're unable to approve your application at this time.</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
          <p>We appreciate your understanding and wish you the best in your housing search.</p>
          <p>Best regards,<br>Alpaca Playhouse</p>
        `,
        text: `Hi ${data.first_name},

Thank you for your interest in Alpaca Playhouse.

After careful review, we're unable to approve your application at this time.
${data.reason ? `\nReason: ${data.reason}` : ''}

We appreciate your understanding and wish you the best in your housing search.

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
            <li>Zelle: payments@alpacaplayhouse.com</li>
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
- Zelle: payments@alpacaplayhouse.com

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
            <li>Zelle: payments@alpacaplayhouse.com</li>
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
- Zelle: payments@alpacaplayhouse.com

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
            <li>Zelle: payments@alpacaplayhouse.com</li>
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
- Zelle: payments@alpacaplayhouse.com

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
            <li>Zelle: payments@alpacaplayhouse.com</li>
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
- Zelle: payments@alpacaplayhouse.com

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

    default:
      throw new Error(`Unknown email type: ${type}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const DEFAULT_FROM = Deno.env.get("EMAIL_FROM") || "Alpaca Playhouse <noreply@alpacaplayhouse.com>";
    const DEFAULT_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") || "hello@alpacaplayhouse.com";

    const body: EmailRequest = await req.json();
    const { type, to, data, subject: customSubject, from, reply_to } = body;

    if (!type || !to || !data) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: type, to, data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get template
    const template = getTemplate(type, data);

    // Send email via Resend
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from || DEFAULT_FROM,
        to: Array.isArray(to) ? to : [to],
        reply_to: reply_to || DEFAULT_REPLY_TO,
        subject: customSubject || template.subject,
        html: template.html,
        text: template.text,
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
