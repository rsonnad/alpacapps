-- Add last activity tracking to rental pipeline cards
ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_by text;

-- Backfill from existing timestamps
UPDATE rental_applications SET
  last_activity_at = GREATEST(
    updated_at, submitted_at, reviewed_at,
    agreement_generated_at, agreement_sent_at, agreement_signed_at,
    deposit_requested_at, deposit_confirmed_at, move_in_confirmed_at,
    invited_to_apply_at, reservation_deposit_paid_at,
    move_in_deposit_paid_at, security_deposit_paid_at, created_at
  ),
  last_activity_by = reviewed_by
WHERE last_activity_at IS NULL;
