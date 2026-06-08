-- Payroll overdue watchdog cron.
--
-- Schedules the payroll-overdue-check edge function daily. It is an INDEPENDENT
-- safety net: it watches the outcome (associates with unpaid clocked-out hours
-- older than 7 days) rather than depending on pay-pending-associates running, so
-- a silent failure of any payout path is surfaced to admin + payee no matter the
-- cause.
--
-- Context: from 2026-05-18 to 2026-06-08, pay-pending-associates returned HTTP 200
-- daily while paying nobody (it inserted payouts.status='preparing', which the
-- payouts_status_check constraint rejects; the error was caught and swallowed).
-- Nothing alerted anyone for three weeks. This watchdog makes that impossible.
--
-- Created live via the Supabase Management API on 2026-06-08; this file keeps it
-- reproducible. Idempotent — safe to re-run.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'payroll-overdue-check-daily') then
    perform cron.unschedule('payroll-overdue-check-daily');
  end if;
end $$;

select cron.schedule(
  'payroll-overdue-check-daily',
  '30 15 * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/payroll-overdue-check',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
  ) as request_id$$
);
