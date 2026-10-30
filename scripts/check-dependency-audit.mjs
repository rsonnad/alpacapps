import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Include installed paths/versions and advisory severity: an exception cannot mask
// a new advisory, a different release, or a high finding escalating to critical.
export function findings(report, lock) {
  if (report.error || report.auditReportVersion !== 2 || !report.metadata?.vulnerabilities || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') throw new Error('Invalid or failed npm audit response');
  const result = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!Array.isArray(entry.via) || !Array.isArray(entry.nodes)) throw new Error(`Invalid audit entry: ${name}`);
    for (const advisory of entry.via.filter(v => typeof v === 'object' && ['high', 'critical'].includes(v.severity))) {
      if (!/^https:\/\/github.com\/advisories\/GHSA-[\w-]+$/.test(advisory.url)) throw new Error(`Invalid advisory: ${name}`);
      for (const path of entry.nodes) {
        const version = lock.packages?.[path]?.version;
        if (!version) throw new Error(`Audit path absent from lockfile: ${path}`);
        result.push(`${advisory.severity} ${name} ${path}@${version} ${advisory.url}`);
      }
    }
  }
  // npm also reports propagated metavulnerabilities; each must ultimately reach
  // a concrete advisory. A malformed high report must never silently pass.
  if ((report.metadata.vulnerabilities.high || report.metadata.vulnerabilities.critical) && !result.length) throw new Error('High/critical count without concrete advisories');
  if (report.metadata.vulnerabilities.critical && !result.some(f => f.startsWith('critical '))) throw new Error('Critical count without concrete critical advisories');
  return [...new Set(result)].sort();
}
export function regressions(current, baseline, now = new Date()) {
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.accepted) || !baseline.reason || !baseline.expires || !Number.isFinite(Date.parse(baseline.expires))) throw new Error('Invalid audit baseline');
  if (now >= new Date(baseline.expires)) throw new Error('Audit baseline expired; remediate or review remaining debt');
  if (baseline.accepted.some(f => !f.startsWith('high '))) throw new Error('Critical findings cannot be baselined');
  return current.filter(f => !baseline.accepted.includes(f));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('npm', ['audit', '--package-lock-only', '--ignore-scripts', '--json', '--registry=https://registry.npmjs.org'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('npm audit failed; dependency check fails closed');
  const report = JSON.parse(result.stdout);
  writeFileSync(resolve(root, 'dependency-audit.json'), JSON.stringify(report, null, 2) + '\n');
  const current = findings(report, JSON.parse(readFileSync(resolve(root, 'package-lock.json'))));
  const added = regressions(current, JSON.parse(readFileSync(resolve(root, 'scripts/dependency-audit-baseline.json'))));
  console.log(JSON.stringify({ vulnerabilities: report.metadata.vulnerabilities, knownHighAdvisoryInstances: current.length - added.length, regressions: added }, null, 2));
  if (added.length) process.exitCode = 1;
}
