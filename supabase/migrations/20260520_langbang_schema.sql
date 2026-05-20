-- =============================================
-- langbang schema
-- =============================================
-- Carves out a dedicated namespace for the langbang Android app
-- (github.com/rsonnad/langbang) so its tables don't collide with
-- the alpacapps `public` schema. Same Supabase project, same anon
-- key, separate logical scope.
--
-- NOTE: creating the schema is not enough — PostgREST won't serve
-- it until "langbang" is added to the exposed schemas list in
-- Supabase Studio: Project Settings → API → Exposed schemas
-- (the default is "public, graphql_public"; add "langbang"). The
-- supabase-kt client on Android sets `defaultSchema = "langbang"`
-- so requests land here once the schema is exposed.

CREATE SCHEMA IF NOT EXISTS langbang;

-- Make the schema reachable to API roles. Object-level grants are
-- still required per-table; this just lets the roles see into the
-- schema at all.
GRANT USAGE ON SCHEMA langbang TO anon, authenticated, service_role;

-- Future tables created in this schema inherit sensible defaults.
ALTER DEFAULT PRIVILEGES IN SCHEMA langbang
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA langbang
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA langbang
  GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;

-- Anonymous reads only; writes require an authenticated session.
ALTER DEFAULT PRIVILEGES IN SCHEMA langbang
  GRANT SELECT ON TABLES TO anon;

COMMENT ON SCHEMA langbang IS
  'Namespace for the langbang Android language-learning app. Shares this Supabase project with alpacapps but is isolated from the public schema. See github.com/rsonnad/langbang.';
