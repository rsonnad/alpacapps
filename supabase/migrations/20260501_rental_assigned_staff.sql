-- Track which admin/staff member owns a rental application.
-- The staff/rentals.html detail page surfaces this as an editable dropdown of
-- app_users with role IN ('admin','staff').
ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rental_applications_assigned_staff
  ON rental_applications(assigned_staff_id);
