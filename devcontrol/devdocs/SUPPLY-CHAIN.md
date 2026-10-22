# Supply-chain controls

Updated 2026-10-22.

## Release boundaries

`.github/workflows/bump-version-on-push.yml` uses three GitHub-hosted runners:

1. `build`: contents read, checkout credentials discarded, no application secrets.
   Enforce policy and audit before `npm ci --ignore-scripts`, then build CSS and
   regenerate the pages listing. Upload only `styles/tailwind.out.css`,
   `rahulio/pages/pages-manifest.json`, and `rahulio/pages/index.html`.
2. `release`: exact built source, contents write, no Pages permissions, no npm
   installation or execution. Download assets outside the checkout and copy only
   those three paths. Supply the database secret only to the version script.
   Commit the version and assets, reject a concurrent main change, and upload the
   committed site. Do not rebase generated files onto unbuilt source.
3. `deploy`: contents read plus Pages/id-token write, no application secrets and
   no repository write. Deploy the Pages artifact and verify public bytes against
   the exact release commit. Manual retries publish committed files without a
   version bump. Repository release concurrency remains serialized.

Every external action is pinned to a full upstream commit SHA. Pins were resolved
from the existing major tags with `git ls-remote` on 2026-10-22, preserving action
major versions. Dependabot proposes weekly action and npm updates; npm major
updates require a separate deliberate change. Alerts and automated security-fix
PRs were enabled and verified through GitHub on 2026-10-22.

## Dependency review

Run `npm run security:check` and `npm run security:audit`. The read-only
`Supply-chain security` workflow runs on PRs, main pushes, Mondays and manual
dispatches. It preserves the complete audit JSON as an Actions artifact even if
the audit fails. The main release build also runs the audit before npm installs.

The lockfile guard requires npm lockfile v3, matching manifest dependency specs,
HTTPS registry.npmjs.org sources and SHA-512 integrity. Review lockfile changes
for new packages, changed sources, scripts and unusual transitive churn; these
mechanical checks do not establish that a package's code is trustworthy.

`.npmrc` defaults to `ignore-scripts=true` for local installs as well. Explicit
`npm run` commands still run. Puppeteer's automatic browser download is disabled;
if browser tooling needs a browser, install the reviewed locked tool's browser
explicitly in a separate job without release credentials. Do not enable all
package lifecycle scripts to restore a browser download.

## Existing advisory debt

The initial full lockfile audit reports **9 high and 1 moderate package findings**,
with no critical findings. High findings involve Puppeteer, puppeteer-core,
@puppeteer/browsers, basic-ftp, extract-zip, ip-address, js-yaml, source-map-js
and ws. The recommended Puppeteer remediation includes a major version change;
this CI-hardening change does not silently upgrade browser tooling.

`scripts/dependency-audit-baseline.json` temporarily records the **10 exact high
advisory instances**, including advisory URL, severity, installed package path and
version. A different affected version or new high advisory fails the gate.
Critical advisories cannot be exempted. The exception expires
**2026-11-21 00:00 UTC** and then fails closed. Remediate the affected packages and
remove their entries; extending the exception requires an explicit documented
review. Full reports continue to include this debt while the exception exists.
Registry errors and malformed responses also fail closed. Moderate/low findings
remain visible in the report but do not block a release.

This checks the root npm dependency graph and release workflows. Deno/CDN imports,
other toolchains and hosted-service security are separate coverage. No compromise
is inferred from the existence of an advisory. No secret rotation was performed
without evidence of exposure.
