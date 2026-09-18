-- Align sonos_schedules CHECK constraints with app behavior.
--
-- 1. recurrence: add 'every_other_day' (alternating-day automations —
--    one_time_date doubles as the anchor date; see sonos-control's
--    run-schedules handler).
-- 2. source_type: add 'url', which devices/sonos.js already writes for
--    Spotify/YouTube URI-based schedules (source_provider in
--    ('spotify','youtube')) but the DB constraint was rejecting.

ALTER TABLE sonos_schedules
  DROP CONSTRAINT IF EXISTS sonos_schedules_recurrence_check,
  ADD CONSTRAINT sonos_schedules_recurrence_check
    CHECK (recurrence = ANY (ARRAY['once', 'daily', 'weekdays', 'weekends', 'custom', 'every_other_day']));

ALTER TABLE sonos_schedules
  DROP CONSTRAINT IF EXISTS sonos_schedules_source_type_check,
  ADD CONSTRAINT sonos_schedules_source_type_check
    CHECK (source_type = ANY (ARRAY['playlist', 'favorite', 'url']));
