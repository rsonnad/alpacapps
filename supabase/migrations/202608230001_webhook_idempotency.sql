-- Provider webhook claims. Webhooks are at-least-once and must be replay-safe.
CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_status
  ON provider_webhook_events(provider, status, updated_at);

ALTER TABLE provider_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages provider webhook events" ON provider_webhook_events;
CREATE POLICY "Service role manages provider webhook events"
  ON provider_webhook_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Restore event hosting boundaries that were originally created as public FOR ALL.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['event_hosting_requests', 'event_request_spaces', 'event_agreement_templates', 'event_payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Public read ' || table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'Allow all ' || table_name, table_name);
  END LOOP;
END $$;

CREATE POLICY "Public can submit event requests"
  ON event_hosting_requests FOR INSERT TO anon, authenticated
  WITH CHECK (request_status = 'submitted' AND is_archived = false);

CREATE POLICY "Authenticated users read own event requests"
  ON event_hosting_requests FOR SELECT TO authenticated
  USING (person_id IN (SELECT person_id FROM app_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Staff manage event requests"
  ON event_hosting_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')));

CREATE POLICY "Authenticated users read own event spaces"
  ON event_request_spaces FOR SELECT TO authenticated
  USING (event_request_id IN (SELECT id FROM event_hosting_requests WHERE person_id IN (SELECT person_id FROM app_users WHERE auth_user_id = auth.uid())));

CREATE POLICY "Staff manage event spaces"
  ON event_request_spaces FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')));

CREATE POLICY "Authenticated users read active templates"
  ON event_agreement_templates FOR SELECT TO authenticated
  USING (is_active = true OR EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')));

CREATE POLICY "Staff manage templates"
  ON event_agreement_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')));

CREATE POLICY "Authenticated users read own event payments"
  ON event_payments FOR SELECT TO authenticated
  USING (event_request_id IN (SELECT id FROM event_hosting_requests WHERE person_id IN (SELECT person_id FROM app_users WHERE auth_user_id = auth.uid())));

CREATE POLICY "Staff manage event payments"
  ON event_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff')));

-- Never expose the claim table to browser roles.
REVOKE ALL ON provider_webhook_events FROM anon, authenticated;

-- Rate limits must be atomic and browser roles must not be able to delete or
-- insert rows directly to reset/bomb a bucket.
DROP POLICY IF EXISTS "Service role full access" ON rate_limit_attempts;
CREATE POLICY "Service role manages rate limits"
  ON rate_limit_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON rate_limit_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_bucket TEXT,
  p_ip TEXT,
  p_max_attempts INT,
  p_window_seconds INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_ip, 0));
  SELECT COUNT(*) INTO cnt
  FROM rate_limit_attempts
  WHERE bucket = p_bucket
    AND ip_address = p_ip
    AND created_at > now() - make_interval(secs => p_window_seconds);

  INSERT INTO rate_limit_attempts (bucket, ip_address) VALUES (p_bucket, p_ip);
  DELETE FROM rate_limit_attempts WHERE created_at < now() - interval '1 day';
  RETURN cnt < p_max_attempts;
END;
$$;

REVOKE ALL ON FUNCTION check_rate_limit(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, TEXT, INT, INT) TO anon, authenticated, service_role;
