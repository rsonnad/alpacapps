#!/usr/bin/env node
/**
 * Audits public SEO pointers against live page access settings.
 *
 * Public pages listed in sitemap.xml or rahulio/pages/pages-manifest.json should
 * never be hidden by a non-public page_access_settings row.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_ORIGIN = 'https://alpacaplayhouse.com';
const CHELSAE_PATH = '/rahulio/pages/chelsae-zirna-jacket-theft.html';

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function unique(values) {
  return [...new Set(values)].sort();
}

function pathFromUrl(url) {
  try {
    const parsed = new URL(url, SITE_ORIGIN);
    if (parsed.origin !== SITE_ORIGIN) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function extractSitemapPaths() {
  const xml = read('sitemap.xml');
  const paths = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const p = pathFromUrl(match[1].trim());
    if (p) paths.push(p);
  }
  return unique(paths);
}

function extractManifestPaths() {
  const manifest = JSON.parse(read('rahulio/pages/pages-manifest.json'));
  return unique((manifest.entries || []).map((entry) => `/rahulio/pages/${entry.path}`));
}

function extractStaticIndexPaths() {
  const html = read('rahulio/pages/index.html');
  const paths = [];
  for (const match of html.matchAll(/<a\s+[^>]*href="([^"]+)"/g)) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;
    const p = pathFromUrl(new URL(href, `${SITE_ORIGIN}/rahulio/pages/`).href);
    if (p?.startsWith('/rahulio/pages/')) paths.push(p);
  }
  return unique(paths);
}

function localFileForPublicPath(publicPath) {
  if (!publicPath.startsWith('/')) return null;
  let rel = publicPath.slice(1);
  if (rel.endsWith('/')) rel += 'index.html';
  return path.join(ROOT, rel);
}

function extractSupabaseConfig() {
  const js = read('shared/supabase.js');
  const url = js.match(/const SUPABASE_URL = '([^']+)'/)?.[1];
  const key = js.match(/const SUPABASE_ANON_KEY = '([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Could not read Supabase URL/key from shared/supabase.js');
  return { url, key };
}

async function fetchLiveAccessRows() {
  const { url, key } = extractSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/page_access_settings?select=page_path,visibility&order=page_path.asc`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase page_access_settings query failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assertLocalPointers({ sitemapPaths, manifestPaths, staticIndexPaths }) {
  const errors = [];
  const sitemapSet = new Set(sitemapPaths);
  const manifestSet = new Set(manifestPaths);
  const staticIndexSet = new Set(staticIndexPaths);
  const publicPaths = unique([...sitemapPaths.filter((p) => p.startsWith('/rahulio/pages/')), ...manifestPaths]);

  if (!sitemapSet.has(CHELSAE_PATH)) errors.push(`${CHELSAE_PATH} is missing from sitemap.xml`);
  if (!manifestSet.has(CHELSAE_PATH)) errors.push(`${CHELSAE_PATH} is missing from rahulio/pages/pages-manifest.json`);
  if (!staticIndexSet.has(CHELSAE_PATH)) errors.push(`${CHELSAE_PATH} is missing from the static rahulio/pages/index.html link list`);

  for (const manifestPath of manifestPaths) {
    if (!staticIndexSet.has(manifestPath)) {
      errors.push(`${manifestPath} is in pages-manifest.json but missing from the static pages index`);
    }
  }

  for (const publicPath of publicPaths) {
    const filePath = localFileForPublicPath(publicPath);
    if (!filePath || !fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1] || '';
    if (/\bnoindex\b/i.test(robots)) {
      errors.push(`${publicPath} is public-linked but declares robots noindex`);
    }
    if (sitemapSet.has(publicPath) && /initPersonalPage\s*\(/.test(html)) {
      errors.push(`${publicPath} is in sitemap.xml but still uses initPersonalPage(); use initPublicPage() for indexed pages`);
    }
  }

  return { errors, publicPaths };
}

async function main() {
  const sitemapPaths = extractSitemapPaths();
  const manifestPaths = extractManifestPaths();
  const staticIndexPaths = extractStaticIndexPaths();
  const { errors, publicPaths } = assertLocalPointers({ sitemapPaths, manifestPaths, staticIndexPaths });

  const rows = await fetchLiveAccessRows();
  const publicPathSet = new Set(publicPaths);
  for (const row of rows) {
    if (publicPathSet.has(row.page_path) && row.visibility !== 'public') {
      errors.push(`${row.page_path} is public-linked but live page_access_settings.visibility is ${row.visibility}`);
    }
  }

  if (errors.length) {
    console.error('Public page access audit failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Public page access audit passed: ${publicPaths.length} public Rahulio page pointers checked.`);
  console.log(`Chelsae pointers: sitemap=${sitemapPaths.includes(CHELSAE_PATH)} manifest=${manifestPaths.includes(CHELSAE_PATH)} staticIndex=${staticIndexPaths.includes(CHELSAE_PATH)}`);
  console.log(`Live access rows checked: ${rows.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
