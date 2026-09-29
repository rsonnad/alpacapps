-- Payroll double-pay audit. Run in the Supabase SQL editor.
--
-- Sections 1–5 are READ-ONLY. Section 6 contains repairs, commented out; run
-- them only after reading the audit output.
--
-- Background (see ARCHITECTURE.md → "Payroll flow and invariants"): before
-- 2026-09-29 there were three ways an associate could be paid twice.
--   A. stripe-payout / paypal-payout never claimed entries or marked them
--      paid server-side, so a weekly-approval payout could re-pay entries a
--      staff-page payout had already covered.
--   B. hoursService.markPaid (manual cash/Zelle/etc.) wrote only is_paid,
--      which the payment_status trigger reverted. The hours stayed payable
--      and the nightly Stripe job could pay them again.
--   C. The staff pages called markPaid after a provider payout, which added
--      a second ledger row. That is an accounting double count, not money.

-- 1. Who has a daily extra. Only Fabiola is expected. After the 2026-09-29
--    deploy, EVERY payout path pays daily_extra (before, only the nightly job).
select u.display_name, ap.id as associate_profile_id, ap.daily_extra, ap.is_active, ap.payment_method
from associate_profiles ap
join app_users u on u.id = ap.app_user_id
where coalesce(ap.daily_extra, 0) <> 0
order by u.display_name;

-- 2. MONEY SENT TWICE: a time entry covered by more than one live payout (cause A).
select te_id as time_entry_id,
       min(p.person_name) as person,
       count(distinct p.id) as payouts,
       array_agg(distinct p.payment_method) as methods,
       array_agg(p.id order by p.created_at) as payout_ids,
       array_agg(p.created_at order by p.created_at) as payout_times
from payouts p
cross join lateral unnest(p.time_entry_ids) as te_id
where p.status in ('pending', 'processing', 'completed')
  and not coalesce(p.is_test, false)
group by te_id
having count(distinct p.id) > 1
order by person, te_id;

-- 3. AT RISK NOW: hours with a payment recorded (payment_id set) but still
--    payable (cause B). The next nightly run pays these again. Fix with 6b.
select u.display_name, te.id as time_entry_id,
       (te.clock_in at time zone 'America/Chicago') as clock_in_local,
       te.payment_status, l.payment_method, l.recorded_by, l.amount as ledger_amount, l.created_at as recorded_at
from time_entries te
join ledger l on l.id = te.payment_id
join associate_profiles ap on ap.id = te.associate_id
join app_users u on u.id = ap.app_user_id
where te.payment_status <> 'paid'
  and l.category = 'associate_payment'
  and coalesce(l.status, '') <> 'failed'
order by u.display_name, te.clock_in;

-- 4. AT RISK NOW: hours covered by a live provider payout but still payable
--    (cause A, old stripe-payout/paypal-payout). Fix with 6a.
select u.display_name, te.id as time_entry_id,
       (te.clock_in at time zone 'America/Chicago') as clock_in_local,
       te.payment_status, p.id as payout_id, p.payment_method, p.status as payout_status, p.created_at
from payouts p
cross join lateral unnest(p.time_entry_ids) as te_id
join time_entries te on te.id = te_id
join associate_profiles ap on ap.id = te.associate_id
join app_users u on u.id = ap.app_user_id
where p.status in ('processing', 'completed')
  and not coalesce(p.is_test, false)
  and te.payment_status <> 'paid'
order by u.display_name, te.clock_in;

-- 5. LIKELY PAID TWICE ALREADY (cause B): a manual payment followed by a
--    provider payout to the same person that covers the same dates. Review
--    each row by hand; the link from entry to the manual ledger row is lost
--    once the provider payout overwrote payment_id.
select l.id as manual_ledger_id, l.person_name, l.payment_method as manual_method,
       l.amount as manual_amount, l.period_start, l.period_end, l.created_at as manual_recorded_at,
       p.id as payout_id, p.payment_method as payout_method, p.amount as payout_amount, p.created_at as payout_at
from ledger l
join payouts p
  on p.person_id = l.person_id
 and p.created_at > l.created_at
 and p.status in ('processing', 'completed')
 and not coalesce(p.is_test, false)
where l.category = 'associate_payment'
  and l.recorded_by = 'admin'
  and coalesce(l.payment_method, '') not in ('stripe', 'paypal')
  and exists (
    select 1
    from unnest(p.time_entry_ids) as te_id
    join time_entries te on te.id = te_id
    where (te.clock_in at time zone 'America/Chicago')::date between l.period_start::date and l.period_end::date
  )
order by l.created_at;

-- 5b. Ledger double counts (cause C): a staff-page markPaid row next to the
--     edge function's own row for the same provider payout. Accounting only.
select l.id, l.person_name, l.payment_method, l.amount, l.created_at, l.notes
from ledger l
where l.category = 'associate_payment'
  and l.recorded_by = 'admin'
  and l.payment_method in ('stripe', 'paypal')
order by l.created_at desc;

-- 6. REPAIRS. Uncomment and run inside a transaction after reviewing 3 and 4.
--    They only mark hours paid and record claims; they never move money.
--
-- begin;
--
-- -- 6a. Hours already covered by a live provider payout: claim + mark paid.
-- insert into payout_time_entries (payout_id, time_entry_id)
-- select distinct on (te_id) p.id, te_id
-- from payouts p
-- cross join lateral unnest(p.time_entry_ids) as te_id
-- where p.status in ('processing', 'completed') and not coalesce(p.is_test, false)
-- order by te_id, p.created_at
-- on conflict (time_entry_id) do nothing;
--
-- update time_entries te
-- set payment_status = 'paid'
-- from payouts p
-- where te.id = any (p.time_entry_ids)
--   and p.status in ('processing', 'completed') and not coalesce(p.is_test, false)
--   and te.payment_status <> 'paid';
--
-- -- 6b. Manual payments whose paid flag the trigger reverted: mark paid.
-- update time_entries te
-- set payment_status = 'paid'
-- from ledger l
-- where l.id = te.payment_id
--   and l.category = 'associate_payment'
--   and coalesce(l.status, '') <> 'failed'
--   and te.payment_status <> 'paid';
--
-- commit;
