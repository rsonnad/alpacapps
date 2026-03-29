-- Garage Mahal: Physical position mapping + HAOS migration
-- Maps 16 Govee H601F bars to physical ceiling/DJ positions
-- Switches garage_mahal from govee_cloud → home_assistant backend
-- Creates sub-groups: garage_ceiling (12), garage_dj (4), garage_opener (2)

-- 1. Update govee_devices with physical position names
UPDATE govee_devices SET name = 'Garage Ceiling 11' WHERE device_id = '2A:D4:DC:B4:D9:58:3A:8C';
UPDATE govee_devices SET name = 'Garage Ceiling 7'  WHERE device_id = '0C:EC:DC:B4:D9:59:46:E8';
UPDATE govee_devices SET name = 'Garage Ceiling 5'  WHERE device_id = '26:E2:DC:B4:D9:58:39:5C';
UPDATE govee_devices SET name = 'Garage Ceiling 8'  WHERE device_id = '7F:85:98:88:E0:FB:90:F0';
UPDATE govee_devices SET name = 'Garage Ceiling 6'  WHERE device_id = '2B:D0:DC:B4:D9:58:3A:C8';
UPDATE govee_devices SET name = 'Garage Ceiling 10' WHERE device_id = 'C1:61:DC:B4:D9:58:1A:88';
UPDATE govee_devices SET name = 'Garage Ceiling 12' WHERE device_id = '16:45:DC:B4:D9:58:48:28';
UPDATE govee_devices SET name = 'Garage Ceiling 9'  WHERE device_id = '0E:46:DC:B4:D9:58:24:2C';
UPDATE govee_devices SET name = 'Garage DJ 1'       WHERE device_id = 'D9:83:DC:B4:D9:56:91:24';
UPDATE govee_devices SET name = 'Garage Ceiling 3'  WHERE device_id = '18:EB:DC:06:75:48:DC:98';
UPDATE govee_devices SET name = 'Garage Ceiling 2'  WHERE device_id = '8C:4B:DC:B4:D9:5A:06:C8';
UPDATE govee_devices SET name = 'Garage Ceiling 1'  WHERE device_id = '32:EF:DC:B4:D9:5A:07:7C';
UPDATE govee_devices SET name = 'Garage Ceiling 4'  WHERE device_id = '1C:90:DC:06:75:4D:C1:E8';
UPDATE govee_devices SET name = 'Garage DJ 4'       WHERE device_id = 'E9:59:DC:B4:D9:59:42:50';
UPDATE govee_devices SET name = 'Garage DJ 3'       WHERE device_id = '79:A5:DC:B4:D9:5A:12:14';
UPDATE govee_devices SET name = 'Garage DJ 2'       WHERE device_id = '1D:28:DC:B4:D9:56:8D:EC';

-- 2. Insert per-bulb inventory into lighting_devices
INSERT INTO lighting_devices (device_name, room, ha_entity_id, device_brand, device_model, protocol, mac_address, is_active)
VALUES
  ('Garage Ceiling 1',  'Garage Mahal', 'light.garage_mahal_12', 'Govee', 'H601F', 'wifi_govee', '32:EF:DC:B4:D9:5A:07:7C', true),
  ('Garage Ceiling 2',  'Garage Mahal', 'light.garage_mahal_11', 'Govee', 'H601F', 'wifi_govee', '8C:4B:DC:B4:D9:5A:06:C8', true),
  ('Garage Ceiling 3',  'Garage Mahal', 'light.garage_mahal_10', 'Govee', 'H601F', 'wifi_govee', '18:EB:DC:06:75:48:DC:98', true),
  ('Garage Ceiling 4',  'Garage Mahal', 'light.garage_mahal_13', 'Govee', 'H601F', 'wifi_govee', '1C:90:DC:06:75:4D:C1:E8', true),
  ('Garage Ceiling 5',  'Garage Mahal', 'light.garage_mahal_3',  'Govee', 'H601F', 'wifi_govee', '26:E2:DC:B4:D9:58:39:5C', true),
  ('Garage Ceiling 6',  'Garage Mahal', 'light.garage_mahal_5',  'Govee', 'H601F', 'wifi_govee', '2B:D0:DC:B4:D9:58:3A:C8', true),
  ('Garage Ceiling 7',  'Garage Mahal', 'light.garage_mahal_2',  'Govee', 'H601F', 'wifi_govee', '0C:EC:DC:B4:D9:59:46:E8', true),
  ('Garage Ceiling 8',  'Garage Mahal', 'light.garage_mahal_4',  'Govee', 'H601F', 'wifi_govee', '7F:85:98:88:E0:FB:90:F0', true),
  ('Garage Ceiling 9',  'Garage Mahal', 'light.garage_mahal_8',  'Govee', 'H601F', 'wifi_govee', '0E:46:DC:B4:D9:58:24:2C', true),
  ('Garage Ceiling 10', 'Garage Mahal', 'light.garage_mahal_6',  'Govee', 'H601F', 'wifi_govee', 'C1:61:DC:B4:D9:58:1A:88', true),
  ('Garage Ceiling 11', 'Garage Mahal', 'light.garage_mahal_1',  'Govee', 'H601F', 'wifi_govee', '2A:D4:DC:B4:D9:58:3A:8C', true),
  ('Garage Ceiling 12', 'Garage Mahal', 'light.garage_mahal_7',  'Govee', 'H601F', 'wifi_govee', '16:45:DC:B4:D9:58:48:28', true),
  ('Garage DJ 1',       'Garage Mahal', 'light.garage_mahal_9',  'Govee', 'H601F', 'wifi_govee', 'D9:83:DC:B4:D9:56:91:24', true),
  ('Garage DJ 2',       'Garage Mahal', 'light.garage_mahal_r3', 'Govee', 'H601F', 'wifi_govee', '1D:28:DC:B4:D9:56:8D:EC', true),
  ('Garage DJ 3',       'Garage Mahal', 'light.garage_mahal_r2', 'Govee', 'H601F', 'wifi_govee', '79:A5:DC:B4:D9:5A:12:14', true),
  ('Garage DJ 4',       'Garage Mahal', 'light.garage_mahal_r1', 'Govee', 'H601F', 'wifi_govee', 'E9:59:DC:B4:D9:59:42:50', true);

-- 3. Switch garage_mahal from govee_cloud to home_assistant
DELETE FROM lighting_group_targets
WHERE group_id = (SELECT id FROM lighting_groups WHERE key = 'garage_mahal')
  AND backend = 'govee_cloud';

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT id, 'home_assistant', 'group.garage_all',
  '{"entity_count":16,"sub_groups":["group.garage_ceiling","group.garage_dj"]}'::jsonb, true
FROM lighting_groups WHERE key = 'garage_mahal'
ON CONFLICT (group_id, backend, target_id) DO NOTHING;

-- 4. Create sub-groups
INSERT INTO lighting_groups (key, name, area, display_order, is_active)
VALUES
  ('garage_ceiling', 'Garage Ceiling', 'Garage Mahal', 55, true),
  ('garage_dj',      'Garage DJ',      'Garage Mahal', 56, true),
  ('garage_opener',  'Garage Opener',  'Garage Mahal', 57, true)
ON CONFLICT (key) DO UPDATE SET
  is_active = true, name = EXCLUDED.name, area = EXCLUDED.area, display_order = EXCLUDED.display_order;

-- 5. Add HA targets for sub-groups
INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT id, 'home_assistant', 'group.garage_ceiling', '{"entity_count":12}'::jsonb, true
FROM lighting_groups WHERE key = 'garage_ceiling'
ON CONFLICT (group_id, backend, target_id) DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT id, 'home_assistant', 'group.garage_dj', '{"entity_count":4}'::jsonb, true
FROM lighting_groups WHERE key = 'garage_dj'
ON CONFLICT (group_id, backend, target_id) DO NOTHING;

INSERT INTO lighting_group_targets (group_id, backend, target_id, metadata, is_active)
SELECT id, 'home_assistant', 'group.garage_opener',
  '{"entity_count":2,"entities":["light.garage_opener_1","light.garage_opener_2"]}'::jsonb, true
FROM lighting_groups WHERE key = 'garage_opener'
ON CONFLICT (group_id, backend, target_id) DO NOTHING;
