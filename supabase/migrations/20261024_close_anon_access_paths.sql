-- Close anonymous access paths confirmed live on 2026-10-24.
--
-- 1. Anonymous writes: spgd_* (feeds image generation every 2 minutes), devices,
--    rate_limit_attempts, api_usage_log, push_tokens, spirited/spirit_*,
--    context_snapshots, laundry_watchers, photos/photo_requests/photo_spaces.
-- 2. Anonymous PII reads: user_invitations, event_rsvps, bug_reports,
--    pai_interactions, service_connections, associate_schedules, schedule_edits,
--    vehicle_drivers, and the money/notes columns of assignments.
-- Square settlement is in 20261024_square_server_settlement.sql (apply after
-- process-square-payment is deployed).
--
-- Writers that remain are service-role workers and edge functions (lg-poller,
-- image-gen, spirit-whisper-worker, lg-control, alpaca-pai), which bypass RLS.
-- Regression test: supabase/tests/anon-access-paths-2026-10-24.sql

BEGIN;

-- =============================================
-- 1. Anonymous writes
-- =============================================

-- spgd_*: public read kept (Sponic brand pages display it); writes service-role only.
DROP POLICY IF EXISTS "Anon update spgd" ON public.spgd_brand_reviews;
DROP POLICY IF EXISTS "Anon write spgd" ON public.spgd_brand_reviews;
DROP POLICY IF EXISTS "Anon update spgd_brand_assets" ON public.spgd_brand_assets;
DROP POLICY IF EXISTS "Anon write spgd_brand_assets" ON public.spgd_brand_assets;
DROP POLICY IF EXISTS "Anon update spgd_brand_rules" ON public.spgd_brand_rules;
DROP POLICY IF EXISTS "Anon write spgd_brand_rules" ON public.spgd_brand_rules;
DROP POLICY IF EXISTS "Anon update spgd_brand_variants" ON public.spgd_brand_variants;
DROP POLICY IF EXISTS "Anon write spgd_brand_variants" ON public.spgd_brand_variants;
DROP POLICY IF EXISTS "Anon update spgd_render_tokens" ON public.spgd_render_tokens;
DROP POLICY IF EXISTS "Anon write spgd_render_tokens" ON public.spgd_render_tokens;
DROP POLICY IF EXISTS "Anon update spgd_style_tokens" ON public.spgd_style_tokens;
DROP POLICY IF EXISTS "Anon write spgd_style_tokens" ON public.spgd_style_tokens;
DROP POLICY IF EXISTS "Anon update spgd_subject_tokens" ON public.spgd_subject_tokens;
DROP POLICY IF EXISTS "Anon write spgd_subject_tokens" ON public.spgd_subject_tokens;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.spgd_brand_assets, public.spgd_brand_reviews, public.spgd_brand_rules,
  public.spgd_brand_variants, public.spgd_render_tokens, public.spgd_style_tokens,
  public.spgd_subject_tokens
  FROM anon, authenticated;

-- The regen bridge runs from cron as postgres. Cap it at 20 jobs per day.
CREATE OR REPLACE FUNCTION public.queue_spgd_regen_jobs()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
  new_job_id UUID;
  remaining int;
BEGIN
  SELECT 20 - count(*) INTO remaining FROM image_gen_jobs
   WHERE metadata->>'purpose' = 'spgd_brand_regen' AND created_at > now() - interval '1 day';
  IF remaining <= 0 THEN RETURN; END IF;

  FOR rec IN SELECT * FROM spgd_brand_reviews
    WHERE status = 'regen-requested' AND (metadata IS NULL OR (metadata->>'job_queued') IS NULL)
    ORDER BY reviewed_at ASC LIMIT LEAST(5, remaining)
  LOOP
    INSERT INTO image_gen_jobs (prompt, job_type, status, priority, max_attempts, metadata, batch_id, batch_label)
    VALUES (
      COALESCE(rec.comment, 'Generate a brand asset variation') || E'\n\nStyle: Modern corporate botanical-digital aesthetic for Sponic Garden brand. Clean white background for logos/wordmarks. Category: ' || COALESCE(rec.asset_category, 'general'),
      CASE WHEN rec.asset_url IS NOT NULL THEN 'edit' ELSE 'generate' END,
      'pending', 20, 3,
      jsonb_build_object('purpose', 'spgd_brand_regen', 'source_asset_id', rec.asset_id, 'source_category', rec.asset_category,
                         'source_url', rec.asset_url, 'regen_prompt', rec.comment, 'source_image_url', rec.asset_url),
      'spgd-regen-' || to_char(now(), 'YYYY-MM-DD'), 'Sponic Garden Brand Regeneration')
    RETURNING id INTO new_job_id;
    UPDATE spgd_brand_reviews
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('job_queued', true, 'job_id', new_job_id::text, 'queued_at', now()::text)
     WHERE asset_id = rec.asset_id;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.queue_spgd_regen_jobs() FROM PUBLIC, anon, authenticated;

-- Same spend path: force_run=true queued image jobs for every resident, anonymously.
REVOKE EXECUTE ON FUNCTION public.queue_daily_pai_imagery(boolean) FROM PUBLIC, anon, authenticated;

-- devices: IP/MAC inventory. No browser reader; staff only.
DROP POLICY IF EXISTS devices_admin_write ON public.devices;
DROP POLICY IF EXISTS devices_read_all ON public.devices;
REVOKE ALL ON public.devices FROM anon;
CREATE POLICY devices_staff_all ON public.devices FOR ALL TO authenticated
  USING (is_staff_or_admin_user()) WITH CHECK (is_staff_or_admin_user());

-- rate_limit_attempts: written only through check_rate_limit().
DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_attempts;
REVOKE ALL ON public.rate_limit_attempts FROM anon, authenticated;
ALTER FUNCTION public.check_rate_limit(text, text, integer, integer)
  SECURITY DEFINER SET search_path = public, pg_temp;

-- api_usage_log: edge functions write it. edit-email-template inserts as the signed-in admin.
DROP POLICY IF EXISTS api_usage_log_insert ON public.api_usage_log;
DROP POLICY IF EXISTS api_usage_log_select ON public.api_usage_log;
REVOKE ALL ON public.api_usage_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.api_usage_log FROM authenticated;
CREATE POLICY api_usage_log_signed_in_insert ON public.api_usage_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY api_usage_log_staff_read ON public.api_usage_log FOR SELECT TO authenticated
  USING (is_staff_or_admin_user());

-- push_tokens: lg-control and lg-poller (service role) only.
DROP POLICY IF EXISTS push_tokens_delete ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_insert ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_select ON public.push_tokens;
DROP POLICY IF EXISTS push_tokens_update ON public.push_tokens;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;

-- House spirit: spirit-whisper-worker (service role) plus the staff admin page.
DROP POLICY IF EXISTS admin_spirited_config ON public.spirited_house_config;
DROP POLICY IF EXISTS admin_spirit_emergences ON public.spirit_emergences;
DROP POLICY IF EXISTS admin_spirit_phrases ON public.spirit_phrases;
DROP POLICY IF EXISTS spirit_config_write ON public.spirit_whisper_config;
DROP POLICY IF EXISTS spirit_log_write ON public.spirit_whisper_log;
REVOKE ALL ON public.spirited_house_config, public.spirit_emergences, public.spirit_phrases,
  public.spirit_whisper_config, public.spirit_whisper_log, public.spirit_whispers FROM anon;
CREATE POLICY spirited_config_staff ON public.spirited_house_config FOR ALL TO authenticated
  USING (is_staff_or_admin_user()) WITH CHECK (is_staff_or_admin_user());
CREATE POLICY spirit_emergences_staff ON public.spirit_emergences FOR ALL TO authenticated
  USING (is_staff_or_admin_user()) WITH CHECK (is_staff_or_admin_user());
CREATE POLICY spirit_phrases_staff ON public.spirit_phrases FOR ALL TO authenticated
  USING (is_staff_or_admin_user()) WITH CHECK (is_staff_or_admin_user());
CREATE POLICY spirit_config_staff_write ON public.spirit_whisper_config FOR ALL TO authenticated
  USING (is_staff_or_admin_user()) WITH CHECK (is_staff_or_admin_user());
CREATE POLICY spirit_log_staff_write ON public.spirit_whisper_log FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin_user());

-- context_snapshots: devcontrol (signed-in admin page) only.
DROP POLICY IF EXISTS "Allow anon insert" ON public.context_snapshots;
DROP POLICY IF EXISTS "Allow anon insert context_snapshots" ON public.context_snapshots;
DROP POLICY IF EXISTS "Allow anon read" ON public.context_snapshots;
DROP POLICY IF EXISTS "Allow anon read context_snapshots" ON public.context_snapshots;
DROP POLICY IF EXISTS "Allow anon update" ON public.context_snapshots;
DROP POLICY IF EXISTS "Allow anon update context_snapshots" ON public.context_snapshots;
REVOKE ALL ON public.context_snapshots FROM anon;

-- laundry_watchers: lg-control/lg-poller write; signed-in users read their own.
DROP POLICY IF EXISTS laundry_watchers_delete ON public.laundry_watchers;
DROP POLICY IF EXISTS laundry_watchers_insert ON public.laundry_watchers;
DROP POLICY IF EXISTS laundry_watchers_select ON public.laundry_watchers;
REVOKE ALL ON public.laundry_watchers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.laundry_watchers FROM authenticated;
CREATE POLICY laundry_watchers_own_read ON public.laundry_watchers FOR SELECT TO authenticated
  USING (app_user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid()) OR is_staff_or_admin_user());

-- Legacy photo tables: public read kept, inserts staff only.
DROP POLICY IF EXISTS "Allow public inserts" ON public.photos;
DROP POLICY IF EXISTS "Public insert access" ON public.photo_requests;
DROP POLICY IF EXISTS "Allow public inserts" ON public.photo_spaces;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.photos, public.photo_requests, public.photo_spaces FROM anon;
CREATE POLICY photos_staff_insert ON public.photos FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin_user());
CREATE POLICY photo_requests_staff_insert ON public.photo_requests FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin_user());
CREATE POLICY photo_spaces_staff_insert ON public.photo_spaces FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin_user());

-- =============================================
-- 2. Anonymous PII reads
-- =============================================

-- user_invitations: sign-in reads the caller's own pending invitation; admins see all.
DROP POLICY IF EXISTS temp_read_invitations ON public.user_invitations;
DROP POLICY IF EXISTS "Read invitations" ON public.user_invitations;
REVOKE ALL ON public.user_invitations FROM anon;
CREATE POLICY user_invitations_own_or_admin_read ON public.user_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.email()) OR is_admin_user());

-- event_rsvps: anonymous RSVP insert kept (ninja). Staff read via event_rsvps_staff_select.
DROP POLICY IF EXISTS "Admins can read RSVPs" ON public.event_rsvps;
REVOKE ALL ON public.event_rsvps FROM anon;
GRANT INSERT ON public.event_rsvps TO anon;

-- bug_reports: anonymous insert kept (bug reporter extensions use return=minimal).
DROP POLICY IF EXISTS anon_select_bug_reports ON public.bug_reports;
REVOKE ALL ON public.bug_reports FROM anon;
GRANT INSERT ON public.bug_reports TO anon;
CREATE POLICY bug_reports_staff_read ON public.bug_reports FOR SELECT TO authenticated
  USING (is_staff_or_admin_user());

-- pai_interactions: staff read. Kiosk/TV get only a 24h count.
DROP POLICY IF EXISTS "Public read pai_interactions" ON public.pai_interactions;
REVOKE ALL ON public.pai_interactions FROM anon;
CREATE POLICY pai_interactions_staff_read ON public.pai_interactions FOR SELECT TO authenticated
  USING (is_staff_or_admin_user());

CREATE OR REPLACE FUNCTION public.kiosk_pai_count_24h()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM pai_interactions WHERE created_at >= now() - interval '24 hours';
$$;
REVOKE EXECUTE ON FUNCTION public.kiosk_pai_count_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_pai_count_24h() TO anon, authenticated, service_role;

-- service_connections: infra hosts, ports and vault item names. Signed-in only.
DROP POLICY IF EXISTS sc_read_anon ON public.service_connections;
REVOKE ALL ON public.service_connections FROM anon;

-- Work schedules: signed-in only (associate/staff hours pages).
REVOKE ALL ON public.associate_schedules, public.schedule_edits FROM anon;
ALTER POLICY associate_schedules_read ON public.associate_schedules TO authenticated;
ALTER POLICY schedule_edits_read ON public.schedule_edits TO authenticated;

-- vehicle_drivers: signed-in only.
REVOKE ALL ON public.vehicle_drivers FROM anon;
ALTER POLICY "Residents can view vehicle drivers" ON public.vehicle_drivers TO authenticated;

-- assignments: anonymous availability pages need dates and status only.
REVOKE ALL ON public.assignments FROM anon;
GRANT SELECT (id, person_id, type, status, start_date, end_date,
              desired_departure_date, desired_departure_listed, created_at)
  ON public.assignments TO anon;

-- Leftover anon grants (RLS already denied them; 10-09 audit follow-up).
REVOKE ALL ON public.previous_residences, public.square_payments FROM anon;

COMMIT;
