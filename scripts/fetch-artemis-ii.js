#!/usr/bin/env node
/**
 * fetch-artemis-ii.js
 *
 * Pulls Artemis II images from NASA's Image Library API
 * (https://images-api.nasa.gov/) — clean, official, high-resolution.
 * Replaces an earlier HTML-scraping approach that pulled in unrelated
 * sidebar/teaser images (Earth Observatory Image of the Day, etc).
 *
 * For each search hit:
 *   1. Fetch the asset collection.json which lists all renditions
 *   2. Pick the "~orig" (or largest available) image
 *   3. Download to OUT_DIR/images/<nasa_id>.<ext>
 *   4. Stash original in originals/ and downscale image to MAX_DIM via sips
 *
 * Output layout (default OUT_DIR=/Volumes/rvault20/media/artemis-ii):
 *   OUT_DIR/images/<file>.jpg              (downscaled, served to TVs)
 *   OUT_DIR/originals/<file>.jpg           (full-res archive)
 *   OUT_DIR/manifest.json                  ({ generated_at, items: [{type,url,caption,credit}] })
 *
 * The `url` field in the manifest is rewritten to BASE_URL so the static
 * media server on Alpuca can serve it (default
 * http://192.168.1.200:8200/artemis-ii).
 *
 * Run on Alpuca so writes hit the locally-mounted RVAULT20:
 *   ssh paca@192.168.1.200 "node /Users/alpuca/bin/fetch-artemis-ii.js"
 *
 * Re-runs are idempotent: existing files are skipped.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { URL } = require('url');

const QUERIES = (process.env.QUERIES || 'Artemis II').split('|');
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '3', 10);
const TITLE_MODE = process.env.TITLE_MODE !== '0';
const OUT_DIR = process.env.OUT_DIR || '/Volumes/rvault20/media/artemis-ii';
const BASE_URL = (process.env.BASE_URL || 'http://192.168.1.200:8200/artemis-ii').replace(/\/$/, '');
const MAX_DIM = parseInt(process.env.MAX_DIM || '2560', 10); // 0 = keep originals only
const UA = 'AlpacAppsArtemisFetch/2.0 (+https://alpacaplayhouse.com)';

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(get(next, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout: ' + url)));
  });
}

async function getJSON(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const res = await get(url);
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(tmp);
    res.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
    res.on('error', reject);
  });
  fs.renameSync(tmp, dest);
  return true;
}

function safeName(nasaId, ext) {
  const cleaned = String(nasaId).replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned + ext;
}

// Walk a search result page (paginated). Returns Set of nasa_ids.
async function searchAll(query) {
  const ids = new Set();
  const items = [];
  const param = TITLE_MODE ? 'title' : 'q';
  let url = `https://images-api.nasa.gov/search?${param}=${encodeURIComponent(query)}&media_type=image`;
  let page = 0;
  while (url && page < MAX_PAGES) {
    page++;
    let body;
    try {
      console.log(`[artemis] search "${query}" page ${page}`);
      body = await getJSON(url);
    } catch (e) {
      console.warn('[artemis] search failed:', e.message);
      break;
    }
    const collection = body.collection || {};
    for (const it of (collection.items || [])) {
      const data = (it.data && it.data[0]) || {};
      if (!data.nasa_id || ids.has(data.nasa_id)) continue;
      ids.add(data.nasa_id);
      items.push({
        nasa_id: data.nasa_id,
        title: data.title || '',
        description: data.description || '',
        photographer: data.photographer || data.secondary_creator || 'NASA',
        date_created: data.date_created || '',
        center: data.center || '',
        href: it.href, // collection.json URL
      });
    }
    const next = (collection.links || []).find(l => l.rel === 'next');
    url = next ? next.href : null;
  }
  return items;
}

// Pick the highest-resolution rendition from an asset collection.json.
function pickBestRendition(assetCollection) {
  // Asset collection.json is a flat array of URL strings.
  let urls = [];
  if (Array.isArray(assetCollection)) {
    urls = assetCollection.filter(u => typeof u === 'string');
  } else {
    const items = (assetCollection.collection && assetCollection.collection.items) || [];
    urls = items.map(i => i.href).filter(Boolean);
  }
  urls = urls.filter(u => /\.(jpe?g|png|tif|tiff)(\?|$)/i.test(u));
  // Preference order: ~orig > ~large > ~medium > ~small > ~thumb
  const rank = u => {
    if (/~orig\./i.test(u)) return 0;
    if (/~large\./i.test(u)) return 1;
    if (/~medium\./i.test(u)) return 2;
    if (/~small\./i.test(u)) return 3;
    if (/~thumb\./i.test(u)) return 4;
    return 5;
  };
  urls.sort((a, b) => rank(a) - rank(b));
  return urls[0] || null;
}

(async () => {
  console.log('[artemis] queries =', QUERIES);
  console.log('[artemis] out     =', OUT_DIR);
  console.log('[artemis] base    =', BASE_URL);
  fs.mkdirSync(path.join(OUT_DIR, 'images'), { recursive: true });

  // 1. Run all searches, dedupe by nasa_id
  const byId = new Map();
  for (const q of QUERIES) {
    const items = await searchAll(q);
    for (const it of items) if (!byId.has(it.nasa_id)) byId.set(it.nasa_id, it);
  }
  console.log(`[artemis] ${byId.size} unique NASA images across ${QUERIES.length} search(es)`);

  // 2. For each, fetch asset manifest and pick best rendition
  const manifestItems = [];
  let dl = 0, skip = 0, fail = 0;
  for (const it of byId.values()) {
    let bestUrl;
    try {
      const asset = await getJSON(it.href);
      bestUrl = pickBestRendition(asset);
    } catch (e) {
      console.warn('[artemis] asset fetch failed:', it.nasa_id, e.message);
      fail++;
      continue;
    }
    if (!bestUrl) { fail++; continue; }
    const ext = path.extname(new URL(bestUrl).pathname).toLowerCase() || '.jpg';
    const name = safeName(it.nasa_id, ext);
    const dest = path.join(OUT_DIR, 'images', name);
    try {
      const downloaded = await download(bestUrl, dest);
      if (downloaded) dl++; else skip++;
      manifestItems.push({
        type: 'image',
        url: `${BASE_URL}/images/${name}`,
        caption: it.title,
        credit: it.photographer,
        date: it.date_created,
        center: it.center,
        nasa_id: it.nasa_id,
        source: bestUrl,
      });
    } catch (e) {
      fail++;
      console.warn('[artemis] download failed:', bestUrl, e.message);
    }
  }

  // 3. Write manifest
  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'https://images-api.nasa.gov/search?q=Artemis%20II&media_type=image',
    base_url: BASE_URL,
    counts: { total: manifestItems.length, images: manifestItems.length, videos: 0 },
    items: manifestItems,
  };
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[artemis] wrote ${manifestPath}`);
  console.log(`[artemis] downloaded=${dl} skipped=${skip} failed=${fail}`);

  // 4. Stash originals and downscale to MAX_DIM (macOS sips). MAX_DIM=0 to skip.
  if (MAX_DIM > 0 && process.platform === 'darwin') {
    const origDir = path.join(OUT_DIR, 'originals');
    fs.mkdirSync(origDir, { recursive: true });
    let resized = 0;
    for (const f of fs.readdirSync(path.join(OUT_DIR, 'images'))) {
      const src = path.join(OUT_DIR, 'images', f);
      const orig = path.join(origDir, f);
      try {
        if (!fs.existsSync(orig)) fs.copyFileSync(src, orig);
        execFileSync('sips', ['-Z', String(MAX_DIM), src], { stdio: 'ignore' });
        resized++;
      } catch (e) { /* sips not present or non-image */ }
    }
    console.log(`[artemis] resized ${resized} images to max ${MAX_DIM}px`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
