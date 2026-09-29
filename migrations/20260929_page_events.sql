-- Landing telemetry for /rentals/apply/ (and any page added to the allowlist later).
-- Feeds the daily apply-page-digest email.
--
-- No RLS policies: only the service role reads it. Browsers write through
-- track_page_event(), which validates and caps every value, so anon never gets
-- direct table access. No PII: a per-tab random session id, the referrer host
-- (not the full URL), and UTM tags.

CREATE TABLE IF NOT EXISTS public.page_events (
  id bigserial PRIMARY KEY,
  page text NOT NULL,
  event text NOT NULL,
  step smallint,
  session_id text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_events_page_created_idx ON public.page_events (page, created_at);

ALTER TABLE public.page_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.page_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_page_event(
  p_page text,
  p_event text,
  p_step smallint DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_is_staff boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ref_host text;
BEGIN
  IF p_page NOT IN ('rentals/apply') THEN
    RAISE EXCEPTION 'unknown page';
  END IF;
  IF p_event NOT IN ('view', 'form_started') THEN
    RAISE EXCEPTION 'unknown event';
  END IF;
  IF p_step IS NOT NULL AND p_step NOT IN (1, 2) THEN
    RAISE EXCEPTION 'bad step';
  END IF;

  -- Host only: full referrer URLs can carry tokens or emails in the query string
  ref_host := lower(substring(p_referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'));

  INSERT INTO page_events (page, event, step, session_id, referrer_host, utm_source, utm_medium, utm_campaign, is_staff)
  VALUES (
    p_page, p_event, p_step,
    left(p_session_id, 64),
    left(ref_host, 253),
    left(p_utm_source, 100),
    left(p_utm_medium, 100),
    left(p_utm_campaign, 100),
    coalesce(p_is_staff, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_page_event(text, text, smallint, text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_page_event(text, text, smallint, text, text, text, text, text, boolean) TO anon, authenticated;

-- Daily rollup for the digest, in Chicago days. Service role only.
CREATE OR REPLACE FUNCTION public.apply_page_daily_metrics(p_days int DEFAULT 7)
RETURNS TABLE (
  day date,
  views bigint,
  visitors bigint,
  form_started bigint,
  step2_views bigint,
  inquiries bigint,
  applications bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH days AS (
    SELECT generate_series(
      (now() AT TIME ZONE 'America/Chicago')::date - p_days,
      (now() AT TIME ZONE 'America/Chicago')::date - 1,
      interval '1 day'
    )::date AS day
  ),
  ev AS (
    SELECT (created_at AT TIME ZONE 'America/Chicago')::date AS day, event, step, session_id
    FROM page_events
    WHERE page = 'rentals/apply' AND NOT is_staff
      AND created_at >= ((now() AT TIME ZONE 'America/Chicago')::date - p_days) AT TIME ZONE 'America/Chicago'
  ),
  apps AS (
    SELECT (created_at AT TIME ZONE 'America/Chicago')::date AS day,
           count(*) AS inquiries
    FROM rental_applications
    WHERE NOT coalesce(is_test, false)
      AND created_at >= ((now() AT TIME ZONE 'America/Chicago')::date - p_days) AT TIME ZONE 'America/Chicago'
    GROUP BY 1
  ),
  subs AS (
    SELECT (submitted_at AT TIME ZONE 'America/Chicago')::date AS day,
           count(*) AS applications
    FROM rental_applications
    WHERE NOT coalesce(is_test, false) AND submitted_at IS NOT NULL
      AND submitted_at >= ((now() AT TIME ZONE 'America/Chicago')::date - p_days) AT TIME ZONE 'America/Chicago'
    GROUP BY 1
  )
  SELECT d.day,
    count(*) FILTER (WHERE ev.event = 'view' AND ev.step = 1),
    count(DISTINCT ev.session_id) FILTER (WHERE ev.event = 'view' AND ev.step = 1),
    count(DISTINCT ev.session_id) FILTER (WHERE ev.event = 'form_started' AND ev.step = 1),
    count(*) FILTER (WHERE ev.event = 'view' AND ev.step = 2),
    coalesce(max(apps.inquiries), 0),
    coalesce(max(subs.applications), 0)
  FROM days d
  LEFT JOIN ev ON ev.day = d.day
  LEFT JOIN apps ON apps.day = d.day
  LEFT JOIN subs ON subs.day = d.day
  GROUP BY d.day
  ORDER BY d.day DESC;
$$;

REVOKE ALL ON FUNCTION public.apply_page_daily_metrics(int) FROM PUBLIC, anon, authenticated;

-- Yesterday's top referrer hosts for the digest. Service role only.
CREATE OR REPLACE FUNCTION public.apply_page_top_referrers(p_limit int DEFAULT 8)
RETURNS TABLE (referrer text, visitors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(nullif(utm_source, ''), referrer_host, '(direct)') AS referrer,
         count(DISTINCT session_id)
  FROM page_events
  WHERE page = 'rentals/apply' AND event = 'view' AND step = 1 AND NOT is_staff
    AND (created_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date - 1
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.apply_page_top_referrers(int) FROM PUBLIC, anon, authenticated;

-- Daily 8 AM CT (13:00 UTC during CDT) — same slot and auth pattern as pending-approvals-digest-daily.
select cron.schedule('apply-page-digest-daily', '0 13 * * *', $cron$SELECT net.http_post(url := 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/apply-page-digest', headers := jsonb_build_object('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk', 'Content-Type', 'application/json'), body := '{}'::jsonb);$cron$);
