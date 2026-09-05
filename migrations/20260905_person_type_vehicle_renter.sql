-- Migration: Add vehicle_renter to person_type enum
-- Date: 2026-09-05
-- Description: People who rent a vehicle but are not residency tenants need their
--              own category. Previously such renters were miscategorized as
--              'prospect' (e.g. Juston Brommel), which conflates them with
--              residency applicants in people-list views and reports.
--
-- Applied to production via Management API on 2026-09-05.

ALTER TYPE person_type ADD VALUE IF NOT EXISTS 'vehicle_renter';

-- Note: ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- references the new value. Run this migration on its own, then insert/update
-- rows using 'vehicle_renter' in a separate statement.
