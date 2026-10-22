import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkLock(manifest, lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('Expected npm lockfile v3');
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (JSON.stringify(Object.entries(manifest[group] || {}).sort()) !== JSON.stringify(Object.entries(lock.packages[''][group] || {}).sort())) {
      throw new Error(`Manifest/lockfile mismatch: ${group}`);
    }
  }
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!pkg.version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity || '')) throw new Error(`Missing SHA-512 integrity: ${path}`);
    const url = new URL(pkg.resolved);
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash) throw new Error(`Unapproved package source: ${path}`);
  }
}

export function checkWorkflow(text, name) {
  const lines = text.split('\n').filter(line => !line.trim().startsWith('#'));
  for (const line of lines) {
    const action = line.match(/^\s*-?\s*uses:\s*(\S+)/)?.[1];
    if (action && !/@[a-f0-9]{40}$/.test(action)) throw new Error(`Unpinned action: ${name}: ${action}`);
    for (const command of line.split(/&&|\|\||[;|]/)) {
      if (/\bnpm\s+(?:ci|install|i|update|rebuild)\b/.test(command) && !/\bnpm ci --ignore-scripts(?:\s|$)/.test(command.trim())) throw new Error(`Unsafe npm install: ${name}`);
    }
    if (/\bnpm ci\b/.test(line) && /--no-ignore-scripts\b|--ignore-scripts(?:=|\s+)false\b|--foreground-scripts\b/.test(line)) throw new Error(`Lifecycle scripts enabled: ${name}`);
    if (/pull_request_target\s*:/.test(line)) throw new Error(`Privileged PR trigger: ${name}`);
  }
}

// This deliberately checks the repository's fixed release layout. Keep the
// checks fail-closed when changing its jobs rather than guessing YAML defaults.
export function checkReleaseWorkflow(text) {
  const jobs = Object.fromEntries([...text.matchAll(/^  ([a-z][\w-]*):\n([\s\S]*?)(?=^  [a-z][\w-]*:\n|$(?![\s\S]))/gm)].map(m => [m[1], m[2]]));
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  for (const name of ['build', 'release', 'deploy']) require(jobs[name], `Missing isolated ${name} job`);
  require(text.match(/^permissions:\n((?:  [^\n]*\n)*)/m)?.[1].trim() === 'contents: read', 'Default token must be read-only');
  require(!text.replace(jobs.release, '').includes('secrets.'), 'Application secrets may only be referenced inside release');
  require(!/secrets\.|\b(?:contents|pages|id-token): write/.test(jobs.build), 'Build must not receive secrets or write privileges');
  require(/persist-credentials: false/.test(jobs.build), 'Build checkout must not retain the token');
  require(/node scripts\/check-dependency-audit.mjs/.test(jobs.build), 'Release build must audit before installation');
  require(jobs.build.indexOf('node scripts/check-dependency-audit.mjs') < jobs.build.indexOf('npm ci --ignore-scripts'), 'Audit must precede dependency installation');
  for (const name of ['release', 'deploy']) require(!/\b(?:npm|npx)\s/.test(jobs[name]), `${name} must not execute installed dependency code`);
  require(!/secrets\.|contents: write/.test(jobs.deploy), 'Pages deploy must not receive database secrets or repository write');
  require(/persist-credentials: false/.test(jobs.deploy), 'Deploy checkout must not retain the token');
  require(!/pages: write|id-token: write/.test(jobs.release), 'Release must not hold Pages deployment privileges');
  require(jobs.release.includes('ref: ${{ needs.build.outputs.source_sha }}'), 'Release must use the exact built source');
  require(jobs.deploy.includes('ref: ${{ needs.release.outputs.release_sha }}'), 'Verifier must use the exact released source');
  require(jobs.release.includes('path: ${{ runner.temp }}/generated-site-assets'), 'Artifact must download outside the checkout');
  require(jobs.release.includes('for file in styles/tailwind.out.css rahulio/pages/pages-manifest.json rahulio/pages/index.html; do'), 'Only allowlisted assets may cross into release');
  require(jobs.release.includes('test "$(git rev-parse origin/main)" = "$SOURCE_SHA"') && !/git pull|git rebase/.test(jobs.release), 'Never release assets rebased onto unbuilt source');
}

export function checkNpmConfig(text) {
  const settings = text.split('\n').map(line => line.trim()).filter(line => line && !/^[#;]/.test(line));
  if (settings.length !== 1 || !/^ignore-scripts\s*=\s*true$/.test(settings[0])) throw new Error('Root .npmrc must unambiguously default to ignore-scripts=true');
}

export function checkRepository(root) {
  checkLock(JSON.parse(readFileSync(resolve(root, 'package.json'))), JSON.parse(readFileSync(resolve(root, 'package-lock.json'))));
  for (const name of readdirSync(resolve(root, '.github/workflows')).filter(n => /\.ya?ml$/.test(n))) {
    checkWorkflow(readFileSync(resolve(root, '.github/workflows', name), 'utf8'), name);
  }
  checkReleaseWorkflow(readFileSync(resolve(root, '.github/workflows/bump-version-on-push.yml'), 'utf8'));
  checkNpmConfig(readFileSync(resolve(root, '.npmrc'), 'utf8'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRepository(fileURLToPath(new URL('../', import.meta.url)));
  console.log('Supply-chain policy passed');
}
