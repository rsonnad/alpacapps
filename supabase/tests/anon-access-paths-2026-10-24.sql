-- Access regression for 20261024_close_anon_access_paths.sql.
-- Run through the Management API as postgres. Rolls back; returns counts only.
BEGIN;

-- Row count of `q` as `r` (anon/authenticated) with auth uid `uid`; -1 if denied.
CREATE FUNCTION pg_temp.count_as(r text, uid uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN json_build_object('role', r)
         ELSE json_build_object('role', r, 'sub', uid,
                                'email', (SELECT email FROM auth.users WHERE id = uid)) END::text, true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE format('SELECT count(*) FROM (%s) x', q) INTO n;
  EXCEPTION WHEN insufficient_privilege THEN n := -1;
  END;
  RESET ROLE;
  RETURN n;
END $$;

-- 1 if `r` can run statement `q` (rolled back to a savepoint), -1 if denied.
CREATE FUNCTION pg_temp.can_run(r text, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE ok bigint := 1;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', r)::text, true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', r);
    EXECUTE q;
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN ok := 1;
    WHEN insufficient_privilege THEN ok := -1;
  END;
  RESET ROLE;
  RETURN ok;
END $$;

CREATE TEMP TABLE results (check_name text, expected text, actual bigint, ok boolean) ON COMMIT DROP;

DO $$
DECLARE
  staff_uid uuid;
  plain_uid uuid;
  own_invites bigint;
  t text;
BEGIN
  SELECT auth_user_id INTO staff_uid FROM public.app_users
    WHERE role = 'staff' AND auth_user_id IS NOT NULL LIMIT 1;
  SELECT u.auth_user_id INTO plain_uid FROM public.app_users u
    WHERE u.role IN ('associate','resident') AND u.auth_user_id IS NOT NULL
    ORDER BY EXISTS (SELECT 1 FROM public.user_invitations i JOIN auth.users au ON lower(au.email) = lower(i.email)
                     WHERE au.id = u.auth_user_id) DESC
    LIMIT 1;
  IF staff_uid IS NULL OR plain_uid IS NULL THEN
    RAISE EXCEPTION 'Need existing staff and associate/resident identities';
  END IF;
  SELECT count(*) INTO own_invites FROM public.user_invitations i JOIN auth.users au ON lower(au.email) = lower(i.email)
    WHERE au.id = plain_uid;

  -- No anon writes (grant level)
  FOREACH t IN ARRAY ARRAY['spgd_brand_assets','spgd_brand_reviews','spgd_brand_rules','spgd_brand_variants',
      'spgd_render_tokens','spgd_style_tokens','spgd_subject_tokens','devices','rate_limit_attempts','api_usage_log',
      'push_tokens','spirited_house_config','spirit_emergences','spirit_phrases','spirit_whisper_config',
      'spirit_whisper_log','spirit_whispers','context_snapshots','laundry_watchers','photos','photo_requests',
      'photo_spaces','user_invitations','pai_interactions','service_connections','associate_schedules',
      'schedule_edits','vehicle_drivers','assignments','square_payments','previous_residences'] LOOP
    INSERT INTO results SELECT 'anon cannot write ' || t, 'denied',
      CASE WHEN has_table_privilege('anon', 'public.' || t, 'INSERT') OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
           OR has_table_privilege('anon', 'public.' || t, 'DELETE') OR has_table_privilege('anon', 'public.' || t, 'TRUNCATE')
           THEN 1 ELSE -1 END, NULL;
  END LOOP;

  -- No anon reads of private tables
  FOREACH t IN ARRAY ARRAY['devices','rate_limit_attempts','api_usage_log','push_tokens','spirited_house_config',
      'spirit_whisper_config','context_snapshots','laundry_watchers','user_invitations','event_rsvps','bug_reports',
      'pai_interactions','service_connections','associate_schedules','schedule_edits','vehicle_drivers'] LOOP
    INSERT INTO results SELECT 'anon cannot read ' || t, 'denied', pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.' || t), NULL;
  END LOOP;

  -- Anonymous inserts that public pages need
  INSERT INTO results SELECT 'anon can insert event_rsvps (ninja)', 'granted',
    pg_temp.can_run('anon', $q$INSERT INTO public.event_rsvps (name, email, event, status) VALUES ('t', 't@example.com', 'regression-test', 'interest')$q$), NULL;
  INSERT INTO results SELECT 'anon can insert bug_reports (extension)', 'granted',
    pg_temp.can_run('anon', $q$INSERT INTO public.bug_reports (reporter_name, reporter_email, description) VALUES ('t', 't@example.com', 'regression-test')$q$), NULL;
  INSERT INTO results SELECT 'anon cannot insert spgd_brand_reviews', 'denied',
    pg_temp.can_run('anon', $q$INSERT INTO public.spgd_brand_reviews (asset_id, status) VALUES ('regression-test', 'regen-requested')$q$), NULL;

  -- Public reads kept
  INSERT INTO results SELECT 'anon still reads spgd_brand_reviews', (SELECT count(*) FROM public.spgd_brand_reviews)::text,
    pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.spgd_brand_reviews'), NULL;
  INSERT INTO results SELECT 'anon reads assignment dates', (SELECT count(*) FROM public.assignments)::text,
    pg_temp.count_as('anon', NULL, 'SELECT id, person_id, status, start_date, end_date, desired_departure_date, desired_departure_listed FROM public.assignments'), NULL;
  INSERT INTO results SELECT 'anon cannot read assignment ' || c, 'denied',
    pg_temp.count_as('anon', NULL, format('SELECT %I FROM public.assignments', c)), NULL
    FROM unnest(ARRAY['rate_amount','monthly_rent','deposit_amount','notes','signwell_document_id','rental_application_id','airbnb_uid']) c;
  -- devices_unified is security_invoker and already shows anon a subset; only assert it stays readable.
  INSERT INTO results SELECT 'anon still reads devices_unified', 'granted',
    sign(pg_temp.count_as('anon', NULL, 'SELECT 1 FROM public.devices_unified') + 1), NULL;

  -- Signed-in access kept
  INSERT INTO results SELECT 'non-staff sees own invitations only', own_invites::text,
    pg_temp.count_as('authenticated', plain_uid, 'SELECT 1 FROM public.user_invitations'), NULL;
  INSERT INTO results SELECT 'signed-in reads associate_schedules', (SELECT count(*) FROM public.associate_schedules)::text,
    pg_temp.count_as('authenticated', plain_uid, 'SELECT 1 FROM public.associate_schedules'), NULL;
  INSERT INTO results SELECT 'signed-in reads service_connections', (SELECT count(*) FROM public.service_connections)::text,
    pg_temp.count_as('authenticated', plain_uid, 'SELECT 1 FROM public.service_connections'), NULL;
  INSERT INTO results SELECT 'non-staff cannot read pai_interactions', '0',
    pg_temp.count_as('authenticated', plain_uid, 'SELECT 1 FROM public.pai_interactions'), NULL;
  INSERT INTO results SELECT 'staff reads pai_interactions', (SELECT count(*) FROM public.pai_interactions)::text,
    pg_temp.count_as('authenticated', staff_uid, 'SELECT 1 FROM public.pai_interactions'), NULL;
  INSERT INTO results SELECT 'staff reads event_rsvps', (SELECT count(*) FROM public.event_rsvps)::text,
    pg_temp.count_as('authenticated', staff_uid, 'SELECT 1 FROM public.event_rsvps'), NULL;
  INSERT INTO results SELECT 'non-staff cannot read bug_reports', '0',
    pg_temp.count_as('authenticated', plain_uid, 'SELECT 1 FROM public.bug_reports'), NULL;
  INSERT INTO results SELECT 'kiosk PAI count via RPC', (SELECT count(*) FROM public.pai_interactions WHERE created_at >= now() - interval '24 hours')::text,
    pg_temp.count_as('anon', NULL, 'SELECT generate_series(1, public.kiosk_pai_count_24h())'), NULL;

  -- Function EXECUTE
  INSERT INTO results SELECT 'anon cannot execute ' || f, 'denied',
    CASE WHEN has_function_privilege('anon', f, 'EXECUTE') THEN 1 ELSE -1 END, NULL
    FROM unnest(ARRAY['public.apply_record_fee(uuid,numeric,text)',
                      'public.hostevent_update_deposit(uuid,text,text,text,text)',
                      'public.settle_square_payment_record(uuid,text,text,text,text,text)',
                      'public.queue_spgd_regen_jobs()',
                      'public.queue_daily_pai_imagery(boolean)',
                      'public.increment_fee_code_usage(uuid)']) f;
  INSERT INTO results SELECT 'signed-in cannot execute settle_square_payment_record', 'denied',
    CASE WHEN has_function_privilege('authenticated', 'public.settle_square_payment_record(uuid,text,text,text,text,text)', 'EXECUTE') THEN 1 ELSE -1 END, NULL;
  INSERT INTO results SELECT 'service_role executes settle_square_payment_record', 'granted',
    CASE WHEN has_function_privilege('service_role', 'public.settle_square_payment_record(uuid,text,text,text,text,text)', 'EXECUTE') THEN 1 ELSE -1 END, NULL;
  INSERT INTO results SELECT 'anon executes ' || f, 'granted',
    CASE WHEN has_function_privilege('anon', f, 'EXECUTE') THEN 1 ELSE -1 END, NULL
    FROM unnest(ARRAY['public.create_square_payment_record(text,uuid,text,numeric,text,numeric)',
                      'public.kiosk_pai_count_24h()',
                      'public.check_rate_limit(text,text,integer,integer)',
                      'public.get_square_public_config()']) f;

  UPDATE results SET ok = CASE
    WHEN expected = 'denied'  THEN actual = -1
    WHEN expected = 'granted' THEN actual = 1
    ELSE actual = expected::bigint END;
END $$;

-- create_square_payment_record rejects a tampered amount, and $0 needs a valid code.
DO $$
DECLARE app_id uuid; fee numeric; rec uuid; rejected bigint;
BEGIN
  SELECT default_amount INTO fee FROM public.fee_settings WHERE fee_type = 'rental_application' AND is_active LIMIT 1;
  SELECT id INTO app_id FROM public.rental_applications LIMIT 1;
  SET LOCAL session_replication_role = replica;  -- skip status-transition triggers for the fixture
  UPDATE public.rental_applications SET application_status = 'submitted', application_fee_paid = false,
         submitted_at = now() WHERE id = app_id;
  SET LOCAL session_replication_role = origin;

  BEGIN
    PERFORM public.create_square_payment_record('rental_application', app_id, 'rental_application', 1, NULL, fee);
    rejected := 1;
  EXCEPTION WHEN invalid_parameter_value THEN rejected := -1;
  END;
  INSERT INTO results VALUES ('square record rejects $1 for a $' || fee || ' fee', 'denied', rejected, rejected = -1);

  BEGIN
    PERFORM public.create_square_payment_record('rental_application', app_id, 'rental_application', 0, 'NOT-A-REAL-CODE', fee);
    rejected := 1;
  EXCEPTION WHEN invalid_parameter_value THEN rejected := -1;
  END;
  INSERT INTO results VALUES ('square record rejects $0 with bad code', 'denied', rejected, rejected = -1);

  rec := public.create_square_payment_record('rental_application', app_id, 'rental_application', fee, NULL, fee);
  INSERT INTO results SELECT 'correct amount creates pending record', '1', count(*), count(*) = 1
    FROM public.square_payments WHERE id = rec AND status = 'pending' AND amount = fee;
  INSERT INTO results SELECT 'settle without Square id refused', '0',
    (public.settle_square_payment_record(rec, 'completed', NULL, NULL, NULL, NULL))::int, NULL;
  PERFORM public.settle_square_payment_record(rec, 'completed', 'sq-regression', NULL, NULL, NULL);
  INSERT INTO results SELECT 'settlement marks application fee paid', '1', count(*), count(*) = 1
    FROM public.rental_applications WHERE id = app_id AND application_fee_paid AND application_fee_amount = fee;
  UPDATE results SET ok = actual = 0 WHERE check_name = 'settle without Square id refused';
END $$;

SELECT check_name, expected, actual, ok FROM results ORDER BY ok, check_name;
ROLLBACK;
