# Site Plan & Rendering Pipeline — Full Context

> **Property:** 160 Still Forest Drive, Cedar Creek TX 78612 (Lot 14-B, Block 6, Blue Bonnet Acres)
> **Last updated:** 2026-04-10

---

## 1. Database (Supabase PostGIS — project `aphrrfprbixmhissnjfn`)

### Core Tables

| Table | Purpose | Geometry Column(s) |
|-------|---------|-------------------|
| `parcels` | Lot boundary, acreage, legal desc, flood zone, elevation | `boundary_geom` (POLYGON 4326) |
| `structures` | All 14 structures with dimensions, materials, permits | `footprint_geom` (POLYGON 4326), `centroid_geom` (POINT 4326), `lod0_footprint` (POLYGONZ) |
| `parcel_edges` | 4 boundary edges with bearings, setback rules | `edge_geom` (LINESTRING 4326) |
| `structure_setbacks` | Computed compliance per structure/edge | FK to structures + parcel_edges |
| `structure_rooms` | Rooms within structures (e.g., Main House bedrooms) | — |
| `zoning_rules` | Bastrop County setback/coverage regulations | — |
| `property_utilities` | Water, septic, electric, fire protection | `location_geom` (POINT 4326) |
| `impervious_cover` | Per-surface impervious area tracking | — |
| `permit_applications` | Permit tracking per structure | — |
| `inspections` | Inspection records per permit | — |
| `permit_documents` | Uploaded survey/engineering docs | — |

### Views (created via psql, not in migrations)

| View | Purpose | Used By |
|------|---------|---------|
| `structure_footprints_geojson` | Structures as GeoJSON with space names | `phyprop.js` birds-eye renderer |
| `parcel_boundary_geojson` | Parcel boundary as GeoJSON | `phyprop.js` birds-eye renderer |

```sql
-- structure_footprints_geojson
SELECT s.id, s.name, sp.name AS friendly_name, s.category, s.structure_type,
       s.width_ft, s.length_ft, s.height_ft, s.area_sqft,
       ST_AsGeoJSON(s.footprint_geom)::json AS footprint,
       ST_AsGeoJSON(ST_Centroid(s.footprint_geom))::json AS centroid
  FROM structures s LEFT JOIN spaces sp ON sp.id = s.space_id
 WHERE s.footprint_geom IS NOT NULL;

-- parcel_boundary_geojson
SELECT id, name, acreage, area_sqft,
       ST_AsGeoJSON(boundary_geom)::json AS boundary
  FROM parcels WHERE boundary_geom IS NOT NULL;
```

### Current Structures (14 total)

| ID | DB Name | Space Name | Category | Dims (ft) |
|----|---------|-----------|----------|-----------|
| 1 | Main House | Main House | house | 40×60 |
| 2 | 1-Story Wood Bldg (Back House) | Dog House | outbuilding | 25×30 |
| 3 | Big Trailer (10×42) | Spartan Trailer | trailer_rv | 10×42 |
| 4 | Red Container #1 (40×8) | South Container | container | 8×40 |
| 6 | Container #3 (40×8) | Parking Container | container | 8×40 |
| 7 | Deck | Spa Deck | deck | 30×24 |
| 8 | Beige Container (40×8) | Cadillac Container | container | 8×40 |
| 9 | Bathroom Bldg | Outhouse | outbuilding | 17×17 |
| 10 | Small Trailer (7.4×20.4) | Fuego Trailer | trailer_rv | 7.4×20.4 |
| 11 | Sauna | Sauna | sauna | 7×7 |
| 13 | Gravel Driveway & Parking | NE Parking Lot | other | 20×150 |
| 14 | Septic System (OSSF #18725) | Septic System | utility | 30×50 |
| 15 | Private Water Well | Pond | utility | 3×3 |

**Known issue (2026-04-10):** Structure `footprint_geom` positions are NOT accurate. Multiple georeferencing attempts (v1–v5) have failed to match the survey/satellite. The positions use a local coordinate system (u=along south edge, v=along west edge, origin at SW corner) but the placement doesn't match the actual property layout. **Next step:** User is labeling a grid overlay on the survey to provide ground-truth positions.

### Parcel Geometry

```
Boundary ring (lon, lat):
  SE: (-97.4595314, 30.1310274)
  SW: (-97.4598027, 30.1305679)
  NW: (-97.4609315, 30.1310636)
  NE: (-97.4606605, 30.1315233)

South edge: 187.8 ft (SW → SE)
West edge: 398.5 ft (SW → NW)
Lot rotation: ~26° from north
```

### DB Access

```bash
# psql (on Alpuca only — not installed locally)
PGPASSWORD='BirdBrain9gres!' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-2.pooler.supabase.com -p 6543 \
  -U postgres.aphrrfprbixmhissnjfn -d postgres \
  --set=gssencmode=disable

# Supabase Management API — TOKEN REVOKED as of 2026-04-08
# Use psql instead for SQL queries
```

---

## 2. Admin UI — PhyProp Page

**Files:**
- `spaces/admin/phyprop.html` — Layout, tabs, CSS
- `spaces/admin/phyprop.js` — All logic

**Subtabs:** Overview | Structures | Permitting Plan | Renderings | Blendering

### Birds-Eye SVG Renderer (in Renderings tab)

Located in `phyprop.js` function `loadBirdsEye()`:
1. Fetches `parcel_boundary_geojson` and `structure_footprints_geojson` views via supabase-js
2. Classifies 4 parcel corners (SW/SE/NE/NW) by lat/lon extremes
3. Projects all coordinates into a parcel-local frame:
   - u-axis = unit vector along south edge (SW→SE)
   - v-axis = unit vector along west edge (SW→NW)
   - Converts lon/lat → feet via `FT_PER_DEG_LAT=364000`, `FT_PER_DEG_LON=364000*cos(midLat)`
4. Renders inline SVG with:
   - Green dashed parcel boundary
   - Color-coded structure polygons (Building=amber, Container=blue, Trailer=pink, etc.)
   - Labels with dimensions
   - North arrow (rotated to show true north in the local frame)
   - 50 ft scale bar

### Survey/Plat Display

`SURVEY_PLATS` array in phyprop.js references:
- `jackie/pages/permittingplan/survey-ward-2025.png` — 2025 update by 4Ward Land Surveying
- `jackie/pages/permittingplan/survey-base.png` — Original 2021 survey

### 3D Renders Display

`RENDERINGS` array references Supabase Storage:
- `renderings/property-birdseye-2026-03-21.png` — Cycles render from March 2026

---

## 3. Software Inventory

### Alpuca (Mac Mini M4 — 192.168.1.200)

| Software | Version | Path | Purpose |
|----------|---------|------|---------|
| Blender | 5.1.0 | `/opt/homebrew/bin/blender` | 3D modeling & rendering |
| Python | 3.14.3 | system | Scripting, georef |
| OpenCV | 4.13.0 | pip | Image analysis, parcel detection |
| psql | 18.3 | `/opt/homebrew/opt/libpq/bin/psql` | PostGIS queries |
| NumPy | installed | pip | Coordinate math |
| Pillow | installed | pip | Image processing |

**Not installed on Alpuca:**
- QGIS (was referenced in docs as installed, but `/Applications/QGIS*.app` not found)
- GDAL (`gdalinfo` not found — may need `brew install gdal`)
- Blender add-ons directory `~/Downloads/blender-addons/` is **empty**

**Blender add-ons documented but not confirmed installed:**
- BlenderGIS — GIS data import
- Bonsai (BlenderBIM) v0.8.5 — Architectural drafting
- CAD Sketcher — Parametric sketching
- Archipack — Walls, fences, roofs
- MeasureIt-ARCH — Built into Blender

### Local Machine (rahulio's Mac)

- No psql installed
- No Blender installed
- SSH to Alpuca: `ssh paca@192.168.1.200` (key auth)

### Supabase

- PostGIS 3.3 enabled
- Project: `aphrrfprbixmhissnjfn`
- Storage bucket: `housephotos` (renders, photos)

---

## 4. 3D Assets

### Polycam GLB Scans (on Alpuca)

```
/Users/alpuca/workspaces/jackie/glb-alpaca-2026-04-08/
  4_8_2026.glb     (4.6 MB, bbox: 11.0 × 3.6 × 9.3 m)
  4_8_2026 2.glb   (12 MB, bbox: 9.4 × 3.6 × 9.1 m)
  4_8_2026 4.glb   (3 MB, bbox: 8.3 × 2.9 × 12.6 m → likely Fuego Trailer 10×42 ft)
```

Not yet identified which scan maps to which structure (except `4_8_2026 4.glb` likely = Fuego Trailer based on dimensions).

### Blender Scripts (in repo)

| File | Purpose | Status |
|------|---------|--------|
| `blender/render_property.py` | Procedural render from PostGIS data | **Broken** — produces flat colored boxes |
| `blender/fetch_property_data.py` | Export property data to JSON | Working (uses anon key) |
| `blender/setup_scene.py` | Scene assembly with BlenderGIS | Untested — needs add-ons installed |
| `blender/fix_footprints.py` | Geometry validation utility | Unknown status |
| `blender/property_data.json` | Exported property geometry | May be stale |

---

## 5. Georeferencing Work (on Alpuca)

**Location:** `/Users/alpuca/workspaces/property-georef/`

This session's work attempting to match PostGIS structure positions to the 4Ward survey:

| File | Purpose |
|------|---------|
| `survey.png` | Copy of survey-ward-2025.png |
| `survey_grid.png` | Survey with A1–F8 grid overlay for user labeling |
| `detect_parcel.py` | Auto-detect parcel corners (failed — grabbed wrong rect) |
| `overlay.py` through `fix_v5.py` | Iterative position correction scripts |
| `update_v1.sql` through `update_v5.sql` | SQL updates applied to DB |
| Various `.png` files | Comparison overlays, corner zoom crops |

**Approach used:** Affine transform from 4 parcel corner pixel positions → lon/lat, then trace structure pixel positions on survey → inverse transform to lon/lat. **Result:** Positions improved but still don't match satellite/survey accurately. Needs user-guided placement via grid overlay.

### Local Coordinate System

The lot uses a parcel-local frame for positioning:
- **Origin:** SW corner (-97.4598027, 30.1305679)
- **u-axis:** Along south edge toward SE, 0–188 ft
- **v-axis:** Along west edge toward NW, 0–399 ft
- **Conversion:** `local_to_lonlat(u, v)` function in `fix_v5.py`

---

## 6. Rendering Pipeline Status

### Documented Pipeline (from CAD-RENDER-PIPELINE.md)

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | On-site data collection (photos, drone, measurements) | **Not started** |
| 2 | GIS base layer (LiDAR DEM, aerial imagery, PostGIS export) | **Partially done** — PostGIS data exists, no DEM/aerial |
| 3 | Blender scene assembly (terrain, structures, materials) | **Not started** — add-ons not installed |
| 4 | Render & publish (Cycles, post-process, upload) | **Not started** |

### Current Render Output

One render exists: `renderings/property-birdseye-2026-03-21.png` (Cycles, 128 samples, 2560×1440). Produced by the now-broken procedural script.

### What Works Today

1. **PostGIS data** — All structure metadata, dimensions, and parcel boundary are correct
2. **PhyProp admin page** — Displays all data, generates SVG birds-eye from DB
3. **Survey display** — Both 2021 and 2025 surveys displayed on Renderings tab
4. **Blender on Alpuca** — v5.1.0 installed and working

### What's Broken/Missing

1. **Structure footprint positions** — Don't match survey or satellite (in progress)
2. **Blender add-ons** — Not installed on Alpuca (BlenderGIS, Bonsai, etc.)
3. **QGIS** — Not installed on Alpuca
4. **GDAL** — Not installed on Alpuca
5. **No terrain data** — No LiDAR DEM downloaded
6. **No aerial imagery** — No NAIP/TNRIS data
7. **No reference photos** — Phase 1 data collection not done
8. **GLB scans** — 3 scans exist but not identified/surfaced in UI

---

## 7. Key Documentation

| Doc | Location | When to Load |
|-----|----------|-------------|
| CAD.md | `devdocs/CAD.md` | Tool reference, data sources |
| CAD-SITE-PLANS.md | `devdocs/CAD-SITE-PLANS.md` | Setup, permit workflows |
| CAD-RENDER-PIPELINE.md | `devdocs/CAD-RENDER-PIPELINE.md` | Full render pipeline, quality standards |
| SCHEMA.md | `devdocs/SCHEMA.md` | Database schema reference |
| This file | `devdocs/SITE-PLAN-PIPELINE.md` | Quick-start context for any session |

---

## 8. Quick Commands

```bash
# SSH to Alpuca
ssh paca@192.168.1.200

# Query structures
PGPASSWORD='BirdBrain9gres!' /opt/homebrew/opt/libpq/bin/psql \
  -h aws-1-us-east-2.pooler.supabase.com -p 6543 \
  -U postgres.aphrrfprbixmhissnjfn -d postgres \
  --set=gssencmode=disable \
  -c "SELECT id, name, width_ft, length_ft, ST_AsText(footprint_geom) FROM structures ORDER BY id"

# Update a structure position (using local coords)
# See fix_v5.py for local_to_lonlat() function
# u = feet along south edge (0-188), v = feet along west edge (0-399)

# Run Blender headless on Alpuca
/opt/homebrew/bin/blender -b scene.blend -P script.py

# List GLB scans
ls /Users/alpuca/workspaces/jackie/glb-alpaca-2026-04-08/
```
