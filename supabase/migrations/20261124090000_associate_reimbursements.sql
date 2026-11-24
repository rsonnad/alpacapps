BEGIN;

CREATE TABLE public.associate_reimbursements (
  id uuid PRIMARY KEY,
  associate_id uuid NOT NULL REFERENCES public.associate_profiles(id),
  space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
  purchase_date date NOT NULL,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  receipt_paths text[] NOT NULL CHECK (cardinality(receipt_paths) BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.app_users(id),
  resolution_note text,
  paid_date date,
  ledger_id uuid UNIQUE REFERENCES public.ledger(id),
  CHECK ((status = 'paid') = (ledger_id IS NOT NULL AND paid_date IS NOT NULL))
);

CREATE INDEX associate_reimbursements_owner_idx
  ON public.associate_reimbursements (associate_id, created_at DESC);
CREATE INDEX associate_reimbursements_queue_idx
  ON public.associate_reimbursements (status, created_at DESC);

ALTER TABLE public.associate_reimbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.associate_reimbursements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.associate_reimbursements TO authenticated;

CREATE POLICY "Associate reads own reimbursement or admin reads all"
ON public.associate_reimbursements FOR SELECT TO authenticated
USING (
  (SELECT public.is_admin_user()) OR associate_id IN (
    SELECT ap.id FROM public.associate_profiles ap
    JOIN public.app_users u ON u.id = ap.app_user_id
    WHERE u.auth_user_id = (SELECT auth.uid())
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reimbursement-receipts', 'reimbursement-receipts', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
);

CREATE POLICY "Associate uploads private reimbursement receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'reimbursement-receipts'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp|heic|heif|pdf)$'
  AND EXISTS (
    SELECT 1 FROM public.associate_profiles ap
    JOIN public.app_users u ON u.id = ap.app_user_id
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.role IN ('associate', 'staff', 'admin', 'oracle')
  )
);

CREATE POLICY "Receipt owner or reviewing admin can read receipt"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'reimbursement-receipts'
  AND (
    split_part(name, '/', 1) = (SELECT auth.uid())::text
    OR (
      (SELECT public.is_admin_user())
      AND EXISTS (
        SELECT 1 FROM public.associate_reimbursements r
        WHERE r.receipt_paths @> ARRAY[storage.objects.name]
      )
    )
  )
);

CREATE INDEX associate_reimbursements_receipts_idx
  ON public.associate_reimbursements USING gin (receipt_paths);

CREATE FUNCTION public.submit_associate_reimbursement(
  p_id uuid, p_amount_cents integer, p_purchase_date date,
  p_description text, p_space_id uuid, p_receipt_paths text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_auth_id uuid := auth.uid();
  v_associate_id uuid;
BEGIN
  SELECT ap.id INTO v_associate_id
    FROM public.associate_profiles ap
    JOIN public.app_users u ON u.id = ap.app_user_id
    WHERE u.auth_user_id = v_auth_id AND u.role IN ('associate', 'staff', 'admin', 'oracle');
  IF v_associate_id IS NULL THEN
    RAISE EXCEPTION 'An associate profile is required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.associate_reimbursements WHERE id = p_id AND associate_id = v_associate_id
  ) THEN
    RETURN p_id;
  END IF;
  IF p_id IS NULL OR p_purchase_date IS NULL OR p_purchase_date > (now() AT TIME ZONE 'America/Chicago')::date THEN
    RAISE EXCEPTION 'Enter a valid purchase date';
  END IF;
  IF p_space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.spaces WHERE id = p_space_id AND NOT is_archived AND NOT is_micro
  ) THEN
    RAISE EXCEPTION 'Choose a current space or leave it blank';
  END IF;
  IF p_receipt_paths IS NULL OR cardinality(p_receipt_paths) NOT BETWEEN 1 AND 5
     OR (SELECT count(DISTINCT path) FROM unnest(p_receipt_paths) AS receipt(path)) <> cardinality(p_receipt_paths)
     OR EXISTS (
       SELECT 1 FROM unnest(p_receipt_paths) AS receipt(path)
       WHERE split_part(path, '/', 1) <> v_auth_id::text
          OR split_part(path, '/', 2) <> p_id::text
          OR NOT EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = 'reimbursement-receipts' AND o.name = receipt.path
          )
     ) THEN
    RAISE EXCEPTION 'Upload between one and five receipts for this reimbursement';
  END IF;

  INSERT INTO public.associate_reimbursements
    (id, associate_id, amount_cents, purchase_date, description, space_id, receipt_paths)
  VALUES
    (p_id, v_associate_id, p_amount_cents, p_purchase_date,
     btrim(regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g')),
     p_space_id, p_receipt_paths)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM public.associate_reimbursements WHERE id = p_id AND associate_id = v_associate_id
  ) THEN
    RAISE EXCEPTION 'Request identifier already in use';
  END IF;
  RETURN p_id;
END;
$$;

CREATE FUNCTION public.resolve_associate_reimbursement(
  p_id uuid, p_status text, p_paid_date date, p_payment_method text, p_note text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.associate_reimbursements%ROWTYPE;
  v_actor_id uuid;
  v_person_id uuid;
  v_person_name text;
  v_ledger_id uuid;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF NOT coalesce(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO STRICT v_actor_id FROM public.app_users WHERE auth_user_id = auth.uid();
  SELECT * INTO STRICT v_request FROM public.associate_reimbursements WHERE id = p_id FOR UPDATE;

  IF v_request.status <> 'pending' THEN
    IF v_request.status = p_status THEN
      RETURN p_id;
    END IF;
    RAISE EXCEPTION 'This reimbursement has already been resolved';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Keep the note to 500 characters';
  END IF;

  IF p_status = 'paid' THEN
    IF p_paid_date IS NULL OR p_paid_date < v_request.purchase_date
       OR p_paid_date > (now() AT TIME ZONE 'America/Chicago')::date
       OR p_payment_method IS NULL THEN
      RAISE EXCEPTION 'Enter a valid payment date and method';
    END IF;
    SELECT u.person_id, u.display_name
      INTO v_person_id, v_person_name
      FROM public.associate_profiles ap
      JOIN public.app_users u ON u.id = ap.app_user_id
      WHERE ap.id = v_request.associate_id;

    INSERT INTO public.ledger
      (direction, category, amount, payment_method, transaction_date, person_id,
       person_name, description, notes, status, recorded_by)
    VALUES
      ('expense', 'other', v_request.amount_cents / 100.0, p_payment_method,
       p_paid_date, v_person_id, v_person_name, 'Reimbursement: ' || v_request.description,
       concat_ws(E'\n', 'Reimbursement request ' || p_id::text, v_note), 'completed', 'admin')
    RETURNING id INTO v_ledger_id;
  ELSIF p_status = 'declined' THEN
    IF v_note IS NULL OR v_note !~ '[^[:space:]]' THEN
      RAISE EXCEPTION 'Enter a reason for declining';
    END IF;
  ELSE
    RAISE EXCEPTION 'Choose paid or declined';
  END IF;

  UPDATE public.associate_reimbursements
    SET status = p_status, resolved_at = now(), resolved_by = v_actor_id,
        resolution_note = v_note, ledger_id = v_ledger_id,
        paid_date = CASE WHEN p_status = 'paid' THEN p_paid_date END
    WHERE id = p_id;
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_associate_reimbursement(uuid, integer, date, text, uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_associate_reimbursement(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_associate_reimbursement(uuid, integer, date, text, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_associate_reimbursement(uuid, text, date, text, text) TO authenticated;

COMMIT;
