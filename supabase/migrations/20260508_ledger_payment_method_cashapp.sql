-- Add 'cashapp' to ledger.payment_method allowed values.
-- Applied live via Management API on 2026-05-08; this file backfills
-- the migration history for reproducibility.
ALTER TABLE ledger DROP CONSTRAINT ledger_payment_method_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'square'::text,
    'venmo'::text,
    'zelle'::text,
    'paypal'::text,
    'bank_ach'::text,
    'cash'::text,
    'check'::text,
    'stripe'::text,
    'coinbase'::text,
    'cashapp'::text,
    'other'::text
  ]));
