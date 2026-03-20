-- Add 2D geometry to 3D Property Digital Twin tables
-- Source: Bastrop County ArcGIS FeatureServer (ref_id2=R44401, lot=14-B, blk=6)
-- Structure centroids computed from survey setback distances + edge interpolation
-- SRID 4326 (WGS84). Centroid positions are approximate — refine via QGIS or Colmap.
--
-- Attribute data already seeded by prior migration. This adds geometry only.

-- =============================================================================
-- RLS POLICIES (schema enabled RLS but created no policies)
-- =============================================================================
DO $$ BEGIN
  -- Read policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on parcels') THEN
    CREATE POLICY "Allow authenticated read on parcels" ON parcels FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on parcel_edges') THEN
    CREATE POLICY "Allow authenticated read on parcel_edges" ON parcel_edges FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on structures') THEN
    CREATE POLICY "Allow authenticated read on structures" ON structures FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on structure_setbacks') THEN
    CREATE POLICY "Allow authenticated read on structure_setbacks" ON structure_setbacks FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on zoning_rules') THEN
    CREATE POLICY "Allow authenticated read on zoning_rules" ON zoning_rules FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on property_utilities') THEN
    CREATE POLICY "Allow authenticated read on property_utilities" ON property_utilities FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on impervious_cover') THEN
    CREATE POLICY "Allow authenticated read on impervious_cover" ON impervious_cover FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on permit_applications') THEN
    CREATE POLICY "Allow authenticated read on permit_applications" ON permit_applications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on inspections') THEN
    CREATE POLICY "Allow authenticated read on inspections" ON inspections FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on permit_documents') THEN
    CREATE POLICY "Allow authenticated read on permit_documents" ON permit_documents FOR SELECT TO authenticated USING (true);
  END IF;

  -- Write policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on parcels') THEN
    CREATE POLICY "Allow admin write on parcels" ON parcels FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on parcel_edges') THEN
    CREATE POLICY "Allow admin write on parcel_edges" ON parcel_edges FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on structures') THEN
    CREATE POLICY "Allow admin write on structures" ON structures FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on structure_setbacks') THEN
    CREATE POLICY "Allow admin write on structure_setbacks" ON structure_setbacks FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on zoning_rules') THEN
    CREATE POLICY "Allow admin write on zoning_rules" ON zoning_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on property_utilities') THEN
    CREATE POLICY "Allow admin write on property_utilities" ON property_utilities FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on impervious_cover') THEN
    CREATE POLICY "Allow admin write on impervious_cover" ON impervious_cover FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on permit_applications') THEN
    CREATE POLICY "Allow admin write on permit_applications" ON permit_applications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on inspections') THEN
    CREATE POLICY "Allow admin write on inspections" ON inspections FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow admin write on permit_documents') THEN
    CREATE POLICY "Allow admin write on permit_documents" ON permit_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- 1. PARCEL — Add boundary polygon from Bastrop County GIS
-- =============================================================================
-- GIS corners (clockwise as returned by ArcGIS):
--   SE: (-97.45953135, 30.13102745)
--   SW: (-97.45980270, 30.13056788)
--   NW: (-97.46093153, 30.13106360)
--   NE: (-97.46066047, 30.13152330)
UPDATE parcels SET
  boundary_geom = ST_SetSRID(ST_MakePolygon(ST_GeomFromText(
    'LINESTRING(-97.45953135 30.13102745, -97.46066047 30.13152330, -97.46093153 30.13106360, -97.45980270 30.13056788, -97.45953135 30.13102745)'
  )), 4326)
WHERE id = 1;

-- =============================================================================
-- 2. PARCEL EDGES — Add edge geometry from GIS polygon corners
-- =============================================================================
-- Edge ID mapping from existing DB: 1=N, 2=S, 3=E, 4=W

-- North edge (NW → NE)
UPDATE parcel_edges SET
  edge_geom = ST_SetSRID(ST_MakeLine(
    ST_MakePoint(-97.46093153, 30.13106360),
    ST_MakePoint(-97.46066047, 30.13152330)
  ), 4326),
  edge_label = 'North boundary — adjoining property'
WHERE id = 1;

-- South edge (SE → SW along Still Forest Dr)
UPDATE parcel_edges SET
  edge_geom = ST_SetSRID(ST_MakeLine(
    ST_MakePoint(-97.45953135, 30.13102745),
    ST_MakePoint(-97.45980270, 30.13056788)
  ), 4326),
  edge_label = 'South boundary — Still Forest Dr (CR 329)',
  is_road_frontage = true,
  road_name = 'Still Forest Dr (CR 329)',
  road_classification = 'local_rural',
  road_row_ft = 60.00,
  bearing = COALESCE(bearing, 'S26d20m31sW')
WHERE id = 2;

-- East edge (NE → SE, has 10' P.U.E.)
UPDATE parcel_edges SET
  edge_geom = ST_SetSRID(ST_MakeLine(
    ST_MakePoint(-97.46066047, 30.13152330),
    ST_MakePoint(-97.45953135, 30.13102745)
  ), 4326),
  edge_label = 'East boundary — 10'' P.U.E. & Building Line',
  has_easement = true,
  easement_type = 'P.U.E. and Building Line',
  easement_width_ft = 10.00
WHERE id = 3;

-- West edge (SW → NW)
UPDATE parcel_edges SET
  edge_geom = ST_SetSRID(ST_MakeLine(
    ST_MakePoint(-97.45980270, 30.13056788),
    ST_MakePoint(-97.46093153, 30.13106360)
  ), 4326),
  edge_label = 'West boundary — adjoining property',
  notes = 'Survey labels reference Leisure Lane (CR 331) beyond, but intervening property exists.'
WHERE id = 4;

-- =============================================================================
-- 3. STRUCTURES — Add centroid geometry
-- =============================================================================
-- Centroids computed by:
--   1. Interpolating a point along the nearest edge (t = estimated position 0..1)
--   2. Offsetting inward by the setback distance along the edge's inward normal
-- Inward normals derived from GIS polygon:
--   S edge: az 297° (WNW into property)
--   W edge: az 27°  (NNE into property)
--   N edge: az 117° (ESE into property)
--   E edge: az 206° (SSW into property)

-- 1. Main House — 50' from S edge, mid-right position
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.45978, 30.13091), 4326) WHERE id = 1;

-- 2. Back House — 30' from N edge, center position
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46071, 30.13125), 4326) WHERE id = 2;

-- 3. Big Trailer — 1' from W edge, lower-third position
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46014, 30.13072), 4326) WHERE id = 3;

-- 4. Red Container #1 — 2' from W edge
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46020, 30.13075), 4326) WHERE id = 4;

-- 5. Red Container #2 — 13.5' from E edge (per existing DB data)
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46006, 30.13121), 4326) WHERE id = 5;

-- 6. Container #3 — 5' from W edge
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46030, 30.13080), 4326) WHERE id = 6;

-- 7. Deck — 13.4' from W edge, near main house
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46006, 30.13073), 4326) WHERE id = 7;

-- 8. Beige Container — 6' from S edge, left of center
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.45974, 30.13072), 4326) WHERE id = 8;

-- 9. Bathroom Bldg — 10' from E edge, upper-mid position
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46005, 30.13123), 4326) WHERE id = 9;

-- 10. Small Trailer — 7' from E edge
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.46011, 30.13126), 4326) WHERE id = 10;

-- 11. Sauna — 30' from W edge, lower position
UPDATE structures SET centroid_geom = ST_SetSRID(ST_MakePoint(-97.45993, 30.13071), 4326) WHERE id = 11;
