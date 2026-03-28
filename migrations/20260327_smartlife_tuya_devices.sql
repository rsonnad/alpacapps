-- Migration: Add SmartLife/Tuya devices to unified lighting system
-- Date: 2026-03-27
-- Description: Adds 'tuya_cloud' backend type and creates lighting groups + targets
--   for all 32 SmartLife/Tuya devices across 17 physical areas

-- Step 1: Add tuya_cloud to the backend CHECK constraint
ALTER TABLE lighting_group_targets
  DROP CONSTRAINT lighting_group_targets_backend_check;

ALTER TABLE lighting_group_targets
  ADD CONSTRAINT lighting_group_targets_backend_check
  CHECK (backend = ANY (ARRAY['home_assistant', 'wiz_proxy', 'govee_cloud', 'tuya_cloud']));

-- Step 2: Create lighting groups for SmartLife areas
-- Indoor areas first (display_order 7-8), then outdoor (9+)
INSERT INTO lighting_groups (id, key, name, area, display_order, is_active) VALUES
  -- Indoor
  (gen_random_uuid(), 'dining_room',     'Dining Room',           'Dining Room',    7,  false),
  (gen_random_uuid(), 'skyloft_bar',     'Skyloft Bar',           'Skyloft',        8,  true),
  -- Outdoor - structures
  (gen_random_uuid(), 'grill',           'Grill Lights',          'Grill',          10, true),
  (gen_random_uuid(), 'veranda',         'Veranda Lights',        'Veranda',        11, false),
  (gen_random_uuid(), 'garage_tuya',     'Garage Light',          'Garage Mahal',   12, false),
  -- Outdoor - sauna/spa
  (gen_random_uuid(), 'sauna_floods',    'Sauna Floodlights',     'Sauna',          15, true),
  (gen_random_uuid(), 'spa_back',        'Spa Back Floodlights',  'Spa',            16, false),
  (gen_random_uuid(), 'spa_fence',       'Spa Fence Lights',      'Spa',            17, false),
  -- Outdoor - facade/front
  (gen_random_uuid(), 'facade',          'Facade Floodlights',    'House Exterior', 20, false),
  (gen_random_uuid(), 'gate_flood',      'Gate Floodlight',       'Front Gate',     21, false),
  (gen_random_uuid(), 'front_fence',     'Front Fence Lights',    'Front Gate',     22, false),
  -- Outdoor - pond
  (gen_random_uuid(), 'pond',            'Pond Lights',           'Pond',           25, false),
  -- Outdoor - fences
  (gen_random_uuid(), 'north_fence',     'North Fence Lights',    'North Fence',    30, false),
  (gen_random_uuid(), 'cabins_fence',    'Cabins Fence Lights',   'Cabins',         31, false),
  -- Outdoor - spartan
  (gen_random_uuid(), 'spartan_floods',  'Spartan Floodlights',   'Spartan',        35, false),
  -- Utility
  (gen_random_uuid(), 'plant_shelf',     'Plant Light Shelf',     'Indoor',         40, false);

-- Step 3: Create targets for each SmartLife device
-- Each target references the Tuya device_id from SmartLife

-- Skyloft Bar (3 GU10 bulbs — all online)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'skyloft_bar'),
   'tuya_cloud', 'eb7c2e2652329ff6cfuzvd',
   '{"name": "Skyloft Bar Light 2", "product": "Smart GU10 Light Bulb", "status": "online"}'::jsonb, true),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'skyloft_bar'),
   'tuya_cloud', 'ebf88bedf1475f7186vj9p',
   '{"name": "Skyloft Bar Light 1", "product": "Smart GU10 Light Bulb", "status": "online"}'::jsonb, true),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'skyloft_bar'),
   'tuya_cloud', 'eb0a46324e9dd058fcc0ez',
   '{"name": "Skyloft Bar Light 3", "product": "Smart GU10 Light Bulb", "status": "online"}'::jsonb, true);

-- Grill (2 RGBC lights — online)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'grill'),
   'tuya_cloud', '3401786010521cf62e0e',
   '{"name": "Grill Right", "product": "RGBC WIFI Smart light-DIP", "status": "online"}'::jsonb, true),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'grill'),
   'tuya_cloud', '34017860483fda0f8eef',
   '{"name": "Grill Left", "product": "RGBC WIFI Smart light-DIP", "status": "online"}'::jsonb, true);

-- Sauna Floodlights (2 — online)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'sauna_floods'),
   'tuya_cloud', 'eb6db4252afdfae0c2ehlz',
   '{"name": "Sauna Left", "product": "Smart Floodlight", "status": "online"}'::jsonb, true),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'sauna_floods'),
   'tuya_cloud', 'eb5675c98829e89548zvya',
   '{"name": "Sauna Right", "product": "Smart Floodlight", "status": "online"}'::jsonb, true);

-- Spa Back Floodlights (2 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'spa_back'),
   'tuya_cloud', 'eb00a03de552bfa67d8mik',
   '{"name": "Spa Back Right", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'spa_back'),
   'tuya_cloud', 'eb701d6131d9f6213e4d3m',
   '{"name": "Spa Back Left", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false);

-- Spa Fence (1 string light — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'spa_fence'),
   'tuya_cloud', 'eb9e1700ee30d57b75xl0z',
   '{"name": "Spa Fence", "product": "HVS String Lights-RGBW W&B", "status": "offline"}'::jsonb, false);

-- Facade Floodlights (4)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'facade'),
   'tuya_cloud', 'ebe0b2b6fe9780ac6ejwdm',
   '{"name": "Facade 1", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'facade'),
   'tuya_cloud', 'eba4b07cc7b3a42b15zxnl',
   '{"name": "Facade 2", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'facade'),
   'tuya_cloud', 'eb6f01e655c19e10ebyfq4',
   '{"name": "Facade 3", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'facade'),
   'tuya_cloud', 'ebc4c730318fbc8122z0u7',
   '{"name": "Facade 4", "product": "Smart Floodlight", "status": "online"}'::jsonb, true);

-- Dining Room (6 bulbs — all offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb7ad0014fa9e84fcep2w1',
   '{"name": "Dining Room 1", "product": "A60 Smart Bulb RGBW WiFi", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb1865913dbd0b2f0agxzz',
   '{"name": "Dining Room 2", "product": "A60 Smart Bulb RGBW WiFi", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb5f807e67da8d8861wjlo',
   '{"name": "Dining Room 3", "product": "A60 Smart Bulb RGBW WiFi", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb08fa994d917ee3een7uj',
   '{"name": "Dining Room 4", "product": "A60 Smart Bulb RGBCW Wifi", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb2e13a87e358b29bcuu60',
   '{"name": "Dining Room 5", "product": "A60 Smart Bulb RGBCW Wifi", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'dining_room'),
   'tuya_cloud', 'eb482649e13b6ae28esf2d',
   '{"name": "Dining Room 6", "product": "A60 Smart Bulb RGBCW Wifi", "status": "offline"}'::jsonb, false);

-- Gate Floodlight (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'gate_flood'),
   'tuya_cloud', 'eb61b2168b29486bd9i5ai',
   '{"name": "Gate Flood", "product": "Smart Floodlight-RGBCW", "status": "offline"}'::jsonb, false);

-- Front Fence (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'front_fence'),
   'tuya_cloud', 'eb7caef7f65b6f6829glco',
   '{"name": "Front Fence 1", "product": "LED STRING", "status": "offline"}'::jsonb, false);

-- Pond Lights (3 — all offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'pond'),
   'tuya_cloud', 'eb23a27320ed725aedo3ke',
   '{"name": "Pond Flood", "product": "Smart Floodlight", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'pond'),
   'tuya_cloud', 'ebc9862e1345b539b4rik3',
   '{"name": "pond water", "product": "Smart Floodlight-RGBCW", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'pond'),
   'tuya_cloud', 'eb7efd5f8a19b349ceeel6',
   '{"name": "Pond Tree", "product": "Fairy Light Controller", "status": "offline", "note": "Also exists in govee_devices as Pond tree (H70C5)"}'::jsonb, false);

-- North Fence (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'north_fence'),
   'tuya_cloud', 'eb5b2cbd3888c7075a5em3',
   '{"name": "North Fence", "product": "XMcosy S14 RGBW String Lights", "status": "offline"}'::jsonb, false);

-- Cabins Fence (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'cabins_fence'),
   'tuya_cloud', 'eb95d4ef003750afbckg9w',
   '{"name": "Cabins Fence", "product": "HVS String Lights-RGBW W&B", "status": "offline"}'::jsonb, false);

-- Spartan Floodlights (2 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'spartan_floods'),
   'tuya_cloud', 'eb4a17d29c58ca308ahgwd',
   '{"name": "Spartan Flood A", "product": "Smart Floodlight-RGBCW", "status": "offline"}'::jsonb, false),
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'spartan_floods'),
   'tuya_cloud', 'eb90877c6fe81c77ca3m4p',
   '{"name": "Spartan Flood C", "product": "Smart Floodlight-RGBCW", "status": "offline"}'::jsonb, false);

-- Garage Light (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'garage_tuya'),
   'tuya_cloud', 'eb9c943a481eb74564waw1',
   '{"name": "Garage", "product": "Galaxy AI-Plus", "status": "offline"}'::jsonb, false);

-- Veranda (1 — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'veranda'),
   'tuya_cloud', 'eb874229e544796d1btbsc',
   '{"name": "Veranda", "product": "XMcosy S14 String Lights-White W&B", "status": "offline"}'::jsonb, false);

-- Plant Light Shelf (smart plug — offline)
INSERT INTO lighting_group_targets (id, group_id, backend, target_id, metadata, is_active) VALUES
  (gen_random_uuid(), (SELECT id FROM lighting_groups WHERE key = 'plant_shelf'),
   'tuya_cloud', 'eb670d17c75a34f376m6lr',
   '{"name": "plant light shelf", "product": "Smart Plug", "status": "offline", "note": "Controls power to grow light shelf"}'::jsonb, false);
