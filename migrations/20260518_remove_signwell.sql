-- Remove SignWell: native in-house e-signature flow is now the only path.
--
-- KEEPS the `signwell_document_id` columns on rental_applications,
-- event_hosting_requests, assignments, vehicle_rentals, and
-- waiver_signatures — they're historical references to docs already in
-- our lease-documents bucket. Dropping them risks losing the link to
-- pre-native signed documents.
--
-- DROPS:
--   - signwell_config (API key storage — no more API calls)
--   - signwell_processed_events (webhook dedupe — webhook is gone)
--
-- Down:
--   To restore, re-run migrations/015_native_esignature.sql
--   (which still re-creates signature_audit_log alongside SignWell tables).

DROP TABLE IF EXISTS signwell_config;
DROP TABLE IF EXISTS signwell_processed_events;
