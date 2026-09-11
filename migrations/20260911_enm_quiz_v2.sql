-- ENM Style quiz, round two (rahulio/pages/enmtest).
--
-- Adds: partner invites, per-question feedback from takers, an AI situation
-- summary, and the admin review/action-item surface that drives site edits.
--
-- Ordering note: the email gate moved from before question 1 to after question
-- 20, so the lead row no longer exists while someone is mid-quiz. Anything
-- written during the run keys off `run_id` — a UUID the page generates when the
-- quiz starts — and the session row carries the same id when it lands at the
-- end. That is deliberately NOT a foreign key: the children are written first.

-- ── Leads: partner linkage ───────────────────────────────────────────────────
ALTER TABLE enm_quiz_leads
  ADD COLUMN IF NOT EXISTS partner_email      TEXT,
  ADD COLUMN IF NOT EXISTS partner_lead_id    UUID REFERENCES enm_quiz_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_by_lead_id UUID REFERENCES enm_quiz_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_token       TEXT,
  ADD COLUMN IF NOT EXISTS invite_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_linked_at  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enm_quiz_leads_invite_token
  ON enm_quiz_leads(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enm_quiz_leads_partner ON enm_quiz_leads(partner_lead_id);

-- ── Sessions: run id + AI summary ────────────────────────────────────────────
ALTER TABLE enm_quiz_sessions
  ADD COLUMN IF NOT EXISTS run_id        UUID,
  ADD COLUMN IF NOT EXISTS ai_summary    JSONB,
  ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enm_quiz_sessions_run_id
  ON enm_quiz_sessions(run_id) WHERE run_id IS NOT NULL;

-- ── Per-question feedback from quiz takers ───────────────────────────────────
-- Submitted from a link at the top of each question, so it usually arrives
-- before we know who the person is. run_id stitches it to the session later.
CREATE TABLE IF NOT EXISTS enm_quiz_question_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID,
  question_number  INTEGER NOT NULL,
  question_uid     TEXT NOT NULL,
  question_title   TEXT NOT NULL,
  feedback         TEXT NOT NULL,
  selected_texts   TEXT[] NOT NULL DEFAULT '{}',
  page_path        TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_qfeedback_question ON enm_quiz_question_feedback(question_number);
CREATE INDEX IF NOT EXISTS idx_enm_qfeedback_run      ON enm_quiz_question_feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_enm_qfeedback_created  ON enm_quiz_question_feedback(created_at DESC);

-- ── Admin review items (yes / no / postpone) ─────────────────────────────────
-- question_number 0 means the item is about the quiz as a whole rather than one
-- question. proposed_change holds the concrete edit the site updater applies.
CREATE TABLE IF NOT EXISTS enm_quiz_review_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_number  INTEGER NOT NULL DEFAULT 0,
  question_uid     TEXT,
  category         TEXT NOT NULL DEFAULT 'clarity'
                     CHECK (category IN ('coverage','clarity','self-vs-partner','scoring','flow','safety','copy')),
  title            TEXT NOT NULL,
  finding          TEXT NOT NULL,
  recommendation   TEXT NOT NULL,
  proposed_change  JSONB,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','postponed')),
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  decided_note     TEXT,
  applied_at       TIMESTAMPTZ,
  source           TEXT NOT NULL DEFAULT 'seed',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_review_status ON enm_quiz_review_items(status);
CREATE INDEX IF NOT EXISTS idx_enm_review_sort   ON enm_quiz_review_items(sort_order, question_number);

-- ── Audit of every model call ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enm_quiz_ai_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  model       TEXT,
  request     JSONB,
  response    TEXT,
  usage       JSONB,
  actor       UUID,
  ok          BOOLEAN NOT NULL DEFAULT true,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enm_ai_runs_kind    ON enm_quiz_ai_runs(kind);
CREATE INDEX IF NOT EXISTS idx_enm_ai_runs_created ON enm_quiz_ai_runs(created_at DESC);

-- ── Site-change queue ────────────────────────────────────────────────────────
-- The edge function records what to change; a GitHub Actions workflow applies
-- it with the repo's own GITHUB_TOKEN. Writes are hard-scoped to path_scope,
-- enforced again in the workflow, so an approved item cannot reach other pages.
CREATE TABLE IF NOT EXISTS enm_quiz_site_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL DEFAULT 'review_items'
                    CHECK (kind IN ('review_items','freeform')),
  path_scope      TEXT NOT NULL DEFAULT 'rahulio/pages/enmtest/',
  instructions    TEXT NOT NULL,
  review_item_ids UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','applying','applied','failed','rejected')),
  files           JSONB NOT NULL DEFAULT '[]'::jsonb,
  commit_sha      TEXT,
  error           TEXT,
  requested_by    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enm_site_changes_status  ON enm_quiz_site_changes(status);
CREATE INDEX IF NOT EXISTS idx_enm_site_changes_created ON enm_quiz_site_changes(created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE enm_quiz_question_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE enm_quiz_review_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE enm_quiz_ai_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE enm_quiz_site_changes      ENABLE ROW LEVEL SECURITY;

-- Takers can leave feedback; only staff read it.
DROP POLICY IF EXISTS "enm_qfeedback_anon_insert" ON enm_quiz_question_feedback;
CREATE POLICY "enm_qfeedback_anon_insert" ON enm_quiz_question_feedback
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "enm_qfeedback_staff_select" ON enm_quiz_question_feedback;
CREATE POLICY "enm_qfeedback_staff_select" ON enm_quiz_question_feedback
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

-- Review items are an internal surface: staff read, staff decide. No anon access.
DROP POLICY IF EXISTS "enm_review_staff_select" ON enm_quiz_review_items;
CREATE POLICY "enm_review_staff_select" ON enm_quiz_review_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

DROP POLICY IF EXISTS "enm_review_staff_update" ON enm_quiz_review_items;
CREATE POLICY "enm_review_staff_update" ON enm_quiz_review_items
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

-- ai_runs and site_changes are written by the edge function (service role, which
-- bypasses RLS). Staff get read-only visibility; nobody else sees them at all.
DROP POLICY IF EXISTS "enm_ai_runs_staff_select" ON enm_quiz_ai_runs;
CREATE POLICY "enm_ai_runs_staff_select" ON enm_quiz_ai_runs
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

DROP POLICY IF EXISTS "enm_site_changes_staff_select" ON enm_quiz_site_changes;
CREATE POLICY "enm_site_changes_staff_select" ON enm_quiz_site_changes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin','staff')));

-- ── Admin identity + deploy notification for site changes ────────────────────
-- A rebuild is attributable: we require the requesting admin's email (the page
-- remembers it locally so they only type it once) and mail them a summary once
-- the deploy has actually gone out.
ALTER TABLE enm_quiz_site_changes
  ADD COLUMN IF NOT EXISTS requested_by_email TEXT,
  ADD COLUMN IF NOT EXISTS deploy_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deploy_status      TEXT,
  ADD COLUMN IF NOT EXISTS notified_at        TIMESTAMPTZ;
