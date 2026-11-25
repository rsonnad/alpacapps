-- Rent watch: which payers the owner wants checked each month. Read by the rent-watch-digest
-- edge function (service role only). The table holds tenant names and amounts, so it is locked
-- down and seeded by hand, never from this repo.

create table if not exists public.rent_watch (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  match_names     text[] not null,            -- lowercase substrings matched against ledger.person_name
  expected_amount numeric(10,2) not null check (expected_amount > 0),
  due_day         int not null default 1 check (due_day between 1 and 28),
  prepay_days     int not null default 14 check (prepay_days between 0 and 45),
  starts_on       date,
  ends_on         date,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now()
);

alter table public.rent_watch enable row level security;
revoke all on public.rent_watch from anon, authenticated;

-- Daily at 15:10 UTC (10:10 AM Central, 16:10 Warsaw in winter). payment-overdue-check runs the owner-only
-- digest in mode rent_watch, which decides whether to email: always on the 1st and 2nd, later only while
-- rent is missing. (The project is at the edge-function limit, so this is a mode, not a new function.)
select cron.schedule(
  'rent-watch-digest-daily',
  '10 15 * * *',
  $$select public.cron_post('https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/payment-overdue-check', '{"mode":"rent_watch"}'::jsonb)$$
);
