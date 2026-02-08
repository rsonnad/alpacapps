# DB Migration: Add owner_name and make to tesla_vehicles

Run this SQL against the Supabase database (connection string is in `scripts/bump-version.sh`).

## 1. Add columns

```sql
ALTER TABLE tesla_vehicles
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS make TEXT DEFAULT 'Tesla';
```

## 2. Populate existing vehicles

All 6 current vehicles are Teslas owned by Haydn. Update owner_name from the linked account and set make = 'Tesla':

```sql
UPDATE tesla_vehicles v
SET owner_name = a.owner_name,
    make = 'Tesla'
FROM tesla_accounts a
WHERE v.account_id = a.id
  AND v.owner_name IS NULL;
```

## 3. Verify

```sql
SELECT id, name, make, model, year, owner_name FROM tesla_vehicles ORDER BY display_order;
```

Expected: all 6 vehicles should have `make = 'Tesla'` and `owner_name` populated.

## 4. Delete this file after running

This file is temporary. Delete it after the migration is complete:
```bash
rm TEMP-DB-MIGRATION.md
git add TEMP-DB-MIGRATION.md && git commit -m "Remove temp migration file" && git push
```
