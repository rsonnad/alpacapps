-- The list query sorts (and filters) on COALESCE(started_at, ended_at), an
-- expression no plain column index can serve — so every page load scanned and
-- sorted the whole sessions table. These expression indexes match that ORDER BY
-- textually, turning the scan into an index range read of LIMIT rows.
-- idx_sessions_ended is redundant now that nothing orders by ended_at alone.
CREATE INDEX IF NOT EXISTS idx_sessions_sort
  ON sessions(COALESCE(started_at, ended_at) DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project_sort
  ON sessions(project, COALESCE(started_at, ended_at) DESC);

DROP INDEX IF EXISTS idx_sessions_ended;
