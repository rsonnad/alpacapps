-- Full audit trail for associate_schedules (INSERT, UPDATE, DELETE).
--
-- Why: schedule_edits looked "silent since 2026-05-02". The old trigger
-- (trg_audit_schedule_edit, BEFORE UPDATE) was still live, but:
--   1. It only logged UPDATEs that changed a field. hours-service.js re-upserts
--      every row of the week on save, so most saves are no-op updates, and new
--      shifts are INSERTs, which were never logged.
--   2. Cleared shifts are hard-DELETEd (hours-service.js upsertSchedule), and
--      DELETEs were never logged.
--   3. schedule_edits.schedule_id had FK ... ON DELETE CASCADE, so deleting a
--      shift also erased any edit history it had.
--   4. edited_by was set to NEW.associate_id (the shift owner), not the person
--      who made the change.
--   5. modification_count was bumped on every UPDATE, even no-op re-saves.
-- Found 2026-11-18 when nobody could tell who removed Justin Gilbertson's
-- Nov 10/17/18 shifts.

-- 1. Keep history after the shift row is gone: drop the cascading FK.
--    schedule_id keeps the (possibly deleted) shift's id.
ALTER TABLE public.schedule_edits
  DROP CONSTRAINT IF EXISTS schedule_edits_schedule_id_fkey;

-- 2. Context columns.
ALTER TABLE public.schedule_edits
  ADD COLUMN IF NOT EXISTS schedule_date date,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS edited_via text;

COMMENT ON COLUMN public.schedule_edits.schedule_id IS
  'associate_schedules.id of the shift. No FK: the shift may since have been deleted.';
COMMENT ON COLUMN public.schedule_edits.action IS
  'insert | update | delete (NULL on rows written before 2026-11-18).';
COMMENT ON COLUMN public.schedule_edits.edited_by IS
  'Since 2026-11-18: auth.uid() of the editor (auth.users.id), NULL for service-role/SQL edits. Before that: the shift owner''s associate_profiles.id.';
COMMENT ON COLUMN public.schedule_edits.edited_via IS
  'JWT role of the request (authenticated, service_role, ...) or the DB user for direct SQL.';

CREATE INDEX IF NOT EXISTS schedule_edits_assoc_date_idx
  ON public.schedule_edits (associate_id, schedule_date);

-- 3. One audit function for all three operations.
CREATE OR REPLACE FUNCTION public.fn_audit_schedule_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_by  uuid := auth.uid();
  v_via text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_user::text);
  v_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action,
                                field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'insert',
            'shift', NULL,
            format('%s %s-%s (%s min)', NEW.schedule_date, NEW.start_time, NEW.end_time, NEW.scheduled_minutes),
            v_by, v_via);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action,
                                field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (OLD.id, OLD.associate_id, OLD.schedule_date, 'delete',
            'shift',
            format('%s %s-%s (%s min)', OLD.schedule_date, OLD.start_time, OLD.end_time, OLD.scheduled_minutes),
            NULL, v_by, v_via);
    RETURN OLD;
  END IF;

  -- UPDATE: one row per changed field.
  IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action, field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'update', 'start_time', OLD.start_time::text, NEW.start_time::text, v_by, v_via);
    v_changed := true;
  END IF;
  IF OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action, field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'update', 'end_time', OLD.end_time::text, NEW.end_time::text, v_by, v_via);
    v_changed := true;
  END IF;
  IF OLD.scheduled_minutes IS DISTINCT FROM NEW.scheduled_minutes THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action, field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'update', 'scheduled_minutes', OLD.scheduled_minutes::text, NEW.scheduled_minutes::text, v_by, v_via);
    v_changed := true;
  END IF;
  IF OLD.schedule_date IS DISTINCT FROM NEW.schedule_date THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action, field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'update', 'schedule_date', OLD.schedule_date::text, NEW.schedule_date::text, v_by, v_via);
    v_changed := true;
  END IF;
  IF OLD.associate_id IS DISTINCT FROM NEW.associate_id THEN
    INSERT INTO schedule_edits (schedule_id, associate_id, schedule_date, action, field_changed, old_value, new_value, edited_by, edited_via)
    VALUES (NEW.id, NEW.associate_id, NEW.schedule_date, 'update', 'associate_id', OLD.associate_id::text, NEW.associate_id::text, v_by, v_via);
    v_changed := true;
  END IF;

  -- Count only real changes (no-op re-saves from the week editor don't count).
  IF v_changed THEN
    NEW.modification_count := COALESCE(OLD.modification_count, 0) + 1;
  ELSE
    NEW.modification_count := COALESCE(OLD.modification_count, 0);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_schedule_edit() FROM PUBLIC, anon, authenticated;

-- 4. Triggers: BEFORE UPDATE (sets modification_count), AFTER INSERT / DELETE.
DROP TRIGGER IF EXISTS trg_audit_schedule_edit ON public.associate_schedules;
CREATE TRIGGER trg_audit_schedule_edit
  BEFORE UPDATE ON public.associate_schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_schedule_edit();

DROP TRIGGER IF EXISTS trg_audit_schedule_insert ON public.associate_schedules;
CREATE TRIGGER trg_audit_schedule_insert
  AFTER INSERT ON public.associate_schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_schedule_edit();

DROP TRIGGER IF EXISTS trg_audit_schedule_delete ON public.associate_schedules;
CREATE TRIGGER trg_audit_schedule_delete
  AFTER DELETE ON public.associate_schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_schedule_edit();

-- 5. The audit log is append-only for app users: the trigger (SECURITY DEFINER)
--    writes it; signed-in users can read but no longer write/alter/delete it.
DROP POLICY IF EXISTS schedule_edits_signed_in_write ON public.schedule_edits;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.schedule_edits FROM anon, authenticated;
