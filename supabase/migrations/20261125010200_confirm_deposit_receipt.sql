-- Shared receipt allocation. Callers hold the confirmation or operator request in the same transaction.
create function public.post_deposit_receipt(p_application uuid,kind text,p_amount numeric,method text,p_reference text,p_date date,p_source text)
returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare a rental_applications%rowtype; due numeric; paid numeric; applied numeric; receipt uuid; person_name text;
begin
  select * into strict a from rental_applications where id=p_application for update;
  select concat_ws(' ',first_name,last_name) into person_name from people where id=a.person_id;
    if kind='move_in_deposit' then
      if a.move_in_deposit_paid then return 0; end if;
      due:=coalesce(a.move_in_deposit_amount,0);
      if a.reservation_deposit_paid then due:=greatest(0,due-coalesce(a.reservation_deposit_amount,0)); end if;
      if a.application_fee_paid then due:=greatest(0,due-coalesce(a.application_fee_amount,0)); end if;
    else
      if a.security_deposit_paid then return 0; end if;
      due:=coalesce(a.security_deposit_amount,0);
    end if;
    select coalesce(sum(amount_paid),0) into paid from rental_payments where rental_application_id=a.id and payment_type=kind;
    applied:=least(p_amount,greatest(0,due-paid));
    if applied=0 then return 0; end if;
    insert into rental_payments(rental_application_id,payment_type,amount_due,amount_paid,paid_date,payment_method,transaction_id)
      values(a.id,kind,due,applied,p_date,method,p_reference) returning id into receipt;
    insert into ledger(direction,category,amount,payment_method,transaction_date,person_id,person_name,rental_application_id,rental_payment_id,status,description,recorded_by)
      values('income',kind,applied,method,p_date,a.person_id,person_name,a.id,receipt,'completed','Confirmed deposit payment',p_source);
    if paid+applied>=due then
      if kind='move_in_deposit' then

        update rental_applications set move_in_deposit_paid=true,move_in_deposit_paid_at=now(),move_in_deposit_method=method where id=a.id;
      else

        update rental_applications set security_deposit_paid=true,security_deposit_paid_at=now(),security_deposit_method=method where id=a.id;
      end if;
    end if;

  update rental_applications set deposit_status=case when
    (coalesce(move_in_deposit_paid,false) or coalesce(move_in_deposit_amount,0)=0) and
    (coalesce(security_deposit_paid,false) or coalesce(security_deposit_amount,0)=0) then 'received' else 'partial' end,updated_at=now() where id=a.id;
  return applied;
end $$;
revoke all on function public.post_deposit_receipt(uuid,text,numeric,text,text,date,text) from public,anon,authenticated;
-- Lock both confirmation and application. All accounting entries commit together.
create function public.apply_deposit_confirmation(p_token text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  c deposit_payment_confirmations%rowtype;
  a rental_applications%rowtype;
  kind text; due numeric; paid numeric; applied numeric; remaining numeric;
  method text; receipt uuid; person_name text;
  lines text[] := '{}';
begin
  select * into strict c from deposit_payment_confirmations where token::text=p_token for update;
  if c.status<>'pending' then return jsonb_build_object('status',c.status); end if;
  if c.expires_at<now() then raise exception 'Confirmation expired'; end if;
  if c.amount is null or c.amount<=0 then raise exception 'Invalid payment amount'; end if;
  select * into strict a from rental_applications where id=c.rental_application_id for update;
  select concat_ws(' ',first_name,last_name) into person_name from people where id=a.person_id;
  method := coalesce(c.payment_method,'zelle');
  if nullif(c.confirmation_number,'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(c.confirmation_number,0));
    if exists (select 1 from rental_payments where transaction_id=c.confirmation_number) then
      raise exception 'Payment reference already exists. Reconcile the existing receipt before confirming.';
    end if;
  end if;
  remaining := c.amount;
  foreach kind in array array['move_in_deposit','security_deposit'] loop
    exit when remaining=0;
    applied:=public.post_deposit_receipt(a.id,kind,remaining,method,c.confirmation_number,(now() at time zone 'America/Chicago')::date,'system:zelle-confirm');
    if applied=0 then continue; end if;
    remaining:=remaining-applied;
    lines:=array_append(lines,format('%s: $%s',replace(kind,'_',' '),applied));
  end loop;
  if remaining>0 then raise exception 'Receipt exceeds the outstanding deposit balance. Allocate the excess manually before confirming.'; end if;
  update deposit_payment_confirmations set status='confirmed',resolved_at=now(),resolved_by='admin_email_link' where id=c.id;
  return jsonb_build_object('status','applied','lines',lines);
end $$;
revoke all on function public.apply_deposit_confirmation(text) from public,anon,authenticated;
grant execute on function public.apply_deposit_confirmation(text) to service_role;

create table public.manual_deposit_receipts (
  request_id uuid primary key, application_id uuid not null, kind text not null, amount numeric not null
);
alter table public.manual_deposit_receipts enable row level security;
revoke all on public.manual_deposit_receipts from public,anon,authenticated;

create function public.record_staff_deposit(p_application uuid,p_kind text,p_amount numeric,p_method text,p_reference text,p_date date,p_request uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare applied numeric; previous manual_deposit_receipts%rowtype;
begin
  if not coalesce(is_staff_or_admin_user(),false) then raise exception 'Staff access required'; end if;
  if p_kind not in ('move_in_deposit','security_deposit') or p_kind is null or p_amount is null or p_amount<=0 or round(p_amount,2)<>p_amount or p_date is null then raise exception 'Invalid deposit receipt'; end if;
  insert into manual_deposit_receipts values(p_request,p_application,p_kind,p_amount) on conflict do nothing;
  if not found then
    select * into strict previous from manual_deposit_receipts where request_id=p_request;
    if (previous.application_id,previous.kind,previous.amount) is distinct from (p_application,p_kind,p_amount) then raise exception 'Receipt request changed'; end if;
    return;
  end if;
  if nullif(p_reference,'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_reference,0));
    if exists(select 1 from rental_payments where transaction_id=p_reference) then raise exception 'Reference already recorded'; end if;
  end if;
  applied:=post_deposit_receipt(p_application,p_kind,p_amount,p_method,p_reference,p_date,'staff:'||auth.uid()::text);
  if applied<>p_amount then raise exception 'Entered amount exceeds remaining deposit balance'; end if;
end $$;
revoke all on function public.record_staff_deposit(uuid,text,numeric,text,text,date,uuid) from public,anon;
grant execute on function public.record_staff_deposit(uuid,text,numeric,text,text,date,uuid) to authenticated;

create function public.record_staff_rent(p_request uuid,p_assignment uuid,p_amount numeric,p_start date,p_end date,p_method text,p_reference text,p_prorated boolean,p_days integer,p_notes text)
returns public.rental_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt rental_payments%rowtype; tenant uuid; tenant_name text; paid_on date := (now() at time zone 'America/Chicago')::date;
begin
  if not coalesce(is_staff_or_admin_user(),false) then raise exception 'Staff access required'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_start is null or p_end is null or p_end<p_start then raise exception 'Invalid amount or rent period'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into receipt from rental_payments where id=p_request;
  if found then
    if (receipt.assignment_id,receipt.amount_paid,receipt.period_start,receipt.period_end) is distinct from (p_assignment,p_amount,p_start,p_end) then raise exception 'Receipt request changed'; end if;
    return receipt;
  end if;
  select a.person_id,concat_ws(' ',p.first_name,p.last_name) into strict tenant,tenant_name from assignments a join people p on p.id=a.person_id where a.id=p_assignment;
  if nullif(p_reference,'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_reference,0));
    if exists(select 1 from rental_payments where transaction_id=p_reference) then raise exception 'Reference already recorded'; end if;
  end if;
  insert into rental_payments(id,assignment_id,payment_type,amount_due,amount_paid,paid_date,payment_method,transaction_id,period_start,period_end,is_prorated,prorate_days,notes)
  values(p_request,p_assignment,case when p_prorated then 'prorated_rent' else 'rent' end,p_amount,p_amount,paid_on,p_method,p_reference,p_start,p_end,p_prorated,p_days,p_notes) returning * into receipt;
  insert into ledger(direction,category,amount,payment_method,transaction_date,period_start,period_end,person_id,person_name,assignment_id,rental_payment_id,status,description,notes,recorded_by)
  values('income',receipt.payment_type,p_amount,coalesce(p_method,'other'),paid_on,p_start,p_end,tenant,tenant_name,p_assignment,receipt.id,'completed','Rent receipt',p_notes,'staff:'||auth.uid()::text);
  return receipt;
end $$;
revoke all on function public.record_staff_rent(uuid,uuid,numeric,date,date,text,text,boolean,integer,text) from public,anon;
grant execute on function public.record_staff_rent(uuid,uuid,numeric,date,date,text,text,boolean,integer,text) to authenticated;
