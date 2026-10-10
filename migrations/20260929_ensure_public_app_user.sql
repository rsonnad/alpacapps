-- New users with no invitation could never get an app_users row: the only INSERT
-- policy requires a pending invitation, so the client's "auto-create as public"
-- fallback in shared/auth.js always failed RLS and showed "Something went wrong
-- creating your account."
--
-- A SECURITY DEFINER RPC instead of a looser policy: with a policy the client
-- would choose every column (person_id, is_current_resident, vehicle_limit, ...).
-- Here every value is derived server-side from auth.users.

CREATE OR REPLACE FUNCTION public.ensure_public_app_user()
RETURNS public.app_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  existing public.app_users;
  created public.app_users;
  em text;
  full_name text;
  dname text;
  parts text[];
  pid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO existing FROM app_users WHERE auth_user_id = uid LIMIT 1;
  IF FOUND THEN
    RETURN existing;
  END IF;

  SELECT lower(u.email), u.raw_user_meta_data->>'full_name'
    INTO em, full_name
    FROM auth.users u WHERE u.id = uid;
  IF em IS NULL OR em = '' THEN
    RAISE EXCEPTION 'auth user has no email';
  END IF;

  -- Mirrors splitDisplayName() in shared/auth.js
  dname := coalesce(nullif(btrim(full_name), ''), split_part(em, '@', 1));
  parts := regexp_split_to_array(btrim(dname), '\s+');

  SELECT id INTO pid FROM people WHERE lower(email) = em ORDER BY created_at LIMIT 1;

  BEGIN
    INSERT INTO app_users (auth_user_id, email, display_name, first_name, last_name, role, person_id)
    VALUES (
      uid, em, dname, parts[1],
      CASE WHEN array_length(parts, 1) > 1 THEN array_to_string(parts[2:], ' ') END,
      'public', pid
    )
    RETURNING * INTO created;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent call (two tabs) already created it, or an unlinked row exists for this email
    SELECT * INTO created FROM app_users WHERE auth_user_id = uid LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'an account for % already exists; contact support', em;
    END IF;
  END;

  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_public_app_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_public_app_user() TO authenticated;
