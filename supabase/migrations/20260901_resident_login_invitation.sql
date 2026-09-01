-- Adding someone to the resident list must grant them a working resident login.
--
-- Before this, it did not. There is no trigger on auth.users, so app_users rows are
-- created client-side by shared/auth.js on first sign-in — and the app_users RLS
-- INSERT policy ("Users can create own record from invitation") only permits that
-- insert while a pending user_invitations row exists for the signup email. A person
-- with an active dwelling assignment but no invitation therefore cannot create an
-- account at all, and even the auth.js "auto-create as public" fallback is blocked.
--
-- This adds the missing link: whenever a person holds a dwelling assignment in a
-- status that get_my_space_codes() treats as entitled, make sure a pending resident
-- invitation exists for them, with an expiry that covers the whole stay.
--
-- Creating an invitation row sends nothing. user_invitations has no triggers
-- (only FK constraint triggers) and no webhooks; invitation email is always sent
-- explicitly from admin/users.js. This migration is silent by design.

-- ---------------------------------------------------------------------------
-- Helper: ensure a usable pending invitation for one person
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_resident_invitation_for_person(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email    text;
  _last_day date;
  _expires  timestamptz;
  _pending  user_invitations%ROWTYPE;
BEGIN
  IF p_person_id IS NULL THEN
    RETURN;
  END IF;

  SELECT NULLIF(LOWER(TRIM(p.email)), '') INTO _email
    FROM people p
   WHERE p.id = p_person_id;

  -- No real email means there is nothing to invite. Prospects created without an
  -- address get a `prospect-<ts>@noemail.local` placeholder (see admin/users.js).
  IF _email IS NULL OR _email LIKE '%@noemail.local' THEN
    RETURN;
  END IF;

  -- Entitled statuses are kept identical to get_my_space_codes(), so a login exists
  -- exactly when there would be codes to show. Open-ended stays get a year.
  SELECT MAX(COALESCE(a.end_date, CURRENT_DATE + 365)) INTO _last_day
    FROM assignments a
   WHERE a.person_id = p_person_id
     AND a.type::text = 'dwelling'
     AND a.status::text IN ('active', 'pending_contract', 'contract_sent');

  IF _last_day IS NULL THEN
    RETURN;  -- no entitled assignment
  END IF;

  -- Already has a login row; its role is managed in admin/users, not here.
  IF EXISTS (
    SELECT 1 FROM app_users au
     WHERE au.person_id = p_person_id
        OR LOWER(TRIM(au.email)) = _email
  ) THEN
    RETURN;
  END IF;

  -- The default 7-day expiry is far too short for a residency: someone who moves in
  -- in September and first opens the app in October would find a dead invitation.
  -- Cover the stay, with a 30-day floor for short ones.
  _expires := GREATEST(NOW() + INTERVAL '30 days', (_last_day + 1)::timestamptz);

  SELECT * INTO _pending
    FROM user_invitations ui
   WHERE LOWER(TRIM(ui.email)) = _email
     AND ui.status = 'pending'
   ORDER BY ui.invited_at DESC
   LIMIT 1;

  IF _pending.id IS NULL THEN
    INSERT INTO user_invitations (email, role, expires_at)
    VALUES (_email, 'resident', _expires);

  ELSIF _pending.role IN ('public', 'prospect') THEN
    -- They were invited as a prospect and have since become a resident.
    UPDATE user_invitations
       SET role = 'resident',
           expires_at = GREATEST(COALESCE(expires_at, _expires), _expires)
     WHERE id = _pending.id;

  ELSIF _pending.role = 'resident' THEN
    UPDATE user_invitations
       SET expires_at = GREATEST(COALESCE(expires_at, _expires), _expires)
     WHERE id = _pending.id;
  END IF;
  -- A pending admin/staff/oracle/demo/associate invitation already grants at least
  -- resident access and its expiry is somebody's deliberate choice — left untouched.
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_resident_invitation_for_person(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Trigger 1: assignment created, or its status / person / end date changed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_assignments_ensure_resident_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ensure_resident_invitation_for_person(NEW.person_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignments_ensure_resident_invitation ON public.assignments;
CREATE TRIGGER trg_assignments_ensure_resident_invitation
AFTER INSERT OR UPDATE OF status, type, person_id, end_date ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_assignments_ensure_resident_invitation();

-- ---------------------------------------------------------------------------
-- Trigger 2: an email lands on a person who already has an assignment
--
-- People are routinely created before their email is known (two current
-- contract_sent assignment holders have none), so the assignment trigger alone
-- would skip them permanently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_people_ensure_resident_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ensure_resident_invitation_for_person(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_people_ensure_resident_invitation ON public.people;
CREATE TRIGGER trg_people_ensure_resident_invitation
AFTER UPDATE OF email ON public.people
FOR EACH ROW
WHEN (NEW.email IS DISTINCT FROM OLD.email)
EXECUTE FUNCTION public.tg_people_ensure_resident_invitation();

-- ---------------------------------------------------------------------------
-- Backfill everyone currently entitled but unable to sign in
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _pid uuid;
BEGIN
  FOR _pid IN
    SELECT DISTINCT a.person_id
      FROM assignments a
     WHERE a.type::text = 'dwelling'
       AND a.status::text IN ('active', 'pending_contract', 'contract_sent')
  LOOP
    PERFORM public.ensure_resident_invitation_for_person(_pid);
  END LOOP;
END;
$$;
