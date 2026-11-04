-- Event cleaning, photo proof, inspection and deposit refunds (2026-11-04)
--
-- Flow:
--   1. Request is approved -> event-host-onboard gives the host an associate
--      profile (profile_kind = 'event_host'), an AI-tailored cleaning checklist,
--      an AI cleanup-exposure estimate, and emails the upload link.
--   2. Host uploads BEFORE photos per area (AI reviews them), cleans, ticks the
--      checklist and uploads AFTER photos (AI reviews them and asks for more
--      when an area can't be judged).
--   3. A cleaning inspector passes or fails the clean. Charges come from
--      event_cleaning_charges(): $35 if before or after photos are missing, and
--      on a failed clean base fee + hourly rate x time, never below the minimum.
--      Residents: $15 base (non-residents $30), both $30/hour.
--   4. Staff refund the cleaning deposit minus charges as a payout.

-- ---------------------------------------------------------------------------
-- 1. Cleaning area templates (the AI starts from these, staff can edit them)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_cleaning_area_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key TEXT NOT NULL UNIQUE,
  area_name TEXT NOT NULL,
  space_names TEXT[] NOT NULL DEFAULT '{}',   -- event spaces that pull this area in
  always_include BOOLEAN NOT NULL DEFAULT false,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["Wipe down surfaces ...", ...]
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_cleaning_area_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cleaning_templates_read ON event_cleaning_area_templates;
CREATE POLICY cleaning_templates_read ON event_cleaning_area_templates
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS cleaning_templates_staff_write ON event_cleaning_area_templates;
CREATE POLICY cleaning_templates_staff_write ON event_cleaning_area_templates
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());

-- Seeded from the "Event Playhouse Restoration Task Overview" sheet, mapped to today's event spaces.
INSERT INTO event_cleaning_area_templates (area_key, area_name, space_names, always_include, tasks, sort_order) VALUES
('kitchen_common', 'Kitchen & Living Room', ARRAY['Kitchen','Living Room','Dining Room'], false,
 '["Wash soiled dishes or load/unload the dishwasher (pods under the sink); return clean dishes to their labeled cabinets",
   "Wipe down all surfaces and tidy anything out of place (supplies under the kitchen sink)",
   "Vacuum or sweep floors (vacuum, broom and dustpan in the laundry room)",
   "Empty kitchen and shared-bathroom trash (bags under the kitchen sink)",
   "Put out clean towels and start washing the used ones"]'::jsonb, 10),
('skyloft', 'Skyloft & Balcony', ARRAY['Skyloft','Skyloft Balcony'], false,
 '["Wipe down surfaces and tidy anything out of place",
   "Vacuum or sweep floors",
   "Empty all trash and bathroom trash",
   "Put used linens and towels in the dirty laundry basket (laundry room)",
   "Wash soiled glassware or load/unload the dishwasher; return clean glassware to the wet bar"]'::jsonb, 20),
('garage_mahal', 'Garage Mahal', ARRAY['Garage Mahal'], false,
 '["Wipe down surfaces and tidy anything out of place",
   "Vacuum or sweep floors",
   "Empty trash",
   "Put used linens and towels in the dirty laundry basket (laundry room)",
   "Return moved furniture to where it was in your before photos"]'::jsonb, 30),
('tea_lounge', 'Spartan Tea Lounge', ARRAY['Spartan Tea Lounge'], false,
 '["Wash and put away all tea ware",
   "Wipe down surfaces and tidy anything out of place",
   "Vacuum or sweep floors",
   "Empty trash"]'::jsonb, 40),
('yards_porches', 'Yards & Porches', ARRAY['Back Yard','Back Yard Dining','Front Yard'], false,
 '["Blow out porches and patios with the blower first",
   "Wipe down tables and surfaces; tidy anything out of place",
   "Sweep porch floors",
   "Empty all outdoor trash",
   "Wash soiled dishes and grill cookware or load the dishwasher; return cookware to its labeled cabinets",
   "Pick up all cups, bottles, cigarette butts and decorations from the grass"]'::jsonb, 50),
('spa_sauna', 'Sauna, Spa & Plunge', ARRAY['Sauna','Sparadise','Spa Deck','Spathroom','Swim Spa','Cold Plunge'], false,
 '["Remove all towels from the spa area",
   "Wash, dry and fold every used towel and robe, and put them back where they came from",
   "Cover the jets with the bucket; turn everything off",
   "Wipe down sauna benches and spa surfaces",
   "Empty spa-area trash"]'::jsonb, 60),
('trash', 'Trash', ARRAY[]::text[], true,
 '["All trash in big black plastic bags, tied closed",
   "No trash, boxes or other material left anywhere at the house"]'::jsonb, 80),
('laundry', 'Laundry', ARRAY[]::text[], true,
 '["Wash, dry and fold all used laundry",
   "Empty the dryer lint trap between loads",
   "Remove all trash from the laundry room and vacuum it",
   "Put cleaning supplies back in their places",
   "Restock toilet paper and paper towels as needed"]'::jsonb, 85),
('outdoor_furniture', 'Outdoor Furniture & Gear', ARRAY[]::text[], true,
 '["Heaters: put all of them out of the rain in their designated areas",
   "Daybeds (if used): move out of the rain to their designated areas",
   "Outdoor couch cushions: put out of the rain in their designated areas",
   "Tents (if used): pack back into their containers without mixing equipment"]'::jsonb, 90)
ON CONFLICT (area_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Event request columns
-- ---------------------------------------------------------------------------
ALTER TABLE event_hosting_requests
  ADD COLUMN IF NOT EXISTS associate_profile_id UUID REFERENCES associate_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_resident_host BOOLEAN NOT NULL DEFAULT false,
  -- AI-tailored checklist: [{area_key, area_name, tasks:[{key,text}], needs_photos}]
  ADD COLUMN IF NOT EXISTS cleaning_checklist JSONB,
  ADD COLUMN IF NOT EXISTS cleaning_checklist_generated_at TIMESTAMPTZ,
  -- AI exposure estimate: {max_exposure, likely_cost, cleanup_hours_worst, recommended_deposit, factors[], summary}
  ADD COLUMN IF NOT EXISTS risk_assessment JSONB,
  ADD COLUMN IF NOT EXISTS risk_assessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleaning_base_fee DECIMAL(10,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS cleaning_rate_per_hour DECIMAL(10,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS cleaning_min_charge DECIMAL(10,2) NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS photo_penalty_amount DECIMAL(10,2) NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS cleaning_portal_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS before_photo_review JSONB,
  ADD COLUMN IF NOT EXISTS before_photos_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS after_photo_review JSONB,
  ADD COLUMN IF NOT EXISTS after_photos_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS after_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS more_photos_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS more_photos_request JSONB,      -- [{area_key, area_name, reason}]
  ADD COLUMN IF NOT EXISTS inspection_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inspector_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS inspection_notes TEXT,
  ADD COLUMN IF NOT EXISTS photo_penalty DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS cleaning_charge DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS refund_payout_id UUID REFERENCES payouts(id) ON DELETE SET NULL;

ALTER TABLE event_hosting_requests DROP CONSTRAINT IF EXISTS event_hosting_requests_inspection_status_check;
ALTER TABLE event_hosting_requests ADD CONSTRAINT event_hosting_requests_inspection_status_check
  CHECK (inspection_status IN ('pending', 'passed', 'failed'));

-- ---------------------------------------------------------------------------
-- 3. Photos and checklist ticks
-- ---------------------------------------------------------------------------
ALTER TABLE work_photos
  ADD COLUMN IF NOT EXISTS event_request_id UUID REFERENCES event_hosting_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cleaning_area_key TEXT;
CREATE INDEX IF NOT EXISTS idx_work_photos_event_request ON work_photos(event_request_id) WHERE event_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_cleaning_checks (
  event_request_id UUID NOT NULL REFERENCES event_hosting_requests(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (event_request_id, task_key)
);
ALTER TABLE event_cleaning_checks ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Event hosts are associates for payment only, not workers
-- ---------------------------------------------------------------------------
ALTER TABLE associate_profiles ADD COLUMN IF NOT EXISTS profile_kind TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE associate_profiles DROP CONSTRAINT IF EXISTS associate_profiles_profile_kind_check;
ALTER TABLE associate_profiles ADD CONSTRAINT associate_profiles_profile_kind_check
  CHECK (profile_kind IN ('worker', 'event_host'));

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS event_request_id UUID REFERENCES event_hosting_requests(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. Access: staff see everything; a host sees only their own event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_associate_profile_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ap.id FROM associate_profiles ap
  JOIN app_users u ON u.id = ap.app_user_id
  WHERE u.auth_user_id = auth.uid();
$$;

-- Was "any signed-in user can read and write every request". Hosts now sign in, so lock it down.
DROP POLICY IF EXISTS "Allow all event_hosting_requests" ON event_hosting_requests;
DROP POLICY IF EXISTS "Public read event_hosting_requests" ON event_hosting_requests;
DROP POLICY IF EXISTS event_requests_staff_all ON event_hosting_requests;
CREATE POLICY event_requests_staff_all ON event_hosting_requests
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());
DROP POLICY IF EXISTS event_requests_host_read ON event_hosting_requests;
CREATE POLICY event_requests_host_read ON event_hosting_requests
  FOR SELECT TO authenticated USING (associate_profile_id IN (SELECT public.my_associate_profile_ids()));

DROP POLICY IF EXISTS "Allow all event_request_spaces" ON event_request_spaces;
DROP POLICY IF EXISTS "Public read event_request_spaces" ON event_request_spaces;
DROP POLICY IF EXISTS event_request_spaces_staff_all ON event_request_spaces;
CREATE POLICY event_request_spaces_staff_all ON event_request_spaces
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());
DROP POLICY IF EXISTS event_request_spaces_host_read ON event_request_spaces;
CREATE POLICY event_request_spaces_host_read ON event_request_spaces
  FOR SELECT TO authenticated USING (event_request_id IN (
    SELECT id FROM event_hosting_requests WHERE associate_profile_id IN (SELECT public.my_associate_profile_ids())));

DROP POLICY IF EXISTS event_checks_staff_all ON event_cleaning_checks;
CREATE POLICY event_checks_staff_all ON event_cleaning_checks
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());
DROP POLICY IF EXISTS event_checks_host_read ON event_cleaning_checks;
CREATE POLICY event_checks_host_read ON event_cleaning_checks
  FOR SELECT TO authenticated USING (event_request_id IN (
    SELECT id FROM event_hosting_requests WHERE associate_profile_id IN (SELECT public.my_associate_profile_ids())));

-- Staff need to see event photos (the existing policies only let associates see their own).
DROP POLICY IF EXISTS staff_read_event_photos ON work_photos;
CREATE POLICY staff_read_event_photos ON work_photos
  FOR SELECT TO authenticated USING (event_request_id IS NOT NULL AND public.is_staff_or_admin_user());

-- ---------------------------------------------------------------------------
-- 6. Host actions (the only writes a host can make)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_host_toggle_task(p_request_id uuid, p_task_key text, p_done boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_hosting_requests
                 WHERE id = p_request_id AND associate_profile_id IN (SELECT public.my_associate_profile_ids())) THEN
    RAISE EXCEPTION 'not your event';
  END IF;
  SELECT id INTO v_user FROM app_users WHERE auth_user_id = auth.uid();
  IF p_done THEN
    INSERT INTO event_cleaning_checks (event_request_id, task_key, done_by)
    VALUES (p_request_id, left(p_task_key, 120), v_user) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM event_cleaning_checks WHERE event_request_id = p_request_id AND task_key = p_task_key;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.event_host_add_photo(
  p_request_id uuid, p_media_id uuid, p_photo_type text, p_area_key text, p_caption text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile uuid; v_date date; v_id uuid;
BEGIN
  SELECT associate_profile_id, event_date INTO v_profile, v_date FROM event_hosting_requests
  WHERE id = p_request_id AND associate_profile_id IN (SELECT public.my_associate_profile_ids());
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not your event'; END IF;
  IF p_photo_type NOT IN ('before', 'after') THEN RAISE EXCEPTION 'photo type must be before or after'; END IF;
  IF NOT EXISTS (SELECT 1 FROM media WHERE id = p_media_id AND uploaded_by IS NOT DISTINCT FROM
                 (SELECT id FROM app_users WHERE auth_user_id = auth.uid())) THEN
    -- media.uploaded_by may be unset by older upload paths; still require the row to exist
    IF NOT EXISTS (SELECT 1 FROM media WHERE id = p_media_id) THEN RAISE EXCEPTION 'unknown photo'; END IF;
  END IF;
  INSERT INTO work_photos (associate_id, media_id, photo_type, caption, work_date, event_request_id, cleaning_area_key)
  VALUES (v_profile, p_media_id, p_photo_type, left(p_caption, 300), coalesce(v_date, current_date), p_request_id, left(p_area_key, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.event_host_remove_photo(p_photo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM work_photos wp
  WHERE wp.id = p_photo_id AND wp.event_request_id IS NOT NULL
    AND wp.associate_id IN (SELECT public.my_associate_profile_ids())
    AND NOT EXISTS (SELECT 1 FROM event_hosting_requests r
                    WHERE r.id = wp.event_request_id AND r.inspection_status <> 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.event_host_submit_after(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE event_hosting_requests SET after_submitted_at = now(), updated_at = now()
  WHERE id = p_request_id AND associate_profile_id IN (SELECT public.my_associate_profile_ids())
    AND inspection_status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not your event, or already inspected'; END IF;
END $$;

-- A signed-in user whose email matches the event host's email claims the event:
-- this creates their payment-only associate profile and links it.
CREATE OR REPLACE FUNCTION public.event_host_claim(p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user app_users%ROWTYPE; v_host_email text; v_linked uuid; v_profile uuid;
BEGIN
  SELECT * INTO v_user FROM app_users WHERE auth_user_id = auth.uid();
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
  SELECT lower(p.email), r.associate_profile_id INTO v_host_email, v_linked
  FROM event_hosting_requests r JOIN people p ON p.id = r.person_id WHERE r.id = p_request_id;
  IF v_host_email IS NULL OR v_host_email <> lower(v_user.email) THEN
    RAISE EXCEPTION 'this event belongs to a different email address';
  END IF;
  SELECT id INTO v_profile FROM associate_profiles WHERE app_user_id = v_user.id;
  IF v_profile IS NULL THEN
    INSERT INTO associate_profiles (app_user_id, hourly_rate, is_active, profile_kind, notes)
    VALUES (v_user.id, 0, true, 'event_host', 'Event host: receives deposit refunds')
    RETURNING id INTO v_profile;
  END IF;
  IF v_linked IS NULL OR v_linked <> v_profile THEN
    UPDATE event_hosting_requests SET associate_profile_id = v_profile, updated_at = now() WHERE id = p_request_id;
  END IF;
  RETURN v_profile;
END $$;
REVOKE ALL ON FUNCTION public.event_host_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_host_claim(uuid) TO authenticated;

-- Events a signed-in user can claim (by email), for the host page's event picker.
CREATE OR REPLACE FUNCTION public.event_host_my_events()
RETURNS TABLE (id uuid, event_name text, event_date date, request_status text, linked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.event_name, r.event_date, r.request_status,
         r.associate_profile_id IN (SELECT public.my_associate_profile_ids())
  FROM event_hosting_requests r JOIN people p ON p.id = r.person_id
  WHERE lower(p.email) = (SELECT lower(email) FROM app_users WHERE auth_user_id = auth.uid())
    AND r.request_status = 'approved' AND coalesce(r.is_archived, false) = false
  ORDER BY r.event_date DESC;
$$;
REVOKE ALL ON FUNCTION public.event_host_my_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_host_my_events() TO authenticated;

REVOKE ALL ON FUNCTION public.event_host_toggle_task(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_host_add_photo(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_host_remove_photo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_host_submit_after(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_host_toggle_task(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_host_add_photo(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_host_remove_photo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_host_submit_after(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Charge rule (one place, used by the inspector screen and the refund)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_cleaning_charges(
  p_request_id uuid,
  p_status text DEFAULT NULL,       -- preview a pass/fail before saving
  p_minutes integer DEFAULT NULL)
RETURNS TABLE (has_before boolean, has_after boolean, photo_penalty numeric,
               cleaning_charge numeric, total_charges numeric, deposit numeric, refund numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_hosting_requests%ROWTYPE; v_status text; v_minutes int;
BEGIN
  SELECT * INTO r FROM event_hosting_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (public.is_staff_or_admin_user()
          OR r.associate_profile_id IN (SELECT public.my_associate_profile_ids())
          OR auth.uid() IS NULL) THEN  -- no user: only service_role can reach here (anon has no EXECUTE)
    RAISE EXCEPTION 'not allowed';
  END IF;
  v_status := coalesce(p_status, r.inspection_status);
  v_minutes := coalesce(p_minutes, r.inspection_minutes, 0);
  has_before := EXISTS (SELECT 1 FROM work_photos WHERE event_request_id = p_request_id AND photo_type = 'before');
  has_after  := EXISTS (SELECT 1 FROM work_photos WHERE event_request_id = p_request_id AND photo_type = 'after');
  photo_penalty := CASE WHEN has_before AND has_after THEN 0 ELSE r.photo_penalty_amount END;
  cleaning_charge := CASE WHEN v_status = 'failed'
    THEN round(greatest(r.cleaning_min_charge, r.cleaning_base_fee + r.cleaning_rate_per_hour * v_minutes / 60.0), 2)
    ELSE 0 END;
  total_charges := photo_penalty + cleaning_charge;
  deposit := coalesce(r.cleaning_deposit, 0);
  refund := greatest(deposit - total_charges, 0);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.event_cleaning_charges(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_cleaning_charges(uuid, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Agreement text: the cleaning terms live in this template row too
-- ---------------------------------------------------------------------------
UPDATE event_agreement_templates
SET content = replace(content,
  'If the house is not cleaned, the company will hire a cleaner and deduct from the damage deposit, estimated around $150 but billed at the actual cost @ $30/hour + $30.',
  'Client will receive a cleaning checklist tailored to the event and must upload BEFORE photos of each area before the event and AFTER photos once cleaning is done. Missing before or after photos: $35 charge. A cleaning inspector verifies the clean. If it is not clean, Company will finish the cleaning and deduct $30 + $30/hour (house residents: $15 + $30/hour), with a minimum charge of $35 (house residents: $20), up to the full cost of cleaning.')
WHERE content LIKE '%billed at the actual cost @ $30/hour + $30.%';

UPDATE event_agreement_templates
SET content = replace(content,
  'Cleaning not completed by this time will be charged at $30 + $30/hour. Deposits returned within 24 hours after cleaning photos submitted.',
  'Cleaning not completed by this time is finished by our cleaner at $30 + $30/hour (house residents $15 + $30/hour), minimum $35 (residents $20). Before and after photos of every area are required ($35 if missing). Deposits are refunded after the cleaning inspection.')
WHERE content LIKE '%will be charged at $30 + $30/hour. Deposits returned within 24 hours%';
