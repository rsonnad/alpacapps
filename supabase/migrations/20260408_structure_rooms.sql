-- Rooms within structures (e.g. Main House → Living Room, Kitchen, etc.)
-- N rooms per structure. Dimensions in feet, materials as comma-delimited text.

CREATE TABLE IF NOT EXISTS structure_rooms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id      INTEGER NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  length_ft         NUMERIC(6,2),
  width_ft          NUMERIC(6,2),
  height_ft         NUMERIC(6,2),
  primary_materials TEXT,  -- comma-delimited (e.g. "tile, wood, cork")
  notes             TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structure_rooms_structure ON structure_rooms(structure_id);

ALTER TABLE structure_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read rooms"
  ON structure_rooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert rooms"
  ON structure_rooms FOR INSERT
  WITH CHECK (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  );

CREATE POLICY "Admins can update rooms"
  ON structure_rooms FOR UPDATE
  USING (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  )
  WITH CHECK (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  );

CREATE POLICY "Admins can delete rooms"
  ON structure_rooms FOR DELETE
  USING (
    (SELECT role FROM app_users WHERE auth_user_id = auth.uid()) IN ('admin','oracle')
  );
