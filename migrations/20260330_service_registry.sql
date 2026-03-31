-- Service Registry: inventory of all software services running on infrastructure
-- Enables cross-project discovery ("what can I use on Almaca/Alpuca/Hostinger?")

CREATE TABLE IF NOT EXISTS service_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity
  name text NOT NULL,                      -- e.g. "image-gen worker"
  slug text NOT NULL UNIQUE,               -- e.g. "image-gen" (URL-safe key)
  description text,                        -- what it does

  -- Location
  host_name text NOT NULL,                 -- "almaca", "alpuca", "hostinger"
  host_ip text,                            -- e.g. "192.168.1.74"
  port integer,                            -- listening port (null if background worker)
  protocol text,                           -- http, https, ws, ssh, systemd, launchd
  process_manager text,                    -- systemd, launchd, docker, cron
  unit_name text,                          -- systemd unit or launchd label

  -- Invocation
  invoke_command text,                     -- how to call it (curl, ssh, etc.)
  invoke_url text,                         -- public or LAN URL if exposed
  params_schema jsonb DEFAULT '{}',        -- accepted parameters

  -- Auth (Bitwarden references only)
  auth_required boolean DEFAULT false,
  bw_item_name text,                       -- Bitwarden item for token/key
  bw_field_name text,                      -- field within the item

  -- Classification
  category text NOT NULL DEFAULT 'worker', -- worker, api, proxy, monitor, backup, cron, vm, ai
  tags text[] DEFAULT '{}',                -- searchable: lan, internet, camera, audio, ai, etc.
  shareable boolean DEFAULT true,          -- safe for other projects to call?

  -- Runtime
  runtime text,                            -- node, python, deno, go, qemu, docker
  status text DEFAULT 'active',            -- active, inactive, failed, deprecated
  last_seen_at timestamptz,

  -- Meta
  depends_on uuid REFERENCES service_registry(id),
  notes text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: any authenticated user can read, admin can write
ALTER TABLE service_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_registry_read_all"
  ON service_registry FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_registry_write_admin"
  ON service_registry FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
      AND app_users.role IN ('admin', 'staff')
    )
  );

CREATE TRIGGER set_service_registry_updated_at
  BEFORE UPDATE ON service_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_service_registry_host ON service_registry(host_name);
CREATE INDEX idx_service_registry_category ON service_registry(category);
CREATE INDEX idx_service_registry_status ON service_registry(status);
CREATE INDEX idx_service_registry_tags ON service_registry USING GIN(tags);

COMMENT ON TABLE service_registry IS 'Software services running on infrastructure. Queryable inventory for cross-project discovery.';
