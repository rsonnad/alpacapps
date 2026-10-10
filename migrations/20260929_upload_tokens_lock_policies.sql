-- Lock down upload_tokens (step 2 of 2)
--
-- Apply only after 20260929_upload_tokens_rpc.sql is applied AND the client
-- that reads tokens via get_upload_token() / mints via
-- request_my_identity_upload_token() is live on GitHub Pages.
--
-- After this: anon has no direct access; authenticated access is limited to
-- staff/admin/oracle (staff/rentals.js, staff/events.js, staff/worktracking.js
-- via identity-service / native-signing-service). Edge functions use the
-- service role and keep service_role_all_upload_tokens.

drop policy if exists "anon_select_upload_tokens" on upload_tokens;
drop policy if exists "authenticated_all_upload_tokens" on upload_tokens;

drop policy if exists "staff_all_upload_tokens" on upload_tokens;
create policy "staff_all_upload_tokens" on upload_tokens
  for all to authenticated
  using (public.is_staff_or_admin_user())
  with check (public.is_staff_or_admin_user());

-- Defense in depth: anon never needs table privileges here.
revoke all on table upload_tokens from anon;
