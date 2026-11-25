-- Retain the rendered document per issued link. Only signing functions can access it.
create table public.signing_packets (
  token text primary key,
  packet jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.signing_packets enable row level security;
revoke all on public.signing_packets from public, anon, authenticated;
grant select,insert on public.signing_packets to service_role;
alter table public.event_hosting_requests add column signing_agreement_markdown text;
alter table public.waiver_signatures add column template_snapshot text, add column typed_signature text, add column signup_event_date date, add column signup_request_id uuid unique;

create function public.validate_public_waiver() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.waiver_type = 'event_waiver' then
    if nullif(trim(new.signer_name),'') is null or coalesce(new.signer_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or length(regexp_replace(coalesce(new.signer_phone,''),'[^0-9]','','g')) not between 7 and 15 then
      raise exception 'Enter a full name, valid email, and phone number.';
    end if;
    select content into strict new.template_snapshot from public.lease_templates
      where type='event_waiver' and version=new.template_version and is_active and length(trim(content))>0;
    new.signed_at := now();
  end if;
  return new;
end $$;
create trigger validate_public_waiver before insert on public.waiver_signatures
for each row execute function public.validate_public_waiver();

-- Keep the templates offered on outstanding links when the defaults change.
update public.rental_applications set
  signing_lease_template_id=coalesce(signing_lease_template_id,(select id from public.lease_templates where type='lease' and is_active)),
  waiver_template_id=coalesce(waiver_template_id,(select id from public.lease_templates where type='renter_waiver' and is_active))
where agreement_status='sent' and signing_token is not null and signing_token_expires_at>now();

create or replace function public.sign_waiver(p_waiver jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; existing public.waiver_signatures%rowtype; request_id uuid := nullif(p_waiver->>'request_id','')::uuid;
begin
  if coalesce(p_waiver->>'waiver_type','') not in ('event_waiver','event_agreement') or nullif(trim(p_waiver->>'signer_name'),'') is null then
    raise exception 'Invalid waiver or signer';
  end if;
  if p_waiver->>'waiver_type'='event_waiver' and
    (lower(trim(p_waiver->>'typed_signature')) is distinct from lower(trim(p_waiver->>'signer_name'))
    or p_waiver->>'accepted' is distinct from 'true') then raise exception 'Signature and acceptance are required'; end if;
  if request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
    select * into existing from waiver_signatures where signup_request_id=request_id;
    if found then
      if (existing.signer_name,existing.signer_email,existing.signer_phone,existing.template_version) is distinct from
        (trim(p_waiver->>'signer_name'),trim(p_waiver->>'signer_email'),trim(p_waiver->>'signer_phone'),(p_waiver->>'template_version')::integer) then raise exception 'Waiver request changed'; end if;
      return existing.id;
    end if;
  end if;
  insert into public.waiver_signatures(waiver_type,template_version,signer_name,signer_email,signer_phone,event_request_id,signed_at,user_agent,typed_signature,signup_event_date,signup_request_id)
  values(p_waiver->>'waiver_type',coalesce((p_waiver->>'template_version')::integer,1),trim(p_waiver->>'signer_name'),
    trim(p_waiver->>'signer_email'),trim(p_waiver->>'signer_phone'),nullif(p_waiver->>'event_request_id','')::uuid,now(),left(p_waiver->>'user_agent',4000),trim(p_waiver->>'typed_signature'),nullif(p_waiver->>'event_date','')::date,request_id)
  returning id into result;
  return result;
end $$;

create table public.rental_case_notes (
  id uuid primary key default gen_random_uuid(),
  rental_application_id uuid not null references public.rental_applications(id),
  note text not null check(length(trim(note)) between 1 and 12000),
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.rental_case_notes enable row level security;
revoke all on public.rental_case_notes from public,anon,authenticated;
grant select,insert(rental_application_id,note) on public.rental_case_notes to authenticated;
create policy staff_case_notes_read on public.rental_case_notes for select to authenticated using(public.is_staff_or_admin_user());
create policy staff_case_notes_insert on public.rental_case_notes for insert to authenticated with check(public.is_staff_or_admin_user() and recorded_by=auth.uid());

alter table public.vehicle_rental_signings add column waiver_template_id uuid references public.lease_templates(id), add column waiver_template_version integer;
