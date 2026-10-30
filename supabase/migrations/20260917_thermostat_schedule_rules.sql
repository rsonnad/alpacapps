-- Thermostat schedule runner + first scheduled rule (Skyloft nightly A/C setback).
--
-- `thermostat_rules` already existed as a schema-only rules engine
-- (device_id -> nest_devices, conditions/actions jsonb). This wires it up for
-- rule_type='scheduled_time':
--   conditions: { hour, minute, recurrence: 'daily'|'weekdays'|'weekends'|'custom'|'once',
--                 custom_days?: [1..7] (Mon=1..Sun=7), one_time_date?: 'YYYY-MM-DD' }
--   actions:    { mode: 'HEAT'|'COOL'|'HEATCOOL'|'OFF', temperature?, heatTemp?, coolTemp? }
--
-- The nest-control edge function's new "run-schedules" action (added alongside
-- this migration) evaluates due rules every 15 minutes in America/Chicago time,
-- the same pattern already proven by sonos-control's "run-schedules" schedule
-- runner. Setpoints are clamped 50-90°F server-side (see TEMP_MAX_F in
-- nest-control/index.ts).
--
-- Created live via the Supabase Management API on 2026-09-17; this file keeps
-- it reproducible. Idempotent — safe to re-run. The cron job's Authorization
-- header uses the public anon key (safe to embed — same key already used by
-- the sonos-schedule-runner and payroll-overdue-check-daily cron jobs in this
-- project); the X-Cron-Secret value matches the `SCHEDULE_CRON_SECRET` edge
-- function secret and is deliberately NOT committed here — it was substituted
-- in when the job was created directly against the database.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'thermostat-schedule-runner') then
    perform cron.unschedule('thermostat-schedule-runner');
  end if;
end $$;

select cron.schedule(
  'thermostat-schedule-runner',
  '*/15 * * * *',
  $$select net.http_post(
      url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/nest-control',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true),
        'Content-Type', 'application/json',
        'X-Cron-Secret', current_setting('app.settings.schedule_cron_secret', true)
      ),
      body := '{"action": "run-schedules"}'::jsonb
  ) as request_id$$
);

-- Seed rule: Skyloft — nightly A/C setback to 88°F at 9:00 PM (America/Chicago), daily.
insert into thermostat_rules (name, device_id, rule_type, conditions, actions, is_active, priority)
select
  'Skyloft nightly A/C setback',
  nd.id,
  'scheduled_time',
  '{"hour": 21, "minute": 0, "recurrence": "daily"}'::jsonb,
  '{"mode": "COOL", "temperature": 88}'::jsonb,
  true,
  0
from nest_devices nd
where nd.room_name = 'Skyloft' and nd.device_type = 'thermostat'
  and not exists (
    select 1 from thermostat_rules tr
    where tr.device_id = nd.id and tr.name = 'Skyloft nightly A/C setback'
  );
