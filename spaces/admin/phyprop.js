/**
 * PhyProp - Physical Property data dashboard
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

let authState = null;
let activeSubtab = 'overview';
const loadedTabs = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'phyprop',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      initSubtabs();
    }
  });
});

// =============================================
// SUBTAB ROUTING
// =============================================

function initSubtabs() {
  const hash = location.hash.replace('#', '');
  if (hash && document.getElementById(`pp-panel-${hash}`)) activeSubtab = hash;

  document.querySelectorAll('.pp-subtab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchSubtab(btn.dataset.tab);
    });
  });
  switchSubtab(activeSubtab);
}

function switchSubtab(tab) {
  activeSubtab = tab;
  location.hash = tab === 'overview' ? '' : tab;

  document.querySelectorAll('.pp-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.pp-panel').forEach(p => {
    p.style.display = p.id === `pp-panel-${tab}` ? '' : 'none';
  });

  if (!loadedTabs.has(tab)) {
    loadedTabs.add(tab);
    const loaders = {
      overview: loadOverviewTab,
      structures: loadStructuresTab,
      renderings: loadRenderingsTab,
      permittingplan: () => {},
    };
    loaders[tab]?.();
  }
}

async function loadOverviewTab() {
  await loadSpaces();
}

async function loadStructuresTab() {
  await Promise.all([
    loadParcel(),
    loadEdges(),
    loadStructures(),
    loadUtilities(),
    loadImpervious(),
    loadZoning(),
  ]);
}

// =============================================
// HELPERS
// =============================================

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function badge(text, color = 'gray') {
  return `<span class="pp-badge pp-badge-${color}">${esc(text)}</span>`;
}

function typeBadge(type) {
  const colors = { Dwelling: 'blue', Amenity: 'green', Event: 'amber', Storage: 'gray' };
  return badge(type, colors[type] || 'gray');
}

function setCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = `(${n})`;
}

function setStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Generic full-record card list. fields = [[label, key|fn], ...]
function renderRecordCards(rows, fields, titleFn) {
  if (!rows || !rows.length) return '<div class="pp-empty">No records</div>';
  return `<div class="pp-record-list">${rows.map(r => {
    const title = typeof titleFn === 'function' ? titleFn(r) : esc(r[titleFn] || '--');
    return `<div class="pp-record-card">
      <div class="pp-record-title">${title}</div>
      <dl class="pp-tree-detail-grid">${fields.map(([label, key]) => {
        const v = typeof key === 'function' ? key(r) : r[key];
        const display = v == null || v === '' ? '--' : (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : esc(String(v)));
        return `<dt>${esc(label)}</dt><dd>${display}</dd>`;
      }).join('')}</dl>
    </div>`;
  }).join('')}</div>`;
}

// =============================================
// SPACES
// =============================================

async function loadSpaces() {
  try {
    const { data } = await supabase
      .from('spaces')
      .select('id, name, type, monthly_rate, beds, baths, is_archived, parent:parent_id(name)')
      .eq('is_archived', false)
      .order('name');

    const body = document.getElementById('spacesBody');
    if (!data || !data.length) { body.innerHTML = '<tr><td colspan="6" class="pp-empty">No spaces found</td></tr>'; return; }

    setCount('spacesCount', data.length);
    setStat('statSpaces', data.length);

    body.innerHTML = data.map(s => `<tr>
      <td style="font-weight:500;">${esc(s.name)}</td>
      <td>${typeBadge(s.type)}</td>
      <td>${s.monthly_rate ? `$${Number(s.monthly_rate).toLocaleString()}` : '--'}</td>
      <td>${s.beds ?? '--'}</td>
      <td>${s.baths ?? '--'}</td>
      <td style="color:var(--text-muted);font-size:0.75rem;">${s.parent?.name ? esc(s.parent.name) : '--'}</td>
    </tr>`).join('');
  } catch (err) {
    console.error('Spaces load error:', err);
  }
}


// =============================================
// STRUCTURES TAB — Parcel
// =============================================

async function loadParcel() {
  try {
    const { data } = await supabase
      .from('parcels')
      .select('*')
      .limit(1)
      .single();

    const el = document.getElementById('parcelSummary');
    if (!data) { el.innerHTML = '<div class="pp-empty">No parcel data found</div>'; return; }
    el.innerHTML = renderRecordCards([data], [
      ['Name', 'name'],
      ['Address', 'address'],
      ['City', 'city'],
      ['County', 'county'],
      ['State', 'state'],
      ['Zip', 'zip'],
      ['Legal Description', 'legal_description'],
      ['Parcel Number', 'parcel_number'],
      ['Acreage', 'acreage'],
      ['Area (sq ft)', r => r.area_sqft ? Number(r.area_sqft).toLocaleString() : '--'],
      ['Ground Elevation (ft)', 'ground_elevation_ft'],
      ['Flood Zone', 'flood_zone'],
      ['In Floodplain', 'in_floodplain'],
      ['Houston Toad Habitat', 'houston_toad_habitat'],
      ['ESD District', 'esd_district'],
      ['Survey Date', 'survey_date'],
      ['Survey By', 'survey_by'],
      ['Survey RPLS', 'survey_rpls'],
    ], r => esc(r.name || 'Parcel'));
  } catch (err) {
    console.error('Parcel load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Edges
// =============================================

async function loadEdges() {
  try {
    const { data } = await supabase.from('parcel_edges').select('*').order('edge_side');
    const el = document.getElementById('edgesContainer');
    setCount('edgesCount', data?.length || 0);
    el.innerHTML = renderRecordCards(data, [
      ['Side', 'edge_side'],
      ['Label', 'edge_label'],
      ['Length (ft)', 'length_ft'],
      ['Bearing', 'bearing'],
      ['Road Frontage', 'is_road_frontage'],
      ['Road Name', 'road_name'],
      ['Road Classification', 'road_classification'],
      ['Road ROW (ft)', 'road_row_ft'],
      ['Has Easement', 'has_easement'],
      ['Easement Type', 'easement_type'],
      ['Easement Width (ft)', 'easement_width_ft'],
      ['Setback Required (ft)', 'setback_required_ft'],
      ['Setback Label', 'setback_label'],
      ['Adjoining Owner', 'adjoining_owner'],
      ['Notes', 'notes'],
    ], e => `${esc(e.edge_side)} — ${esc(e.edge_label || '')}`);
  } catch (err) { console.error('Edges load error:', err); }
}

// =============================================
// STRUCTURES TAB — Structures
// =============================================

async function loadStructures() {
  try {
    const [{ data: structures }, { data: spaces }] = await Promise.all([
      supabase.from('structures')
        .select('*, structure_setbacks(*, edge:edge_id(edge_side, edge_label)), structure_rooms(*)')
        .order('name'),
      supabase.from('spaces')
        .select('id, name, type, parent_id, is_archived')
        .eq('is_archived', false)
        .order('name'),
    ]);

    const el = document.getElementById('structureTree');
    if (!structures || !structures.length) { el.innerHTML = '<div class="pp-empty">No structures found</div>'; return; }

    setCount('structuresCount', structures.length);

    // Build spaces hierarchy: top-level spaces → children
    const spaceMap = {};
    (spaces || []).forEach(sp => { spaceMap[sp.id] = sp; });
    const topSpaces = (spaces || []).filter(sp => !sp.parent_id);
    const childSpacesOf = (parentId) => (spaces || []).filter(sp => sp.parent_id === parentId);

    // Match structures to spaces by explicit space_id, fall back to fuzzy name match.
    // The friendly name shown is the linked space's name when available.
    const structuresBySpace = {};
    const unmatched = [];
    structures.forEach(s => {
      let match = s.space_id ? spaceMap[s.space_id] : null;
      if (!match) {
        const nameLower = (s.name || '').toLowerCase();
        match = (spaces || []).find(sp => {
          const spLower = sp.name.toLowerCase();
          return spLower === nameLower || nameLower.includes(spLower) || spLower.includes(nameLower);
        });
      }
      if (match) {
        if (!structuresBySpace[match.id]) structuresBySpace[match.id] = [];
        s._friendlySpace = match;
        structuresBySpace[match.id].push(s);
      } else {
        unmatched.push(s);
      }
    });

    // Render tree
    let html = '<div class="pp-tree">';

    // Render a space group with its structures
    function renderSpaceGroup(space, depth = 0) {
      const children = childSpacesOf(space.id);
      const matched = structuresBySpace[space.id] || [];
      const hasContent = matched.length > 0 || children.some(c =>
        (structuresBySpace[c.id] || []).length > 0 || childSpacesOf(c.id).length > 0
      );
      if (!hasContent) return '';

      const indent = '<span class="pp-tree-indent"></span>'.repeat(depth);
      const groupId = `spgrp-${space.id}`;
      let out = '';

      // Group header row
      out += `<div class="pp-tree-row pp-group" onclick="document.getElementById('${groupId}').classList.toggle('open');this.querySelector('.pp-tree-arrow').classList.toggle('open')">
        ${indent}
        <span class="pp-tree-arrow">&#9654;</span>
        <span class="pp-tree-name">${esc(space.name)}</span>
        <span class="pp-tree-badges">
          ${badge(space.type || '--', space.type === 'Dwelling' ? 'blue' : space.type === 'Amenity' ? 'green' : 'gray')}
          <span style="font-size:0.6875rem;color:var(--text-muted)">${matched.length} structure${matched.length !== 1 ? 's' : ''}</span>
        </span>
      </div>`;

      // Children container
      out += `<div id="${groupId}" class="pp-tree-children">`;

      // Render structures under this space
      matched.forEach(s => { out += renderStructureRow(s, depth + 1); });

      // Recurse into child spaces
      children.forEach(c => { out += renderSpaceGroup(c, depth + 1); });

      out += '</div>';
      return out;
    }

    // Render a single structure row + expandable detail
    function renderStructureRow(s, depth) {
      const indent = '<span class="pp-tree-indent"></span>'.repeat(depth);
      const detailId = `stdet-${s.id}`;
      const compClass = s.setback_compliant === true ? 'compliant'
        : s.setback_compliant === false ? 'violation' : 'pending';
      const permitColors = {
        permitted: 'green', exempt: 'green', grandfathered: 'blue',
        unpermitted: 'red', violation: 'red', pending: 'amber',
      };

      const dims = [s.width_ft, s.length_ft].filter(Boolean).join(' × ');
      const dimsStr = dims ? `${dims} ft` : '';

      const friendly = s._friendlySpace?.name;
      const displayName = friendly && friendly.toLowerCase() !== (s.name || '').toLowerCase()
        ? `${esc(friendly)} <span style="color:var(--text-muted);font-weight:400;font-size:0.8125rem;">(${esc(s.name)})</span>`
        : esc(s.name);

      let out = `<div class="pp-tree-row" onclick="document.getElementById('${detailId}').classList.toggle('open');this.querySelector('.pp-tree-arrow').classList.toggle('open')">
        ${indent}
        <span class="pp-tree-arrow">&#9654;</span>
        <span class="pp-compliance-dot ${compClass}"></span>
        <span class="pp-tree-name">${displayName}</span>
        <span class="pp-tree-badges">
          ${badge(s.structure_type || '--', 'blue')}
          ${badge(s.permit_status || '?', permitColors[s.permit_status] || 'gray')}
          ${dimsStr ? `<span style="font-size:0.6875rem;color:var(--text-muted)">${esc(dimsStr)}</span>` : ''}
        </span>
      </div>`;

      // Expandable detail panel
      const amenities = [];
      if (s.has_plumbing) amenities.push('Plumbing');
      if (s.has_electric) amenities.push('Electric');
      if (s.has_hvac) amenities.push('HVAC');

      const setbacks = (s.structure_setbacks || []).map(sb => {
        const edgeLabel = sb.edge?.edge_side || '?';
        return `${sb.measured_distance_ft}′ to ${esc(edgeLabel)} (req ${sb.required_distance_ft}′) ${sb.is_compliant ? '✓' : '✗'}`;
      });

      const rooms = (s.structure_rooms || []).slice().sort((a,b) => (a.sort_order||0) - (b.sort_order||0) || a.name.localeCompare(b.name));
      const roomsHtml = rooms.length
        ? `<table class="pp-table" style="margin-top:0.5rem;font-size:0.8125rem;">
            <thead><tr><th>Room</th><th>Dimensions</th><th>Materials</th><th>Notes</th><th></th></tr></thead>
            <tbody>${rooms.map(r => {
              const rdims = [r.length_ft, r.width_ft, r.height_ft].filter(Boolean).join(' × ');
              return `<tr>
                <td style="font-weight:500;">${esc(r.name)}</td>
                <td>${rdims ? esc(rdims) + ' ft' : '--'}</td>
                <td>${esc(r.primary_materials || '--')}</td>
                <td style="color:var(--text-muted);">${esc(r.notes || '')}</td>
                <td style="text-align:right;"><a href="#" onclick="event.preventDefault();event.stopPropagation();editRoom('${r.id}')" style="font-size:0.75rem;">edit</a> · <a href="#" onclick="event.preventDefault();event.stopPropagation();deleteRoom('${r.id}')" style="font-size:0.75rem;color:#b91c1c;">×</a></td>
              </tr>`;
            }).join('')}</tbody>
          </table>`
        : '<div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.5rem;">No rooms recorded.</div>';

      const fmtNum = (v, suffix = '') => v == null || v === '' ? '--' : `${Number(v).toLocaleString()}${suffix}`;
      const fmtBool = v => v == null ? '--' : (v ? 'Yes' : 'No');
      const fmtTxt = v => v == null || v === '' ? '--' : esc(v);
      const fmtDate = v => v ? new Date(v).toLocaleDateString() : '--';
      const friendlyName = s._friendlySpace?.name || '--';
      const editCatAttr = JSON.stringify(s.category || '').replace(/"/g, '&quot;');

      const fields = [
        ['Friendly Name', fmtTxt(friendlyName)],
        ['DB Name', fmtTxt(s.name)],
        ['Category', `${fmtTxt(s.category)} <a href="#" onclick="event.preventDefault();event.stopPropagation();editCategory(${s.id}, ${editCatAttr})" style="font-size:0.7rem;">edit</a>`],
        ['Structure Type', fmtTxt(s.structure_type)],
        ['Use Type', fmtTxt(s.use_type)],
        ['Width', fmtNum(s.width_ft, ' ft')],
        ['Length', fmtNum(s.length_ft, ' ft')],
        ['Height', fmtNum(s.height_ft, ' ft')],
        ['Stories', s.stories ?? '--'],
        ['Area', fmtNum(s.area_sqft, ' sq ft')],
        ['Material', fmtTxt(s.material)],
        ['Roof Type', fmtTxt(s.roof_type)],
        ['Color', fmtTxt(s.color)],
        ['Year Built', s.year_built ?? '--'],
        ['Year Placed', s.year_placed ?? '--'],
        ['Ground Elevation', fmtNum(s.ground_elevation_ft, ' ft')],
        ['Permit Status', fmtTxt(s.permit_status)],
        ['Movable', fmtBool(s.is_movable)],
        ['Permanent', fmtBool(s.is_permanent_structure)],
        ['Active', fmtBool(s.is_active)],
        ['Guest Capacity', s.guest_capacity ?? '--'],
        ['Bedrooms', s.bedrooms ?? '--'],
        ['Bathrooms', s.bathrooms ?? '--'],
        ['Plumbing', fmtBool(s.has_plumbing)],
        ['Electric', fmtBool(s.has_electric)],
        ['HVAC', fmtBool(s.has_hvac)],
        ['Condition', fmtTxt(s.condition)],
        ['Nearest Edge', s.nearest_edge_side ? `${esc(s.nearest_edge_side)} — ${s.nearest_edge_distance_ft}′` : '--'],
        ['Setback Required', fmtNum(s.setback_required_ft, ' ft')],
        ['Setback Compliant', fmtBool(s.setback_compliant)],
        ['Setback Surplus', s.setback_surplus_ft != null ? `${s.setback_surplus_ft > 0 ? '+' : ''}${s.setback_surplus_ft}′` : '--'],
        ['Display Order', s.display_order ?? '--'],
        ['Created', fmtDate(s.created_at)],
        ['Updated', fmtDate(s.updated_at)],
      ];

      out += `<div id="${detailId}" class="pp-tree-detail" style="padding-left:${1 + (depth + 1) * 1.25}rem">
        <dl class="pp-tree-detail-grid">
          ${fields.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
        </dl>
        ${s.notes ? `<div style="margin-top:0.5rem;font-size:0.8125rem;"><strong>Notes:</strong> ${esc(s.notes)}</div>` : ''}
        ${setbacks.length ? `<div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-muted);">
          <strong>Setback Measurements:</strong> ${setbacks.join(' · ')}
        </div>` : ''}
        <div style="margin-top:0.75rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
            <strong style="font-size:0.8125rem;">Rooms (${rooms.length})</strong>
            <a href="#" onclick="event.preventDefault();event.stopPropagation();addRoom(${s.id})" style="font-size:0.75rem;">+ Add room</a>
          </div>
          ${roomsHtml}
        </div>
      </div>`;

      return out;
    }

    // Render top-level spaces
    topSpaces.forEach(sp => { html += renderSpaceGroup(sp, 0); });

    // Render unmatched structures at root level
    if (unmatched.length) {
      html += `<div class="pp-tree-row pp-group" onclick="document.getElementById('spgrp-unmatched').classList.toggle('open');this.querySelector('.pp-tree-arrow').classList.toggle('open')">
        <span class="pp-tree-arrow">&#9654;</span>
        <span class="pp-tree-name" style="color:var(--text-muted)">Other Structures</span>
        <span class="pp-tree-badges"><span style="font-size:0.6875rem;color:var(--text-muted)">${unmatched.length}</span></span>
      </div>`;
      html += '<div id="spgrp-unmatched" class="pp-tree-children">';
      unmatched.forEach(s => { html += renderStructureRow(s, 0); });
      html += '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  } catch (err) {
    console.error('Structures load error:', err);
  }
}

// =============================================
// STRUCTURES TAB — Utilities
// =============================================

async function loadUtilities() {
  try {
    const { data } = await supabase.from('property_utilities').select('*').order('utility_type');
    const el = document.getElementById('utilitiesContainer');
    setCount('utilitiesCount', data?.length || 0);
    el.innerHTML = renderRecordCards(data, [
      ['Utility Type', 'utility_type'],
      ['Provider', 'provider'],
      ['Account Number', 'account_number'],
      ['Status', 'status'],
      ['System Type', 'system_type'],
      ['Capacity', 'capacity'],
      ['Location', 'location_description'],
      ['Availability Letter', 'availability_letter_status'],
      ['Notes', 'notes'],
    ], u => esc(u.utility_type || '--'));
  } catch (err) { console.error('Utilities load error:', err); }
}

// =============================================
// STRUCTURES TAB — Impervious Cover
// =============================================

async function loadImpervious() {
  try {
    const { data } = await supabase
      .from('impervious_cover')
      .select('*, structure:structure_id(name, space:space_id(name))')
      .order('id');
    const el = document.getElementById('imperviousContainer');
    setCount('imperviousCount', data?.length || 0);
    el.innerHTML = renderRecordCards(data, [
      ['Friendly Name', r => r.structure?.space?.name || '--'],
      ['DB Name', r => r.structure?.name || '--'],
      ['Surface Type', 'surface_type'],
      ['Area (sq ft)', r => r.area_sqft ? Number(r.area_sqft).toLocaleString() : '--'],
      ['Material', 'material'],
      ['Notes', 'notes'],
    ], r => {
      const friendly = r.structure?.space?.name;
      const db = r.structure?.name;
      return friendly && friendly !== db
        ? `${esc(friendly)} <span style="color:var(--text-muted);font-weight:400;font-size:0.8125rem;">(${esc(db || '')})</span>`
        : esc(friendly || db || '--');
    });
  } catch (err) { console.error('Impervious load error:', err); }
}

// =============================================
// STRUCTURES TAB — Zoning Rules
// =============================================

async function loadZoning() {
  try {
    const { data } = await supabase.from('zoning_rules').select('*').order('id');
    const el = document.getElementById('zoningContainer');
    el.innerHTML = renderRecordCards(data, [
      ['Jurisdiction', 'jurisdiction'],
      ['District Code', 'district_code'],
      ['District Name', 'district_name'],
      ['Rule Source', 'rule_source'],
      ['Front Setback (ft)', 'front_setback_ft'],
      ['Side Setback (ft)', 'side_setback_ft'],
      ['Rear Setback (ft)', 'rear_setback_ft'],
      ['Road Setback — Local/Rural (ft)', 'road_setback_local_rural_ft'],
      ['Road Setback — Ranch (ft)', 'road_setback_ranch_ft'],
      ['Road Setback — Collector (ft)', 'road_setback_collector_ft'],
      ['Road Setback — Arterial (ft)', 'road_setback_arterial_ft'],
      ['Lodging Road ROW Setback (ft)', 'lodging_road_row_setback_ft'],
      ['Lodging Property Line Setback (ft)', 'lodging_property_line_setback_ft'],
      ['Lodging Internal Road Setback (ft)', 'lodging_internal_road_setback_ft'],
      ['Lodging Unit Separation (ft)', 'lodging_unit_separation_ft'],
      ['Max Height (ft)', 'max_height_ft'],
      ['Max Lot Coverage (%)', 'max_lot_coverage_pct'],
      ['Max Impervious (%)', 'max_impervious_pct'],
      ['Min Lot Size (sq ft)', 'min_lot_size_sqft'],
      ['Exempt Structure (sq ft)', 'exempt_structure_sqft'],
      ['Container Behind Primary', 'container_behind_primary'],
      ['Container Screening Required', 'container_screening_required'],
      ['Container Screening Height (ft)', 'container_screening_height_ft'],
      ['Fire Separation (ft)', 'fire_separation_ft'],
      ['Notes', 'notes'],
    ], z => `${esc(z.jurisdiction || '')} — ${esc(z.district_name || z.district_code || '')}`);
  } catch (err) { console.error('Zoning load error:', err); }
}

// =============================================
// RENDERINGS TAB
// =============================================

const STORAGE_BASE = 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos';

const SURVEY_PLATS = [
  {
    title: 'Land Title Survey — 2025 Update',
    description: '4Ward Land Surveying (Jason Ward, R.P.L.S. #5811). Shows all current structures including trailers, shipping containers, pool, main house, back house. Lot 14-B, Block 6, Blue Bonnet Acres.',
    url: '../../jackie/pages/permittingplan/survey-ward-2025.png',
    date: '2025',
    tags: ['survey', 'current', '4Ward'],
  },
  {
    title: 'Land Title Survey — Original (2021)',
    description: 'Original land title survey by 4Ward Land Surveying (Feb 4, 2021). Lot 14-B, Block 6, Blue Bonnet Acres, Corrected Plat, Section One, Bastrop County.',
    url: '../../jackie/pages/permittingplan/survey-base.png',
    date: '2021-02-04',
    tags: ['survey', 'original', '4Ward'],
  },
];

const RENDERINGS = [
  {
    title: 'Bird\'s-Eye View — Full Property (DB Geometry)',
    description: '160 Still Forest Dr — 14 structures rendered from PostGIS footprint_geom. Main House (stone, brown roof), Back House (wood), 4 containers (red/blue/beige), 2 trailers, deck, sauna, bathroom bldg, pool, driveway. Yellow lines = property boundary. Orange lines = setback lines. Red pins = corner markers.',
    file: 'renderings/property-birdseye-2026-03-21.png',
    date: '2026-03-21',
    engine: 'Cycles',
    samples: 128,
    resolution: '2560 × 1440',
    tags: ['bird\'s-eye', 'full property', 'database-driven'],
  },
];

function renderCard(r, urlOverride) {
  const url = urlOverride || `${STORAGE_BASE}/${r.file}`;
  return `<div class="pp-render-card">
    <img src="${esc(url)}" alt="${esc(r.title)}" loading="lazy"
         onclick="window.open('${esc(url)}', '_blank')">
    <div class="pp-render-meta">
      <div class="pp-render-info">
        <h4>${esc(r.title)}</h4>
        <p>${esc(r.description)}</p>
        ${r.engine ? `<p style="margin-top:0.375rem;font-size:0.75rem;color:var(--text-muted);">
          ${esc(r.engine)} · ${r.samples ? `${r.samples} samples` : ''} · ${esc(r.resolution || '')} · ${esc(r.date)}
        </p>` : `<p style="margin-top:0.375rem;font-size:0.75rem;color:var(--text-muted);">${esc(r.date)}</p>`}
      </div>
      <div class="pp-render-tags">
        ${(r.tags || []).map(t => `<span class="pp-tool-tag">${esc(t)}</span>`).join('')}
      </div>
    </div>
  </div>`;
}

async function loadRenderingsTab() {
  // Populate survey plats
  const surveyEl = document.getElementById('surveyGrid');
  surveyEl.innerHTML = SURVEY_PLATS.map(s => renderCard(s, s.url)).join('');

  // Populate 3D renderings
  const el = document.getElementById('renderingsGrid');

  // Also list any additional renders from storage
  const { data: files } = await supabase.storage
    .from('housephotos')
    .list('renderings', { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });

  // Merge storage files with known renderings (avoid duplicates)
  const knownFiles = new Set(RENDERINGS.map(r => r.file.split('/').pop()));
  const extraFiles = (files || [])
    .filter(f => f.name.match(/\.(png|jpg|jpeg|webp)$/i) && !knownFiles.has(f.name))
    .map(f => ({
      title: f.name.replace(/[-_]/g, ' ').replace(/\.\w+$/, ''),
      description: '',
      file: `renderings/${f.name}`,
      date: f.created_at ? new Date(f.created_at).toISOString().slice(0, 10) : '--',
      tags: [],
    }));

  const allRenderings = [...RENDERINGS, ...extraFiles];

  if (!allRenderings.length) {
    el.innerHTML = '<div class="pp-empty">No renderings yet. Run <code>blender -P render_property.py</code> on Alpaca Mac to generate.</div>';
    return;
  }

  el.innerHTML = allRenderings.map(r => renderCard(r)).join('');
}

// =============================================
// STRUCTURE EDIT — Rooms + Category (admin)
// =============================================

async function refreshStructures() {
  loadedTabs.delete('structures');
  await loadStructures();
}

window.addRoom = async function(structureId) {
  const name = prompt('Room name:');
  if (!name) return;
  const length_ft = parseFloat(prompt('Length (ft):') || '') || null;
  const width_ft = parseFloat(prompt('Width (ft):') || '') || null;
  const height_ft = parseFloat(prompt('Height (ft):') || '') || null;
  const primary_materials = prompt('Primary materials (comma-separated, e.g. tile, wood, cork):') || null;
  const notes = prompt('Notes (optional):') || null;
  const { error } = await supabase.from('structure_rooms').insert({
    structure_id: structureId, name, length_ft, width_ft, height_ft, primary_materials, notes,
  });
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Room added', 'success');
  await refreshStructures();
};

window.editRoom = async function(roomId) {
  const { data: r, error } = await supabase.from('structure_rooms').select('*').eq('id', roomId).single();
  if (error || !r) { showToast('Could not load room', 'error'); return; }
  const name = prompt('Room name:', r.name); if (name === null) return;
  const length_ft = parseFloat(prompt('Length (ft):', r.length_ft ?? '') || '') || null;
  const width_ft = parseFloat(prompt('Width (ft):', r.width_ft ?? '') || '') || null;
  const height_ft = parseFloat(prompt('Height (ft):', r.height_ft ?? '') || '') || null;
  const primary_materials = prompt('Primary materials (comma-separated):', r.primary_materials ?? '');
  const notes = prompt('Notes:', r.notes ?? '');
  const { error: uErr } = await supabase.from('structure_rooms').update({
    name, length_ft, width_ft, height_ft, primary_materials: primary_materials || null, notes: notes || null, updated_at: new Date().toISOString(),
  }).eq('id', roomId);
  if (uErr) { showToast('Error: ' + uErr.message, 'error'); return; }
  showToast('Room updated', 'success');
  await refreshStructures();
};

window.deleteRoom = async function(roomId) {
  if (!confirm('Delete this room?')) return;
  const { error } = await supabase.from('structure_rooms').delete().eq('id', roomId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Room deleted', 'success');
  await refreshStructures();
};

window.editCategory = async function(structureId, current) {
  const category = prompt('Category (Building, Container, Trailer, wood-frame, etc.):', current || '');
  if (category === null) return;
  const { error } = await supabase.from('structures').update({ category: category || null }).eq('id', structureId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Category updated', 'success');
  await refreshStructures();
};
