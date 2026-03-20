-- Seed data for 3D Property Digital Twin
-- Run AFTER: 20260320_3d_property_schema.sql
-- Run BEFORE: 20260320_populate_parcel_geometry.sql (which adds geometry)
--
-- Creates: 1 parcel, 4 edges, 11 structures, 1 zoning rule, 4 utilities,
--          4 impervious cover entries, RLS policies, and triggers.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parcels_updated_at
  BEFORE UPDATE ON parcels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_structures_updated_at
  BEFORE UPDATE ON structures FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_zoning_rules_updated_at
  BEFORE UPDATE ON zoning_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_property_utilities_updated_at
  BEFORE UPDATE ON property_utilities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_permit_applications_updated_at
  BEFORE UPDATE ON permit_applications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-compute centroid_geom when footprint_geom changes
CREATE OR REPLACE FUNCTION compute_structure_centroid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.footprint_geom IS NOT NULL THEN
    NEW.centroid_geom = ST_Centroid(NEW.footprint_geom);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_structures_centroid
  BEFORE INSERT OR UPDATE OF footprint_geom ON structures
  FOR EACH ROW EXECUTE FUNCTION compute_structure_centroid();

-- Auto-compute area_sqft from footprint_geom (in square feet)
CREATE OR REPLACE FUNCTION compute_structure_area()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.footprint_geom IS NOT NULL AND (NEW.area_sqft IS NULL OR OLD.footprint_geom IS DISTINCT FROM NEW.footprint_geom) THEN
    NEW.area_sqft = ST_Area(NEW.footprint_geom::geography) * 10.7639;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_structures_area
  BEFORE INSERT OR UPDATE OF footprint_geom ON structures
  FOR EACH ROW EXECUTE FUNCTION compute_structure_area();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

-- Anon: read-only on all tables
-- Authenticated: read + write on all tables

-- parcels
CREATE POLICY "parcels_anon_read" ON parcels FOR SELECT TO anon USING (true);
CREATE POLICY "parcels_auth_read" ON parcels FOR SELECT TO authenticated USING (true);
CREATE POLICY "parcels_auth_insert" ON parcels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "parcels_auth_update" ON parcels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- parcel_edges
CREATE POLICY "parcel_edges_anon_read" ON parcel_edges FOR SELECT TO anon USING (true);
CREATE POLICY "parcel_edges_auth_read" ON parcel_edges FOR SELECT TO authenticated USING (true);
CREATE POLICY "parcel_edges_auth_insert" ON parcel_edges FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "parcel_edges_auth_update" ON parcel_edges FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "parcel_edges_auth_delete" ON parcel_edges FOR DELETE TO authenticated USING (true);

-- structures
CREATE POLICY "structures_anon_read" ON structures FOR SELECT TO anon USING (true);
CREATE POLICY "structures_auth_read" ON structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "structures_auth_insert" ON structures FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "structures_auth_update" ON structures FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "structures_auth_delete" ON structures FOR DELETE TO authenticated USING (true);

-- structure_setbacks
CREATE POLICY "structure_setbacks_anon_read" ON structure_setbacks FOR SELECT TO anon USING (true);
CREATE POLICY "structure_setbacks_auth_read" ON structure_setbacks FOR SELECT TO authenticated USING (true);
CREATE POLICY "structure_setbacks_auth_insert" ON structure_setbacks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "structure_setbacks_auth_update" ON structure_setbacks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- zoning_rules
CREATE POLICY "zoning_rules_anon_read" ON zoning_rules FOR SELECT TO anon USING (true);
CREATE POLICY "zoning_rules_auth_read" ON zoning_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "zoning_rules_auth_update" ON zoning_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- property_utilities
CREATE POLICY "property_utilities_anon_read" ON property_utilities FOR SELECT TO anon USING (true);
CREATE POLICY "property_utilities_auth_read" ON property_utilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "property_utilities_auth_insert" ON property_utilities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "property_utilities_auth_update" ON property_utilities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- impervious_cover
CREATE POLICY "impervious_cover_anon_read" ON impervious_cover FOR SELECT TO anon USING (true);
CREATE POLICY "impervious_cover_auth_read" ON impervious_cover FOR SELECT TO authenticated USING (true);
CREATE POLICY "impervious_cover_auth_insert" ON impervious_cover FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "impervious_cover_auth_update" ON impervious_cover FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- permit_applications
CREATE POLICY "permit_apps_anon_read" ON permit_applications FOR SELECT TO anon USING (true);
CREATE POLICY "permit_apps_auth_read" ON permit_applications FOR SELECT TO authenticated USING (true);
CREATE POLICY "permit_apps_auth_insert" ON permit_applications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "permit_apps_auth_update" ON permit_applications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- inspections
CREATE POLICY "inspections_anon_read" ON inspections FOR SELECT TO anon USING (true);
CREATE POLICY "inspections_auth_read" ON inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "inspections_auth_insert" ON inspections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "inspections_auth_update" ON inspections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- permit_documents
CREATE POLICY "permit_docs_anon_read" ON permit_documents FOR SELECT TO anon USING (true);
CREATE POLICY "permit_docs_auth_read" ON permit_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "permit_docs_auth_insert" ON permit_documents FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SEED: ZONING RULES
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO zoning_rules (
  jurisdiction, district_code, district_name, rule_source,
  front_setback_ft, side_setback_ft, rear_setback_ft,
  road_setback_local_rural_ft, road_setback_ranch_ft,
  road_setback_collector_ft, road_setback_arterial_ft,
  lodging_road_row_setback_ft, lodging_property_line_setback_ft,
  lodging_internal_road_setback_ft, lodging_unit_separation_ft,
  max_impervious_pct, exempt_structure_sqft,
  container_behind_primary, container_screening_required,
  container_screening_height_ft, fire_separation_ft,
  notes
) VALUES (
  'Bastrop County', 'UNINCORP', 'Unincorporated — Blue Bonnet Acres',
  'Bastrop County Subdivision Regulations, Section IV',
  20, 10, 10,
  20, 15, 25, 30,
  25, 15, 10, 20,
  NULL, 25,
  TRUE, TRUE, 6, NULL,
  'Blue Bonnet Acres has deed restrictions in addition to county regs. Containers >25 sqft are permanent structures.'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEED: PARCEL
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO parcels (
  name, address, city, county, state, zip,
  legal_description, parcel_number, acreage, area_sqft,
  ground_elevation_ft, flood_zone, in_floodplain,
  houston_toad_habitat, esd_district, zoning_district_id,
  survey_date, survey_by, survey_rpls
) VALUES (
  '160 Still Forest Dr',
  '160 Still Forest Drive', 'Cedar Creek', 'Bastrop', 'TX', '78612',
  'Lot 14-B, Block 6, Bluebonnet Acres, Corrected Plat, Section One',
  '44401', 1.7348, 75133,
  490, 'Zone X (unshaded)', FALSE,
  FALSE, 'BCESD #3', 1,
  '2021-02-04', '4Ward Land Surveying', '5811'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SEED: STRUCTURES (11)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO structures (
  parcel_id, name, structure_type, use_type,
  width_ft, length_ft, height_ft, stories, area_sqft,
  material, roof_type, color,
  nearest_edge_side, nearest_edge_distance_ft,
  setback_required_ft, setback_compliant, setback_surplus_ft,
  permit_status, is_movable, is_permanent_structure,
  guest_capacity, bedrooms, bathrooms,
  has_plumbing, has_electric, has_hvac,
  condition, display_order
) VALUES
-- 1. Main House
(1, 'Main House', 'house', 'primary_residence',
 45, 35, 24, 2, 1575,
 'stone_frame', 'gable', NULL,
 'S', 50, 20, TRUE, 30,
 'permitted', FALSE, TRUE,
 0, 3, 2,
 TRUE, TRUE, TRUE,
 'good', 1),

-- 2. 1-Story Wood Bldg (Back House)
(1, '1-Story Wood Bldg', 'outbuilding', 'lodging',
 30, 20, 12, 1, 600,
 'wood', 'gable', NULL,
 'N', 30, 10, TRUE, 20,
 'permitted', FALSE, TRUE,
 4, 1, 1,
 TRUE, TRUE, TRUE,
 'good', 2),

-- 3. Deck (+ Hot Tub)
(1, 'Deck', 'deck', 'amenity',
 16, 12, 2, 1, 192,
 'wood', 'none', NULL,
 'W', 13.4, 10, TRUE, 3.4,
 'permitted', FALSE, TRUE,
 0, 0, 0,
 FALSE, TRUE, FALSE,
 'good', 3),

-- 4. Sauna
(1, 'Sauna', 'sauna', 'amenity',
 8, 8, 8, 1, 64,
 'wood', 'shed', NULL,
 'W', 30, 10, TRUE, 20,
 'permitted', FALSE, TRUE,
 0, 0, 0,
 FALSE, TRUE, FALSE,
 'good', 4),

-- 5. Big Trailer (10x42) — VIOLATION
(1, 'Big Trailer (10x42)', 'trailer_rv', 'lodging',
 10, 42, 10, 1, 420,
 'rv', 'flat', NULL,
 'W', 1, 10, FALSE, -9,
 'violation', TRUE, FALSE,
 2, 1, 1,
 TRUE, TRUE, TRUE,
 'fair', 5),

-- 6. Red Container #1 (40x8) — VIOLATION
(1, 'Red Container #1 (40x8)', 'container', 'storage',
 8, 40, 8.5, 1, 320,
 'steel_container', 'flat', 'red',
 'W', 2, 10, FALSE, -8,
 'violation', FALSE, TRUE,
 0, 0, 0,
 FALSE, FALSE, FALSE,
 'good', 6),

-- 7. Red Container #2 (40x8) — VIOLATION
(1, 'Red Container #2 (40x8)', 'container', 'storage',
 8, 40, 8.5, 1, 320,
 'steel_container', 'flat', 'red',
 'W', 2, 10, FALSE, -8,
 'violation', FALSE, TRUE,
 0, 0, 0,
 FALSE, FALSE, FALSE,
 'good', 7),

-- 8. Container #3 (40x8) — VIOLATION
(1, 'Container #3 (40x8)', 'container', 'storage',
 8, 40, 8.5, 1, 320,
 'steel_container', 'flat', NULL,
 'W', 5, 10, FALSE, -5,
 'violation', FALSE, TRUE,
 0, 0, 0,
 FALSE, FALSE, FALSE,
 'good', 8),

-- 9. Beige Container (40x8) — VIOLATION
(1, 'Beige Container (40x8)', 'container', 'storage',
 8, 40, 8.5, 1, 320,
 'steel_container', 'flat', 'beige',
 'S', 6, 20, FALSE, -14,
 'violation', FALSE, TRUE,
 0, 0, 0,
 FALSE, FALSE, FALSE,
 'good', 9),

-- 10. Bathroom Bldg — compliant but unpermitted
(1, 'Bathroom Bldg', 'outbuilding', 'service',
 10, 12, 10, 1, 120,
 'wood', 'shed', NULL,
 'E', 10, 10, TRUE, 0,
 'unpermitted', FALSE, TRUE,
 0, 0, 1,
 TRUE, TRUE, FALSE,
 'good', 10),

-- 11. Small Trailer (7.5x20.5) — VIOLATION
(1, 'Small Trailer (7.5x20.5)', 'trailer_rv', 'lodging',
 7.5, 20.5, 9, 1, 153.75,
 'rv', 'flat', NULL,
 'E', 7, 10, FALSE, -3,
 'violation', TRUE, FALSE,
 2, 1, 0,
 FALSE, TRUE, FALSE,
 'fair', 11);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SEED: PROPERTY UTILITIES
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO property_utilities (
  parcel_id, utility_type, provider, status, system_type,
  capacity, location_description, availability_letter_status, notes
) VALUES
(1, 'water', NULL, 'active', 'Private water well',
 NULL, 'On property', 'not_required',
 'Private well — no municipal water service available'),

(1, 'wastewater', NULL, 'active', 'Aerobic OSSF (JET INC)',
 '500 GPD', 'Behind main house', 'obtained',
 'Aerobic on-site sewage facility. Annual maintenance contract required.'),

(1, 'electric', 'Bluebonnet Electric Cooperative', 'active', 'Grid connection',
 '200A', 'Meter on south side near road', 'not_required',
 'Standard residential 200A service'),

(1, 'fire_protection', NULL, 'inactive', NULL,
 NULL, NULL, 'pending',
 'No fire hydrant or water tank on property. BCESD #3 requires 2,500 gal tank for development permits. Tank installation pending.');

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. SEED: IMPERVIOUS COVER (containers only — structures trigger adds rest)
-- ═══════════════════════════════════════════════════════════════════════════

-- Container impervious tracking (4 containers × 320 SF = 1,280 SF)
INSERT INTO impervious_cover (parcel_id, structure_id, surface_type, area_sqft, material, notes)
SELECT p.id, s.id, 'structure', s.area_sqft, 'steel', s.name || ' footprint'
FROM parcels p, structures s
WHERE p.parcel_number = '44401'
  AND s.parcel_id = p.id
  AND s.structure_type = 'container';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. ADDITIONAL INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_structures_type ON structures(structure_type);
CREATE INDEX IF NOT EXISTS idx_structures_permit ON structures(permit_status);
CREATE INDEX IF NOT EXISTS idx_structures_active ON structures(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_structures_centroid ON structures USING GIST(centroid_geom);
CREATE INDEX IF NOT EXISTS idx_property_utilities_parcel ON property_utilities(parcel_id);
CREATE INDEX IF NOT EXISTS idx_impervious_cover_parcel ON impervious_cover(parcel_id);
