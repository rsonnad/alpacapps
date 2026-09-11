-- ENM Style quiz (rahulio/pages/enmtest)
-- Fully segregated from the rest of the schema: its own enm_quiz_* tables, no
-- FKs out to people/app_users. The quiz is anonymous and public, so anon can
-- INSERT but never SELECT; staff/admin read the results.
--
-- All ids are generated client-side (crypto.randomUUID) so the page never has
-- to read a row back — which it could not do under these policies anyway.

-- ── Leads: captured up front, before the first question ──────────────────────
CREATE TABLE IF NOT EXISTS enm_quiz_leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  first_name   TEXT,
  consented    BOOLEAN NOT NULL DEFAULT false,
  source       TEXT NOT NULL DEFAULT 'enmtest',
  referrer     TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_quiz_leads_email      ON enm_quiz_leads(email);
CREATE INDEX IF NOT EXISTS idx_enm_quiz_leads_created_at ON enm_quiz_leads(created_at DESC);

-- ── Sessions: one row per completed run, written once at the end ─────────────
CREATE TABLE IF NOT EXISTS enm_quiz_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID REFERENCES enm_quiz_leads(id) ON DELETE CASCADE,
  result_uid       TEXT NOT NULL,
  result_title     TEXT NOT NULL,
  -- [{ uid, title, score, percent }, ...] for the top-N graph shown to the user
  top_results      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { "<result uid>": <raw score>, ... } across every result, including zeroes
  scores           JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_quiz_sessions_lead_id    ON enm_quiz_sessions(lead_id);
CREATE INDEX IF NOT EXISTS idx_enm_quiz_sessions_result_uid ON enm_quiz_sessions(result_uid);
CREATE INDEX IF NOT EXISTS idx_enm_quiz_sessions_created_at ON enm_quiz_sessions(created_at DESC);

-- ── Answers: one row per question answered, bulk-inserted with the session ───
-- Question/option text is denormalised on purpose: the quiz copy will be edited
-- over time and old responses must stay readable as they were actually asked.
CREATE TABLE IF NOT EXISTS enm_quiz_answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES enm_quiz_sessions(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES enm_quiz_leads(id) ON DELETE CASCADE,
  question_number  INTEGER NOT NULL,
  question_uid     TEXT NOT NULL,
  question_title   TEXT NOT NULL,
  option_uids      TEXT[] NOT NULL DEFAULT '{}',
  option_texts     TEXT[] NOT NULL DEFAULT '{}',
  -- result uids this answer scored toward; empty for options that score nothing
  scored_results   TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_quiz_answers_session_id ON enm_quiz_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_enm_quiz_answers_question   ON enm_quiz_answers(question_uid);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE enm_quiz_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enm_quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enm_quiz_answers  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enm_quiz_leads_anon_insert" ON enm_quiz_leads;
CREATE POLICY "enm_quiz_leads_anon_insert" ON enm_quiz_leads
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "enm_quiz_sessions_anon_insert" ON enm_quiz_sessions;
CREATE POLICY "enm_quiz_sessions_anon_insert" ON enm_quiz_sessions
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "enm_quiz_answers_anon_insert" ON enm_quiz_answers;
CREATE POLICY "enm_quiz_answers_anon_insert" ON enm_quiz_answers
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "enm_quiz_leads_staff_select" ON enm_quiz_leads;
CREATE POLICY "enm_quiz_leads_staff_select" ON enm_quiz_leads
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

DROP POLICY IF EXISTS "enm_quiz_sessions_staff_select" ON enm_quiz_sessions;
CREATE POLICY "enm_quiz_sessions_staff_select" ON enm_quiz_sessions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

DROP POLICY IF EXISTS "enm_quiz_answers_staff_select" ON enm_quiz_answers;
CREATE POLICY "enm_quiz_answers_staff_select" ON enm_quiz_answers
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));
