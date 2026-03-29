-- Claude Tasks: queue for email→Claude Code sessions on local machines
CREATE TABLE IF NOT EXISTS claude_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'email',
  source_id TEXT,                          -- e.g. resend email ID
  target_machine TEXT NOT NULL DEFAULT 'alpuca',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'review', 'approved', 'in_progress', 'completed', 'failed', 'rejected')),
  prompt TEXT NOT NULL,                    -- what to tell Claude
  subject TEXT,                            -- email subject or task title
  from_address TEXT,                       -- who sent it
  result TEXT,                             -- Claude's output
  error TEXT,                              -- error message if failed
  risk_assessment JSONB,                   -- Gemini risk evaluation result
  approved_by UUID,                        -- admin who approved (if review flow)
  approved_at TIMESTAMPTZ,                 -- when approved
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  session_id TEXT                          -- Claude session ID
);

CREATE INDEX IF NOT EXISTS idx_claude_tasks_status ON claude_tasks(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_claude_tasks_target ON claude_tasks(target_machine, status);

ALTER TABLE claude_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY claude_tasks_admin_all ON claude_tasks FOR ALL USING (
  EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
);
CREATE POLICY claude_tasks_service ON claude_tasks FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE claude_tasks IS 'Tasks queued for Claude Code sessions on local machines (Alpuca, etc). Populated by email webhooks, consumed by pollers.';
