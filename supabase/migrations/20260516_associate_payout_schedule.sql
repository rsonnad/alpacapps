-- Per-associate payout schedule.
-- payout_frequency: how often pay-pending-associates fires for them.
-- payout_day_of_week: which weekday non-daily payouts fire on (0=Sun..6=Sat in ET).
-- Both applied to production via Supabase Management API on 2026-05-16.

ALTER TABLE associate_profiles
  ADD COLUMN IF NOT EXISTS payout_frequency text NOT NULL DEFAULT 'daily'
    CHECK (payout_frequency IN ('daily','weekly','biweekly','monthly'));

ALTER TABLE associate_profiles
  ADD COLUMN IF NOT EXISTS payout_day_of_week smallint NOT NULL DEFAULT 6
    CHECK (payout_day_of_week BETWEEN 0 AND 6);

COMMENT ON COLUMN associate_profiles.payout_frequency IS
  'How often pay-pending-associates fires for this associate. Cron runs nightly 00:00 UTC (8pm EDT).';
COMMENT ON COLUMN associate_profiles.payout_day_of_week IS
  'Weekday (0=Sun..6=Sat, evaluated in America/New_York) on which weekly/biweekly/monthly payouts fire. Ignored for daily.';
