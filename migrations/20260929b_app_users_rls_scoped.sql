-- app_users: replace temp_read_app_users (USING true, role public) with scoped reads
--
-- Part B of 2. Apply only after 20260929a_app_users_safe_read_rpcs.sql AND after
-- the client that uses those RPCs is live on GitHub Pages.
--
-- After this:
--   * anon: no rows (public-facing reads go through get_directory_profile /
--     get_upload_token_name)
--   * authenticated: own row (auth_user_id = auth.uid()); admin/oracle/staff: all rows
--   * residents/associates get other members' names via list_member_directory()
--   * demo role and permission-granted non-staff no longer read all rows (see PRODUCTDESIGN.md)
--
-- The 116 policies on other tables that subquery app_users only look up the
-- caller's own row, so they keep working. is_staff_or_admin_user() is SECURITY
-- DEFINER, so the staff policy does not recurse into app_users' own RLS.

DROP POLICY IF EXISTS "temp_read_app_users" ON public.app_users;

DROP POLICY IF EXISTS "app_users_select_own" ON public.app_users;
CREATE POLICY "app_users_select_own"
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "app_users_select_staff" ON public.app_users;
CREATE POLICY "app_users_select_staff"
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin_user());
