-- ============================================================
-- Seed all email templates into email_templates table
-- Run: psql <connection_string> -f scripts/seed-email-templates.sql
-- ============================================================

-- Clear existing templates (idempotent re-run)
DELETE FROM email_templates;

INSERT INTO email_templates (template_key, category, description, sender_type, subject_template, html_template, text_template, placeholders)
VALUES

-- ============================================================
-- 1. application_submitted
-- ============================================================
(
  'application_submitted',
  'rental',
  'Sent to applicant when their rental application is received',
  'team',
  'Application Received - Alpaca Playhouse',
  $html$
<h2>Thank you for your application!</h2>
<p>Hi {{first_name}},</p>
<p>We've received your rental application for <strong>{{space_name}}</strong>.</p>
<p>We'll review your application and get back to you within 2-3 business days.</p>
<p><strong>What's next?</strong></p>
<ul>
  <li>Our team will review your application</li>
  <li>We may reach out for additional information</li>
  <li>You'll receive an email once a decision is made</li>
</ul>
<p>If you have any questions, feel free to reply to this email.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Thank you for your application!

Hi {{first_name}},

We've received your rental application for {{space_name}}.

We'll review your application and get back to you within 2-3 business days.

What's next?
- Our team will review your application
- We may reach out for additional information
- You'll receive an email once a decision is made

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"space_name","required":false,"description":"Space name (defaults to Alpaca Playhouse)"}]'::jsonb
),

-- ============================================================
-- 2. application_approved
-- ============================================================
(
  'application_approved',
  'rental',
  'Sent to applicant when their rental application is approved',
  'team',
  'Congratulations! Your Application is Approved - Alpaca Playhouse',
  $html$
<h2>Great news, {{first_name}}!</h2>
<p>Your rental application has been <strong style="color: green;">approved</strong>!</p>
<h3>Lease Terms</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 400px;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{space_name}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Rate:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{monthly_rate}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Move-in Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{move_in_date}}</td></tr>
  {{#if lease_end_date}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease End:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{lease_end_date}}</td></tr>{{/if}}
</table>
<p><strong>Next Steps:</strong></p>
<ol>
  <li>Review the lease agreement (we'll send it shortly)</li>
  <li>Sign the lease electronically</li>
  <li>Submit required deposits</li>
</ol>
<p>We're excited to welcome you to Alpaca Playhouse!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Great news, {{first_name}}!

Your rental application has been APPROVED!

Lease Terms:
- Space: {{space_name}}
- Monthly Rate: ${{monthly_rate}}
- Move-in Date: {{move_in_date}}
{{#if lease_end_date}}- Lease End: {{lease_end_date}}{{/if}}

Next Steps:
1. Review the lease agreement (we'll send it shortly)
2. Sign the lease electronically
3. Submit required deposits

We're excited to welcome you to Alpaca Playhouse!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"space_name","required":true,"description":"Approved space name"},{"key":"monthly_rate","required":true,"description":"Monthly rate amount"},{"key":"move_in_date","required":true,"description":"Move-in date"},{"key":"lease_end_date","required":false,"description":"Lease end date (optional)"}]'::jsonb
),

-- ============================================================
-- 3. application_denied
-- ============================================================
(
  'application_denied',
  'rental',
  'Sent to applicant when their rental application is denied',
  'team',
  'Application Update - Alpaca Playhouse',
  $html$
<p>Hi {{first_name}},</p>
<p>We're sorry but we are not able to approve you to apply for housing at the Alpaca Playhouse at this time. This may be due to our gender balance goals, or it may be due to other reasons related to our assessment of community fit at this specific time.</p>
<p>If you have questions, please contact a community manager.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Hi {{first_name}},

We're sorry but we are not able to approve you to apply for housing at the Alpaca Playhouse at this time. This may be due to our gender balance goals, or it may be due to other reasons related to our assessment of community fit at this specific time.

If you have questions, please contact a community manager.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"}]'::jsonb
),

-- ============================================================
-- 4. lease_generated
-- ============================================================
(
  'lease_generated',
  'rental',
  'Sent to applicant when their lease agreement PDF is generated',
  'team',
  'Your Lease Agreement is Ready - Alpaca Playhouse',
  $html$
<h2>Your Lease is Ready for Review</h2>
<p>Hi {{first_name}},</p>
<p>Your lease agreement has been prepared and is ready for your review.</p>
<p>Please take a moment to review the terms. We'll send you a signature request shortly.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Your Lease is Ready for Review

Hi {{first_name}},

Your lease agreement has been prepared and is ready for your review.

Please take a moment to review the terms. We'll send you a signature request shortly.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"}]'::jsonb
),

-- ============================================================
-- 5. lease_sent
-- ============================================================
(
  'lease_sent',
  'rental',
  'Sent to applicant when their lease is sent for e-signature via SignWell',
  'team',
  'Action Required: Sign Your Lease Agreement - Alpaca Playhouse',
  $html$
<h2>Please Sign Your Lease Agreement</h2>
<p>Hi {{first_name}},</p>
<p>Your lease agreement has been sent for electronic signature.</p>
<p>Please check your email from SignWell and complete the signing process at your earliest convenience.</p>
<p><strong>Important:</strong> The lease must be signed before we can proceed with your move-in.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Please Sign Your Lease Agreement

Hi {{first_name}},

Your lease agreement has been sent for electronic signature.

Please check your email from SignWell and complete the signing process at your earliest convenience.

Important: The lease must be signed before we can proceed with your move-in.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"}]'::jsonb
),

-- ============================================================
-- 6. lease_signed
-- ============================================================
(
  'lease_signed',
  'rental',
  'Sent to applicant when their lease is signed (from send-email function)',
  'team',
  'Lease Signed Successfully - Alpaca Playhouse',
  $html$
<h2>Lease Signing Complete!</h2>
<p>Hi {{first_name}},</p>
<p>Your lease agreement has been successfully signed. A copy will be provided for your records.</p>
<p><strong>Next Steps:</strong></p>
<ul>
  <li>Submit your move-in deposit: <strong>${{move_in_deposit}}</strong></li>
  {{#if security_deposit}}<li>Submit your security deposit: <strong>${{security_deposit}}</strong></li>{{/if}}
</ul>
<p>Once deposits are received, we'll confirm your move-in date.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Lease Signing Complete!

Hi {{first_name}},

Your lease agreement has been successfully signed. A copy will be provided for your records.

Next Steps:
- Submit your move-in deposit: ${{move_in_deposit}}
{{#if security_deposit}}- Submit your security deposit: ${{security_deposit}}{{/if}}

Once deposits are received, we'll confirm your move-in date.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"move_in_deposit","required":true,"description":"Move-in deposit amount (pre-computed from move_in_deposit or monthly_rate)"},{"key":"security_deposit","required":false,"description":"Security deposit amount (optional)"}]'::jsonb
),

-- ============================================================
-- 7. deposit_requested
-- ============================================================
(
  'deposit_requested',
  'rental',
  'Sent to applicant requesting deposit payments',
  'team',
  'Deposit Request - Alpaca Playhouse',
  $html$
<h2>Deposit Payment Request</h2>
<p>Hi {{first_name}},</p>
<p>Please submit the following deposits to secure your rental:</p>
<table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 20px 0;">
  {{#if move_in_deposit}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Move-in Deposit:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{move_in_deposit}}</td></tr>{{/if}}
  {{#if security_deposit}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Security Deposit:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{security_deposit}}</td></tr>{{/if}}
  <tr><td style="padding: 8px; font-weight: bold;"><strong>Total Due:</strong></td><td style="padding: 8px; font-weight: bold;">${{total_due}}</td></tr>
</table>
{{#if due_date}}<p><strong>Due Date:</strong> {{due_date}}</p>{{/if}}
<p><strong>Payment Methods:</strong></p>
<ul>
  <li>Venmo: @AlpacaPlayhouse</li>
  <li>Zelle: alpacaplayhouse@gmail.com</li>
</ul>
<p>Please include your name in the payment memo.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Deposit Payment Request

Hi {{first_name}},

Please submit the following deposits to secure your rental:

{{#if move_in_deposit}}Move-in Deposit: ${{move_in_deposit}}{{/if}}
{{#if security_deposit}}Security Deposit: ${{security_deposit}}{{/if}}
Total Due: ${{total_due}}
{{#if due_date}}Due Date: {{due_date}}{{/if}}

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

Please include your name in the payment memo.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"total_due","required":true,"description":"Total deposit amount due"},{"key":"move_in_deposit","required":false,"description":"Move-in deposit amount"},{"key":"security_deposit","required":false,"description":"Security deposit amount"},{"key":"due_date","required":false,"description":"Payment due date"}]'::jsonb
),

-- ============================================================
-- 8. deposit_received
-- ============================================================
(
  'deposit_received',
  'rental',
  'Sent to applicant when a deposit payment is received',
  'team',
  'Deposit Received - Alpaca Playhouse',
  $html$
<h2>Payment Received</h2>
<p>Hi {{first_name}},</p>
<p>We've received your deposit payment of <strong>${{amount}}</strong>.</p>
{{#if remaining_balance}}<p><strong>Remaining Balance:</strong> ${{remaining_balance}}</p>{{else}}<p>All deposits have been received!</p>{{/if}}
<p>Thank you!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Payment Received

Hi {{first_name}},

We've received your deposit payment of ${{amount}}.
{{#if remaining_balance}}Remaining Balance: ${{remaining_balance}}{{else}}All deposits have been received!{{/if}}

Thank you!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"amount","required":true,"description":"Payment amount received"},{"key":"remaining_balance","required":false,"description":"Remaining balance (0 or empty means all paid)"}]'::jsonb
),

-- ============================================================
-- 9. deposits_confirmed
-- ============================================================
(
  'deposits_confirmed',
  'rental',
  'Sent to applicant when all deposits are confirmed and move-in is ready',
  'team',
  'Deposits Confirmed - Ready for Move-in! - Alpaca Playhouse',
  $html$
<h2>You're All Set!</h2>
<p>Hi {{first_name}},</p>
<p>All your deposits have been received and confirmed.</p>
<p><strong>Move-in Date:</strong> {{move_in_date}}</p>
<p>We'll be in touch with move-in details and key handoff arrangements.</p>
<p>Welcome to Alpaca Playhouse!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$You're All Set!

Hi {{first_name}},

All your deposits have been received and confirmed.

Move-in Date: {{move_in_date}}

We'll be in touch with move-in details and key handoff arrangements.

Welcome to Alpaca Playhouse!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"move_in_date","required":true,"description":"Confirmed move-in date"}]'::jsonb
),

-- ============================================================
-- 10. move_in_confirmed
-- ============================================================
(
  'move_in_confirmed',
  'rental',
  'Sent to tenant when move-in is confirmed and lease is active',
  'team',
  'Welcome Home! Move-in Confirmed - Alpaca Playhouse',
  $html$
<h2>Welcome to Alpaca Playhouse!</h2>
<p>Hi {{first_name}},</p>
<p>Your move-in is confirmed and your lease is now active!</p>
<h3>Your Rental Details</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 400px;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{space_name}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease Start:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{move_in_date}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Rent:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{monthly_rate}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Rent Due:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{rent_due_day}} of each month</td></tr>
</table>
<p><strong>Payment Methods:</strong></p>
<ul>
  <li>Venmo: @AlpacaPlayhouse</li>
  <li>Zelle: alpacaplayhouse@gmail.com</li>
</ul>
<p>If you have any questions or need anything, don't hesitate to reach out!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Welcome to Alpaca Playhouse!

Hi {{first_name}},

Your move-in is confirmed and your lease is now active!

Your Rental Details:
- Space: {{space_name}}
- Lease Start: {{move_in_date}}
- Monthly Rent: ${{monthly_rate}}
- Rent Due: {{rent_due_day}} of each month

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

If you have any questions or need anything, don't hesitate to reach out!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Tenant first name"},{"key":"space_name","required":true,"description":"Space name"},{"key":"move_in_date","required":true,"description":"Move-in / lease start date"},{"key":"monthly_rate","required":true,"description":"Monthly rent amount"},{"key":"rent_due_day","required":false,"description":"Day of month rent is due (defaults to 1st)"}]'::jsonb
),

-- ============================================================
-- 11. payment_reminder
-- ============================================================
(
  'payment_reminder',
  'payment',
  'Friendly rent payment reminder sent before due date',
  'team',
  'Rent Reminder - Due {{due_date}} - Alpaca Playhouse',
  $html$
<h2>Friendly Rent Reminder</h2>
<p>Hi {{first_name}},</p>
<p>This is a friendly reminder that your rent payment of <strong>${{amount}}</strong> is due on <strong>{{due_date}}</strong>.</p>
<p><strong>Payment Methods:</strong></p>
<ul>
  <li>Venmo: @AlpacaPlayhouse</li>
  <li>Zelle: alpacaplayhouse@gmail.com</li>
</ul>
<p>Please include your name and "{{period}}" in the payment memo.</p>
<p>Thank you!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Friendly Rent Reminder

Hi {{first_name}},

This is a friendly reminder that your rent payment of ${{amount}} is due on {{due_date}}.

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

Please include your name and "{{period}}" in the payment memo.

Thank you!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Tenant first name"},{"key":"amount","required":true,"description":"Rent amount due"},{"key":"due_date","required":true,"description":"Payment due date"},{"key":"period","required":false,"description":"Payment period label (defaults to rent)"}]'::jsonb
),

-- ============================================================
-- 12. payment_overdue
-- ============================================================
(
  'payment_overdue',
  'payment',
  'Urgent notification when rent payment is overdue',
  'team',
  'URGENT: Rent Payment Overdue - Alpaca Playhouse',
  $html$
<h2 style="color: #c00;">Rent Payment Overdue</h2>
<p>Hi {{first_name}},</p>
<p>Your rent payment of <strong>${{amount}}</strong> was due on <strong>{{due_date}}</strong> and is now <strong>{{days_overdue_text}} overdue</strong>.</p>
{{#if late_fee}}<p><strong>Late Fee:</strong> ${{late_fee}}</p><p><strong>Total Due:</strong> ${{total_due}}</p>{{/if}}
<p>Please submit payment as soon as possible to avoid any additional fees or action.</p>
<p><strong>Payment Methods:</strong></p>
<ul>
  <li>Venmo: @AlpacaPlayhouse</li>
  <li>Zelle: alpacaplayhouse@gmail.com</li>
</ul>
<p>If you're experiencing difficulties, please reach out to discuss options.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$RENT PAYMENT OVERDUE

Hi {{first_name}},

Your rent payment of ${{amount}} was due on {{due_date}} and is now {{days_overdue_text}} overdue.
{{#if late_fee}}
Late Fee: ${{late_fee}}
Total Due: ${{total_due}}{{/if}}

Please submit payment as soon as possible to avoid any additional fees or action.

Payment Methods:
- Venmo: @AlpacaPlayhouse
- Zelle: alpacaplayhouse@gmail.com

If you're experiencing difficulties, please reach out to discuss options.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Tenant first name"},{"key":"amount","required":true,"description":"Rent amount due"},{"key":"due_date","required":true,"description":"Original due date"},{"key":"days_overdue_text","required":true,"description":"Pre-computed text like 3 days"},{"key":"late_fee","required":false,"description":"Late fee amount"},{"key":"total_due","required":false,"description":"Total amount due including late fee"}]'::jsonb
),

-- ============================================================
-- 13. payment_received
-- ============================================================
(
  'payment_received',
  'payment',
  'Confirmation sent to tenant when a payment is received',
  'team',
  'Payment Received - Thank You! - Alpaca Playhouse',
  $html$
<h2>Payment Received</h2>
<p>Hi {{first_name}},</p>
<p>We've received your payment of <strong>${{amount}}</strong>{{#if period}} for <strong>{{period}}</strong>{{/if}}.</p>
<p>Thank you for your prompt payment!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Payment Received

Hi {{first_name}},

We've received your payment of ${{amount}}{{#if period}} for {{period}}{{/if}}.

Thank you for your prompt payment!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Tenant first name"},{"key":"amount","required":true,"description":"Payment amount"},{"key":"period","required":false,"description":"Payment period (e.g. February 2026)"}]'::jsonb
),

-- ============================================================
-- 14. event_invitation
-- ============================================================
(
  'event_invitation',
  'invitation',
  'Event invitation sent to potential attendees',
  'team',
  'You''re Invited: {{event_name}} - Alpaca Playhouse',
  $html$
<h2>You're Invited!</h2>
<p>Hi {{first_name}},</p>
<p>You're invited to <strong>{{event_name}}</strong> at Alpaca Playhouse!</p>
<table style="border-collapse: collapse; width: 100%; max-width: 400px; margin: 20px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_date}}</td></tr>
  {{#if event_time}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_time}}</td></tr>{{/if}}
  {{#if location}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Location:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{location}}</td></tr>{{/if}}
</table>
{{#if description}}<p>{{description}}</p>{{/if}}
{{#if rsvp_link}}<p><a href="{{rsvp_link}}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">RSVP Now</a></p>{{/if}}
<p>We hope to see you there!</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$You're Invited!

Hi {{first_name}},

You're invited to {{event_name}} at Alpaca Playhouse!

Date: {{event_date}}
{{#if event_time}}Time: {{event_time}}{{/if}}
{{#if location}}Location: {{location}}{{/if}}

{{#if description}}{{description}}{{/if}}

{{#if rsvp_link}}RSVP: {{rsvp_link}}{{/if}}

We hope to see you there!

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Recipient first name"},{"key":"event_name","required":true,"description":"Event name"},{"key":"event_date","required":true,"description":"Event date"},{"key":"event_time","required":false,"description":"Event time"},{"key":"location","required":false,"description":"Event location"},{"key":"description","required":false,"description":"Event description"},{"key":"rsvp_link","required":false,"description":"RSVP URL"}]'::jsonb
),

-- ============================================================
-- 15. general_invitation
-- ============================================================
(
  'general_invitation',
  'invitation',
  'General purpose invitation email with customizable content',
  'team',
  '{{custom_subject}}',
  $html$
<p>Hi {{first_name}},</p>
{{#if message_html}}{{message_html}}{{else}}<p>You have been invited!</p>{{/if}}
{{#if action_url}}<p><a href="{{action_url}}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">{{action_text}}</a></p>{{/if}}
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Hi {{first_name}},

{{#if message_text}}{{message_text}}{{else}}You have been invited!{{/if}}

{{#if action_url}}{{action_text}}: {{action_url}}{{/if}}

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true,"description":"Recipient first name"},{"key":"custom_subject","required":true,"description":"Email subject line"},{"key":"message_html","required":false,"description":"HTML message body"},{"key":"message_text","required":false,"description":"Plain text message body"},{"key":"action_url","required":false,"description":"CTA button URL"},{"key":"action_text","required":false,"description":"CTA button text (defaults to Learn More)"}]'::jsonb
),

-- ============================================================
-- 16. staff_invitation
-- ============================================================
(
  'staff_invitation',
  'invitation',
  'Invitation sent to new staff/admin users to set up their account',
  'team',
  'You''re Invited to GenAlpaca Spaces',
  $html$
<h2>You've Been Invited!</h2>
<p>Hi,</p>
<p>You've been invited to access <strong>GenAlpaca Spaces</strong> as {{role_label}}.</p>
<p>You will have {{role_description}}.</p>
<h3>Getting Started</h3>
<ol>
  <li>Click the button below to go to the login page</li>
  <li>Sign in with Google using this email address (<strong>{{email}}</strong>)</li>
</ol>
<p>Your access has already been pre-approved, so you'll have immediate access once you sign in.</p>
<p style="margin: 30px 0;">
  <a href="{{login_url}}" style="background: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Sign In to GenAlpaca</a>
</p>
<p style="color: #666; font-size: 14px;">If you have any questions, reply to this email.</p>
<p>Best regards,<br>GenAlpaca Team</p>
$html$,
  $text$You've Been Invited!

Hi,

You've been invited to access GenAlpaca Spaces as {{role_label}}.

You will have {{role_description}}.

Getting Started:
1. Go to: {{login_url}}
2. Click "Sign in with Google" using this email address ({{email}})

Your access has already been pre-approved, so you'll have immediate access once you sign in.

If you have any questions, reply to this email.

Best regards,
GenAlpaca Team$text$,
  '[{"key":"email","required":true,"description":"Invitee email address"},{"key":"login_url","required":true,"description":"Login page URL"},{"key":"role_label","required":true,"description":"Pre-computed role label (e.g. an admin, a staff member)"},{"key":"role_description","required":true,"description":"Pre-computed role description"}]'::jsonb
),

-- ============================================================
-- 17. invite_to_apply
-- ============================================================
(
  'invite_to_apply',
  'rental',
  'Invitation sent to prospective tenants to complete their rental application',
  'team',
  'You''re Invited to Apply - Alpaca Playhouse',
  $html$
<h2>Great news, {{first_name}}!</h2>
<p>Thank you for your interest in joining the Alpaca Playhouse community. We've reviewed your inquiry and feel you would be a great fit for the Alpaca Playhouse community. We would love to invite you to apply for a rental space when you are ready and have clarity on your dates.</p>
<p>Please review the <a href="https://rsonnad.github.io/alpacapps/spaces/">available spaces here</a> or click the button below to finish your application.</p>
<p style="margin: 30px 0; text-align: center;">
  <a href="{{continue_url}}" style="background: #3b8132; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 16px;">Complete Your Application</a>
</p>
<p>We are excited by the potential to have you join us at the Alpaca Playhouse. Where our mission is to let your Alpaca Dreams run free. Our goal is to redefine your idea of what an Alpaca Playhouse can be. When it comes to selecting an Alpaca Playhouse, we feel no one need settle.</p>
<p>Yours,<br>The Alpaca Playhouse Community Team</p>
$html$,
  $text$Great news, {{first_name}}!

Thank you for your interest in joining the Alpaca Playhouse community. We've reviewed your inquiry and feel you would be a great fit for the Alpaca Playhouse community. We would love to invite you to apply for a rental space when you are ready and have clarity on your dates.

Please review the available spaces here: https://rsonnad.github.io/alpacapps/spaces/

Or complete your application here: {{continue_url}}

We are excited by the potential to have you join us at the Alpaca Playhouse. Where our mission is to let your Alpaca Dreams run free. Our goal is to redefine your idea of what an Alpaca Playhouse can be. When it comes to selecting an Alpaca Playhouse, we feel no one need settle.

Yours,
The Alpaca Playhouse Community Team$text$,
  '[{"key":"first_name","required":true,"description":"Applicant first name"},{"key":"continue_url","required":true,"description":"URL to continue/complete the application"}]'::jsonb
),

-- ============================================================
-- 18. admin_event_request
-- ============================================================
(
  'admin_event_request',
  'admin',
  'Admin notification when a new event hosting request is submitted',
  'team',
  'New Event Request: {{event_name}} - {{event_date}}',
  $html$
<h2>New Event Hosting Request</h2>
<p>A new event hosting request has been submitted.</p>

<p style="margin: 20px 0;">
  <a href="https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#events" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">View in Events Pipeline</a>
</p>

<h3>Host Information</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{first_name}} {{last_name}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:{{email}}">{{email}}</a></td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:{{phone}}">{{phone}}</a></td></tr>
  {{#if organization_name}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Organization:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{organization_name}}</td></tr>{{/if}}
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Hosted Before:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{has_hosted_before_text}}</td></tr>
</table>

<h3>Event Details</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Event Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_name}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Event Type:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_type}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_date}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{event_start_time}} - {{event_end_time}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Expected Guests:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{expected_guests}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Ticketed Event:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{is_ticketed_text}}</td></tr>
</table>

<h3>Event Description</h3>
<p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{{event_description}}</p>

<h3>Staffing Contacts</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Setup:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{setup_staff_name}} - <a href="tel:{{setup_staff_phone}}">{{setup_staff_phone}}</a></td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Cleanup:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{cleanup_staff_name}} - <a href="tel:{{cleanup_staff_phone}}">{{cleanup_staff_phone}}</a></td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Parking:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{parking_manager_name}} - <a href="tel:{{parking_manager_phone}}">{{parking_manager_phone}}</a></td></tr>
</table>

{{#if marketing_materials_link}}<p><strong>Marketing Materials:</strong> <a href="{{marketing_materials_link}}">{{marketing_materials_link}}</a></p>{{/if}}
{{#if special_requests}}<h3>Special Requests</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{{special_requests}}</p>{{/if}}

<p style="margin-top: 20px; color: #666; font-size: 14px;">All required acknowledgments have been confirmed by the applicant.</p>
$html$,
  $text$New Event Hosting Request

View in Events Pipeline: https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#events

HOST INFORMATION
Name: {{first_name}} {{last_name}}
Email: {{email}}
Phone: {{phone}}
{{#if organization_name}}Organization: {{organization_name}}{{/if}}
Hosted Before: {{has_hosted_before_text}}

EVENT DETAILS
Event Name: {{event_name}}
Event Type: {{event_type}}
Date: {{event_date}}
Time: {{event_start_time}} - {{event_end_time}}
Expected Guests: {{expected_guests}}
Ticketed Event: {{is_ticketed_text}}

EVENT DESCRIPTION
{{event_description}}

STAFFING CONTACTS
Setup: {{setup_staff_name}} - {{setup_staff_phone}}
Cleanup: {{cleanup_staff_name}} - {{cleanup_staff_phone}}
Parking: {{parking_manager_name}} - {{parking_manager_phone}}

{{#if marketing_materials_link}}Marketing Materials: {{marketing_materials_link}}{{/if}}
{{#if special_requests}}SPECIAL REQUESTS
{{special_requests}}{{/if}}

All required acknowledgments have been confirmed by the applicant.$text$,
  '[{"key":"first_name","required":true},{"key":"last_name","required":true},{"key":"email","required":true},{"key":"phone","required":true},{"key":"event_name","required":true},{"key":"event_type","required":true},{"key":"event_date","required":true},{"key":"event_start_time","required":true},{"key":"event_end_time","required":true},{"key":"expected_guests","required":true},{"key":"event_description","required":true},{"key":"setup_staff_name","required":true},{"key":"setup_staff_phone","required":true},{"key":"cleanup_staff_name","required":true},{"key":"cleanup_staff_phone","required":true},{"key":"parking_manager_name","required":true},{"key":"parking_manager_phone","required":true},{"key":"has_hosted_before_text","required":true,"description":"Pre-computed Yes/No"},{"key":"is_ticketed_text","required":true,"description":"Pre-computed Yes/No"},{"key":"organization_name","required":false},{"key":"marketing_materials_link","required":false},{"key":"special_requests","required":false}]'::jsonb
),

-- ============================================================
-- 19. admin_rental_application
-- ============================================================
(
  'admin_rental_application',
  'admin',
  'Admin notification when a new rental application is submitted',
  'team',
  'New Rental Application: {{first_name}} {{last_name}}{{#if space_name}} for {{space_name}}{{/if}}',
  $html$
<h2>New Rental Application</h2>
<p>A new rental application has been submitted.</p>

<p style="margin: 20px 0;">
  <a href="https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#rentals" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">View in Rentals Pipeline</a>
</p>

<h3>Applicant Information</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{first_name}} {{last_name}}</td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:{{email}}">{{email}}</a></td></tr>
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:{{phone}}">{{phone}}</a></td></tr>
  {{#if current_location}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Current Location:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{current_location}}</td></tr>{{/if}}
</table>

<h3>Rental Details</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  {{#if space_name}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Space:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{space_name}}</td></tr>{{/if}}
  {{#if desired_move_in}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Desired Move-in:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{desired_move_in}}</td></tr>{{/if}}
  {{#if desired_lease_length}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Lease Length:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{desired_lease_length}}</td></tr>{{/if}}
  {{#if budget}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Budget:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{budget}}/month</td></tr>{{/if}}
</table>

{{#if employment_status}}
<h3>Employment</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{employment_status}}</td></tr>
  {{#if occupation}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Occupation:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{occupation}}</td></tr>{{/if}}
  {{#if employer}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Employer:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{employer}}</td></tr>{{/if}}
  {{#if monthly_income}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Monthly Income:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${{monthly_income}}</td></tr>{{/if}}
</table>
{{/if}}

{{#if about_yourself}}<h3>About Themselves</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{{about_yourself}}</p>{{/if}}
{{#if why_interested}}<h3>Why Interested</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{{why_interested}}</p>{{/if}}
{{#if additional_notes}}<h3>Additional Notes</h3><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{{additional_notes}}</p>{{/if}}

{{#if emergency_contact_name}}
<h3>Emergency Contact</h3>
<table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 10px 0;">
  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 150px;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{emergency_contact_name}}</td></tr>
  {{#if emergency_contact_phone}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:{{emergency_contact_phone}}">{{emergency_contact_phone}}</a></td></tr>{{/if}}
  {{#if emergency_contact_relationship}}<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Relationship:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{emergency_contact_relationship}}</td></tr>{{/if}}
</table>
{{/if}}
$html$,
  $text$New Rental Application

View in Rentals Pipeline: https://rsonnad.github.io/alpacapps/spaces/admin/manage.html#rentals

APPLICANT INFORMATION
Name: {{first_name}} {{last_name}}
Email: {{email}}
Phone: {{phone}}
{{#if current_location}}Current Location: {{current_location}}{{/if}}

RENTAL DETAILS
{{#if space_name}}Space: {{space_name}}{{/if}}
{{#if desired_move_in}}Desired Move-in: {{desired_move_in}}{{/if}}
{{#if desired_lease_length}}Lease Length: {{desired_lease_length}}{{/if}}
{{#if budget}}Budget: ${{budget}}/month{{/if}}

{{#if employment_status}}EMPLOYMENT
Status: {{employment_status}}
{{#if occupation}}Occupation: {{occupation}}{{/if}}
{{#if employer}}Employer: {{employer}}{{/if}}
{{#if monthly_income}}Monthly Income: ${{monthly_income}}{{/if}}{{/if}}

{{#if about_yourself}}ABOUT THEMSELVES
{{about_yourself}}{{/if}}
{{#if why_interested}}WHY INTERESTED
{{why_interested}}{{/if}}
{{#if additional_notes}}ADDITIONAL NOTES
{{additional_notes}}{{/if}}

{{#if emergency_contact_name}}EMERGENCY CONTACT
Name: {{emergency_contact_name}}
{{#if emergency_contact_phone}}Phone: {{emergency_contact_phone}}{{/if}}
{{#if emergency_contact_relationship}}Relationship: {{emergency_contact_relationship}}{{/if}}{{/if}}$text$,
  '[{"key":"first_name","required":true},{"key":"last_name","required":true},{"key":"email","required":true},{"key":"phone","required":true},{"key":"space_name","required":false},{"key":"current_location","required":false},{"key":"desired_move_in","required":false},{"key":"desired_lease_length","required":false},{"key":"budget","required":false},{"key":"employment_status","required":false},{"key":"occupation","required":false},{"key":"employer","required":false},{"key":"monthly_income","required":false},{"key":"about_yourself","required":false},{"key":"why_interested","required":false},{"key":"additional_notes","required":false},{"key":"emergency_contact_name","required":false},{"key":"emergency_contact_phone","required":false},{"key":"emergency_contact_relationship","required":false}]'::jsonb
),

-- ============================================================
-- 20. faq_unanswered
-- ============================================================
(
  'faq_unanswered',
  'admin',
  'Admin notification when a visitor asks a question the AI could not answer',
  'auto',
  'New Question Needs an Answer - Alpaca Playhouse',
  $html$
<h2>New Unanswered Question</h2>
<p>Someone asked a question that our AI assistant couldn't confidently answer:</p>
<div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
  <p style="margin: 0; font-style: italic;">"{{question}}"</p>
</div>
{{#if user_email}}<p><strong>User email for follow-up:</strong> <a href="mailto:{{user_email}}">{{user_email}}</a></p>{{/if}}
<p>Add an answer to improve our knowledge base:</p>
<p style="margin: 20px 0;">
  <a href="{{faq_admin_url}}" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">Answer This Question</a>
</p>
<p style="color: #666; font-size: 14px;">After answering, remember to recompile the context so future visitors get better responses.</p>
$html$,
  $text$New Unanswered Question

Someone asked a question that our AI assistant couldn't confidently answer:

"{{question}}"

{{#if user_email}}User email for follow-up: {{user_email}}{{/if}}

Add an answer to improve our knowledge base:
{{faq_admin_url}}

After answering, remember to recompile the context so future visitors get better responses.$text$,
  '[{"key":"question","required":true,"description":"The unanswered question"},{"key":"faq_admin_url","required":true,"description":"URL to FAQ admin page"},{"key":"user_email","required":false,"description":"Email of the person who asked"}]'::jsonb
),

-- ============================================================
-- 21. contact_form
-- ============================================================
(
  'contact_form',
  'admin',
  'Admin notification when a website contact form is submitted',
  'team',
  '[Website Contact] {{contact_subject}}',
  $html$
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #333; margin-bottom: 4px;">{{name}} submitted a message from alpacaplayhouse.com</h2>
  <p style="color: #888; font-size: 13px; margin-top: 0;">{{contact_subject}}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; width: 80px; vertical-align: top;">Name</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{name}}</td></tr>
    {{#if email}}<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Email</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="mailto:{{email}}" style="color: #2563eb;">{{email}}</a></td></tr>{{/if}}
    {{#if phone}}<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Phone</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="tel:{{phone}}" style="color: #2563eb;">{{phone}}</a></td></tr>{{/if}}
  </table>
  {{#if message}}
  <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 16px 0; white-space: pre-wrap; line-height: 1.5; color: #333;">{{message}}</div>
  {{/if}}
  {{#if email}}<p style="margin-top: 20px;"><a href="mailto:{{email}}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 14px;">Reply to {{name}}</a></p>{{/if}}
</div>
$html$,
  $text${{name}} submitted a message from alpacaplayhouse.com

Name: {{name}}
Email: {{email}}
Phone: {{phone}}
Subject: {{contact_subject}}

Message:
{{message}}$text$,
  '[{"key":"name","required":true,"description":"Sender name"},{"key":"contact_subject","required":true,"description":"Message subject (pre-computed, defaults to General Inquiry)"},{"key":"email","required":false},{"key":"phone","required":false},{"key":"message","required":false}]'::jsonb
),

-- ============================================================
-- 22. community_fit_inquiry
-- ============================================================
(
  'community_fit_inquiry',
  'admin',
  'Admin notification when a community fit inquiry form is submitted',
  'team',
  '[Community Fit] {{name}}',
  $html$
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #333; margin-bottom: 4px;">{{name}} submitted an inquiry from alpacaplayhouse.com</h2>
  <p style="color: #888; font-size: 13px; margin-top: 0;">Community Fit Inquiry</p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; width: 110px; vertical-align: top;">Name</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{name}}</td></tr>
    {{#if email}}<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Email</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="mailto:{{email}}" style="color: #2563eb;">{{email}}</a></td></tr>{{/if}}
    {{#if phone}}<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Phone</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;"><a href="tel:{{phone}}" style="color: #2563eb;">{{phone}}</a></td></tr>{{/if}}
    {{#if dob}}<tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">DOB</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{dob}}</td></tr>{{/if}}
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Accommodation</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{accommodation}}</td></tr>
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Timeframe</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{timeframe}}</td></tr>
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Volunteer</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{volunteer}}</td></tr>
    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #888; vertical-align: top;">Referral</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{{referral}}</td></tr>
  </table>

  {{#if coliving_experience}}
  <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Co-living Experience</h3>
  <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">{{coliving_experience}}</div>
  {{/if}}

  {{#if life_focus}}
  <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Life Focus / Goals</h3>
  <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">{{life_focus}}</div>
  {{/if}}

  {{#if visiting_guide}}
  <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Visiting Guide Response</h3>
  <div style="background: #f8f9fa; padding: 14px 16px; border-radius: 8px; line-height: 1.5; color: #333;">{{visiting_guide}}</div>
  {{/if}}

  {{#if photo_url}}
  <h3 style="color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 8px;">Photo</h3>
  <img src="{{photo_url}}" style="max-width: 200px; border-radius: 8px; border: 1px solid #eee;" />
  {{/if}}

  {{#if email}}<p style="margin-top: 24px;"><a href="mailto:{{email}}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 14px;">Reply to {{name}}</a></p>{{/if}}
</div>
$html$,
  $text${{name}} submitted an inquiry from alpacaplayhouse.com

Name: {{name}}
Email: {{email}}
Phone: {{phone}}
DOB: {{dob}}
Accommodation: {{accommodation}}
Timeframe: {{timeframe}}
Volunteer: {{volunteer}}
Referral: {{referral}}

Co-living Experience:
{{coliving_experience}}

Life Focus / Goals:
{{life_focus}}

Visiting Guide Response:
{{visiting_guide}}

{{#if photo_url}}Photo: {{photo_url}}{{/if}}$text$,
  '[{"key":"name","required":true},{"key":"email","required":false},{"key":"phone","required":false},{"key":"dob","required":false},{"key":"accommodation","required":false},{"key":"timeframe","required":false},{"key":"volunteer","required":false},{"key":"referral","required":false},{"key":"coliving_experience","required":false},{"key":"life_focus","required":false},{"key":"visiting_guide","required":false},{"key":"photo_url","required":false}]'::jsonb
),

-- ============================================================
-- 23. bug_report_received
-- ============================================================
(
  'bug_report_received',
  'system',
  'Sent to reporter when their bug report is received',
  'auto',
  'Bug by {{reporter_name}}: {{description_short}}',
  $html$
<h2 style="color: #2980b9;">Bug Report Received</h2>
<p>Hi {{reporter_name}},</p>
<p>We've received your bug report and our automated system is working on a fix right now.</p>

<h3>Your Report</h3>
<p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">{{description}}</p>
{{#if page_url}}<p><strong>Page:</strong> <a href="{{page_url}}">{{page_url}}</a></p>{{/if}}

{{#if screenshot_url}}
<h3>Your Screenshot</h3>
<p><img src="{{screenshot_url}}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
{{/if}}

<p style="color: #666; font-size: 13px; margin-top: 20px;">You'll receive another email when the fix is deployed or if we need to escalate to a human.</p>
$html$,
  $text$Bug Report Received

Hi {{reporter_name}},

We've received your bug report and our automated system is working on a fix right now.

YOUR REPORT:
{{description}}
{{#if page_url}}Page: {{page_url}}{{/if}}

You'll receive another email when the fix is deployed or if we need to escalate to a human.$text$,
  '[{"key":"reporter_name","required":true,"description":"Bug reporter name"},{"key":"description","required":true,"description":"Full bug description"},{"key":"description_short","required":false,"description":"Truncated description for subject (50 chars)"},{"key":"page_url","required":false},{"key":"screenshot_url","required":false}]'::jsonb
),

-- ============================================================
-- 24. bug_report_fixed
-- ============================================================
(
  'bug_report_fixed',
  'system',
  'Sent to reporter when their bug is automatically fixed and deployed',
  'auto',
  'Re: Bug by {{reporter_name}}: {{description_short}}',
  $html$
<h2 style="color: #27ae60;">Bug Fixed!</h2>
<p>Hi {{reporter_name}},</p>
<p>Your bug report has been automatically fixed and deployed.</p>

<h3>Your Report</h3>
<p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">{{description}}</p>
{{#if page_url}}<p><strong>Page:</strong> <a href="{{page_url}}">{{page_url}}</a></p>{{/if}}

{{#if screenshot_url}}
<h3>Your Screenshot</h3>
<p><img src="{{screenshot_url}}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
{{/if}}

<h3>What Was Fixed</h3>
<p style="background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60;">{{fix_summary}}</p>

{{#if fix_commit_sha}}<p><strong>Commit:</strong> <a href="https://github.com/rsonnad/alpacapps/commit/{{fix_commit_sha}}">{{fix_commit_sha_short}}</a></p>{{/if}}

<p>The fix is live now. Please verify at:<br>
<a href="{{page_url}}" style="background: #27ae60; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 8px;">View Live Site</a></p>

<p style="color: #666; font-size: 13px; margin-top: 20px;">If the fix doesn't look right, submit another bug report and we'll take another look.</p>
$html$,
  $text$Bug Fixed!

Hi {{reporter_name}},

Your bug report has been automatically fixed and deployed.

YOUR REPORT:
{{description}}
{{#if page_url}}Page: {{page_url}}{{/if}}

WHAT WAS FIXED:
{{fix_summary}}

{{#if fix_commit_sha}}Commit: https://github.com/rsonnad/alpacapps/commit/{{fix_commit_sha}}{{/if}}

The fix is live now. Please verify at:
{{page_url}}

If the fix doesn't look right, submit another bug report and we'll take another look.$text$,
  '[{"key":"reporter_name","required":true},{"key":"description","required":true},{"key":"description_short","required":false,"description":"Truncated description for subject"},{"key":"page_url","required":true},{"key":"screenshot_url","required":false},{"key":"fix_summary","required":false,"description":"Summary of the fix"},{"key":"fix_commit_sha","required":false,"description":"Full commit SHA"},{"key":"fix_commit_sha_short","required":false,"description":"Short commit SHA (7 chars)"}]'::jsonb
),

-- ============================================================
-- 25. bug_report_failed
-- ============================================================
(
  'bug_report_failed',
  'system',
  'Sent to reporter when the automated bug fix was unsuccessful',
  'auto',
  'Re: Bug by {{reporter_name}}: {{description_short}}',
  $html$
<h2 style="color: #e67e22;">Bug Report Update</h2>
<p>Hi {{reporter_name}},</p>
<p>We received your bug report but the automated fix was not successful. A human will take a look.</p>

<h3>Your Report</h3>
<p style="background: #f5f5f5; padding: 15px; border-radius: 8px;">{{description}}</p>
{{#if page_url}}<p><strong>Page:</strong> <a href="{{page_url}}">{{page_url}}</a></p>{{/if}}

{{#if screenshot_url}}
<h3>Your Screenshot</h3>
<p><img src="{{screenshot_url}}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Bug screenshot"></p>
{{/if}}

{{#if error_message}}
<h3>What Went Wrong</h3>
<p style="background: #fef3e2; padding: 15px; border-radius: 8px; border-left: 4px solid #e67e22;">{{error_message}}</p>
{{/if}}

<p>We'll review this manually and follow up. Thank you for reporting!</p>
$html$,
  $text$Bug Report Update

Hi {{reporter_name}},

We received your bug report but the automated fix was not successful. A human will take a look.

YOUR REPORT:
{{description}}
{{#if page_url}}Page: {{page_url}}{{/if}}

{{#if error_message}}WHAT WENT WRONG:
{{error_message}}{{/if}}

We'll review this manually and follow up. Thank you for reporting!$text$,
  '[{"key":"reporter_name","required":true},{"key":"description","required":true},{"key":"description_short","required":false},{"key":"page_url","required":false},{"key":"screenshot_url","required":false},{"key":"error_message","required":false}]'::jsonb
),

-- ============================================================
-- 26. bug_report_verified
-- ============================================================
(
  'bug_report_verified',
  'system',
  'Sent to reporter with a verification screenshot after a bug fix is deployed',
  'auto',
  'Re: Bug by {{reporter_name}}: {{description_short}}',
  $html$
<h2 style="color: #27ae60;">Screenshot of the Fix</h2>
<p>Hi {{reporter_name}},</p>
<p>Here's a screenshot of the page after the fix was deployed:</p>

{{#if verification_screenshot_url}}
<p><img src="{{verification_screenshot_url}}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 4px;" alt="Screenshot after fix"></p>
{{/if}}

{{#if page_url}}<p><strong>Page:</strong> <a href="{{page_url}}">{{page_url}}</a></p>{{/if}}

{{#if fix_summary}}
<h3>What Was Fixed</h3>
<p style="background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60;">{{fix_summary}}</p>
{{/if}}

<p style="color: #666; font-size: 13px; margin-top: 20px;">If the fix doesn't look right, submit another bug report and we'll take another look.</p>
$html$,
  $text$Screenshot of the Fix

Hi {{reporter_name}},

Here's a screenshot of the page after the fix was deployed.

{{#if page_url}}Page: {{page_url}}{{/if}}

{{#if fix_summary}}WHAT WAS FIXED:
{{fix_summary}}{{/if}}

If the fix doesn't look right, submit another bug report and we'll take another look.$text$,
  '[{"key":"reporter_name","required":true},{"key":"description_short","required":false},{"key":"verification_screenshot_url","required":false},{"key":"page_url","required":false},{"key":"fix_summary","required":false}]'::jsonb
),

-- ============================================================
-- 27. dl_upload_link
-- ============================================================
(
  'dl_upload_link',
  'identity',
  'Sent to applicant/associate with a secure link to upload their driver''s license',
  'auto',
  'Action Required: Identity Verification - Alpaca Playhouse',
  $html$
<h2>Identity Verification Required</h2>
<p>Hi {{first_name}},</p>
<p>As part of your rental application, we need to verify your identity. Please upload a clear photo of your driver's license or state ID or other valid government ID.</p>
<div style="text-align: center; margin: 30px 0;">
  <a href="{{upload_url}}" style="background: #3d8b7a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.1em; display: inline-block;">Upload Your ID</a>
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
$html$,
  $text$Identity Verification Required

Hi {{first_name}},

As part of your rental application, we need to verify your identity. Please upload a clear photo of your driver's license or state ID or other valid government ID.

Upload your ID here: {{upload_url}}

This link will expire in 7 days. If you need a new link, please let us know.

Tips for a good photo:
- Use good lighting - avoid glare and shadows
- Make sure all text is readable
- Include the full card in the frame

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true},{"key":"upload_url","required":true,"description":"Secure tokenized upload URL"}]'::jsonb
),

-- ============================================================
-- 28. dl_verified
-- ============================================================
(
  'dl_verified',
  'identity',
  'Sent to applicant/associate when their identity is successfully verified',
  'auto',
  'Identity Verified - Alpaca Playhouse',
  $html$
<h2 style="color: #27ae60;">Identity Verified!</h2>
<p>Hi {{first_name}},</p>
<p>Your identity has been successfully verified. Thank you for completing this step!</p>
<p>We'll continue processing your rental application and will be in touch with next steps soon.</p>
<p>If you have any questions, feel free to reply to this email.</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Identity Verified!

Hi {{first_name}},

Your identity has been successfully verified. Thank you for completing this step!

We'll continue processing your rental application and will be in touch with next steps soon.

If you have any questions, feel free to reply to this email.

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true}]'::jsonb
),

-- ============================================================
-- 29. dl_mismatch
-- ============================================================
(
  'dl_mismatch',
  'identity',
  'Admin notification when an identity verification has a name mismatch',
  'auto',
  'Identity Verification Flagged: {{applicant_name}}',
  $html$
<h2 style="color: #e67e22;">Identity Verification Flagged</h2>
<p>An identity verification needs your review.</p>
<div style="background: #fef9e7; border-radius: 8px; padding: 15px; margin: 15px 0;">
  <table style="border-collapse: collapse; width: 100%;">
    <tr>
      <td style="padding: 6px 0;"><strong>Application Name:</strong></td>
      <td style="padding: 6px 0;">{{applicant_name}}</td>
    </tr>
    <tr>
      <td style="padding: 6px 0;"><strong>Name on ID:</strong></td>
      <td style="padding: 6px 0;">{{extracted_name}}</td>
    </tr>
    <tr>
      <td style="padding: 6px 0;"><strong>Match Score:</strong></td>
      <td style="padding: 6px 0;">{{match_score}}%</td>
    </tr>
    {{#if is_expired}}<tr><td style="padding: 6px 0;"><strong>Note:</strong></td><td style="padding: 6px 0; color: #c0392b;">ID appears to be expired</td></tr>{{/if}}
  </table>
</div>
<p><a href="{{admin_url}}" style="background: #3d8b7a; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Review in Admin</a></p>
$html$,
  $text$Identity Verification Flagged

An identity verification needs your review.

Application Name: {{applicant_name}}
Name on ID: {{extracted_name}}
Match Score: {{match_score}}%
{{#if is_expired}}Note: ID appears to be expired{{/if}}

Review in Admin: {{admin_url}}$text$,
  '[{"key":"applicant_name","required":true},{"key":"match_score","required":true},{"key":"admin_url","required":true},{"key":"extracted_name","required":false},{"key":"is_expired","required":false}]'::jsonb
),

-- ============================================================
-- 30. feature_review
-- ============================================================
(
  'feature_review',
  'system',
  'Admin notification when PAI Feature Builder completes a feature for review',
  'auto',
  'PAI Feature Review: {{description_short}}',
  $html$
<h2 style="color: #e67e22;">Feature Ready for Review</h2>
<p><strong>{{requester_name}}</strong> ({{requester_role}}) asked PAI to build:</p>
<p style="background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #e67e22;">{{description}}</p>

<h3>Build Summary</h3>
<p>{{build_summary}}</p>

{{#if files_created_str}}<p><strong>Files created:</strong> {{files_created_str}}</p>{{/if}}
{{#if files_modified_str}}<p><strong>Files modified:</strong> <span style="color: #e74c3c;">{{files_modified_str}}</span></p>{{/if}}
{{#if branch_name}}<p><strong>Branch:</strong> <code>{{branch_name}}</code></p>{{/if}}

<h3>Risk Assessment</h3>
<table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
  <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Reason</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">{{risk_reason}}</td></tr>
  <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Touches existing functionality</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">{{risk_touches_existing_text}}</td></tr>
  <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Could confuse users</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">{{risk_could_confuse_text}}</td></tr>
  <tr><td style="padding: 6px 12px; border: 1px solid #ddd;"><strong>Removes or changes features</strong></td><td style="padding: 6px 12px; border: 1px solid #ddd;">{{risk_removes_features_text}}</td></tr>
</table>

{{#if notes}}<p><strong>Notes:</strong> {{notes}}</p>{{/if}}

<div style="margin: 20px 0;">
  {{#if compare_url}}<a href="{{compare_url}}" style="background: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold; margin-right: 10px;">Review Changes on GitHub</a>{{/if}}
</div>

<p style="color: #666; font-size: 13px; margin-top: 20px;">
  <strong>To deploy:</strong> merge the branch to main, run bump-version.sh, push.<br>
  <strong>To reject:</strong> delete the branch on GitHub.
</p>
$html$,
  $text$PAI Feature Ready for Review

{{requester_name}} ({{requester_role}}) asked PAI to build:
{{description}}

BUILD SUMMARY:
{{build_summary}}

{{#if files_created_str}}Files created: {{files_created_str}}{{/if}}
{{#if files_modified_str}}Files modified: {{files_modified_str}}{{/if}}
{{#if branch_name}}Branch: {{branch_name}}{{/if}}

RISK ASSESSMENT:
- Reason: {{risk_reason}}
- Touches existing functionality: {{risk_touches_existing_text}}
- Could confuse users: {{risk_could_confuse_text}}
- Removes or changes features: {{risk_removes_features_text}}

{{#if notes}}Notes: {{notes}}{{/if}}

{{#if compare_url}}Review: {{compare_url}}{{/if}}

To deploy: merge the branch to main, run bump-version.sh, push.
To reject: delete the branch on GitHub.$text$,
  '[{"key":"requester_name","required":true},{"key":"requester_role","required":true},{"key":"description","required":true},{"key":"description_short","required":true,"description":"Truncated description for subject (60 chars)"},{"key":"build_summary","required":true},{"key":"files_created_str","required":false,"description":"Comma-separated list of created files"},{"key":"files_modified_str","required":false,"description":"Comma-separated list of modified files"},{"key":"branch_name","required":false},{"key":"compare_url","required":false,"description":"GitHub compare URL"},{"key":"risk_reason","required":false},{"key":"risk_touches_existing_text","required":false,"description":"Yes/No"},{"key":"risk_could_confuse_text","required":false,"description":"Yes/No"},{"key":"risk_removes_features_text","required":false,"description":"Yes/No"},{"key":"notes","required":false}]'::jsonb
),

-- ============================================================
-- 31. lease_signed_deposit_due (from signwell-webhook)
-- ============================================================
(
  'lease_signed_deposit_due',
  'rental',
  'Sent to tenant after both parties sign the lease, requesting reservation deposit',
  'team',
  'Lease Signed - Reservation Deposit Due - Alpaca Playhouse',
  $html$
<h2>Lease Signing Complete!</h2>
<p>Hi {{first_name}},</p>
<p>Congratulations! Your lease agreement for <strong>{{space_name}}</strong> has been successfully signed by both parties.</p>

<div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <h3 style="margin-top: 0; color: #3d8b7a;">Reservation Deposit Due</h3>
  <p>To secure your space, please submit your reservation deposit:</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
    <tr>
      <td style="padding: 8px 0;"><strong>Reservation Deposit:</strong></td>
      <td style="padding: 8px 0; text-align: right; font-size: 1.2em; font-weight: bold; color: #3d8b7a;">${{reservation_deposit}}</td>
    </tr>
  </table>
  <p style="font-size: 0.9em; color: #666; margin-bottom: 0;">This amount will be credited toward your first month's rent.</p>
</div>

<h3>Payment Options</h3>
<ul style="line-height: 1.8;">
  {{PAYMENT_METHODS_HTML}}
</ul>
<p><strong>Important:</strong> Please include your name and "Reservation Deposit" in the payment memo.</p>

<div style="background: #e5f4f1; border-left: 4px solid #3d8b7a; padding: 15px; margin: 20px 0;">
  <strong>Move-in Date:</strong> {{move_in_date}}<br>
  <strong>Monthly Rent:</strong> ${{monthly_rate}}/{{rate_term_display}}
</div>

<div style="background: #f0f7ff; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <h3 style="margin-top: 0; color: #3d8b7a;">Set Up Your Resident Profile</h3>
  <p>While you're here, take a minute to fill out your resident profile. This helps your housemates get to know you before you arrive!</p>
  <p style="margin-bottom: 0;"><a href="https://alpacaplayhouse.com/residents/profile.html" style="display: inline-block; background: #3d8b7a; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Complete Your Profile</a></p>
</div>

<p>Once we receive your reservation deposit, we'll send confirmation and prepare for your arrival.</p>
<p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Lease Signing Complete!

Hi {{first_name}},

Congratulations! Your lease agreement for {{space_name}} has been successfully signed by both parties.

RESERVATION DEPOSIT DUE
-----------------------
Reservation Deposit: ${{reservation_deposit}}

This amount will be credited toward your first month's rent.

PAYMENT OPTIONS
---------------
{{PAYMENT_METHODS_TEXT}}

Important: Please include your name and "Reservation Deposit" in the payment memo.

Move-in Date: {{move_in_date}}
Monthly Rent: ${{monthly_rate}}/{{rate_term_display}}

SET UP YOUR RESIDENT PROFILE
-----------------------------
Take a minute to fill out your resident profile -- it helps your housemates get to know you before you arrive!
https://alpacaplayhouse.com/residents/profile.html

Once we receive your reservation deposit, we'll send confirmation and prepare for your arrival.

Questions? Reply to this email or contact us at team@alpacaplayhouse.com

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true},{"key":"space_name","required":true},{"key":"reservation_deposit","required":true},{"key":"move_in_date","required":true},{"key":"monthly_rate","required":true},{"key":"rate_term_display","required":true,"description":"Pre-computed: month, week, or night"},{"key":"PAYMENT_METHODS_HTML","required":true,"description":"Pre-built HTML list items of payment methods"},{"key":"PAYMENT_METHODS_TEXT","required":true,"description":"Pre-built text list of payment methods"}]'::jsonb
),

-- ============================================================
-- 32. event_agreement_signed (from signwell-webhook)
-- ============================================================
(
  'event_agreement_signed',
  'event',
  'Sent to event host after both parties sign the event agreement',
  'team',
  'Event Agreement Signed - Outstanding Fees Due Before Event - Alpaca Playhouse',
  $html$
<h2>Event Agreement Signed!</h2>
<p>Hi {{first_name}},</p>
<p>Congratulations! Your event agreement for <strong>{{event_name}}</strong> has been successfully signed by both parties.</p>

<div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <h3 style="margin-top: 0; color: #3d8b7a;">Outstanding Fees Due 7 Days Before Event</h3>
  <p>The following fees must be paid at least <strong>7 days before your event</strong>:</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
    <tr>
      <td style="padding: 8px 0;"><strong>Cleaning Deposit:</strong></td>
      <td style="padding: 8px 0; text-align: right; font-size: 1.1em; font-weight: bold; color: #3d8b7a;">${{cleaning_deposit}}</td>
    </tr>
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 8px 0;"><strong>Rental Fee:</strong></td>
      <td style="padding: 8px 0; text-align: right; font-size: 1.1em; font-weight: bold; color: #3d8b7a;">${{rental_fee}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0;"><strong>Due By:</strong></td>
      <td style="padding: 8px 0; text-align: right; color: #e07a5f; font-weight: bold;">{{payment_due_date}}</td>
    </tr>
  </table>
  <p style="font-size: 0.9em; color: #666; margin-top: 10px; margin-bottom: 0;">The cleaning deposit is fully refundable after your event, provided the venue is cleaned per the agreement. We'll send a reminder 10 days before your event.</p>
</div>

<h3>Payment Options</h3>
<ul style="line-height: 1.8;">
  {{PAYMENT_METHODS_HTML}}
</ul>
<p><strong>Important:</strong> Please include your name and "{{event_name}}" in the payment memo.</p>

<div style="background: #e5f4f1; border-left: 4px solid #3d8b7a; padding: 15px; margin: 20px 0;">
  <strong>Event:</strong> {{event_name}}<br>
  <strong>Date:</strong> {{event_date}}<br>
  {{#if event_time}}<strong>Time:</strong> {{event_time}}{{/if}}
</div>

<p><strong>Remember:</strong></p>
<ul>
  <li>Setup crew must arrive 90 minutes before your event</li>
  <li>Direct attendees to <a href="https://alpacaplayhouse.com/visiting">alpacaplayhouse.com/visiting</a> for directions (do NOT post the address publicly)</li>
  <li>Cleanup must be completed by 1:01pm the day after your event</li>
</ul>

<p>Once we receive the cleaning deposit and rental fee, your event is confirmed!</p>
<p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Event Agreement Signed!

Hi {{first_name}},

Congratulations! Your event agreement for {{event_name}} has been successfully signed by both parties.

OUTSTANDING FEES DUE 7 DAYS BEFORE EVENT
-----------------------------------------
Cleaning Deposit: ${{cleaning_deposit}}
Rental Fee: ${{rental_fee}}
Due By: {{payment_due_date}}

The cleaning deposit is fully refundable after your event, provided the venue is cleaned per the agreement. We'll send a reminder 10 days before your event.

PAYMENT OPTIONS
---------------
{{PAYMENT_METHODS_TEXT}}

Important: Please include your name and "{{event_name}}" in the payment memo.

EVENT DETAILS
-------------
Event: {{event_name}}
Date: {{event_date}}
{{#if event_time}}Time: {{event_time}}{{/if}}

REMINDERS
---------
- Setup crew must arrive 90 minutes before your event
- Direct attendees to alpacaplayhouse.com/visiting for directions (do NOT post the address publicly)
- Cleanup must be completed by 1:01pm the day after your event

Once we receive the cleaning deposit and rental fee, your event is confirmed!

Questions? Reply to this email or contact us at team@alpacaplayhouse.com

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true},{"key":"event_name","required":true},{"key":"event_date","required":true},{"key":"event_time","required":false},{"key":"rental_fee","required":true},{"key":"cleaning_deposit","required":true},{"key":"payment_due_date","required":true},{"key":"PAYMENT_METHODS_HTML","required":true},{"key":"PAYMENT_METHODS_TEXT","required":true}]'::jsonb
),

-- ============================================================
-- 33. vehicle_registration (from signwell-webhook)
-- ============================================================
(
  'vehicle_registration',
  'rental',
  'Sent to new tenant after lease signing to register their vehicle',
  'team',
  'Register Your Vehicle - Alpaca Playhouse',
  $html$
<h2>Register Your Vehicle</h2>
<p>Hi {{first_name}},</p>
<p>Now that your lease is signed, please take a moment to register your vehicle so we can manage parking and identify cars on the property.</p>

<div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <h3 style="margin-top: 0; color: #3d8b7a;">Add Your Vehicle</h3>
  <p>Visit your profile to add your vehicle details (make, model, color, license plate):</p>
  <p style="text-align: center; margin: 20px 0;">
    <a href="{{profile_url}}" style="display: inline-block; background: #3d8b7a; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.05em;">Register My Vehicle</a>
  </p>
</div>

<div style="background: #eef6ff; border-left: 4px solid #4a90d9; padding: 15px; margin: 20px 0;">
  <strong>Drive a Tesla?</strong><br>
  <p style="margin-bottom: 0;">If your vehicle is a Tesla, you can connect it to our smart charging system. This enables lock/unlock for charger rotation and lets you monitor your car's battery and charging status right from the resident dashboard. Just select "Tesla" as the make when registering, and you'll be guided through the quick connection process.</p>
</div>

<p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Register Your Vehicle

Hi {{first_name}},

Now that your lease is signed, please take a moment to register your vehicle so we can manage parking and identify cars on the property.

ADD YOUR VEHICLE
----------------
Visit your profile to add your vehicle details (make, model, color, license plate):

{{profile_url}}

DRIVE A TESLA?
--------------
If your vehicle is a Tesla, you can connect it to our smart charging system. This enables lock/unlock for charger rotation and lets you monitor your car's battery and charging status right from the resident dashboard. Just select "Tesla" as the make when registering, and you'll be guided through the quick connection process.

Questions? Reply to this email or contact us at team@alpacaplayhouse.com

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true},{"key":"profile_url","required":true,"description":"URL to the vehicles section of the profile page"}]'::jsonb
),

-- ============================================================
-- 34. payment_receipt_tenant (from resend-inbound-webhook)
-- ============================================================
(
  'payment_receipt_tenant',
  'payment',
  'Automated receipt sent to tenant after a Zelle payment is recorded',
  'noreply',
  'Payment Received -- ${{payment_amount}}',
  $html$
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#2d7d46;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:20px;">Payment Received</h2>
    <p style="margin:8px 0 0;opacity:0.9;">Thank you, {{tenant_name}}!</p>
  </div>
  <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <p>Your payment of <strong>${{payment_amount}}</strong> via Zelle has been recorded.</p>
    {{#if confirmation_number}}<p style="color:#999;font-size:0.85rem;">Confirmation #{{confirmation_number}}</p>{{/if}}
    {{#if balance_text}}<div style="background:#f8f9fa;border-radius:6px;padding:14px 16px;text-align:center;"><span style="font-size:1.2rem;font-weight:bold;">{{balance_text}}</span></div>{{/if}}
    <p style="color:#999;font-size:0.8rem;margin-top:20px;text-align:center;">GenAlpaca Residency - This is an automated receipt.</p>
  </div>
</div>
$html$,
  $text$Payment Received

Thank you, {{tenant_name}}!

Your payment of ${{payment_amount}} via Zelle has been recorded.
{{#if confirmation_number}}Confirmation #{{confirmation_number}}{{/if}}
{{#if balance_text}}{{balance_text}}{{/if}}

GenAlpaca Residency - This is an automated receipt.$text$,
  '[{"key":"tenant_name","required":true},{"key":"payment_amount","required":true},{"key":"confirmation_number","required":false},{"key":"balance_text","required":false,"description":"Pre-computed balance display text"}]'::jsonb
),

-- ============================================================
-- 35. payment_auto_recorded (from resend-inbound-webhook)
-- ============================================================
(
  'payment_auto_recorded',
  'payment_admin',
  'Admin notification when a Zelle payment is automatically recorded',
  'noreply',
  'Zelle Payment Recorded: ${{amount}} from {{sender_name}}',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:600px;">
  <h2 style="color:#2d7d46;">Payment Auto-Recorded</h2>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">${{amount}}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">From</td><td style="padding:8px;border-bottom:1px solid #eee;">{{sender_name}}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Matched To</td><td style="padding:8px;border-bottom:1px solid #eee;">{{person_name}}</td></tr>
    {{#if confirmation_number}}<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Confirmation #</td><td style="padding:8px;border-bottom:1px solid #eee;">{{confirmation_number}}</td></tr>{{/if}}
  </table>
  {{#if deposits_recorded}}<p>{{deposits_recorded}}</p>{{/if}}
  {{#if admin_url}}<p><a href="{{admin_url}}" style="display:inline-block;padding:10px 20px;background:#2d7d46;color:white;text-decoration:none;border-radius:4px;margin-top:10px;">View Application</a></p>{{/if}}
</div>
$html$,
  $text$Zelle Payment Auto-Recorded

Amount: ${{amount}}
From: {{sender_name}}
Matched To: {{person_name}}
{{#if confirmation_number}}Confirmation #{{confirmation_number}}{{/if}}
{{#if deposits_recorded}}{{deposits_recorded}}{{/if}}
{{#if admin_url}}View Application: {{admin_url}}{{/if}}$text$,
  '[{"key":"amount","required":true},{"key":"sender_name","required":true},{"key":"person_name","required":true},{"key":"confirmation_number","required":false},{"key":"deposits_recorded","required":false},{"key":"admin_url","required":false}]'::jsonb
),

-- ============================================================
-- 36. payment_confirm_request (from resend-inbound-webhook)
-- ============================================================
(
  'payment_confirm_request',
  'payment_admin',
  'Admin notification requesting confirmation of a Zelle payment match',
  'noreply',
  'Confirm Zelle Payment: ${{amount}} from {{sender_name}}',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:600px;">
  <h2 style="color:#e67e22;">Payment Needs Confirmation</h2>
  <p>A Zelle payment was received but the sender name didn't match anyone exactly. However, the <strong>amount matches</strong> an outstanding deposit.</p>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">${{amount}}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Zelle Sender</td><td style="padding:8px;border-bottom:1px solid #eee;">{{sender_name}}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Suggested Match</td><td style="padding:8px;border-bottom:1px solid #eee;">{{person_name}}</td></tr>
  </table>
  {{#if confirm_url}}<p style="margin-top:20px;"><a href="{{confirm_url}}" style="display:inline-block;padding:12px 30px;background:#2d7d46;color:white;text-decoration:none;border-radius:4px;font-size:16px;font-weight:bold;">Confirm Payment</a></p>{{/if}}
  <p style="color:#999;font-size:0.85rem;">This link expires in 7 days.</p>
</div>
$html$,
  $text$Payment Needs Confirmation

A Zelle payment was received but the sender name didn't match. Amount matches an outstanding deposit.

Amount: ${{amount}}
Zelle Sender: {{sender_name}}
Suggested Match: {{person_name}}

{{#if confirm_url}}Confirm: {{confirm_url}}{{/if}}

This link expires in 7 days.$text$,
  '[{"key":"amount","required":true},{"key":"sender_name","required":true},{"key":"person_name","required":true},{"key":"confirm_url","required":false}]'::jsonb
),

-- ============================================================
-- 37. payment_no_match (from resend-inbound-webhook)
-- ============================================================
(
  'payment_no_match',
  'payment_admin',
  'Admin notification when a Zelle payment cannot be matched to any tenant',
  'noreply',
  'Unmatched Zelle Payment: ${{amount}} from {{sender_name}}',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:600px;">
  <h2 style="color:#e74c3c;">Unmatched Payment</h2>
  <p>A Zelle payment was received but could not be matched to any tenant or outstanding deposit.</p>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;">${{amount}}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Zelle Sender</td><td style="padding:8px;border-bottom:1px solid #eee;">{{sender_name}}</td></tr>
    {{#if confirmation_number}}<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Confirmation #</td><td style="padding:8px;border-bottom:1px solid #eee;">{{confirmation_number}}</td></tr>{{/if}}
  </table>
  <p>Please record this payment manually in the admin panel.</p>
  {{#if pending_apps_html}}<p><strong>Current applications with pending deposits:</strong></p>{{pending_apps_html}}{{/if}}
</div>
$html$,
  $text$Unmatched Zelle Payment

A Zelle payment could not be matched to any tenant or outstanding deposit.

Amount: ${{amount}}
Zelle Sender: {{sender_name}}
{{#if confirmation_number}}Confirmation #{{confirmation_number}}{{/if}}

Please record this payment manually in the admin panel.$text$,
  '[{"key":"amount","required":true},{"key":"sender_name","required":true},{"key":"confirmation_number","required":false},{"key":"pending_apps_html","required":false,"description":"Pre-built HTML list of pending applications"}]'::jsonb
),

-- ============================================================
-- 38. payment_duplicate (from resend-inbound-webhook)
-- ============================================================
(
  'payment_duplicate',
  'payment_admin',
  'Admin notification when a duplicate Zelle payment confirmation is detected',
  'noreply',
  'Duplicate Zelle Payment Detected: ${{amount}} from {{sender_name}}',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:600px;">
  <h2 style="color:#e67e22;">Duplicate Payment</h2>
  <p>A Zelle payment notification was received but confirmation #{{confirmation_number}} was already recorded. No action taken.</p>
  {{#if admin_url}}<p><a href="{{admin_url}}">View Application</a></p>{{/if}}
</div>
$html$,
  $text$Duplicate Zelle Payment Detected

A Zelle payment notification was received but confirmation #{{confirmation_number}} was already recorded. No action taken.
{{#if admin_url}}View Application: {{admin_url}}{{/if}}$text$,
  '[{"key":"amount","required":true},{"key":"sender_name","required":true},{"key":"confirmation_number","required":true},{"key":"admin_url","required":false}]'::jsonb
),

-- ============================================================
-- 39. payment_unparseable (from resend-inbound-webhook)
-- ============================================================
(
  'payment_unparseable',
  'payment_admin',
  'Admin notification when a payments@ email cannot be parsed as a Zelle payment',
  'noreply',
  'Unrecognized Payment Email',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:600px;">
  <h2 style="color:#999;">Unrecognized Payment Email</h2>
  <p>An email was sent to payments@ but could not be parsed as a Zelle payment. It has been forwarded for manual review.</p>
  {{#if from_address}}<p><strong>From:</strong> {{from_address}}</p>{{/if}}
  {{#if subject}}<p><strong>Subject:</strong> {{subject}}</p>{{/if}}
</div>
$html$,
  $text$Unrecognized Payment Email

An email was sent to payments@ but could not be parsed as a Zelle payment. It has been forwarded for manual review.
{{#if from_address}}From: {{from_address}}{{/if}}
{{#if subject}}Subject: {{subject}}{{/if}}$text$,
  '[{"key":"from_address","required":false},{"key":"subject","required":false}]'::jsonb
),

-- ============================================================
-- 40. event_payment_reminder (from event-payment-reminder)
-- ============================================================
(
  'event_payment_reminder',
  'event',
  'Payment reminder sent 10 days before an event with outstanding fees',
  'team',
  'Payment Due for {{event_name}} - Alpaca Playhouse',
  $html$
<h2>Payment Reminder - Your Event is Coming Up!</h2>
<p>Hi {{first_name}},</p>
<p>This is a friendly reminder that your event <strong>{{event_name}}</strong> is <strong>10 days away</strong>! We're excited to host you.</p>

<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <h3 style="margin-top: 0; color: #856404;">Outstanding Fees - Due in 3 Days</h3>
  <p>The following fees must be received by <strong>{{payment_due_date}}</strong> (7 days before your event):</p>
  <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
    {{ITEMS_HTML}}
    <tr style="border-top: 2px solid #ddd;">
      <td style="padding: 8px 0;"><strong>Total Due:</strong></td>
      <td style="padding: 8px 0; text-align: right; font-size: 1.3em; font-weight: bold; color: #3d8b7a;">${{total_outstanding}}</td>
    </tr>
  </table>
</div>

<h3>Payment Options</h3>
<ul style="line-height: 1.8;">
  {{PAYMENT_METHODS_HTML}}
</ul>
<p><strong>Important:</strong> Please include your name and "{{event_name}}" in the payment memo.</p>

<div style="background: #e5f4f1; border-left: 4px solid #3d8b7a; padding: 15px; margin: 20px 0;">
  <strong>Event:</strong> {{event_name}}<br>
  <strong>Date:</strong> {{event_date}}<br>
  {{#if event_time}}<strong>Time:</strong> {{event_time}}{{/if}}
</div>

<p><strong>Quick Reminders:</strong></p>
<ul>
  <li>Setup crew must arrive 90 minutes before your event</li>
  <li>Direct attendees to <a href="https://alpacaplayhouse.com/visiting">alpacaplayhouse.com/visiting</a> for directions (do NOT post the address publicly)</li>
  <li>Cleanup must be completed by 1:01pm the day after your event</li>
</ul>

<p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
<p>Best regards,<br>Alpaca Playhouse</p>
$html$,
  $text$Payment Reminder - Your Event is Coming Up!

Hi {{first_name}},

This is a friendly reminder that your event {{event_name}} is 10 days away! We're excited to host you.

OUTSTANDING FEES - DUE IN 3 DAYS
---------------------------------
{{ITEMS_TEXT}}
Total Due: ${{total_outstanding}}
Due By: {{payment_due_date}}

PAYMENT OPTIONS
---------------
{{PAYMENT_METHODS_TEXT}}

Important: Please include your name and "{{event_name}}" in the payment memo.

EVENT DETAILS
-------------
Event: {{event_name}}
Date: {{event_date}}
{{#if event_time}}Time: {{event_time}}{{/if}}

QUICK REMINDERS
---------------
- Setup crew must arrive 90 minutes before your event
- Direct attendees to alpacaplayhouse.com/visiting for directions (do NOT post the address publicly)
- Cleanup must be completed by 1:01pm the day after your event

Questions? Reply to this email or contact us at team@alpacaplayhouse.com

Best regards,
Alpaca Playhouse$text$,
  '[{"key":"first_name","required":true},{"key":"event_name","required":true},{"key":"event_date","required":true},{"key":"event_time","required":false},{"key":"payment_due_date","required":true},{"key":"total_outstanding","required":true},{"key":"ITEMS_HTML","required":true,"description":"Pre-built HTML table rows of outstanding fee items"},{"key":"ITEMS_TEXT","required":true,"description":"Pre-built text list of outstanding fee items"},{"key":"PAYMENT_METHODS_HTML","required":true},{"key":"PAYMENT_METHODS_TEXT","required":true}]'::jsonb
),

-- ============================================================
-- 41. payment_confirmed_admin (from confirm-deposit-payment)
-- ============================================================
(
  'payment_confirmed_admin',
  'payment_admin',
  'Admin notification when a deposit payment is confirmed via the email link',
  'noreply',
  'Payment Confirmed: ${{amount}} from {{sender_name}}',
  $html$
<div style="font-family:-apple-system,sans-serif;">
  <h2 style="color:#2d7d46;">Payment Confirmed by Admin</h2>
  <p>${{amount}} from {{sender_name}} has been recorded for {{person_name}}.</p>
  {{#if deposits_recorded}}<ul>{{deposits_recorded}}</ul>{{/if}}
  {{#if overpayment_note}}<p style="color:#e74c3c;">{{overpayment_note}}</p>{{/if}}
  {{#if admin_url}}<p><a href="{{admin_url}}">View Application</a></p>{{/if}}
</div>
$html$,
  $text$Payment Confirmed by Admin

${{amount}} from {{sender_name}} has been recorded for {{person_name}}.
{{#if deposits_recorded}}{{deposits_recorded}}{{/if}}
{{#if overpayment_note}}{{overpayment_note}}{{/if}}
{{#if admin_url}}View Application: {{admin_url}}{{/if}}$text$,
  '[{"key":"amount","required":true},{"key":"sender_name","required":true},{"key":"person_name","required":true},{"key":"deposits_recorded","required":false,"description":"Pre-built HTML list items of recorded deposits"},{"key":"overpayment_note","required":false},{"key":"admin_url","required":false}]'::jsonb
),

-- ============================================================
-- 42. error_digest (from error-report)
-- ============================================================
(
  'error_digest',
  'system',
  'Daily digest of client-side errors and high-risk bugs awaiting approval',
  'auto',
  '[GenAlpaca] Daily Error Digest: {{error_count}} error(s)',
  $html$
<div style="font-family:-apple-system,sans-serif;max-width:700px;">
  <h2>GenAlpaca Daily Error Digest</h2>
  <p><strong>Period:</strong> {{period_start}} to {{period_end}}<br>
  <strong>Total Errors:</strong> {{error_count}}</p>

  <h3>Severity Breakdown</h3>
  <table style="border-collapse:collapse;width:100%;max-width:300px;">
    <tr><td style="padding:4px 8px;">Critical</td><td style="padding:4px 8px;font-weight:bold;">{{critical_count}}</td></tr>
    <tr><td style="padding:4px 8px;">Error</td><td style="padding:4px 8px;font-weight:bold;">{{error_severity_count}}</td></tr>
    <tr><td style="padding:4px 8px;">Warning</td><td style="padding:4px 8px;font-weight:bold;">{{warning_count}}</td></tr>
    <tr><td style="padding:4px 8px;">Info</td><td style="padding:4px 8px;font-weight:bold;">{{info_count}}</td></tr>
  </table>

  {{#if pending_approval_html}}
  <h3 style="color:#e67e22;">High-Risk Bugs Awaiting Approval</h3>
  {{pending_approval_html}}
  {{/if}}

  {{#if error_details_html}}
  <h3>Error Details</h3>
  {{error_details_html}}
  {{/if}}

  <p style="color:#999;font-size:0.85rem;margin-top:20px;">View the error_logs table in Supabase for full details.</p>
</div>
$html$,
  $text$GenAlpaca Daily Error Digest
============================
Period: {{period_start}} to {{period_end}}
Total Errors: {{error_count}}

Severity Breakdown:
- Critical: {{critical_count}}
- Error: {{error_severity_count}}
- Warning: {{warning_count}}
- Info: {{info_count}}

{{#if pending_approval_text}}HIGH-RISK BUGS AWAITING APPROVAL:
{{pending_approval_text}}{{/if}}

{{#if error_details_text}}Error Details:
{{error_details_text}}{{/if}}

View the error_logs table in Supabase for full details.$text$,
  '[{"key":"error_count","required":true},{"key":"period_start","required":true},{"key":"period_end","required":true},{"key":"critical_count","required":false,"description":"Count of critical errors"},{"key":"error_severity_count","required":false,"description":"Count of error-level errors"},{"key":"warning_count","required":false,"description":"Count of warnings"},{"key":"info_count","required":false,"description":"Count of info-level"},{"key":"pending_approval_html","required":false,"description":"Pre-built HTML of bugs awaiting approval"},{"key":"pending_approval_text","required":false,"description":"Pre-built text of bugs awaiting approval"},{"key":"error_details_html","required":false,"description":"Pre-built HTML of grouped error details"},{"key":"error_details_text","required":false,"description":"Pre-built text of grouped error details"}]'::jsonb
);
