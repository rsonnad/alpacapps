-- GenAlpaca SSO Authentication Migrations
-- Run these in your Supabase SQL Editor in order

-- ============================================
-- STEP 1: Create app_users table
-- ============================================
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('admin', 'staff', 'resident', 'associate')),
  invited_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_users_auth_user_id ON app_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);

-- ============================================
-- STEP 2: Create user_invitations table
-- ============================================
CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('admin', 'staff', 'resident', 'associate')),
  invited_by UUID REFERENCES app_users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);

-- ============================================
-- STEP 3: Create trigger function for new user signup
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  invitation_record user_invitations%ROWTYPE;
BEGIN
  -- Check if there's a pending invitation for this email
  SELECT * INTO invitation_record
  FROM user_invitations
  WHERE email = NEW.email
    AND status = 'pending'
    AND expires_at > NOW()
  LIMIT 1;

  IF invitation_record.id IS NOT NULL THEN
    -- Create app_user record with invited role
    INSERT INTO app_users (auth_user_id, email, display_name, role, invited_by)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      invitation_record.role,
      invitation_record.invited_by
    );

    -- Mark invitation as accepted
    UPDATE user_invitations
    SET status = 'accepted'
    WHERE id = invitation_record.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================
-- STEP 4: Enable RLS on new tables
-- ============================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 5: RLS Policies for app_users
-- ============================================

-- Users can read their own record
CREATE POLICY "Users can read own record" ON app_users
  FOR SELECT
  USING (auth.uid() = auth_user_id);

-- Admins can read all user records
CREATE POLICY "Admins can read all users" ON app_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Admins can insert new users
CREATE POLICY "Admins can insert users" ON app_users
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Admins can update users
CREATE POLICY "Admins can update users" ON app_users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Admins can delete other users (not themselves)
CREATE POLICY "Admins can delete other users" ON app_users
  FOR DELETE
  USING (
    auth_user_id != auth.uid() AND
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- ============================================
-- STEP 6: RLS Policies for user_invitations
-- ============================================

-- Admins can do everything with invitations
CREATE POLICY "Admins can manage invitations" ON user_invitations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- ============================================
-- STEP 7: Update RLS Policies for existing tables
-- ============================================

-- First, drop old overly permissive policies if they exist
DROP POLICY IF EXISTS "Public read access" ON spaces;
DROP POLICY IF EXISTS "Public read access" ON assignments;
DROP POLICY IF EXISTS "Public read access" ON people;
DROP POLICY IF EXISTS "Public read access" ON photos;
DROP POLICY IF EXISTS "Public read access" ON photo_spaces;
DROP POLICY IF EXISTS "Public read access" ON photo_requests;

-- SPACES: Public sees listed + secret (for direct links), staff sees all
CREATE POLICY "Public and staff read spaces" ON spaces
  FOR SELECT
  USING (
    -- Public: listed non-secret spaces for browsing
    (is_listed = true AND is_secret = false AND can_be_dwelling = true)
    -- Secret spaces accessible by direct ID (for shareable links)
    OR (is_secret = true AND can_be_dwelling = true)
    -- Staff/Admin: see everything
    OR EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid())
  );

-- Only admins can modify spaces
CREATE POLICY "Admins can modify spaces" ON spaces
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- ASSIGNMENTS: Only staff/admin can read
CREATE POLICY "Staff can read assignments" ON assignments
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Admins can modify assignments" ON assignments
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- PEOPLE: Only staff/admin can read (contains personal info)
CREATE POLICY "Staff can read people" ON people
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Admins can modify people" ON people
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- PHOTOS: Public can read (they appear on listings)
CREATE POLICY "Public read photos" ON photos
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can modify photos" ON photos
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- PHOTO_SPACES: Public can read
CREATE POLICY "Public read photo_spaces" ON photo_spaces
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can modify photo_spaces" ON photo_spaces
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- PHOTO_REQUESTS: Only staff/admin can see
CREATE POLICY "Staff can read photo_requests" ON photo_requests
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Admins can modify photo_requests" ON photo_requests
  FOR INSERT UPDATE DELETE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- ============================================
-- STEP 8: Update storage bucket policies
-- ============================================
-- Run these in Storage > Policies in Supabase dashboard
-- Or use the SQL below (adjust bucket name if different)

-- Keep public read for housephotos
-- DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow public deletes" ON storage.objects;

-- CREATE POLICY "Admins can upload photos" ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'housephotos' AND
--     EXISTS (
--       SELECT 1 FROM app_users
--       WHERE auth_user_id = auth.uid()
--       AND role = 'admin'
--     )
--   );

-- CREATE POLICY "Admins can delete photos" ON storage.objects
--   FOR DELETE
--   USING (
--     bucket_id = 'housephotos' AND
--     EXISTS (
--       SELECT 1 FROM app_users
--       WHERE auth_user_id = auth.uid()
--       AND role = 'admin'
--     )
--   );

-- ============================================
-- STEP 9: Create your first admin user
-- ============================================
-- After you've:
-- 1. Set up Google OAuth in Supabase
-- 2. Signed in with your Google account once
-- Run this to make yourself an admin:

-- First, find your auth.users ID:
-- SELECT id, email FROM auth.users WHERE email = 'your-email@gmail.com';

-- Then insert yourself as admin:
-- INSERT INTO app_users (auth_user_id, email, display_name, role)
-- VALUES ('YOUR-AUTH-USER-UUID-HERE', 'your-email@gmail.com', 'Your Name', 'admin');

-- ============================================
-- DONE! Next steps:
-- 1. Go to Supabase Dashboard > Authentication > Providers
-- 2. Enable Google provider
-- 3. Set up OAuth credentials in Google Cloud Console
-- 4. Configure redirect URLs in Supabase
-- 5. Deploy the app and test!
-- ============================================
