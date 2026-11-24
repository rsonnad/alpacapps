BEGIN;

-- Earlier requests retain the manual workflow. Only new requests enter the
-- notice and automatic payout queue.
ALTER TABLE public.associate_reimbursements
  ADD COLUMN automatic_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN review_email_sent_at timestamptz,
  ADD COLUMN payment_held boolean NOT NULL DEFAULT false,
  ADD COLUMN transfer_started_at timestamptz,
  ADD COLUMN transfer_attempt_id uuid,
  ADD COLUMN external_transfer_id text UNIQUE,
  ADD COLUMN transfer_error text,
  ADD COLUMN transfer_retry_after timestamptz;

CREATE INDEX associate_reimbursements_automatic_idx
  ON public.associate_reimbursements (review_email_sent_at, created_at)
  WHERE automatic_payment AND status = 'pending';

CREATE FUNCTION public.set_reimbursement_payment_hold(p_id uuid, p_held boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle')
  ) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.associate_reimbursements
    SET payment_held = p_held
    WHERE id = p_id AND automatic_payment AND status = 'pending'
      AND transfer_started_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This reimbursement is resolved or its transfer has already started';
  END IF;
END;
$$;

-- The manual resolver takes the same row lock. Block a manual payment or
-- decline once Stripe might have received the automatic transfer.
CREATE FUNCTION public.guard_reimbursement_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.transfer_started_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status <> 'paid' OR NEW.external_transfer_id IS NULL) THEN
    RAISE EXCEPTION 'A Stripe transfer is in progress or needs reconciliation';
  END IF;
  IF OLD.automatic_payment AND NEW.status = 'paid' AND OLD.status <> 'paid'
     AND NEW.external_transfer_id IS NULL AND NOT OLD.payment_held THEN
    RAISE EXCEPTION 'Hold automatic payment before recording an external payment';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_reimbursement_resolution
  BEFORE UPDATE OF status ON public.associate_reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.guard_reimbursement_resolution();

CREATE FUNCTION public.claim_reimbursement_transfer(p_id uuid, p_instant boolean)
RETURNS TABLE (amount_cents integer, destination text, attempt_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.associate_reimbursements r
    SET transfer_started_at = now(), transfer_attempt_id = gen_random_uuid(), transfer_error = NULL
    FROM public.associate_profiles ap
    WHERE r.id = p_id AND ap.id = r.associate_id
      AND r.automatic_payment AND r.status = 'pending' AND NOT r.payment_held
      AND r.transfer_started_at IS NULL
      AND (r.transfer_retry_after IS NULL OR r.transfer_retry_after <= now())
      AND r.created_at <= now() - interval '24 hours'
      AND r.review_email_sent_at <= now() - interval '24 hours'
      AND ap.is_active AND ap.payment_method = 'stripe'
      AND ap.stripe_connect_account_id IS NOT NULL
      AND ap.identity_verification_status = 'verified' AND ap.w9_status = 'submitted'
      AND (NOT p_instant OR (ap.instant_payout AND
        extract(hour FROM now() AT TIME ZONE 'America/Chicago') = 20))
      AND (ap.instant_payout OR lower(coalesce(ap.payout_frequency, 'daily')) = 'daily' OR
        extract(dow FROM now() AT TIME ZONE 'America/Chicago') = coalesce(ap.payout_day_of_week, 6))
    RETURNING r.amount_cents, ap.stripe_connect_account_id, r.transfer_attempt_id;
$$;

CREATE FUNCTION public.finish_reimbursement_transfer(p_id uuid, p_transfer_id text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.associate_reimbursements%ROWTYPE;
  v_person_id uuid;
  v_person_name text;
  v_ledger_id uuid;
BEGIN
  SELECT * INTO STRICT v_request FROM public.associate_reimbursements WHERE id = p_id FOR UPDATE;
  IF v_request.status = 'paid' AND v_request.external_transfer_id = p_transfer_id THEN
    RETURN v_request.ledger_id;
  END IF;
  IF v_request.status <> 'pending' OR v_request.transfer_started_at IS NULL
     OR p_transfer_id IS NULL OR p_transfer_id !~ '^tr_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'A claimed reimbursement and valid Stripe transfer are required';
  END IF;
  SELECT u.person_id, u.display_name INTO v_person_id, v_person_name
    FROM public.associate_profiles ap JOIN public.app_users u ON u.id = ap.app_user_id
    WHERE ap.id = v_request.associate_id;

  INSERT INTO public.ledger
    (direction, category, amount, payment_method, transaction_date, person_id,
     person_name, description, notes, status, recorded_by)
  VALUES
    ('expense', 'other', v_request.amount_cents / 100.0, 'stripe',
     (now() AT TIME ZONE 'America/Chicago')::date, v_person_id, v_person_name,
     'Reimbursement: ' || v_request.description,
     'Reimbursement request ' || p_id::text || ' · Stripe ' || p_transfer_id,
     'completed', 'system:associate-reimbursements')
  RETURNING id INTO v_ledger_id;

  UPDATE public.associate_reimbursements
    SET status = 'paid', resolved_at = now(), ledger_id = v_ledger_id,
        paid_date = (now() AT TIME ZONE 'America/Chicago')::date,
        external_transfer_id = p_transfer_id, transfer_error = NULL
    WHERE id = p_id;
  RETURN v_ledger_id;
END;
$$;

CREATE FUNCTION public.reimbursement_worker_post(p_mode text, p_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT net.http_post(
    url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/associate-reimbursement-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || public.payroll_cron_bearer(),
      'apikey', public.payroll_cron_bearer(),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('mode', p_mode, 'id', p_id),
    timeout_milliseconds := 65000
  );
$$;

CREATE FUNCTION public.queue_reimbursement_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.reimbursement_worker_post('notice', NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- The recurring notice job can still pick up this committed request.
  RAISE WARNING 'Could not queue reimbursement notice for %', NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER queue_reimbursement_notice
  AFTER INSERT ON public.associate_reimbursements
  FOR EACH ROW WHEN (NEW.automatic_payment)
  EXECUTE FUNCTION public.queue_reimbursement_notice();

REVOKE ALL ON FUNCTION public.set_reimbursement_payment_hold(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reimbursement_payment_hold(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_reimbursement_transfer(uuid, boolean), public.finish_reimbursement_transfer(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reimbursement_transfer(uuid, boolean), public.finish_reimbursement_transfer(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.reimbursement_worker_post(text, uuid), public.queue_reimbursement_notice(), public.guard_reimbursement_resolution()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('associate-reimbursement-notices', '* * * * *',
  $$SELECT public.reimbursement_worker_post('notice');$$
);

DO $$
DECLARE
  v_job record;
  v_schedule text;
BEGIN
  FOR v_job IN SELECT * FROM (VALUES
    ('pay-pending-associates-nightly', 'associate-reimbursements-nightly', 'regular'),
    ('pay-instant-associates-8pm-cdt', 'associate-reimbursements-8pm-cdt', 'instant'),
    ('pay-instant-associates-8pm-cst', 'associate-reimbursements-8pm-cst', 'instant')
  ) AS jobs(payroll_job, reimbursement_job, mode)
  LOOP
    SELECT schedule INTO STRICT v_schedule FROM cron.job WHERE jobname = v_job.payroll_job AND active;
    PERFORM cron.schedule(v_job.reimbursement_job, v_schedule,
      format('SELECT public.reimbursement_worker_post(%L);', v_job.mode));
  END LOOP;
END;
$$;

COMMIT;
