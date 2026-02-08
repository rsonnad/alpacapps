# DB Migration: Rename tesla_vehicles → vehicles, add owner/drivers

Run this SQL against the Supabase database (connection string is in `scripts/bump-version.sh`).

**Run each section in order.** The table rename must happen first.

## 1. Rename table + columns

```sql
-- Rename table
ALTER TABLE tesla_vehicles RENAME TO vehicles;

-- Rename model → vehicle_model
ALTER TABLE vehicles RENAME COLUMN model TO vehicle_model;

-- Add vehicle_make column
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_make TEXT DEFAULT 'Tesla';

-- Add owner_id (FK → app_users)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES app_users(id);
```

## 2. Create vehicle_drivers junction table

```sql
CREATE TABLE IF NOT EXISTS vehicle_drivers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, app_user_id)
);

-- RLS
ALTER TABLE vehicle_drivers ENABLE ROW LEVEL SECURITY;

-- Residents can see drivers
CREATE POLICY "Residents can view vehicle drivers"
  ON vehicle_drivers FOR SELECT
  USING (true);

-- Admins can manage drivers
CREATE POLICY "Admins can manage vehicle drivers"
  ON vehicle_drivers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.auth_user_id = auth.uid()
        AND app_users.role = 'admin'
    )
  );
```

## 3. Populate existing vehicles

```sql
-- All existing vehicles are Teslas
UPDATE vehicles SET vehicle_make = 'Tesla' WHERE vehicle_make IS NULL;

-- Link owner_id to Haydn's app_user (adjust email if needed)
UPDATE vehicles
SET owner_id = (SELECT id FROM app_users WHERE email = 'hrsonnad@gmail.com' LIMIT 1)
WHERE owner_id IS NULL;
```

## 4. Update RLS policies that reference old table name

```sql
-- Check for any policies referencing tesla_vehicles
-- The RENAME should carry policies forward, but verify:
SELECT policyname, tablename FROM pg_policies WHERE tablename = 'vehicles';
```

## 5. Verify

```sql
SELECT id, name, vehicle_make, vehicle_model, year, owner_id
FROM vehicles ORDER BY display_order;

SELECT v.name, v.vehicle_make, v.vehicle_model, au.display_name AS owner
FROM vehicles v
LEFT JOIN app_users au ON au.id = v.owner_id
ORDER BY v.display_order;
```

## 6. Delete this file after running

```bash
rm TEMP-DB-MIGRATION.md
```
