# CAD & Site Plan System

> **Goal:** Generate professional, county-permit-ready site plans for outdoor spaces at 160 Still Forest Drive, Cedar Creek TX 78612 (Bastrop County) using 100% free and open-source tools.
>
> **All tools are on Alpaca Mac** (192.168.1.74, user `alpaca`).
> Nothing is on Hostinger VPS yet — can be added later for automation.

---

## Installed Software — Alpaca Mac

### Blender 4.5.7

- **Path:** `/Applications/Blender.app` | **CLI:** `/usr/local/bin/blender`
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
- **Key commands:** `gdal_translate`, `gdalinfo`, `gdalwarp`, `ogr2ogr`, `ogrinfo`
- **Standalone brew install failed** — requires full Xcode (only CLI tools installed). QGIS bundle is sufficient.
- **Usage:** Prefix with full path or alias:
  ```bash
  /Applications/QGIS-final-4_0_0.app/Contents/MacOS/ogr2ogr -f GeoJSON out.geojson in.shp
  ```

---

## Blender Add-ons

All add-on zips are in `~/Downloads/blender-addons/` on Alpaca Mac.

**To install each:** Blender → Edit → Preferences → Add-ons → Install → select the .zip file → Enable.

| Add-on | File | Purpose |
|--------|------|---------|
| **Bonsai** (BlenderBIM) | `bonsai_py311-0.8.5-alpha260311-macos-x64.zip` (131 MB) | Architectural drafting, IFC export, dimensioned drawing sheets, title blocks |
| **BlenderGIS** | `BlenderGIS-master.zip` (413 KB) | Import GIS shapefiles, satellite imagery, terrain elevation data |
| **CAD Sketcher** | `CAD_Sketcher-main.zip` (62 MB) | Constraint-based 2D sketching (AutoCAD-style parametric constraints) |
| **Archipack** | `archipack-master.zip` (1.4 MB) | Parametric walls, fences, floors, roofs, stairs |

**MeasureIt-ARCH** is already bundled with Blender — just enable it in Preferences → Add-ons → search "MeasureIt".

**Download sources:** [BlenderBIM](https://blenderbim.org/download.html) · [BlenderGIS](https://github.com/domlysz/BlenderGIS/releases) · [CAD Sketcher](https://github.com/hlorus/CAD_Sketcher/releases) · [Archipack](https://github.com/s-leger/archipack/releases)

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

### Zoning & Setbacks

- Unincorporated areas have limited zoning — check subdivision deed restrictions
- Setback requirements vary by lot size and subdivision covenants — verify with Bastrop County Development Services (512-581-4200)

---

## Workflow: Creating a County Permit Site Plan

### 1. Set Up Base Map (QGIS)

1. Open QGIS, add base layer (Google Satellite or TNRIS imagery)
2. Import Bastrop County parcel shapefile → locate 160 Still Forest Drive
3. Extract property boundary polygon → export as GeoJSON for Blender

### 2. Build 3D Scene (Blender + BlenderGIS)

1. Import terrain DEM (USGS 3DEP 1m LiDAR) → drape aerial imagery onto mesh
2. Import property boundary from QGIS export
3. Add existing structures (measure from aerial + site visit)
4. Model proposed elements: event areas, stages, seating, parking, fire lanes, ADA paths, fencing, gates, landscaping, utilities, drainage, lighting
5. Add setback lines, easements, right-of-way

### 3. Generate Permit Sheets (BlenderBIM / Bonsai)

1. Switch to BlenderBIM drawing mode
2. Create drawing sheets (24×36" at 1"=20' or appropriate scale)
3. Add views: site plan, grading plan, utility plan, landscape plan
4. Add title block (owner: GenAlpaca Residency, address, preparer, date, sheet number)
5. Add dimensions, setback callouts, north arrow, scale bar, legend
6. Export as PDF and DXF

### 4. Create Presentation Renders

1. Set up camera angles (bird's eye, perspective views)
2. Add lighting (sun position matching Cedar Creek latitude)
3. Apply materials (grass, gravel, wood, concrete)
4. Render at high resolution → export PNG/JPEG

### 5. Assemble Permit Packet

Typical Bastrop County site plan submission:
- Cover sheet with project info
- Existing conditions plan
- Proposed site plan (the main drawing)
- Grading/drainage plan
- Utility plan (water, sewer, electric)
- Landscape plan (if applicable)
- Detail sheets (sections, elevations)
- Survey plat (from licensed surveyor — cannot be self-generated)

---

## Quick-Start Commands

```bash
# Convert shapefile to GeoJSON (via QGIS-bundled GDAL)
/Applications/QGIS-final-4_0_0.app/Contents/MacOS/ogr2ogr \
  -f GeoJSON output.geojson input.shp

# Headless Blender render
/usr/local/bin/blender -b project.blend -o //output/frame_#### -F PNG -a
```

---

## Future: Hostinger VPS Automation

When needed, these Docker containers can be added to the VPS (175 GB free, 13 Gi RAM):

### QGIS Server

```bash
docker pull camptocamp/qgis-server:latest
docker run -d --name qgis-server \
  -p 8080:80 \
  -v /opt/qgis-data:/data \
  camptocamp/qgis-server:latest
```

### Blender CLI (headless rendering)

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
  blender xvfb python3-pip && \
  pip3 install bpy
ENTRYPOINT ["xvfb-run", "blender", "-b"]
```

```bash
docker build -t blender-cli -f Dockerfile.blender .
docker run --rm -v /opt/blend-projects:/projects blender-cli \
  /projects/site-plan.blend -o /projects/output/frame_#### -F PNG -a
```

### GDAL

```bash
docker pull ghcr.io/osgeo/gdal:latest
docker run --rm -v /opt/gis-data:/data ghcr.io/osgeo/gdal:latest \
  ogr2ogr -f GeoJSON /data/parcels.geojson /data/parcels.shp
```

### AlpacApps Integration (future)

- **Live property map:** QGIS Server serves WMS tiles → admin shows interactive map with zones, boundaries, event areas
- **On-demand renders:** Edge function → Blender CLI on Hostinger → PNG/PDF → Supabase Storage
- **Automated permit packets:** "Generate Permit Packet" button → Blender exports sheets → LibreOffice assembles → combined PDF in Supabase Storage

---

## Important Notes

- **Licensed survey required:** County permits require a licensed surveyor's plat for property boundaries. These tools produce *site plans* (what you propose to build), not *surveys* (legal boundary determination).
- **Scale and accuracy:** Always verify on-site measurements. GIS/aerial data is typically accurate to 1-3 feet but is not survey-grade.
- **Professional stamp:** Some submissions require a licensed engineer or architect stamp.

---

## Costs

| Item | Cost |
|------|------|
| All software and add-ons | **$0** (GPL/LGPL/MIT licensed) |
| GIS data (TNRIS, USGS, FEMA) | **$0** (taxpayer-funded public data) |
| Bastrop County parcel data | **$0** (public records) |
| Hostinger VPS / Alpaca Mac | Already have |
| **Total additional cost** | **$0** |
