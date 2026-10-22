import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkLock, checkWorkflow, checkReleaseWorkflow } from './check-supply-chain.mjs';
import { findings, regressions } from './check-dependency-audit.mjs';

const pkg = { dependencies: { demo: '^1' } };
const lock = () => ({ lockfileVersion: 3, packages: { '': structuredClone(pkg), 'node_modules/demo': { version: '1.0.0', resolved: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz', integrity: 'sha512-YWJjZA==' } } });
const advisory = { severity: 'high', url: 'https://github.com/advisories/GHSA-abcd-1234-efgh' };
const report = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { high: 1, critical: 0 } }, vulnerabilities: { demo: { via: [advisory], nodes: ['node_modules/demo'] } } });
const baseline = () => ({ schemaVersion: 1, reason: 'reviewed debt', expires: '2026-11-21T00:00:00Z', accepted: findings(report(), lock()) });
const now = new Date('2026-10-22T00:00:00Z');

test('lock guard requires matching manifest, registry HTTPS, SHA512 and v3', () => {
  checkLock(pkg, lock());
  for (const mutate of [l => l.lockfileVersion = 2, l => l.packages[''].dependencies.demo = '*', l => delete l.packages['node_modules/demo'].integrity, l => l.packages['node_modules/demo'].resolved = 'https://evil.test/demo.tgz', l => l.packages['node_modules/demo'].resolved = 'https://registry.npmjs.org@evil.test/demo.tgz']) {
    const changed = lock(); mutate(changed); assert.throws(() => checkLock(pkg, changed));
  }
});
test('every workflow npm install command must disable lifecycle scripts', () => {
  checkWorkflow('run: npm ci --ignore-scripts', 'safe');
  for (const command of ['npm ci', 'npm install', 'npm ci --ignore-scripts=false', 'npm ci --ignore-scripts --no-ignore-scripts', 'npm ci --ignore-scripts --ignore-scripts false', 'npm ci --ignore-scripts && npm install', 'npm ci --ignore-scripts; npm ci', 'npm ci --ignore-scripts\n npm rebuild']) assert.throws(() => checkWorkflow(`run: ${command}`, 'unsafe'), command);
  assert.throws(() => checkWorkflow('uses: actions/checkout@v6', 'unsafe'));
  assert.throws(() => checkWorkflow('pull_request_target:', 'unsafe'));
});
test('audit permits only exact existing high advisory/version instances', () => {
  assert.deepEqual(regressions(findings(report(), lock()), baseline(), now), []);
  for (const mutate of [r => r.vulnerabilities.demo.via = [{ ...advisory, url: 'https://github.com/advisories/GHSA-new1-1234-efgh' }], r => r.vulnerabilities.demo.via = [{ ...advisory, severity: 'critical' }]]) {
    const changed = report(); mutate(changed); assert.equal(regressions(findings(changed, lock()), baseline(), now).length, 1);
  }
  const changed = lock(); changed.packages['node_modules/demo'].version = '1.0.1';
  assert.equal(regressions(findings(report(), changed), baseline(), now).length, 1);
  assert.throws(() => regressions([], baseline(), new Date('2026-11-22')));
  assert.throws(() => regressions([], { ...baseline(), accepted: ['critical demo'] }, now));
});
test('audit errors, missing metadata and unresolved paths fail closed', () => {
  for (const value of [{}, { error: { code: 'ENET' } }, { ...report(), auditReportVersion: 1 }]) assert.throws(() => findings(value, lock()));
  const critical = report(); critical.metadata.vulnerabilities.critical = 1; assert.throws(() => findings(critical, lock()));
  const changed = report(); changed.vulnerabilities.demo.nodes = ['node_modules/missing'];
  assert.throws(() => findings(changed, lock()));
});

test('release isolation rejects privilege and dependency execution regressions', () => {
  const workflow = readFileSync(new URL('../.github/workflows/bump-version-on-push.yml', import.meta.url), 'utf8');
  checkReleaseWorkflow(workflow);
  for (const [from, to] of [
    ['  build:\n', '  build:\n    env:\n      TOKEN: ${{ secrets.GITHUB_TOKEN }}\n'],
    ['  build:\n', '  build:\n    permissions:\n      contents: write\n'],
    ['  release:\n', '  release:\n    run: npm run css:build\n'],
    ['  deploy:\n', '  deploy:\n    env:\n      DB: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\n'],
    ['ref: ${{ needs.build.outputs.source_sha }}', 'ref: main'],
    ['ref: ${{ needs.release.outputs.release_sha }}', 'ref: main'],
    ['path: ${{ runner.temp }}/generated-site-assets', 'path: .'],
    ['for file in styles/tailwind.out.css rahulio/pages/pages-manifest.json rahulio/pages/index.html; do', 'for file in scripts/bump-version.sh; do'],
  ]) {
    assert.ok(workflow.includes(from), from);
    assert.throws(() => checkReleaseWorkflow(workflow.replace(from, to)), to);
  }
});

test('security checks run on PRs, pushes and a schedule with a full audit artifact', () => {
  const workflow = readFileSync(new URL('../.github/workflows/supply-chain.yml', import.meta.url), 'utf8');
  for (const trigger of ['pull_request:', 'push:', 'schedule:']) assert.ok(workflow.includes(trigger));
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: dependency-audit.json/);
});
