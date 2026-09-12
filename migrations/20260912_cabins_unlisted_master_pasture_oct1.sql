-- 2026-09-12 rentals listing changes
--
-- 1. Cabinearo + CabinFever: both are on month-to-month with existing tenants and
--    should not appear in public browsing until we get notice. The rentals page
--    filters on is_listed && !is_secret_effective, so unlisting hides them from the
--    grid while direct slug links (?space=cabinfever) still resolve.
--    Note: CabinFever has an active dwelling assignment; Cabinearo has no assignment
--    row in the DB even though it is occupied.
UPDATE spaces
SET is_listed = false
WHERE id IN (
  'f7ba0711-fec4-41e5-a149-9497de9de45a',  -- Cabinearo
  'ca7af2c2-d686-4d2a-ab97-02c3a474c073'   -- CabinFever
);

-- 2. Master Pasture Suite: $995/month, month-to-month, available 2026-10-01.
--    Availability = effective end date + 2 days (checkout + cleaning buffer), so a
--    listed desired departure of 2026-09-29 yields "Available: Oct 1, 2026" without
--    touching the assignment's contractual end_date.
UPDATE spaces
SET monthly_rate = 995,
    rental_term = 'monthly'
WHERE id = '4122fc36-e00c-4550-8abb-5a0560e74a6e';  -- Master Pasture Suite

UPDATE assignments
SET desired_departure_date = '2026-09-29',
    desired_departure_listed = true
WHERE id = '7343769b-eff0-4806-97d3-f5ea7766f80d';  -- current Master Pasture Suite assignment
