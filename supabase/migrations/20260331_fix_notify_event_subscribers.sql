-- Fix notify_event_subscribers: use missing_ok=true to avoid crashing when
-- app.settings.supabase_url / app.settings.service_role_key are not yet
-- configured as database-level GUC parameters.
--
-- Without this fix, every INSERT/UPDATE on time_entries threw:
--   "unrecognized configuration parameter 'app.settings.supabase_url'"
-- which surfaced in the UI as "Failed to clock in".
--
-- The correct values need to be set via ALTER DATABASE (requires supabase_admin):
--   ALTER DATABASE postgres SET "app.settings.supabase_url" TO 'https://aphrrfprbixmhissnjfn.supabase.co';
--   ALTER DATABASE postgres SET "app.settings.service_role_key" TO '<service_role_key>';
-- Until they are configured, the trigger silently no-ops instead of erroring.

CREATE OR REPLACE FUNCTION notify_event_subscribers()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payload jsonb;
  supa_url text;
  supa_key text;
BEGIN
  -- missing_ok=true returns NULL instead of raising an error when the GUC is not set
  supa_url := current_setting('app.settings.supabase_url', true);
  supa_key := current_setting('app.settings.service_role_key', true);

  -- Skip the HTTP call if settings are not yet configured in this environment
  IF supa_url IS NULL OR supa_url = '' OR supa_key IS NULL OR supa_key = '' THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'event', TG_TABLE_NAME || '.' || lower(TG_OP),
    'table', TG_TABLE_NAME,
    'operation', lower(TG_OP),
    'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    'fired_at', now()
  );

  PERFORM net.http_post(
    url := supa_url || '/functions/v1/event-notify',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || supa_key,
      'Content-Type', 'application/json'
    ),
    body := payload
  );

  RETURN NEW;
END;
$$;
