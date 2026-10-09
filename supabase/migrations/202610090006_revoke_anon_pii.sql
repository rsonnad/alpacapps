-- SECURITY batch 3b: remove anonymous access to applicant / event-client PII.
--
-- Apply only after the public pages use the RPCs from 202610090005
-- (apply, status, hostevent, book, waiver, event agreement, contact, hall kiosk/TV).
-- Signed-in users keep their current access: every policy that applied to
-- PUBLIC or anon is re-targeted to authenticated; anon-only policies are dropped.
-- Tightening signed-in (resident/associate) access is a separate, later step.

BEGIN;

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['people','rental_applications','event_hosting_requests',
                           'event_request_spaces','waiver_signatures','rental_payments'] LOOP
    FOR pol IN
      SELECT policyname, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      IF pol.roles = ARRAY['anon']::name[] THEN
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
      ELSIF 'public' = ANY(pol.roles) OR 'anon' = ANY(pol.roles) THEN
        EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', pol.policyname, t);
      END IF;
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

COMMIT;
