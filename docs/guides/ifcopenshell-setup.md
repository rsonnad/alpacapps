# IfcOpenShell — Mac Mini M4 Setup & Integration Guide

> **Status:** Planning — install when Mac Mini M4 is in place
> **Repo:** https://github.com/IfcOpenShell/IfcOpenShell
> **Docs:** https://docs.ifcopenshell.org/
> **License:** LGPL v3+
> **Latest version:** 0.8.4 (Dec 2025)

---

## What IfcOpenShell Is

An open-source IFC toolkit and geometry engine for working with Building Information Models (BIM). It reads, writes, and manipulates IFC files — the universal exchange format for architecture, engineering, and construction (AEC). Written in C++ with Python bindings and a rich ecosystem of CLI tools.

### Core Components

| Component | What It Does |
|-----------|-------------|
| **IfcOpenShell-Python** | Python library — read/write/modify IFC files programmatically |
| **IfcConvert** | CLI tool — convert IFC to OBJ, DAE, glTF, SVG, XML |
| **Bonsai (BlenderBIM)** | Blender add-on — full BIM authoring inside Blender |
| **ifctester** | Validate IFC files against BIM requirements (IDS) |
| **ifcdiff** | Compare two IFC models and show differences |
| **ifccsv** | Export/import IFC data as CSV for spreadsheet editing |
| **ifcclash** | Clash detection between building elements |
| **ifcpatch** | Batch patch/transform IFC files |
| **ifccityjson** | Convert between IFC and CityJSON |

### Supported IFC Versions

IFC2X3 TC1, IFC4 Add2 TC1, IFC4x1, IFC4x2, IFC4x3 Add2 — plus custom schema loading at runtime.

### Supported Formats

IFC-SPF (.ifc), IFCJSON, IFCXML, IFCHDF5, IFCSQL — plus export to OBJ, DAE, glTF, SVG.

---

## Why This Matters for AlpacApps

| Use Case | Value for Permitting Pipeline |
|----------|------------------------------|
| **IFC → Blender bridge** | Import/export IFC files natively in Blender via Bonsai add-on |
| **Permit-grade BIM output** | Generate IFC files that satisfy permit submission requirements |
| **Programmatic IFC creation** | Build IFC models from PostGIS data via Python — structures, walls, slabs, roofs |
| **2D drawing generation** | Extract 2D permit sheets from 3D IFC geometry |
| **Clash detection** | Verify structures don't conflict before permit submission |
| **Automated validation** | Run IDS checks on IFC models to catch permit compliance issues |
| **Batch processing** | CLI tools (IfcConvert, ifcpatch) integrate into automation scripts |
| **Format conversion** | Convert IFC to glTF for web viewers, OBJ for Blender, SVG for drawings |

---

## Prerequisites — Mac Mini M4

| Requirement | Detail |
|-------------|--------|
| **Python 3.9–3.14** | Pre-installed on macOS or via Homebrew |
| **pip** | For IfcOpenShell-Python install |
| **Blender 4.5+** | For Bonsai (BlenderBIM) add-on |
| **Homebrew** | For optional native dependencies |
| **Disk space** | ~200MB for Python package, ~500MB with Blender add-on |
| **Architecture** | Apple Silicon arm64 — pre-built wheels available on PyPI |

---

## Installation Steps

### Step 1: Install Python (if not present)

```bash
# Check existing Python
python3 --version  # Need 3.9+

# If missing or too old, install via Homebrew
brew install python@3.12
```

### Step 2: Install IfcOpenShell-Python

```bash
# Pre-built arm64 wheel available — no compilation needed
pip3 install ifcopenshell

# Verify
python3 -c "import ifcopenshell; print(ifcopenshell.version)"
# Should print: 0.8.4
```

### Step 3: Install CLI Tools

```bash
# IfcConvert and other CLI utilities come with the Python package
# Verify IfcConvert is accessible
python3 -m ifcopenshell.ifcconvert --help

# Or install standalone CLI tools
pip3 install ifcconvert ifctester ifcdiff ifccsv ifcclash ifcpatch
```

### Step 4: Install Bonsai (BlenderBIM Add-on)

Bonsai is the Blender add-on that gives Blender full IFC/BIM capabilities.

```bash
# Download latest Bonsai release for Blender 4.5 + macOS arm64
# From: https://github.com/IfcOpenShell/IfcOpenShell/releases
# File: bonsai-{version}-py312-macosx_11_0_arm64.zip
```

In Blender:
1. Edit → Preferences → Add-ons → Install from Disk
2. Select the downloaded `.zip` file
3. Enable "Bonsai" in the add-on list
4. Restart Blender

Verify: File menu should now show "IFC" import/export options, and a "Bonsai" panel appears in the N-sidebar.

### Step 5: Create a Virtual Environment (Recommended)

To keep IfcOpenShell isolated from system Python:

```bash
python3 -m venv ~/envs/ifcopenshell
source ~/envs/ifcopenshell/bin/activate
pip install ifcopenshell
```

Add to shell profile for convenience:

```bash
echo 'alias ifc="source ~/envs/ifcopenshell/bin/activate"' >> ~/.zshrc
```

---

## Integration with AlpacApps Render Pipeline

### Where IfcOpenShell Fits

```
Current Pipeline:
  PostGIS DB → QGIS (GIS) → Blender (modeling + rendering) → Permit Sheets

Enhanced Pipeline with IfcOpenShell:
  PostGIS DB → IfcOpenShell-Python (generate IFC) → Blender + Bonsai (BIM authoring)
                    ↓                                        ↓
              ifctester (validate)                    IfcConvert → glTF (web viewer)
                    ↓                                        ↓
              ifcclash (clash detect)                 2D drawings (permit sheets)
```

### Integration Path 1: PostGIS → IFC Generation (Automated)

Build IFC models programmatically from database dimensions and footprints:

```python
import ifcopenshell
import ifcopenshell.api as api

# Create a new IFC model
model = api.run("project.create_file", version="IFC4")
project = api.run("root.create_entity", model, ifc_class="IfcProject", name="160 Still Forest Dr")

# Set up units (Imperial — feet)
api.run("unit.assign_unit", model, length={"is_metric": False, "raw": "FOOT"})

# Create site from PostGIS parcel boundary
site = api.run("root.create_entity", model, ifc_class="IfcSite", name="Parcel 1")
api.run("aggregate.assign_object", model, product=site, relating_object=project)

# Create building from PostGIS structure data
building = api.run("root.create_entity", model, ifc_class="IfcBuilding", name="Main House")
api.run("aggregate.assign_object", model, product=building, relating_object=site)

# Create storey
storey = api.run("root.create_entity", model, ifc_class="IfcBuildingStorey", name="Ground Floor")
api.run("aggregate.assign_object", model, product=storey, relating_object=building)

# Create walls from footprint edges
for edge in footprint_edges:
    wall = api.run("root.create_entity", model, ifc_class="IfcWall", name=f"Wall-{edge['id']}")
    # Set wall geometry from PostGIS coordinates...
    api.run("spatial.assign_container", model, product=wall, relating_structure=storey)

# Save
model.write("/path/to/output.ifc")
```

### Integration Path 2: IFC → Blender via Bonsai (Manual + Automated)

Once an IFC file exists, import into Blender for visualization and rendering:

```bash
# Automated: open IFC in Blender headless
blender -b --python - <<'EOF'
import bpy
import bonsai.tool as tool
bpy.ops.bim.load_project(filepath="/path/to/output.ifc")
# Set up rendering...
bpy.ops.render.render(write_still=True)
EOF
```

Or manually in Blender GUI: File → Open IFC Project → select the `.ifc` file.

### Integration Path 3: IFC → Web Viewer via glTF

Convert IFC to glTF for embedding in AlpacApps admin:

```bash
# Convert IFC to glTF
python3 -m ifcopenshell.ifcconvert input.ifc output.glb

# Or with specific options
python3 -m ifcopenshell.ifcconvert input.ifc output.glb \
    --include=entity IfcWall IfcSlab IfcRoof \
    --use-element-names
```

Then use a web-based glTF viewer (Three.js, model-viewer) in AlpacApps admin pages.

### Integration Path 4: Permit Validation Pipeline

```bash
# Validate IFC against requirements
ifctester validate model.ifc requirements.ids --report report.html

# Check for clashes between elements
ifcclash detect model.ifc --tolerance 0.01 --output clashes.json

# Diff two versions of a model
ifcdiff model_v1.ifc model_v2.ifc --output changes.json

# Export element data to CSV for review
ifccsv export model.ifc --elements IfcWall IfcDoor IfcWindow --output elements.csv
```

---

## Key Differences from Pascal Editor

| Capability | IfcOpenShell | Pascal Editor |
|-----------|-------------|---------------|
| **IFC support** | Native (read/write/modify) | None |
| **CLI / automation** | Full CLI + Python API | None (browser-only) |
| **Blender integration** | Deep (Bonsai add-on) | None |
| **Permit-grade output** | Yes (IFC + 2D drawings) | No |
| **Web viewer** | Via glTF conversion | Native (WebGPU) |
| **Interactive 3D editing** | Via Blender | Native in browser |
| **Format conversion** | IFC ↔ OBJ/glTF/SVG/DAE | None |
| **Clash detection** | Built-in (ifcclash) | None |
| **Validation** | Built-in (ifctester) | None |
| **Learning curve** | Medium (Python + IFC concepts) | Low |
| **Cost** | $0 (LGPL) | $0 (MIT) |

**Bottom line:** IfcOpenShell is a professional BIM toolkit that fits directly into the existing Blender pipeline. Pascal Editor is an interactive massing tool with no export capabilities. IfcOpenShell is the clear winner for permitting workflows.

---

## Quick Reference: Common Commands

```bash
# Read an IFC file
python3 -c "
import ifcopenshell
model = ifcopenshell.open('model.ifc')
print(f'Schema: {model.schema}')
print(f'Walls: {len(model.by_type(\"IfcWall\"))}')
print(f'Doors: {len(model.by_type(\"IfcDoor\"))}')
"

# Convert IFC to OBJ (for Blender import)
python3 -m ifcopenshell.ifcconvert model.ifc model.obj

# Convert IFC to glTF (for web viewer)
python3 -m ifcopenshell.ifcconvert model.ifc model.glb

# Convert IFC to SVG (for 2D drawings)
python3 -m ifcopenshell.ifcconvert model.ifc drawing.svg --plan

# List all elements in an IFC file
python3 -c "
import ifcopenshell
model = ifcopenshell.open('model.ifc')
for wall in model.by_type('IfcWall'):
    print(f'{wall.Name}: {wall.GlobalId}')
"
```

---

## Recommended Approach

1. **Install IfcOpenShell-Python** on Mac Mini M4 (Steps 1–2) — zero friction, pip install
2. **Install Bonsai** in Blender (Step 4) — enables IFC import/export in existing tool
3. **Write a PostGIS → IFC generator** script that creates IFC files from database geometry
4. **Use Bonsai in Blender** for manual refinement — add architectural detail, materials
5. **Use IfcConvert** to generate glTF for web viewers and SVG for permit drawings
6. **Add ifctester** validation to catch permit compliance issues before submission
7. **Keep Blender as primary** rendering tool — IfcOpenShell handles the data/format layer

---

## Cost

| Item | Cost |
|------|------|
| IfcOpenShell-Python | $0 (LGPL) |
| Bonsai (BlenderBIM) | $0 (GPL) |
| CLI tools | $0 (LGPL) |
| Mac Mini M4 (existing plan) | Already planned |
| **Total** | **$0** |

---

## Resources

- [IfcOpenShell Documentation](https://docs.ifcopenshell.org/)
- [Bonsai (BlenderBIM) Wiki](https://docs.ifcopenshell.org/bonsai/)
- [IfcOpenShell Python API Reference](https://docs.ifcopenshell.org/ifcopenshell-python/)
- [IFC Schema Reference](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/)
- [Building IfcOpenShell on macOS](https://mclare.blog/posts/building-ifcopenshell-on-macos/) (if you need to compile from source)
