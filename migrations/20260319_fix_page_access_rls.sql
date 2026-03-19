-- Fix: add WITH CHECK to FOR ALL policies so INSERT/upsert works through PostgREST
-- Without explicit WITH CHECK, Supabase rejects inserts even for admin/oracle users

-- page_access_settings
DROP POLICY IF EXISTS "Admins can manage page settings" ON page_access_settings;
CREATE POLICY "Admins can manage page settings"
  ON page_access_settings FOR ALL
  USING (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  )
  WITH CHECK (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  );

-- page_access_grants
DROP POLICY IF EXISTS "Admins can manage grants" ON page_access_grants;
CREATE POLICY "Admins can manage grants"
  ON page_access_grants FOR ALL
  USING (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  )
  WITH CHECK (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  );
