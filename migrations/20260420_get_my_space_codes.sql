-- Resident-accessible RPC: return door/access codes for the caller's
-- currently-assigned spaces only.
--
-- SECURITY DEFINER runs with table-owner privileges (bypasses password_vault's
-- admin-only RLS), but we explicitly resolve the caller via auth.uid() and
-- filter to their active assignments — so a resident can only ever see codes
-- for the space(s) they're actively assigned to.
--
-- Mirrors the security model used by PAI's `lookup_codes` tool
-- (supabase/functions/alpaca-pai/index.ts).

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
  RETURN QUERY
  WITH assigned AS (
    SELECT asp.space_id
      FROM assignments a
      JOIN assignment_spaces asp ON asp.assignment_id = a.id
     WHERE a.person_id = _person_id
       AND a.status::text IN ('active', 'pending_contract', 'contract_sent')
  ),
  accessible AS (
    SELECT space_id FROM assigned
    UNION
    SELECT s.parent_id
      FROM spaces s
      JOIN spaces p ON p.id = s.parent_id
     WHERE s.id IN (SELECT space_id FROM assigned)
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
    AND pv.space_id IN (SELECT space_id FROM accessible)
  ORDER BY s.name, pv.display_order NULLS LAST, pv.service;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_space_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_space_codes() TO authenticated;

COMMENT ON FUNCTION public.get_my_space_codes() IS
  'Returns door/access codes for the caller''s currently-assigned spaces only. Called by residents/my-access.html; mirrors PAI lookup_codes security model.';
