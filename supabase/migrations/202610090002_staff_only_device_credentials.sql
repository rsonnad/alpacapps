-- Device credentials must never be readable or writable by public/resident accounts.
-- Existing payment-secret column grants remain server-only. Server workers retain
-- service_role access. Staff/admin/oracle retain the device settings UI.
BEGIN;
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'google_tts_config', 'lg_config', 'anova_config', 'govee_config',
    'nest_config', 'home_assistant_config', 'weather_config', 'vapi_config',
    'tesla_accounts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user())',
      t || '_staff_only', t);
    -- TRUNCATE does not obey RLS. Do not grant it to any browser role.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- This SECURITY DEFINER RPC formerly bypassed table RLS and returned the HA
-- token to everyone. Removing the anon grant alone is insufficient: PUBLIC
-- gets EXECUTE by default, and signed-in residents also need a caller check.
CREATE OR REPLACE FUNCTION public.get_kiosk_haos_config()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT coalesce(public.is_staff_or_admin_user(), false) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT json_build_object('base_url', ha_base_url, 'token', ha_token)
    FROM public.home_assistant_config WHERE id = 1
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_kiosk_haos_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_haos_config() TO authenticated, service_role;

-- Printer access codes are bearer credentials, just like the proxy secret.
-- Keep the existing public non-secret column grants and service-role access.
REVOKE SELECT (check_code), INSERT (check_code), UPDATE (check_code)
  ON public.printer_config FROM PUBLIC, anon, authenticated;
COMMIT;
