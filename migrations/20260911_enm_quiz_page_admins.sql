-- Page-scoped admin for the ENM quiz.
--
-- The site's only notion of "admin" is app_users.role, which is global: granting
-- it to give someone the quiz notes would also hand them DevControl, rentals and
-- financials. This adds a narrow allowlist that confers rights on the
-- enm_quiz_* tables and nothing else.
--
-- Keyed on email rather than a user id so someone can be added before they have
-- ever signed in; it starts working the moment they authenticate.

CREATE TABLE IF NOT EXISTS enm_quiz_admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  note       TEXT,
  added_by   UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enm_quiz_admins_email
  ON enm_quiz_admins (lower(email));

/*
 * True for a site admin/staff member, or for anyone on the quiz allowlist.
 *
 * SECURITY DEFINER so it can read the allowlist without that table having to be
 * world-readable, and so the policies below cannot recurse into it.
 */
CREATE OR REPLACE FUNCTION enm_is_quiz_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM app_users
           WHERE auth_user_id = auth.uid() AND role IN ('admin', 'staff')
         )
      OR EXISTS (
           SELECT 1 FROM enm_quiz_admins
           WHERE lower(email) = lower(NULLIF(auth.jwt() ->> 'email', ''))
         );
$$;

GRANT EXECUTE ON FUNCTION enm_is_quiz_admin() TO authenticated, anon;

ALTER TABLE enm_quiz_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enm_quiz_admins_self_select" ON enm_quiz_admins;
CREATE POLICY "enm_quiz_admins_self_select" ON enm_quiz_admins
  FOR SELECT USING (enm_is_quiz_admin());

-- ── Repoint every quiz policy at the helper ──────────────────────────────────
DROP POLICY IF EXISTS "enm_review_staff_select" ON enm_quiz_review_items;
CREATE POLICY "enm_review_staff_select" ON enm_quiz_review_items
  FOR SELECT USING (enm_is_quiz_admin());

DROP POLICY IF EXISTS "enm_review_staff_update" ON enm_quiz_review_items;
CREATE POLICY "enm_review_staff_update" ON enm_quiz_review_items
  FOR UPDATE USING (enm_is_quiz_admin());

DROP POLICY IF EXISTS "enm_qfeedback_staff_select" ON enm_quiz_question_feedback;
CREATE POLICY "enm_qfeedback_staff_select" ON enm_quiz_question_feedback
  FOR SELECT USING (enm_is_quiz_admin());

DROP POLICY IF EXISTS "enm_ai_runs_staff_select" ON enm_quiz_ai_runs;
CREATE POLICY "enm_ai_runs_staff_select" ON enm_quiz_ai_runs
  FOR SELECT USING (enm_is_quiz_admin());

DROP POLICY IF EXISTS "enm_site_changes_staff_select" ON enm_quiz_site_changes;
CREATE POLICY "enm_site_changes_staff_select" ON enm_quiz_site_changes
  FOR SELECT USING (enm_is_quiz_admin());

-- Lead and session data stays behind the global staff role: the quiz allowlist
-- is for reviewing question design, not for reading who took the quiz.

INSERT INTO enm_quiz_admins (email, note)
VALUES ('chloeprent@gmail.com', 'Quiz design review. Page-scoped only, not a site admin.')
ON CONFLICT (lower(email)) DO NOTHING;
