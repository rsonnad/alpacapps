-- Vehicle registration tracking + a scoped API key for the external
-- "Meta Muse" agent to keep registration data current.
--
-- Context: `vehicles` already tracks vin/license_plate but had no columns
-- for registration state/expiry/doc, so registration renewals had nowhere
-- to go. This adds those columns and locks down what a staff-level (2)
-- caller -- including an API-key caller -- can write via the internal API
-- to just those columns, so a registration-updating agent can never touch
-- vin/license_plate/ownership fields even if its key were misused.

-- 1. Registration columns -----------------------------------------------

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS registration_state       text,
  ADD COLUMN IF NOT EXISTS registration_number       text,
  ADD COLUMN IF NOT EXISTS registration_expiry       date,
  ADD COLUMN IF NOT EXISTS registration_doc_url      text,
  ADD COLUMN IF NOT EXISTS registered_owner_name     text;

COMMENT ON COLUMN public.vehicles.registration_state   IS 'State that issued the current registration, e.g. TX.';
COMMENT ON COLUMN public.vehicles.registration_number  IS 'State registration/receipt number (not the license plate).';
COMMENT ON COLUMN public.vehicles.registration_expiry  IS 'Registration sticker expiry date.';
COMMENT ON COLUMN public.vehicles.registration_doc_url IS 'Scanned registration document/receipt, if stored (e.g. Drive/R2 link).';
COMMENT ON COLUMN public.vehicles.registered_owner_name IS 'Name on the registration (may differ from vehicles.owner_id).';

CREATE INDEX IF NOT EXISTS idx_vehicles_registration_expiry ON public.vehicles (registration_expiry);

-- 2. Scoped API key for the Meta Muse agent ------------------------------
-- permission_level 2 = staff, matching vehicles.update's minLevel. The
-- api-permissions.ts staffFields list (added alongside this migration)
-- restricts any level-2 caller's vehicles.update payload to the
-- registration_* columns above -- this key can never write vin,
-- license_plate, is_active, etc.
--
-- The actual secret is generated and printed once by
-- scripts/create-api-key.js; only its sha256 hash is stored here.
-- This migration just ensures the row shape is ready; the INSERT itself
-- happens via that script so the plaintext key never lands in git history.
