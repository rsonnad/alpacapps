CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  model TEXT,
  started_at TEXT,
  ended_at TEXT DEFAULT (datetime('now')),
  duration_mins INTEGER,
  summary TEXT,
  transcript TEXT,
  token_count INTEGER,
  cost_usd REAL,
  tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

-- Expression indexes matching the list query's ORDER BY / WHERE on
-- COALESCE(started_at, ended_at); without them every listing full-scans.
CREATE INDEX IF NOT EXISTS idx_sessions_sort
  ON sessions(COALESCE(started_at, ended_at) DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_sort
  ON sessions(project, COALESCE(started_at, ended_at) DESC);
