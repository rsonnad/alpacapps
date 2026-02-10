-- Migration 019: Add demo role for product demos (view-only, redacted sensitive data)
-- Run in Supabase SQL Editor after 018.
-- Does not change behavior for existing roles.

-- ============================================
-- 1. Extend app_users.role to include demo (and oracle/public if missing)
-- ============================================
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public'));

-- ============================================
-- 2. Extend user_invitations.role to include demo
-- ============================================
ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_role_check;
ALTER TABLE user_invitations ADD CONSTRAINT user_invitations_role_check
  CHECK (role IN ('admin', 'staff', 'resident', 'associate', 'demo', 'oracle', 'public'));

-- ============================================
-- 3. Grant view-only permissions to demo role (no edit/manage)
-- ============================================
INSERT INTO role_permissions (role, permission_key)
SELECT 'demo', key FROM (
  VALUES
    ('view_spaces'),
    ('view_rentals'),
    ('view_events'),
    ('view_media'),
    ('view_sms'),
    ('view_hours'),
    ('view_faq'),
    ('view_voice'),
    ('view_todo'),
    ('view_users'),
    ('view_passwords'),
    ('view_settings'),
    ('view_templates'),
    ('view_accounting'),
    ('view_lighting'),
    ('view_music'),
    ('view_cameras'),
    ('view_climate'),
    ('view_laundry'),
    ('view_cars'),
    ('view_profile'),
    ('use_pai')
) AS v(key)
ON CONFLICT (role, permission_key) DO NOTHING;
