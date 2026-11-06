-- Confirm Stripe Connect payouts every 6 hours (see
-- supabase/functions/stripe-payout-confirm/README.md). Uses the payroll
-- service-role bearer from Vault (20260929_payroll_hardening.sql).
-- Idempotent: cron.schedule replaces a job with the same name.
SELECT cron.schedule(
  'stripe-payout-confirm',
  '15 */6 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/stripe-payout-confirm',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);
