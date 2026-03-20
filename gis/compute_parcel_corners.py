#!/usr/bin/env python3
"""
Parcel corner coordinates for 160 Still Forest Dr, Cedar Creek TX 78612.

Source: Bastrop County GIS FeatureServer (prop_id=44401)
  https://services3.arcgis.com/wdTkTU0MdZbNBEZy/arcgis/rest/services/Parcel/FeatureServer/0
  Queried: 2026-03-20

Property: Lot 14-B, Block 6, Bluebonnet Acres, Section 1
Survey: 4Ward Land Surveying, 2/4/2021, Jason Ward R.P.L.S. #5811

Usage:
  python3 compute_parcel_corners.py
  # Generates: parcel-44401.geojson, GDAL commands, PostGIS SQL
"""

import json
import math
import os

# ─── REAL Parcel Corners from Bastrop County GIS ─────────────────────────
# These are the AUTHORITATIVE coordinates from the county GIS system.
# 4 vertices forming a quadrilateral (county data doesn't include SE jog).
# Ring order: SE → SW → NW → NE → SE (closing)

PARCEL_RING = [
    (-97.4595314, 30.1310274),  # SE corner (on Still Forest Dr)
    (-97.4598027, 30.1305679),  # SW corner (on Still Forest Dr)
    (-97.4609315, 30.1310636),  # NW corner
    (-97.4606605, 30.1315233),  # NE corner
    (-97.4595314, 30.1310274),  # close ring
]

# Named corners for GCP usage (lon, lat)
CORNERS = {
    'SW': (-97.4598027, 30.1305679),
    'NW': (-97.4609315, 30.1310636),
    'NE': (-97.4606605, 30.1315233),
    'SE': (-97.4595314, 30.1310274),
}

# Property metadata
PARCEL = {
    'prop_id': '44401',
    'ref_id': 'R44401',
    'name': '160 Still Forest Dr',
    'city': 'Cedar Creek',
    'county': 'Bastrop',
    'state': 'TX',
    'zip': '78612',
    'subdivision': 'Bluebonnet Acres',
    'section': '1',
    'lot': '14-B',
    'block': '6',
    'calc_acre': 1.725,
    'area_sqft': 75123,
    'survey_acre': 1.7348,
    'survey_sqft': 75133,
    'survey_by': '4Ward Land Surveying',
    'survey_date': '2021-02-04',
    'survey_rpls': '5811',
    'deed': '202109259',
}


def compute_edge_metrics():
    """Compute edge lengths and bearings from corner coordinates."""
    edges = [
        ('South (road)', 'SW', 'SE'),
        ('West',         'SW', 'NW'),
        ('North',        'NW', 'NE'),
        ('East',         'NE', 'SE'),
    ]

    print(f"\n{'Edge':<16} {'Length (ft)':>12} {'Bearing':>16}")
    print(f"{'─' * 16} {'─' * 12} {'─' * 16}")

    for label, c1, c2 in edges:
        lon1, lat1 = CORNERS[c1]
        lon2, lat2 = CORNERS[c2]

        # Distance
        dlat = (lat2 - lat1) * 111320
        dlon = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
        dist_m = math.sqrt(dlat ** 2 + dlon ** 2)
        dist_ft = dist_m / 0.3048

        # Bearing
        azimuth = math.degrees(math.atan2(dlon, dlat)) % 360
        bearing = azimuth_to_bearing(azimuth)

        print(f"{label:<16} {dist_ft:>10.2f} ft  {bearing:>16}")

    print()
    print("Survey edge lengths for comparison:")
    print("  West: 328.51 ft  |  North: 187.92 ft  |  East: 399.94 ft  |  South: ~188 ft")


def azimuth_to_bearing(azimuth):
    """Convert azimuth (0-360) to survey bearing (N/S dd°mm'ss" E/W)."""
    if azimuth <= 90:
        ns, ew, angle = 'N', 'E', azimuth
    elif azimuth <= 180:
        ns, ew, angle = 'S', 'E', 180 - azimuth
    elif azimuth <= 270:
        ns, ew, angle = 'S', 'W', azimuth - 180
    else:
        ns, ew, angle = 'N', 'W', 360 - azimuth

    deg = int(angle)
    mins = int((angle - deg) * 60)
    secs = ((angle - deg) * 60 - mins) * 60
    return f"{ns}{deg:02d}°{mins:02d}'{secs:04.1f}\"{ew}"


def generate_geojson():
    """Generate GeoJSON files for parcel and import into QGIS."""
    geojson = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "name": PARCEL['name'],
                "parcel_number": PARCEL['prop_id'],
                "lot": PARCEL['lot'],
                "block": PARCEL['block'],
                "subdivision": PARCEL['subdivision'],
                "acreage": PARCEL['calc_acre'],
                "area_sqft": PARCEL['area_sqft'],
                "survey_by": PARCEL['survey_by'],
                "survey_date": PARCEL['survey_date'],
                "surveyor_rpls": PARCEL['survey_rpls'],
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [PARCEL_RING]
            }
        }]
    }

    path = "parcel-44401.geojson"
    with open(path, 'w') as f:
        json.dump(geojson, f, indent=2)
    print(f"✓ GeoJSON written to {path}")
    return path


def generate_gcps():
    """
    Generate GDAL GCP commands for georeferencing the survey PNG.

    You MUST measure the pixel coordinates of each corner on the survey PNG.
    Open the survey in Preview/GIMP/QGIS and note the (x, y) pixel position
    of each property corner.
    """
    print("\n" + "=" * 70)
    print("GDAL GEOREFERENCING — Ground Control Points")
    print("=" * 70)
    print()
    print("Step 1: Open survey-ward-2025.png in an image viewer")
    print("        and measure the pixel (x, y) of each property corner.")
    print()
    print("Step 2: Replace the placeholder pixel coords below:")
    print()

    # PLACEHOLDER pixel coords — measure from actual survey PNG!
    # The survey image (~1300x900 based on file size) shows:
    #   - Road at bottom, property extending up-left
    #   - NW corner = upper-left of boundary
    #   - NE corner = upper-right of boundary
    #   - SW corner = lower-left on road
    #   - SE corner = lower-right on road
    pixel_estimates = {
        'SW': (420, 1100),   # Bottom-left on road
        'SE': (870, 950),    # Bottom-right on road
        'NW': (220, 400),    # Top-left
        'NE': (680, 280),    # Top-right
    }

    print("  *** PLACEHOLDER pixel coords — MEASURE ACTUAL VALUES! ***")
    print()

    gcp_args = []
    for name in ['SW', 'NW', 'NE', 'SE']:
        lon, lat = CORNERS[name]
        px, py = pixel_estimates[name]
        gcp_args.append(f"-gcp {px} {py} {lon:.7f} {lat:.7f}")
        print(f"  {name}: pixel ({px:4d}, {py:4d}) → GPS ({lat:.7f}, {lon:.7f})")

    gdal = "/Applications/QGIS-final-4_0_0.app/Contents/MacOS"
    survey = "../jackie/pages/permittingplan/survey-ward-2025.png"

    print(f"""
Step 3: Run on Alpaca Mac (after updating pixel coords):

{gdal}/gdal_translate \\
  -of GTiff -a_srs EPSG:4326 \\
  {' '.join(gcp_args)} \\
  "{survey}" \\
  "survey-georef-temp.tif"

{gdal}/gdalwarp \\
  -r bilinear -tps -co COMPRESS=LZW \\
  "survey-georef-temp.tif" \\
  "survey-georef.tif"

rm survey-georef-temp.tif
{gdal}/gdalinfo survey-georef.tif
""")

    print("Or use QGIS Sketching:")
    print(f"  Layer → Sketching → Open survey PNG")
    print(f"  Add 4 GCPs using the coordinates above")
    print(f"  Transform: Thin Plate Spline → EPSG:4326 → Save as survey-georef.tif")


def generate_sql():
    """Generate SQL to populate PostGIS tables."""
    ring_wkt = ", ".join(f"{lon:.7f} {lat:.7f}" for lon, lat in PARCEL_RING)

    print("\n" + "=" * 70)
    print("SQL TO POPULATE PostGIS")
    print("=" * 70)

    # Parcel boundary
    print(f"""
-- 1. Parcel boundary (from Bastrop County GIS)
UPDATE parcels SET
  boundary_geom = ST_GeomFromText(
    'POLYGON(({ring_wkt}))', 4326
  ),
  parcel_number = '{PARCEL["prop_id"]}',
  legal_description = 'Lot {PARCEL["lot"]}, Block {PARCEL["block"]}, {PARCEL["subdivision"]}, Section {PARCEL["section"]}',
  acreage = {PARCEL["calc_acre"]},
  area_sqft = {PARCEL["area_sqft"]},
  survey_date = '{PARCEL["survey_date"]}',
  survey_by = '{PARCEL["survey_by"]}',
  survey_rpls = '{PARCEL["survey_rpls"]}',
  updated_at = NOW()
WHERE id = 1;""")

    # Parcel edges
    edge_defs = [
        ('S', 'South boundary — Still Forest Dr (CR 329)', 'SW', 'SE', True, 'Still Forest Dr (CR 329)', 'local_rural', 60, 20),
        ('W', 'West boundary — adjoining property', 'SW', 'NW', False, None, None, None, 10),
        ('N', 'North boundary — adjoining property', 'NW', 'NE', False, None, None, None, 10),
        ('E', 'East boundary — P.U.E.', 'NE', 'SE', False, None, None, None, 10),
    ]

    print("\n-- 2. Parcel edges")
    print("DELETE FROM parcel_edges WHERE parcel_id = 1;")
    for side, label, c1, c2, is_road, road_name, road_class, row_ft, setback in edge_defs:
        lon1, lat1 = CORNERS[c1]
        lon2, lat2 = CORNERS[c2]

        # Compute length
        dlat = (lat2 - lat1) * 111320
        dlon = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
        length_ft = math.sqrt(dlat ** 2 + dlon ** 2) / 0.3048

        # Compute bearing
        azimuth = math.degrees(math.atan2(dlon, dlat)) % 360
        bearing = azimuth_to_bearing(azimuth)

        road_cols = ""
        road_vals = ""
        if is_road:
            road_cols = ", is_road_frontage, road_name, road_classification, road_row_ft"
            road_vals = f", TRUE, '{road_name}', '{road_class}', {row_ft}"

        easement = ""
        if side == 'E':
            easement = ", has_easement, easement_type, easement_width_ft"
            easement_vals = ", TRUE, 'P.U.E. and Building Line', 10"
        else:
            easement_vals = ""

        print(f"""
INSERT INTO parcel_edges (parcel_id, edge_side, edge_label, bearing, length_ft, edge_geom,
  setback_required_ft, setback_label{road_cols}{easement})
VALUES (1, '{side}', '{label}', '{bearing}', {length_ft:.2f},
  ST_GeomFromText('LINESTRING({lon1:.7f} {lat1:.7f}, {lon2:.7f} {lat2:.7f})', 4326),
  {setback}, '{"Local Rural Road" if is_road else "property line"}'{road_vals}{easement_vals});""")


def generate_qgis_setup():
    """Print PyQGIS setup instructions."""
    center_lon = sum(c[0] for c in CORNERS.values()) / len(CORNERS)
    center_lat = sum(c[1] for c in CORNERS.values()) / len(CORNERS)

    print("\n" + "=" * 70)
    print("PyQGIS SETUP — Paste into QGIS Python Console")
    print("=" * 70)
    print(f"""
# Load the full workflow script:
exec(open('/Users/alpaca/Documents/gis/still-forest/georef_and_trace.py').read())

# Or quick-load just the parcel GeoJSON:
parcel = QgsVectorLayer('parcel-44401.geojson', 'Parcel 44401', 'ogr')
QgsProject.instance().addMapLayer(parcel)
iface.mapCanvas().setCenter(QgsPointXY({center_lon:.7f}, {center_lat:.7f}))
iface.mapCanvas().zoomScale(2000)
""")


def main():
    print("=" * 70)
    print("PARCEL 44401 — 160 Still Forest Dr, Cedar Creek TX 78612")
    print("Lot 14-B, Block 6, Bluebonnet Acres, Section 1")
    print("=" * 70)

    # Print corners
    print(f"\n{'Corner':<8} {'Latitude':>12} {'Longitude':>13}")
    print(f"{'─' * 8} {'─' * 12} {'─' * 13}")
    for name in ['SW', 'NW', 'NE', 'SE']:
        lon, lat = CORNERS[name]
        print(f"{name:<8} {lat:>12.7f} {lon:>13.7f}")

    print(f"\nCounty area: {PARCEL['area_sqft']:,.0f} sqft ({PARCEL['calc_acre']:.3f} acres)")
    print(f"Survey area: {PARCEL['survey_sqft']:,.0f} sqft ({PARCEL['survey_acre']:.4f} acres)")

    compute_edge_metrics()
    generate_geojson()
    generate_gcps()
    generate_sql()
    generate_qgis_setup()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
