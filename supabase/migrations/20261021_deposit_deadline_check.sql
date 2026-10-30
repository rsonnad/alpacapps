-- Follow-through for the 24-hour payment deadline in the lease-signed email.
-- deposit-deadline-check reminds the tenant once (4h before the deadline) and alerts the house once (after it).
-- It never cancels a reservation. These stamps make each send fire once per request.

alter table public.rental_applications
  add column if not exists payment_reminder_sent_at timestamptz,
  add column if not exists payment_overdue_alert_sent_at timestamptz;

comment on column public.rental_applications.payment_reminder_sent_at is
  'When deposit-deadline-check sent the tenant the payment reminder (4h before the deadline).';
comment on column public.rental_applications.payment_overdue_alert_sent_at is
  'When deposit-deadline-check told the house the payment deadline passed.';

-- Hourly, so the reminder lands within an hour of its mark.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'deposit-deadline-check-hourly') then
    perform cron.unschedule('deposit-deadline-check-hourly');
  end if;
  perform cron.schedule(
    'deposit-deadline-check-hourly',
    '17 * * * *',
    $cmd$select public.cron_post('https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/deposit-deadline-check', '{}'::jsonb)$cmd$
  );
end;
$$;
