-- Square settlement moves server-side (2026-10-24 review H3).
--
-- process-square-payment now charges the amount on our pending record, checks
-- Square's result and calls settle_square_payment_record as service role, which
-- also marks the application fee / event deposit. The client-callable settlement
-- RPCs are revoked, and create_square_payment_record checks the amount against
-- fee_settings / fee_codes.
--
-- ORDER: deploy process-square-payment first. Applied before it, a card charge
-- would never be settled (the pages' own settle calls are revoked here).
-- Regression test: supabase/tests/anon-access-paths-2026-10-24.sql

BEGIN;


-- Settles a pending record and its application fee / event deposit.
-- Called by process-square-payment (service role) after Square confirms the charge,
-- and by create_square_payment_record for a validated $0 (fully waived) fee.
CREATE OR REPLACE FUNCTION public.settle_square_payment_record(
  p_record_id uuid, p_status text, p_square_payment_id text,
  p_square_order_id text, p_square_receipt_url text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r square_payments%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;

  UPDATE square_payments SET
    status             = p_status,
    square_payment_id  = CASE WHEN p_status = 'completed' THEN p_square_payment_id ELSE square_payment_id END,
    square_order_id    = CASE WHEN p_status = 'completed' THEN p_square_order_id ELSE square_order_id END,
    square_receipt_url = CASE WHEN p_status = 'completed' THEN p_square_receipt_url ELSE square_receipt_url END,
    completed_at       = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
    error_message      = CASE WHEN p_status = 'failed' THEN left(p_error, 1000) ELSE error_message END,
    failed_at          = CASE WHEN p_status = 'failed' THEN now() ELSE failed_at END,
    updated_at         = now()
  WHERE id = p_record_id AND status = 'pending'
    AND (p_status = 'failed' OR amount = 0 OR COALESCE(p_square_payment_id, '') <> '')
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_status = 'completed' THEN
    IF r.reference_type = 'rental_application' THEN
      UPDATE rental_applications SET
        application_fee_paid   = true,
        application_fee_amount = r.amount,
        application_fee_code   = r.fee_code_used,
        updated_at             = now()
      WHERE id = r.reference_id AND COALESCE(application_fee_paid, false) = false;
    ELSIF r.reference_type = 'event_hosting_request' AND r.amount > 0 THEN
      UPDATE event_hosting_requests SET
        deposit_status     = 'paid',
        square_payment_id  = r.square_payment_id,
        square_receipt_url = r.square_receipt_url,
        updated_at         = now()
      WHERE id = r.reference_id AND deposit_status IN ('pending', 'failed');
    END IF;
    IF r.fee_code_used IS NOT NULL THEN
      UPDATE fee_codes SET times_used = times_used + 1, updated_at = now()
       WHERE code = r.fee_code_used AND fee_type = r.payment_type;
    END IF;
  ELSIF r.reference_type = 'event_hosting_request' THEN
    UPDATE event_hosting_requests SET
      deposit_status = 'failed',
      deposit_error  = left(p_error, 1000),
      updated_at     = now()
    WHERE id = r.reference_id AND deposit_status IN ('pending', 'failed');
  END IF;
  RETURN true;
END $$;

-- The amount must match the fee setting, or the price of a valid fee code.
CREATE OR REPLACE FUNCTION public.create_square_payment_record(
  p_reference_type text, p_reference_id uuid, p_payment_type text,
  p_amount numeric, p_fee_code text, p_original_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_ok boolean;
  v_code text := NULLIF(upper(btrim(p_fee_code)), '');
  v_default numeric;
  v_expected numeric;
BEGIN
  IF p_reference_type = 'rental_application' AND p_payment_type = 'rental_application' THEN
    SELECT true INTO v_ok FROM rental_applications
     WHERE id = p_reference_id AND application_status = 'submitted'
       AND COALESCE(application_fee_paid, false) = false
       AND submitted_at > now() - interval '1 day';
  ELSIF p_reference_type = 'event_hosting_request' AND p_payment_type = 'event_reservation_deposit' THEN
    SELECT true INTO v_ok FROM event_hosting_requests
     WHERE id = p_reference_id AND deposit_status IN ('pending', 'failed', 'waived')
       AND created_at > now() - interval '1 day';
  END IF;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'reference not open for payment' USING ERRCODE = 'P0002';
  END IF;

  SELECT default_amount INTO v_default FROM fee_settings
   WHERE fee_type = p_payment_type AND is_active LIMIT 1;
  IF v_code IS NULL THEN
    v_expected := v_default;
  ELSE
    SELECT price INTO v_expected FROM fee_codes
     WHERE code = v_code AND fee_type = p_payment_type AND is_active
       AND (expires_at IS NULL OR expires_at > now())
       AND (usage_limit IS NULL OR times_used < usage_limit);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid fee code' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_expected IS NULL OR p_amount IS NULL OR round(p_amount, 2) <> round(v_expected, 2) THEN
    RAISE EXCEPTION 'amount does not match fee' USING ERRCODE = '22023';
  END IF;

  INSERT INTO square_payments (payment_type, reference_type, reference_id, amount,
                               fee_code_used, original_amount, status)
  VALUES (p_payment_type, p_reference_type, p_reference_id, v_expected, v_code,
          COALESCE(v_default, p_original_amount), 'pending')
  RETURNING id INTO v_id;

  IF v_expected = 0 THEN
    PERFORM settle_square_payment_record(v_id, 'completed', NULL, NULL, NULL, NULL);
  END IF;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.settle_square_payment_record(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_record_fee(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hostevent_update_deposit(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_square_payment_record(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_record_fee(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hostevent_update_deposit(uuid, text, text, text, text) TO service_role;

-- Settlement now counts fee-code usage; the anonymous counter is no longer needed.
-- Staff payments (shared/square-service.js) still call it signed in.
REVOKE EXECUTE ON FUNCTION public.increment_fee_code_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_fee_code_usage(uuid) TO authenticated, service_role;

COMMIT;
