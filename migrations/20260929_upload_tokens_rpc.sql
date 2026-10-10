-- Upload-token lookup and self-service minting RPCs (step 1 of 2)
--
-- upload_tokens is a bearer-token table: whoever holds a token can submit an
-- ID photo or W-9 against it. Its original policies let anon SELECT every row
-- and any signed-in user do ALL, so every live token could be enumerated.
-- Step 2 (20260929_upload_tokens_lock_policies.sql) drops those policies; this
-- step adds the narrow entry points the public pages need, so it must be
-- applied — and the client that uses it deployed — before step 2.
--
--   * get_upload_token(p_token): exact-match lookup for rentals/verify.html and
--     rentals/w9.html. Returns used/expired rows too so the pages can show the
--     right message. anon + authenticated (a signed-in associate is redirected
--     to verify.html after minting their own token).
--   * request_my_identity_upload_token(): lets a signed-in non-staff user mint
--     an identity_verification token for themselves only (residents/profile.js,
--     associates/worktracking.js). authenticated only.

create or replace function public.get_upload_token(p_token uuid)
returns table (
  token_type text,
  is_used boolean,
  expires_at timestamptz,
  person_id uuid,
  app_user_id uuid,
  person_first_name text,
  person_last_name text,
  app_user_first_name text,
  app_user_last_name text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.token_type, t.is_used, t.expires_at, t.person_id, t.app_user_id,
         p.first_name, p.last_name, u.first_name, u.last_name
  from upload_tokens t
  left join people p on p.id = t.person_id
  left join app_users u on u.id = t.app_user_id
  where t.token = p_token
  limit 1;
$$;

revoke all on function public.get_upload_token(uuid) from public;
grant execute on function public.get_upload_token(uuid) to anon, authenticated;

create or replace function public.request_my_identity_upload_token()
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

  insert into upload_tokens (app_user_id, person_id, token_type, expires_at, created_by)
  values (v_user.id, v_user.person_id, 'identity_verification', now() + interval '7 days', 'self')
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.request_my_identity_upload_token() from public, anon;
grant execute on function public.request_my_identity_upload_token() to authenticated;
