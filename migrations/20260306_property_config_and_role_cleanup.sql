-- Migration: property_config table + demo role standardization
-- Applied: 2026-03-06

-- ============================================
-- 1. Standardize 'demon' → 'demo' role
-- ============================================
UPDATE app_users SET role = 'demo' WHERE role = 'demon';
UPDATE user_invitations SET role = 'demo' WHERE role = 'demon';
UPDATE role_permissions SET role = 'demo' WHERE role = 'demon'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role = 'demo' AND rp2.permission_key = role_permissions.permission_key
  );
DELETE FROM role_permissions WHERE role = 'demon';

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public', 'prospect'));

ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_role_check;
ALTER TABLE user_invitations ADD CONSTRAINT user_invitations_role_check
  CHECK (role IN ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public', 'prospect'));

-- ============================================
-- 2. Create property_config table
-- ============================================
CREATE TABLE IF NOT EXISTS property_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES app_users(id)
);

ALTER TABLE property_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read property_config" ON property_config
  FOR SELECT USING (true);

CREATE POLICY "Admin can update property_config" ON property_config
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  );

CREATE POLICY "Admin can insert property_config" ON property_config
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  );

-- Seed with AlpacApps defaults
INSERT INTO property_config (id, config) VALUES (1, '{
  "property": {
    "name": "Alpaca Playhouse",
    "short_name": "AlpacApps",
    "tagline": "We put the AI into Alpacas",
    "address": "160 Still Forest Dr, Cedar Creek, TX 78612",
    "city": "Cedar Creek",
    "state": "TX",
    "zip": "78612",
    "country": "US",
    "latitude": 30.13,
    "longitude": -97.46,
    "timezone": "America/Chicago"
  },
  "domain": {
    "primary": "alpacaplayhouse.com",
    "github_pages": "rsonnad.github.io/alpacapps",
    "camera_proxy": "cam.alpacaplayhouse.com"
  },
  "email": {
    "team": "team@alpacaplayhouse.com",
    "admin_gmail": "alpacaplayhouse@gmail.com",
    "notifications_from": "notifications@alpacaplayhouse.com",
    "noreply_from": "noreply@alpacaplayhouse.com",
    "automation": "alpacaautomatic@gmail.com"
  },
  "payment": {
    "zelle_email": "alpacaplayhouse@gmail.com",
    "venmo_handle": "@AlpacaPlayhouse"
  },
  "ai_assistant": {
    "name": "PAI",
    "full_name": "Prompt Alpaca Intelligence",
    "personality": "the AI assistant for the property",
    "email_from": "pai@alpacaplayhouse.com"
  },
  "wifi": {
    "network_name": "Black Rock City"
  },
  "mobile_app": {
    "name": "Alpaca Playhouse",
    "id": "com.alpacaplayhouse.app"
  }
}'::jsonb) ON CONFLICT (id) DO NOTHING;
