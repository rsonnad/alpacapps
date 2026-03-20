"""
Blender Python script — 3D Property Digital Twin Render
160 Still Forest Drive, Cedar Creek TX 78612

Run headless: blender -b -P render_property.py
Run with GUI: blender -P render_property.py

Data source: Supabase PostGIS 'structures' and 'parcels' tables
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector

# ---------------------------------------------------------------------------
# 0.  CLEAR SCENE
# ---------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for col in bpy.data.collections:
    bpy.data.collections.remove(col)

# ---------------------------------------------------------------------------
# 1.  COORDINATE CONVERSION — GPS → local feet (SW corner = origin)
# ---------------------------------------------------------------------------
# Parcel boundary (lon, lat)
PARCEL_GPS = [
    (-97.45953135, 30.13102745),  # vertex 1 (SE-ish)
    (-97.46066047, 30.15152330),  # vertex 2 (NE-ish)  -- corrected below
    (-97.46093153, 30.13106360),  # vertex 3 (NW-ish)
    (-97.45980270, 30.13056788),  # vertex 4 (SW — origin)
]

# Actual GPS from DB
PARCEL_GPS = [
    (-97.45953135, 30.13102745),
    (-97.46066047, 30.13152330),
    (-97.46093153, 30.13106360),
    (-97.45980270, 30.13056788),
]

REF = PARCEL_GPS[3]  # SW corner as origin

DEG_TO_FT_LON = math.cos(math.radians(30.131)) * 111_320 * 3.28084  # ~315,600 ft/deg
DEG_TO_FT_LAT = 111_320 * 3.28084  # ~365,200 ft/deg

def gps_to_ft(lon, lat):
    """Convert GPS to local feet with SW corner as (0, 0)."""
    x = (lon - REF[0]) * DEG_TO_FT_LON
    y = (lat - REF[1]) * DEG_TO_FT_LAT
    return (x, y)

parcel_ft = [gps_to_ft(lon, lat) for lon, lat in PARCEL_GPS]

# Compute parcel centroid for camera targeting
cx = sum(p[0] for p in parcel_ft) / len(parcel_ft)
cy = sum(p[1] for p in parcel_ft) / len(parcel_ft)

# ---------------------------------------------------------------------------
# 2.  SCALE — work in Blender units where 1 BU = 1 foot
# ---------------------------------------------------------------------------
SCALE = 1.0  # 1 Blender unit = 1 foot

# ---------------------------------------------------------------------------
# 3.  HELPER — create materials
# ---------------------------------------------------------------------------
def make_material(name, color, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat

# Materials
mat_grass     = make_material("Grass",       (0.15, 0.35, 0.08, 1), roughness=0.95)
mat_stone     = make_material("Stone/Frame", (0.55, 0.50, 0.42, 1), roughness=0.85)
mat_wood      = make_material("Wood",        (0.45, 0.30, 0.15, 1), roughness=0.75)
mat_wood_deck = make_material("Wood Deck",   (0.50, 0.35, 0.18, 1), roughness=0.70)
mat_red_steel = make_material("Red Steel",   (0.60, 0.12, 0.10, 1), roughness=0.4, metallic=0.7)
mat_beige_stl = make_material("Beige Steel", (0.65, 0.58, 0.42, 1), roughness=0.4, metallic=0.7)
mat_blue_stl  = make_material("Blue Steel",  (0.15, 0.25, 0.50, 1), roughness=0.4, metallic=0.7)
mat_rv_white  = make_material("RV White",    (0.85, 0.85, 0.82, 1), roughness=0.5, metallic=0.3)
mat_roof_grey = make_material("Roof",        (0.30, 0.30, 0.32, 1), roughness=0.6, metallic=0.4)
mat_sauna     = make_material("Sauna Cedar", (0.55, 0.35, 0.18, 1), roughness=0.6)
mat_road      = make_material("Road",        (0.25, 0.25, 0.25, 1), roughness=0.9)
mat_setback   = make_material("Setback Line",(1.0, 0.3, 0.0, 0.5), roughness=0.5)
mat_setback.blend_method = 'BLEND' if hasattr(mat_setback, 'blend_method') else None

# ---------------------------------------------------------------------------
# 4.  GROUND PLANE (parcel boundary)
# ---------------------------------------------------------------------------
mesh = bpy.data.meshes.new("Parcel")
obj = bpy.data.objects.new("Parcel_Ground", mesh)
bpy.context.collection.objects.link(obj)

bm = bmesh.new()
verts = [bm.verts.new((x * SCALE, y * SCALE, 0)) for x, y in parcel_ft]
bm.faces.new(verts)
bm.to_mesh(mesh)
bm.free()
obj.data.materials.append(mat_grass)

# ---------------------------------------------------------------------------
# 5.  ROAD (south of property)
# ---------------------------------------------------------------------------
# Road runs along south edge, 30 ft wide below the property line
sw = parcel_ft[3]  # (0, 0)
se = parcel_ft[0]  # SE corner

road_dir_x = se[0] - sw[0]
road_dir_y = se[1] - sw[1]
road_len = math.sqrt(road_dir_x**2 + road_dir_y**2)
road_nx = -road_dir_y / road_len  # normal pointing outward (south)
road_ny = road_dir_x / road_len

road_width = 30  # ft
road_verts = [
    (sw[0] - road_dir_x * 0.2, sw[1] - road_dir_y * 0.2, -0.1),
    (se[0] + road_dir_x * 0.2, se[1] + road_dir_y * 0.2, -0.1),
    (se[0] + road_dir_x * 0.2 + road_nx * road_width, se[1] + road_dir_y * 0.2 + road_ny * road_width, -0.1),
    (sw[0] - road_dir_x * 0.2 + road_nx * road_width, sw[1] - road_dir_y * 0.2 + road_ny * road_width, -0.1),
]

mesh_road = bpy.data.meshes.new("Road")
obj_road = bpy.data.objects.new("Still_Forest_Dr", mesh_road)
bpy.context.collection.objects.link(obj_road)
bm = bmesh.new()
rv = [bm.verts.new(v) for v in road_verts]
bm.faces.new(rv)
bm.to_mesh(mesh_road)
bm.free()
obj_road.data.materials.append(mat_road)

# ---------------------------------------------------------------------------
# 6.  STRUCTURES — approximate placement from DB data
# ---------------------------------------------------------------------------
# Since footprint_geom is null for all structures, we place them using
# nearest_edge_side + nearest_edge_distance_ft and reasonable layout logic.
#
# Property layout (looking from road/south):
#   - South edge (road): SW(0,0) to SE(85.6, 167.8)
#   - West edge: SW(0,0) to NW(-356.3, 181.1)
#   - East edge: SE(85.6, 167.8) to NE(-270.7, 348.9)
#   - North edge: NE(-270.7, 348.9) to NW(-356.3, 181.1)

# Edge midpoints and normals for placement
edges = {
    'S': {'start': parcel_ft[3], 'end': parcel_ft[0]},
    'E': {'start': parcel_ft[0], 'end': parcel_ft[1]},
    'N': {'start': parcel_ft[1], 'end': parcel_ft[2]},
    'W': {'start': parcel_ft[2], 'end': parcel_ft[3]},
}

def edge_inward_normal(edge_key):
    """Get unit inward normal for a parcel edge."""
    e = edges[edge_key]
    dx = e['end'][0] - e['start'][0]
    dy = e['end'][1] - e['start'][1]
    length = math.sqrt(dx**2 + dy**2)
    # Normal pointing inward (right-hand turn for CW winding, left for CCW)
    # Our polygon is CCW, so inward normal = (-dy, dx) / length ... let's verify
    nx, ny = -dy / length, dx / length
    # Check it points toward centroid
    mid_x = (e['start'][0] + e['end'][0]) / 2
    mid_y = (e['start'][1] + e['end'][1]) / 2
    to_center_x = cx - mid_x
    to_center_y = cy - mid_y
    if nx * to_center_x + ny * to_center_y < 0:
        nx, ny = -nx, -ny
    return nx, ny

def place_near_edge(edge_key, distance_ft, along_fraction=0.5):
    """Place a point at 'distance_ft' inward from edge, at 'along_fraction' of edge length."""
    e = edges[edge_key]
    # Point along edge
    px = e['start'][0] + (e['end'][0] - e['start'][0]) * along_fraction
    py = e['start'][1] + (e['end'][1] - e['start'][1]) * along_fraction
    # Move inward
    nx, ny = edge_inward_normal(edge_key)
    return (px + nx * distance_ft, py + ny * distance_ft)


def create_box(name, x, y, w, l, h, material, rotation=0):
    """Create a box (building) at (x, y) with dimensions w×l×h feet."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (w, l, h)
    obj.rotation_euler.z = rotation
    obj.data.materials.append(material)
    return obj


def create_roof(name, x, y, w, l, h_base, h_peak, material, rotation=0):
    """Create a simple gable roof."""
    mesh = bpy.data.meshes.new(name + "_roof")
    obj = bpy.data.objects.new(name + "_Roof", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    hw, hl = w / 2, l / 2
    # Roof ridge runs along length (Y axis)
    v0 = bm.verts.new((-hw, -hl, h_base))
    v1 = bm.verts.new((hw, -hl, h_base))
    v2 = bm.verts.new((hw, hl, h_base))
    v3 = bm.verts.new((-hw, hl, h_base))
    v4 = bm.verts.new((0, -hl, h_base + h_peak))
    v5 = bm.verts.new((0, hl, h_base + h_peak))

    bm.faces.new([v0, v1, v4])       # front gable
    bm.faces.new([v2, v3, v5])       # back gable
    bm.faces.new([v0, v4, v5, v3])   # left slope
    bm.faces.new([v1, v2, v5, v4])   # right slope

    bm.to_mesh(mesh)
    bm.free()

    obj.location = (x, y, 0)
    obj.rotation_euler.z = rotation
    obj.data.materials.append(material)
    return obj


# --- Structure placement ---
# We'll spread structures along their nearest edges with offsets to avoid overlap

structures = [
    # (name, width, length, height, edge, dist, along_frac, material, roof)
    # Main House — 2400 sqft, ~40×60, stone/frame, near S at 50 ft
    ("Main_House", 40, 60, 12, 'S', 50, 0.5, mat_stone, True),
    # Deck — 24×30, attached to main house west side
    ("Deck", 24, 30, 2, 'S', 45, 0.3, mat_wood_deck, False),
    # Back House — estimate ~20×30 (600 sqft), wood, near N at 30 ft
    ("Back_House", 20, 30, 10, 'N', 30, 0.5, mat_wood, True),
    # Big Trailer — 10×42, near W at 1 ft
    ("Big_Trailer", 10, 42, 10, 'W', 15, 0.35, mat_rv_white, False),
    # Red Container #1 — 8×40, near W at 2 ft
    ("Red_Container_1", 8, 40, 8.5, 'W', 15, 0.55, mat_red_steel, False),
    # Red Container #2 — 8×40, near E at 13.5 ft
    ("Red_Container_2", 8, 40, 8.5, 'E', 20, 0.55, mat_red_steel, False),
    # Container #3 — 8×40, near W at 5 ft
    ("Container_3", 8, 40, 8.5, 'W', 15, 0.7, mat_blue_stl, False),
    # Beige Container — 8×40, near S at 6 ft
    ("Beige_Container", 8, 40, 8.5, 'S', 25, 0.8, mat_beige_stl, False),
    # Bathroom Bldg — 17×17, near E at 10 ft
    ("Bathroom_Bldg", 17, 17, 9, 'E', 20, 0.35, mat_wood, True),
    # Small Trailer — 7.4×20.4, near E at 7 ft
    ("Small_Trailer", 7.4, 20.4, 9, 'E', 15, 0.7, mat_rv_white, False),
    # Sauna — 7×7, near W at 30 ft
    ("Sauna", 7, 7, 7, 'W', 35, 0.2, mat_sauna, True),
]

# Compute edge-parallel rotation for each edge
edge_rotations = {}
for key, e in edges.items():
    dx = e['end'][0] - e['start'][0]
    dy = e['end'][1] - e['start'][1]
    edge_rotations[key] = math.atan2(dy, dx)

for s in structures:
    name, w, l, h, edge, dist, frac, mat, has_roof = s
    pos = place_near_edge(edge, dist, frac)
    rot = edge_rotations[edge]

    create_box(name, pos[0], pos[1], w, l, h, mat, rotation=rot)

    if has_roof:
        create_roof(name, pos[0], pos[1], w, l, h, 5, mat_roof_grey, rotation=rot)

# ---------------------------------------------------------------------------
# 7.  SETBACK LINES (thin extruded strips along each edge)
# ---------------------------------------------------------------------------
setback_distances = {'S': 20, 'E': 10, 'N': 10, 'W': 10}

for edge_key, dist in setback_distances.items():
    e = edges[edge_key]
    nx, ny = edge_inward_normal(edge_key)

    # Create a thin line at setback distance
    p1 = (e['start'][0] + nx * dist, e['start'][1] + ny * dist, 0.05)
    p2 = (e['end'][0] + nx * dist, e['end'][1] + ny * dist, 0.05)

    # Make it a thin strip (1 ft wide)
    strip_w = 0.5
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    ln = math.sqrt(dx**2 + dy**2)
    perp_x = -dy / ln * strip_w
    perp_y = dx / ln * strip_w

    mesh_sb = bpy.data.meshes.new(f"Setback_{edge_key}")
    obj_sb = bpy.data.objects.new(f"Setback_{edge_key}", mesh_sb)
    bpy.context.collection.objects.link(obj_sb)
    bm = bmesh.new()
    sv = [
        bm.verts.new((p1[0] - perp_x, p1[1] - perp_y, 0.05)),
        bm.verts.new((p2[0] - perp_x, p2[1] - perp_y, 0.05)),
        bm.verts.new((p2[0] + perp_x, p2[1] + perp_y, 0.05)),
        bm.verts.new((p1[0] + perp_x, p1[1] + perp_y, 0.05)),
    ]
    bm.faces.new(sv)
    bm.to_mesh(mesh_sb)
    bm.free()
    obj_sb.data.materials.append(mat_setback)

# ---------------------------------------------------------------------------
# 8.  TREES (scatter some simple cone trees for realism)
# ---------------------------------------------------------------------------
mat_tree_trunk = make_material("TreeTrunk", (0.30, 0.20, 0.10, 1), roughness=0.9)
mat_tree_leaf  = make_material("TreeLeaf",  (0.10, 0.30, 0.05, 1), roughness=0.95)

import random
random.seed(42)

for i in range(30):
    # Random position inside parcel (rejection sampling)
    for _ in range(50):
        rx = cx + random.uniform(-180, 180)
        ry = cy + random.uniform(-180, 180)
        # Simple check — must be at least 15 ft from any structure center
        ok = True
        for s in structures:
            sp = place_near_edge(s[4], s[5], s[6])
            if math.sqrt((rx - sp[0])**2 + (ry - sp[1])**2) < 25:
                ok = False
                break
        if ok:
            break

    trunk_h = random.uniform(15, 30)
    crown_h = random.uniform(12, 20)
    crown_r = random.uniform(6, 12)

    # Trunk
    bpy.ops.mesh.primitive_cylinder_add(radius=0.8, depth=trunk_h,
                                         location=(rx, ry, trunk_h / 2))
    trunk = bpy.context.active_object
    trunk.name = f"TreeTrunk_{i}"
    trunk.data.materials.append(mat_tree_trunk)

    # Crown
    bpy.ops.mesh.primitive_cone_add(radius1=crown_r, radius2=0, depth=crown_h,
                                     location=(rx, ry, trunk_h + crown_h / 2))
    crown = bpy.context.active_object
    crown.name = f"TreeCrown_{i}"
    crown.data.materials.append(mat_tree_leaf)

# ---------------------------------------------------------------------------
# 9.  LIGHTING — Sun matching Cedar Creek latitude (~30.13°N)
# ---------------------------------------------------------------------------
bpy.ops.object.light_add(type='SUN', location=(0, 0, 200))
sun = bpy.context.active_object
sun.name = "Sun"
sun.data.energy = 5
sun.data.angle = math.radians(0.5)  # soft shadows
# Sun position: late morning, looking roughly south-southeast
sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))

# Ambient / fill light
bpy.ops.object.light_add(type='SUN', location=(0, 0, 200))
fill = bpy.context.active_object
fill.name = "Fill_Light"
fill.data.energy = 1.5
fill.rotation_euler = (math.radians(70), math.radians(-40), math.radians(60))

# ---------------------------------------------------------------------------
# 10. WORLD (sky)
# ---------------------------------------------------------------------------
world = bpy.data.worlds.new("PropertyWorld")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.45, 0.60, 0.85, 1)  # light blue sky
bg.inputs["Strength"].default_value = 0.8

# ---------------------------------------------------------------------------
# 11. CAMERA — bird's-eye perspective view
# ---------------------------------------------------------------------------
bpy.ops.object.camera_add(location=(cx + 250, cy - 300, 350))
cam = bpy.context.active_object
cam.name = "BirdsEye"

# Point camera at parcel center
direction = Vector((cx, cy, 0)) - cam.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam.rotation_euler = rot_quat.to_euler()

cam.data.lens = 35
cam.data.clip_end = 2000
bpy.context.scene.camera = cam

# ---------------------------------------------------------------------------
# 12. RENDER SETTINGS
# ---------------------------------------------------------------------------
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.resolution_x = 2560
scene.render.resolution_y = 1440
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'

# Output path
output_dir = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(output_dir, "render_property.png")
scene.render.filepath = output_path

# Also save .blend file
blend_path = os.path.join(output_dir, "property_digital_twin.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print(f"\n{'='*60}")
print(f"Scene built: 11 structures + parcel + setbacks + trees")
print(f"Blend saved: {blend_path}")
print(f"Render to:   {output_path}")
print(f"To render:   blender -b {blend_path} -o {output_path} -F PNG -f 1")
print(f"{'='*60}\n")

# Uncomment to auto-render:
# bpy.ops.render.render(write_still=True)
# print(f"Render complete: {output_path}")
