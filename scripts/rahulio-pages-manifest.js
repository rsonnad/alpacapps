#!/usr/bin/env node
/**
 * Generates rahulio/pages/pages-manifest.json by scanning all HTML files
 * under rahulio/pages/, extracting <title>, and grouping by section.
 * Run when adding new pages so the index stays updated (or in CI).
 *
 * Usage: node scripts/rahulio-pages-manifest.js
 */

const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'rahulio', 'pages');
const MANIFEST_PATH = path.join(PAGES_DIR, 'pages-manifest.json');

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function extractTitle(html) {
  const m = html.match(TITLE_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function getSection(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.startsWith('e2v/')) return 'E-2 Visa';
  if (lower.startsWith('bandb/') || lower.startsWith('iaw/') || lower.startsWith('sloop/')) return 'Projects';
  return null;
}

function sectionOrder(section) {
  if (!section) return 0;
  if (section === 'E-2 Visa') return 1;
  if (section === 'Projects') return 2;
  return 3;
}

function findHtmlFiles(dir, baseDir = dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const relative = path.relative(baseDir, full);
    if (e.isDirectory()) {
      findHtmlFiles(full, baseDir, acc);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.html') && e.name.toLowerCase() !== 'index.html') {
      acc.push(relative);
    }
  }
  return acc;
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

function allPagePaths() {
  const paths = [];
  walkDir(PAGES_DIR, PAGES_DIR, paths);
  return paths.sort((a, b) => {
    const secA = sectionOrder(getSection(a));
    const secB = sectionOrder(getSection(b));
    if (secA !== secB) return secA - secB;
    return a.localeCompare(b);
  });
}

function main() {
  const paths = allPagePaths();
  const entries = [];

  for (const rel of paths) {
    const full = path.join(PAGES_DIR, rel);
    let title = null;
    try {
      const html = fs.readFileSync(full, 'utf8');
      title = extractTitle(html);
    } catch (err) {
      console.error('Failed to read', rel, err.message);
    }
    entries.push({
      path: rel,
      title: title || rel,
      section: getSection(rel),
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    entries,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('Wrote', MANIFEST_PATH, 'with', entries.length, 'entries');
}

main();
