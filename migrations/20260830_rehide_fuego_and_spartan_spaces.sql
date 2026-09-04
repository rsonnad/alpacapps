-- Parent inheritance for space visibility, plus re-hiding Fuego Trailer.
--
-- Background: migration 021 set is_secret on 'spartan trailer', 'fuego trailer',
-- and 'magic bus' by exact name. Fuego Trailer was later flipped back to
-- is_secret = false (via the admin Spaces editor), and the Spartan child spaces
-- (Spartan Fishbowl, Spartan Tea Lounge) were never covered by 021's name match
-- at all. Nothing in the codebase inherited secrecy from a parent, so hiding
-- Spartan Trailer never hid the spaces inside it.
--
-- This adds is_secret_effective: true when the space itself is secret OR any
-- ancestor is. is_secret stays the authored intent, so toggling a parent in the
-- admin UI now pulls its whole subtree with it. Consumers filter on
-- is_secret_effective instead of is_secret.

-- ---------------------------------------------------------------------------
-- 1. Derived column
-- ---------------------------------------------------------------------------

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS is_secret_effective boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Recompute function
-- ---------------------------------------------------------------------------
-- The table is small (~50 rows), so recomputing the whole tree on any write is
-- cheaper and far less error-prone than tracking affected subtrees. Roots are
-- rows with no parent, plus any orphan whose parent_id no longer resolves, so
-- every row is reached. depth is capped as a cycle guard.

CREATE OR REPLACE FUNCTION spaces_recompute_secret_effective()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH RECURSIVE tree AS (
    SELECT s.id, s.is_secret AS eff, 1 AS depth
    FROM spaces s
    WHERE s.parent_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM spaces p WHERE p.id = s.parent_id)
    UNION ALL
    SELECT c.id, (c.is_secret OR t.eff), t.depth + 1
    FROM spaces c
    JOIN tree t ON c.parent_id = t.id
    WHERE t.depth < 20
  )
  UPDATE spaces s
  SET is_secret_effective = tree.eff
  FROM tree
  WHERE s.id = tree.id
    AND s.is_secret_effective IS DISTINCT FROM tree.eff;

  RETURN NULL;
END;
$$;

-- Statement-level, and guarded on pg_trigger_depth() so the UPDATE above does
-- not re-enter the trigger. A 0-row UPDATE still fires a statement trigger, so
-- without this guard it would recurse forever.
--
-- The guard must be = 0, not = 1: a trigger's WHEN clause is evaluated BEFORE
-- control enters the trigger function, so at that point the depth is still the
-- caller's. A top-level statement evaluates WHEN at depth 0 (inside the function
-- body it then reads 1); the recompute UPDATE runs at depth 1, so its own WHEN
-- evaluates at 1 and does not re-enter. Verified against the live database --
-- with = 1 the trigger never fires at all and is_secret_effective goes stale.
DROP TRIGGER IF EXISTS spaces_secret_effective_sync ON spaces;
CREATE TRIGGER spaces_secret_effective_sync
  AFTER INSERT OR UPDATE OR DELETE ON spaces
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION spaces_recompute_secret_effective();

-- ---------------------------------------------------------------------------
-- 3. Re-hide Fuego Trailer
-- ---------------------------------------------------------------------------
-- Fuego Trailer's parent is Playhouse, which is not secret, so inheritance does
-- not cover it -- it needs its own flag. Spartan Trailer's children (Spartan
-- Fishbowl, Spartan Tea Lounge, and Cedar Chamber) are deliberately NOT flagged
-- here: their parent is already secret, so inheritance hides them, and unhiding
-- the trailer later should unhide them too.

UPDATE spaces
SET is_secret = true
WHERE id = '14d17e18-b271-409c-b99e-ab74018b23a2';  -- Fuego Trailer

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- Step 3 already fires the trigger, but run it explicitly so this migration is
-- correct even if step 3 is a no-op on a given environment.

WITH RECURSIVE tree AS (
  SELECT s.id, s.is_secret AS eff, 1 AS depth
  FROM spaces s
  WHERE s.parent_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM spaces p WHERE p.id = s.parent_id)
  UNION ALL
  SELECT c.id, (c.is_secret OR t.eff), t.depth + 1
  FROM spaces c
  JOIN tree t ON c.parent_id = t.id
  WHERE t.depth < 20
)
UPDATE spaces s
SET is_secret_effective = tree.eff
FROM tree
WHERE s.id = tree.id
  AND s.is_secret_effective IS DISTINCT FROM tree.eff;
