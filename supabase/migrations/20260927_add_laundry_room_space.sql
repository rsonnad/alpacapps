-- Add "Laundry Room" as a non-dwelling space so it can be picked as a
-- task location (staff/projects.js -> ProjectService.getSpaces(), which
-- lists every non-archived row in `spaces`).
--
-- Placement: parented to Main House, alongside Kitchen / Dining Room /
-- Living Room. Change parent_id in Spaces admin if the washer/dryer lives
-- elsewhere (e.g. Garage Mahal).
--
-- Flags: can_be_dwelling=false (never rentable), can_be_event=false,
-- is_listed=false (task/ops location only, not shown in consumer listings).
--
-- Idempotent: un-archives an existing "Laundry Room" row instead of
-- inserting a duplicate.

UPDATE public.spaces
   SET is_archived = false,
       can_be_dwelling = false
 WHERE lower(name) = 'laundry room'
   AND is_archived = true;

INSERT INTO public.spaces (name, parent_id, can_be_dwelling, can_be_event, is_listed, is_secret)
SELECT 'Laundry Room', mh.id, false, false, false, false
  FROM public.spaces mh
 WHERE mh.name = 'Main House'
   AND NOT EXISTS (SELECT 1 FROM public.spaces WHERE lower(name) = 'laundry room')
 LIMIT 1;
