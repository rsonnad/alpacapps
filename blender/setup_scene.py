"""
Blender Scene Setup — 3D Property Digital Twin (Phase 3)
160 Still Forest Drive, Cedar Creek TX 78612

This script sets up the BASE SCENE with:
  - Real terrain from USGS LiDAR DEM (clipped to property + buffer)
  - Aerial imagery draped on terrain (via BlenderGIS or placeholder)
  - Structure footprint reference planes from PostGIS (positioning guides)
  - HDRI environment lighting
  - PBR material templates ready for application
  - Camera views (bird's eye, approach, cluster)

After running this script, a human models each structure manually using
reference photos. See docs/CAD-RENDER-PIPELINE.md for the full workflow.

Prerequisites (on Alpaca Mac):
  1. BlenderGIS add-on activated in Blender
  2. Files in ~/blender-property/:
     - dem/USGS_one_meter_x64y334_TX_Central_B1_2017.tif (428 MB)
     - hdri/meadow_2_4k.hdr
     - textures/{grass,gravel,stone,wood,metal,concrete,roof}/ (PBR sets)
  3. blender/property_data.json (from PostGIS export)

Run: blender -P setup_scene.py
  or: blender -b -P setup_scene.py  (headless — just builds and saves .blend)
"""

import bpy
import bmesh
import json
import math
import os
import subprocess
from pathlib import Path
from mathutils import Vector

# ---------------------------------------------------------------------------
# 0. PATHS
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
HOME = Path(os.path.expanduser("~"))
WORKSPACE = HOME / "blender-property"
DEM_PATH = WORKSPACE / "dem" / "USGS_one_meter_x64y334_TX_Central_B1_2017.tif"
DEM_CLIPPED = WORKSPACE / "dem" / "property_dem_clipped.tif"
HDRI_PATH = WORKSPACE / "hdri" / "meadow_2_4k.hdr"
TEX_DIR = WORKSPACE / "textures"
DATA_PATH = SCRIPT_DIR / "property_data.json"
OUTPUT_BLEND = WORKSPACE / "property_scene.blend"

# Property center (GPS)
PROP_LAT = 30.1310
PROP_LON = -97.4602

# ---------------------------------------------------------------------------
# 1. CLIP DEM TO PROPERTY AREA (± 200m buffer)
# ---------------------------------------------------------------------------
def clip_dem():
    """Clip the large 10km DEM tile to just the property area using GDAL."""
    if DEM_CLIPPED.exists():
        print(f"Clipped DEM already exists: {DEM_CLIPPED}")
        return True

    if not DEM_PATH.exists():
        print(f"ERROR: DEM not found at {DEM_PATH}")
        print("Download from: https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/TX_Central_B1_2017/TIFF/USGS_one_meter_x64y334_TX_Central_B1_2017.tif")
        return False

    # GDAL is bundled with QGIS on Alpaca Mac
    gdal_path = "/Applications/QGIS-final-4_0_0.app/Contents/MacOS"
    gdalwarp = f"{gdal_path}/gdalwarp"

    if not os.path.exists(gdalwarp):
        # Try homebrew GDAL
        gdalwarp = "gdalwarp"

    # Buffer: ~200m around property (about 0.002 degrees)
    bbox = f"-97.463,30.129,-97.457,30.134"

    cmd = [
        gdalwarp,
        "-te", "-97.463", "30.129", "-97.457", "30.134",
        "-t_srs", "EPSG:4326",
        "-r", "bilinear",
        str(DEM_PATH),
        str(DEM_CLIPPED)
    ]

    print(f"Clipping DEM to property area...")
    print(f"  Command: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0:
            print(f"  Clipped DEM saved: {DEM_CLIPPED}")
            return True
        else:
            print(f"  GDAL error: {result.stderr}")
            return False
    except FileNotFoundError:
        print(f"  GDAL not found. Please clip manually:")
        print(f"  gdalwarp -te {bbox.replace(',', ' ')} -t_srs EPSG:4326 {DEM_PATH} {DEM_CLIPPED}")
        return False


# ---------------------------------------------------------------------------
# 2. CLEAR SCENE
# ---------------------------------------------------------------------------
def clear_scene():
    """Remove all objects, collections, and data from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    # Clean orphaned data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)


# ---------------------------------------------------------------------------
# 3. LOAD PROPERTY DATA
# ---------------------------------------------------------------------------
def load_data():
    """Load property data from PostGIS export."""
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"property_data.json not found at {DATA_PATH}\n"
            "Run the PostGIS export first (see CAD-RENDER-PIPELINE.md Phase 2C)"
        )
    with open(DATA_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# 4. COORDINATE SYSTEM
# ---------------------------------------------------------------------------
# GPS to local meters (Blender works best in meters for terrain)
DEG_TO_M_LON = math.cos(math.radians(PROP_LAT)) * 111_320
DEG_TO_M_LAT = 111_320

def gps_to_m(lon, lat):
    """Convert GPS to local meters with property center as origin."""
    return (
        (lon - PROP_LON) * DEG_TO_M_LON,
        (lat - PROP_LAT) * DEG_TO_M_LAT
    )

def gps_to_ft(lon, lat):
    """Convert GPS to local feet."""
    mx, my = gps_to_m(lon, lat)
    return (mx * 3.28084, my * 3.28084)

# We use FEET throughout to match database dimensions
FT_PER_M = 3.28084


# ---------------------------------------------------------------------------
# 5. TERRAIN IMPORT
# ---------------------------------------------------------------------------
def import_terrain_blendergis():
    """
    Import terrain DEM using BlenderGIS add-on.
    This creates a mesh with real elevation data.
    """
    # Check if BlenderGIS is available
    try:
        import blendergis
        has_bgis = True
    except ImportError:
        has_bgis = False

    if not has_bgis:
        # Check if it's registered as an addon
        has_bgis = 'blendergis' in bpy.context.preferences.addons

    if has_bgis and DEM_CLIPPED.exists():
        print("Importing terrain via BlenderGIS...")
        # BlenderGIS import operator
        try:
            bpy.ops.importgis.georaster(
                filepath=str(DEM_CLIPPED),
                importMode='DEM',
                subdivision='mesh',
                rastCRS='EPSG:4326',
            )
            terrain = bpy.context.active_object
            terrain.name = "Terrain_DEM"
            print(f"  Terrain imported: {len(terrain.data.vertices)} vertices")
            return terrain
        except Exception as e:
            print(f"  BlenderGIS import failed: {e}")
            print("  Falling back to flat terrain...")

    # Fallback: create flat terrain from parcel boundary
    return None


def create_flat_terrain(db):
    """Create a flat terrain plane as fallback when DEM import isn't available."""
    parcel = db['parcel']
    coords = parcel['boundary_geom']['coordinates'][0]
    if coords[-1] == coords[0]:
        coords = coords[:-1]

    # Convert to feet
    pts_ft = [gps_to_ft(c[0], c[1]) for c in coords]

    # Create oversized ground plane (property + 100ft buffer)
    all_x = [p[0] for p in pts_ft]
    all_y = [p[1] for p in pts_ft]
    buf = 100
    min_x, max_x = min(all_x) - buf, max(all_x) + buf
    min_y, max_y = min(all_y) - buf, max(all_y) + buf

    mesh = bpy.data.meshes.new("Ground")
    obj = bpy.data.objects.new("Ground_Plane", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    verts = [
        bm.verts.new((min_x, min_y, 0)),
        bm.verts.new((max_x, min_y, 0)),
        bm.verts.new((max_x, max_y, 0)),
        bm.verts.new((min_x, max_y, 0)),
    ]
    bm.faces.new(verts)

    # Subdivide for grass particle system later
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=20)

    bm.to_mesh(mesh)
    bm.free()

    # Apply grass material (will be replaced with PBR texture)
    mat = create_pbr_material("Ground_Grass", "grass") or create_simple_material(
        "Ground_Grass", (0.15, 0.35, 0.08, 1))
    obj.data.materials.append(mat)

    return obj


# ---------------------------------------------------------------------------
# 6. PBR MATERIALS
# ---------------------------------------------------------------------------
def find_texture_file(tex_name, map_type):
    """Find a texture file in the downloaded texture packs."""
    tex_dir = TEX_DIR / tex_name
    if not tex_dir.exists():
        return None

    # ambientCG naming: Material_1K_Color.jpg, Material_1K_NormalGL.jpg, etc.
    suffixes = {
        'color': ['Color', 'Albedo', 'BaseColor', 'Diffuse'],
        'normal': ['NormalGL', 'Normal', 'NormalDX'],
        'roughness': ['Roughness'],
        'displacement': ['Displacement', 'Height'],
        'ao': ['AmbientOcclusion', 'AO'],
    }

    for suffix in suffixes.get(map_type, []):
        for ext in ['jpg', 'png', 'jpeg']:
            for f in tex_dir.rglob(f'*{suffix}*.{ext}'):
                return str(f)
    return None


def create_pbr_material(name, tex_name):
    """Create a PBR material from downloaded texture maps."""
    color_map = find_texture_file(tex_name, 'color')
    if not color_map:
        return None

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear default nodes
    for node in nodes:
        nodes.remove(node)

    # Create nodes
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (400, 0)

    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (0, 0)
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

    # Texture coordinate + mapping
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-800, 0)
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-600, 0)
    links.new(tex_coord.outputs['UV'], mapping.inputs['Vector'])

    # Color map
    color_tex = nodes.new('ShaderNodeTexImage')
    color_tex.location = (-300, 200)
    color_tex.image = bpy.data.images.load(color_map)
    links.new(mapping.outputs['Vector'], color_tex.inputs['Vector'])
    links.new(color_tex.outputs['Color'], bsdf.inputs['Base Color'])

    # Normal map
    normal_map = find_texture_file(tex_name, 'normal')
    if normal_map:
        normal_tex = nodes.new('ShaderNodeTexImage')
        normal_tex.location = (-300, -100)
        normal_tex.image = bpy.data.images.load(normal_map)
        normal_tex.image.colorspace_settings.name = 'Non-Color'
        links.new(mapping.outputs['Vector'], normal_tex.inputs['Vector'])

        normal_node = nodes.new('ShaderNodeNormalMap')
        normal_node.location = (-50, -100)
        links.new(normal_tex.outputs['Color'], normal_node.inputs['Color'])
        links.new(normal_node.outputs['Normal'], bsdf.inputs['Normal'])

    # Roughness map
    rough_map = find_texture_file(tex_name, 'roughness')
    if rough_map:
        rough_tex = nodes.new('ShaderNodeTexImage')
        rough_tex.location = (-300, -400)
        rough_tex.image = bpy.data.images.load(rough_map)
        rough_tex.image.colorspace_settings.name = 'Non-Color'
        links.new(mapping.outputs['Vector'], rough_tex.inputs['Vector'])
        links.new(rough_tex.outputs['Color'], bsdf.inputs['Roughness'])

    # Displacement map
    disp_map = find_texture_file(tex_name, 'displacement')
    if disp_map:
        disp_tex = nodes.new('ShaderNodeTexImage')
        disp_tex.location = (-300, -700)
        disp_tex.image = bpy.data.images.load(disp_map)
        disp_tex.image.colorspace_settings.name = 'Non-Color'
        links.new(mapping.outputs['Vector'], disp_tex.inputs['Vector'])

        disp_node = nodes.new('ShaderNodeDisplacement')
        disp_node.location = (200, -500)
        disp_node.inputs['Scale'].default_value = 0.1
        links.new(disp_tex.outputs['Color'], disp_node.inputs['Height'])
        links.new(disp_node.outputs['Displacement'], output.inputs['Displacement'])

    print(f"  PBR material created: {name} (from {tex_name})")
    return mat


def create_simple_material(name, color, roughness=0.8, metallic=0.0):
    """Fallback: create a simple solid-color material."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def setup_materials():
    """Create all materials needed for the scene."""
    materials = {}

    # Try PBR first, fall back to solid colors
    pbr_map = {
        'grass':    ('Ground_Grass',     'grass',    (0.15, 0.35, 0.08, 1)),
        'gravel':   ('Gravel_Driveway',  'gravel',   (0.40, 0.38, 0.34, 1)),
        'stone':    ('Stone_Wall',       'stone',    (0.65, 0.60, 0.52, 1)),
        'wood':     ('Wood_Siding',      'wood',     (0.45, 0.30, 0.15, 1)),
        'metal':    ('Corrugated_Metal', 'metal',    (0.45, 0.45, 0.48, 1)),
        'concrete': ('Concrete',         'concrete', (0.60, 0.58, 0.55, 1)),
        'roof':     ('Roof_Shingles',    'roof',     (0.35, 0.25, 0.22, 1)),
    }

    for key, (name, tex, fallback_color) in pbr_map.items():
        mat = create_pbr_material(name, tex)
        if mat is None:
            mat = create_simple_material(name, fallback_color)
        materials[key] = mat

    # Additional simple materials (no PBR texture needed)
    materials['steel_red'] = create_simple_material("Steel_Red", (0.60, 0.12, 0.10, 1), 0.4, 0.7)
    materials['steel_beige'] = create_simple_material("Steel_Beige", (0.65, 0.58, 0.42, 1), 0.4, 0.7)
    materials['steel_blue'] = create_simple_material("Steel_Blue", (0.15, 0.25, 0.50, 1), 0.4, 0.7)
    materials['rv_white'] = create_simple_material("RV_White", (0.85, 0.85, 0.82, 1), 0.5, 0.3)
    materials['wood_deck'] = create_simple_material("Wood_Deck", (0.55, 0.38, 0.20, 1), 0.65)
    materials['water'] = create_simple_material("Pool_Water", (0.10, 0.45, 0.90, 0.8), 0.05)
    materials['setback'] = create_simple_material("Setback_Line", (1.0, 0.3, 0.0, 0.5), 0.5)
    materials['boundary'] = create_simple_material("Boundary_Line", (0.85, 0.75, 0.10, 1), 0.5)
    materials['reference'] = create_simple_material("Reference_Plane", (0.2, 0.6, 1.0, 0.3), 0.5)
    materials['reference'].blend_method = 'BLEND'  # Transparent

    return materials


# ---------------------------------------------------------------------------
# 7. PARCEL BOUNDARY
# ---------------------------------------------------------------------------
def create_parcel_boundary(db, materials):
    """Create parcel boundary lines and corner markers."""
    coords = db['parcel']['boundary_geom']['coordinates'][0]
    if coords[-1] == coords[0]:
        coords = coords[:-1]

    pts = [gps_to_ft(c[0], c[1]) for c in coords]

    # Boundary line strips (visible property lines)
    col = bpy.data.collections.new("Parcel_Boundary")
    bpy.context.scene.collection.children.link(col)

    line_w = 0.5
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        x1, y1 = pts[i]
        x2, y2 = pts[j]
        dx, dy = x2 - x1, y2 - y1
        ln = math.sqrt(dx**2 + dy**2)
        if ln < 0.1:
            continue
        nx, ny = -dy / ln * line_w, dx / ln * line_w

        verts = [
            (x1 - nx, y1 - ny, 0.1),
            (x2 - nx, y2 - ny, 0.1),
            (x2 + nx, y2 + ny, 0.1),
            (x1 + nx, y1 + ny, 0.1),
        ]
        mesh = bpy.data.meshes.new(f"BoundaryLine_{i}")
        obj = bpy.data.objects.new(f"BoundaryLine_{i}", mesh)
        col.objects.link(obj)
        bm = bmesh.new()
        bvs = [bm.verts.new(v) for v in verts]
        bm.faces.new(bvs)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(materials['boundary'])

    return pts


# ---------------------------------------------------------------------------
# 8. STRUCTURE REFERENCE PLANES
# ---------------------------------------------------------------------------
def create_reference_planes(db, materials):
    """
    Create flat, semi-transparent reference planes showing where each
    structure should be modeled. These are positioning guides — a human
    models the real structures on top of them and then deletes these planes.
    """
    col = bpy.data.collections.new("Reference_Planes")
    bpy.context.scene.collection.children.link(col)

    structure_info = []

    for s in db['structures']:
        geom = s.get('footprint_geom')
        if not geom:
            continue

        name = s['name'].replace(' ', '_').replace('#', '').replace('(', '').replace(')', '')
        stype = s.get('structure_type', 'other')
        height = float(s.get('height_ft') or 0)

        # Skip underground utilities
        if stype == 'utility' and height == 0:
            continue

        ring = geom['coordinates'][0]
        if ring[-1] == ring[0]:
            ring = ring[:-1]
        coords_ft = [gps_to_ft(c[0], c[1]) for c in ring]

        # Create flat reference plane
        mesh = bpy.data.meshes.new(f"Ref_{name}")
        obj = bpy.data.objects.new(f"REF_{name}", mesh)
        col.objects.link(obj)

        bm = bmesh.new()
        verts = [bm.verts.new((x, y, 0.05)) for x, y in coords_ft]
        bm.faces.new(verts)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(materials['reference'])

        # Store info for labeling
        cx = sum(c[0] for c in coords_ft) / len(coords_ft)
        cy = sum(c[1] for c in coords_ft) / len(coords_ft)

        info = {
            'name': s['name'],
            'type': stype,
            'center': (cx, cy),
            'height': height,
            'material': s.get('material', ''),
            'roof': s.get('roof_type', ''),
            'color': s.get('color', ''),
            'coords_ft': coords_ft,
        }
        structure_info.append(info)

        print(f"  Reference plane: {s['name']} at ({cx:.0f}, {cy:.0f}), "
              f"height={height}, type={stype}, material={s.get('material','?')}")

    return structure_info


# ---------------------------------------------------------------------------
# 9. SETBACK LINES
# ---------------------------------------------------------------------------
def create_setback_lines(db, materials, parcel_pts):
    """Create setback lines from edge geometries."""
    col = bpy.data.collections.new("Setback_Lines")
    bpy.context.scene.collection.children.link(col)

    cx = sum(p[0] for p in parcel_pts) / len(parcel_pts)
    cy = sum(p[1] for p in parcel_pts) / len(parcel_pts)

    for edge in db['edges']:
        geom = edge.get('edge_geom')
        if not geom:
            continue

        side = edge['edge_side']
        setback = float(edge.get('setback_required_ft') or 10)
        coords = geom['coordinates']
        p_start = gps_to_ft(coords[0][0], coords[0][1])
        p_end = gps_to_ft(coords[1][0], coords[1][1])

        dx = p_end[0] - p_start[0]
        dy = p_end[1] - p_start[1]
        length = math.sqrt(dx**2 + dy**2)
        if length < 0.01:
            continue

        nx, ny = -dy / length, dx / length
        mid_x = (p_start[0] + p_end[0]) / 2
        mid_y = (p_start[1] + p_end[1]) / 2
        if nx * (cx - mid_x) + ny * (cy - mid_y) < 0:
            nx, ny = -nx, -ny

        s1 = (p_start[0] + nx * setback, p_start[1] + ny * setback)
        s2 = (p_end[0] + nx * setback, p_end[1] + ny * setback)

        strip_w = 0.3
        px = -dy / length * strip_w
        py = dx / length * strip_w

        mesh = bpy.data.meshes.new(f"Setback_{side}")
        obj = bpy.data.objects.new(f"Setback_{side}_{setback:.0f}ft", mesh)
        col.objects.link(obj)
        bm = bmesh.new()
        sv = [
            bm.verts.new((s1[0] - px, s1[1] - py, 0.08)),
            bm.verts.new((s2[0] - px, s2[1] - py, 0.08)),
            bm.verts.new((s2[0] + px, s2[1] + py, 0.08)),
            bm.verts.new((s1[0] + px, s1[1] + py, 0.08)),
        ]
        bm.faces.new(sv)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(materials['setback'])


# ---------------------------------------------------------------------------
# 10. ROAD
# ---------------------------------------------------------------------------
def create_road(db, materials, parcel_pts):
    """Create Still Forest Dr along the south edge."""
    south_edge = next((e for e in db['edges'] if e['edge_side'] == 'S'), None)
    if not south_edge or not south_edge.get('edge_geom'):
        return

    coords = south_edge['edge_geom']['coordinates']
    s_start = gps_to_ft(coords[0][0], coords[0][1])
    s_end = gps_to_ft(coords[1][0], coords[1][1])

    cx = sum(p[0] for p in parcel_pts) / len(parcel_pts)
    cy = sum(p[1] for p in parcel_pts) / len(parcel_pts)

    dx = s_end[0] - s_start[0]
    dy = s_end[1] - s_start[1]
    length = math.sqrt(dx**2 + dy**2)
    nx, ny = -dy / length, dx / length
    if nx * (cx - s_start[0]) + ny * (cy - s_start[1]) > 0:
        nx, ny = -nx, -ny

    road_w = 24  # Standard rural road width
    ext = 0.3    # Extend past parcel edges
    verts = [
        (s_start[0] - dx * ext, s_start[1] - dy * ext, -0.2),
        (s_end[0] + dx * ext, s_end[1] + dy * ext, -0.2),
        (s_end[0] + dx * ext + nx * road_w, s_end[1] + dy * ext + ny * road_w, -0.2),
        (s_start[0] - dx * ext + nx * road_w, s_start[1] - dy * ext + ny * road_w, -0.2),
    ]

    mesh = bpy.data.meshes.new("Road")
    obj = bpy.data.objects.new("Still_Forest_Dr", mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    rv = [bm.verts.new(v) for v in verts]
    bm.faces.new(rv)
    bm.to_mesh(mesh)
    bm.free()

    road_mat = materials.get('gravel') or create_simple_material(
        "Road", (0.25, 0.25, 0.25, 1), 0.9)
    obj.data.materials.append(road_mat)


# ---------------------------------------------------------------------------
# 11. DRIVEWAY
# ---------------------------------------------------------------------------
def create_driveway(db, materials):
    """Create gravel driveway from DB footprint."""
    driveway = next((s for s in db['structures']
                     if 'driveway' in s['name'].lower() or 'gravel' in s['name'].lower()), None)
    if not driveway or not driveway.get('footprint_geom'):
        return

    ring = driveway['footprint_geom']['coordinates'][0]
    if ring[-1] == ring[0]:
        ring = ring[:-1]
    coords_ft = [gps_to_ft(c[0], c[1]) for c in ring]

    mesh = bpy.data.meshes.new("Driveway")
    obj = bpy.data.objects.new("Gravel_Driveway", mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, 0.05)) for x, y in coords_ft]
    bm.faces.new(verts)
    bm.to_mesh(mesh)
    bm.free()

    mat = materials.get('gravel') or create_simple_material(
        "Gravel", (0.40, 0.38, 0.34, 1), 0.95)
    obj.data.materials.append(mat)


# ---------------------------------------------------------------------------
# 12. EXAMPLE STRUCTURES (containers — can be fully procedural)
# ---------------------------------------------------------------------------
def create_shipping_container(name, coords_ft, height, color_mat, materials):
    """
    Create a detailed shipping container with corrugated walls.
    Containers are simple enough to model procedurally — no reference photos needed.
    """
    xs = [c[0] for c in coords_ft]
    ys = [c[1] for c in coords_ft]
    cx_s = (min(xs) + max(xs)) / 2
    cy_s = (min(ys) + max(ys)) / 2

    # Find orientation from longest edge
    max_len = 0
    angle = 0
    for i in range(len(coords_ft)):
        j = (i + 1) % len(coords_ft)
        dx = coords_ft[j][0] - coords_ft[i][0]
        dy = coords_ft[j][1] - coords_ft[i][1]
        l = math.sqrt(dx**2 + dy**2)
        if l > max_len:
            max_len = l
            angle = math.atan2(dy, dx)

    # Perpendicular width
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    perp_dists = [-(c[0] - cx_s) * sin_a + (c[1] - cy_s) * cos_a for c in coords_ft]
    half_w = (max(perp_dists) - min(perp_dists)) / 2
    half_l = max_len / 2

    # Main box
    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(cx_s, cy_s, height / 2)
    )
    container = bpy.context.active_object
    container.name = name
    container.scale = (half_l * 2, half_w * 2, height)
    container.rotation_euler.z = angle
    bpy.ops.object.transform_apply(scale=True)

    container.data.materials.append(color_mat)

    # Corner posts (darker steel)
    post_mat = create_simple_material(f"{name}_Post", (0.2, 0.2, 0.22, 1), 0.3, 0.9)
    post_size = 0.5  # 6 inches
    for dx_sign in [-1, 1]:
        for dy_sign in [-1, 1]:
            px = cx_s + cos_a * half_l * dx_sign - sin_a * half_w * dy_sign
            py = cy_s + sin_a * half_l * dx_sign + cos_a * half_w * dy_sign
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(px, py, height / 2)
            )
            post = bpy.context.active_object
            post.name = f"{name}_Post"
            post.scale = (post_size, post_size, height + 0.2)
            bpy.ops.object.transform_apply(scale=True)
            post.data.materials.append(post_mat)

    return container


def create_example_structures(db, materials):
    """
    Create procedural structures for types that don't need reference photos:
    - Shipping containers (simple boxes with corner posts)
    - Driveway/gravel (already done above)

    Houses, outbuildings, trailers need reference photos — left as reference planes.
    """
    col = bpy.data.collections.new("Structures")
    bpy.context.scene.collection.children.link(col)

    created = []

    for s in db['structures']:
        geom = s.get('footprint_geom')
        if not geom:
            continue

        stype = s.get('structure_type', '')
        height = float(s.get('height_ft') or 8.5)
        name = s['name'].replace(' ', '_').replace('#', '').replace('(', '').replace(')', '')

        ring = geom['coordinates'][0]
        if ring[-1] == ring[0]:
            ring = ring[:-1]
        coords_ft = [gps_to_ft(c[0], c[1]) for c in ring]

        # Only procedurally create containers (simple geometry)
        if stype == 'container':
            color = (s.get('color') or s.get('name', '')).lower()
            if 'red' in color:
                mat = materials['steel_red']
            elif 'beige' in color:
                mat = materials['steel_beige']
            elif 'blue' in color or '#3' in s.get('name', ''):
                mat = materials['steel_blue']
            else:
                mat = materials['metal']

            obj = create_shipping_container(name, coords_ft, height, mat, materials)
            # Move to structures collection
            for c in obj.users_collection:
                c.objects.unlink(obj)
            col.objects.link(obj)
            created.append(s['name'])

    print(f"\n  Procedurally created: {', '.join(created)}")
    print(f"  Remaining structures need manual modeling from reference photos")
    return created


# ---------------------------------------------------------------------------
# 13. ENVIRONMENT — HDRI sky
# ---------------------------------------------------------------------------
def setup_hdri():
    """Set up HDRI environment lighting."""
    world = bpy.data.worlds.new("PropertyWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links

    # Clear defaults
    for node in list(nodes):
        nodes.remove(node)

    output = nodes.new('ShaderNodeOutputWorld')
    output.location = (400, 0)

    bg = nodes.new('ShaderNodeBackground')
    bg.location = (0, 0)
    links.new(bg.outputs['Background'], output.inputs['Surface'])

    if HDRI_PATH.exists():
        tex_coord = nodes.new('ShaderNodeTexCoord')
        tex_coord.location = (-600, 0)

        mapping = nodes.new('ShaderNodeMapping')
        mapping.location = (-400, 0)
        mapping.inputs['Rotation'].default_value = (0, 0, math.radians(-30))
        links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])

        env_tex = nodes.new('ShaderNodeTexEnvironment')
        env_tex.location = (-200, 0)
        env_tex.image = bpy.data.images.load(str(HDRI_PATH))
        links.new(mapping.outputs['Vector'], env_tex.inputs['Vector'])
        links.new(env_tex.outputs['Color'], bg.inputs['Color'])

        bg.inputs['Strength'].default_value = 1.0
        print("  HDRI environment loaded")
    else:
        bg.inputs['Color'].default_value = (0.45, 0.60, 0.85, 1)
        bg.inputs['Strength'].default_value = 0.8
        print("  Fallback: solid sky color (HDRI not found)")


# ---------------------------------------------------------------------------
# 14. SUN LIGHT
# ---------------------------------------------------------------------------
def setup_lighting():
    """Add sun light matching Cedar Creek, TX latitude."""
    # Main sun — afternoon position for good shadows
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 200))
    sun = bpy.context.active_object
    sun.name = "Sun"
    sun.data.energy = 5
    sun.data.angle = math.radians(0.5)  # Soft shadows
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-25))

    # Fill light (softer, opposite side)
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 200))
    fill = bpy.context.active_object
    fill.name = "Fill_Light"
    fill.data.energy = 1.5
    fill.rotation_euler = (math.radians(70), math.radians(-35), math.radians(55))


# ---------------------------------------------------------------------------
# 15. CAMERAS
# ---------------------------------------------------------------------------
def setup_cameras(parcel_pts, structure_info):
    """Create multiple camera views."""
    col = bpy.data.collections.new("Cameras")
    bpy.context.scene.collection.children.link(col)

    cx = sum(p[0] for p in parcel_pts) / len(parcel_pts)
    cy = sum(p[1] for p in parcel_pts) / len(parcel_pts)

    cameras = []

    # Bird's eye — nearly overhead
    cam_data = bpy.data.cameras.new("BirdsEye_Cam")
    cam_data.lens = 35
    cam_data.clip_end = 3000
    cam_obj = bpy.data.objects.new("BirdsEye", cam_data)
    cam_obj.location = (cx + 30, cy - 20, 600)
    direction = Vector((cx, cy, 0)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(cam_obj)
    cameras.append(cam_obj)

    # Set as active camera
    bpy.context.scene.camera = cam_obj

    # Approach from road (south, looking north)
    min_y = min(p[1] for p in parcel_pts)
    cam_data2 = bpy.data.cameras.new("Approach_Cam")
    cam_data2.lens = 28
    cam_data2.clip_end = 3000
    cam_obj2 = bpy.data.objects.new("Approach", cam_data2)
    cam_obj2.location = (cx, min_y - 60, 12)
    direction2 = Vector((cx, cy, 15)) - cam_obj2.location
    cam_obj2.rotation_euler = direction2.to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(cam_obj2)
    cameras.append(cam_obj2)

    # Main cluster (above main house area, 45° angle)
    # Find the main house center
    main_house = next((s for s in structure_info if s['type'] == 'house'), None)
    if main_house:
        hx, hy = main_house['center']
    else:
        hx, hy = cx, cy

    cam_data3 = bpy.data.cameras.new("Cluster_Cam")
    cam_data3.lens = 24
    cam_data3.clip_end = 3000
    cam_obj3 = bpy.data.objects.new("Main_Cluster", cam_data3)
    cam_obj3.location = (hx + 80, hy - 80, 120)
    direction3 = Vector((hx, hy, 10)) - cam_obj3.location
    cam_obj3.rotation_euler = direction3.to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(cam_obj3)
    cameras.append(cam_obj3)

    return cameras


# ---------------------------------------------------------------------------
# 16. RENDER SETTINGS
# ---------------------------------------------------------------------------
def setup_render():
    """Configure render settings."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64       # Preview quality — bump to 256 for final
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 2560
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    # Use Filmic color management for realistic look
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium High Contrast'

    # Output path
    scene.render.filepath = str(WORKSPACE / "renders" / "property_")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def main():
    print("\n" + "=" * 60)
    print("PROPERTY SCENE SETUP — 160 Still Forest Dr")
    print("=" * 60)

    # Step 1: Clip DEM
    print("\n[1/9] Clipping DEM to property area...")
    has_dem = clip_dem()

    # Step 2: Clear scene
    print("\n[2/9] Clearing scene...")
    clear_scene()

    # Step 3: Load data
    print("\n[3/9] Loading property data...")
    db = load_data()
    print(f"  {len(db['structures'])} structures, {len(db['edges'])} edges")

    # Step 4: Materials
    print("\n[4/9] Setting up PBR materials...")
    materials = setup_materials()

    # Step 5: Terrain
    print("\n[5/9] Creating terrain...")
    terrain = import_terrain_blendergis()
    if terrain is None:
        terrain = create_flat_terrain(db)
        print("  Using flat terrain (activate BlenderGIS for real DEM)")

    # Step 6: Parcel boundary + road + driveway
    print("\n[6/9] Creating parcel boundary, road, driveway...")
    parcel_pts = create_parcel_boundary(db, materials)
    create_road(db, materials, parcel_pts)
    create_driveway(db, materials)
    create_setback_lines(db, materials, parcel_pts)

    # Step 7: Structure reference planes
    print("\n[7/9] Creating structure reference planes...")
    structure_info = create_reference_planes(db, materials)

    # Step 8: Procedural structures (containers)
    print("\n[8/9] Creating procedural structures (containers)...")
    created = create_example_structures(db, materials)

    # Step 9: Environment + cameras
    print("\n[9/9] Setting up environment, lighting, cameras...")
    setup_hdri()
    setup_lighting()
    cameras = setup_cameras(parcel_pts, structure_info)
    setup_render()

    # Save
    print(f"\nSaving scene to {OUTPUT_BLEND}...")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))

    # Summary
    print("\n" + "=" * 60)
    print("SCENE SETUP COMPLETE")
    print("=" * 60)
    print(f"\nBlend file: {OUTPUT_BLEND}")
    print(f"Cameras: {len(cameras)} views ready")
    print(f"Procedural structures: {len(created)} containers")
    print(f"Reference planes: {len(structure_info) - len(created)} structures need manual modeling")
    print(f"\nNEXT STEPS (human in Blender GUI):")
    print(f"  1. Open {OUTPUT_BLEND} in Blender")
    print(f"  2. Activate BlenderGIS if not already → re-run terrain import")
    print(f"  3. Model remaining structures using reference photos")
    print(f"  4. Add trees (Sapling Tree Gen) matching aerial imagery")
    print(f"  5. Add grass particle system to ground")
    print(f"  6. Set active camera → Render (F12)")
    print(f"  7. Adjust, iterate, final render at 256 samples")
    print("=" * 60)


if __name__ == "__main__":
    main()
