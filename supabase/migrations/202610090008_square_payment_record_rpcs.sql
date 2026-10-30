-- Square payment records from public pages (rentals/apply, rentals/hostevent).
--
-- square_payments has staff/service-role policies only, so the pages' anonymous
-- inserts and updates were rejected by RLS. On apply that stopped the payment
-- before charging. On hostevent the insert failed silently and the card was still
-- charged, so no square_payments row was written. These functions create and
-- settle a record only for the caller's own application or event request.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_square_payment_record(
  p_reference_type text, p_reference_id uuid, p_payment_type text,
  p_amount numeric, p_fee_code text, p_original_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_ok boolean;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 5000 THEN
    RAISE EXCEPTION 'invalid amount' USING ERRCODE = '22023';
  END IF;

  IF p_reference_type = 'rental_application' THEN
    SELECT true INTO v_ok FROM rental_applications
     WHERE id = p_reference_id AND application_status = 'submitted'
       AND COALESCE(application_fee_paid, false) = false
       AND submitted_at > now() - interval '1 day';
  ELSIF p_reference_type = 'event_hosting_request' THEN
    SELECT true INTO v_ok FROM event_hosting_requests
     WHERE id = p_reference_id AND deposit_status IN ('pending', 'failed', 'waived')
       AND created_at > now() - interval '1 day';
  END IF;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'reference not open for payment' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO square_payments (payment_type, reference_type, reference_id, amount,
                               fee_code_used, original_amount, status, completed_at)
  VALUES (p_payment_type, p_reference_type, p_reference_id, p_amount, p_fee_code, p_original_amount,
          CASE WHEN p_amount = 0 THEN 'completed' ELSE 'pending' END,
          CASE WHEN p_amount = 0 THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.settle_square_payment_record(
  p_record_id uuid, p_status text, p_square_payment_id text,
  p_square_order_id text, p_square_receipt_url text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'completed' AND COALESCE(p_square_payment_id, '') = '' THEN
    RAISE EXCEPTION 'square payment id required' USING ERRCODE = '22023';
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
  WHERE id = p_record_id AND status = 'pending';
  RETURN FOUND;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_square_payment_record(text, uuid, text, numeric, text, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_square_payment_record(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_square_payment_record(text, uuid, text, numeric, text, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_square_payment_record(uuid, text, text, text, text, text) TO anon, authenticated, service_role;

COMMIT;
