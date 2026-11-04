-- House residents: $0 rental fee and $0 reservation deposit when they submit signed in.
CREATE OR REPLACE FUNCTION public.hostevent_submit_request(p_person jsonb, p_request jsonb, p_space_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(trim(p_person->>'email'));
  v_person_id uuid;
  v_request_id uuid;
  v_deposit_status text := COALESCE(p_request->>'deposit_status', 'pending');
  -- House residents (signed in) pay no rental fee and no reservation deposit.
  v_is_resident boolean := auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND is_current_resident = true);
  v_res_amount numeric := NULLIF(p_request->>'reservation_deposit_amount', '')::numeric;
BEGIN
  IF v_is_resident THEN
    v_res_amount := 0;
    v_deposit_status := 'waived';
  END IF;

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
    request_status, reservation_deposit_amount, reservation_deposit_code, deposit_status,
    is_resident_host, rental_fee, reservation_fee)
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
    'submitted', v_res_amount,
    p_request->>'reservation_deposit_code', v_deposit_status,
    v_is_resident,
    CASE WHEN v_is_resident THEN 0 ELSE (SELECT default_amount FROM fee_settings WHERE fee_type = 'event_rental_fee' AND is_active LIMIT 1) END,
    CASE WHEN v_is_resident THEN 0 ELSE (SELECT default_amount FROM fee_settings WHERE fee_type = 'event_reservation_deposit' AND is_active LIMIT 1) END)
  RETURNING id INTO v_request_id;

  IF p_space_ids IS NOT NULL AND array_length(p_space_ids, 1) > 0 THEN
    INSERT INTO event_request_spaces (event_request_id, space_id, space_type)
    SELECT v_request_id, sid, 'requested' FROM unnest(p_space_ids) sid
    WHERE EXISTS (SELECT 1 FROM spaces WHERE id = sid);
  END IF;

  RETURN v_request_id;
END $function$;
