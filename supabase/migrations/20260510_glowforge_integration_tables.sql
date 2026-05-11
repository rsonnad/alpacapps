-- Glowforge read-only status monitoring.
-- Adds the missing production tables for the glowforge-control edge function.

CREATE TABLE IF NOT EXISTS public.glowforge_config (
  id integer PRIMARY KEY CHECK (id = 1),
  is_active boolean NOT NULL DEFAULT true,
  test_mode boolean NOT NULL DEFAULT false,
  session_cookies text,
  session_expires_at timestamptz,
  last_error text,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.glowforge_config (id, is_active, test_mode)
VALUES (1, true, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.glowforge_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id text NOT NULL UNIQUE,
  name text NOT NULL,
  machine_type text,
  space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  lan_ip text,
  notes text,
  last_state jsonb,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_glowforge_machines_active_order
  ON public.glowforge_machines (is_active, display_order);

ALTER TABLE public.glowforge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glowforge_machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS glowforge_config_admin_select ON public.glowforge_config;
CREATE POLICY glowforge_config_admin_select
  ON public.glowforge_config
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'oracle')
    )
  );

DROP POLICY IF EXISTS glowforge_machines_active_select ON public.glowforge_machines;
CREATE POLICY glowforge_machines_active_select
  ON public.glowforge_machines
  FOR SELECT
  TO authenticated
  USING (is_active = true);

REVOKE ALL ON public.glowforge_config FROM anon, authenticated;
REVOKE ALL ON public.glowforge_machines FROM anon, authenticated;
GRANT SELECT (id, is_active, test_mode, last_error, last_synced_at, updated_at)
  ON public.glowforge_config TO authenticated;
REVOKE SELECT (session_cookies, session_expires_at)
  ON public.glowforge_config FROM authenticated;
GRANT SELECT ON public.glowforge_machines TO authenticated;
GRANT ALL ON public.glowforge_config TO service_role;
GRANT ALL ON public.glowforge_machines TO service_role;

INSERT INTO public.permissions (key, label, description, category, sort_order)
VALUES
  ('view_glowforge', 'View Glowforge', 'View Glowforge laser cutter status', 'devices', 100),
  ('admin_glowforge_settings', 'Admin Glowforge Settings', 'Manage Glowforge laser cutter integration settings', 'devices', 101)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
VALUES
  ('resident', 'view_glowforge'),
  ('staff', 'view_glowforge'),
  ('demo', 'view_glowforge'),
  ('admin', 'view_glowforge'),
  ('oracle', 'view_glowforge'),
  ('admin', 'admin_glowforge_settings'),
  ('oracle', 'admin_glowforge_settings')
ON CONFLICT (role, permission_key) DO NOTHING;
