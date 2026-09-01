-- Fix two privilege-escalation holes in public.app_users RLS.
--
-- 1. "Users can update own last_login" is row-scoped, not column-scoped: despite
--    its name it let any signed-in user run
--        update app_users set role='admin' where auth_user_id = auth.uid();
--    and become an admin.
-- 2. "Users can create own record from invitation" never checked that the
--    inserted role matched the invitation's role, and ignored expires_at, so
--    anyone holding any pending invitation could insert themselves as admin.
--
-- Approach for (1): a BEFORE UPDATE trigger that pins the privileged columns to
-- their stored values for ordinary end users. Column-level GRANTs were rejected
-- because Supabase admins are *also* the `authenticated` DB role, so
-- REVOKE UPDATE ... FROM authenticated would break the admin role editor
-- (admin/users.js:745 updates app_users.role straight from the browser).

-- ---------------------------------------------------------------------------
-- 1. Lock privileged columns against self-service writes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_users_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER            -- must stay INVOKER so current_user is the real caller
SET search_path = public
AS $$
BEGIN
  -- Trusted server-side callers (service_role key, postgres/SQL editor, cron,
  -- and SECURITY DEFINER functions such as recompute_current_residents) keep
  -- full control. `authenticated` and `anon` are the only PostgREST-exposed
  -- end-user roles, so everything else is treated as trusted.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Admins and oracles may still change these from the browser.
  IF public.is_admin_user() THEN
    RETURN NEW;
  END IF;

  -- Everyone else: silently pin these to the stored values, so ordinary profile
  -- saves and last_login_at writes still succeed but cannot escalate privileges.
  NEW.role                         := OLD.role;
  NEW.is_current_resident          := OLD.is_current_resident;
  NEW.is_current_resident_override := OLD.is_current_resident_override;
  NEW.vehicle_limit                := OLD.vehicle_limit;
  NEW.person_id                    := OLD.person_id;
  NEW.invited_by                   := OLD.invited_by;
  NEW.email                        := OLD.email;
  NEW.auth_user_id                 := OLD.auth_user_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.app_users_guard_privileged_columns() IS
  'Pins privilege/identity columns on app_users for non-admin end users. The '
  '"Users can update own last_login" RLS policy is row-scoped only, so this '
  'trigger supplies the column scoping it lacks.';

DROP TRIGGER IF EXISTS app_users_guard_privileged_columns ON public.app_users;

CREATE TRIGGER app_users_guard_privileged_columns
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  EXECUTE FUNCTION public.app_users_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 2. Make the invitation INSERT policy honour the invited role and expiry
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can create own record from invitation" ON public.app_users;

CREATE POLICY "Users can create own record from invitation"
  ON public.app_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_invitations i
      WHERE i.email = auth.email()
        AND i.status = 'pending'
        AND (i.expires_at IS NULL OR i.expires_at > now())
        AND i.role = app_users.role      -- inserted role must match the invitation
    )
  );
