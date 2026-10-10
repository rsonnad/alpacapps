-- Access regression for 202610090004_lock_down_pii_and_anon_writes.sql.
-- Run through the Management API as postgres. Rolls back; returns counts only.
BEGIN;

-- Row count of `q` as `r` (anon/authenticated) with auth uid `uid`; -1 if denied.
CREATE FUNCTION pg_temp.count_as(r text, uid uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN json_build_object('role', r)
         ELSE json_build_object('role', r, 'sub', uid) END::text, true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE format('SELECT count(*) FROM (%s) x', q) INTO n;
  EXCEPTION WHEN insufficient_privilege THEN n := -1;
  END;
  RESET ROLE;
  RETURN n;
END $$;

CREATE TEMP TABLE results (check_name text, expected text, actual bigint, ok boolean) ON COMMIT DROP;

DO $$
DECLARE
  staff_uid uuid;
  assoc_uid uuid;
  assoc_app_id uuid;
  own_ids bigint;
  total bigint;
BEGIN
  SELECT auth_user_id INTO staff_uid FROM public.app_users
    WHERE role = 'staff' AND auth_user_id IS NOT NULL LIMIT 1;
  SELECT u.auth_user_id, u.id INTO assoc_uid, assoc_app_id FROM public.app_users u
    WHERE u.role IN ('associate','resident') AND u.auth_user_id IS NOT NULL
    ORDER BY EXISTS (SELECT 1 FROM public.identity_verifications iv WHERE iv.app_user_id = u.id) DESC
    LIMIT 1;
  IF staff_uid IS NULL OR assoc_uid IS NULL THEN
    RAISE EXCEPTION 'Need existing staff and associate/resident identities';
  END IF;

  SELECT count(*) INTO total FROM public.identity_verifications;
  SELECT count(*) INTO own_ids FROM public.identity_verifications WHERE app_user_id = assoc_app_id;

  -- identity_verifications
  INSERT INTO results SELECT 'idv anon', 'denied', pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.identity_verifications'), NULL;
  INSERT INTO results SELECT 'idv staff sees all', total::text, pg_temp.count_as('authenticated', staff_uid, 'SELECT 1 FROM public.identity_verifications'), NULL;
  INSERT INTO results SELECT 'idv non-staff sees own only', own_ids::text, pg_temp.count_as('authenticated', assoc_uid, 'SELECT 1 FROM public.identity_verifications'), NULL;

  -- staff-only tables
  INSERT INTO results SELECT 'payouts anon', 'denied', pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.payouts'), NULL;
  INSERT INTO results SELECT 'payouts non-staff', '0', pg_temp.count_as('authenticated', assoc_uid, 'SELECT 1 FROM public.payouts'), NULL;
  INSERT INTO results SELECT 'payouts staff', (SELECT count(*) FROM public.payouts)::text, pg_temp.count_as('authenticated', staff_uid, 'SELECT 1 FROM public.payouts'), NULL;
  INSERT INTO results SELECT 'signature_audit_log staff', (SELECT count(*) FROM public.signature_audit_log)::text, pg_temp.count_as('authenticated', staff_uid, 'SELECT 1 FROM public.signature_audit_log'), NULL;
  INSERT INTO results SELECT 'system_commands anon', 'denied', pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.system_commands'), NULL;

  -- public reads preserved
  INSERT INTO results SELECT 'assignments anon read', (SELECT count(*) FROM public.assignments)::text, pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.assignments'), NULL;
  INSERT INTO results SELECT 'lease_templates anon read', (SELECT count(*) FROM public.lease_templates)::text, pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.lease_templates'), NULL;
  INSERT INTO results SELECT 'associate_schedules signed-in read', (SELECT count(*) FROM public.associate_schedules)::text, pg_temp.count_as('authenticated', assoc_uid, 'SELECT 1 FROM public.associate_schedules'), NULL;

  -- write privileges (grant level)
  INSERT INTO results SELECT 'anon cannot write ' || t, 'denied',
    CASE WHEN has_table_privilege('anon', 'public.' || t, 'INSERT') OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
         OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN 1 ELSE -1 END, NULL
    FROM unnest(ARRAY['payouts','assignments','lease_templates','todo_items','work_groups','associate_schedules',
                      'permit_tasks','printer_devices','vehicle_rentals','system_commands','govee_devices']) t;
  INSERT INTO results SELECT 'signed-in can still write associate_schedules', 'granted',
    CASE WHEN has_table_privilege('authenticated', 'public.associate_schedules', 'INSERT') THEN 1 ELSE -1 END, NULL;

  UPDATE results SET ok = CASE
    WHEN expected = 'denied'  THEN actual = -1
    WHEN expected = 'granted' THEN actual = 1
    ELSE actual = expected::bigint END;
END $$;

SELECT check_name, expected, actual, ok FROM results ORDER BY ok, check_name;
ROLLBACK;
