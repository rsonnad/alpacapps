-- Let photo-required associates opt out per session with "Photos Not Relevant"
-- (after confirming no image would help explain the work).

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS photos_not_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photos_not_relevant_at timestamptz;

DROP FUNCTION IF EXISTS public.clock_out_server_time(UUID, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.clock_out_server_time(
  p_entry_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_photos_not_relevant boolean DEFAULT false
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
  IF COALESCE(v_required, false) AND NOT COALESCE(p_photos_not_relevant, false) THEN
    SELECT EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = p_entry_id AND photo_type = 'before'),
           EXISTS (SELECT 1 FROM work_photos WHERE time_entry_id = p_entry_id AND photo_type = 'after')
      INTO v_has_before, v_has_after;
    IF NOT v_has_before OR NOT v_has_after THEN
      RAISE EXCEPTION 'photos_required: upload % photo(s) before clocking out, or choose "Photos Not Relevant"',
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
        photos_not_relevant = COALESCE(p_photos_not_relevant, false),
        photos_not_relevant_at = CASE WHEN p_photos_not_relevant THEN now() END,
        updated_at = now()
    WHERE id = p_entry_id
    RETURNING *;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.clock_out_server_time(UUID, NUMERIC, NUMERIC, TEXT, BOOLEAN) TO authenticated;
