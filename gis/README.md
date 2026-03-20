# QGIS Georeferencing — 160 Still Forest Dr

Georeference the 4Ward survey PNG, trace all 11 structures as polygons, and populate PostGIS with real-world coordinates.

## Parcel Corner Coordinates (from Bastrop County GIS)

Source: [Bastrop County ArcGIS FeatureServer](https://services3.arcgis.com/wdTkTU0MdZbNBEZy/arcgis/rest/services/Parcel/FeatureServer/0) — prop_id=44401

| Corner | Latitude | Longitude |
|--------|----------|-----------|
| SW | 30.1305679 | -97.4598027 |
| NW | 30.1310636 | -97.4609315 |
| NE | 30.1315233 | -97.4606605 |
| SE | 30.1310274 | -97.4595314 |

Area: 75,123 sqft (1.725 ac) — county | 75,133 sqft (1.7348 ac) — survey

## Prerequisites

- **Alpaca Mac** (192.168.1.74) with QGIS 4.0 at `/Applications/QGIS-final-4_0_0.app`
- Survey PNG: `jackie/pages/permittingplan/survey-ward-2025.png`

## Quick Start (on Alpaca Mac)

```bash
# 1. Set up working directory
mkdir -p ~/Documents/gis/still-forest
cp /path/to/santiago/gis/*.py ~/Documents/gis/still-forest/
cp /path/to/santiago/gis/parcel-44401.geojson ~/Documents/gis/still-forest/
cp /path/to/santiago/jackie/pages/permittingplan/survey-ward-2025.png ~/Documents/gis/still-forest/

# 2. Open QGIS
open /Applications/QGIS-final-4_0_0.app

# 3. In QGIS Python Console (Plugins → Python Console):
exec(open('/Users/alpaca/Documents/gis/still-forest/georef_and_trace.py').read())
```

## Workflow Phases

### Phase 1: Load Basemaps & Verify Corners

The script loads Google Satellite + OpenStreetMap and zooms to the property. The parcel boundary overlay from county GIS data should align with visible fence lines and road edges on the aerial.

### Phase 2: Create Parcel Boundary

Run `phase2_create_parcel()` — creates a polygon from the county GIS corners and verifies area against the survey (1.7348 acres). Already pre-populated with real coordinates.

### Phase 3: Georeference Survey PNG

Use QGIS's built-in Sketcher (Layer → Sketcher):
1. Open `survey-ward-2025.png`
2. Click 4 corners on the survey, enter the GPS coordinates from the table above
3. Transformation: Thin Plate Spline | CRS: EPSG:4326
4. Output: `survey-georef.tif`
5. Overlay on satellite to verify alignment

**Or use GDAL command line** — run `python3 compute_parcel_corners.py` for commands (update pixel coords first).

### Phase 4: Trace Structures

With georeferenced survey overlaid on satellite:
1. Toggle editing on "Structures (TRACE HERE)" layer
2. Polygon tool → trace each of 11 structures
3. Fill attributes: name, structure_type, use_type, permit_status
4. Save edits

### Phase 5: Export & SQL

Run `phase5_export_structures()`:
- Saves structures as `structures-44401.geojson`
- Generates SQL UPDATE statements for PostGIS `structures.footprint_geom`
- Auto-computes setback distances via `ST_Distance()`

## Files

| File | Purpose |
|------|---------|
| `compute_parcel_corners.py` | Corner coordinates, GeoJSON, GDAL commands, SQL |
| `georef_and_trace.py` | PyQGIS workflow script (run in QGIS Python Console) |
| `parcel-44401.geojson` | Parcel boundary polygon (pre-generated) |
| `../supabase/migrations/20260320_populate_parcel_geometry.sql` | SQL migration for PostGIS |

## Data Source

Bastrop County parcel data is available via ArcGIS REST:
```
GET https://services3.arcgis.com/wdTkTU0MdZbNBEZy/arcgis/rest/services/Parcel/FeatureServer/0/query
  ?where=prop_id=44401
  &outFields=*
  &returnGeometry=true
  &outSR=4326
  &f=json
```
