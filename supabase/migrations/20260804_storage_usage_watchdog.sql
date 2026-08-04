-- Weekly Monday 9:00 AM Central (CDT) storage check. The Edge Function alerts only
-- when the organization reaches 80% of the 1 GB Supabase Free-plan limit.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'storage-usage-watchdog';

SELECT cron.schedule(
  'storage-usage-watchdog',
  '0 14 * * 1',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/storage-usage-watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
