-- Weekly Payroll Summary email template + approval config
-- Run via Supabase Management API
-- This is the admin-facing summary email that goes through the approval gate.
-- The actual content is built dynamically by the weekly-payroll-summary edge function
-- and passed via _raw_html in data. This template is a pass-through wrapper.

INSERT INTO email_templates (template_key, category, description, sender_type, subject_template, html_template, text_template, placeholders)
VALUES (
  'weekly_payroll_summary',
  'associate',
  'Weekly payroll summary sent to admin for approval — includes daily work breakdown, hours, rate, and amount per associate',
  'team',
  'Weekly Payroll — {{associate_name}} — ${{amount}} ({{period}})',
  $html$
{{_raw_html}}
$html$,
  $text$Weekly Payroll Summary

Associate: {{associate_name}}
Period: {{period}}
Hours: {{total_hours}}
Rate: ${{hourly_rate}}/hr
Amount: ${{amount}}
Entries: {{entry_count}}
Stripe: {{#if has_stripe}}Ready{{else}}Not Set Up{{/if}}

Approve this email to process the payment.$text$,
  '[{"key":"_raw_html","required":true,"description":"Pre-built HTML content from edge function"},{"key":"associate_name","required":true,"description":"Associate full name"},{"key":"amount","required":true,"description":"Total amount due"},{"key":"period","required":true,"description":"Date range of work"},{"key":"total_hours","required":true,"description":"Total hours worked"},{"key":"hourly_rate","required":true,"description":"Hourly rate"},{"key":"entry_count","required":true,"description":"Number of time entries"},{"key":"has_stripe","required":false,"description":"Whether associate has Stripe Connect"},{"key":"first_name","required":false,"description":"Associate first name"}]'::jsonb
)
ON CONFLICT (template_key) DO UPDATE SET
  html_template = EXCLUDED.html_template,
  text_template = EXCLUDED.text_template,
  subject_template = EXCLUDED.subject_template,
  placeholders = EXCLUDED.placeholders,
  description = EXCLUDED.description;

-- Enable approval workflow (admin must click to approve each payroll)
INSERT INTO email_type_approval_config (email_type, requires_approval)
VALUES ('weekly_payroll_summary', true)
ON CONFLICT (email_type) DO UPDATE SET requires_approval = true;
