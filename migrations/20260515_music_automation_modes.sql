-- Rich music automations for Music Assistant / Sonos scheduler.
-- Keeps the original sonos_schedules contract intact while adding
-- provider, URI, shuffle, and repeat controls.

ALTER TABLE sonos_schedules
  ADD COLUMN IF NOT EXISTS source_provider text NOT NULL DEFAULT 'music_assistant',
  ADD COLUMN IF NOT EXISTS source_uri text,
  ADD COLUMN IF NOT EXISTS shuffle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repeat_mode text NOT NULL DEFAULT 'none';

ALTER TABLE sonos_schedules
  DROP CONSTRAINT IF EXISTS sonos_schedules_source_provider_check,
  ADD CONSTRAINT sonos_schedules_source_provider_check
    CHECK (source_provider IN ('music_assistant', 'sonos', 'spotify', 'youtube', 'link'));

ALTER TABLE sonos_schedules
  DROP CONSTRAINT IF EXISTS sonos_schedules_repeat_mode_check,
  ADD CONSTRAINT sonos_schedules_repeat_mode_check
    CHECK (repeat_mode IN ('none', 'all', 'one'));

CREATE INDEX IF NOT EXISTS idx_sonos_schedules_source_provider
  ON sonos_schedules(source_provider);
