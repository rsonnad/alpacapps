-- Daily cron: trigger gemini-cost-sync to refresh the last 3 days of Gemini usage.
-- Runs 13:20 UTC (~8:20 AM Central). Applied live via Management API on 2026-06-13.
--
-- NOTE: the deployed job authorizes with the project's public anon JWT (RLS-protected,
-- same value as shared/supabase.js), matching the other daily cron jobs. It is shown
-- here as __SUPABASE_ANON_KEY__ so this file carries no token; substitute before re-running.
do $cron$
begin
  if exists (select 1 from cron.job where jobname='gemini-cost-sync-daily') then
    perform cron.unschedule('gemini-cost-sync-daily');
  end if;
  perform cron.schedule(
    'gemini-cost-sync-daily',
    '20 13 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/gemini-cost-sync',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer __SUPABASE_ANON_KEY__"}'::jsonb,
      body := '{"days":3}'::jsonb
    );
    $job$
  );
end;
$cron$;
