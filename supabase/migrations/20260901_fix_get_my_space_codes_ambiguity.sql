-- get_my_space_codes() has never been able to return a row.
--
-- RETURNS TABLE declares `space_id` as a PL/pgSQL OUT variable, and the CTEs
-- below reference a bare column of the same name, so the RETURN QUERY fails to
-- plan with:
--
--   ERROR 42702: column reference "space_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- The early `IF _person_id IS NULL THEN RETURN` path never reaches that query,
-- so the function looks fine for signed-out callers and only throws for exactly
-- the people it exists to serve. On /residents/my-access.html that surfaces as
-- "Something went wrong loading your codes" for every resident.
--
-- Fix is naming only: the CTE column becomes `sid` and every reference is
-- qualified. Which rows come back is deliberately unchanged — a resident still
-- sees codes for their own assigned space(s) and non-root parents, and never
-- the house-wide entries with space_id IS NULL.

CREATE OR REPLACE FUNCTION public.get_my_space_codes()
RETURNS TABLE (
  space_id   uuid,
  space_name text,
  service    text,
  username   text,
  password   text,
  notes      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _person_id uuid;
BEGIN
  -- Resolve caller to a person_id via their app_users record.
  SELECT au.person_id
    INTO _person_id
    FROM app_users au
   WHERE au.auth_user_id = auth.uid();

  -- Non-resident / unauthenticated caller: return nothing.
  IF _person_id IS NULL THEN
    RETURN;
  END IF;

  -- Build the set of space_ids the caller should see codes for:
  --   1. Each space they're directly assigned to
  --   2. The parent of each assigned space, but only if that parent is not
  --      a root-level space (i.e. Playhouse, Sharingwood Basement). This
  --      lets a Fishbowl resident see the Spartan Trailer outer-door code
  --      and a Skyloft Bed resident see the Skyloft room code, without
  --      leaking any Playhouse-level codes that might exist.
  --
  -- `sid` rather than `space_id`: a bare `space_id` here binds to the OUT
  -- parameter of the same name instead of the CTE column.
  RETURN QUERY
  WITH assigned AS (
    SELECT asp.space_id AS sid
      FROM assignments a
      JOIN assignment_spaces asp ON asp.assignment_id = a.id
     WHERE a.person_id = _person_id
       AND a.status::text IN ('active', 'pending_contract', 'contract_sent')
  ),
  accessible AS (
    SELECT assigned.sid FROM assigned
    UNION
    SELECT s.parent_id
      FROM spaces s
      JOIN spaces p ON p.id = s.parent_id
     WHERE s.id IN (SELECT assigned.sid FROM assigned)
       AND p.parent_id IS NOT NULL  -- skip root parents (Playhouse, Sharingwood)
  )
  SELECT
    pv.space_id,
    s.name          AS space_name,
    pv.service,
    pv.username,
    pv.password,
    pv.notes
  FROM password_vault pv
  JOIN spaces s ON s.id = pv.space_id
  WHERE pv.category = 'house'
    AND pv.is_active = TRUE
    AND pv.space_id IN (SELECT accessible.sid FROM accessible)
  ORDER BY s.name, pv.display_order NULLS LAST, pv.service;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_space_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_space_codes() TO authenticated;
