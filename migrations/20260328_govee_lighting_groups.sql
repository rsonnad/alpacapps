-- Add Govee-controlled rooms to unified lighting system
-- Garage Mahal (16 H601F bars, 1 group), Outhouse (6 H601F bars, 1 group),
-- Spartan sub-rooms (Cedar Chamber, Fishbowl, Tea Lounge — 3 groups)

-- 1. Insert lighting groups
INSERT INTO lighting_groups (key, name, area, display_order, is_active)
VALUES
  ('garage_mahal', 'Garage Mahal', 'Garage Mahal', 50, true),
  ('outhouse', 'Outhouse', 'Outhouse', 51, true),
  ('spartan_cedar', 'Cedar Chamber', 'Spartan', 52, true),
  ('spartan_fishbowl', 'Fishbowl', 'Spartan', 53, true),
  ('spartan_lounge', 'Spartan Tea Lounge', 'Spartan', 54, true)
ON CONFLICT (key) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  area = EXCLUDED.area,
  display_order = EXCLUDED.display_order;

-- 2. Insert govee_cloud targets pointing to Govee group device_ids
-- Each group controls all individual bars in that Govee group at once
INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT g.id, 'govee_cloud', '13452517',
       '{"sku":"SameModeGroup","device_count":16,"sku_individual":"H601F"}'::jsonb, true
FROM lighting_groups g WHERE g.key = 'garage_mahal'
ON CONFLICT DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT g.id, 'govee_cloud', '13166268',
       '{"sku":"SameModeGroup","device_count":6,"sku_individual":"H601F"}'::jsonb, true
FROM lighting_groups g WHERE g.key = 'outhouse'
ON CONFLICT DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT g.id, 'govee_cloud', '12001251',
       '{"sku":"SameModeGroup","device_count":4,"sku_individual":"H601F"}'::jsonb, true
FROM lighting_groups g WHERE g.key = 'spartan_cedar'
ON CONFLICT DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT g.id, 'govee_cloud', '12411702',
       '{"sku":"SameModeGroup","device_count":4,"sku_individual":"H601F"}'::jsonb, true
FROM lighting_groups g WHERE g.key = 'spartan_fishbowl'
ON CONFLICT DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT g.id, 'govee_cloud', '12411623',
       '{"sku":"SameModeGroup","device_count":4,"sku_individual":"H601A"}'::jsonb, true
FROM lighting_groups g WHERE g.key = 'spartan_lounge'
ON CONFLICT DO NOTHING;

-- 3. Deactivate old garage_tuya group (replaced by garage_mahal govee group)
UPDATE lighting_groups SET is_active = false WHERE key = 'garage_tuya';
