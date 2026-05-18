-- Code review fixes (AA17): security, fraud, audit hardening
--
-- Covers items: #1 #2 #3 #4 #9 #11 #13 #17 #18 #20 #23 #25 #28 #31 #32
-- See: ttran AA17 alpacapps-code-review-fixes.md
--
-- Idempotent — safe to re-run.

-- =============================================================
-- #3: Prevent concurrent clock-ins
-- Partial unique index — only one open entry per associate at a time.
-- =============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_open_per_associate
  ON time_entries (associate_id)
  WHERE clock_out IS NULL;

-- =============================================================
-- #2: Make payout runs idempotent
-- Add a join table that enforces UNIQUE(time_entry_id) — a time entry
-- cannot be claimed by two payouts. The existing payouts.time_entry_ids
-- ARRAY column is denormalized; this join is the source of truth for
-- "which entries were paid out by which payout."
-- =============================================================
CREATE TABLE IF NOT EXISTS payout_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payout_time_entries_unique UNIQUE (time_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_payout_time_entries_payout
  ON payout_time_entries (payout_id);

ALTER TABLE payout_time_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON payout_time_entries;
CREATE POLICY "Service role full access" ON payout_time_entries
  FOR ALL USING (true) WITH CHECK (true);

-- Backfill from existing payouts.time_entry_ids arrays — best effort.
INSERT INTO payout_time_entries (payout_id, time_entry_id)
SELECT p.id, te_id
FROM payouts p, unnest(p.time_entry_ids) AS te_id
WHERE p.time_entry_ids IS NOT NULL
ON CONFLICT (time_entry_id) DO NOTHING;

-- =============================================================
-- #13: Time-entry payment state machine
-- Add payment_status to time_entries. Backfill from is_paid.
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='time_entries' AND column_name='payment_status'
  ) THEN
    ALTER TABLE time_entries ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
      CHECK (payment_status IN ('unpaid', 'pending_review', 'approved', 'rejected', 'paid'));
    ALTER TABLE time_entries ADD COLUMN payment_rejected_reason TEXT;
    ALTER TABLE time_entries ADD COLUMN payment_status_changed_at TIMESTAMPTZ;
    ALTER TABLE time_entries ADD COLUMN payment_status_changed_by UUID;
  END IF;
END $$;

-- Backfill: if is_paid=true then payment_status='paid'
UPDATE time_entries
SET payment_status='paid'
WHERE is_paid = true AND payment_status = 'unpaid';

-- Keep is_paid in sync via trigger (legacy code still reads is_paid).
CREATE OR REPLACE FUNCTION sync_time_entry_payment_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    NEW.payment_status_changed_at := now();
  END IF;
  -- Mirror to legacy boolean.
  IF NEW.payment_status = 'paid' THEN
    NEW.is_paid := true;
  ELSE
    NEW.is_paid := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS time_entries_payment_status_sync ON time_entries;
CREATE TRIGGER time_entries_payment_status_sync
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status
        OR OLD.is_paid IS DISTINCT FROM NEW.is_paid)
  EXECUTE FUNCTION sync_time_entry_payment_status();

-- =============================================================
-- #25: Composite index for admin payouts list query
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_time_entries_payouts_list
  ON time_entries (associate_id, is_paid, clock_in DESC);

-- =============================================================
-- #1: Cross-associate ownership enforcement via RLS
-- Service-role bypasses RLS, so admin tools and edge functions still work.
-- An associate authenticated through PostgREST may only insert/update/delete
-- rows whose associate_id matches their own profile.
-- =============================================================
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_associate_profile_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT ap.id
  FROM associate_profiles ap
  JOIN app_users u ON u.id = ap.app_user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1
$$;

DROP POLICY IF EXISTS "Associates read own time entries" ON time_entries;
CREATE POLICY "Associates read own time entries" ON time_entries
  FOR SELECT
  USING (
    associate_id = current_associate_profile_id()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle', 'staff')
    )
  );

DROP POLICY IF EXISTS "Associates insert own time entries" ON time_entries;
CREATE POLICY "Associates insert own time entries" ON time_entries
  FOR INSERT
  WITH CHECK (
    associate_id = current_associate_profile_id()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle', 'staff')
    )
  );

DROP POLICY IF EXISTS "Associates update own time entries" ON time_entries;
CREATE POLICY "Associates update own time entries" ON time_entries
  FOR UPDATE
  USING (
    associate_id = current_associate_profile_id()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle', 'staff')
    )
  )
  WITH CHECK (
    associate_id = current_associate_profile_id()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle', 'staff')
    )
  );

DROP POLICY IF EXISTS "Admin delete time entries" ON time_entries;
CREATE POLICY "Admin delete time entries" ON time_entries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle')
    )
  );

-- =============================================================
-- #4 + #17 + #31 + #32: Audit log enhancements
-- document_html and landlord_signature_url already exist.
-- Add template_id, template_version, email_template_id/version,
-- landlord_user_id, signing_token_issued_at.
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='signature_audit_log' AND column_name='template_id'
  ) THEN
    ALTER TABLE signature_audit_log
      ADD COLUMN template_id UUID,
      ADD COLUMN template_version INTEGER,
      ADD COLUMN waiver_template_id UUID,
      ADD COLUMN waiver_template_version INTEGER,
      ADD COLUMN email_template_id UUID,
      ADD COLUMN email_template_version INTEGER,
      ADD COLUMN landlord_user_id UUID,
      ADD COLUMN signing_token_issued_at TIMESTAMPTZ,
      ADD COLUMN signing_token_issued_by_ip TEXT,
      ADD COLUMN signing_token_issued_by_ua TEXT;
  END IF;
END $$;

-- =============================================================
-- #9: Two-party signing race
-- One tenant + one landlord signature per rental_application.
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname='idx_signature_audit_unique_role_rental'
  ) THEN
    -- Clean up any pre-existing dup rows before adding the unique index.
    DELETE FROM signature_audit_log a
    USING signature_audit_log b
    WHERE a.id < b.id
      AND a.rental_application_id IS NOT NULL
      AND a.rental_application_id = b.rental_application_id
      AND a.signer_role = b.signer_role;

    CREATE UNIQUE INDEX idx_signature_audit_unique_role_rental
      ON signature_audit_log (rental_application_id, signer_role)
      WHERE rental_application_id IS NOT NULL;

    DELETE FROM signature_audit_log a
    USING signature_audit_log b
    WHERE a.id < b.id
      AND a.event_hosting_request_id IS NOT NULL
      AND a.event_hosting_request_id = b.event_hosting_request_id
      AND a.signer_role = b.signer_role;

    CREATE UNIQUE INDEX idx_signature_audit_unique_role_event
      ON signature_audit_log (event_hosting_request_id, signer_role)
      WHERE event_hosting_request_id IS NOT NULL;
  END IF;
END $$;

-- =============================================================
-- #18: Idempotency on SignWell webhook
-- Track which document IDs have already been processed.
-- =============================================================
CREATE TABLE IF NOT EXISTS signwell_processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB,
  CONSTRAINT signwell_processed_events_uniq UNIQUE (document_id, event_type)
);
ALTER TABLE signwell_processed_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON signwell_processed_events;
CREATE POLICY "Service role full access" ON signwell_processed_events
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================================
-- #11: Lock down application status transitions
-- Define allowed transitions; deny moves to "earlier" states (re-opening).
-- =============================================================
CREATE OR REPLACE FUNCTION enforce_application_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  rank_old INT;
  rank_new INT;
  caller_role TEXT;
BEGIN
  IF NEW.application_status IS NOT DISTINCT FROM OLD.application_status THEN
    RETURN NEW;
  END IF;

  -- Determine caller role (admin/oracle can do anything).
  SELECT role INTO caller_role
  FROM app_users WHERE auth_user_id = auth.uid()
  LIMIT 1;

  -- Service role (no auth.uid()) is allowed.
  IF auth.uid() IS NULL OR caller_role IN ('admin', 'oracle') THEN
    RETURN NEW;
  END IF;

  -- Status ladder. Higher = later in pipeline.
  rank_old := CASE OLD.application_status
    WHEN 'inquiry'      THEN 1
    WHEN 'submitted'    THEN 2
    WHEN 'under_review' THEN 3
    WHEN 'needs_more_info' THEN 4
    WHEN 'approved'     THEN 5
    WHEN 'declined'     THEN 5
    WHEN 'withdrawn'    THEN 6
    WHEN 'leased'       THEN 7
    WHEN 'archived'     THEN 99
    ELSE 0
  END;
  rank_new := CASE NEW.application_status
    WHEN 'inquiry'      THEN 1
    WHEN 'submitted'    THEN 2
    WHEN 'under_review' THEN 3
    WHEN 'needs_more_info' THEN 4
    WHEN 'approved'     THEN 5
    WHEN 'declined'     THEN 5
    WHEN 'withdrawn'    THEN 6
    WHEN 'leased'       THEN 7
    WHEN 'archived'     THEN 99
    ELSE 0
  END;

  IF rank_new < rank_old THEN
    RAISE EXCEPTION 'Application status cannot move backward from % to %', OLD.application_status, NEW.application_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_application_status_transition ON rental_applications;
CREATE TRIGGER enforce_application_status_transition
  BEFORE UPDATE OF application_status ON rental_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_application_status_transition();

-- =============================================================
-- #23: decline_reason + needs_more_info + status timestamps
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='rental_applications' AND column_name='applicant_visible_decline_reason'
  ) THEN
    ALTER TABLE rental_applications
      ADD COLUMN applicant_visible_decline_reason TEXT,
      ADD COLUMN needs_more_info_message TEXT,
      ADD COLUMN needs_more_info_requested_at TIMESTAMPTZ,
      ADD COLUMN status_token UUID DEFAULT gen_random_uuid(),
      ADD COLUMN status_history JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Backfill status_token for older rows.
UPDATE rental_applications SET status_token = gen_random_uuid() WHERE status_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_rental_applications_status_token
  ON rental_applications (status_token) WHERE status_token IS NOT NULL;

-- Append to status_history on every status change.
CREATE OR REPLACE FUNCTION append_application_status_history()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.application_status IS DISTINCT FROM OLD.application_status THEN
    NEW.status_history := COALESCE(OLD.status_history, '[]'::jsonb) ||
      jsonb_build_object(
        'from', OLD.application_status,
        'to', NEW.application_status,
        'at', now(),
        'by', COALESCE(auth.uid()::text, 'system')
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS append_application_status_history ON rental_applications;
CREATE TRIGGER append_application_status_history
  BEFORE UPDATE OF application_status ON rental_applications
  FOR EACH ROW EXECUTE FUNCTION append_application_status_history();

-- =============================================================
-- #20: Atomic person + application insert
-- One RPC the public form calls — runs in a transaction.
-- =============================================================
CREATE OR REPLACE FUNCTION submit_rental_inquiry(p_person JSONB, p_app JSONB)
RETURNS TABLE (person_id UUID, application_id UUID, status_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_id UUID;
  v_app_id UUID;
  v_token UUID;
BEGIN
  INSERT INTO people (
    first_name, last_name, email, phone, whatsapp, date_of_birth,
    gender, coliving_experience, life_focus, visiting_guide_response,
    desired_timeframe, preferred_accommodation, volunteer_interest,
    pets, photo_url, referral_source, instagram, facebook, x_handle,
    status, notes
  )
  VALUES (
    p_person->>'first_name', p_person->>'last_name', p_person->>'email',
    p_person->>'phone', p_person->>'whatsapp',
    NULLIF(p_person->>'date_of_birth','')::DATE,
    p_person->>'gender', p_person->>'coliving_experience',
    p_person->>'life_focus', p_person->>'visiting_guide_response',
    p_person->>'desired_timeframe', p_person->>'preferred_accommodation',
    p_person->>'volunteer_interest', p_person->>'pets', p_person->>'photo_url',
    p_person->>'referral_source', p_person->>'instagram', p_person->>'facebook',
    p_person->>'x_handle',
    COALESCE(p_person->>'status', 'candidate'),
    p_person->>'notes'
  )
  RETURNING id INTO v_person_id;

  INSERT INTO rental_applications (person_id, application_status)
  VALUES (v_person_id, COALESCE(p_app->>'application_status', 'inquiry'))
  RETURNING id, status_token INTO v_app_id, v_token;

  RETURN QUERY SELECT v_person_id, v_app_id, v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_rental_inquiry(JSONB, JSONB) TO anon, authenticated;

-- =============================================================
-- #10 + #28: Per-IP rate limit table
-- Records throttled attempts; edge functions consult and rate-limit.
-- =============================================================
CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_ip_created
  ON rate_limit_attempts (bucket, ip_address, created_at DESC);

ALTER TABLE rate_limit_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON rate_limit_attempts;
CREATE POLICY "Service role full access" ON rate_limit_attempts
  FOR ALL USING (true) WITH CHECK (true);

-- Sliding-window helper. Returns true if caller should be allowed.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_bucket TEXT,
  p_ip TEXT,
  p_max_attempts INT,
  p_window_seconds INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM rate_limit_attempts
  WHERE bucket = p_bucket
    AND ip_address = p_ip
    AND created_at > now() - make_interval(secs => p_window_seconds);

  INSERT INTO rate_limit_attempts (bucket, ip_address) VALUES (p_bucket, p_ip);

  -- Purge old rows opportunistically (no-op if nothing to delete).
  DELETE FROM rate_limit_attempts
  WHERE id IN (
    SELECT id FROM rate_limit_attempts
    WHERE created_at < now() - interval '1 day'
    LIMIT 100
  );

  RETURN cnt < p_max_attempts;
END;
$$;

GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, TEXT, INT, INT) TO anon, authenticated;

-- =============================================================
-- #24: Server-side manual_reason min length (>= 10 chars when set).
-- =============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'time_entries_manual_reason_min_length'
  ) THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT time_entries_manual_reason_min_length
      CHECK (
        NOT is_manual
        OR manual_reason IS NULL
        OR length(trim(manual_reason)) >= 10
      ) NOT VALID;  -- NOT VALID so existing rows aren't re-validated
  END IF;
END $$;

-- =============================================================
-- #15: Server-clock clock-out RPC. Computes duration from clock_in (UTC) to now().
-- =============================================================
CREATE OR REPLACE FUNCTION clock_out_server_time(
  p_entry_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS SETOF time_entries
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_ci TIMESTAMPTZ;
BEGIN
  SELECT clock_in INTO v_ci FROM time_entries WHERE id = p_entry_id;
  IF v_ci IS NULL THEN
    RAISE EXCEPTION 'time_entry % not found', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
    UPDATE time_entries
    SET clock_out = now(),
        duration_minutes = GREATEST(0, EXTRACT(EPOCH FROM (now() - v_ci))::INT / 60),
        clock_out_lat = p_lat,
        clock_out_lng = p_lng,
        description = COALESCE(p_description, description),
        updated_at = now()
    WHERE id = p_entry_id
    RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION clock_out_server_time(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- Down:
--   Each block uses IF (NOT) EXISTS so re-running is safe.
--   To roll back: drop the new tables/columns/indexes/functions listed above.
