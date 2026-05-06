#!/usr/bin/env node
/**
 * Generates rahulio/pages/pages-manifest.json by scanning all HTML files
 * under rahulio/pages/, extracting <title> and file mtime, grouping by section.
 * Run when adding new pages so the index stays updated (or in CI).
 *
 * Usage: node scripts/rahulio-pages-manifest.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PAGES_DIR = path.join(__dirname, '..', 'rahulio', 'pages');
const MANIFEST_PATH = path.join(PAGES_DIR, 'pages-manifest.json');
const INDEX_PATH = path.join(PAGES_DIR, 'index.html');
const STATIC_BEGIN = '<!-- BEGIN_STATIC_PAGES_LIST';
const STATIC_END = '<!-- END_STATIC_PAGES_LIST -->';

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function extractTitle(html) {
  const m = html.match(TITLE_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildStaticListHtml(manifest) {
  const entries = manifest.entries || [];
  const sectionOrder = [null, ...(manifest.sections || [])];
  const bySection = {};
  for (const e of entries) {
    const key = e.section != null ? e.section : '';
    if (!bySection[key]) bySection[key] = [];
    bySection[key].push(e);
  }
  const lines = [];
  for (const section of sectionOrder) {
    const key = section == null ? '' : section;
    const list = bySection[key] || [];
    if (list.length === 0) continue;
    if (section) lines.push(`            <div class="section-label">${escapeHtml(section)}</div>`);
    lines.push('            <ul class="pages-list">');
    for (const e of list) {
      lines.push(`                <li><a href="${escapeHtml(e.path)}"><div class="page-title">${escapeHtml(e.title)}</div></a></li>`);
    }
    lines.push('            </ul>');
  }
  return lines.join('\n');
}

function updateStaticList(manifest) {
  let html;
  try {
    html = fs.readFileSync(INDEX_PATH, 'utf8');
  } catch (err) {
    console.warn('Could not read', INDEX_PATH, '— skipping static list update:', err.message);
    return;
  }
  const beginIdx = html.indexOf(STATIC_BEGIN);
  const endIdx = html.indexOf(STATIC_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.warn('Static list markers not found in', INDEX_PATH, '— skipping');
    return;
  }
  const beginLineEnd = html.indexOf('\n', beginIdx);
  const beginEnd = beginLineEnd === -1 ? beginIdx + STATIC_BEGIN.length : beginLineEnd;
  const staticHtml = buildStaticListHtml(manifest);
  const next = html.slice(0, beginEnd + 1) + staticHtml + '\n            ' + html.slice(endIdx);
  if (next !== html) {
    fs.writeFileSync(INDEX_PATH, next, 'utf8');
    console.log('Updated static list in', INDEX_PATH);
  }
}

/** Map directory prefixes to section names. */
const SECTION_MAP = [
  { prefix: 'e2v/', section: 'E-2 Visa' },
  { prefix: 'bandb/', section: 'Projects' },
  { prefix: 'iaw/', section: 'Projects' },
  { prefix: 'sloop/', section: 'Projects' },
];

function getSection(relativePath) {
  const lower = relativePath.toLowerCase();
  for (const { prefix, section } of SECTION_MAP) {
    if (lower.startsWith(prefix)) return section;
  }
  return null;
}

function walkDir(dir, baseDir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const relative = path.relative(baseDir, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      walkDir(full, baseDir, acc);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
      if (relative === 'index.html') continue; // skip the listing page itself
      acc.push(relative);
    }
  }
}

function main() {
  const paths = [];
  walkDir(PAGES_DIR, PAGES_DIR, paths);

  const entries = [];
  const sectionsSet = new Set();

  for (const rel of paths) {
    const full = path.join(PAGES_DIR, rel);
    let title = null;
    let modifiedAt = null;

    try {
      const html = fs.readFileSync(full, 'utf8');
      title = extractTitle(html);
      if (!title) {
        console.warn('Warning: no <title> found in', rel, '— using filename as fallback');
      }
    } catch (err) {
      console.error('Failed to read', rel, err.message);
    }

    // Use git log for real last-modified date (not filesystem mtime which resets on checkout).
    // --invert-grep --grep='[skip ci]' excludes CI version-bump commits that touch every
    // HTML file (rewriting version strings), so we get the actual content-change date.
    try {
      const gitDate = execSync(
        `git log -1 --format=%aI --invert-grep --grep='\\[skip ci\\]' -- "${path.join('rahulio/pages', rel)}"`,
        { encoding: 'utf8', cwd: path.join(__dirname, '..') }
      ).trim();
      if (gitDate) modifiedAt = new Date(gitDate).toISOString();
    } catch (_) { /* ignore — not in git or no history */ }

    // Fallback to filesystem mtime if git didn't work
    if (!modifiedAt) {
      try {
        modifiedAt = fs.statSync(full).mtime.toISOString();
      } catch (_) { /* ignore */ }
    }

    const section = getSection(rel);
    if (section) sectionsSet.add(section);

    entries.push({
      path: rel,
      title: title || rel,
      section,
      modifiedAt,
    });
  }

  // Sort: by section order, then reverse chronological within each section
  const sectionList = [null, ...sectionsSet];
  const sectionIndex = Object.fromEntries(sectionList.map((s, i) => [s ?? '__null__', i]));

  entries.sort((a, b) => {
    const sa = sectionIndex[a.section ?? '__null__'] ?? 999;
    const sb = sectionIndex[b.section ?? '__null__'] ?? 999;
    if (sa !== sb) return sa - sb;
    // Reverse chronological (newest first) within section
    const ma = a.modifiedAt || '';
    const mb = b.modifiedAt || '';
    return mb.localeCompare(ma);
  });

  // Ordered list of sections (for the frontend to consume)
  const sections = sectionList.filter(s => s !== null);

  const manifest = {
    generatedAt: new Date().toISOString(),
    sections,
    entries,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Wrote', MANIFEST_PATH, 'with', entries.length, 'entries');

  updateStaticList(manifest);
}

main();
