-- W-9 self-serve link + payout gate (2026-10-03)
--
-- Payouts now require associate_profiles.w9_status = 'submitted'
-- (enforced in stripe-payout, paypal-payout, pay-pending-associates).
-- Associates need a way to get their own W-9 link from the Work Tracking
-- Payment tab; upload_tokens is staff-only under RLS, so mirror
-- request_my_identity_upload_token() (20260929_upload_tokens_rpc.sql).
-- Reuses an open link so repeat clicks don't pile up tokens.

create or replace function public.request_my_w9_upload_token()
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_user app_users%rowtype;
  v_token uuid;
begin
  select * into v_user from app_users where auth_user_id = auth.uid() limit 1;
  if v_user.id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not exists (select 1 from associate_profiles where app_user_id = v_user.id) then
    raise exception 'No associate profile' using errcode = '42501';
  end if;

  select token into v_token
  from upload_tokens
  where app_user_id = v_user.id
    and token_type = 'w9_submission'
    and not is_used
    and expires_at > now() + interval '1 hour'
  order by created_at desc
  limit 1;

  if v_token is null then
    insert into upload_tokens (app_user_id, person_id, token_type, expires_at, created_by)
    values (v_user.id, v_user.person_id, 'w9_submission', now() + interval '14 days', 'self')
    returning token into v_token;
  end if;

  return v_token;
end;
$$;

revoke all on function public.request_my_w9_upload_token() from public, anon;
grant execute on function public.request_my_w9_upload_token() to authenticated;
