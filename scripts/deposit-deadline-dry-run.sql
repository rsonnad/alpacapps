-- Who deposit-deadline-check would contact right now (read-only).
-- Deadline = payment_deadline_at if set, else 24h after the later of deposit_requested_at / agreement_signed_at.
-- tenant_reminder: within 4h before the deadline. admin_alert: deadline passed.
-- Ignores the sent-once stamps, so it shows everyone in the window.
with c as (
  select a.id, trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) as name, pe.email,
    coalesce(a.payment_deadline_at,
      greatest(a.deposit_requested_at, coalesce(a.agreement_signed_at, a.deposit_requested_at)) + interval '24 hours') as deadline,
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
select c.*, round(extract(epoch from deadline - now())/3600, 1) as hours_to_deadline,
  case when now() >= deadline then 'admin_alert' else 'tenant_reminder' end as action,
  'https://alpacaplayhouse.com/staff/rentals.html#applicant='||c.id as admin_url
from c where c.amount_due > 0 and now() >= deadline - interval '4 hours'
order by deadline;
