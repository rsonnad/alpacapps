-- Populate parcel boundary geometry from Bastrop County GIS
-- Source: ArcGIS FeatureServer prop_id=44401, queried 2026-03-20
-- https://services3.arcgis.com/wdTkTU0MdZbNBEZy/arcgis/rest/services/Parcel/FeatureServer/0
--
-- County data: 4-vertex quadrilateral (75,123 sqft, 1.725 acres)
-- Survey data: 5-vertex polygon with SE jog (75,133 sqft, 1.7348 acres)
-- The county simplified the boundary by absorbing the SE jog.

-- 1. Parcel boundary
UPDATE parcels SET
  boundary_geom = ST_GeomFromText(
    'POLYGON((-97.4595314 30.1310274, -97.4598027 30.1305679, -97.4609315 30.1310636, -97.4606605 30.1315233, -97.4595314 30.1310274))',
    4326
  ),
  parcel_number = '44401',
  legal_description = 'Lot 14-B, Block 6, Bluebonnet Acres, Corrected Plat, Section One',
  acreage = 1.7348,
  area_sqft = 75133,
  ground_elevation_ft = 490,
  flood_zone = 'Zone X (unshaded)',
  in_floodplain = FALSE,
  houston_toad_habitat = FALSE,
  esd_district = 'BCESD #3',
  survey_date = '2021-02-04',
  survey_by = '4Ward Land Surveying',
  survey_rpls = '5811',
  updated_at = NOW()
WHERE id = 1;

-- 2. Parcel edges (4 sides)
-- Clear existing edges first
DELETE FROM parcel_edges WHERE parcel_id = 1;

-- South edge — Still Forest Dr (CR 329) road frontage
INSERT INTO parcel_edges (
  parcel_id, edge_side, edge_label, bearing, length_ft, edge_geom,
  is_road_frontage, road_name, road_classification, road_row_ft,
  setback_required_ft, setback_label
) VALUES (
  1, 'S', 'South boundary — Still Forest Dr (CR 329)',
  'N27d03m04sE', 188.43,
  ST_GeomFromText('LINESTRING(-97.4598027 30.1305679, -97.4595314 30.1310274)', 4326),
  TRUE, 'Still Forest Dr (CR 329)', 'local_rural', 60,
  20, 'Local Rural Road'
);

-- West edge — adjoining property
INSERT INTO parcel_edges (
  parcel_id, edge_side, edge_label, bearing, length_ft, edge_geom,
  setback_required_ft, setback_label
) VALUES (
  1, 'W', 'West boundary — adjoining property',
  'N63d05m52sW', 399.89,
  ST_GeomFromText('LINESTRING(-97.4598027 30.1305679, -97.4609315 30.1310636)', 4326),
  10, 'property line'
);

-- North edge — adjoining property
INSERT INTO parcel_edges (
  parcel_id, edge_side, edge_label, bearing, length_ft, edge_geom,
  setback_required_ft, setback_label
) VALUES (
  1, 'N', 'North boundary — adjoining property',
  'N27d00m55sE', 188.46,
  ST_GeomFromText('LINESTRING(-97.4609315 30.1310636, -97.4606605 30.1315233)', 4326),
  10, 'property line'
);

-- East edge — P.U.E. (Public Utility Easement)
INSERT INTO parcel_edges (
  parcel_id, edge_side, edge_label, bearing, length_ft, edge_geom,
  setback_required_ft, setback_label,
  has_easement, easement_type, easement_width_ft
) VALUES (
  1, 'E', 'East boundary — P.U.E. and Building Line',
  'S63d04m40sE', 400.00,
  ST_GeomFromText('LINESTRING(-97.4606605 30.1315233, -97.4595314 30.1310274)', 4326),
  10, 'property line + P.U.E.',
  TRUE, 'P.U.E. and Building Line', 10
);

-- 3. Structure footprint geometries
-- Computed from survey pixel positions → GPS via affine transform from 4 GCPs
-- Pixel positions measured from survey-ward-2025.png (2731x1821)
-- GCPs: 4 parcel corners (Bastrop County GIS → survey corner pixels)

-- Main House (2-Story Stone & Frame Residence)
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4603652 30.1313660, -97.4602382 30.1314307, -97.4602817 30.1315160, -97.4604087 30.1314514, -97.4603652 30.1313660))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4603235 30.1314410)', 4326),
  area_sqft = 1575.0,
  updated_at = NOW()
WHERE name ILIKE '%Main House%' AND parcel_id = 1;

-- 1-Story Wood Bldg (Back House)
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4607264 30.1312846, -97.4606418 30.1313277, -97.4606666 30.1313765, -97.4607512 30.1313334, -97.4607264 30.1312846))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4606965 30.1313306)', 4326),
  area_sqft = 600.0,
  updated_at = NOW()
WHERE name ILIKE '%1-Story Wood Bldg%' AND parcel_id = 1;

-- Deck (+ Hot Tub area)
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4605829 30.1312102, -97.4605377 30.1312332, -97.4605527 30.1312625, -97.4605978 30.1312395, -97.4605829 30.1312102))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4605678 30.1312364)', 4326),
  area_sqft = 192.0,
  updated_at = NOW()
WHERE name ILIKE '%Deck%' AND parcel_id = 1;

-- Sauna
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4606652 30.1312041, -97.4606427 30.1312156, -97.4606526 30.1312351, -97.4606752 30.1312236, -97.4606652 30.1312041))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4606589 30.1312196)', 4326),
  area_sqft = 64.0,
  updated_at = NOW()
WHERE name ILIKE '%Sauna%' AND parcel_id = 1;

-- Big Trailer (10x42) — VIOLATION: 1ft from west edge (requires 10ft)
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4599547 30.1311157, -97.4599691 30.1311439, -97.4600715 30.1310917, -97.4600572 30.1310635, -97.4599547 30.1311157))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4600131 30.1311037)', 4326),
  area_sqft = 420.0,
  updated_at = NOW()
WHERE name ILIKE '%Big Trailer%' AND parcel_id = 1;

-- Red Container #1 (40x8) — VIOLATION: 2ft from west edge
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4601205 30.1311761, -97.4601320 30.1311986, -97.4602296 30.1311489, -97.4602181 30.1311264, -97.4601205 30.1311761))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4601751 30.1311625)', 4326),
  area_sqft = 320.0,
  updated_at = NOW()
WHERE name ILIKE '%Red Container #1%' AND parcel_id = 1;

-- Red Container #2 (40x8) — VIOLATION: 2ft from west edge
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4600756 30.1311682, -97.4600871 30.1311907, -97.4601847 30.1311410, -97.4601732 30.1311185, -97.4600756 30.1311682))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4601301 30.1311546)', 4326),
  area_sqft = 320.0,
  updated_at = NOW()
WHERE name ILIKE '%Red Container #2%' AND parcel_id = 1;

-- Container #3 (40x8) — VIOLATION: 5ft from west edge
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4601868 30.1311974, -97.4601983 30.1312200, -97.4602958 30.1311703, -97.4602843 30.1311477, -97.4601868 30.1311974))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4602413 30.1311838)', 4326),
  area_sqft = 320.0,
  updated_at = NOW()
WHERE name ILIKE '%Container #3%' AND parcel_id = 1;

-- Beige Container (40x8) — VIOLATION: 6ft from south edge (requires 20ft)
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4595712 30.1310297, -97.4595487 30.1310412, -97.4595984 30.1311388, -97.4596209 30.1311273, -97.4595712 30.1310297))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4595848 30.1310843)', 4326),
  area_sqft = 320.0,
  updated_at = NOW()
WHERE name ILIKE '%Beige Container%' AND parcel_id = 1;

-- Bathroom Bldg — setback compliant but unpermitted
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4602262 30.1313330, -97.4601980 30.1313473, -97.4602129 30.1313766, -97.4602411 30.1313622, -97.4602262 30.1313330))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4602196 30.1313548)', 4326),
  area_sqft = 120.0,
  updated_at = NOW()
WHERE name ILIKE '%Bathroom Bldg%' AND parcel_id = 1;

-- Small Trailer (7.5x20.5) — VIOLATION: 7ft from east edge
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON((-97.4601123 30.1313519, -97.4601230 30.1313731, -97.4601730 30.1313476, -97.4601623 30.1313265, -97.4601123 30.1313519))', 4326),
  centroid_geom = ST_GeomFromText('POINT(-97.4601426 30.1313498)', 4326),
  area_sqft = 153.8,
  updated_at = NOW()
WHERE name ILIKE '%Small Trailer%' AND parcel_id = 1;

-- 4. Auto-recompute setback distances from PostGIS geometry
-- More accurate than manual measurements — uses ST_Distance on actual footprints
UPDATE structures s SET
  nearest_edge_distance_ft = sub.min_dist_ft,
  nearest_edge_side = sub.nearest_side,
  setback_required_ft = CASE sub.nearest_side
    WHEN 'S' THEN 20  ELSE 10
  END,
  setback_compliant = sub.min_dist_ft >= CASE sub.nearest_side WHEN 'S' THEN 20 ELSE 10 END,
  setback_surplus_ft = sub.min_dist_ft - CASE sub.nearest_side WHEN 'S' THEN 20 ELSE 10 END
FROM (
  SELECT DISTINCT ON (s2.id)
    s2.id AS structure_id,
    e.edge_side AS nearest_side,
    ST_Distance(s2.footprint_geom::geography, e.edge_geom::geography) * 3.28084 AS min_dist_ft
  FROM structures s2
  JOIN parcel_edges e ON e.parcel_id = s2.parcel_id
  WHERE s2.footprint_geom IS NOT NULL AND e.edge_geom IS NOT NULL
  ORDER BY s2.id, ST_Distance(s2.footprint_geom::geography, e.edge_geom::geography)
) sub
WHERE s.id = sub.structure_id;
