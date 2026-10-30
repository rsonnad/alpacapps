-- Payroll cron watchdog: email admins when a payroll pg_cron → edge function
-- call comes back non-2xx.
--
-- Context: from 2026-09-29 to 2026-10-04 every pg_cron call to
-- pay-pending-associates returned 401 {"error":"Invalid auth token"} — the Vault
-- secret service_role_key held the legacy service_role JWT while the function's
-- SUPABASE_SERVICE_ROLE_KEY is the new sb_secret_... key. Nobody noticed:
-- requireFunctionRoles rejects the call before any of the function's own
-- admin-alert code runs, and cron.job_run_details reports "1 row" (pg_net only
-- enqueued the request). The payroll-overdue-check watchdog would only have
-- spoken up after 7 days — and it authenticates the same way, so it was 401ing too.
--
-- How it works:
--   * Every payroll cron job now calls public.payroll_cron_post(job, url), which
--     does the net.http_post and records the returned request id in
--     public.payroll_cron_requests. net._http_response has no URL column and
--     pg_net deletes the queue row once sent, so the id captured at call time is
--     the only reliable way to tie a response back to a payroll function.
--   * public.payroll_cron_watchdog() runs hourly at :05. It copies each pending
--     request's response (status, body excerpt) into payroll_cron_requests —
--     pg_net purges _http_response after ~6 h, the copy keeps history — and flags
--     non-2xx, timeouts, curl errors, requests with no response after 15 min, and
--     payroll cron runs that failed outright. One email per run lists them all;
--     each row is alerted once.
--   * The alert goes straight from Postgres to Resend using the Vault secret
--     resend_api_key. It deliberately does NOT go through an edge function or
--     public.payroll_cron_bearer(): a bad bearer is the failure being watched for,
--     and it must not also silence the watchdog.
--
-- SUPERSEDES section 3 of 20260929_payroll_hardening.sql (the five
-- cron.schedule calls). Re-running that file reverts jobs 73–77 to plain
-- net.http_post and blinds this watchdog — re-run this file afterwards.
--
-- ONE-TIME SETUP (before running this file): store the Resend API key in Vault.
-- It is the same value as the edge functions' RESEND_API_KEY (Bitwarden item id
-- 4ddf12ff-f86d-4fca-a681-b410007ea3a7, field "Alpacabe MCP Key"):
--
--     select vault.create_secret('<resend key>', 'resend_api_key');
--
-- Created live via the Supabase Management API on 2026-10-04. Idempotent — safe
-- to re-run.

DO $$
BEGIN
  IF to_regprocedure('public.payroll_cron_bearer()') IS NULL THEN
    RAISE EXCEPTION 'public.payroll_cron_bearer() is missing. Apply 20260929_payroll_hardening.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'resend_api_key') THEN
    RAISE EXCEPTION 'Vault secret resend_api_key is missing. Run: select vault.create_secret(''<resend key>'', ''resend_api_key''); then re-run this file. Nothing was changed.';
  END IF;
END $$;

-- 1. Request log -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_cron_requests (
  id               bigserial PRIMARY KEY,
  request_id       bigint UNIQUE,          -- net.http_post id = net._http_response.id
  cron_runid       bigint UNIQUE,          -- set instead for a cron run that failed before posting
  job_name         text NOT NULL,
  url              text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  checked_at       timestamptz,            -- watchdog has recorded the outcome
  status_code      integer,
  timed_out        boolean,
  error_msg        text,
  response_excerpt text,
  alerted_at       timestamptz,
  alert_request_id bigint                  -- net.http_post id of the Resend email
);

CREATE INDEX IF NOT EXISTS payroll_cron_requests_pending_idx
  ON public.payroll_cron_requests (requested_at) WHERE checked_at IS NULL;

ALTER TABLE public.payroll_cron_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_cron_requests FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.payroll_cron_requests FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.payroll_cron_requests FROM authenticated';
  END IF;
END $$;

COMMENT ON TABLE public.payroll_cron_requests IS
  'One row per payroll pg_cron → edge function call (via payroll_cron_post), with the outcome copied from net._http_response by payroll_cron_watchdog(). See 20261004_payroll_cron_watchdog.sql.';

-- 2. Instrumented post -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_cron_post(p_job_name text, p_url text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  rid bigint;
BEGIN
  rid := net.http_post(
    url := p_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
      'apikey', public.payroll_cron_bearer(),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    -- pg_net defaults to 5 s; a payout run making Stripe/PayPal calls can take
    -- longer, and a pg_net timeout would read as a failure every night.
    timeout_milliseconds := 120000
  );
  INSERT INTO public.payroll_cron_requests (request_id, job_name, url)
  VALUES (rid, p_job_name, p_url);
  RETURN rid;
END;
$$;

-- 3. Watchdog ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_cron_watchdog()
RETURNS integer   -- number of problems alerted on this run
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  resend_key text;
  body_text  text;
  n          integer;
  rid        bigint;
BEGIN
  -- a. Copy outcomes from pg_net before its ~6 h purge.
  UPDATE public.payroll_cron_requests r
     SET checked_at       = now(),
         status_code      = h.status_code,
         timed_out        = h.timed_out,
         error_msg        = h.error_msg,
         response_excerpt = left(h.content, 500)
    FROM net._http_response h
   WHERE h.id = r.request_id
     AND r.checked_at IS NULL;

  -- b. No response row after 15 min: pg_net worker down, or already purged.
  UPDATE public.payroll_cron_requests
     SET checked_at = now(),
         error_msg  = 'No pg_net response row 15+ min after the request (worker down or response purged)'
   WHERE checked_at IS NULL
     AND request_id IS NOT NULL
     AND requested_at < now() - interval '15 minutes';

  -- c. Payroll cron runs that errored before posting (e.g. payroll_cron_post raised).
  INSERT INTO public.payroll_cron_requests
         (cron_runid, job_name, url, requested_at, checked_at, error_msg)
  SELECT d.runid, j.jobname, '(cron job failed before posting)', d.start_time, now(),
         'pg_cron run failed: ' || left(coalesce(d.return_message, ''), 450)
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE d.status = 'failed'
     AND d.start_time > now() - interval '1 day'
     AND j.command ILIKE '%payroll_cron_post%'
  ON CONFLICT (cron_runid) DO NOTHING;

  -- d. Anything unhealthy and not yet alerted?
  SELECT count(*),
         string_agg(
           format(E'• %s  [%s UTC]\n  %s\n  status: %s%s%s\n  response: %s',
                  job_name,
                  to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                  url,
                  coalesce(status_code::text, 'none'),
                  CASE WHEN timed_out THEN ' (timed out)' ELSE '' END,
                  CASE WHEN error_msg IS NOT NULL THEN E'\n  error: ' || error_msg ELSE '' END,
                  coalesce(left(response_excerpt, 300), '-')),
           E'\n\n' ORDER BY requested_at)
    INTO n, body_text
    FROM public.payroll_cron_requests
   WHERE checked_at IS NOT NULL
     AND alerted_at IS NULL
     AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299
          OR timed_out IS TRUE OR error_msg IS NOT NULL);

  IF n = 0 THEN
    RETURN 0;
  END IF;

  SELECT decrypted_secret INTO resend_key
    FROM vault.decrypted_secrets WHERE name = 'resend_api_key' LIMIT 1;
  IF resend_key IS NULL THEN
    RAISE EXCEPTION 'payroll_cron_watchdog: % failed payroll call(s) but Vault secret resend_api_key is missing', n;
  END IF;

  rid := net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || resend_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Alpaca Playhouse <notifications@alpacaplayhouse.com>',
      -- Keep in sync with ADMIN_ALERT_EMAILS in pay-pending-associates.
      'to', jsonb_build_array('alpacaplayhouse@gmail.com', 'rahulioson@gmail.com'),
      'subject', format('⚠️ Payroll cron: %s failed call(s)', n),
      'text', E'A scheduled payroll call to a Supabase edge function did not succeed. '
              'The function rejected or never handled the request, so its own alerts did not run '
              'and nobody may have been paid.\n\n'
              || body_text ||
              E'\n\nA 401 {"error":"Invalid auth token"} usually means the Vault secret service_role_key '
              'no longer matches the functions'' SUPABASE_SERVICE_ROLE_KEY (see public.payroll_cron_bearer()).\n\n'
              'Details: select * from public.payroll_cron_requests order by id desc;\n'
              '— payroll_cron_watchdog (pg_cron, hourly)'
    ),
    timeout_milliseconds := 15000
  );

  UPDATE public.payroll_cron_requests
     SET alerted_at = now(), alert_request_id = rid
   WHERE checked_at IS NOT NULL
     AND alerted_at IS NULL
     AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299
          OR timed_out IS TRUE OR error_msg IS NOT NULL);

  RETURN n;
END;
$$;

-- Never callable from the API: payroll_cron_post sends the service key and
-- payroll_cron_watchdog reads the Resend key.
REVOKE ALL ON FUNCTION public.payroll_cron_post(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payroll_cron_watchdog() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_post(text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_watchdog() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_post(text, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.payroll_cron_watchdog() FROM authenticated';
  END IF;
END $$;

-- 4. Re-point the payroll jobs at payroll_cron_post --------------------------
-- alter_job keeps the job ids (73–77) stable; schedules are unchanged.

DO $$
DECLARE
  base constant text := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/';
  j record;
  jid bigint;
BEGIN
  FOR j IN
    SELECT * FROM (VALUES
      ('pay-pending-associates-nightly', 'pay-pending-associates'),
      ('pay-instant-associates-8pm-cdt', 'pay-pending-associates?mode=instant'),
      ('pay-instant-associates-8pm-cst', 'pay-pending-associates?mode=instant'),
      ('payroll-overdue-check-daily',    'payroll-overdue-check'),
      ('weekly-payroll-summary',         'weekly-payroll-summary')
    ) AS v(jobname, path)
  LOOP
    SELECT jobid INTO jid FROM cron.job WHERE jobname = j.jobname;
    IF jid IS NULL THEN
      RAISE EXCEPTION 'cron job % not found. Apply 20260929_payroll_hardening.sql first.', j.jobname;
    END IF;
    PERFORM cron.alter_job(
      jid,
      command := format('select public.payroll_cron_post(%L, %L)', j.jobname, base || j.path)
    );
  END LOOP;
END $$;

-- 5. Schedule the watchdog ---------------------------------------------------
-- Hourly at :05 so every payroll run (01:00, 02:00, 02:30, 14:15 Mon,
-- 15:30 UTC) is checked well inside pg_net's ~6 h response retention.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payroll-cron-watchdog') THEN
    PERFORM cron.unschedule('payroll-cron-watchdog');
  END IF;
END $$;

SELECT cron.schedule(
  'payroll-cron-watchdog',
  '5 * * * *',
  $$select public.payroll_cron_watchdog()$$
);
