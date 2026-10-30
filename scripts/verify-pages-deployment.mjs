// A successful push is not proof that the public CDN has the new files.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const site = process.env.PAGES_SITE_DIR;
if (!site) throw new Error('PAGES_SITE_DIR is required');
const base = new URL(process.env.PAGES_BASE_URL || 'https://alpacaplayhouse.com/');
const timeout = Number(process.env.PAGES_VERIFY_TIMEOUT_MS || 300000);
const pause = Number(process.env.PAGES_VERIFY_INTERVAL_MS || 15000);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['_deployment.json', 'version.json'];

async function findPages(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await findPages(path.join(directory, entry.name), relative);
    else if (entry.name.endsWith('.html')) files.push(relative);
  }
}
try {
  await findPages(path.join(site, 'muse'), 'muse');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const pending = new Map(await Promise.all(files.map(async file =>
  [file, hash(await readFile(path.join(site, file)))])));
const deadline = Date.now() + timeout;
while (pending.size && Date.now() < deadline) {
  await Promise.all([...pending].map(async ([file, expected]) => {
    const url = new URL(file.split('/').map(encodeURIComponent).join('/'), base);
    url.searchParams.set('deployment-check', `${Date.now()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (hash(Buffer.from(await response.arrayBuffer())) !== expected) throw new Error('stale content');
      pending.delete(file);
      console.log(`Verified ${new URL(file, base)}`);
    } catch (error) {
      console.log(`Waiting for ${file}: ${error.message}`);
    }
  }));
  if (pending.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, pause));
}
if (pending.size) throw new Error(`Public deployment verification failed: ${[...pending.keys()].join(', ')}`);
console.log(`Public deployment verified (${files.length} files).`);
