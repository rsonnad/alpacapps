# CAD & Site Plan System — Tool Reference

> **Database:** All property, structure, setback, and permit data lives in the **3D Property Digital Twin** table set in Supabase (PostGIS-enabled). See "3D Property Digital Twin Database Schema" section below for full schema. **Never hardcode structure data in HTML/JS** — always read from and write to these tables.

> **Tables:** `parcels`, `parcel_edges`, `structures`, `structure_setbacks`, `zoning_rules`, `property_utilities`, `impervious_cover`, `permit_applications`, `inspections`, `permit_documents`

> **All tools are on Alpaca Mac** (192.168.1.74, user `alpaca`).
> Nothing is on Hostinger VPS — can be added later for automation if needed.

---

## Installed Software

### Blender 4.5.7

- **Path:** `/Applications/Blender.app`
- **CLI:** `/usr/local/bin/blender`
- **Purpose:** 3D modeling, photorealistic rendering, 2D drafting (Grease Pencil), permit sheet generation
- **Installed via:** `brew install --cask blender`

### QGIS 4.0.0

- **Path:** `/Applications/QGIS-final-4_0_0.app`
- **Purpose:** GIS exploration, parcel data import, map composition, print layouts
- **Installed via:** `brew install --cask qgis`
- **Note:** Bundles full GDAL/OGR toolkit (see below)

### LibreCAD 2.x

- **Path:** `/Applications/LibreCAD.app`
- **Purpose:** Lightweight 2D CAD for quick drafting (DXF native)
- **Installed via:** `brew install --cask librecad`

### GDAL 3.12.0 (bundled with QGIS)

- **Path:** `/Applications/QGIS-final-4_0_0.app/Contents/MacOS/`
- **Key commands:**
  - `gdal_translate` — format conversion
  - `gdalinfo` — raster info
  - `gdalwarp` — reprojection
  - `ogr2ogr` — vector format conversion (shapefiles, GeoJSON, etc.)
  - `ogrinfo` — vector info
- **Standalone brew install failed** — requires full Xcode (only CLI tools installed). QGIS bundle is sufficient.
- **Usage:** Prefix with full path or alias:
  ```bash
  /Applications/QGIS-final-4_0_0.app/Contents/MacOS/ogr2ogr -f GeoJSON out.geojson in.shp
  ```

---

## Blender Add-ons (Downloaded, Need GUI Activation)

All add-on zips are in `~/Downloads/blender-addons/` on Alpaca Mac.

**To install each:** Blender → Edit → Preferences → Add-ons → Install → select the .zip file → Enable.

| Add-on | File | Purpose |
|--------|------|---------|
| **Bonsai** (BlenderBIM) | `bonsai_py311-0.8.5-alpha260311-macos-x64.zip` (131 MB) | Architectural drafting, IFC export, dimensioned drawing sheets, title blocks |
| **BlenderGIS** | `BlenderGIS-master.zip` (413 KB) | Import GIS shapefiles, satellite imagery, terrain elevation data |
| **CAD Sketcher** | `CAD_Sketcher-main.zip` (62 MB) | Constraint-based 2D sketching (AutoCAD-style parametric constraints) |
| **Archipack** | `archipack-master.zip` (1.4 MB) | Parametric walls, fences, floors, roofs, stairs |

**MeasureIt-ARCH** is already bundled with Blender — just enable it in Preferences → Add-ons → search "MeasureIt".

---

## GIS Data Sources — Bastrop County

| Data | Source | URL |
|------|--------|-----|
| Parcel boundaries | Bastrop CAD | https://www.bastropcad.org/ |
| Parcel boundaries (REST API) | Bastrop County ArcGIS | `services3.arcgis.com/wdTkTU0MdZbNBEZy/.../Parcel/FeatureServer/0` |
| Statewide parcels, LiDAR, aerial | TNRIS | https://data.tnris.org/ |
| NAIP aerial imagery | USDA | Via QGIS WMS |
| 1m LiDAR DEM | USGS 3DEP | https://apps.nationalmap.gov/downloader/ |
| Flood zones | FEMA | https://msc.fema.gov/portal/home |
| Environmental | TCEQ | https://www.tceq.texas.gov/gis |

**Property:** 160 Still Forest Drive, Cedar Creek TX 78612 (Bastrop County, unincorporated)

---

## Quick-Start Workflows

### Create a Site Plan

1. **QGIS** — Import Bastrop County parcel shapefile → locate property → export boundary as GeoJSON
2. **Blender + BlenderGIS** — Import terrain DEM + aerial imagery → drape onto 3D mesh
3. **Blender + Bonsai** — Create drawing sheets (24×36") → add dimensions, title block, setback lines
4. **Export** — PDF + DXF for county submission

### Quick 2D Drafting

- **LibreCAD** — Open/create DXF files, add dimensions, export

### GIS Format Conversion

```bash
# Convert shapefile to GeoJSON (via QGIS-bundled GDAL)
/Applications/QGIS-final-4_0_0.app/Contents/MacOS/ogr2ogr \
  -f GeoJSON output.geojson input.shp
```

### Headless Blender Render

```bash
# Render a .blend file to PNG from CLI
/usr/local/bin/blender -b project.blend -o //output/frame_#### -F PNG -a
```

---

## Future: Hostinger VPS Automation

When needed, these Docker containers can be added to the VPS (175 GB free, 13 Gi RAM):

- **QGIS Server** — Serve WMS/WFS map tiles to AlpacApps
- **Blender CLI** — Headless rendering for on-demand PDF/PNG generation
- **GDAL Docker** — Format conversion pipeline

This would enable AlpacApps edge functions to trigger renders and generate permit packets automatically.

---

## 3D Property Digital Twin Database Schema

### Overview

A PostGIS-enabled Supabase schema that stores the entire property as a 3D digital twin — parcels, structures, setback compliance, utilities, permits, and impervious cover. Designed for compatibility with the full CAD/GIS toolchain above.

**PostGIS version:** 3.3 (enabled on Supabase)
**SFCGAL:** Not available on Supabase — 3D extrusion/volume operations happen in Blender/QGIS, not server-side. See "SFCGAL Gap" section below.

### Schema Diagram

```
parcels (1)
  ├── parcel_edges (4: N, S, E, W)
  │     └── structure_setbacks (measured distance per structure per edge)
  ├── structures (11 on property)
  │     ├── structure_setbacks (compliance per edge)
  │     ├── impervious_cover (area tracking)
  │     └── permit_applications (permit per structure)
  │           ├── inspections (sequence per permit)
  │           └── permit_documents (files per permit)
  ├── property_utilities (water, septic, electric, fire)
  ├── impervious_cover (total tracking)
  └── zoning_rules (Bastrop County regulations)
```

### Tables

#### `parcels` — The land parcel itself
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| name | TEXT | "160 Still Forest Dr" |
| address, city, county, state, zip | TEXT | Full address |
| legal_description | TEXT | "Lot 14-B, Block 6, Blue Bonnet Acres..." |
| parcel_number | TEXT | "44401" |
| acreage | NUMERIC(8,4) | 1.7348 |
| area_sqft | NUMERIC(12,2) | 75,133 |
| boundary_geom | GEOMETRY(POLYGON, 4326) | PostGIS polygon — importable to QGIS, exportable to GeoJSON |
| ground_elevation_ft | NUMERIC(8,2) | Base elevation for 3D |
| flood_zone | TEXT | "Zone X (unshaded)" |
| in_floodplain | BOOLEAN | false |
| houston_toad_habitat | BOOLEAN | false |
| esd_district | TEXT | "BCESD #3" |
| zoning_district_id | FK→zoning_rules | Links to applicable zoning regulations |
| survey_date, survey_by, survey_rpls | DATE/TEXT | 4Ward Land Surveying, 2021-02-04 |

#### `parcel_edges` — Each boundary edge with setback rules
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| parcel_id | FK→parcels | |
| edge_side | TEXT | N, S, E, W (CHECK constraint) |
| edge_label | TEXT | "South boundary — Still Forest Dr" |
| bearing | TEXT | Survey bearing (e.g., "N26d20m31sE") |
| length_ft | NUMERIC(10,2) | Edge length in feet |
| edge_geom | GEOMETRY(LINESTRING, 4326) | PostGIS line — enables `ST_Distance()` |
| is_road_frontage | BOOLEAN | true for south edge |
| road_name | TEXT | "Still Forest Dr (CR 329)" |
| road_classification | TEXT | local_rural, ranch, collector, arterial |
| road_row_ft | NUMERIC | Right-of-way width (60') |
| has_easement | BOOLEAN | true for east edge (P.U.E.) |
| easement_type | TEXT | "P.U.E. and Building Line" |
| easement_width_ft | NUMERIC | 10 |
| setback_required_ft | NUMERIC | 10 or 20 depending on edge |
| setback_label | TEXT | "property line" or "Local Rural Road" |
| adjoining_owner | TEXT | Name of adjacent property owner |
| notes | TEXT | Free-form notes |

#### `structures` — Every building, container, trailer, deck on the property
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| parcel_id | FK→parcels | |
| name | TEXT | "Big Trailer (10x42)" |
| structure_type | ENUM | house, outbuilding, container, trailer_rv, deck, sauna, shed, garage, carport, fence, retaining_wall, utility, other |
| use_type | ENUM | primary_residence, lodging, storage, amenity, service, parking, mixed, unused |
| width_ft, length_ft, height_ft | NUMERIC | Physical dimensions |
| stories | INTEGER | Number of stories |
| area_sqft | NUMERIC | Footprint area |
| material | TEXT | stone_frame, wood, steel_container, rv |
| roof_type | ENUM | gable, hip, flat, shed, mansard, gambrel, metal_standing_seam, none |
| color | TEXT | Exterior color description |
| year_built | INTEGER | Year originally constructed |
| year_placed | INTEGER | Year placed on property (for containers/trailers) |
| ground_elevation_ft | NUMERIC(8,2) | Base elevation for 3D |
| footprint_geom | GEOMETRY(POLYGON, 4326) | 2D footprint for QGIS/GeoJSON |
| centroid_geom | GEOMETRY(POINT, 4326) | Center point for map markers |
| lod0_footprint | GEOMETRY(POLYGONZ, 4326) | 3D footprint with elevation for Blender import |
| nearest_edge_id | FK→parcel_edges | FK to closest boundary edge |
| nearest_edge_side | TEXT | N, S, E, W |
| nearest_edge_distance_ft | NUMERIC | Distance to nearest property line |
| setback_required_ft | NUMERIC | Required setback for that edge |
| setback_compliant | BOOLEAN | Computed compliance |
| setback_surplus_ft | NUMERIC | Positive = surplus, negative = violation |
| permit_status | ENUM | permitted, unpermitted, exempt, violation, pending, grandfathered |
| is_movable | BOOLEAN | Trailers = true |
| is_permanent_structure | BOOLEAN | FALSE for trailers/RVs |
| guest_capacity | INTEGER | For lodging units |
| bedrooms, bathrooms | INTEGER/NUMERIC | |
| has_plumbing, has_electric, has_hvac | BOOLEAN | Utility connections |
| condition | TEXT | Physical condition notes |
| space_id | INTEGER | FK to `spaces` table (links to room/unit) |
| photo_urls | TEXT[] | R2 image URLs |
| notes | TEXT | Free-form notes |
| metadata | JSONB | Extensible attributes |
| display_order | INTEGER | Sort order in UI |
| is_active | BOOLEAN | Soft delete flag |

#### `structure_setbacks` — Measured distance from each structure to each edge
| Column | Type | Description |
|--------|------|-------------|
| structure_id | FK→structures | |
| edge_id | FK→parcel_edges | |
| measured_distance_ft | NUMERIC | Actual measured distance |
| required_distance_ft | NUMERIC | Required setback |
| is_compliant | BOOLEAN | **GENERATED** — auto-computed: measured >= required |
| surplus_ft | NUMERIC | **GENERATED** — auto-computed: measured - required |
| UNIQUE(structure_id, edge_id) | | One measurement per structure per edge |

#### `zoning_rules` — Bastrop County setback and coverage regulations
Stores road setbacks by classification, lodging-specific rules, container regulations, impervious limits.

#### `property_utilities` — Water, septic, electric, gas, fire protection
| Column | Type | Description |
|--------|------|-------------|
| utility_type | TEXT | water, wastewater, electric, gas, internet, fire_protection |
| provider | TEXT | e.g., "Bluebonnet Electric Cooperative" |
| system_type | TEXT | "Aerobic OSSF (JET INC)", "Private water well" |
| location_geom | GEOMETRY(POINT, 4326) | GPS location of meter/well/tank |
| availability_letter_status | TEXT | pending, obtained, not_required |

#### `permit_applications` — Permit tracking per structure
| Column | Type | Description |
|--------|------|-------------|
| permit_type | TEXT | development, building, septic, electrical, plumbing, demolition, grading, lodging, rv_park |
| status | TEXT | draft, submitted, under_review, approved, denied, expired, closed |
| estimated_cost, actual_cost | NUMERIC | |
| document_urls | TEXT[] | Attached files |

#### `inspections` — Inspection sequence per permit
Pass/fail results, inspector name, scheduling, linked to permit_applications.

#### `permit_documents` — Files linked to permits
Site plans, surveys, engineering docs, ESD letters, etc. Typed by document_type.

#### `impervious_cover` — Tracks total impervious area
Per-structure and per-surface tracking (driveways, patios, etc.) for county compliance.

### Tool Compatibility Matrix

| Tool | Format | How it connects to schema |
|------|--------|--------------------------|
| **QGIS 4.0** | PostGIS direct / GeoJSON | Connects directly to Supabase PostGIS tables. `boundary_geom`, `footprint_geom`, `edge_geom` render natively. |
| **Blender + BlenderGIS** | GeoJSON import | Export via `ST_AsGeoJSON()` from PostGIS, import into Blender scene |
| **Blender + Bonsai (BlenderBIM)** | IFC | `width_ft`, `length_ft`, `height_ft`, `stories`, `roof_type`, `material` map to IFC entities |
| **Blender + Archipack** | Parametric | `roof_type`, `height_ft`, `stories`, `material` feed parametric generation |
| **Blender + MeasureIt-ARCH** | Dimensions | All distances stored in feet, matching MeasureIt units |
| **Blender + CAD Sketcher** | Parametric 2D | `width_ft`/`length_ft` dimensions for constraint-based sketching |
| **LibreCAD** | DXF | Export via `ogr2ogr -f DXF` from PostGIS |
| **GDAL/OGR** | Any vector format | Reads PostGIS directly as data source |
| **TNRIS LiDAR** | Elevation | Populates `ground_elevation_ft` and Z values in POLYGONZ |
| **FEMA Flood Maps** | Geometry overlay | Store as additional column or separate table |

### SFCGAL Gap (Not a blocker)

Supabase PostGIS 3.3 does **not** include the SFCGAL extension. This means three server-side 3D operations are unavailable:

| Operation | What it does | Impact |
|-----------|-------------|--------|
| `ST_Extrude()` | Extrude 2D footprint to 3D solid | **None** — Blender does this |
| `ST_Volume()` | Calculate cubic footage | **None** — computed client-side from dimensions |
| `ST_3DIntersection()` | 3D overlap detection | **None** — not needed for setback compliance (2D) |

**What works fine without SFCGAL:**
- `ST_Distance()` — setback compliance (2D measurement)
- `ST_Buffer()` — buildable area calculation
- `ST_Contains()` — "is structure inside buildable zone?"
- `ST_AsGeoJSON()` — export to Blender/QGIS (including Z coordinates)
- `POLYGONZ` storage — 3D coordinates stored, just no server-side 3D computation

**Fix options (if ever needed):** QGIS Server on Oracle VPS ($0), edge function math ($0), or self-hosted PostGIS+SFCGAL in Docker ($0).

### Data Flow

```
Database (Supabase PostGIS)
  │
  ├── siteplan.html (reads structures, shows compliance checker)
  │
  ├── ST_AsGeoJSON() ──→ Blender (3D modeling, renders, permit sheets)
  │
  ├── Direct PostGIS ──→ QGIS (map composition, analysis, print layouts)
  │
  └── ogr2ogr ──→ LibreCAD (DXF drafting)
```

### Current Data (as of March 2026)

**Parcel:** 160 Still Forest Dr — 1.7348 acres, 4 edges, 1 road frontage (south)

**Geometry status:** `boundary_geom`, `edge_geom`, and `footprint_geom` populated from Bastrop County GIS + georeferenced survey. Parcel corners from ArcGIS FeatureServer (prop_id=44401), structure footprints computed via GDAL georeferencing of 4Ward survey PNG with 4 GCPs. See `gis/` directory for scripts and GeoJSON files. Georeferenced survey TIFF on Alpaca Mac at `~/Documents/gis/still-forest/survey-georef.tif`.

**11 Structures:**
- 5 compliant (Main House, Back House, Deck, Sauna, Bathroom Bldg*)
- 6 violations (Big Trailer, Red Container #1, Red Container #2, Container #3, Beige Container, Small Trailer)
- *Bathroom Bldg is setback-compliant but unpermitted

**4 Utilities:** Water (well), Wastewater (aerobic OSSF), Electric (Bluebonnet), Fire Protection (none — tank required)

**Impervious Cover:** 4 containers × 320 SF = 1,280 SF tracked

---

## Costs

| Item | Cost |
|------|------|
| All software and add-ons | **$0** |
| GIS data (TNRIS, USGS, FEMA) | **$0** |
| Bastrop County parcel data | **$0** |
| PostGIS extension (Supabase) | **$0** (included) |
| **Total additional cost** | **$0** |
