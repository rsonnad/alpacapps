-- Outhouse: HAOS migration from Govee Cloud
-- Migrates 6 Govee H601F bars from Govee Cloud API to HAOS Govee integration
-- Creates HAOS groups: outhouse_ceiling (4), outhouse_stalls (2), outhouse_all (6)
-- Same pattern as Garage Mahal migration (20260328)

-- 1. Insert per-bar inventory into lighting_devices
INSERT INTO lighting_devices (device_name, room, socket_number, ha_entity_id, device_brand, device_model, protocol, mac_address, sku, form_factor, is_active)
VALUES
  ('Outhouse Main 1',    'Outhouse', 1, 'light.outhousemain1',        'Govee', 'H601F', 'wifi_govee', '73:E5:DC:B4:D9:4D:29:88', 'H601F', 'light_bar', true),
  ('Outhouse Main 2',    'Outhouse', 2, 'light.outhousemain2',        'Govee', 'H601F', 'wifi_govee', '12:DC:DC:B4:D9:4C:A4:84', 'H601F', 'light_bar', true),
  ('Outhouse Main 3',    'Outhouse', 3, 'light.outhousemain3',        'Govee', 'H601F', 'wifi_govee', '13:BC:DC:B4:D9:4D:47:D4', 'H601F', 'light_bar', true),
  ('Outhouse Main 4',    'Outhouse', 4, 'light.outhousemain4',        'Govee', 'H601F', 'wifi_govee', '43:F2:DC:B4:D9:4D:1C:DC', 'H601F', 'light_bar', true),
  ('Outhouse Stall Left','Outhouse', 5, 'light.outhouse_stall_left',  'Govee', 'H601F', 'wifi_govee', '4B:F5:DC:B4:D9:59:28:10', 'H601F', 'light_bar', true),
  ('Outhouse Stall Right','Outhouse',6, 'light.outhouse_stall_right', 'Govee', 'H601F', 'wifi_govee', '1E:D4:DC:B4:D9:5A:11:34', 'H601F', 'light_bar', true);

-- 2. Switch outhouse from govee_cloud to home_assistant
UPDATE lighting_group_targets
SET backend = 'home_assistant',
    target_id = 'light.outhouse_all',
    metadata = '{"entity_ceiling":"light.outhouse_ceiling","entity_stalls":"light.outhouse_stalls","device_count":6,"sku_individual":"H601F"}'::jsonb,
    updated_at = now()
WHERE group_id = (SELECT id FROM lighting_groups WHERE key = 'outhouse')
  AND backend = 'govee_cloud';

-- 3. HAOS configuration.yaml groups (applied manually via SSH):
-- light.outhouse_ceiling  (unique_id: outhouse_ceiling_lights)  → outhousemain1-4
-- light.outhouse_stalls   (unique_id: outhouse_stalls_lights)   → outhouse_stall_left, outhouse_stall_right
-- light.outhouse_all      (unique_id: outhouse_all_lights)      → all 6 bars
