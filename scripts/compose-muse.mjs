// Builds the site's agent folders from the repos listed in <area>-sources.json:
// muse/ (Meta Muse, muse-sources.json), bots/ and botsy/ (Grokbot, bots-sources.json
// and botsy-sources.json).
// These repos are untrusted content: nothing from them is executed, only regular
// files under <area>/<project>/ are copied, and a repo can never publish a project
// that the sources file gives to another repo.
//
//   node scripts/compose-muse.mjs resolve                 -> prints {"muse": {"repo": "sha"}, "bots": {...}, "botsy": {...}}
//   node scripts/compose-muse.mjs compose <siteDir> <lock> -> fills <siteDir>/muse, /bots and /botsy
//   node scripts/compose-muse.mjs check                   -> changed=true|false (vs live site)
import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const MAX_BYTES = 300 * 1024 * 1024;
export const AREAS = ['muse', 'bots', 'botsy'];

export function loadSources(area = 'muse', file = path.join(root, `${area}-sources.json`)) {
  const { sources } = JSON.parse(readFileSync(file, 'utf8'));
  const claimed = new Map();
  for (const s of sources) {
    if (!REPO.test(s.repo)) throw new Error(`Bad repo name: ${s.repo}`);
    for (const p of s.projects || []) {
      if (!SLUG.test(p)) throw new Error(`Bad project name: ${p}`);
      if (claimed.has(p)) throw new Error(`Project ${p} is listed for two repos`);
      claimed.set(p, s.repo);
    }
  }
  return { sources, claimed };
}

// Plain output under `node --test`, so test inputs don't show up as CI warnings.
const warn = msg => console.log(process.env.NODE_TEST_CONTEXT ? `warning: ${msg}` : `::warning::${msg}`);

function resolve(sources) {
  const lock = {};
  for (const { repo } of sources) {
    const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, 'refs/heads/main'], { encoding: 'utf8' });
    const sha = out.split(/\s/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Could not resolve main of ${repo}`);
    lock[repo] = sha;
  }
  return lock;
}

// Pure decision step, kept separate so it can be tested without git.
// found: { repo: [projects present in that repo] } -> { project: repo }
// reserved: projects this repo (alpacapps) commits itself, e.g. bots/feedback.
export function choose(found, claimed, area = 'muse', reserved = new Set()) {
  const holders = new Map();
  for (const [repo, projects] of Object.entries(found)) {
    for (const p of projects) {
      if (reserved.has(p)) { warn(`${repo}: skipped ${area}/${p} (kept by rsonnad/alpacapps)`); continue; }
      if (!SLUG.test(p)) { warn(`${repo}: skipped ${area}/${p} (names must be lowercase letters, digits and dashes)`); continue; }
      const owner = claimed.get(p);
      if (owner && owner !== repo) { warn(`${repo}: skipped ${area}/${p} (owned by ${owner})`); continue; }
      if (!holders.has(p)) holders.set(p, []);
      holders.get(p).push(repo);
    }
  }
  const result = {};
  for (const [p, repos] of holders) {
    if (repos.length > 1) { warn(`${area}/${p} is in ${repos.join(' and ')} and not listed in ${area}-sources.json; not published`); continue; }
    result[p] = repos[0];
  }
  return result;
}

// Removes anything that is not a plain directory or regular file. Returns total bytes.
function sanitize(dir, label) {
  let bytes = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = lstatSync(full);
    if (st.isDirectory()) bytes += sanitize(full, `${label}/${entry}`);
    else if (st.isFile()) bytes += st.size;
    else { warn(`skipped ${label}/${entry} (not a regular file)`); rmSync(full, { force: true }); }
  }
  return bytes;
}

function fetchArea(area, repo, sha, work) {
  const dir = path.join(work, `${area}__${repo.replace('/', '__')}`);
  mkdirSync(dir, { recursive: true });
  const git = args => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  git(['init', '-q']);
  git(['fetch', '-q', '--depth', '1', `https://github.com/${repo}.git`, sha]);
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const hasArea = execFileSync('git', ['-C', dir, 'ls-tree', '--name-only', sha, area], { encoding: 'utf8' }).trim();
  if (!hasArea) return path.join(out, area);
  execSync(`git -C "${dir}" archive --format=tar ${sha} ${area} | tar -x -C "${out}"`, { shell: '/bin/bash', stdio: 'inherit' });
  const areaDir = path.join(out, area);
  if (!lstatSync(areaDir).isDirectory()) return path.join(out, 'missing');
  const bytes = sanitize(areaDir, `${repo}:${area}`);
  if (bytes > MAX_BYTES) throw new Error(`${repo} ${area}/ is ${bytes} bytes, over the ${MAX_BYTES} limit`);
  return areaDir;
}

function composeArea(area, siteDir, lock, meta) {
  const { sources, claimed } = loadSources(area);
  const work = mkdtempSync(path.join(tmpdir(), `${area}-`));
  const dirs = {};
  const found = {};
  for (const { repo } of sources) {
    const sha = lock[repo];
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`No pinned sha for ${repo}`);
    dirs[repo] = fetchArea(area, repo, sha, work);
    found[repo] = existsSync(dirs[repo])
      ? readdirSync(dirs[repo]).filter(p => lstatSync(path.join(dirs[repo], p)).isDirectory())
      : [];
  }
  // Whatever the site archive already has under <area>/ was committed to
  // alpacapps itself; keep it and never let an agent repo replace it.
  const target = path.join(siteDir, area);
  const reserved = new Set(existsSync(target) ? readdirSync(target) : []);
  const chosen = choose(found, claimed, area, reserved);
  mkdirSync(target, { recursive: true });
  for (const [p, repo] of Object.entries(chosen).sort()) {
    cpSync(path.join(dirs[repo], p), path.join(target, p), { recursive: true });
    console.log(`${area}/${p} <- ${repo}@${lock[repo].slice(0, 10)}`);
  }
  meta[area] = lock;
  rmSync(work, { recursive: true, force: true });
}

const resolveAll = () => Object.fromEntries(AREAS.map(area => [area, resolve(loadSources(area).sources)]));

function compose(siteDir, locks) {
  const deployment = path.join(siteDir, '_deployment.json');
  const meta = existsSync(deployment) ? JSON.parse(readFileSync(deployment, 'utf8')) : {};
  for (const area of AREAS) composeArea(area, siteDir, locks[area] || {}, meta);
  writeFileSync(deployment, JSON.stringify(meta));
}

async function check() {
  const locks = resolveAll();
  let live = {};
  try {
    const res = await fetch(`https://alpacaplayhouse.com/_deployment.json?muse-check=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) live = await res.json();
  } catch (error) {
    console.log(`Could not read live _deployment.json: ${error.message}`);
  }
  const changed = AREAS.some(area => Object.entries(locks[area]).some(([repo, sha]) => (live[area] || {})[repo] !== sha));
  console.log(`Agent page sources ${changed ? 'changed' : 'unchanged'}: ${JSON.stringify(locks)}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'resolve') process.stdout.write(JSON.stringify(resolveAll()));
  else if (cmd === 'compose') compose(a, JSON.parse(b));
  else if (cmd === 'check') await check();
  else { console.error('usage: compose-muse.mjs resolve | compose <siteDir> <lockJson> | check'); process.exit(64); }
}
