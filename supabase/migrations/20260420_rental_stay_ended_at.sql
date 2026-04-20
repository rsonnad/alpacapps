-- Add stay_ended_at to rental_applications to distinguish active vs past residents
-- in the pipeline UI. move_in_confirmed_at alone can't tell us whether someone is
-- currently staying or has already moved out.
ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS stay_ended_at timestamptz;

-- Backfill: three applications were marked move_in_confirmed_at=now() on 2026-04-20
-- to push them out of the active pipeline, but they are actually past guests, not
-- current residents. Mark their stays as ended so they appear in "Past Residents".
UPDATE rental_applications
SET stay_ended_at = move_in_confirmed_at
WHERE id IN (
  '88ca9347-a6ef-4f1f-9b0f-96ac44bae850', -- Chelsae Zirna
  '4be6ed7c-2bed-4cb4-af12-deff6d7e7e1f', -- Michael Olteanu
  'a5ec83d7-547f-4ac3-be18-5256502accf3'  -- Elise Sheppard
);
