-- Per-space resident guide for onboarding emails.
-- Staff-authored free text (markdown ok) covering climate, access, quirks.
-- Sent to approved/ready residents via the move-in confirmation email.
-- Not exposed to public or resident portal.

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS resident_guide TEXT;

COMMENT ON COLUMN spaces.resident_guide IS
  'Staff-only onboarding notes for this space (climate, access, quirks). Included in the move-in confirmation email.';
