-- Photo-required associates (Justin, Ike, Amber) must have a before AND an after
-- photo on the shift before it can be closed — on ANY path, not only the
-- clock_out_server_time() RPC. On 2026-11-19 Ike's shift closed with zero photos
-- attached: the app's fallback path (used when the RPC call fails, e.g. a cached
-- older page) updates time_entries directly with no photo check.
--
-- Applies only when the associate closes their own shift (auth.uid() is the login of
-- app_users.id = associate_profiles.app_user_id, i.e. app_users.auth_user_id).
-- Admin edits and the auto-close job (service role / another user) are unaffected,
-- as in 20261117_require_work_photos.sql.

CREATE OR REPLACE FUNCTION public.enforce_work_photos_on_clock_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required boolean;
  v_user uuid;
  v_has_before boolean;
  v_has_after boolean;
BEGIN
  IF OLD.clock_out IS NOT NULL OR NEW.clock_out IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.photos_not_relevant, false) THEN
    RETURN NEW;
  END IF;

  SELECT ap.photos_required, u.auth_user_id INTO v_required, v_user
  FROM associate_profiles ap
  LEFT JOIN app_users u ON u.id = ap.app_user_id
  WHERE ap.id = NEW.associate_id;
  IF NOT COALESCE(v_required, false) OR v_user IS NULL OR v_user IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = NEW.id AND photo_type = 'before'),
         EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = NEW.id AND photo_type = 'after')
    INTO v_has_before, v_has_after;
  IF NOT v_has_before OR NOT v_has_after THEN
    RAISE EXCEPTION 'photos_required: upload % photo(s) before clocking out, or choose "Photos Not Relevant"',
      CASE WHEN NOT v_has_before AND NOT v_has_after THEN 'before and after'
           WHEN NOT v_has_before THEN 'a before' ELSE 'an after' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_work_photos_on_clock_out ON public.time_entries;
CREATE TRIGGER trg_enforce_work_photos_on_clock_out
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_work_photos_on_clock_out();
