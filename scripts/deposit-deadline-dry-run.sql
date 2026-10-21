-- Who would be reminded (20h-24h) or flagged overdue (24h+) right now.
-- reminder_h/deadline_h are parameters; the second run loosens them to 0 to prove the filter shape.
with p as (select 20::numeric as reminder_h, 24::numeric as deadline_h),
c as (
  select a.id, trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) as name, pe.email,
    greatest(a.deposit_requested_at, coalesce(a.agreement_signed_at, a.deposit_requested_at)) as clock_start,
    case when coalesce(a.reservation_deposit_amount,0) > 0
      then case when a.reservation_deposit_paid then 0 else a.reservation_deposit_amount end
      else greatest(0,
        (case when a.move_in_deposit_paid then 0 else coalesce(a.move_in_deposit_amount,0) end)
      + (case when a.security_deposit_paid then 0 else coalesce(a.security_deposit_amount,0) end)
      - (case when a.application_fee_paid then coalesce(a.application_fee_amount,0) else 0 end)) end as amount_due
  from rental_applications a left join people pe on pe.id = a.person_id
  where a.agreement_status = 'signed' and a.deposit_status = 'requested'
    and a.deposit_requested_at is not null
    and a.require_deposit is distinct from false
    and a.is_archived is not true
)
select c.*, round(extract(epoch from now()-clock_start)/3600,1) as hours_elapsed,
  case when now()-clock_start >= make_interval(hours => p.deadline_h::int) then 'admin_alert'
       when now()-clock_start >= make_interval(hours => p.reminder_h::int) then 'tenant_reminder' end as action,
  'https://alpacaplayhouse.com/staff/rentals.html#applicant='||c.id as admin_url
from c, p where c.amount_due > 0 and now()-clock_start >= make_interval(hours => p.reminder_h::int)
order by clock_start;
