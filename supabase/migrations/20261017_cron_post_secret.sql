-- Scheduled edge-function calls authenticate with X-Cron-Secret.
--
-- Before 2026-10-17 most cron jobs called functions with only the public anon JWT,
-- and the functions did no caller check, so anyone with the anon key (shipped in the
-- website JS) could trigger them. Functions now call requireCronOrRoles(), which
-- accepts X-Cron-Secret == SCHEDULE_CRON_SECRET (edge secret) or an admin/service caller.
--
-- The secret lives in Vault as 'schedule_cron_secret' and must equal the edge-function
-- secret SCHEDULE_CRON_SECRET. Create/rotate it out of band (never commit the value):
--   select vault.create_secret('<value>', 'schedule_cron_secret');   -- or vault.update_secret
--   + set SCHEDULE_CRON_SECRET to the same value (Management API /secrets or supabase secrets set)
--
-- The anon JWT stays as the bearer so the gateway's verify_jwt still passes; it is public.
-- Payroll jobs (73-77) are untouched: they use payroll_cron_post() with the service key.

create or replace function public.cron_secret()
returns text
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'schedule_cron_secret' limit 1
$$;
revoke all on function public.cron_secret() from public, anon, authenticated;

create or replace function public.cron_post(p_url text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  s text := public.cron_secret();
begin
  if s is null then
    raise exception 'cron_post: Vault secret schedule_cron_secret is missing';
  end if;
  return net.http_post(
    url := p_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk',
      'X-Cron-Secret', s
    ),
    body := p_body
  );
end;
$$;
revoke all on function public.cron_post(text, jsonb) from public, anon, authenticated;

do $$
declare
  base constant text := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/';
  j record;
begin
  for j in
    select * from (values
      ('event-payment-reminder-daily', 'event-payment-reminder', '{}'),
      ('payment-overdue-check-daily',  'payment-overdue-check',  '{}'),
      ('audit-email-compliance',       'audit-email-compliance', '{}'),
      ('weekly-schedule-report',       'weekly-schedule-report', '{}'),
      ('tesla-battery-reminder',       'tesla-battery-reminder', '{}'),
      ('nightly-test-suite',           'run-nightly-tests',      '{}'),
      ('send-onboarding-emails',       'send-onboarding-email',  '{}'),
      ('pending-approvals-digest-daily','pending-approvals-digest','{}'),
      ('gemini-cost-sync-daily',       'gemini-cost-sync',       '{"days":3}'),
      ('storage-usage-watchdog',       'storage-usage-watchdog', '{}'),
      ('airbnb-ical-sync',             'airbnb-sync',            '{}'),
      -- already sent X-Cron-Secret, but as a literal in cron.job; read it from Vault now
      ('sonos-schedule-runner',        'sonos-control',          '{"action": "run-schedules"}'),
      ('thermostat-schedule-runner',   'nest-control',           '{"action": "run-schedules"}')
    ) as t(jobname, fn, body)
  loop
    perform cron.alter_job(
      job_id := (select jobid from cron.job where jobname = j.jobname),
      command := format('select public.cron_post(%L, %L::jsonb)', base || j.fn, j.body)
    );
  end loop;
end;
$$;
