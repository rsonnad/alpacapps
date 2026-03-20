-- Seed ALL survey features into 3D Property Digital Twin
-- Source: 4Ward Land Surveying plat (Feb 2021) + 2025 update with containers/trailers
-- Development Description (10 structures) + survey imagery (pool, driveway)
--
-- Idempotent: checks existence before inserting. Safe to re-run.

-- =============================================================================
-- 1. PARCEL (ensure exists)
-- =============================================================================
INSERT INTO parcels (
  id, name, address, city, county, state, zip,
  legal_description, parcel_number, acreage, area_sqft,
  ground_elevation_ft, flood_zone, in_floodplain,
  houston_toad_habitat, esd_district,
  survey_date, survey_by, survey_rpls
) VALUES (
  1,
  '160 Still Forest Dr',
  '160 Still Forest Dr',
  'Cedar Creek', 'Bastrop', 'TX', '78612',
  'Lot 14-B, Block 6, Replat of Lots 14 & 15, Blue Bonnet Acres, Corrected Plat, Section One, City of Bastrop, Bastrop County, Texas',
  '44401',
  1.7348, 75133.00,
  NULL, -- elevation TBD from LiDAR
  'Zone X (unshaded)', false,
  false, 'BCESD #3',
  '2021-02-04', '4Ward Land Surveying', 'Jason Ward R.P.L.S. #5811'
) ON CONFLICT (id) DO UPDATE SET
  legal_description = EXCLUDED.legal_description,
  esd_district = EXCLUDED.esd_district,
  survey_date = EXCLUDED.survey_date,
  survey_by = EXCLUDED.survey_by,
  survey_rpls = EXCLUDED.survey_rpls,
  updated_at = NOW();

-- =============================================================================
-- 2. PARCEL EDGES (ensure all 4 exist)
-- =============================================================================
INSERT INTO parcel_edges (id, parcel_id, edge_side, edge_label, bearing, length_ft,
  is_road_frontage, road_name, road_classification, road_row_ft,
  has_easement, easement_type, easement_width_ft, setback_required_ft, setback_label)
VALUES
  (1, 1, 'N', 'North boundary — adjoining property', 'N26d20m31sE', 187.90,
   false, NULL, NULL, NULL,
   false, NULL, NULL, 10.00, 'property line'),
  (2, 1, 'S', 'South boundary — Still Forest Dr (CR 329)', 'S26d20m31sW', 188.00,
   true, 'Still Forest Dr (CR 329)', 'local_rural', 60.00,
   false, NULL, NULL, 20.00, 'Local Rural Road'),
  (3, 1, 'E', 'East boundary — 10'' P.U.E. & Building Line', 'S63d58m38sE', 399.90,
   false, NULL, NULL, NULL,
   true, 'P.U.E. and Building Line', 10.00, 10.00, 'property line'),
  (4, 1, 'W', 'West boundary — adjoining property', 'S20d17m19sW', 328.50,
   false, NULL, NULL, NULL,
   false, NULL, NULL, 10.00, 'property line')
ON CONFLICT (id) DO UPDATE SET
  bearing = EXCLUDED.bearing,
  length_ft = EXCLUDED.length_ft,
  edge_label = EXCLUDED.edge_label,
  is_road_frontage = EXCLUDED.is_road_frontage,
  road_name = EXCLUDED.road_name,
  road_classification = EXCLUDED.road_classification,
  road_row_ft = EXCLUDED.road_row_ft,
  has_easement = EXCLUDED.has_easement,
  easement_type = EXCLUDED.easement_type,
  easement_width_ft = EXCLUDED.easement_width_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_label = EXCLUDED.setback_label;

-- =============================================================================
-- 3. STRUCTURES — All 11 documented + Pool (12 total)
-- =============================================================================
-- Use upsert on id to be idempotent

-- 1. Main House (2-story stone & frame residence)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type, color,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  1, 1, 'Main House', 'house', 'mixed',
  40.00, 60.00, 24.00, 2, 2400.00,
  'stone_frame', 'gable', NULL,
  2, 'S', 50.00,
  20.00, true, 30.00,
  'permitted', false, true,
  4, 3, 2.0,
  true, true, true,
  1, '2-story stone & frame residence. Owner-occupied (1 BR) + lodging (2 guest BRs). Per survey: "2 STORY STONE/FRAME RESIDENCE"'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  stories = EXCLUDED.stories,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  is_permanent_structure = EXCLUDED.is_permanent_structure,
  guest_capacity = EXCLUDED.guest_capacity,
  bedrooms = EXCLUDED.bedrooms,
  bathrooms = EXCLUDED.bathrooms,
  has_plumbing = EXCLUDED.has_plumbing,
  has_electric = EXCLUDED.has_electric,
  has_hvac = EXCLUDED.has_hvac,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 2. Back House (1-story wood building)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  2, 1, '1-Story Wood Bldg (Back House)', 'outbuilding', 'lodging',
  NULL, NULL, 10.00, 1, NULL,
  'wood', 'gable',
  1, 'N', 30.00,
  10.00, true, 20.00,
  'permitted', false, true,
  2, 2, 1.0,
  true, true, true,
  2, 'Lodging — 2 guest bedrooms. Per survey plat. Size to be measured on site.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  height_ft = EXCLUDED.height_ft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  guest_capacity = EXCLUDED.guest_capacity,
  bedrooms = EXCLUDED.bedrooms,
  bathrooms = EXCLUDED.bathrooms,
  has_plumbing = EXCLUDED.has_plumbing,
  has_electric = EXCLUDED.has_electric,
  has_hvac = EXCLUDED.has_hvac,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 3. Big Trailer (10x42)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  3, 1, 'Big Trailer (10x42)', 'trailer_rv', 'lodging',
  10.00, 42.00, 10.00, 1, 420.00,
  'rv', 'flat',
  4, 'W', 1.00,
  10.00, false, -9.00,
  'violation', true, false,
  2, 1, 1.0,
  true, true, true,
  3, 'Studio rental unit. ~1 ft from W property line — VIOLATION (requires 10 ft, 15 ft for lodging). Needs relocation.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  area_sqft = EXCLUDED.area_sqft,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  guest_capacity = EXCLUDED.guest_capacity,
  bedrooms = EXCLUDED.bedrooms,
  bathrooms = EXCLUDED.bathrooms,
  notes = EXCLUDED.notes,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- 4. Red Container #1 (40x8)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type, color,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  4, 1, 'Red Container #1 (40x8)', 'container', 'storage',
  8.00, 40.00, 8.50, 1, 320.00,
  'steel_container', 'flat', 'red',
  4, 'W', 2.00,
  10.00, false, -8.00,
  'violation', true, false,
  4, 'Non-habitable storage. 2 ft from W property line — VIOLATION (requires 10 ft).'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  color = EXCLUDED.color,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 5. Red Container #2 (40x8)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type, color,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  5, 1, 'Red Container #2 (40x8)', 'container', 'storage',
  8.00, 40.00, 8.50, 1, 320.00,
  'steel_container', 'flat', 'red',
  4, 'W', 2.00,
  10.00, false, -8.00,
  'violation', true, false,
  5, 'Non-habitable storage. 2 ft from W property line — VIOLATION (requires 10 ft).'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  color = EXCLUDED.color,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 6. Container #3 (40x8)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  6, 1, 'Container #3 (40x8)', 'container', 'storage',
  8.00, 40.00, 8.50, 1, 320.00,
  'steel_container', 'flat',
  4, 'W', 5.00,
  10.00, false, -5.00,
  'violation', true, false,
  6, 'Non-habitable storage. 5 ft from W property line — VIOLATION (requires 10 ft).'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 7. Deck (attached to main house)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  7, 1, 'Deck', 'deck', 'amenity',
  30.00, 24.00, 3.00, 1, 720.00,
  'wood', 'none',
  4, 'W', 13.40,
  10.00, true, 3.40,
  'exempt', false, true,
  7, 'Outdoor guest recreation area, attached to main house. 30 x 24 ft per development description.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 8. Beige Container (40x8)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type, color,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  8, 1, 'Beige Container (40x8)', 'container', 'storage',
  8.00, 40.00, 8.50, 1, 320.00,
  'steel_container', 'flat', 'beige',
  2, 'S', 6.00,
  20.00, false, -14.00,
  'violation', true, false,
  8, 'Non-habitable storage. 6 ft from S (road) property line — VIOLATION (requires 20 ft road setback). 14 ft short.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  color = EXCLUDED.color,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 9. Bathroom Bldg (service building, under construction)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  9, 1, 'Bathroom Bldg (service building)', 'outbuilding', 'service',
  17.00, 17.00, 18.00, 2, 289.00,
  'wood', 'shed',
  3, 'E', 10.00,
  10.00, true, 0.00,
  'unpermitted', false, true,
  0, 0, 2.5,
  true, true, false,
  9, '1st floor: 2 toilets + 1 shower (complete). 2nd floor: storage (not yet finished). Construction started before IDP approval — must be disclosed to county.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  stories = EXCLUDED.stories,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  bathrooms = EXCLUDED.bathrooms,
  has_plumbing = EXCLUDED.has_plumbing,
  has_electric = EXCLUDED.has_electric,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 10. Small Trailer (7.4x20.4)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  10, 1, 'Small Trailer (7.4x20.4)', 'trailer_rv', 'lodging',
  7.40, 20.40, 9.00, 1, 150.96,
  'rv', 'flat',
  3, 'E', 7.00,
  10.00, false, -3.00,
  'violation', true, false,
  1, 1, 0.0,
  false, true, false,
  10, '1-bedroom rental unit. 7 ft from E property line — VIOLATION (requires 10 ft). Needs relocation.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  is_movable = EXCLUDED.is_movable,
  guest_capacity = EXCLUDED.guest_capacity,
  bedrooms = EXCLUDED.bedrooms,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 11. Sauna
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  has_plumbing, has_electric, has_hvac,
  display_order, notes
) VALUES (
  11, 1, 'Sauna', 'sauna', 'amenity',
  7.00, 7.00, 8.00, 1, 49.00,
  'wood', 'shed',
  4, 'W', 30.00,
  10.00, true, 20.00,
  'exempt', false, true,
  false, true, false,
  11, 'Guest wellness amenity. Under 25 SF exemption threshold? No — 49 SF. But well within setbacks.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  has_electric = EXCLUDED.has_electric,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 12. Swimming Pool (visible on survey plat — large oval feature center of property)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  has_plumbing, has_electric,
  display_order, notes
) VALUES (
  12, 1, 'Swimming Pool', 'other', 'amenity',
  20.00, 40.00, 5.00, 0, 628.00,
  'concrete', 'none',
  2, 'S', 40.00,
  20.00, true, 20.00,
  'permitted', false, true,
  true, true,
  12, 'In-ground swimming pool, oval shape ~40x20 ft. Clearly visible on 4Ward survey plat. Area estimated as ellipse (~628 SF). Includes pool equipment.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  structure_type = EXCLUDED.structure_type,
  use_type = EXCLUDED.use_type,
  width_ft = EXCLUDED.width_ft,
  length_ft = EXCLUDED.length_ft,
  height_ft = EXCLUDED.height_ft,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  roof_type = EXCLUDED.roof_type,
  nearest_edge_id = EXCLUDED.nearest_edge_id,
  nearest_edge_side = EXCLUDED.nearest_edge_side,
  nearest_edge_distance_ft = EXCLUDED.nearest_edge_distance_ft,
  setback_required_ft = EXCLUDED.setback_required_ft,
  setback_compliant = EXCLUDED.setback_compliant,
  setback_surplus_ft = EXCLUDED.setback_surplus_ft,
  permit_status = EXCLUDED.permit_status,
  has_plumbing = EXCLUDED.has_plumbing,
  has_electric = EXCLUDED.has_electric,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 13. Gravel Driveway / Parking Area (visible on survey — circular drive from Still Forest Dr)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  13, 1, 'Gravel Driveway & Parking', 'other', 'parking',
  20.00, 150.00, 0.00, 0, 3000.00,
  'gravel', 'none',
  2, 'S', 0.00,
  0.00, true, 0.00,
  'exempt', false, true,
  13, 'Circular gravel driveway from Still Forest Dr + guest parking area. ~3000 SF estimated. Impervious surface for county tracking. All-weather surface per lodging requirements (min 20 ft wide for two-way).'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 14. Septic Spray Field (OSSF #18725, per survey and county records)
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  nearest_edge_id, nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  display_order, notes
) VALUES (
  14, 1, 'Septic System (OSSF #18725)', 'utility', 'service',
  30.00, 50.00, 0.00, 0, 1500.00,
  'underground', 'none',
  3, 'E', 25.00,
  10.00, true, 15.00,
  'permitted', false, true,
  14, 'Jet J-500 aerobic system, 300 GPD, spray irrigation. Passed inspection 6/20/2004. OSSF permit #18725. Spray field area estimated. May need capacity upgrade for 10-person commercial lodging.'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  notes = EXCLUDED.notes,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- 15. Water Well
INSERT INTO structures (
  id, parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type,
  permit_status, is_movable, is_permanent_structure,
  has_plumbing, has_electric,
  display_order, notes
) VALUES (
  15, 1, 'Private Water Well', 'utility', 'service',
  3.00, 3.00, 2.00, 0, 9.00,
  'steel', 'none',
  'permitted', false, true,
  true, true,
  15, 'Private water well serving the property. Groundwater district certification pending for commercial lodging use (10 persons max).'
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  notes = EXCLUDED.notes,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- Reset sequence to max id
SELECT setval('structures_id_seq', (SELECT MAX(id) FROM structures));

-- =============================================================================
-- 4. STRUCTURE SETBACKS — measured distance from each structure to nearest edge
-- =============================================================================
-- Only insert for nearest edge (the one that matters for compliance)
INSERT INTO structure_setbacks (structure_id, edge_id, measured_distance_ft, required_distance_ft, measured_by, notes)
VALUES
  -- Main House → S edge (50 ft, needs 20)
  (1, 2, 50.00, 20.00, '4Ward survey estimate', 'Well within road setback'),
  -- Back House → N edge (30 ft, needs 10)
  (2, 1, 30.00, 10.00, '4Ward survey estimate', 'Compliant'),
  -- Big Trailer → W edge (1 ft, needs 10)
  (3, 4, 1.00, 10.00, 'Site measurement', 'VIOLATION — 9 ft short. Must relocate.'),
  -- Red Container #1 → W edge (2 ft, needs 10)
  (4, 4, 2.00, 10.00, 'Site measurement', 'VIOLATION — 8 ft short. Must relocate.'),
  -- Red Container #2 → W edge (2 ft, needs 10)
  (5, 4, 2.00, 10.00, 'Site measurement', 'VIOLATION — 8 ft short. Must relocate.'),
  -- Container #3 → W edge (5 ft, needs 10)
  (6, 4, 5.00, 10.00, 'Site measurement', 'VIOLATION — 5 ft short. Must relocate.'),
  -- Deck → W edge (13.4 ft, needs 10)
  (7, 4, 13.40, 10.00, 'Site measurement', 'Compliant with 3.4 ft surplus'),
  -- Beige Container → S edge (6 ft, needs 20)
  (8, 2, 6.00, 20.00, 'Site measurement', 'VIOLATION — 14 ft short of road setback. Must relocate.'),
  -- Bathroom Bldg → E edge (10 ft, needs 10)
  (9, 3, 10.00, 10.00, 'Site measurement', 'Exactly at setback line. Compliant but tight.'),
  -- Small Trailer → E edge (7 ft, needs 10)
  (10, 3, 7.00, 10.00, 'Site measurement', 'VIOLATION — 3 ft short. Must relocate.'),
  -- Sauna → W edge (30 ft, needs 10)
  (11, 4, 30.00, 10.00, '4Ward survey estimate', 'Compliant with 20 ft surplus'),
  -- Pool → S edge (40 ft, needs 20)
  (12, 2, 40.00, 20.00, '4Ward survey estimate', 'Well within road setback'),
  -- Septic → E edge (25 ft, needs 10)
  (14, 3, 25.00, 10.00, 'Estimate from survey', 'Compliant')
ON CONFLICT (structure_id, edge_id) DO UPDATE SET
  measured_distance_ft = EXCLUDED.measured_distance_ft,
  required_distance_ft = EXCLUDED.required_distance_ft,
  measured_by = EXCLUDED.measured_by,
  notes = EXCLUDED.notes;

-- =============================================================================
-- 5. PROPERTY UTILITIES
-- =============================================================================
INSERT INTO property_utilities (id, parcel_id, utility_type, provider, status, system_type, capacity, location_description, availability_letter_status, notes)
VALUES
  (1, 1, 'water', 'Private Well', 'active', 'Private water well', NULL,
   'On property — exact location TBD from survey', 'pending',
   'Groundwater district certification needed for 10-person commercial lodging.'),
  (2, 1, 'wastewater', 'TCEQ / Bastrop County', 'active', 'Aerobic OSSF (JET INC J-500)', '300 GPD',
   'Spray field east side of property', 'pending',
   'OSSF #18725. Passed 6/20/2004. May need capacity upgrade for commercial use. Licensed septic designer evaluation required.'),
  (3, 1, 'electric', 'Bluebonnet Electric Cooperative', 'active', 'Grid electric', NULL,
   'Meter on south side near road', 'pending',
   'Availability letter needed confirming capacity for development.'),
  (4, 1, 'fire_protection', NULL, 'pending', NULL, NULL,
   'TBD — near internal road', 'pending',
   'No current fire suppression. 2,500-gallon non-metallic tank REQUIRED per Bastrop County lodging/RV infrastructure requirements. Est. cost $1.5k-$3k.')
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  status = EXCLUDED.status,
  system_type = EXCLUDED.system_type,
  capacity = EXCLUDED.capacity,
  location_description = EXCLUDED.location_description,
  availability_letter_status = EXCLUDED.availability_letter_status,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- =============================================================================
-- 6. ZONING RULES — Bastrop County (unincorporated)
-- =============================================================================
INSERT INTO zoning_rules (id, jurisdiction, district_name, rule_source,
  front_setback_ft, side_setback_ft, rear_setback_ft,
  road_setback_local_rural_ft, road_setback_ranch_ft, road_setback_collector_ft, road_setback_arterial_ft,
  lodging_road_row_setback_ft, lodging_property_line_setback_ft, lodging_internal_road_setback_ft, lodging_unit_separation_ft,
  exempt_structure_sqft, container_behind_primary, container_screening_required, container_screening_height_ft,
  notes)
VALUES (
  1, 'Bastrop County', 'Unincorporated Rural',
  'Bastrop County Development Services — Lodging/RV Park Infrastructure Requirements (2022-09-12 Court Approved)',
  20.00, 10.00, 10.00,
  20.00, 15.00, 25.00, 30.00,
  25.00, 15.00, 10.00, 20.00,
  25.00, true, true, 6.0,
  'Unincorporated Bastrop County. Deed restrictions from Blue Bonnet Acres subdivision may also apply. County Dev Services: (512) 581-7176.'
) ON CONFLICT (id) DO UPDATE SET
  district_name = EXCLUDED.district_name,
  rule_source = EXCLUDED.rule_source,
  front_setback_ft = EXCLUDED.front_setback_ft,
  side_setback_ft = EXCLUDED.side_setback_ft,
  rear_setback_ft = EXCLUDED.rear_setback_ft,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- =============================================================================
-- 7. IMPERVIOUS COVER — track all impervious surfaces for county compliance
-- =============================================================================
INSERT INTO impervious_cover (id, parcel_id, structure_id, surface_type, area_sqft, material, notes)
VALUES
  (1, 1, 4, 'structure', 320.00, 'steel', 'Red Container #1 footprint'),
  (2, 1, 5, 'structure', 320.00, 'steel', 'Red Container #2 footprint'),
  (3, 1, 6, 'structure', 320.00, 'steel', 'Container #3 footprint'),
  (4, 1, 8, 'structure', 320.00, 'steel', 'Beige Container footprint'),
  (5, 1, 1, 'structure', 2400.00, 'stone_frame', 'Main House footprint (ground floor)'),
  (6, 1, 7, 'structure', 720.00, 'wood', 'Deck footprint'),
  (7, 1, 12, 'other', 628.00, 'concrete', 'Swimming pool + surround'),
  (8, 1, 13, 'driveway', 3000.00, 'gravel', 'Gravel driveway & parking area'),
  (9, 1, 9, 'structure', 289.00, 'concrete', 'Bathroom Bldg footprint')
ON CONFLICT (id) DO UPDATE SET
  area_sqft = EXCLUDED.area_sqft,
  material = EXCLUDED.material,
  notes = EXCLUDED.notes;
