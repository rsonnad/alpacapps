-- Optional per-application payment deadline. When set, the lease-signed email
-- uses it instead of "24 hours after signing".
alter table public.rental_applications
  add column if not exists payment_deadline_at timestamptz;

comment on column public.rental_applications.payment_deadline_at is
  'Overrides the default payment deadline (signing time + 24h) in the lease-signed email and deadline follow-ups.';
