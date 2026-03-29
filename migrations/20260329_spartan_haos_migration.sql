-- Spartan Trailer: HAOS migration from Govee Cloud
-- Migrates 12 Govee H601F bars across 3 spaces from Govee Cloud API to HAOS Govee integration
-- Creates HAOS groups: spartan_tea_lounge (6), spartan_fishbowl (2), spartan_cedar_chamber (4), spartan_all (12)
-- Same pattern as Outhouse migration (20260329)

-- 1. Insert per-bar inventory into lighting_devices
INSERT INTO lighting_devices (device_name, room, socket_number, ha_entity_id, device_brand, device_model, protocol, sku, form_factor, is_active)
VALUES
  ('Spartan Main 1',   'Spartan Tea Lounge',    1, 'light.spartan_main_1',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Main 2',   'Spartan Tea Lounge',    2, 'light.spartan_main_2',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Main 3',   'Spartan Tea Lounge',    3, 'light.spartan_main_3',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Main 4',   'Spartan Tea Lounge',    4, 'light.spartan_main_4',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Main 5',   'Spartan Tea Lounge',    5, 'light.spartan_main_5',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Main 6',   'Spartan Tea Lounge',    6, 'light.spartan_main_6',   'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Lilbed 1', 'Spartan Fishbowl',      1, 'light.spartan_lilbed_1', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Lilbed 2', 'Spartan Fishbowl',      2, 'light.spartan_lilbed_2', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Bigbed 1', 'Spartan Cedar Chamber', 1, 'light.spartan_bigbed_1', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Bigbed 2', 'Spartan Cedar Chamber', 2, 'light.spartan_bigbed_2', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Bigbed 3', 'Spartan Cedar Chamber', 3, 'light.spartan_bigbed_3', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true),
  ('Spartan Bigbed 4', 'Spartan Cedar Chamber', 4, 'light.spartan_bigbed_4', 'Govee', 'H601F', 'wifi_govee', 'H601F', 'light_bar', true);

-- 2. Switch all 3 Spartan rooms from govee_cloud to home_assistant
UPDATE lighting_group_targets
SET backend = 'home_assistant',
    target_id = 'light.spartan_cedar_chamber',
    metadata = '{"device_count":4,"sku_individual":"H601F"}'::jsonb,
    updated_at = now()
WHERE group_id = (SELECT id FROM lighting_groups WHERE key = 'spartan_cedar')
  AND backend = 'govee_cloud';

UPDATE lighting_group_targets
SET backend = 'home_assistant',
    target_id = 'light.spartan_fishbowl',
    metadata = '{"device_count":2,"sku_individual":"H601F"}'::jsonb,
    updated_at = now()
WHERE group_id = (SELECT id FROM lighting_groups WHERE key = 'spartan_fishbowl')
  AND backend = 'govee_cloud';

UPDATE lighting_group_targets
SET backend = 'home_assistant',
    target_id = 'light.spartan_tea_lounge',
    metadata = '{"device_count":6,"sku_individual":"H601F"}'::jsonb,
    updated_at = now()
WHERE group_id = (SELECT id FROM lighting_groups WHERE key = 'spartan_lounge')
  AND backend = 'govee_cloud';

-- 3. HAOS configuration.yaml groups (applied manually via SSH):
-- light.spartan_tea_lounge     (unique_id: spartan_tea_lounge_lights)     → spartan_main_1-6
-- light.spartan_fishbowl       (unique_id: spartan_fishbowl_lights)       → spartan_lilbed_1-2
-- light.spartan_cedar_chamber  (unique_id: spartan_cedar_chamber_lights)  → spartan_bigbed_1-4
-- light.spartan_all            (unique_id: spartan_all_lights)            → 12 bars + roof strip

-- 4. Additional Spartan devices (strip lights + porch)
INSERT INTO lighting_devices (device_name, room, ha_entity_id, device_brand, device_model, protocol, form_factor, is_active)
VALUES
  ('Spartan Roof Strip',       'Spartan Trailer', 'light.spartan_roof',        'Govee', 'H6061', 'wifi_govee', 'led_strip', true),
  ('Spartan UpDown Wall Strip','Spartan Trailer', 'light.spartan_updown_wall', 'Govee', 'H6061', 'wifi_govee', 'led_strip', true),
  ('Spartan Porch Right',      'Spartan Trailer', 'light.spartan_porch_right', 'Govee', 'H6061', 'wifi_govee', 'led_strip', true);
-- Spartan Porch Left: pending WiFi pairing → light.spartan_porch_left
