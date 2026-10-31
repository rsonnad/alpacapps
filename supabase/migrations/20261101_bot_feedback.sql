-- Feedback and feature requests for public bots (Avatar Profile Designer and
-- later others). Written only by the bot-feedback edge function (service role);
-- shown at alpacaplayhouse.com/bots/feedback/admin/.
--
-- Separate from public.feedback, which is the site-wide "feedback on this page"
-- box (page_path, no type/status).
--
-- Readers: only rahulioson@gmail.com, sonia245g@gmail.com and hrsonnad@gmail.com,
-- and only when signed in with Google (Google proves the address; a password
-- sign-up with the same address does not count).
-- Regression test: supabase/tests/bot-feedback-access.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.bot_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  type        text NOT NULL DEFAULT 'feedback'
              CHECK (type IN ('feedback', 'feature_request', 'bug')),
  message     text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  email       text CHECK (email IS NULL OR char_length(email) <= 254),
  bot_name    text CHECK (bot_name IS NULL OR char_length(bot_name) <= 200),
  bot_version text CHECK (bot_version IS NULL OR char_length(bot_version) <= 50),
  source      text NOT NULL DEFAULT 'bot' CHECK (source IN ('web', 'bot')),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done')),
  ip_hash     text
);

CREATE INDEX IF NOT EXISTS bot_feedback_created_at_idx ON public.bot_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS bot_feedback_ip_hash_idx ON public.bot_feedback (ip_hash, created_at DESC);

CREATE OR REPLACE FUNCTION public.bot_feedback_is_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = auth.uid()
      AND i.provider = 'google'
      AND lower(i.identity_data->>'email') IN
          ('rahulioson@gmail.com', 'sonia245g@gmail.com', 'hrsonnad@gmail.com')
  );
$$;
REVOKE ALL ON FUNCTION public.bot_feedback_is_viewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bot_feedback_is_viewer() TO authenticated;

ALTER TABLE public.bot_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bot_feedback TO authenticated;
GRANT UPDATE (status) ON public.bot_feedback TO authenticated;

DROP POLICY IF EXISTS "Feedback viewers read" ON public.bot_feedback;
CREATE POLICY "Feedback viewers read" ON public.bot_feedback
  FOR SELECT TO authenticated USING (public.bot_feedback_is_viewer());

DROP POLICY IF EXISTS "Feedback viewers set status" ON public.bot_feedback;
CREATE POLICY "Feedback viewers set status" ON public.bot_feedback
  FOR UPDATE TO authenticated
  USING (public.bot_feedback_is_viewer())
  WITH CHECK (public.bot_feedback_is_viewer());

COMMIT;
