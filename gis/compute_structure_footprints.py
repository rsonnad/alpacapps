#!/usr/bin/env python3
"""
Compute structure footprint polygons from survey pixel positions.

Uses the georeferenced survey TIFF to transform pixel coordinates
to real-world GPS coordinates, then generates rectangular footprints
using known structure dimensions and orientation.

Source data:
  - Structure pixel positions: measured from survey-ward-2025.png (2731x1821)
  - Structure dimensions: from siteplan.html fallback data
  - Setback distances: from 4Ward survey annotations
  - Parcel corners: from Bastrop County GIS

Run on Alpaca Mac:
  cd ~/Documents/gis/still-forest
  python3 compute_structure_footprints.py
"""

import json
import math

# ─── Parcel Corners (from Bastrop County GIS) ────────────────────────────
CORNERS = {
    'SW': (-97.4598027, 30.1305679),
    'NW': (-97.4609315, 30.1310636),
    'NE': (-97.4606605, 30.1315233),
    'SE': (-97.4595314, 30.1310274),
}

# ─── GCP Pixel-to-GPS Mapping (used for georeferencing) ─────────────────
# These are the 4 control points used in gdal_translate
GCPS = [
    # (pixel_x, pixel_y, lon, lat)
    (530, 1580, -97.4598027, 30.1305679),   # SW
    (730, 130, -97.4609315, 30.1310636),     # NW
    (1560, 100, -97.4606605, 30.1315233),    # NE
    (1480, 1460, -97.4595314, 30.1310274),   # SE
]


def pixel_to_gps(px, py):
    """
    Convert survey PNG pixel coords to GPS using bilinear interpolation
    from the 4 GCPs. This is an approximation — the actual GDAL TPS
    transform is more accurate, but this is close enough for structure
    placement (structures are small relative to the parcel).
    """
    # Build affine transform from 4 GCPs using least-squares
    # pixel (x, y) → GPS (lon, lat) via affine: lon = a*x + b*y + c, lat = d*x + e*y + f
    import numpy as np

    px_coords = [(g[0], g[1]) for g in GCPS]
    gps_coords = [(g[2], g[3]) for g in GCPS]

    # Solve for affine coefficients
    A = []
    b_lon = []
    b_lat = []
    for (x, y), (lon, lat) in zip(px_coords, gps_coords):
        A.append([x, y, 1])
        b_lon.append(lon)
        b_lat.append(lat)

    A = np.array(A)
    lon_coeffs = np.linalg.lstsq(A, b_lon, rcond=None)[0]
    lat_coeffs = np.linalg.lstsq(A, b_lat, rcond=None)[0]

    lon = lon_coeffs[0] * px + lon_coeffs[1] * py + lon_coeffs[2]
    lat = lat_coeffs[0] * px + lat_coeffs[1] * py + lat_coeffs[2]

    return lon, lat


def pixel_to_gps_simple(px, py):
    """
    Simpler pixel-to-GPS conversion without numpy dependency.
    Uses weighted average of GCPs based on inverse distance.
    """
    total_w = 0
    lon_sum = 0
    lat_sum = 0

    for gx, gy, glon, glat in GCPS:
        dist = math.sqrt((px - gx) ** 2 + (py - gy) ** 2)
        if dist < 1:
            return glon, glat
        w = 1.0 / (dist ** 2)
        total_w += w
        lon_sum += w * (glon + (px - gx) * (GCPS[2][2] - GCPS[0][2]) / (GCPS[2][0] - GCPS[0][0]))
        lat_sum += w * (glat + (py - gy) * (GCPS[0][3] - GCPS[1][3]) / (GCPS[0][1] - GCPS[1][1]))

    return lon_sum / total_w, lat_sum / total_w


def make_affine_transform():
    """Build affine transform matrix from GCPs."""
    # Simple affine: use 3 points to solve exactly, verify with 4th
    # Points: SW (0), NW (1), NE (2)
    x0, y0, lon0, lat0 = GCPS[0]
    x1, y1, lon1, lat1 = GCPS[1]
    x2, y2, lon2, lat2 = GCPS[2]

    # Solve: [lon] = [a b] [x] + [e]
    #        [lat]   [c d] [y]   [f]
    det = (x0 - x2) * (y0 - y1) - (x0 - x1) * (y0 - y2)
    if abs(det) < 1e-10:
        raise ValueError("GCPs are collinear")

    a = ((lon0 - lon2) * (y0 - y1) - (lon0 - lon1) * (y0 - y2)) / det
    b = ((lon0 - lon1) * (x0 - x2) - (lon0 - lon2) * (x0 - x1)) / det
    c = ((lat0 - lat2) * (y0 - y1) - (lat0 - lat1) * (y0 - y2)) / det
    d = ((lat0 - lat1) * (x0 - x2) - (lat0 - lat2) * (x0 - x1)) / det
    e = lon0 - a * x0 - b * y0
    f = lat0 - c * x0 - d * y0

    # Verify with 4th point (SE)
    x3, y3, lon3, lat3 = GCPS[3]
    lon_check = a * x3 + b * y3 + e
    lat_check = c * x3 + d * y3 + f
    err_m = math.sqrt(
        ((lon_check - lon3) * 96300) ** 2 +
        ((lat_check - lat3) * 111320) ** 2
    )
    print(f"  Affine verification error (4th GCP): {err_m:.1f} m")

    return a, b, c, d, e, f


def px2gps(px, py, transform):
    """Apply affine transform."""
    a, b, c, d, e, f = transform
    lon = a * px + b * py + e
    lat = c * px + d * py + f
    return lon, lat


def make_footprint(center_lon, center_lat, width_ft, length_ft, rotation_deg=0):
    """
    Create a rectangular footprint polygon.

    The property is oriented at ~27° from north (road runs NNE).
    Structures are generally aligned with the property boundaries.

    Args:
        center_lon, center_lat: center point GPS
        width_ft, length_ft: structure dimensions in feet
        rotation_deg: rotation from north in degrees (0 = north-aligned,
                      27 = aligned with property/road)
    Returns:
        List of (lon, lat) tuples forming a closed polygon
    """
    # Convert dimensions to degrees
    m_per_deg_lat = 111320
    m_per_deg_lon = 111320 * math.cos(math.radians(center_lat))

    half_w = (width_ft * 0.3048 / 2) / m_per_deg_lon
    half_l = (length_ft * 0.3048 / 2) / m_per_deg_lat

    rot = math.radians(rotation_deg)

    corners = []
    for dx, dy in [(-half_w, -half_l), (half_w, -half_l),
                    (half_w, half_l), (-half_w, half_l)]:
        # Rotate
        rx = dx * math.cos(rot) - dy * math.sin(rot)
        ry = dx * math.sin(rot) + dy * math.cos(rot)
        corners.append((center_lon + rx, center_lat + ry))

    corners.append(corners[0])  # close ring
    return corners


# ─── Structure Definitions ───────────────────────────────────────────────
# Pixel positions measured from survey-ward-2025.png (2731 x 1821)
# Dimensions from siteplan.html / survey annotations
# Rotation: ~27° matches property/road alignment

STRUCTURES = [
    {
        "name": "Main House",
        "pixel": (1600, 490),       # 2-Story Stone & Frame Residence
        "width_ft": 45, "length_ft": 35,
        "height_ft": 24, "stories": 2,
        "type": "house", "use": "primary_residence",
        "material": "stone_frame",
        "roof": "gable",
        "permit": "permitted",
        "rotation": 27,
        "setback_side": "S", "setback_dist": 50,
    },
    {
        "name": "1-Story Wood Bldg",
        "pixel": (1250, 190),       # Back House / "STORY WOOD" on survey
        "width_ft": 30, "length_ft": 20,
        "height_ft": 12, "stories": 1,
        "type": "outbuilding", "use": "lodging",
        "material": "wood",
        "roof": "gable",
        "permit": "permitted",
        "rotation": 27,
        "setback_side": "N", "setback_dist": 30,
    },
    {
        "name": "Deck",
        "pixel": (1170, 380),       # "Deck" + "Hot Tub" on survey
        "width_ft": 16, "length_ft": 12,
        "height_ft": 2, "stories": 1,
        "type": "deck", "use": "amenity",
        "material": "wood",
        "roof": "none",
        "permit": "permitted",
        "rotation": 27,
        "setback_side": "W", "setback_dist": 13.4,
    },
    {
        "name": "Sauna",
        "pixel": (1100, 300),       # Near deck area, west of main structures
        "width_ft": 8, "length_ft": 8,
        "height_ft": 8, "stories": 1,
        "type": "sauna", "use": "amenity",
        "material": "wood",
        "roof": "shed",
        "permit": "permitted",
        "rotation": 27,
        "setback_side": "W", "setback_dist": 30,
    },
    {
        "name": "Big Trailer (10x42)",
        "pixel": (1240, 1020),      # "trailer 10'x42'" on survey
        "width_ft": 10, "length_ft": 42,
        "height_ft": 10, "stories": 1,
        "type": "trailer_rv", "use": "lodging",
        "material": "rv",
        "roof": "flat",
        "permit": "violation",
        "rotation": 117,            # perpendicular to road (27+90)
        "setback_side": "W", "setback_dist": 1,
    },
    {
        "name": "Red Container #1 (40x8)",
        "pixel": (1250, 820),       # container stack, above trailer
        "width_ft": 8, "length_ft": 40,
        "height_ft": 8.5, "stories": 1,
        "type": "container", "use": "storage",
        "material": "steel_container",
        "roof": "flat",
        "permit": "violation",
        "rotation": 117,
        "setback_side": "W", "setback_dist": 2,
    },
    {
        "name": "Red Container #2 (40x8)",
        "pixel": (1260, 870),       # adjacent to #1
        "width_ft": 8, "length_ft": 40,
        "height_ft": 8.5, "stories": 1,
        "type": "container", "use": "storage",
        "material": "steel_container",
        "roof": "flat",
        "permit": "violation",
        "rotation": 117,
        "setback_side": "W", "setback_dist": 2,
    },
    {
        "name": "Container #3 (40x8)",
        "pixel": (1250, 740),       # "container 8'x8'" area on survey
        "width_ft": 8, "length_ft": 40,
        "height_ft": 8.5, "stories": 1,
        "type": "container", "use": "storage",
        "material": "steel_container",
        "roof": "flat",
        "permit": "violation",
        "rotation": 117,
        "setback_side": "W", "setback_dist": 5,
    },
    {
        "name": "Beige Container (40x8)",
        "pixel": (1420, 1460),      # "container 40'x8'" near south boundary
        "width_ft": 8, "length_ft": 40,
        "height_ft": 8.5, "stories": 1,
        "type": "container", "use": "storage",
        "material": "steel_container",
        "roof": "flat",
        "permit": "violation",
        "rotation": 27,
        "setback_side": "S", "setback_dist": 6,
    },
    {
        "name": "Bathroom Bldg",
        "pixel": (1520, 650),       # service building, east side
        "width_ft": 10, "length_ft": 12,
        "height_ft": 10, "stories": 1,
        "type": "outbuilding", "use": "service",
        "material": "wood",
        "roof": "shed",
        "permit": "unpermitted",
        "rotation": 27,
        "setback_side": "E", "setback_dist": 10,
    },
    {
        "name": "Small Trailer (7.5x20.5)",
        "pixel": (1550, 730),       # RV, east side near bathroom
        "width_ft": 7.5, "length_ft": 20.5,
        "height_ft": 9, "stories": 1,
        "type": "trailer_rv", "use": "lodging",
        "material": "rv",
        "roof": "flat",
        "permit": "violation",
        "rotation": 117,
        "setback_side": "E", "setback_dist": 7,
    },
]


def main():
    print("=" * 70)
    print("STRUCTURE FOOTPRINT COMPUTATION")
    print("160 Still Forest Dr — 11 Structures")
    print("=" * 70)

    # Build affine transform from GCPs
    print("\nBuilding affine transform from GCPs...")
    transform = make_affine_transform()

    # Convert each structure
    features = []
    print(f"\n{'Structure':<30} {'Center GPS':>28} {'Area (sqft)':>12}")
    print(f"{'─' * 30} {'─' * 28} {'─' * 12}")

    for s in STRUCTURES:
        px, py = s['pixel']
        lon, lat = px2gps(px, py, transform)
        area = s['width_ft'] * s['length_ft']

        footprint = make_footprint(lon, lat, s['width_ft'], s['length_ft'], s['rotation'])

        print(f"{s['name']:<30} ({lat:.6f}, {lon:.6f}) {area:>10.0f}")

        feature = {
            "type": "Feature",
            "properties": {
                "name": s['name'],
                "structure_type": s['type'],
                "use_type": s['use'],
                "width_ft": s['width_ft'],
                "length_ft": s['length_ft'],
                "height_ft": s.get('height_ft'),
                "stories": s.get('stories', 1),
                "area_sqft": area,
                "material": s.get('material'),
                "roof_type": s.get('roof'),
                "permit_status": s['permit'],
                "nearest_edge_side": s['setback_side'],
                "nearest_edge_distance_ft": s['setback_dist'],
                "is_movable": s['type'] in ('trailer_rv',),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [footprint]
            }
        }
        features.append(feature)

    # Write GeoJSON
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    path = "structures-44401.geojson"
    with open(path, 'w') as f:
        json.dump(geojson, f, indent=2)
    print(f"\n✓ Structures GeoJSON written to {path}")

    # Generate SQL
    print("\n" + "=" * 70)
    print("SQL TO UPDATE PostGIS structures.footprint_geom")
    print("=" * 70)

    for s, feat in zip(STRUCTURES, features):
        coords = feat['geometry']['coordinates'][0]
        wkt_ring = ", ".join(f"{lon:.7f} {lat:.7f}" for lon, lat in coords)
        centroid_lon = sum(c[0] for c in coords[:-1]) / (len(coords) - 1)
        centroid_lat = sum(c[1] for c in coords[:-1]) / (len(coords) - 1)
        area = s['width_ft'] * s['length_ft']

        print(f"""
-- {s['name']}
UPDATE structures SET
  footprint_geom = ST_GeomFromText('POLYGON(({wkt_ring}))', 4326),
  centroid_geom = ST_GeomFromText('POINT({centroid_lon:.7f} {centroid_lat:.7f})', 4326),
  area_sqft = {area:.1f},
  nearest_edge_side = '{s['setback_side']}',
  nearest_edge_distance_ft = {s['setback_dist']},
  setback_required_ft = {20 if s['setback_side'] == 'S' else 10},
  setback_compliant = {str(s['setback_dist'] >= (20 if s['setback_side'] == 'S' else 10)).upper()},
  setback_surplus_ft = {s['setback_dist'] - (20 if s['setback_side'] == 'S' else 10)},
  updated_at = NOW()
WHERE name ILIKE '%{s['name'].split('(')[0].strip()}%' AND parcel_id = 1;""")

    # Auto-recompute setback distances from geometry
    print("""
-- Auto-recompute setback distances from actual geometry
-- (more accurate than manual measurements — run AFTER all footprints are set)
UPDATE structures s SET
  nearest_edge_distance_ft = sub.min_dist_ft,
  nearest_edge_side = sub.nearest_side,
  setback_required_ft = CASE sub.nearest_side
    WHEN 'S' THEN 20  -- Local Rural Road
    ELSE 10            -- property line
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
""")


if __name__ == '__main__':
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
