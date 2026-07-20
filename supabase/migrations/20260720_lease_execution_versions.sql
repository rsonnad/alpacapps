-- Preserve every completed lease execution. A reissue must create a new
-- signature pair rather than overwrite or collide with an earlier attempt.

ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS signing_version INTEGER NOT NULL DEFAULT 1
  CHECK (signing_version > 0);

ALTER TABLE signature_audit_log
  ADD COLUMN IF NOT EXISTS signing_version INTEGER NOT NULL DEFAULT 1
  CHECK (signing_version > 0);

DROP INDEX IF EXISTS idx_signature_audit_unique_role_rental;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_audit_unique_execution_role_rental
  ON signature_audit_log (rental_application_id, signing_version, signer_role)
  WHERE rental_application_id IS NOT NULL;
