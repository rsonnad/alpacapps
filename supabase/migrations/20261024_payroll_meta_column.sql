-- Payroll approval metadata used to ride inside the approval email HTML as an HTML comment,
-- where an associate's display_name could inject a competing PAYROLL_META block.
-- It now lives in its own column, written only by weekly-payroll-summary (service role).
ALTER TABLE public.pending_email_approvals
  ADD COLUMN IF NOT EXISTS payroll_meta jsonb;

COMMENT ON COLUMN public.pending_email_approvals.payroll_meta IS
  'Server-written payout metadata for weekly_payroll_summary approvals. approve-email reads this, never the email HTML.';
