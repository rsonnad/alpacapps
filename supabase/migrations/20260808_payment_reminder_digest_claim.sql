-- A scheduled retry must not send more than one admin digest for the same day.
-- Pending claims reserve the send; failed claims are intentionally retryable.
CREATE UNIQUE INDEX IF NOT EXISTS payment_reminders_one_active_admin_digest_per_day
  ON public.payment_reminders (source_type, due_date, recipient_type)
  WHERE source_type = 'admin_digest'
    AND recipient_type = 'admin'
    AND status IN ('pending', 'sent');
