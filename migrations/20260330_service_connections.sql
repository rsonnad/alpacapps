-- Service Connections Directory
-- Stores verified connection recipes for all external services (SSH, APIs, storage, etc.)
-- Replaces manually-maintained memory/service-access.md with a queryable table.

CREATE TABLE IF NOT EXISTS service_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity
  name text NOT NULL,                     -- e.g. "Alpuca — Mac Mini M4"
  slug text NOT NULL UNIQUE,              -- e.g. "alpuca" (URL-safe key)
  category text NOT NULL DEFAULT 'server', -- server, api, storage, database, iot, network

  -- Connection
  host text,                              -- IP or hostname
  port integer,                           -- default port (22, 443, etc.)
  protocol text,                          -- ssh, https, http, s3, mqtt
  auth_method text,                       -- key, password, token, s3_keys, cookie

  -- Credentials (Bitwarden references only — never store actual secrets)
  bw_item_name text,                      -- exact Bitwarden item name for bw-read
  bw_field_name text,                     -- primary field name (e.g. "API Token")
  bw_extra_fields jsonb DEFAULT '{}',     -- additional fields: {"Access Key ID": "desc", ...}

  -- Recipe
  connect_command text,                   -- copy-paste command with bw-read calls
  common_commands jsonb DEFAULT '[]',     -- [{"label": "List files", "command": "..."}]

  -- Status
  status text NOT NULL DEFAULT 'unknown', -- working, degraded, down, unknown, decommissioned
  last_tested_at timestamptz,             -- when recipe was last verified
  last_tested_by text,                    -- who tested (claude, user, etc.)

  -- Gotchas & notes
  gotchas text[],                         -- common failure modes / warnings
  notes text,                             -- free-form notes

  -- Relationships
  depends_on uuid REFERENCES service_connections(id), -- e.g. Hostinger proxy → Almaca
  tags text[] DEFAULT '{}',               -- searchable tags: lan, remote, home-automation, etc.

  -- Meta
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE service_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_connections_read_authenticated"
  ON service_connections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_connections_write_admin"
  ON service_connections FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'staff')
    )
  );

-- Updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_service_connections_updated_at
  BEFORE UPDATE ON service_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Index for fast filtering
CREATE INDEX idx_service_connections_category ON service_connections(category);
CREATE INDEX idx_service_connections_status ON service_connections(status);
CREATE INDEX idx_service_connections_tags ON service_connections USING GIN(tags);

COMMENT ON TABLE service_connections IS 'Verified connection recipes for all external services. Each row is a copy-paste-ready recipe with Bitwarden credential references.';
