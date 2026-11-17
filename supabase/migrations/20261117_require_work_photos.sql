-- Require before + after work photos for flagged associates (Justin, Ike, Amber).
--
-- 1. associate_profiles.photos_required — per-associate switch.
-- 2. clock_out_server_time() refuses to close a session for a flagged
--    associate unless the entry has both a 'before' and an 'after' photo.
--    (Admin edits / auto-close use direct UPDATEs and are unaffected.)
-- 3. work-photo-reminder-scan cron — the 2026-03-18 migration never made it
--    into cron.job, so the backup reminder scan was not running at all.

ALTER TABLE associate_profiles
  ADD COLUMN IF NOT EXISTS photos_required boolean NOT NULL DEFAULT false;

UPDATE associate_profiles SET photos_required = true
WHERE id IN (
  '04b48bfc-07d8-4628-90ba-655120e07eaf', -- Justin Gilbertson
  '0b49ce07-bcc0-4db6-99ca-ddaef3009475', -- Ike Tosh
  '08cc82c4-5503-4634-b983-51de4cd40d8b'  -- Amber Coleman
);

CREATE OR REPLACE FUNCTION public.clock_out_server_time(
  p_entry_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS SETOF time_entries
LANGUAGE plpgsql
AS $function$
DECLARE
  v_ci TIMESTAMPTZ;
  v_assoc UUID;
  v_required BOOLEAN;
  v_has_before BOOLEAN;
  v_has_after BOOLEAN;
BEGIN
  SELECT clock_in, associate_id INTO v_ci, v_assoc FROM time_entries WHERE id = p_entry_id;
  IF v_ci IS NULL THEN
    RAISE EXCEPTION 'time_entry % not found', p_entry_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT photos_required INTO v_required FROM associate_profiles WHERE id = v_assoc;
  IF COALESCE(v_required, false) THEN
    SELECT EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = p_entry_id AND photo_type = 'before'),
           EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = p_entry_id AND photo_type = 'after')
      INTO v_has_before, v_has_after;
    IF NOT v_has_before OR NOT v_has_after THEN
      RAISE EXCEPTION 'photos_required: upload % photo(s) before clocking out',
        CASE WHEN NOT v_has_before AND NOT v_has_after THEN 'before and after'
             WHEN NOT v_has_before THEN 'a before' ELSE 'an after' END
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
    UPDATE time_entries
    SET clock_out = now(),
        duration_minutes = GREATEST(0, EXTRACT(EPOCH FROM (now() - v_ci))::INT / 60),
        clock_out_lat = p_lat,
        clock_out_lng = p_lng,
        description = COALESCE(p_description, description),
        updated_at = now()
    WHERE id = p_entry_id
    RETURNING *;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.clock_out_server_time(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'work-photo-reminder-scan') THEN
    PERFORM cron.schedule(
      'work-photo-reminder-scan',
      '*/15 * * * *',
      $cron$select public.payroll_cron_post('work-photo-reminder-scan', 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/work-photo-reminder')$cron$
    );
  END IF;
END $$;
