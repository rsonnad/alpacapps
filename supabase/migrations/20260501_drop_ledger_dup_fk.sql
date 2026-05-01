-- 20260501_drop_ledger_dup_fk.sql
-- ledger had TWO FK constraints on (person_id) → people(id), both naming the same
-- relationship. PostgREST returned PGRST201 ("more than one relationship was found
-- for 'ledger' and 'person_id'") on every embed query like
--   SELECT *, person:person_id(...) FROM ledger
-- which broke /admin/accounting.html.
--
-- Keep `fk_ledger_person` (the explicitly named one with ON DELETE SET NULL — matches
-- existing rental_applications/event_payments patterns) and drop the auto-generated
-- duplicate `ledger_person_id_fkey`.

ALTER TABLE ledger
  DROP CONSTRAINT IF EXISTS ledger_person_id_fkey;
