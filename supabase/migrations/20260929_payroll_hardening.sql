-- Payroll hardening: codify live-only payroll config and lock down the
-- money-moving endpoint.
--
-- Before this file, three things payroll depends on existed only in the live
-- database, so the repo could not rebuild payroll and nobody reading the code
-- could see them:
--   * associate_profiles.payout_frequency / payout_day_of_week / daily_extra
--   * the nightly pay-pending-associates pg_cron job (~02:30 UTC)
--   * the cron auth: the nightly job sent the public anon key, which means
--     anyone holding that key (it ships in every page of the site) could
--     trigger a payroll run.
--
-- pay-pending-associates now REJECTS the anon key and requires the
-- service-role key (or an admin/oracle JWT). Every payroll cron job below
-- therefore sends the service-role key, read at run time from
-- public.payroll_cron_bearer(), so the key never appears in cron.job.command.
--
-- ONE-TIME SETUP (before running this file): store the project's
-- service_role key in Vault. It must be the same value the edge functions see
-- as SUPABASE_SERVICE_ROLE_KEY (Dashboard → Project Settings → API → legacy
-- "service_role" secret):
--
--     select vault.create_secret('<service_role key>', 'service_role_key');
--
-- This file stops with an error if it can't find the key, rather than
-- scheduling jobs that would all get 401.
--
-- DEPLOY ORDER: 20260928_instant_payout_8pm.sql → this file → deploy
-- pay-pending-associates, stripe-payout, paypal-payout, weekly-payroll-summary.
-- Deploying pay-pending-associates first would 401 the old anon-key cron job
-- and stop payroll (the overdue watchdog would flag it after 7 days).
--
-- Idempotent — safe to re-run.

-- 1. Columns the payroll code reads (already live; no-ops there) ------------

ALTER TABLE public.associate_profiles
  ADD COLUMN IF NOT EXISTS payout_frequency   text,
  ADD COLUMN IF NOT EXISTS payout_day_of_week smallint,
  ADD COLUMN IF NOT EXISTS daily_extra        numeric(10,2) DEFAULT 0;

COMMENT ON COLUMN public.associate_profiles.payout_frequency IS
  'Auto-payout cadence in pay-pending-associates: ''daily'' or NULL = every nightly run; any other value (weekly/biweekly/monthly) = only on payout_day_of_week. NOTE: biweekly and monthly currently behave as weekly. Ignored when instant_payout = true.';
COMMENT ON COLUMN public.associate_profiles.payout_day_of_week IS
  'Weekday (0=Sun .. 6=Sat, America/Chicago) a non-daily associate is paid. NULL = Saturday.';
COMMENT ON COLUMN public.associate_profiles.daily_extra IS
  'Flat stipend added once per distinct Central work day, on top of hours × rate. Applied by every payout path via supabase/functions/_shared/payout-breakdown.ts.';

-- 2. Service-role bearer for pg_cron ---------------------------------------
-- SECURITY DEFINER so cron (running as the job owner) can read Vault without
-- granting Vault access broadly. EXECUTE is revoked from every API role: an
-- anon/authenticated caller must never be able to read the service key.

CREATE OR REPLACE FUNCTION public.payroll_cron_bearer()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  k text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO k
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR invalid_schema_name THEN
    k := NULL;  -- Vault not installed; fall through to the legacy GUC
  END;
  RETURN coalesce(k, nullif(current_setting('app.settings.service_role_key', true), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_cron_bearer() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_bearer() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_bearer() FROM authenticated';
  END IF;
END $$;

COMMENT ON FUNCTION public.payroll_cron_bearer() IS
  'Service-role key for payroll pg_cron → edge function calls (Vault secret service_role_key). Never grant to anon/authenticated.';

DO $$
BEGIN
  IF public.payroll_cron_bearer() IS NULL THEN
    RAISE EXCEPTION 'No service-role key found. Run: select vault.create_secret(''<service_role key>'', ''service_role_key''); then re-run this migration. Nothing was rescheduled, so the existing payroll jobs are unchanged.';
  END IF;
END $$;

-- 3. Canonical payroll cron jobs -------------------------------------------
-- Remove every existing job that calls a payroll function, whatever it was
-- named when created by hand, then schedule the canonical set. Matching on the
-- command (not the name) is what makes this safe to run against the live DB,
-- where the nightly job's name was never recorded.

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid, jobname FROM cron.job
    WHERE command ILIKE '%/functions/v1/pay-pending-associates%'
       OR command ILIKE '%/functions/v1/payroll-overdue-check%'
       OR command ILIKE '%/functions/v1/weekly-payroll-summary%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
    RAISE NOTICE 'unscheduled payroll job % (%)', j.jobid, j.jobname;
  END LOOP;
END $$;

-- Nightly auto-payout for all eligible associates. 02:30 UTC = 9:30 PM CDT /
-- 8:30 PM CST (unchanged from the live job).
SELECT cron.schedule(
  'pay-pending-associates-nightly',
  '30 2 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pay-pending-associates',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);

-- 8 PM Central instant-payout run (instant_payout associates only). pg_cron
-- is UTC-only, so it fires at 01:00 (8 PM CDT) and 02:00 UTC (8 PM CST); the
-- function proceeds only when it is 20:xx in America/Chicago.
SELECT cron.schedule(
  'pay-instant-associates-8pm-cdt',
  '0 1 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pay-pending-associates?mode=instant',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);

SELECT cron.schedule(
  'pay-instant-associates-8pm-cst',
  '0 2 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pay-pending-associates?mode=instant',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);

-- Overdue watchdog, 15:30 UTC = 10:30 AM CDT (see 20260608_payroll_overdue_check_cron.sql).
SELECT cron.schedule(
  'payroll-overdue-check-daily',
  '30 15 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/payroll-overdue-check',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);

-- Weekly approval summary, Mondays 14:15 UTC = 9:15 AM CDT (see 20260323_weekly_payroll_cron.sql).
SELECT cron.schedule(
  'weekly-payroll-summary',
  '15 14 * * 1',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/weekly-payroll-summary',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
        'apikey', public.payroll_cron_bearer(),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);
