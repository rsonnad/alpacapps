-- Private page content: HTML that must never live in the public repo or on GitHub Pages.
-- A static shell page signs the viewer in, then selects its row here. RLS returns the
-- row only when the signed-in user's email is in allowed_emails, so the content is
-- enforced server-side (unlike page_access_* which only gates in the browser).
-- Rows are written via the Management API / service role only; no client write policies.

CREATE TABLE IF NOT EXISTS private_page_content (
  slug           TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  css            TEXT NOT NULL DEFAULT '',
  html           TEXT NOT NULL,
  allowed_emails TEXT[] NOT NULL,  -- lowercase
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE private_page_content ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON private_page_content FROM anon;
REVOKE ALL ON private_page_content FROM authenticated;
GRANT SELECT ON private_page_content TO authenticated;

DROP POLICY IF EXISTS "Allowed emails can read" ON private_page_content;
CREATE POLICY "Allowed emails can read"
  ON private_page_content FOR SELECT
  TO authenticated
  USING (lower(auth.jwt() ->> 'email') = ANY (allowed_emails));
