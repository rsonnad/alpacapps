-- app_users: narrow read paths for pages that relied on temp_read_app_users (USING true)
--
-- Part A of 2 (additive, safe to apply before the client ships):
--   * helper is_staff_or_admin_user() for the upcoming staff read-all policy
--   * RPCs that replace every broad client read that isn't staff/admin:
--       get_directory_profile(slug)  -- directory/app.js (anon + authed)
--       list_member_directory()      -- residents/profile.js driver search,
--                                       associates/projectinquiry.js,
--                                       hours-service getMyGroups name hydration
--       is_slug_available(slug)      -- residents/profile.js slug checks
--       get_upload_token_name(token) -- rentals/w9.html, rentals/verify.html (anon)
-- Part B (20260929b_app_users_rls_scoped.sql) drops temp_read_app_users.

-- ---------------------------------------------------------------------------
-- Helper: caller is admin / oracle / staff. SECURITY DEFINER so policies on
-- app_users can call it without recursing into app_users' own RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff_or_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'oracle', 'staff')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin_user() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin_user() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public directory profile. Privacy gating happens here, not in the browser:
-- gated fields come back NULL. Never returns email, contact_email,
-- privacy_settings, allergies, dietary_preferences, telegram, facebook_url.
-- Levels match residents/profile.js PRIVACY_FIELDS: all_guests | residents | only_me
-- (missing = all_guests). "Resident" viewer matches auth.js isResident.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_directory_profile(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u app_users%ROWTYPE;
  v_viewer_role text;
  v_is_self boolean;
  v_is_resident boolean;
  ps jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO u FROM app_users WHERE slug = lower(p_slug) LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_viewer_role FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;
  END IF;

  v_is_self := auth.uid() IS NOT NULL AND u.auth_user_id = auth.uid();
  v_is_resident := coalesce(v_viewer_role IN ('resident', 'associate', 'staff', 'admin', 'oracle'), false);
  ps := coalesce(u.privacy_settings, '{}'::jsonb);

  RETURN jsonb_build_object(
    'id',                  u.id,
    'person_id',           u.person_id,
    'slug',                u.slug,
    'role',                u.role,
    'display_name',        u.display_name,
    'first_name',          u.first_name,
    'last_name',           u.last_name,
    'avatar_url',          u.avatar_url,
    'pronouns',            u.pronouns,
    'is_current_resident', u.is_current_resident,
    'bio',          CASE WHEN public._dir_visible(ps->>'bio',           v_is_self, v_is_resident) THEN u.bio END,
    'nationality',  CASE WHEN public._dir_visible(ps->>'nationality',   v_is_self, v_is_resident) THEN u.nationality END,
    'location_base',CASE WHEN public._dir_visible(ps->>'location_base', v_is_self, v_is_resident) THEN u.location_base END,
    'gender',       CASE WHEN public._dir_visible(ps->>'gender',        v_is_self, v_is_resident) THEN u.gender END,
    'birthday',     CASE WHEN public._dir_visible(ps->>'birthday',      v_is_self, v_is_resident) THEN u.birthday END,
    'phone',        CASE WHEN public._dir_visible(ps->>'phone',         v_is_self, v_is_resident) THEN u.phone END,
    'phone2',       CASE WHEN public._dir_visible(ps->>'phone2',        v_is_self, v_is_resident) THEN u.phone2 END,
    'whatsapp',     CASE WHEN public._dir_visible(ps->>'whatsapp',      v_is_self, v_is_resident) THEN u.whatsapp END,
    'instagram',    CASE WHEN public._dir_visible(ps->>'instagram',     v_is_self, v_is_resident) THEN u.instagram END,
    'links',        CASE WHEN public._dir_visible(ps->>'links',         v_is_self, v_is_resident) THEN u.links END
  );
END;
$$;

-- Privacy level check shared by get_directory_profile. Unknown levels fail closed.
CREATE OR REPLACE FUNCTION public._dir_visible(p_level text, p_is_self boolean, p_is_resident boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_is_self
      OR coalesce(p_level, 'all_guests') = 'all_guests'
      OR (p_level = 'residents' AND p_is_resident);
$$;

REVOKE EXECUTE ON FUNCTION public.get_directory_profile(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_directory_profile(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Member name directory for signed-in community members (driver picker,
-- "Question for" dropdown, work-group coworker names). Names + role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_member_directory()
RETURNS TABLE (id uuid, person_id uuid, display_name text, first_name text, last_name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.person_id, u.display_name, u.first_name, u.last_name, u.role
  FROM app_users u
  WHERE u.role IN ('resident', 'associate', 'staff', 'admin', 'oracle')
    AND lower(coalesce(u.email, '')) <> 'bot@alpacaplayhouse.com'
    AND EXISTS (
      SELECT 1 FROM app_users me
      WHERE me.auth_user_id = auth.uid()
        AND me.role IN ('resident', 'associate', 'staff', 'admin', 'oracle')
    )
  ORDER BY u.display_name NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.list_member_directory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_member_directory() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Slug uniqueness check for residents/profile.js (ignores the caller's own row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_slug_available(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM app_users
       WHERE slug = lower(p_slug)
         AND auth_user_id IS DISTINCT FROM auth.uid()
     );
$$;

REVOKE EXECUTE ON FUNCTION public.is_slug_available(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_slug_available(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Name greeting for tokenized upload pages (anon). Holding the token is the
-- entitlement; returns nothing for an unknown token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_upload_token_name(p_token uuid)
RETURNS TABLE (first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.first_name, u.last_name
  FROM upload_tokens t
  JOIN app_users u ON u.id = t.app_user_id
  WHERE t.token = p_token
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_upload_token_name(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_upload_token_name(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
