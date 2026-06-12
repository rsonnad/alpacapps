-- Page access defaults are open by default.
-- Explicit rows can still set registered, role-based, or private visibility.

ALTER TABLE page_access_settings
  ALTER COLUMN visibility SET DEFAULT 'public';
