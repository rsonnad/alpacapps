#!/usr/bin/env python3
"""Generate a raised-text plant marker STL and matching SVG preview.

Dimensions are millimeters. Text is built from SignPainter HouseScript outlines
so the printable letters feel more like a garden label than a block sign.
"""

from __future__ import annotations

import math
from pathlib import Path

try:
    import mapbox_earcut as earcut
    import numpy as np
    from fontTools.pens.basePen import BasePen
    from fontTools.ttLib import TTFont
except ImportError as exc:
    raise SystemExit(
        "Missing maker font dependencies. Run: "
        "python3 -m pip install --user fonttools mapbox-earcut"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tmp" / "prints" / "peppermint-marker.stl"
PREVIEW = ROOT / "tmp" / "prints" / "peppermint-marker-preview.svg"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/SignPainter.ttc")
FONT_NUMBER = 0
FONT_FAMILY = "SignPainter-HouseScript"

LABEL = "PEPPERMINT"
TAG_W = 63.5       # 2.5 in
TAG_H = 38.1       # 1.5 in
SPIKE_L = 88.9     # 3.5 in
SPIKE_W = 9.525    # 0.375 in straight stake
BASE_Z = 3.175     # 0.125 in sign/stake body
RIM_Z = 3.75
TEXT_Z = 4.25

triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []


def normal(a, b, c):
    ux, uy, uz = (b[i] - a[i] for i in range(3))
    vx, vy, vz = (c[i] - a[i] for i in range(3))
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return nx / length, ny / length, nz / length


def tri(a, b, c):
    triangles.append((a, b, c))


def polygon_area(poly):
    return sum(
        poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
        for i in range(len(poly))
    ) / 2


def contains(poly, point):
    x, y = point
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def prism(poly, z0, z1):
    n = len(poly)
    bottom = [(x, y, z0) for x, y in poly]
    top = [(x, y, z1) for x, y in poly]
    for i in range(1, n - 1):
        tri(top[0], top[i], top[i + 1])
        tri(bottom[0], bottom[i + 1], bottom[i])
    for i in range(n):
        j = (i + 1) % n
        tri(bottom[i], bottom[j], top[j])
        tri(bottom[i], top[j], top[i])


def box(cx, cy, w, h, z0, z1):
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1)


class FlattenPen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours: list[list[tuple[float, float]]] = []
        self.current: list[tuple[float, float]] = []

    def _moveTo(self, p0):
        if self.current:
            self.contours.append(self.current)
        self.current = [p0]

    def _lineTo(self, p1):
        self.current.append(p1)

    def _qCurveToOne(self, p1, p2):
        p0 = self.current[-1]
        for i in range(1, 9):
            t = i / 8
            x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1]
            self.current.append((x, y))

    def _curveToOne(self, p1, p2, p3):
        p0 = self.current[-1]
        for i in range(1, 11):
            t = i / 10
            x = (
                (1 - t) ** 3 * p0[0]
                + 3 * (1 - t) ** 2 * t * p1[0]
                + 3 * (1 - t) * t**2 * p2[0]
                + t**3 * p3[0]
            )
            y = (
                (1 - t) ** 3 * p0[1]
                + 3 * (1 - t) ** 2 * t * p1[1]
                + 3 * (1 - t) * t**2 * p2[1]
                + t**3 * p3[1]
            )
            self.current.append((x, y))

    def _closePath(self):
        if len(self.current) > 2:
            self.contours.append(self.current)
        self.current = []

    def _endPath(self):
        self._closePath()


def font_contours(text):
    font = TTFont(FONT_PATH, fontNumber=FONT_NUMBER)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"].metrics
    x_cursor = 0
    contours = []

    for char in text:
        glyph_name = cmap[ord(char)]
        pen = FlattenPen(glyph_set)
        glyph_set[glyph_name].draw(pen)
        if pen.current:
            pen.contours.append(pen.current)
        for contour in pen.contours:
            contours.append([(x + x_cursor, y) for x, y in contour if contour])
        x_cursor += hmtx[glyph_name][0]

    min_x = min(x for c in contours for x, _ in c)
    max_x = max(x for c in contours for x, _ in c)
    min_y = min(y for c in contours for _, y in c)
    max_y = max(y for c in contours for _, y in c)
    target_w = TAG_W - 9.0
    target_h = 14.0
    scale = min(target_w / (max_x - min_x), target_h / (max_y - min_y))
    text_w = (max_x - min_x) * scale
    text_h = (max_y - min_y) * scale
    offset_x = (TAG_W - text_w) / 2 - min_x * scale
    offset_y = SPIKE_L + (TAG_H - text_h) / 2 - min_y * scale

    return [[(x * scale + offset_x, y * scale + offset_y) for x, y in c] for c in contours]


def add_text():
    contours = [c for c in font_contours(LABEL) if len(c) >= 3 and abs(polygon_area(c)) > 0.01]
    groups = [{"outer": c, "holes": []} for c in contours]

    for group in list(groups):
        point = group["outer"][0]
        containers = [
            candidate
            for candidate in groups
            if candidate is not group and abs(polygon_area(candidate["outer"])) > abs(polygon_area(group["outer"])) and contains(candidate["outer"], point)
        ]
        if containers:
            parent = min(containers, key=lambda g: abs(polygon_area(g["outer"])))
            parent["holes"].append(group["outer"])
            groups.remove(group)

    for group in groups:
        rings = [group["outer"], *group["holes"]]
        vertices = []
        ring_ends = []
        for ring in rings:
            vertices.extend(ring)
            ring_ends.append(len(vertices))

        verts = np.array(vertices, dtype=np.float64)
        indices = earcut.triangulate_float64(verts, np.array(ring_ends, dtype=np.uint32))
        for i in range(0, len(indices), 3):
            a, b, c = (tuple(verts[indices[i + j]]) for j in range(3))
            tri((a[0], a[1], TEXT_Z), (b[0], b[1], TEXT_Z), (c[0], c[1], TEXT_Z))
            tri((a[0], a[1], BASE_Z), (c[0], c[1], BASE_Z), (b[0], b[1], BASE_Z))
        for ring in rings:
            for i, a in enumerate(ring):
                b = ring[(i + 1) % len(ring)]
                tri((a[0], a[1], BASE_Z), (b[0], b[1], BASE_Z), (b[0], b[1], TEXT_Z))
                tri((a[0], a[1], BASE_Z), (b[0], b[1], TEXT_Z), (a[0], a[1], TEXT_Z))


def add_model():
    box(TAG_W / 2, SPIKE_L + TAG_H / 2, TAG_W, TAG_H, 0, BASE_Z)
    box(TAG_W / 2, SPIKE_L / 2, SPIKE_W, SPIKE_L, 0, BASE_Z)
    box(TAG_W / 2, SPIKE_L + TAG_H - 2.0, TAG_W - 3.0, 1.3, BASE_Z, RIM_Z)
    box(2.0, SPIKE_L + TAG_H / 2, 1.3, TAG_H - 3.0, BASE_Z, RIM_Z)
    box(TAG_W / 2, SPIKE_L + 2.0, TAG_W - 3.0, 1.3, BASE_Z, RIM_Z)
    box(TAG_W - 2.0, SPIKE_L + TAG_H / 2, 1.3, TAG_H - 3.0, BASE_Z, RIM_Z)
    add_text()


def write_ascii_stl(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="ascii") as f:
        f.write("solid peppermint_marker\n")
        for a, b, c in triangles:
            nx, ny, nz = normal(a, b, c)
            f.write(f"  facet normal {nx:.6g} {ny:.6g} {nz:.6g}\n")
            f.write("    outer loop\n")
            for p in (a, b, c):
                f.write(f"      vertex {p[0]:.6g} {p[1]:.6g} {p[2]:.6g}\n")
            f.write("    endloop\n")
            f.write("  endfacet\n")
        f.write("endsolid peppermint_marker\n")


def write_svg_preview(path: Path):
    scale = 4
    margin = 8

    def sx(x):
        return margin + x * scale

    def sy(y):
        return margin + (SPIKE_L + TAG_H - y) * scale

    outline = [
        ((TAG_W - SPIKE_W) / 2, 0),
        ((TAG_W - SPIKE_W) / 2, SPIKE_L),
        (0, SPIKE_L),
        (0, SPIKE_L + TAG_H),
        (TAG_W, SPIKE_L + TAG_H),
        (TAG_W, SPIKE_L),
        ((TAG_W + SPIKE_W) / 2, SPIKE_L),
        ((TAG_W + SPIKE_W) / 2, 0),
    ]
    poly = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in outline)
    text_path = []
    for contour in font_contours(LABEL):
        if len(contour) < 3 or abs(polygon_area(contour)) <= 0.01:
            continue
        first = contour[0]
        text_path.append(f"M {sx(first[0]):.2f} {sy(first[1]):.2f}")
        for x, y in contour[1:]:
            text_path.append(f"L {sx(x):.2f} {sy(y):.2f}")
        text_path.append("Z")
    text_d = " ".join(text_path)
    width = TAG_W * scale + margin * 2
    height = (SPIKE_L + TAG_H) * scale + margin * 2
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="ascii") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}">\n')
        f.write('  <rect width="100%" height="100%" fill="#f7efe4"/>\n')
        f.write(f'  <polygon points="{poly}" fill="#2d3b37" stroke="#111" stroke-width="1.5"/>\n')
        f.write(f'  <rect x="{sx(2):.1f}" y="{sy(SPIKE_L + TAG_H - 2):.1f}" width="{(TAG_W - 4) * scale:.1f}" height="{(TAG_H - 4) * scale:.1f}" fill="none" stroke="#d8e6dd" stroke-width="{1.3 * scale:.1f}"/>\n')
        f.write(f'  <path d="{text_d}" fill="#d8e6dd" fill-rule="evenodd"/>\n')
        f.write("</svg>\n")


if __name__ == "__main__":
    add_model()
    write_ascii_stl(OUT)
    write_svg_preview(PREVIEW)
    print(OUT)
    print(PREVIEW)
