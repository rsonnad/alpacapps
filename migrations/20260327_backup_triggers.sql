-- 20260327_backup_triggers.sql
-- Manual backup trigger queue — UI inserts pending rows, poller on Almaca executes them.

CREATE TABLE IF NOT EXISTS backup_triggers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service      TEXT NOT NULL,                          -- e.g. 'supabase-db', 'cloudflare-r2', 'cloudflare-d1', 'github-repo', 'home-assistant'
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'pending',        -- pending | running | completed | failed
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes        TEXT,
  result       JSONB                                   -- optional details from the backup run
);

-- Columns added after initial creation
ALTER TABLE backup_triggers ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE backup_triggers ADD COLUMN IF NOT EXISTS result JSONB;

CREATE INDEX IF NOT EXISTS idx_backup_triggers_status ON backup_triggers (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_backup_triggers_requested ON backup_triggers (requested_at DESC);

ALTER TABLE backup_triggers ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view all triggers (both machines see same state)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read backup triggers"
    ON backup_triggers FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authenticated users can insert new triggers (Backup Now button)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can insert backup triggers"
    ON backup_triggers FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can update triggers (poller marks running/completed/failed)
DO $$ BEGIN
  CREATE POLICY "Service role can update backup triggers"
    ON backup_triggers FOR UPDATE TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can also insert (for internal use)
DO $$ BEGIN
  CREATE POLICY "Service role can insert backup triggers"
    ON backup_triggers FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
