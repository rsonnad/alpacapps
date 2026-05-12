#!/usr/bin/env python3
"""Generate a simple raised-text plant marker STL.

The mesh intentionally uses block-letter strokes so it can be generated without
font/CAD dependencies in automation. Dimensions are in millimeters.
"""

from __future__ import annotations

import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "tmp" / "prints" / "peppermint-marker.stl"


triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []


def normal(a, b, c):
    ux, uy, uz = (b[i] - a[i] for i in range(3))
    vx, vy, vz = (c[i] - a[i] for i in range(3))
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return nx / length, ny / length, nz / length


def tri(a, b, c):
    triangles.append((a, b, c))


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


def stroke(x1, y1, x2, y2, width, z0, z1):
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1
    px, py = -dy / length * width / 2, dx / length * width / 2
    prism(
        [
            (x1 + px, y1 + py),
            (x2 + px, y2 + py),
            (x2 - px, y2 - py),
            (x1 - px, y1 - py),
        ],
        z0,
        z1,
    )


SEGMENTS = {
    "P": ["top", "left", "mid", "ur"],
    "E": ["top", "mid", "bot", "left"],
    "R": ["top", "left", "mid", "ur", "diag2"],
    "M": ["left", "right", "diagDownL", "diagDownR"],
    "I": ["top", "bot", "vc"],
    "N": ["left", "right", "diagFull"],
    "T": ["top", "vc"],
}


def seg_points(seg, ox, oy, w, h):
    x0, x1, x2 = ox, ox + w / 2, ox + w
    y0, y1, y2 = oy, oy + h / 2, oy + h
    return {
        "top": (x0, y2, x2, y2),
        "mid": (x0, y1, x2, y1),
        "bot": (x0, y0, x2, y0),
        "left": (x0, y0, x0, y2),
        "right": (x2, y0, x2, y2),
        "ur": (x2, y1, x2, y2),
        "vc": (x1, y0, x1, y2),
        "diag2": (x0, y1, x2, y0),
        "diagFull": (x0, y2, x2, y0),
        "diagDownL": (x0, y2, x1, y1),
        "diagDownR": (x2, y2, x1, y1),
    }[seg]


def add_text(text):
    letter_w, letter_h, gap = 5.2, 15.0, 1.35
    stroke_w = 1.25
    total_w = len(text) * letter_w + (len(text) - 1) * gap
    start_x = (76.2 - total_w) / 2
    base_y = 126.0
    for idx, ch in enumerate(text):
        ox = start_x + idx * (letter_w + gap)
        for seg in SEGMENTS[ch]:
            stroke(*seg_points(seg, ox, base_y, letter_w, letter_h), stroke_w, 2.0, 3.0)


def add_model():
    tag_w = 76.2
    tag_h = 38.1
    spike_l = 114.3
    spike_top_w = 15.0
    spike_tip_w = 3.0
    # Coordinate system matches the first G-code attempt: tip near Y=0, tag top at Y=152.4.
    outline = [
        ((tag_w - spike_tip_w) / 2, 0),
        ((tag_w - spike_top_w) / 2, spike_l),
        (0, spike_l),
        (0, spike_l + tag_h),
        (tag_w, spike_l + tag_h),
        (tag_w, spike_l),
        ((tag_w + spike_top_w) / 2, spike_l),
        ((tag_w + spike_tip_w) / 2, 0),
    ]
    prism(outline, 0, 2.0)
    # Raised border/rim around label plate.
    box(tag_w / 2, spike_l + tag_h - 2.0, tag_w - 3.0, 1.3, 2.0, 2.45)
    box(2.0, spike_l + tag_h / 2, 1.3, tag_h - 3.0, 2.0, 2.45)
    box(tag_w / 2, spike_l + 2.0, tag_w - 3.0, 1.3, 2.0, 2.45)
    box(tag_w - 2.0, spike_l + tag_h / 2, 1.3, tag_h - 3.0, 2.0, 2.45)
    add_text("PEPPERMINT")


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


if __name__ == "__main__":
    add_model()
    write_ascii_stl(OUT)
    print(OUT)
