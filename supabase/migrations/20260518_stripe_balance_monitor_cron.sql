-- Stripe balance monitor — daily snapshot + change notification.
-- Cron fires at 5:00 PM Central (22:00 UTC during CDT) and calls the
-- stripe-balance-monitor edge function, which inserts a row and emails
-- alpacaplayhouse@gmail.com when any tracked field differs from the
-- previous snapshot.

CREATE TABLE IF NOT EXISTS stripe_balance_snapshots (
  id                       BIGSERIAL PRIMARY KEY,
  checked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_cents          BIGINT NOT NULL,
  pending_cents            BIGINT NOT NULL,
  instant_available_cents  BIGINT NOT NULL,
  changed                  BOOLEAN NOT NULL DEFAULT FALSE,
  notified                 BOOLEAN NOT NULL DEFAULT FALSE,
  prev_available_cents     BIGINT,
  prev_pending_cents       BIGINT,
  prev_instant_available_cents BIGINT
);

CREATE INDEX IF NOT EXISTS idx_stripe_balance_snapshots_checked_at
  ON stripe_balance_snapshots (checked_at DESC);

ALTER TABLE stripe_balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_balance_snapshots_admin_read ON stripe_balance_snapshots;
CREATE POLICY stripe_balance_snapshots_admin_read
  ON stripe_balance_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')
    )
  );

-- Schedule: every day at 22:00 UTC = 5:00 PM Central (CDT) / 4:00 PM CST.
-- Matches the timezone convention used by weekly-payroll-summary cron.
DO $$
BEGIN
  PERFORM cron.unschedule('stripe-balance-monitor');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job didn't exist; ignore
END $$;

SELECT cron.schedule(
  'stripe-balance-monitor',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/stripe-balance-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
