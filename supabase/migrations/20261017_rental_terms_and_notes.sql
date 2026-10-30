-- Rental terms + rental notes, for the `rentals` / `rental_notes` resources
-- of the `api` gateway (used by the Meta Muse agent).
--
-- 1. assignments.end_behavior — explicit answer to "what happens at end_date?"
--      'month_to_month' = initial term ends, tenancy continues monthly until notice
--      'fixed'          = tenancy ends on end_date
--      NULL             = not recorded; the API infers it (Airbnb → fixed,
--                         lease application notice_period, open-ended → monthly)
--    Vehicle rentals already carry this as vehicle_rentals.auto_renew.
--
-- 2. rental_notes — free-text notes attached to exactly one rental: a space
--    booking (assignments row, Airbnb or direct) or a vehicle rental.
--    e.g. "Airbnb guest is planning to extend but hasn't finalized yet".

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS end_behavior TEXT
    CHECK (end_behavior IN ('month_to_month', 'fixed'));

COMMENT ON COLUMN public.assignments.end_behavior IS
  'What happens at end_date: month_to_month (rolls monthly until notice) or fixed (ends). NULL = inferred by the api gateway.';

CREATE TABLE IF NOT EXISTS public.rental_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE,
  vehicle_rental_id UUID REFERENCES public.vehicle_rentals(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  -- Optional short label, e.g. 'extension', 'move_out', 'payment', 'general'
  tag TEXT,
  -- Who wrote it: app_user display name, or API key name for agents
  author_label TEXT,
  created_by_app_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_by_api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rental_notes_one_target CHECK (num_nonnulls(assignment_id, vehicle_rental_id) = 1)
);

CREATE INDEX IF NOT EXISTS idx_rental_notes_assignment
  ON public.rental_notes(assignment_id, created_at DESC) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rental_notes_vehicle_rental
  ON public.rental_notes(vehicle_rental_id, created_at DESC) WHERE vehicle_rental_id IS NOT NULL;

ALTER TABLE public.rental_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_notes_staff_read ON public.rental_notes;
CREATE POLICY rental_notes_staff_read ON public.rental_notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff'))
  );

DROP POLICY IF EXISTS rental_notes_staff_insert ON public.rental_notes;
CREATE POLICY rental_notes_staff_insert ON public.rental_notes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff'))
  );

DROP POLICY IF EXISTS rental_notes_admin_write ON public.rental_notes;
CREATE POLICY rental_notes_admin_write ON public.rental_notes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  );

DROP POLICY IF EXISTS rental_notes_service ON public.rental_notes;
CREATE POLICY rental_notes_service ON public.rental_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
