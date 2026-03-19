-- project_notes: Free-form notes tagged to spaces (measurements, plans, observations)
CREATE TABLE project_notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  space_id    UUID REFERENCES spaces(id),
  title       TEXT NOT NULL,
  body        TEXT,
  note_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  UUID REFERENCES app_users(id)
);

CREATE INDEX idx_project_notes_space ON project_notes (space_id);
CREATE INDEX idx_project_notes_date  ON project_notes (note_date DESC);

-- RLS: authenticated users can CRUD
ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read project notes"
  ON project_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert project notes"
  ON project_notes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update project notes"
  ON project_notes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete project notes"
  ON project_notes FOR DELETE
  TO authenticated
  USING (true);
