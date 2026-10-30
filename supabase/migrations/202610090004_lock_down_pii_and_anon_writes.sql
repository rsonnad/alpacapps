-- SECURITY batch 2: identity documents, payouts, signed leases, anonymous writes.
--
-- 2026-10-09 audit follow-up (see devcontrol/devdocs/security/2026-10-09-credential-access-audit.md).
-- Scope: tables with no anonymous public-page callers, plus the lease-documents
-- storage bucket. Public flows (rental apply/status, host-event, waiver, people)
-- are deliberately untouched here: they need token-scoped RPCs first.
--
-- Edge functions use service_role and bypass RLS; nothing here affects them.

BEGIN;

-- Helper: drop every existing policy on a table.
CREATE OR REPLACE FUNCTION pg_temp.drop_policies(t text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- identity_verifications: driver's licence data + 1-year signed photo URLs.
-- Was: anon SELECT true, authenticated ALL true.
-- Now: staff read/write; a user may read their own row (residents/profile.js).
-- ---------------------------------------------------------------------------
SELECT pg_temp.drop_policies('identity_verifications');
CREATE POLICY identity_verifications_staff_all ON public.identity_verifications
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());
CREATE POLICY identity_verifications_own_read ON public.identity_verifications
  FOR SELECT TO authenticated
  USING (app_user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));
REVOKE ALL ON public.identity_verifications FROM anon;

-- ---------------------------------------------------------------------------
-- Staff-only tables (no anon or resident browser callers).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payouts','payment_reminders','vehicle_rentals','event_payments',
                           'signature_audit_log','payout_time_entries'] LOOP
    PERFORM pg_temp.drop_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user())',
                   t || '_staff_all', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Public read stays (public pages / kiosk use it); writes become staff-only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lease_templates','event_agreement_templates','printer_devices','assignments'] LOOP
    PERFORM pg_temp.drop_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user())',
                   t || '_staff_write', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Logged-in-only writes (associates, devcontrol, Jackie's permitting pages).
-- Keeps today's behaviour for signed-in users; removes anonymous writes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['todo_items','todo_categories','work_groups','work_group_members',
                           'associate_schedules','permit_tasks','schedule_edits'] LOOP
    PERFORM pg_temp.drop_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
                   t || '_signed_in_write', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS anon_update ON public.govee_devices;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.govee_devices FROM anon;

-- Waiver: anonymous signing (INSERT + read-back) stays; anonymous edits go.
DROP POLICY IF EXISTS waiver_signatures_update ON public.waiver_signatures;
REVOKE UPDATE, DELETE, TRUNCATE ON public.waiver_signatures FROM anon;

-- ---------------------------------------------------------------------------
-- Tables with RLS disabled. Writers use service_role / postgres.
-- ---------------------------------------------------------------------------
ALTER TABLE public.system_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sonos_health_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_commands_staff_read ON public.system_commands
  FOR SELECT TO authenticated USING (public.is_staff_or_admin_user());
REVOKE ALL ON public.system_commands, public.sonos_health_samples FROM anon;

-- ---------------------------------------------------------------------------
-- Storage: lease-documents (signed leases, signature images).
-- Bucket stays public so existing links (lease.html, rentals/signed) still
-- resolve by exact path; this removes anonymous listing, overwrite and delete.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow lease docs reads"   ON storage.objects;
DROP POLICY IF EXISTS "Allow lease docs uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow lease docs updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow lease docs deletes" ON storage.objects;
CREATE POLICY lease_docs_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lease-documents' AND public.is_staff_or_admin_user());
CREATE POLICY lease_docs_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lease-documents' AND public.is_staff_or_admin_user());
CREATE POLICY lease_docs_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lease-documents' AND public.is_staff_or_admin_user())
  WITH CHECK (bucket_id = 'lease-documents' AND public.is_staff_or_admin_user());
CREATE POLICY lease_docs_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lease-documents' AND public.is_staff_or_admin_user());

COMMIT;
