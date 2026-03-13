-- Insert associate_payout_sent email template
-- Run via Supabase Management API

INSERT INTO email_templates (template_key, category, description, sender_type, subject_template, html_template, text_template, placeholders)
VALUES (
  'associate_payout_sent',
  'associate',
  'Sent to associate when a payout is processed — includes amount, method, period, and time entry breakdown',
  'team',
  'Payout Sent — ${{amount}} - Alpaca Playhouse',
  $html$
<h2 style="margin:0 0 4px;">Payout Processed</h2>
<p style="margin:0 0 20px;color:#7d6f74;font-size:14px;">Hi {{first_name}}, your payout has been sent!</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f2f0e8;border:1px solid #e6e2d9;border-radius:8px;margin:0 0 20px;">
  <tr>
    <td style="padding:20px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="padding:0 0 8px;"><strong>Amount:</strong></td>
          <td style="padding:0 0 8px;text-align:right;font-weight:600;color:#d4883a;font-size:18px;">${{amount}}</td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;"><strong>Method:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{payment_method}}</td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;"><strong>Date:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{payout_date}}</td>
        </tr>
        {{#if period}}
        <tr>
          <td style="padding:0 0 8px;"><strong>Period:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{period}}</td>
        </tr>
        {{/if}}
        {{#if hours}}
        <tr>
          <td style="padding:0;border-top:1px solid #e6e2d9;padding-top:8px;"><strong>Hours:</strong></td>
          <td style="padding:0;border-top:1px solid #e6e2d9;padding-top:8px;text-align:right;">{{hours}} hrs @ ${{hourly_rate}}/hr</td>
        </tr>
        {{/if}}
      </table>
    </td>
  </tr>
</table>

{{#if notes}}
<p style="margin:0 0 4px;font-weight:600;font-size:14px;">Notes</p>
<p style="margin:0 0 20px;color:#2a1f23;">{{notes}}</p>
{{/if}}

<p style="margin:0 0 8px;">Funds are typically available within <strong>1–2 business days</strong>, depending on your bank.</p>

<p style="margin:16px 0 0;color:#7d6f74;font-size:13px;">Questions about this payout? Reply to this email or reach out to us anytime.</p>
$html$,
  $text$Payout Processed

Hi {{first_name}}, your payout has been sent!

Amount: ${{amount}}
Method: {{payment_method}}
Date: {{payout_date}}
{{#if period}}Period: {{period}}
{{/if}}{{#if hours}}Hours: {{hours}} hrs @ ${{hourly_rate}}/hr
{{/if}}
{{#if notes}}Notes: {{notes}}
{{/if}}
Funds are typically available within 1-2 business days, depending on your bank.

Questions about this payout? Reply to this email or reach out to us anytime.$text$,
  '[{"key":"first_name","required":true,"description":"Associate first name"},{"key":"amount","required":true,"description":"Payout amount (formatted, e.g. 251.50)"},{"key":"payment_method","required":true,"description":"Payment method (e.g. Stripe, PayPal)"},{"key":"payout_date","required":true,"description":"Date payout was sent"},{"key":"period","required":false,"description":"Pay period description"},{"key":"hours","required":false,"description":"Total hours worked"},{"key":"hourly_rate","required":false,"description":"Hourly rate"},{"key":"notes","required":false,"description":"Additional notes about the payout"}]'::jsonb
);

-- Enable approval workflow for payout emails (requires admin click-to-send)
INSERT INTO email_type_approval_config (email_type, requires_approval)
VALUES ('associate_payout_sent', true)
ON CONFLICT (email_type) DO UPDATE SET requires_approval = true;
