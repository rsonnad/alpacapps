-- Issue reporting kit: D1 (SQLite) schema.
-- Apply with: npx wrangler d1 execute issues --local --file=schema.sql   (drop --local for production)

-- One row per app install. The app makes its own random key on first upload
-- (trust on first use); only the key's SHA-256 is stored.
CREATE TABLE IF NOT EXISTS installs (
  install_id   TEXT PRIMARY KEY,          -- a UUID the app generates once
  key_hash     TEXT NOT NULL,             -- sha256(install key), hex
  created_at   INTEGER NOT NULL,          -- epoch ms
  last_seen_at INTEGER NOT NULL,
  app_version  TEXT,
  device_model TEXT,
  os_version   TEXT,
  ip_hash      TEXT,                      -- keyed daily hash of the address that registered it (rate limit only)
  blocked      INTEGER NOT NULL DEFAULT 0 -- set to 1 to refuse an abusive install
);
CREATE INDEX IF NOT EXISTS installs_ip ON installs(ip_hash, created_at);

-- One row per bug report or feature request.
CREATE TABLE IF NOT EXISTS issues (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id      TEXT NOT NULL REFERENCES installs(install_id),
  client_issue_id INTEGER NOT NULL,       -- the app's own local id: makes uploads idempotent
  kind            TEXT NOT NULL,          -- bug | feature
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new', -- new | seen | in_progress | fixed | wont_fix | duplicate
  team_note       TEXT,                   -- shown to the reporter in the app
  team_updated_at INTEGER,                -- when status/team_note last changed (drives /updates)
  created_at      INTEGER NOT NULL,       -- when it was filed on the device
  received_at     INTEGER NOT NULL,       -- when the server got it
  app_version     TEXT,
  build_type      TEXT,
  device_model    TEXT,
  os_name         TEXT,                   -- android | ios | macos | web
  os_version      TEXT,
  screen          TEXT,                   -- which screen the user was on
  context_json    TEXT NOT NULL DEFAULT '{}',
  log_json        TEXT NOT NULL DEFAULT '[]',
  image_count     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (install_id, client_issue_id)
);
CREATE INDEX IF NOT EXISTS issues_received ON issues(received_at);
CREATE INDEX IF NOT EXISTS issues_status   ON issues(status, id);
CREATE INDEX IF NOT EXISTS issues_install  ON issues(install_id, received_at);
CREATE INDEX IF NOT EXISTS issues_updates  ON issues(install_id, team_updated_at, id);

-- Screenshots, already downscaled on the device (JPEG/PNG, <= 1 MB each, up to 5).
CREATE TABLE IF NOT EXISTS images (
  issue_id   INTEGER NOT NULL REFERENCES issues(id),
  idx        INTEGER NOT NULL,            -- 1..5
  mime       TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  bytes      BLOB NOT NULL,
  PRIMARY KEY (issue_id, idx)
);
