-- Square card form on public pages (rentals/apply, rentals/hostevent).
--
-- square_config is admin-only (it holds access tokens and the webhook key), so
-- anonymous pages could no longer read it and the card form failed to load:
-- no Square payment has succeeded since 2026-04-19. The Web Payments SDK needs
-- only the application id and location id, which Square treats as public.
-- This function returns exactly those plus test_mode.

CREATE OR REPLACE FUNCTION public.get_square_public_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'sandbox_app_id', sandbox_app_id,
    'production_app_id', production_app_id,
    'sandbox_location_id', sandbox_location_id,
    'production_location_id', production_location_id,
    'test_mode', test_mode)
  FROM square_config
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_square_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_square_public_config() TO anon, authenticated, service_role;
