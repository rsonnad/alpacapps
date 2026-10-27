// Builds the site's muse/ folder from the Muse repos listed in muse-sources.json.
// Muse repos are untrusted content: nothing from them is executed, only regular
// files under muse/<project>/ are copied, and a repo can never publish a project
// that muse-sources.json gives to another repo.
//
//   node scripts/compose-muse.mjs resolve                 -> prints {"repo": "sha", ...}
//   node scripts/compose-muse.mjs compose <siteDir> <lock> -> fills <siteDir>/muse
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

export function loadSources(file = process.env.MUSE_SOURCES_FILE || path.join(root, 'muse-sources.json')) {
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

const warn = msg => console.log(`::warning::${msg}`);

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
export function choose(found, claimed) {
  const holders = new Map();
  for (const [repo, projects] of Object.entries(found)) {
    for (const p of projects) {
      if (!SLUG.test(p)) { warn(`${repo}: skipped muse/${p} (names must be lowercase letters, digits and dashes)`); continue; }
      const owner = claimed.get(p);
      if (owner && owner !== repo) { warn(`${repo}: skipped muse/${p} (owned by ${owner})`); continue; }
      if (!holders.has(p)) holders.set(p, []);
      holders.get(p).push(repo);
    }
  }
  const result = {};
  for (const [p, repos] of holders) {
    if (repos.length > 1) { warn(`muse/${p} is in ${repos.join(' and ')} and not listed in muse-sources.json; not published`); continue; }
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

function fetchMuse(repo, sha, work) {
  const dir = path.join(work, repo.replace('/', '__'));
  mkdirSync(dir, { recursive: true });
  const git = args => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  git(['init', '-q']);
  git(['fetch', '-q', '--depth', '1', `https://github.com/${repo}.git`, sha]);
  const out = path.join(dir, 'out');
  mkdirSync(out);
  const hasMuse = execFileSync('git', ['-C', dir, 'ls-tree', '--name-only', sha, 'muse'], { encoding: 'utf8' }).trim();
  if (!hasMuse) return path.join(out, 'muse');
  execSync(`git -C "${dir}" archive --format=tar ${sha} muse | tar -x -C "${out}"`, { shell: '/bin/bash', stdio: 'inherit' });
  const museDir = path.join(out, 'muse');
  if (!lstatSync(museDir).isDirectory()) return path.join(out, 'missing');
  const bytes = sanitize(museDir, `${repo}:muse`);
  if (bytes > MAX_BYTES) throw new Error(`${repo} muse/ is ${bytes} bytes, over the ${MAX_BYTES} limit`);
  return museDir;
}

function compose(siteDir, lock) {
  const { sources, claimed } = loadSources();
  const work = mkdtempSync(path.join(tmpdir(), 'muse-'));
  const dirs = {};
  const found = {};
  for (const { repo } of sources) {
    const sha = lock[repo];
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`No pinned sha for ${repo}`);
    dirs[repo] = fetchMuse(repo, sha, work);
    found[repo] = existsSync(dirs[repo])
      ? readdirSync(dirs[repo]).filter(p => lstatSync(path.join(dirs[repo], p)).isDirectory())
      : [];
  }
  const chosen = choose(found, claimed);
  const target = path.join(siteDir, 'muse');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const [p, repo] of Object.entries(chosen).sort()) {
    cpSync(path.join(dirs[repo], p), path.join(target, p), { recursive: true });
    console.log(`muse/${p} <- ${repo}@${lock[repo].slice(0, 10)}`);
  }
  const deployment = path.join(siteDir, '_deployment.json');
  const meta = existsSync(deployment) ? JSON.parse(readFileSync(deployment, 'utf8')) : {};
  meta.muse = lock;
  writeFileSync(deployment, JSON.stringify(meta));
  rmSync(work, { recursive: true, force: true });
}

async function check() {
  const { sources } = loadSources();
  const lock = resolve(sources);
  let live = {};
  try {
    const res = await fetch(`https://alpacaplayhouse.com/_deployment.json?muse-check=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) live = (await res.json()).muse || {};
  } catch (error) {
    console.log(`Could not read live _deployment.json: ${error.message}`);
  }
  const changed = sources.some(({ repo }) => live[repo] !== lock[repo]);
  console.log(`Muse sources ${changed ? 'changed' : 'unchanged'}: ${JSON.stringify(lock)}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'resolve') process.stdout.write(JSON.stringify(resolve(loadSources().sources)));
  else if (cmd === 'compose') compose(a, JSON.parse(b));
  else if (cmd === 'check') await check();
  else { console.error('usage: compose-muse.mjs resolve | compose <siteDir> <lockJson> | check'); process.exit(64); }
}
