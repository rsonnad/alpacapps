-- Add require_deposit flag to rental_applications.
-- When false, the deposit stage is skipped — pipeline jumps from Contract
-- directly to Ready. Mirrors the existing require_lease pattern.
-- Defaults to true so all existing applications are unaffected.

ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS require_deposit BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN rental_applications.require_deposit IS
  'When false, deposit stage is skipped (e.g. short-term nightly stays paid via app fee).';
