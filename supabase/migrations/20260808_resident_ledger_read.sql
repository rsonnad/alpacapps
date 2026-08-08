-- Residents need their own non-voided ledger history for the bookkeeping page.
-- This does not grant writes or cross-resident access.
DROP POLICY IF EXISTS ledger_resident_read ON public.ledger;

CREATE POLICY ledger_resident_read ON public.ledger
  FOR SELECT TO authenticated
  USING (
    person_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.app_users
      WHERE app_users.auth_user_id = auth.uid()
        AND app_users.role = 'resident'
        AND app_users.person_id = ledger.person_id
    )
  );
