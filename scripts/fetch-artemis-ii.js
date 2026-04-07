#!/usr/bin/env node
/**
 * fetch-artemis-ii.js
 *
 * Scrape https://www.nasa.gov/artemis-ii-multimedia/ for images (and videos),
 * download originals to a target directory, and write a manifest.json that the
 * Garage Mahal TV slideshow loader can consume.
 *
 * Output layout (default OUT_DIR=/Volumes/rvault20/media/artemis-ii):
 *   OUT_DIR/images/<file>.jpg
 *   OUT_DIR/videos/<file>.mp4
 *   OUT_DIR/manifest.json   ->   { generated_at, source, items: [{type,url,caption,credit}] }
 *
 * The `url` field in the manifest is rewritten to point at the HTTP server that
 * serves OUT_DIR. Set BASE_URL to control that prefix
 * (default http://192.168.1.200:8088/artemis-ii).
 *
 * Run on Alpuca so the writes hit the locally-mounted RVAULT20:
 *   ssh almaca "cd /path/to/repo && node scripts/fetch-artemis-ii.js"
 *
 * Re-runs are idempotent: existing files are skipped.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const SOURCE = process.env.SOURCE_URL || 'https://www.nasa.gov/artemis-ii-multimedia/';
const OUT_DIR = process.env.OUT_DIR || '/Volumes/rvault20/media/artemis-ii';
const BASE_URL = (process.env.BASE_URL || 'http://192.168.1.200:8088/artemis-ii').replace(/\/$/, '');
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '20', 10);
const UA = 'AlpacAppsArtemisFetch/1.0 (+https://alpacaplayhouse.com)';

const IMG_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const VID_EXT = /\.(mp4|mov|m4v)(\?|$)/i;

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
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

async function getText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
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

function absolutize(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

// Strip srcset sizing suffix like "-1024x576" so we land on the original.
function stripWpSizes(u) {
  return u.replace(/-\d+x\d+(?=\.[a-z0-9]+(\?|$))/i, '');
}

function safeName(u) {
  const p = new URL(u).pathname.split('/').pop() || 'file';
  const cleaned = p.replace(/[^A-Za-z0-9._-]/g, '_');
  // Prefix with a short hash of the full URL path to avoid basename collisions
  // (NASA wp-uploads has many same-named files in different month dirs).
  const hash = crypto.createHash('sha1').update(new URL(u).pathname).digest('hex').slice(0, 8);
  return `${hash}-${cleaned}`;
}

// Extract media URLs + nearby caption/credit from a page's HTML.
function extractMedia(html, baseUrl) {
  const items = new Map(); // url -> { type, caption, credit }

  const addImg = (raw, caption, credit) => {
    if (!raw) return;
    const cleaned = stripWpSizes(absolutize(raw, baseUrl) || '');
    if (!cleaned || !IMG_EXT.test(cleaned)) return;
    // Skip site chrome (logos, theme assets, icons, avatars)
    if (/\/wp-content\/(themes|plugins)\//i.test(cleaned)) return;
    if (/\b(logo|sprite|icon|favicon|avatar|placeholder)\b/i.test(cleaned)) return;
    if (!items.has(cleaned)) items.set(cleaned, { type: 'image', caption: caption || '', credit: credit || '' });
  };
  const addVid = (raw, caption, credit) => {
    if (!raw) return;
    const cleaned = absolutize(raw, baseUrl);
    if (!cleaned || !VID_EXT.test(cleaned)) return;
    if (!items.has(cleaned)) items.set(cleaned, { type: 'video', caption: caption || '', credit: credit || '' });
  };

  // <img src=... alt=...> and srcset entries
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    const dataSrc = (tag.match(/\bdata-(?:src|lazy-src|original)=["']([^"']+)["']/i) || [])[1];
    const srcset = (tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1];
    const alt = (tag.match(/\balt=["']([^"']*)["']/i) || [])[1] || '';
    addImg(dataSrc || src, alt);
    if (srcset) {
      // Pick the largest from srcset
      const parts = srcset.split(',').map(s => s.trim().split(/\s+/));
      let best = null, bestW = 0;
      for (const [u, w] of parts) {
        const wn = parseInt((w || '').replace(/\D/g, ''), 10) || 0;
        if (wn >= bestW) { bestW = wn; best = u; }
      }
      if (best) addImg(best, alt);
    }
  }

  // <a href="...jpg|png|mp4"> direct links
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((m = aRe.exec(html))) {
    const href = m[1];
    if (IMG_EXT.test(href)) addImg(href, '');
    else if (VID_EXT.test(href)) addVid(href, '');
  }

  // <video><source src="..."></video>
  const srcRe = /<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = srcRe.exec(html))) {
    if (VID_EXT.test(m[1])) addVid(m[1], '');
  }

  return items;
}

// Find pagination links (e.g. ?page=2 or /page/2/) on a NASA gallery page.
function extractPaginationLinks(html, baseUrl) {
  const links = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/[?&]page=\d+/i.test(href) || /\/page\/\d+\/?/.test(href)) {
      const abs = absolutize(href, baseUrl);
      if (abs && abs.startsWith('https://www.nasa.gov/')) links.add(abs);
    }
  }
  return [...links];
}

(async () => {
  console.log('[artemis] source =', SOURCE);
  console.log('[artemis] out    =', OUT_DIR);
  console.log('[artemis] base   =', BASE_URL);
  fs.mkdirSync(path.join(OUT_DIR, 'images'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'videos'), { recursive: true });

  const seenPages = new Set();
  const queue = [SOURCE];
  const all = new Map();

  while (queue.length && seenPages.size < MAX_PAGES) {
    const pageUrl = queue.shift();
    if (seenPages.has(pageUrl)) continue;
    seenPages.add(pageUrl);
    let html;
    try {
      console.log('[artemis] fetch page', pageUrl);
      html = await getText(pageUrl);
    } catch (e) {
      console.warn('[artemis] page failed:', pageUrl, e.message);
      continue;
    }
    const found = extractMedia(html, pageUrl);
    for (const [u, meta] of found) if (!all.has(u)) all.set(u, meta);
    for (const next of extractPaginationLinks(html, pageUrl)) {
      if (!seenPages.has(next)) queue.push(next);
    }
  }

  console.log(`[artemis] discovered ${all.size} media items across ${seenPages.size} page(s)`);

  const manifestItems = [];
  let dlCount = 0, skipCount = 0, failCount = 0;

  for (const [url, meta] of all) {
    const isVideo = meta.type === 'video';
    const subdir = isVideo ? 'videos' : 'images';
    const name = safeName(url);
    const dest = path.join(OUT_DIR, subdir, name);
    try {
      const downloaded = await download(url, dest);
      if (downloaded) dlCount++; else skipCount++;
      manifestItems.push({
        type: meta.type,
        url: `${BASE_URL}/${subdir}/${name}`,
        caption: meta.caption || '',
        credit: meta.credit || '',
        source: url,
      });
    } catch (e) {
      failCount++;
      console.warn('[artemis] download failed:', url, e.message);
    }
  }

  // Dedupe manifest entries by output URL (multiple source URLs can map to the
  // same destination file after stripWpSizes/hash collapse).
  const seenUrls = new Set();
  const dedupedItems = [];
  for (const it of manifestItems) {
    if (seenUrls.has(it.url)) continue;
    seenUrls.add(it.url);
    dedupedItems.push(it);
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    base_url: BASE_URL,
    counts: {
      total: dedupedItems.length,
      images: dedupedItems.filter(i => i.type === 'image').length,
      videos: dedupedItems.filter(i => i.type === 'video').length,
    },
    items: dedupedItems,
  };
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[artemis] wrote ${manifestPath}`);
  console.log(`[artemis] downloaded=${dlCount} skipped=${skipCount} failed=${failCount}`);
})().catch((e) => { console.error(e); process.exit(1); });
