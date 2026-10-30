-- Rental invitation tokens are bearer credentials. Public pages may check a
-- token they already possess, but may not list or mutate other people's tokens.
BEGIN;
DROP POLICY IF EXISTS anon_read ON public.access_tokens;
DROP POLICY IF EXISTS auth_all ON public.access_tokens;
CREATE POLICY access_tokens_staff_only ON public.access_tokens
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin_user())
  WITH CHECK (public.is_staff_or_admin_user());
REVOKE ALL ON public.access_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_tokens TO authenticated;
GRANT ALL ON public.access_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.validate_rental_access_token(p_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.access_tokens
    WHERE token = p_token
      AND nullif(p_token, '') IS NOT NULL
      AND NOT coalesce(is_revoked, true)
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.validate_rental_access_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_rental_access_token(text) TO anon, authenticated, service_role;
COMMIT;
