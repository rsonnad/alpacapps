-- Native e-signature: replace SignWell with in-house HTML signing
-- Adds signing tokens to rental_applications and event_hosting_requests,
-- plus an audit log table for legal defensibility.

-- Add signing token columns to rental_applications
ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS signing_token UUID,
  ADD COLUMN IF NOT EXISTS signing_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_applications_signing_token
  ON rental_applications (signing_token) WHERE signing_token IS NOT NULL;

-- Add signing token columns to event_hosting_requests
ALTER TABLE event_hosting_requests
  ADD COLUMN IF NOT EXISTS signing_token UUID,
  ADD COLUMN IF NOT EXISTS signing_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_hosting_signing_token
  ON event_hosting_requests (signing_token) WHERE signing_token IS NOT NULL;

-- Signature audit log — captures legally-relevant metadata at signing time
CREATE TABLE IF NOT EXISTS signature_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Link to the signed document
  document_type TEXT NOT NULL CHECK (document_type IN ('rental', 'event')),
  rental_application_id UUID REFERENCES rental_applications(id),
  event_hosting_request_id UUID REFERENCES event_hosting_requests(id),
  -- Signer identity
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_role TEXT NOT NULL DEFAULT 'tenant', -- 'tenant' or 'landlord'
  -- Audit metadata
  ip_address TEXT,
  user_agent TEXT,
  document_hash TEXT NOT NULL, -- SHA-256 of the document HTML at signing time
  signature_image_url TEXT,    -- URL to stored signature image
  -- Timestamps
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signature_audit_rental
  ON signature_audit_log (rental_application_id) WHERE rental_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signature_audit_event
  ON signature_audit_log (event_hosting_request_id) WHERE event_hosting_request_id IS NOT NULL;

-- RLS: allow anon read for signing token lookup (edge function uses service role anyway)
ALTER TABLE signature_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON signature_audit_log
  FOR ALL USING (true) WITH CHECK (true);
