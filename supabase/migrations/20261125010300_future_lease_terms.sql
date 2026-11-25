-- Publish new versions only. Never edit the content of a signed template.
do $migration$
declare src public.lease_templates%rowtype; body text;
begin
  select * into strict src from public.lease_templates where name='Alpaca Playhouse Residency Lease' and type='lease' and version=4 and is_active for update;
  if md5(src.content) <> 'f33f77044fe9075711c4bc734de488a9' then raise exception 'Source template changed; review before activation'; end if;
  body := replace(src.content,'## LEAD-BASED PAINT DISCLOSURE',$term$## FLOOD NOTICE

Purchase records showed the property at 160 Still Forest Drive, Cedar Creek, TX 78612 outside the mapped 100-year floodplain when the landlord purchased it. Flood maps can change. Please verify the current designation for your dwelling by entering that address in FEMA’s free Flood Map Service Center and locating your dwelling on the map: https://msc.fema.gov/portal/search

The landlord [ ] is aware / [ ] is not aware that the dwelling is in a 100-year floodplain. If neither option is marked, assume the dwelling is in a 100-year floodplain. A dwelling outside the mapped floodplain can still flood.

Most renters insurance policies exclude flood losses. Seek insurance that covers damage and loss from flooding.

The landlord [ ] is aware / [ ] is not aware that flooding damaged any part of this dwelling during the five years preceding the effective date of this lease.

## LEAD-BASED PAINT DISCLOSURE$term$);
  body := replace(body,$term$The landlord [ ] is aware / [ ] is not aware$term$,$term$The landlord is not aware$term$);
  body := replace(body,$term$ If neither option is marked, assume the dwelling is in a 100-year floodplain.$term$,$term$$term$);
  body := replace(body,$term$The Landlord may give 7 days notice to terminate the agreement, only if tenant is not abiding by house or community rules and has been given 2 warnings, or is causing harm to others. All of the above determined at the discretion of the landlord.$term$,$term$The DEFAULT section governs termination for nonpayment and material rule violations.$term$);
  body := replace(body,$term$Any holdover past the rental term or notice term will be at $90/day.$term$,$term$For an unauthorized holdover, Tenant owes the daily prorated contractual rent for actual occupancy and any additional documented, legally recoverable loss, without double recovery.$term$);
  body := replace(body,$term$When Tenant vacates at the end of the Term, or at the end of a proper notice period, any rent paid for days after the Lease ends and the deposits will be returned within two business days of vacating the property (tenant must provide electronic address for funds transfer).$term$,$term$Landlord will credit unused prepaid rent against lawful amounts owed and account for the balance. The security deposit is handled under SECURITY DEPOSIT.$term$);
  body := replace(body,$term$The Tenant shall handover to the landlord the amount of **{{security_deposit}}** as Security Deposit upon the execution of this Lease (the "Security Deposit"). The remaining will be returned unless additional deductions as described below are retained. The receipt of such Security Deposit is hereby acknowledged by the Landlord who undertakes to hold the same in compliance with applicable laws, rules and regulations.$term$,$term$Security deposit due: **{{security_deposit}}**. Landlord will issue a receipt when payment is received.$term$);
  body := replace(body,$term$**A. Deductions.** Upon the termination of the Lease, the Landlord may deduct the following from the Security Deposit:
- Unpaid rent
- Late fees
- Cost of repairs beyond ordinary wear and tear
- Stains of Carpet in Room
- Room Setup fee in the amount of $45, if the unit is not returned to the airbnb rental-ready condition (with clean linens on bed and old linens cleaned and folded)
- Room Setup fee for any other rooms used
- Damages due to parking issues, such as grass problems due to driving on grass, which must be leveled and replanted
- Broken or missing items
- Hold overs beyond the termination date; which shall be charged at $90/day rate
- Infringing upon neighbor rights as noted below
- Disposal of Trash or other possessions not disposed

**B. Return.** The Security Deposit or the balance thereof shall be returned by the Landlord to the Tenant within 5 business days after the termination of the Lease or in accordance with the applicable law on Security Deposit, whichever is sooner. In the event that the Landlord shall make any allowable deduction, the Landlord shall provide the tenant with an itemized list of all deductions made specifying the amounts and the respective expenses to which the Security Deposit or parts of it was applied.

$term$,$term$**A. Deductions.** Landlord may deduct unpaid rent and reasonable charges for damage or cleaning for which Tenant is legally liable, excluding ordinary wear and tear. No automatic charge applies merely because someone complains. This lease imposes no late fee.

**B. Return.** Landlord will refund the balance and send a written itemization of deductions within 30 days after surrender, subject to the written forwarding-address provisions of Texas Property Code § 92.107. Tenant may supply a forwarding address separately in writing.

$term$);
  body := replace(body,$term$Complaints from neighbors for outdoor noise after 8:00pm will be subject to a $100 fee.$term$,$term$Observe outdoor quiet hours after 8:00 p.m.$term$);
  body := replace(body,$term$Complaints from neighbors for guests parking on their property will be subject to a $100 fee.$term$,$term$$term$);
  body := replace(body,$term$Any complaints will trigger a $100 deduction from the deposit for each incident.$term$,$term$Landlord will document and investigate reported violations.$term$);
  body := replace(body,$term$If this is not done, a $100 cleaning fee will be charged.$term$,$term$Tenant is responsible for reasonable, documented cleaning costs resulting from a breach.$term$);
  body := replace(body,$term$Any time period beyond this will be subject to a $100/day penalty.$term$,$term$$term$);
  body := replace(body,$term$**Follow all house rules as stated in alpacaplayhouse.com website.**$term$,$term$Follow the house rules in this signed lease and its signed attachments. Changes to contractual rules require a written amendment signed by both parties.$term$);
  body := replace(body,$term$In the event that the Landlord breaches any of the terms and conditions of this Lease or any applicable laws, rules or codes, the Tenant may avail of any of the remedies available under the law. In the event that the Tenant breaches or fails to comply with any of the terms and conditions of this Lease or any applicable laws, rules or codes the Landlord shall afford the Tenant two days to remedy or rectify the same. This period shall commence on the day the Tenant receives Notice of such breach or non-compliance with the request to rectify the same. If the Tenant fails to comply or rectify the breach or if the breach cannot reasonably be rectified or remedied, the Tenant shall be in default. Upon the Tenants default, the Landlord may terminate the Lease by sending the notice of default and consequent termination of the lease to the Tenant and thereafter recover possession of the Property.$term$,$term$Nonpayment. Landlord may pursue unpaid rent and possession after giving the notice and opportunity to pay required by applicable law. When nonpayment alone is the ground and Tenant had no late or delinquent rent before the month of notice, Landlord will give written notice to pay rent or vacate.

Material rule violations. For a curable material breach Landlord will give written notice describing the conduct and allow two days after receipt to cure. If the breach continues, recurs after cure, or cannot reasonably be cured, Landlord may terminate the right of possession by lawful written notice. Either party may seek immediate lawful assistance for threats to safety. Landlord will observe applicable notice periods, fair housing and anti-retaliation protections and seek judicial possession if Tenant remains. Collection reminders do not serve as notices to vacate.$term$);
  body := replace(body,$term$In the event that the Tenant(s) abandons the Property the Landlord may declare the Lease terminated, recover possession of the Property, enter the premises, remove the Tenants belongings and lease the same to another without incurring any liability to the Tenant for doing the same. In the event of the abandonment of the Property, the Landlord may recover from the Tenant unpaid rent until the Property is leased to another person or otherwise occupied by the Landlord or another under the Landlords right.$term$,$term$Landlord will document surrender or abandonment, handle belongings as required by law and make reasonable efforts to relet. Unpaid rent or a temporary absence alone does not establish abandonment.$term$);
  body := replace(body,$term$Unless this Lease states otherwise (for example, in the Additional Terms), Tenant may not terminate this Lease before the end of the Term. If Tenant leaves early, rent for the full Term remains due and prepaid rent is not refunded. For a month-to-month Lease, Tenant may end the Lease only by giving the written notice required under Lease Term.$term$,$term$Tenant may exercise statutory termination rights. If Tenant abandons in breach, Landlord will mitigate damages, credit replacement rent and payments received, and claim only legally recoverable losses. Month-to-month termination is governed by the Lease Term. Tenants may have special statutory rights to terminate the lease early in certain situations involving family violence, military deployment or transfer, or certain sex offenses or stalking.$term$);
  body := replace(body,$term$## FLOOD NOTICE$term$,$term$## REPAIR REMEDIES

**Report conditions materially affecting an ordinary tenant’s physical health or safety to the person or place where rent is normally paid. If Landlord fails to make a diligent effort to repair within a reasonable time after the required notice, qualifying tenants may terminate, seek a court remedy, or arrange repairs and deduct their cost as allowed by Texas Property Code §§ 92.056 and 92.0561. These remedies have notice, rent-current, timing, and other requirements.**

## FLOOD NOTICE$term$);
  body := replace(body,$term$The Landlord shall not be liable for any injury to the Tenant(s) or any other persons or property entering the Property occurring within the Property during the Term of the Lease. Neither shall the Landlord be liable for any damage to the structure within which the Property is located or any part thereof. The Tenant hereby agrees to hold the Landlord harmless from and indemnify the Landlord for any and all claims or damage not arising solely from the Landlords acts, omission, fault or negligence.$term$,$term$Each party remains responsible to the extent provided by law for its acts and omissions. The attached property waiver concerns voluntary recreational activities. Statutory landlord duties and tenant remedies remain in effect.$term$);
  body := replace(body,'**Rent Schedule.** Monthly rent is **due on the 1st of each month**.', '**Rent Schedule.** For a monthly rate, rent is due on the first of each month. For a weekly, biweekly or nightly rate, rent is due at the beginning of each stated rental period starting on the move-in date.');
  body := replace(body,'## SIGNATURES',$term$## HOUSE RULES — NOVEMBER 24, 2026

- NO MEAT inside the house – You can store meat in the doghouse refrigerator (not garage) and cook it outside
- NO ALCOHOL (unless it's your wedding)
- Bring healthy food to share; include vegetarian options
- Bring a water bottle – We have 3 filtered water dispensers. Don't bring plastic water bottles. Bottles to borrow are above the oven.
- Don't leave bags or items on Living Room or Kitchen counters – stash in the dining room
- Don't leave beverage cans, food items, or random stuff in the living room
- Clean up immediately after yourself
- Can't find something? Check the "Scolding Mess Box" out back
- Use the Outhouse! There's a full bathroom with hot water shower in the Outhouse in the front yard – it's amazing and less crowded. Please use it when possible.
- Toilets: Only toilet paper goes in toilets. Nothing else. You will wreck things.
- No calls or video calls in the living room – it disrupts others, especially during events
- Quiet hours: Before 9am and after 9:30pm
- Good alternatives for calls or focused work: the garage, dining room, or sauna
- Back screen door: Keep it closed at all times – we have local wildlife that wanders in
- Front door: Creates a wind tunnel when open – keep it closed. (If you want it to stay open, hold it all the way open and it will stay magnetically.)

## SIGNATURES$term$);
  update public.lease_templates set is_active=false where type=src.type and is_active;
  insert into public.lease_templates(name,type,content,version,is_active) values(src.name,src.type,body,6,true);
  select * into strict src from public.lease_templates where name='Renter Liability Waiver' and type='renter_waiver' and version=1 for update;
  if md5(src.content) <> '63c7183f9990c080c8864fe2f5029739' then raise exception 'Source template changed; review before activation'; end if;
  body := src.content;
  body := replace(body,$term$("Owner")$term$,$term$("Owner"). The Owner and its trustees, agents, and employees acting in that capacity are the "Released Parties".$term$);
  body := replace(body,$term$## 7. GOVERNING LAW$term$,$term$This release concerns voluntary recreational use of the property. It excludes gross negligence, intentional misconduct, and duties or remedies that cannot be waived. Each adult participant signs individually at https://alpacaplayhouse.com/waiver/.

## 7. GOVERNING LAW$term$);
  update public.lease_templates set is_active=false where type=src.type and is_active;
  insert into public.lease_templates(name,type,content,version,is_active) values(src.name,src.type,body,2,true);
  select * into strict src from public.lease_templates where name='Event/Guest Liability Waiver' and type='event_waiver' and version=1 for update;
  if md5(src.content) <> 'e5928e032b6801e964a1f2aa50b45e99' then raise exception 'Source template changed; review before activation'; end if;
  body := src.content;
  body := replace(body,$term$("Owner")$term$,$term$("Owner"). The Owner and its trustees, agents, and employees acting in that capacity are the "Released Parties".$term$);
  body := replace(body,$term$## 5. GOVERNING LAW$term$,$term$This release concerns voluntary recreational use of the property. It excludes gross negligence, intentional misconduct, and duties or remedies that cannot be waived. Each adult participant signs individually at https://alpacaplayhouse.com/waiver/.

## 5. GOVERNING LAW$term$);
  update public.lease_templates set is_active=false where type=src.type and is_active;
  insert into public.lease_templates(name,type,content,version,is_active) values(src.name,src.type,body,2,true);
end $migration$;

do $guest$
declare src public.lease_templates%rowtype; body text;
begin
  select * into strict src from public.lease_templates where type='lease' and md5(content)='cf0f9972893f450c3a33dfb003031c1b' and version=1;
  body:=replace(src.content,$term$The Guest agrees to vacate the Suite and remove all belongings by the check-out date in Section 1. **Continued occupancy after that date is not authorized.** If the Guest remains past the check-out date without the Host's written consent, the Guest and the Booking Party will be jointly responsible for a holdover fee of **$200 per day** (or portion of a day) for each day the Guest remains, in addition to any resulting costs or damages. Nothing in this Section grants the Guest a right to hold over, and the Host may pursue any lawful remedy to recover possession of the Suite.$term$,$term$Guest must vacate by the agreed checkout date. For an unauthorized holdover, Host may seek lawful possession and documented recoverable losses without double recovery.$term$);
  body:=replace(body,$term$The Booking Party arranged and paid for this stay on the Guest's behalf and is responsible, together with the Guest, for the Guest's compliance with this Agreement, including any holdover fees under Section 6 and any charges for damage beyond normal wear.$term$,$term$Guest agrees to the duties in this agreement. Any separate obligation of a booking party must be established by its own agreement.$term$);
  insert into public.lease_templates(name,type,content,version,is_active) values(src.name,src.type,body,2,false);
end $guest$;

create function public.select_new_rental_templates() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare pinned public.lease_templates%rowtype; market text;
begin
  if new.signing_token is null or new.signing_token is not distinct from old.signing_token then return new; end if;
  select coalesce((select location from spaces where id=new.approved_space_id),(select residence_location from people where id=new.person_id)) into market;
  if market='sharingwood' then return new; end if;
  select * into pinned from lease_templates where id=new.signing_lease_template_id;
  if pinned.id is null or pinned.name='Alpaca Playhouse Residency Lease' then
    select id into strict new.signing_lease_template_id from lease_templates where type='lease' and is_active;
  elsif pinned.name like 'Short-Term Guest Agreement%' then
    select id into strict new.signing_lease_template_id from lease_templates where name=pinned.name and type='lease' order by version desc limit 1;
  elsif pinned.content like '%The Landlord may give 7 days%' then
    raise exception 'This custom lease uses retired default terms. Review its special terms and select a revised template before reissuing.';
  end if;
  select id into strict new.waiver_template_id from lease_templates where type='renter_waiver' and is_active and length(trim(content))>0;
  return new;
end $$;
create trigger select_new_rental_templates before update of signing_token on rental_applications for each row execute function public.select_new_rental_templates();
