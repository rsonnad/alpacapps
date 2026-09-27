-- Admin-only spaces: rows only admins/oracles can read. First use: hide
-- Sharingwood Basement (an off-site unit in Snohomish, WA) from staff,
-- residents, associates and the public.
--
-- Why RLS and not a client-side filter: before this migration the anon key
-- could read the full Sharingwood row (street address included) straight from
-- PostgREST, so a UI filter would only have been cosmetic.
--
-- Why a RESTRICTIVE policy: Postgres ANDs restrictive policies with the
-- permissive ones, so this can only ever remove rows from a SELECT. It is safe
-- to layer on top of whatever permissive SELECT policies are live on `spaces`
-- (they are not all captured in this repo) without having to rewrite them.
--
-- Who can still see admin-only rows:
--   * public.is_admin_user() = app_users.role IN ('admin','oracle')
--   * service_role (edge functions) and postgres/SQL editor, which bypass RLS
--   * SECURITY DEFINER functions that read `spaces` (they run as owner)
--
-- Side effects for non-admins: embeds that join to an admin-only space
-- (e.g. assignments -> space:space_id(name), tasks -> space) come back with a
-- null `space`. Sharingwood has no active assignment at time of writing.
--
-- Not inherited: unlike is_secret -> is_secret_effective, children of an
-- admin-only space are NOT hidden automatically. Flag each row explicitly.

-- 1. Column ------------------------------------------------------------------

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS is_admin_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.spaces.is_admin_only IS
  'When true, only admin/oracle users can read this row (enforced by the '
  '"Admin-only spaces hidden from non-admins" RESTRICTIVE RLS policy).';

-- 2. Policy ------------------------------------------------------------------
-- (SELECT public.is_admin_user()) is wrapped so Postgres evaluates it once per
-- statement (initplan) instead of once per row.

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin-only spaces hidden from non-admins" ON public.spaces;
CREATE POLICY "Admin-only spaces hidden from non-admins"
  ON public.spaces
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (NOT is_admin_only OR (SELECT public.is_admin_user()));

-- 3. Flag Sharingwood Basement -----------------------------------------------

UPDATE public.spaces
   SET is_admin_only = true
 WHERE id = '69357b34-37e1-493a-92f9-8d704dd67ee7';  -- Sharingwood Basement

-- Verify (run as anon, e.g. curl with the publishable key): should return [].
--   GET /rest/v1/spaces?id=eq.69357b34-37e1-493a-92f9-8d704dd67ee7&select=id
