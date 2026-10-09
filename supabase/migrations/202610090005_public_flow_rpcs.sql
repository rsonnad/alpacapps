-- SECURITY batch 3a: narrow RPCs for anonymous public pages.
--
-- Public pages (rental apply/status, host-event, book, waiver, contact, hall
-- kiosk/TV) used to read and write people, rental_applications,
-- event_hosting_requests, event_request_spaces and waiver_signatures directly
-- with the anon key. Each anonymous use now goes through one of these
-- functions. Each function takes the caller's own identifier (application id,
-- status token, email, request id), touches only that record, and returns only
-- the fields the page uses. Batch 3b (202610090006) then revokes anon table access.
--
-- Additive only: applying this changes no existing behaviour.

BEGIN;

-- ---------------------------------------------------------------------------
-- rentals/apply/?continue=<application id>
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_get_application(p_application_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'application_status', ra.application_status,
    'application_fee_paid', ra.application_fee_paid,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'email', p.email)
  FROM rental_applications ra
  LEFT JOIN people p ON p.id = ra.person_id
  WHERE ra.id = p_application_id;
$$;

CREATE OR REPLACE FUNCTION public.apply_submit_application(
  p_application_id uuid, p_person jsonb, p_application jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_person_id uuid;
BEGIN
  SELECT person_id INTO v_person_id FROM rental_applications
   WHERE id = p_application_id AND application_status = 'inquiry'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not open for submission' USING ERRCODE = 'P0002';
  END IF;

  UPDATE people SET
    gender                = NULLIF(p_person->>'gender', '')::gender_type,
    current_address       = p_person->>'current_address',
    employment_status     = p_person->>'employment_status',
    employer              = p_person->>'employer',
    monthly_income        = NULLIF(p_person->>'monthly_income', '')::numeric,
    deposit_return_method = NULLIF(p_person->>'deposit_return_method', '')::deposit_return_method_type,
    partner_email         = p_person->>'partner_email',
    kids_ages             = p_person->>'kids_ages',
    vehicles              = p_person->>'vehicles',
    pets                  = p_person->>'pets',
    allergies             = p_person->>'allergies',
    prior_evictions       = COALESCE((p_person->>'prior_evictions')::boolean, false),
    instagram             = p_person->>'instagram',
    facebook              = p_person->>'facebook',
    x_handle              = p_person->>'x_handle',
    myspace               = p_person->>'myspace'
  WHERE id = v_person_id;

  UPDATE rental_applications SET
    application_status = 'submitted',
    desired_space_id   = NULLIF(p_application->>'desired_space_id', '')::uuid,
    desired_move_in    = NULLIF(p_application->>'desired_move_in', '')::date,
    desired_term       = p_application->>'desired_term',
    submitted_at       = now(),
    updated_at         = now()
  WHERE id = p_application_id;

  RETURN public.apply_get_application(p_application_id);
END $$;

CREATE OR REPLACE FUNCTION public.apply_record_fee(
  p_application_id uuid, p_amount numeric, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE rental_applications SET
    application_fee_paid   = true,
    application_fee_amount = p_amount,
    application_fee_code   = p_code,
    updated_at             = now()
  WHERE id = p_application_id
    AND application_status = 'submitted'
    AND COALESCE(application_fee_paid, false) = false;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.apply_add_previous_residence(p_application_id uuid, p_residence jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_person_id uuid;
  v_submitted_at timestamptz;
BEGIN
  -- Only right after submission, and only once per submission.
  SELECT person_id, submitted_at INTO v_person_id, v_submitted_at FROM rental_applications
   WHERE id = p_application_id AND application_status = 'submitted'
     AND submitted_at > now() - interval '1 hour';
  IF v_person_id IS NULL OR COALESCE(trim(p_residence->>'address'), '') = '' THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM previous_residences WHERE person_id = v_person_id AND created_at >= v_submitted_at) THEN
    RETURN false;
  END IF;
  INSERT INTO previous_residences (person_id, address, start_date, end_date, landlord_name, landlord_contact, reason_for_leaving)
  VALUES (v_person_id, trim(p_residence->>'address'),
          NULLIF(p_residence->>'start_date', '')::date, NULLIF(p_residence->>'end_date', '')::date,
          p_residence->>'landlord_name', p_residence->>'landlord_contact', p_residence->>'reason_for_leaving');
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------
-- rentals/status.html?token=<status_token>
-- Same shape the page used to get from PostgREST, minus unused columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_application_status(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'application_status', ra.application_status,
    'needs_more_info_message', ra.needs_more_info_message,
    'needs_more_info_requested_at', ra.needs_more_info_requested_at,
    'applicant_visible_decline_reason', ra.applicant_visible_decline_reason,
    'status_history', ra.status_history,
    'approved_space', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('name', s.name) END,
    'person', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('first_name', p.first_name) END)
  FROM rental_applications ra
  LEFT JOIN spaces s ON s.id = ra.approved_space_id
  LEFT JOIN people p ON p.id = ra.person_id
  WHERE p_token IS NOT NULL AND ra.status_token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- rentals/hostevent: person find-or-create + request + spaces, atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hostevent_submit_request(
  p_person jsonb, p_request jsonb, p_space_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text := lower(trim(p_person->>'email'));
  v_person_id uuid;
  v_request_id uuid;
  v_deposit_status text := COALESCE(p_request->>'deposit_status', 'pending');
BEGIN
  IF v_email IS NULL OR v_email = '' OR COALESCE(trim(p_person->>'first_name'), '') = '' THEN
    RAISE EXCEPTION 'name and email are required' USING ERRCODE = '22023';
  END IF;
  IF v_deposit_status NOT IN ('pending', 'waived') THEN
    RAISE EXCEPTION 'invalid deposit status' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_person_id FROM people WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;
  IF v_person_id IS NULL THEN
    INSERT INTO people (first_name, last_name, email, phone, type)
    VALUES (trim(p_person->>'first_name'), p_person->>'last_name', v_email, p_person->>'phone', 'event_client')
    RETURNING id INTO v_person_id;
  END IF;

  INSERT INTO event_hosting_requests (
    person_id, organization_name, has_hosted_before, event_name, event_description, event_type,
    event_date, event_start_time, event_end_time, expected_guests, is_ticketed, ticket_price_range,
    marketing_materials_link, special_requests,
    setup_staff_name, setup_staff_phone, cleanup_staff_name, cleanup_staff_phone,
    parking_manager_name, parking_manager_phone,
    ack_no_address_posting, ack_parking_management, ack_noise_curfew, ack_no_alcohol_inside,
    ack_no_meat_inside, ack_no_rvs, ack_no_animals_inside, ack_cleaning_responsibility,
    ack_linens_furniture, ack_propane_reimbursement,
    request_status, reservation_deposit_amount, reservation_deposit_code, deposit_status)
  VALUES (
    v_person_id, p_request->>'organization_name', COALESCE((p_request->>'has_hosted_before')::boolean, false),
    p_request->>'event_name', p_request->>'event_description', p_request->>'event_type',
    (p_request->>'event_date')::date, (p_request->>'event_start_time')::time, (p_request->>'event_end_time')::time,
    (p_request->>'expected_guests')::integer, COALESCE((p_request->>'is_ticketed')::boolean, false),
    p_request->>'ticket_price_range', p_request->>'marketing_materials_link', p_request->>'special_requests',
    p_request->>'setup_staff_name', p_request->>'setup_staff_phone',
    p_request->>'cleanup_staff_name', p_request->>'cleanup_staff_phone',
    p_request->>'parking_manager_name', p_request->>'parking_manager_phone',
    COALESCE((p_request->>'ack_no_address_posting')::boolean, false),
    COALESCE((p_request->>'ack_parking_management')::boolean, false),
    COALESCE((p_request->>'ack_noise_curfew')::boolean, false),
    COALESCE((p_request->>'ack_no_alcohol_inside')::boolean, false),
    COALESCE((p_request->>'ack_no_meat_inside')::boolean, false),
    COALESCE((p_request->>'ack_no_rvs')::boolean, false),
    COALESCE((p_request->>'ack_no_animals_inside')::boolean, false),
    COALESCE((p_request->>'ack_cleaning_responsibility')::boolean, false),
    COALESCE((p_request->>'ack_linens_furniture')::boolean, false),
    COALESCE((p_request->>'ack_propane_reimbursement')::boolean, false),
    'submitted', NULLIF(p_request->>'reservation_deposit_amount', '')::numeric,
    p_request->>'reservation_deposit_code', v_deposit_status)
  RETURNING id INTO v_request_id;

  IF p_space_ids IS NOT NULL AND array_length(p_space_ids, 1) > 0 THEN
    INSERT INTO event_request_spaces (event_request_id, space_id, space_type)
    SELECT v_request_id, sid, 'requested' FROM unnest(p_space_ids) sid
    WHERE EXISTS (SELECT 1 FROM spaces WHERE id = sid);
  END IF;

  RETURN v_request_id;
END $$;

CREATE OR REPLACE FUNCTION public.hostevent_update_deposit(
  p_request_id uuid, p_status text, p_square_payment_id text,
  p_square_receipt_url text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'invalid deposit status' USING ERRCODE = '22023';
  END IF;
  UPDATE event_hosting_requests SET
    deposit_status     = p_status,
    square_payment_id  = CASE WHEN p_status = 'paid' THEN p_square_payment_id ELSE square_payment_id END,
    square_receipt_url = CASE WHEN p_status = 'paid' THEN p_square_receipt_url ELSE square_receipt_url END,
    deposit_error      = CASE WHEN p_status = 'failed' THEN p_error ELSE deposit_error END,
    updated_at         = now()
  WHERE id = p_request_id AND deposit_status IN ('pending', 'failed');
  RETURN FOUND;
END $$;

-- ---------------------------------------------------------------------------
-- rentals/book: resident check. Returns the person only if they have an
-- active assignment today, so non-residents can't be looked up by email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_resident(p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name)
  FROM people p
  WHERE lower(p.email) = lower(trim(p_email))
    AND EXISTS (
      SELECT 1 FROM assignments a
      WHERE a.person_id = p.id AND a.status = 'active'
        AND a.start_date <= (now() AT TIME ZONE 'America/Chicago')::date
        AND (a.end_date IS NULL OR a.end_date >= (now() AT TIME ZONE 'America/Chicago')::date))
  ORDER BY p.created_at
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- waiver/ and the event agreement page: sign and get the id back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_waiver(p_waiver jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_waiver->>'waiver_type' NOT IN ('event_waiver', 'event_agreement') THEN
    RAISE EXCEPTION 'invalid waiver type' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(trim(p_waiver->>'signer_name'), '') = '' THEN
    RAISE EXCEPTION 'signer name is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO waiver_signatures (waiver_type, template_version, signer_name, signer_email, signer_phone,
                                 event_request_id, signed_at, user_agent)
  VALUES (p_waiver->>'waiver_type', COALESCE((p_waiver->>'template_version')::integer, 1),
          trim(p_waiver->>'signer_name'), p_waiver->>'signer_email', p_waiver->>'signer_phone',
          NULLIF(p_waiver->>'event_request_id', '')::uuid,
          COALESCE(NULLIF(p_waiver->>'signed_at', '')::timestamptz, now()),
          left(p_waiver->>'user_agent', 4000))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- contact/: the house phone number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_contact_phone()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT phone FROM people WHERE company_name = 'Alpaca Playhouse' AND phone IS NOT NULL LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- kiosks/hall (kiosk + TV): occupants board and upcoming events.
-- Same JSON shape the kiosks used to get from PostgREST embeds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kiosk_current_occupants()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'start_date', a.start_date, 'end_date', a.end_date, 'status', a.status,
    'person', CASE WHEN p.id IS NULL THEN NULL
                   ELSE jsonb_build_object('first_name', p.first_name, 'residence_location', p.residence_location) END,
    'assignment_spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('space', jsonb_build_object('name', s.name)))
      FROM assignment_spaces asp JOIN spaces s ON s.id = asp.space_id
      WHERE asp.assignment_id = a.id), '[]'::jsonb))), '[]'::jsonb)
  FROM assignments a
  LEFT JOIN people p ON p.id = a.person_id
  WHERE a.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.kiosk_upcoming_events()
RETURNS TABLE (event_name text, event_date date, event_start_time time, event_end_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.event_name, e.event_date, e.event_start_time, e.event_end_time
  FROM event_hosting_requests e
  WHERE e.request_status = 'approved'
    AND e.event_date >= (now() AT TIME ZONE 'America/Chicago')::date
  ORDER BY e.event_date
  LIMIT 3;
$$;

-- ---------------------------------------------------------------------------
-- Grants: callable by the public pages, nothing else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'apply_get_application(uuid)',
    'apply_submit_application(uuid, jsonb, jsonb)',
    'apply_record_fee(uuid, numeric, text)',
    'apply_add_previous_residence(uuid, jsonb)',
    'get_application_status(uuid)',
    'hostevent_submit_request(jsonb, jsonb, uuid[])',
    'hostevent_update_deposit(uuid, text, text, text, text)',
    'verify_resident(text)',
    'sign_waiver(jsonb)',
    'get_public_contact_phone()',
    'kiosk_current_occupants()',
    'kiosk_upcoming_events()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

COMMIT;
