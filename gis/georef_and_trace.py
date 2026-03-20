#!/usr/bin/env python3
"""
QGIS Georeferencing & Structure Tracing — Complete Workflow

Run this script from QGIS Python Console on Alpaca Mac:
  exec(open('/path/to/gis/georef_and_trace.py').read())

Or run sections individually by pasting into the console.

Property: 160 Still Forest Dr, Cedar Creek TX 78612
Parcel: 44401
"""

import os
from pathlib import Path
from qgis.core import *
from qgis.gui import *
from qgis.utils import iface
from PyQt5.QtCore import QVariant

# ─── Configuration ────────────────────────────────────────────────────────

# Paths (on Alpaca Mac)
PROJECT_DIR = Path.home() / "Documents" / "gis" / "still-forest"
SURVEY_PNG = Path.home() / "Documents" / "santiago" / "jackie" / "pages" / "permittingplan" / "survey-ward-2025.png"
PARCEL_GEOJSON = PROJECT_DIR / "parcel-44401.geojson"
STRUCTURES_GEOJSON = PROJECT_DIR / "structures-44401.geojson"
QGIS_PROJECT = PROJECT_DIR / "still-forest-160.qgz"

# Ensure output directory exists
PROJECT_DIR.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: GET REAL COORDINATES VIA QGIS
# ═══════════════════════════════════════════════════════════════════════════
#
# Instead of computing corners from bearings (which requires a precise anchor),
# use QGIS + aerial imagery to identify corners directly.

def phase1_setup_basemaps():
    """
    Set up basemap layers for visual corner identification.
    Run this first, then visually locate the property on the aerial.
    """
    project = QgsProject.instance()
    project.clear()
    project.setTitle("160 Still Forest Dr — Georeferencing")

    # Google Satellite — best for identifying structures
    sat_url = (
        "type=xyz&"
        "url=https://mt1.google.com/vt/lyrs%3Ds%26x%3D{x}%26y%3D{y}%26z%3D{z}&"
        "zmax=20&zmin=0"
    )
    sat = QgsRasterLayer(sat_url, "Google Satellite", "wms")
    if sat.isValid():
        project.addMapLayer(sat)

    # OpenStreetMap — for road names
    osm_url = (
        "type=xyz&"
        "url=https://tile.openstreetmap.org/{z}/{x}/{y}.png&"
        "zmax=19&zmin=0"
    )
    osm = QgsRasterLayer(osm_url, "OpenStreetMap", "wms")
    if osm.isValid():
        project.addMapLayer(osm)
        # Make OSM semi-transparent so satellite shows through
        osm.renderer().setOpacity(0.4)

    # Zoom to Still Forest Drive area
    canvas = iface.mapCanvas()
    # Center on estimated property location
    canvas.setCenter(QgsPointXY(-97.4602, 30.1310))
    canvas.zoomScale(3000)
    canvas.refresh()

    print("=" * 60)
    print("PHASE 1: BASEMAPS LOADED")
    print("=" * 60)
    print()
    print("1. Find 160 Still Forest Dr on the satellite imagery")
    print("2. Identify the property corners (fence lines, cleared areas)")
    print("3. Use the Sketching/Coordinate Capture plugin:")
    print("   - Plugins → Sketching → Sketching")
    print("   - Or: View → Panels → Sketching")
    print("4. Click each corner and note the lat/lon coordinates")
    print("5. Update CORNER_COORDS below with actual values")
    print("6. Run phase2_create_parcel()")
    print()
    print("TIP: The property has structures visible on satellite:")
    print("  - Main house (large roof, center-south)")
    print("  - Back house / 1-story wood bldg (north)")
    print("  - Containers (west side, near property line)")
    print("  - Big trailer (west)")
    print("  - Pool/deck area (center)")


def phase1_setup_basemaps_and_pin():
    """
    Alternative: Add a marker at the estimated property center
    to help locate it on the map.
    """
    phase1_setup_basemaps()

    # Add a point marker at estimated center
    marker = QgsVectorLayer(
        "Point?crs=EPSG:4326&field=label:string(50)",
        "Property Center (estimated)",
        "memory"
    )
    pr = marker.dataProvider()
    f = QgsFeature()
    f.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(-97.4610, 30.1290)))
    f.setAttributes(["160 Still Forest Dr (approx)"])
    pr.addFeature(f)
    marker.updateExtents()

    # Red circle marker
    symbol = QgsMarkerSymbol.createSimple({
        'name': 'circle',
        'color': '#e53e3e',
        'outline_color': '#ffffff',
        'size': '8',
    })
    marker.renderer().setSymbol(symbol)

    QgsProject.instance().addMapLayer(marker)
    marker.triggerRepaint()


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: CREATE PARCEL BOUNDARY FROM IDENTIFIED CORNERS
# ═══════════════════════════════════════════════════════════════════════════

# REAL coordinates from Bastrop County GIS FeatureServer (queried 2026-03-20)
# Source: https://services3.arcgis.com/wdTkTU0MdZbNBEZy/arcgis/rest/services/Parcel/FeatureServer/0
# Query: prop_id=44401 | Area: 75,123 sqft (1.725 acres) — matches survey
# Format: (longitude, latitude) — NOTE: lon first for GIS convention
CORNER_COORDS = {
    'SW': (-97.4598027, 30.1305679),  # Southwest corner on Still Forest Dr
    'NW': (-97.4609315, 30.1310636),  # Northwest corner
    'NE': (-97.4606605, 30.1315233),  # Northeast corner
    'SE': (-97.4595314, 30.1310274),  # Southeast corner on Still Forest Dr
}


def phase2_create_parcel():
    """Create parcel boundary polygon from corner coordinates."""
    project = QgsProject.instance()

    # Create polygon from corners (clockwise)
    ring = [
        QgsPointXY(*CORNER_COORDS['SW']),
        QgsPointXY(*CORNER_COORDS['NW']),
        QgsPointXY(*CORNER_COORDS['NE']),
        QgsPointXY(*CORNER_COORDS['SE']),
        QgsPointXY(*CORNER_COORDS['SW']),  # close ring
    ]

    # Create vector layer
    parcel = QgsVectorLayer(
        "Polygon?crs=EPSG:4326"
        "&field=name:string(100)"
        "&field=parcel_number:string(20)"
        "&field=acreage:double"
        "&field=area_sqft:double",
        "Parcel Boundary",
        "memory"
    )

    pr = parcel.dataProvider()
    feat = QgsFeature()
    feat.setGeometry(QgsGeometry.fromPolygonXY([ring]))
    feat.setAttributes(["160 Still Forest Dr", "44401", 1.7348, 75133])
    pr.addFeature(feat)
    parcel.updateExtents()

    # Style: red dashed outline, no fill
    symbol = QgsFillSymbol.createSimple({
        'color': '0,0,0,0',
        'outline_color': '#e53e3e',
        'outline_width': '2',
        'outline_style': 'dash',
    })
    parcel.renderer().setSymbol(symbol)
    project.addMapLayer(parcel)
    parcel.triggerRepaint()

    # Save as GeoJSON
    _save_layer_geojson(parcel, str(PARCEL_GEOJSON))

    # Compute area
    geom = feat.geometry()
    d = QgsDistanceArea()
    d.setEllipsoid('WGS84')
    area_m2 = d.measureArea(geom)
    area_sqft = area_m2 * 10.7639
    area_acres = area_sqft / 43560

    print(f"\n✓ Parcel boundary created")
    print(f"  Computed area: {area_sqft:,.0f} sqft ({area_acres:.4f} acres)")
    print(f"  Expected area: 75,133 sqft (1.7348 acres)")
    print(f"  Difference: {abs(area_sqft - 75133):,.0f} sqft ({abs(area_acres - 1.7348):.4f} acres)")
    print()
    if abs(area_acres - 1.7348) < 0.05:
        print("  ✓ Area matches survey within 0.05 acres — coordinates look good!")
    else:
        print("  ⚠ Area differs from survey — adjust corner coordinates and re-run")

    return parcel


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: GEOREFERENCE SURVEY PNG
# ═══════════════════════════════════════════════════════════════════════════

def phase3_georeference_survey():
    """
    Georeference the survey PNG using GDAL.

    This uses the parcel corners as Ground Control Points (GCPs).
    You need to provide the pixel coordinates of each corner on the survey PNG.
    """
    print("=" * 60)
    print("PHASE 3: GEOREFERENCE SURVEY")
    print("=" * 60)
    print()
    print("Option A: Use QGIS Sketching Sketching Plugin (GUI)")
    print("  1. Sketcher → Layer → Add Sketching Layer → Select survey PNG")
    print("  2. Add GCPs by clicking survey corners, then entering GPS coords")
    print("  3. Choose 'Thin Plate Spline' transformation")
    print("  4. Output to:", PROJECT_DIR / "survey-georef.tif")
    print()
    print("Option B: Use QGIS Built-in Sketching (Sketcher)")
    print("  1. Layer → Sketcher")
    print("  2. Open:", SURVEY_PNG)
    print("  3. Add GCPs:")

    for name, (lon, lat) in CORNER_COORDS.items():
        print(f"     {name}: ({lat:.7f}, {lon:.7f})")

    print(f"""
  4. Settings:
     - Transformation: Thin Plate Spline
     - Target SRS: EPSG:4326
     - Output: {PROJECT_DIR / 'survey-georef.tif'}
     - Compression: LZW
  5. Click 'Start Sketching'

Option C: Command line (GDAL)
  Run compute_parcel_corners.py for GDAL commands.
  Update pixel coordinates first!
""")

    # Check if georeferenced file already exists
    georef_tif = PROJECT_DIR / "survey-georef.tif"
    if georef_tif.exists():
        print(f"✓ Georeferenced survey found: {georef_tif}")
        layer = QgsRasterLayer(str(georef_tif), "Survey (Georeferenced)")
        if layer.isValid():
            QgsProject.instance().addMapLayer(layer)
            layer.renderer().setOpacity(0.6)
            print("  Added to map with 60% opacity")
            print("  Compare alignment with satellite and parcel boundary")


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: TRACE STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════

# Known structures from siteplan.html and survey
KNOWN_STRUCTURES = [
    {"name": "Main House",                  "type": "house",       "use": "primary_residence", "permit": "permitted"},
    {"name": "1-Story Wood Bldg (Back House)", "type": "outbuilding", "use": "lodging",        "permit": "permitted"},
    {"name": "Big Trailer (10x42)",         "type": "trailer_rv",  "use": "lodging",           "permit": "violation"},
    {"name": "Red Container #1 (40x8)",     "type": "container",   "use": "storage",           "permit": "violation"},
    {"name": "Red Container #2 (40x8)",     "type": "container",   "use": "storage",           "permit": "violation"},
    {"name": "Container #3 (40x8)",         "type": "container",   "use": "storage",           "permit": "violation"},
    {"name": "Beige Container (40x8)",      "type": "container",   "use": "storage",           "permit": "violation"},
    {"name": "Deck",                        "type": "deck",        "use": "amenity",           "permit": "permitted"},
    {"name": "Bathroom Bldg",               "type": "outbuilding", "use": "service",           "permit": "unpermitted"},
    {"name": "Small Trailer (7.5x20.5)",    "type": "trailer_rv",  "use": "lodging",           "permit": "violation"},
    {"name": "Sauna",                       "type": "sauna",       "use": "amenity",           "permit": "permitted"},
]


def phase4_create_structures_layer():
    """
    Create an editable structures layer for tracing.
    Toggle editing, then use the polygon tool to trace each structure.
    """
    project = QgsProject.instance()

    structures = QgsVectorLayer(
        "Polygon?crs=EPSG:4326"
        "&field=name:string(100)"
        "&field=structure_type:string(30)"
        "&field=use_type:string(30)"
        "&field=width_ft:double"
        "&field=length_ft:double"
        "&field=height_ft:double"
        "&field=area_sqft:double"
        "&field=permit_status:string(20)"
        "&field=nearest_edge_side:string(5)"
        "&field=nearest_edge_distance_ft:double",
        "Structures (TRACE HERE)",
        "memory"
    )

    if not structures.isValid():
        print("ERROR: Could not create structures layer")
        return None

    project.addMapLayer(structures)

    # Style: categorized by permit status
    categories = [
        ("permitted",    "#38a169", "Permitted"),
        ("unpermitted",  "#f6ad55", "Unpermitted"),
        ("violation",    "#e53e3e", "Violation"),
        ("exempt",       "#4299e1", "Exempt"),
        ("pending",      "#9f7aea", "Pending"),
    ]

    cat_list = []
    for value, color, label in categories:
        symbol = QgsFillSymbol.createSimple({
            'color': color + '60',  # 38% opacity
            'outline_color': color,
            'outline_width': '1.5',
        })
        cat_list.append(QgsRendererCategory(value, symbol, label))

    # Default symbol
    default = QgsFillSymbol.createSimple({
        'color': '128,128,128,60',
        'outline_color': '#808080',
        'outline_width': '1',
    })
    cat_list.append(QgsRendererCategory('', default, 'Unknown'))

    renderer = QgsCategorizedSymbolRenderer('permit_status', cat_list)
    structures.setRenderer(renderer)
    structures.triggerRepaint()

    print("=" * 60)
    print("PHASE 4: STRUCTURE TRACING")
    print("=" * 60)
    print()
    print("Structures layer created. To trace:")
    print()
    print("1. Select 'Structures (TRACE HERE)' in Layers panel")
    print("2. Click pencil icon (Toggle Editing)")
    print("3. Click 'Add Polygon Feature' tool")
    print("4. Click around each structure to trace its footprint")
    print("5. Right-click to finish each polygon")
    print("6. Fill in attributes in the popup form")
    print()
    print("Known structures to trace:")
    for i, s in enumerate(KNOWN_STRUCTURES, 1):
        status = "✓" if s['permit'] == 'permitted' else "✗"
        print(f"  {i:2d}. {status} {s['name']} ({s['type']}, {s['use']})")
    print()
    print("7. When done: save edits (Sketcher icon) and run:")
    print("   phase5_export_structures()")

    return structures


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 5: EXPORT & GENERATE SQL
# ═══════════════════════════════════════════════════════════════════════════

def phase5_export_structures():
    """Export traced structures to GeoJSON and generate SQL for PostGIS."""
    project = QgsProject.instance()

    # Find the structures layer
    layers = project.mapLayersByName("Structures (TRACE HERE)")
    if not layers:
        print("ERROR: No 'Structures (TRACE HERE)' layer found")
        return

    layer = layers[0]
    features = list(layer.getFeatures())

    if not features:
        print("No structures traced yet! Trace structures first (phase4).")
        return

    # Save as GeoJSON
    _save_layer_geojson(layer, str(STRUCTURES_GEOJSON))
    print(f"✓ Structures GeoJSON saved to {STRUCTURES_GEOJSON}")

    # Generate SQL
    print("\n" + "=" * 60)
    print("SQL TO POPULATE PostGIS structures.footprint_geom")
    print("=" * 60)
    print()

    for feat in features:
        name = feat['name'] or 'Unknown'
        geom = feat.geometry()
        if geom.isEmpty():
            continue

        wkt = geom.asWkt()
        stype = feat['structure_type'] or 'other'
        use = feat['use_type'] or 'storage'
        permit = feat['permit_status'] or 'unpermitted'

        # Compute area
        d = QgsDistanceArea()
        d.setEllipsoid('WGS84')
        area_m2 = d.measureArea(geom)
        area_sqft = area_m2 * 10.7639

        # Compute centroid
        centroid = geom.centroid().asPoint()

        print(f"-- {name}")
        print(f"UPDATE structures SET")
        print(f"  footprint_geom = ST_GeomFromText('{wkt}', 4326),")
        print(f"  centroid_geom = ST_GeomFromText('POINT({centroid.x():.7f} {centroid.y():.7f})', 4326),")
        print(f"  area_sqft = {area_sqft:.1f},")
        print(f"  updated_at = NOW()")
        print(f"WHERE name = '{name}' AND parcel_id = 1;")
        print()

    # Also generate setback measurements via PostGIS
    print("-- Auto-compute setback distances from PostGIS geometry")
    print("""
UPDATE structures s SET
  nearest_edge_distance_ft = sub.min_dist_ft,
  nearest_edge_side = sub.nearest_side
FROM (
  SELECT DISTINCT ON (s2.id)
    s2.id AS structure_id,
    e.edge_side AS nearest_side,
    ST_Distance(
      s2.footprint_geom::geography,
      e.edge_geom::geography
    ) * 3.28084 AS min_dist_ft
  FROM structures s2
  JOIN parcel_edges e ON e.parcel_id = s2.parcel_id
  WHERE s2.footprint_geom IS NOT NULL
    AND e.edge_geom IS NOT NULL
  ORDER BY s2.id, ST_Distance(s2.footprint_geom::geography, e.edge_geom::geography)
) sub
WHERE s.id = sub.structure_id;

-- Recompute compliance
UPDATE structures SET
  setback_compliant = (nearest_edge_distance_ft >= setback_required_ft),
  setback_surplus_ft = nearest_edge_distance_ft - setback_required_ft
WHERE footprint_geom IS NOT NULL;
""")


def _save_layer_geojson(layer, path):
    """Save a vector layer to GeoJSON."""
    QgsVectorFileWriter.writeAsVectorFormat(
        layer, path, "UTF-8",
        QgsCoordinateReferenceSystem("EPSG:4326"),
        "GeoJSON"
    )


# ═══════════════════════════════════════════════════════════════════════════
# FULL WORKFLOW
# ═══════════════════════════════════════════════════════════════════════════

def run_full_workflow():
    """Run all phases in sequence with pauses for manual steps."""
    print("╔" + "═" * 58 + "╗")
    print("║  QGIS Georeferencing — 160 Still Forest Dr              ║")
    print("║  Parcel 44401, Lot 14-B, Block 6, Blue Bonnet Acres     ║")
    print("╚" + "═" * 58 + "╝")
    print()
    print("This script has 5 phases. Run each one, complete the")
    print("manual steps, then proceed to the next.")
    print()
    print("  phase1_setup_basemaps()        — Load aerial imagery")
    print("  phase2_create_parcel()         — Create parcel boundary")
    print("  phase3_georeference_survey()   — Georeference survey PNG")
    print("  phase4_create_structures_layer() — Set up structure tracing")
    print("  phase5_export_structures()     — Export to GeoJSON + SQL")
    print()
    print("Starting Phase 1...")
    print()

    phase1_setup_basemaps_and_pin()


# Auto-run if executed directly in QGIS console
if __name__ == '__console__' or __name__ == '__main__':
    run_full_workflow()
