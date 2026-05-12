#!/usr/bin/env python3
"""Render the printable plant-marker STL through Blender.

Run after `python3 tools/generate-plant-marker-stl.py`:
  blender --background --python tools/render-plant-marker-blender.py
"""

from __future__ import annotations

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
STL_IN = ROOT / "tmp" / "prints" / "peppermint-marker.stl"
PNG_OUT = ROOT / "tmp" / "prints" / "peppermint-marker-blender-render.png"
BLEND_OUT = ROOT / "tmp" / "prints" / "peppermint-marker-render.blend"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 0.001


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    return mat


def import_marker():
    if not STL_IN.exists():
        raise SystemExit(f"Missing STL: {STL_IN}")

    bpy.ops.wm.stl_import(filepath=str(STL_IN))
    obj = bpy.context.object
    obj.name = "printable_peppermint_marker"

    base_mat = material("printed_dark_green", (0.07, 0.13, 0.11, 1))
    raised_mat = material("raised_lettering_preview", (0.82, 0.90, 0.84, 1))
    obj.data.materials.append(base_mat)
    obj.data.materials.append(raised_mat)

    for poly in obj.data.polygons:
        z = sum(obj.data.vertices[i].co.z for i in poly.vertices) / len(poly.vertices)
        poly.material_index = 1 if z > 2.02 else 0

    return obj


def setup_scene():
    bpy.ops.object.light_add(type="AREA", location=(18, 86, 130))
    light = bpy.context.object
    light.data.energy = 480
    light.data.size = 80

    bpy.ops.object.camera_add(location=(38.1, 76.2, 230), rotation=(0, 0, 0))
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 165
    bpy.context.scene.camera = cam

    bpy.context.scene.render.engine = "BLENDER_WORKBENCH"
    bpy.context.scene.display.shading.light = "STUDIO"
    bpy.context.scene.display.shading.color_type = "MATERIAL"
    bpy.context.scene.display.shading.background_type = "VIEWPORT"
    bpy.context.scene.display.shading.background_color = (0.91, 0.87, 0.79)
    bpy.context.scene.render.resolution_x = 1400
    bpy.context.scene.render.resolution_y = 1800


def render():
    PNG_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(PNG_OUT)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    bpy.ops.render.render(write_still=True)
    print(PNG_OUT)
    print(BLEND_OUT)


def main():
    reset_scene()
    import_marker()
    setup_scene()
    render()


if __name__ == "__main__":
    main()
