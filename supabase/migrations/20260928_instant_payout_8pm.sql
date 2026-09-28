-- Instant payouts for selected associates, checked at 8:00 PM Central daily.
--
-- Request (2026-09-28): associate Amber Coleman should always be paid right
-- away — check at 8 PM and process the same day if possible.
--
-- Rather than hardcoding a person into the payroll function, this adds a
-- per-associate flag. pay-pending-associates treats instant_payout = true as:
--   1. always due (ignores payout_frequency / payout_day_of_week),
--   2. included in an extra 8 PM Central run (`?mode=instant`, below),
--   3. after the Stripe transfer, try a Stripe Instant Payout to the payee's
--      debit card; if Stripe refuses, the money goes out on the connected
--      account's standard bank schedule and admin gets an email.
-- The regular nightly run (live pg_cron job, ~02:30 UTC) still runs and also
-- picks up anything an instant associate clocks out after 8 PM.
--
-- ORDER MATTERS: apply this migration BEFORE deploying the updated
-- pay-pending-associates function. The function selects instant_payout; if
-- the column is missing, every payroll run throws (admin gets an exception
-- alert, but nobody is paid).
--
-- Idempotent — safe to re-run.

-- 1. Schema ---------------------------------------------------------------

ALTER TABLE public.associate_profiles
  ADD COLUMN IF NOT EXISTS instant_payout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.associate_profiles.instant_payout IS
  'Pay every day at the 8 PM Central run and attempt a Stripe Instant Payout to the payee''s debit card (falls back to the standard bank payout). Overrides payout_frequency. See pay-pending-associates.';

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS stripe_instant_payout_id text;

COMMENT ON COLUMN public.payouts.stripe_instant_payout_id IS
  'Stripe payout id (po_...) of the Instant Payout on the connected account, when one succeeded. external_payout_id stays the platform transfer (tr_...).';

-- 2. Enable for Amber Coleman ---------------------------------------------
-- Matched by name because this migration was written without DB access.
-- Updates only on exactly one match; otherwise it warns and changes nothing,
-- so a wrong or ambiguous match never flips someone else's payroll.
-- It also warns when her profile can't be auto-paid at all (the payroll job
-- only pays active, identity-verified Stripe Connect associates).

DO $$
DECLARE
  matches int;
  target record;
BEGIN
  SELECT count(*) INTO matches
  FROM public.associate_profiles ap
  JOIN public.app_users u ON u.id = ap.app_user_id
  WHERE u.display_name ILIKE 'Amber Coleman'
     OR (u.first_name ILIKE 'Amber' AND u.last_name ILIKE 'Coleman');

  IF matches <> 1 THEN
    RAISE WARNING 'instant_payout: expected 1 associate named Amber Coleman, found %. Nothing updated — set associate_profiles.instant_payout = true by id manually.', matches;
    RETURN;
  END IF;

  SELECT ap.id, ap.is_active, ap.payment_method, ap.stripe_connect_account_id, ap.identity_verification_status
    INTO target
  FROM public.associate_profiles ap
  JOIN public.app_users u ON u.id = ap.app_user_id
  WHERE u.display_name ILIKE 'Amber Coleman'
     OR (u.first_name ILIKE 'Amber' AND u.last_name ILIKE 'Coleman');

  UPDATE public.associate_profiles SET instant_payout = true WHERE id = target.id;
  RAISE NOTICE 'instant_payout enabled for Amber Coleman (associate_profiles.id=%)', target.id;

  IF NOT (coalesce(target.is_active, false)
          AND target.payment_method = 'stripe'
          AND target.stripe_connect_account_id IS NOT NULL
          AND target.identity_verification_status = 'verified') THEN
    RAISE WARNING 'Amber Coleman is flagged but NOT auto-payable yet: is_active=%, payment_method=%, stripe_connect_account_id=%, identity_verification_status=%. pay-pending-associates will skip her until all four are satisfied.',
      target.is_active, target.payment_method,
      CASE WHEN target.stripe_connect_account_id IS NULL THEN 'NULL' ELSE 'set' END,
      target.identity_verification_status;
  END IF;
END $$;

-- 3. 8 PM Central cron ------------------------------------------------------
-- pg_cron runs in UTC. 8 PM Central is 01:00 UTC under CDT and 02:00 UTC under
-- CST, so we schedule both; the function's hour gate proceeds only when it is
-- 20:xx in America/Chicago and returns a no-op for the other one. That keeps
-- the run at 8 PM local all year with no twice-yearly cron edits.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pay-instant-associates-8pm-cdt') THEN
    PERFORM cron.unschedule('pay-instant-associates-8pm-cdt');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pay-instant-associates-8pm-cst') THEN
    PERFORM cron.unschedule('pay-instant-associates-8pm-cst');
  END IF;
END $$;

SELECT cron.schedule(
  'pay-instant-associates-8pm-cdt',
  '0 1 * * *',  -- 01:00 UTC = 8 PM CDT (Mar–Nov); 7 PM CST no-op
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pay-pending-associates?mode=instant',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);

SELECT cron.schedule(
  'pay-instant-associates-8pm-cst',
  '0 2 * * *',  -- 02:00 UTC = 8 PM CST (Nov–Mar); 9 PM CDT no-op
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pay-pending-associates?mode=instant',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);
