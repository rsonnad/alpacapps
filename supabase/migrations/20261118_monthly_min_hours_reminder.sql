-- Monthly minimum hours + weekly "are you on track" reminder.
--
-- associate_profiles.monthly_min_hours: minimum hours an associate must log per
-- calendar month (America/Chicago). NULL = no minimum, no reminder.
--
-- The monthly-hours-reminder edge function runs every Friday at 5pm Central and
-- emails each associate whose logged hours this month plus their remaining
-- scheduled hours (after today) fall short of the minimum.

alter table public.associate_profiles
  add column if not exists monthly_min_hours numeric(6,2);

comment on column public.associate_profiles.monthly_min_hours is
  'Minimum hours per calendar month (Central time). NULL = none. Drives monthly-hours-reminder emails.';

-- Justin Gilbertson: 12 hours/month minimum (owner decision 2026-11-18).
update public.associate_profiles
   set monthly_min_hours = 12
 where id = '04b48bfc-07d8-4628-90ba-655120e07eaf';

-- Fridays 23:00 UTC = 5pm CST (6pm CDT).
select cron.unschedule('monthly-hours-reminder')
 where exists (select 1 from cron.job where jobname = 'monthly-hours-reminder');

select cron.schedule(
  'monthly-hours-reminder',
  '0 23 * * 5',
  $$select public.cron_post('https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/monthly-hours-reminder', '{}'::jsonb)$$
);
