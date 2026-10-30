-- SECURITY: lock down vendor secrets and payment-table writes.
--
-- 2026-10-09: the live Stripe secret key (and PayPal, Telnyx, Spotify and
-- printer-proxy secrets) were readable by anyone holding the public anon key,
-- because these tables had USING (true) policies with no role restriction.
-- Anon could also INSERT/UPDATE/DELETE the config and payment tables.
-- Stripe flagged the key as exposed (support email 2026-10-08).
--
-- After this migration:
--   * secret columns are readable only by service_role (edge functions)
--   * credential tables: non-secret columns readable by anyone (pay page
--     needs publishable_key, contact page needs telnyx phone_number);
--     writes only by admins, and never to secret columns
--   * money tables: writes only by staff/admin; service-only tables have no
--     client access at all. Edge functions use service_role and bypass all of this.
--
-- Secrets are now set via SQL (Management API), not the admin settings page.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Credential tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec jsonb := '{
    "stripe_config":  ["secret_key","sandbox_secret_key","webhook_secret","sandbox_webhook_secret"],
    "paypal_config":  ["client_secret","sandbox_client_secret","webhook_id","sandbox_webhook_id"],
    "telnyx_config":  ["api_key"],
    "printer_config": ["proxy_secret"],
    "spotify_config": ["client_secret","refresh_token","access_token"]
  }';
  t text;
  pol record;
  safe_cols text;
BEGIN
  FOR t IN SELECT jsonb_object_keys(spec) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                   t || '_read_nonsecret', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user())',
                   t || '_admin_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin_user())',
                   t || '_admin_insert', t);

    SELECT string_agg(quote_ident(column_name), ', ')
      INTO safe_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t
       AND NOT (column_name IN (SELECT jsonb_array_elements_text(spec -> t)));

    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', safe_cols, t);
    EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.%I TO authenticated', safe_cols, safe_cols, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Money tables that the browser writes (admin/staff pages): keep public
--    reads as they are for now, restrict writes to staff/admin.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all payment_methods" ON public.payment_methods;
CREATE POLICY payment_methods_admin_write ON public.payment_methods
  FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS payouts_insert ON public.payouts;
DROP POLICY IF EXISTS payouts_update ON public.payouts;
CREATE POLICY payouts_staff_write ON public.payouts
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());

DROP POLICY IF EXISTS "Allow all rental_payments" ON public.rental_payments;
CREATE POLICY rental_payments_staff_write ON public.rental_payments
  FOR ALL TO authenticated USING (public.is_staff_or_admin_user()) WITH CHECK (public.is_staff_or_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.payment_methods, public.payouts, public.rental_payments FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Server-only payment tables (written by edge functions with service_role).
--    Their "Service role full access" policies had no TO clause, so they
--    applied to everyone. Replace with staff read-only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['pending_payments','payment_processing_log','payment_sender_mappings','deposit_payment_confirmations'] LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff_or_admin_user())',
                   t || '_staff_read', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
  END LOOP;
END $$;

COMMIT;
