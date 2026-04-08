#!/usr/bin/env python3
"""
Fix structure footprint_geom values in Supabase based on survey measurements.

The previous footprints were estimated incorrectly — structures were placed
in wrong positions. This script uses the survey plat measurements (distances
from property lines) to compute accurate GPS footprint polygons.

Usage: python3 fix_footprints.py
"""

import json
import math
import os
import urllib.request

SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk'

HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# ---------------------------------------------------------------------------
# Parcel corners (verified from survey / DB)
# ---------------------------------------------------------------------------
P1 = (-97.4598027, 30.1305679)  # S corner (where S and W edges meet)
P2 = (-97.4595314, 30.1310274)  # E corner (where S and E edges meet)
P3 = (-97.4606605, 30.1315233)  # N corner (where N and E edges meet)
P4 = (-97.4609315, 30.1310636)  # W corner (where N and W edges meet)

# GPS to feet conversion
REF_LAT = 30.131
DEG_TO_FT_LON = math.cos(math.radians(REF_LAT)) * 111_320 * 3.28084  # ~315,730
DEG_TO_FT_LAT = 111_320 * 3.28084  # ~365,222

# ---------------------------------------------------------------------------
# Coordinate system: W edge as primary axis
# ---------------------------------------------------------------------------
# W edge: P4 (north end) → P1 (south end), ~400 ft
# We measure:
#   pos_along: distance from P4 along the W edge toward P1 (0 = N end, 400 = S end)
#   pos_perp:  perpendicular distance from W edge into the property (toward E)

# W edge vector in local feet
def gps_to_ft(lon, lat):
    return ((lon - P4[0]) * DEG_TO_FT_LON, (lat - P4[1]) * DEG_TO_FT_LAT)

P1_ft = gps_to_ft(*P1)  # S corner
P4_ft = (0, 0)           # W corner (origin)

# Direction along W edge (P4 → P1)
dx_w = P1_ft[0] - P4_ft[0]
dy_w = P1_ft[1] - P4_ft[1]
W_LEN = math.sqrt(dx_w**2 + dy_w**2)
# Unit vectors
along_x = dx_w / W_LEN  # along W edge (toward S)
along_y = dy_w / W_LEN
# Perpendicular (into property, toward E edge)
perp_x = -along_y
perp_y = along_x

print(f"W edge: {W_LEN:.1f} ft")
print(f"Along unit: ({along_x:.4f}, {along_y:.4f})")
print(f"Perp unit:  ({perp_x:.4f}, {perp_y:.4f})")

# S edge for beige container placement
P1_ft_s = gps_to_ft(*P1)
P2_ft_s = gps_to_ft(*P2)
dx_s = P2_ft_s[0] - P1_ft_s[0]
dy_s = P2_ft_s[1] - P1_ft_s[1]
S_LEN = math.sqrt(dx_s**2 + dy_s**2)
s_along_x = dx_s / S_LEN
s_along_y = dy_s / S_LEN
# Perpendicular inward (toward N)
s_perp_x = -s_along_y
s_perp_y = s_along_x
# Ensure perpendicular points into property (toward centroid)
cx_ft = sum(gps_to_ft(*p)[0] for p in [P1, P2, P3, P4]) / 4
cy_ft = sum(gps_to_ft(*p)[1] for p in [P1, P2, P3, P4]) / 4
mid_s = ((P1_ft_s[0] + P2_ft_s[0])/2, (P1_ft_s[1] + P2_ft_s[1])/2)
if s_perp_x * (cx_ft - mid_s[0]) + s_perp_y * (cy_ft - mid_s[1]) < 0:
    s_perp_x, s_perp_y = -s_perp_x, -s_perp_y

print(f"S edge: {S_LEN:.1f} ft")


def ft_to_gps(x, y):
    """Convert local feet (relative to P4) back to GPS."""
    lon = x / DEG_TO_FT_LON + P4[0]
    lat = y / DEG_TO_FT_LAT + P4[1]
    return (round(lon, 7), round(lat, 7))


def make_rect_w(pos_along, pos_perp, length, width, align='west'):
    """
    Create a rectangle polygon for a structure.

    pos_along: distance from P4 (N end of W edge) toward P1 (S end)
    pos_perp:  perpendicular distance from W edge into property
    length:    dimension along the alignment axis
    width:     dimension perpendicular to alignment axis
    align:     'west' = parallel to W boundary, 'south' = parallel to S boundary
    """
    # Center point in local feet
    cx = pos_along * along_x + pos_perp * perp_x
    cy = pos_along * along_y + pos_perp * perp_y

    if align == 'west':
        ax, ay = along_x, along_y
        px, py = perp_x, perp_y
    else:  # south
        ax, ay = s_along_x, s_along_y
        px, py = s_perp_x, s_perp_y

    hl = length / 2
    hw = width / 2

    corners_ft = [
        (cx - hl * ax - hw * px, cy - hl * ay - hw * py),
        (cx + hl * ax - hw * px, cy + hl * ay - hw * py),
        (cx + hl * ax + hw * px, cy + hl * ay + hw * py),
        (cx - hl * ax + hw * px, cy - hl * ay + hw * py),
    ]

    corners_gps = [ft_to_gps(x, y) for x, y in corners_ft]
    corners_gps.append(corners_gps[0])  # close ring
    return corners_gps


def make_rect_from_s_edge(pos_along_s, pos_perp_s, length, width, align='south'):
    """
    Create rectangle relative to the S edge.

    pos_along_s: distance along S edge from P1 (SW end) toward P2 (SE end)
    pos_perp_s:  perpendicular distance from S edge into property (toward N)
    """
    cx = P1_ft_s[0] + pos_along_s * s_along_x + pos_perp_s * s_perp_x
    cy = P1_ft_s[1] + pos_along_s * s_along_y + pos_perp_s * s_perp_y

    if align == 'south':
        ax, ay = s_along_x, s_along_y
        px, py = s_perp_x, s_perp_y
    else:
        ax, ay = along_x, along_y
        px, py = perp_x, perp_y

    hl = length / 2
    hw = width / 2

    corners_ft = [
        (cx - hl * ax - hw * px, cy - hl * ay - hw * py),
        (cx + hl * ax - hw * px, cy + hl * ay - hw * py),
        (cx + hl * ax + hw * px, cy + hl * ay + hw * py),
        (cx - hl * ax + hw * px, cy - hl * ay + hw * py),
    ]

    corners_gps = [ft_to_gps(x, y) for x, y in corners_ft]
    corners_gps.append(corners_gps[0])
    return corners_gps


def make_oval(cx_along, cx_perp, rx, ry, n_pts=16):
    """Create an oval polygon at given center."""
    cx = cx_along * along_x + cx_perp * perp_x
    cy = cx_along * along_y + cx_perp * perp_y

    coords = []
    for i in range(n_pts):
        angle = 2 * math.pi * i / n_pts
        # Oval aligned with the property axes
        dx = rx * math.cos(angle) * along_x + ry * math.sin(angle) * perp_x
        dy = rx * math.cos(angle) * along_y + ry * math.sin(angle) * perp_y
        coords.append(ft_to_gps(cx + dx, cy + dy))
    coords.append(coords[0])
    return coords


def make_driveway_polygon():
    """Create a simplified driveway polygon from S edge up to the house area."""
    # Driveway enters from Still Forest Dr, roughly centered on the S edge
    # It curves up to the main house area. Approximate as a wide strip.
    # Entry at ~90 ft along S edge from P1, ~20 ft wide
    # Goes up ~150 ft into property, widening to ~30 ft at the top

    points_ft = []

    # Left edge of driveway (going from road up into property)
    for t in range(11):
        f = t / 10.0
        along_s = 75 + f * 20  # slight curve to the right
        perp_s = f * 160        # goes 160 ft into property
        width_offset = -(10 + f * 10)  # widens from 10 to 20 on left side
        x = P1_ft_s[0] + along_s * s_along_x + perp_s * s_perp_x + width_offset * s_along_x
        y = P1_ft_s[1] + along_s * s_along_y + perp_s * s_perp_y + width_offset * s_along_y
        points_ft.append((x, y))

    # Right edge (reverse direction)
    for t in range(10, -1, -1):
        f = t / 10.0
        along_s = 75 + f * 20
        perp_s = f * 160
        width_offset = (10 + f * 5)  # widens from 10 to 15 on right side
        x = P1_ft_s[0] + along_s * s_along_x + perp_s * s_perp_x + width_offset * s_along_x
        y = P1_ft_s[1] + along_s * s_along_y + perp_s * s_perp_y + width_offset * s_along_y
        points_ft.append((x, y))

    coords = [ft_to_gps(x, y) for x, y in points_ft]
    coords.append(coords[0])
    return coords


def geojson_polygon(coords):
    """Create a GeoJSON Polygon object."""
    return {
        "type": "Polygon",
        "coordinates": [coords],
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}}
    }


# ---------------------------------------------------------------------------
# Structure placement from survey measurements
# ---------------------------------------------------------------------------
# pos_along = distance from P4 (N/W corner) along W edge toward P1 (S corner)
# pos_perp  = perpendicular distance from W edge into property

# From survey plat + notes:
STRUCTURES = {
    # id: (pos_along, pos_perp, length, width, align, description)
    # For structures near W edge: align='west' (long axis parallel to W boundary)
    # For structures near S edge: handled separately

    # Main House — center of property, per survey roughly centered
    1: {'along': 180, 'perp': 95, 'length': 60, 'width': 40, 'align': 'west',
        'name': 'Main House'},

    # Back House — NW of main house
    2: {'along': 140, 'perp': 45, 'length': 30, 'width': 20, 'align': 'west',
        'name': 'Back House'},

    # Big Trailer — 1 ft from W line (notes), mid-property
    3: {'along': 220, 'perp': 6, 'length': 42, 'width': 10, 'align': 'west',
        'name': 'Big Trailer'},

    # Red Container #1 — 2 ft from W line
    4: {'along': 260, 'perp': 6, 'length': 40, 'width': 8, 'align': 'west',
        'name': 'Red Container #1'},

    # Container #3 — 5 ft from W line
    5: {'along': 280, 'perp': 9, 'length': 40, 'width': 8, 'align': 'west',
        'name': 'Container #3'},

    # Deck — attached to south side of main house
    7: {'along': 215, 'perp': 95, 'length': 30, 'width': 24, 'align': 'west',
        'name': 'Deck'},

    # Beige Container — 6 ft from S (road) line; handled via S edge
    # Placed ~50 ft along S edge from P1, 6+4=10 ft perp from S edge center
    8: {'from_s': True, 'along_s': 50, 'perp_s': 10, 'length': 40, 'width': 8,
        'align': 'south', 'name': 'Beige Container'},

    # Bathroom Bldg — near main house, slightly NE
    9: {'along': 165, 'perp': 110, 'length': 17, 'width': 17, 'align': 'west',
        'name': 'Bathroom Bldg'},

    # Small Trailer — 7 ft from E line → perp = 188-7 = 181 ft from W
    10: {'along': 160, 'perp': 178, 'length': 20.4, 'width': 7.4, 'align': 'west',
         'name': 'Small Trailer'},

    # Sauna — near deck area
    11: {'along': 210, 'perp': 78, 'length': 7, 'width': 7, 'align': 'west',
         'name': 'Sauna'},

    # Pond — front (south) of main house, per survey visible as oval
    12: {'along': 240, 'perp': 110, 'type': 'oval', 'rx': 20, 'ry': 10,
         'name': 'Pond'},

    # Gravel Driveway — from S edge curving up
    13: {'type': 'driveway', 'name': 'Gravel Driveway'},

    # Septic System — underground, estimated position
    14: {'along': 300, 'perp': 130, 'length': 50, 'width': 30, 'align': 'west',
         'name': 'Septic System'},

    # Water Well — small point, estimated position
    15: {'along': 120, 'perp': 30, 'length': 3, 'width': 3, 'align': 'west',
         'name': 'Water Well'},
}


def compute_footprint(sid, spec):
    """Compute GeoJSON polygon for a structure."""
    if spec.get('type') == 'oval':
        coords = make_oval(spec['along'], spec['perp'], spec['rx'], spec['ry'])
    elif spec.get('type') == 'driveway':
        coords = make_driveway_polygon()
    elif spec.get('from_s'):
        coords = make_rect_from_s_edge(
            spec['along_s'], spec['perp_s'],
            spec['length'], spec['width'], spec['align']
        )
    else:
        coords = make_rect_w(
            spec['along'], spec['perp'],
            spec['length'], spec['width'], spec['align']
        )
    return geojson_polygon(coords)


def update_structure(sid, geojson):
    """Update a structure's footprint_geom in Supabase."""
    url = f'{SUPABASE_URL}/rest/v1/structures?id=eq.{sid}'
    data = json.dumps({
        'footprint_geom': geojson,
    }).encode()
    req = urllib.request.Request(url, data=data, headers=HEADERS, method='PATCH')
    with urllib.request.urlopen(req) as resp:
        return resp.status


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("Computing correct footprint geometries from survey measurements...\n")

    for sid, spec in sorted(STRUCTURES.items()):
        geojson = compute_footprint(sid, spec)
        ring = geojson['coordinates'][0]

        # Compute center and size for verification
        xs = [gps_to_ft(c[0], c[1])[0] for c in ring[:-1]]
        ys = [gps_to_ft(c[0], c[1])[1] for c in ring[:-1]]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)

        print(f"  #{sid} {spec['name']}: center=({cx:.0f},{cy:.0f}), "
              f"size={w:.0f}x{h:.0f} ft")

        # Update database
        status = update_structure(sid, geojson)
        print(f"    → DB updated (HTTP {status})")

    print("\nAll footprints updated. Run fetch_property_data.py to refresh JSON.")


if __name__ == '__main__':
    main()
