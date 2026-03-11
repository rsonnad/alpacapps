# CAD & Site Plan System — Tool Reference

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

## Costs

| Item | Cost |
|------|------|
| All software and add-ons | **$0** |
| GIS data (TNRIS, USGS, FEMA) | **$0** |
| Bastrop County parcel data | **$0** |
| **Total additional cost** | **$0** |
