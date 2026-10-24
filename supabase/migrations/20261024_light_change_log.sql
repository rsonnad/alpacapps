-- Durable log of every light command that passes through Home Assistant.
--
-- Written by the HAOS automation "Log light commands to Supabase", which fires
-- on every call_service event in the light domain (Alexa, Google, the Light API,
-- lights.sh/ha-cmd.sh, HA automations, the HA app) and posts it here with the
-- calling HA user. HAOS's own recorder keeps the same events for ~10 days only.
--
-- Background (2026-10-24): lights in the kitchen and elsewhere were turning red
-- with no visible cause. The recorder showed Alexa (HA Cloud user) sending
-- SetColor red to ~187 lights at once. This table keeps that evidence long term.
--
-- Writers: service role only (HAOS rest_command). Readers: admin/staff.

BEGIN;

CREATE TABLE IF NOT EXISTS public.light_change_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fired_at    timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,              -- alexa_or_google | alpaca_admin_api | ha_automation | ha_internal | ha_user
  ha_user_id  text,                       -- HA context.user_id of the caller
  service     text NOT NULL,              -- turn_on | turn_off | toggle
  entity_ids  text[] NOT NULL DEFAULT '{}',
  service_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_id  text,
  parent_id   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS light_change_log_fired_at_idx ON public.light_change_log (fired_at DESC);
CREATE INDEX IF NOT EXISTS light_change_log_entity_ids_idx ON public.light_change_log USING gin (entity_ids);

ALTER TABLE public.light_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.light_change_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.light_change_log FROM authenticated;
GRANT SELECT ON public.light_change_log TO authenticated;

DROP POLICY IF EXISTS "light_change_log_select_staff" ON public.light_change_log;
CREATE POLICY "light_change_log_select_staff"
  ON public.light_change_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'staff')
    )
  );

-- Keep one year. Alexa fans one voice command out to ~187 rows, so this table
-- grows by a few thousand rows a day.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('purge-light-change-log')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-light-change-log');
SELECT cron.schedule(
  'purge-light-change-log',
  '17 9 * * *',
  $$DELETE FROM public.light_change_log WHERE fired_at < now() - interval '365 days'$$
);

COMMIT;
