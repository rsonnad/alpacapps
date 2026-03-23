# Pascal Editor — Mac Mini M4 Setup & Integration Guide

> **Status:** Planning — install when Mac Mini M4 is in place
> **Repo:** https://github.com/pascalorg/editor
> **License:** MIT
> **Live demo:** https://editor.pascal.app

---

## What Pascal Editor Is

An open-source browser-based 3D building editor built with React Three Fiber + WebGPU. Create/edit buildings with a full hierarchy: Site > Building > Level > Wall/Slab/Ceiling/Roof/Zone. Includes undo/redo, collision detection, and dirty-node tracking for efficient re-renders.

## What It Is NOT

- **Not a CLI tool** — no headless mode, no command-line interface
- **Not an API** — no REST/GraphQL endpoints (only a `/api/health` route)
- **Not automatable by AI agents** — requires a browser with WebGPU support
- **No standard export** — cannot export IFC, OBJ, glTF, STL, or DXF (yet)
- **Not a Blender replacement** — no photorealistic rendering, no PBR materials, no terrain

## Why Install It Anyway

| Use Case | Value for AlpacApps Pipeline |
|----------|------------------------------|
| **Interactive massing studies** | Test "what if we move this container here?" without opening Blender |
| **Stakeholder visualization** | Share a browser link — they can rotate, explode levels, inspect zones |
| **Quick floor plan layouts** | Wall/door/window placement faster than Blender for simple structures |
| **Embeddable viewer** | `@pascal-app/viewer` npm package can be embedded in AlpacApps admin |
| **Future IFC bridge** | If the community adds IFC export, this becomes a free BIM modeler |

---

## Prerequisites — Mac Mini M4

| Requirement | Detail |
|-------------|--------|
| **Bun** | Required package manager (not npm/yarn) |
| **Node.js 20+** | Implied by Next.js 16 + React 19 |
| **Browser with WebGPU** | Chrome 113+, Edge 113+, or Safari 18+ (macOS Sequoia) |
| **Disk space** | ~500MB for repo + node_modules |
| **RAM** | 8GB minimum, 16GB recommended for large scenes |

---

## Installation Steps

### Step 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
# Verify
bun --version  # should be 1.x+
```

### Step 2: Clone the Repo

```bash
cd ~/Projects
git clone https://github.com/pascalorg/editor.git pascal-editor
cd pascal-editor
```

### Step 3: Install Dependencies

```bash
bun install
```

### Step 4: Run Dev Server

```bash
bun dev
# Opens at http://localhost:3002
```

### Step 5: Production Build (optional)

```bash
bunx turbo build
# Output in apps/editor/.next/
```

### Step 6: Run as Background Service (optional)

To keep it running as a local tool accessible on the network:

```bash
# Create a LaunchDaemon (adjust paths for Mac Mini)
cat > ~/Library/LaunchAgents/com.pascal.editor.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pascal.editor</string>
    <key>WorkingDirectory</key>
    <string>/Users/alpaca/Projects/pascal-editor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/alpaca/.bun/bin/bun</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/pascal-editor.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pascal-editor.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3002</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.pascal.editor.plist
```

Then accessible at `http://<mac-mini-ip>:3002` from any device on the network.

---

## Project Structure

```
pascal-editor/
├── apps/
│   └── editor/          # Next.js 16 app (the main editor UI)
│       ├── src/
│       │   ├── app/     # Next.js app router
│       │   └── ...
│       └── package.json
├── packages/
│   ├── core/            # @pascal-app/core — schemas, Zustand store, systems
│   │   ├── src/
│   │   │   ├── store/   # useScene Zustand store (the brain)
│   │   │   ├── schema/  # Zod-validated node types
│   │   │   └── systems/ # WallSystem, SlabSystem, etc.
│   │   └── package.json
│   └── viewer/          # @pascal-app/viewer — read-only 3D viewer component
│       └── package.json
├── turbo.json           # Turborepo config
└── package.json         # Root workspace
```

---

## Integration with AlpacApps Pipeline

### Where Pascal Editor Fits

```
Current Pipeline (unchanged):
  PostGIS DB → QGIS (GIS) → Blender (modeling + rendering) → Permit Sheets

New Addition (parallel tool):
  PostGIS DB → Pascal Editor (interactive 3D layout) → [manual] → Blender
                    ↓
              AlpacApps admin (embedded viewer)
```

### Integration Path 1: Standalone Local Tool

**Effort:** Zero code changes
**How:** Just run Pascal Editor on Mac Mini. Use it manually alongside Blender for quick layout experiments. Copy dimensions back to PostGIS by hand.

### Integration Path 2: Embed Viewer in AlpacApps Admin

**Effort:** Medium (requires React build step or iframe)
**How:** Since AlpacApps is vanilla HTML/JS, the simplest approach is an iframe:

```html
<!-- In siteplan.html or phyprop page -->
<iframe src="http://mac-mini:3002" width="100%" height="600px"
        style="border: 1px solid var(--aap-border);"></iframe>
```

Or for a read-only view, install the viewer package in a separate React micro-app and serve it as a static build.

### Integration Path 3: Programmatic Scene Loading (Advanced)

**Effort:** High — requires custom code
**How:** Use the `@pascal-app/core` Zustand store API to pre-populate scenes from PostGIS data:

```javascript
// Conceptual — would run inside the Pascal Editor app
import { useScene } from '@pascal-app/core';

// Load structures from PostGIS into Pascal Editor scene
const store = useScene.getState();
store.clearScene();

// Create site node
const siteId = store.createNode({
  type: 'site',
  name: '160 Still Forest Dr',
  position: [0, 0, 0],
});

// Create building from DB dimensions
for (const structure of structures) {
  const buildingId = store.createNode({
    type: 'building',
    name: structure.name,
    position: gpsToLocal(structure.footprint_geom),
  }, siteId);

  const levelId = store.createNode({
    type: 'level',
    name: 'Ground Floor',
    height: structure.height_ft,
  }, buildingId);

  // Add walls from footprint polygon edges...
}
```

This would require forking the editor and adding a PostGIS data loader.

---

## Automation Limitations

| Feature | Available? | Workaround |
|---------|-----------|------------|
| CLI / headless mode | No | None — browser required |
| REST API | No | Could fork and add API routes to Next.js app |
| AI agent control | No | Could use browser automation (Playwright) to drive the UI |
| Batch processing | No | Would need custom fork with API layer |
| Export to IFC/OBJ/glTF | No | Could add Three.js GLTFExporter to fork |
| Import from PostGIS | No | Would need custom data loader (see Path 3 above) |

**Bottom line:** Pascal Editor is a manual, interactive tool today. Automating it would require forking the repo and adding API/CLI capabilities — feasible (MIT license) but non-trivial.

---

## Future Watch List

These features, if added by the community, would significantly increase value:

- [ ] **IFC export** — direct path to permit-grade BIM files
- [ ] **glTF export** — import into Blender for photorealistic rendering
- [ ] **REST API** — enable AI agent / automation workflows
- [ ] **PostGIS/GeoJSON import** — load property data directly
- [ ] **CLI mode** — headless scene manipulation for batch processing

Monitor the repo's [Issues](https://github.com/pascalorg/editor/issues) and [Releases](https://github.com/pascalorg/editor/releases) for these.

---

## Comparison: Pascal Editor vs. Current Tools

| Capability | Pascal Editor | Blender + Add-ons | LibreCAD |
|-----------|--------------|-------------------|----------|
| 3D building editing | Excellent (native) | Good (with Archipack) | No (2D only) |
| Browser-based | Yes | No | No |
| Photorealistic render | No | Yes (Cycles) | No |
| Terrain/GIS | No | Yes (BlenderGIS) | No |
| Permit sheets | No | Yes (Bonsai/BlenderBIM) | Yes (DXF) |
| IFC export | No | Yes (Bonsai) | No |
| Real-time collaboration | Potential (web-based) | No | No |
| Learning curve | Low | High | Medium |
| Automation/CLI | No | Yes (`blender -b`) | Yes (`librecad -c`) |
| Cost | $0 | $0 | $0 |

---

## Recommended Approach

1. **Install on Mac Mini M4** as a standalone local tool (Steps 1-4)
2. **Run as background service** (Step 6) so it's accessible from any device
3. **Use manually** for quick massing studies and layout experiments
4. **Do NOT fork or customize yet** — wait for the community to add export formats
5. **Revisit in 3-6 months** — if IFC/glTF export lands, integrate more deeply
6. **Keep Blender as primary** — it remains the only tool that does terrain, rendering, and permit sheets

---

## Cost

| Item | Cost |
|------|------|
| Pascal Editor | $0 (MIT) |
| Bun runtime | $0 |
| Mac Mini M4 (existing plan) | Already planned |
| **Total** | **$0** |
