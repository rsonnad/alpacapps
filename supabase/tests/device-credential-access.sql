-- Run through the Management API as postgres. No credentials are returned.
BEGIN;
DO $$
DECLARE
  tables text[] := ARRAY['google_tts_config','lg_config','anova_config','govee_config',
    'nest_config','home_assistant_config','weather_config','vapi_config','tesla_accounts'];
  t text;
  staff_uid uuid;
  ordinary_uid uuid;
  expected bigint;
  visible bigint;
  blocked boolean;
BEGIN
  SELECT auth_user_id INTO staff_uid FROM public.app_users
    WHERE role IN ('staff','admin','oracle') AND auth_user_id IS NOT NULL LIMIT 1;
  SELECT auth_user_id INTO ordinary_uid FROM public.app_users
    WHERE role NOT IN ('staff','admin','oracle') AND auth_user_id IS NOT NULL LIMIT 1;
  IF staff_uid IS NULL OR ordinary_uid IS NULL THEN
    RAISE EXCEPTION 'Need existing staff and ordinary identities for access regression';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO expected;
    IF has_table_privilege('anon','public.'||t,'TRUNCATE')
       OR has_table_privilege('authenticated','public.'||t,'TRUNCATE') THEN
      RAISE EXCEPTION 'TRUNCATE privilege leaked on %',t;
    END IF;
    PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
    SET LOCAL ROLE anon;
    blocked := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I',t) INTO visible;
    EXCEPTION WHEN insufficient_privilege THEN blocked := true;
    END;
    RESET ROLE;
    IF NOT blocked THEN RAISE EXCEPTION 'Anonymous table access leaked on %',t; END IF;

    PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',ordinary_uid)::text,true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO visible;
    RESET ROLE;
    IF visible <> 0 THEN RAISE EXCEPTION 'Ordinary account sees credentials on %',t; END IF;

    PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',staff_uid)::text,true);
    SET LOCAL ROLE authenticated;
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO visible;
    RESET ROLE;
    IF visible <> expected THEN RAISE EXCEPTION 'Staff access broken on %',t; END IF;

    PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
    SET LOCAL ROLE service_role;
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO visible;
    RESET ROLE;
    IF visible <> expected THEN RAISE EXCEPTION 'Server access broken on %',t; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.get_kiosk_haos_config()','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous HA RPC access leaked';
  END IF;
  PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',ordinary_uid)::text,true);
  SET LOCAL ROLE authenticated;
  blocked := false;
  BEGIN
    PERFORM public.get_kiosk_haos_config();
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  RESET ROLE;
  IF NOT blocked THEN RAISE EXCEPTION 'Ordinary HA RPC access leaked'; END IF;
  PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',staff_uid)::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM public.get_kiosk_haos_config();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SET LOCAL ROLE service_role;
  PERFORM public.get_kiosk_haos_config();
  RESET ROLE;
  IF has_column_privilege('anon','public.printer_config','check_code','SELECT')
     OR has_column_privilege('authenticated','public.printer_config','check_code','SELECT') THEN
    RAISE EXCEPTION 'Printer bearer code exposed';
  END IF;
  IF has_column_privilege('anon','public.stripe_config','secret_key','SELECT')
     OR has_column_privilege('authenticated','public.stripe_config','secret_key','SELECT') THEN
    RAISE EXCEPTION 'Stripe secret exposed';
  END IF;
  IF NOT has_column_privilege('anon','public.stripe_config','publishable_key','SELECT') THEN
    RAISE EXCEPTION 'Public payment config broken';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: anonymous and ordinary accounts denied; staff and service role allowed; public payment config preserved' AS result;

BEGIN;
DO $$
DECLARE
  supplied text;
  expected boolean;
  actual boolean;
  ordinary_uid uuid;
  visible bigint;
BEGIN
  SELECT auth_user_id INTO ordinary_uid FROM public.app_users
    WHERE role NOT IN ('staff','admin','oracle') AND auth_user_id IS NOT NULL LIMIT 1;
  IF has_table_privilege('anon','public.access_tokens','SELECT')
     OR has_table_privilege('authenticated','public.access_tokens','TRUNCATE') THEN
    RAISE EXCEPTION 'Bearer-token inventory privileges leaked';
  END IF;
  SELECT token, NOT coalesce(is_revoked,true) AND (expires_at IS NULL OR expires_at > now())
    INTO supplied,expected FROM public.access_tokens WHERE token IS NOT NULL LIMIT 1;
  SET LOCAL ROLE anon;
  IF public.validate_rental_access_token('') OR public.validate_rental_access_token(NULL)
     OR public.validate_rental_access_token('invalid-audit-' || gen_random_uuid()::text) THEN
    RAISE EXCEPTION 'Invalid rental token accepted';
  END IF;
  IF supplied IS NOT NULL THEN
    actual := public.validate_rental_access_token(supplied);
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Existing rental link broken'; END IF;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',ordinary_uid)::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visible FROM public.access_tokens;
  RESET ROLE;
  IF visible <> 0 THEN RAISE EXCEPTION 'Ordinary account sees bearer tokens'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: rental bearer tokens private; exact-token validation preserved' AS result;
