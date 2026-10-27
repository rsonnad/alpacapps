# Deployment Workflow

## GitHub Pages (Static Site)

Publishes `main` through `.github/workflows/bump-version-on-push.yml` with GitHub Pages Actions (repository Pages `build_type: workflow`). The workflow builds CSS on a read-only runner, records the version and uploads committed files on a fresh release runner, then deploys and checks public content on a third runner. No installed dependency code runs in either privileged job. Releases run serially. A push is not considered public until the verification step passes.

Manual retry without a commit or version bump:
```bash
gh workflow run bump-version-on-push.yml --repo rsonnad/alpacapps --ref main
```

Muse pages are published at `https://alpacaplayhouse.com/muse/<project>/` but are **not** stored in this repo. Each Muse has its own repo, and only those repos hold Muse's write keys:

| Repo | Muse | Projects (see `muse-sources.json`) |
|---|---|---|
| `rsonnad/muse-rahulio` | Rahul's Muse | warsawapt, bookinghostredflags, bw-test |
| `rsonnad/muse-sonia` | Sonia's Muse | soniabikes |

- A Muse pushes `muse/<project>/` to `main` of its own repo. It has no write access to `rsonnad/alpacapps`.
- `.github/workflows/muse-sync.yml` checks those repos every 10 minutes and starts a publish run when one moved. A run of the main workflow (push or manual) also picks up the latest Muse commits.
- `scripts/compose-muse.mjs` pins each Muse repo's commit, copies only regular files under `muse/<project>/`, and never publishes a project that `muse-sources.json` gives to another repo. An unlisted project is published only if exactly one repo has it. Nothing from a Muse repo is executed.
- `_deployment.json` records the alpacapps commit and each Muse repo's commit. The final verification step compares every Muse HTML file with those bytes.
- To move or claim a project, edit `muse-sources.json` on main. To add a Muse, create its repo, add a writable deploy key from that Muse (public key only), protect its `main` (block force-push and deletion) and add it to `muse-sources.json`.
- Supabase secrets used by the release job are in the `release` environment, which only `main` can use, so workflows on other branches cannot read them.

### Push Workflow
```bash
git add -A && git commit -m "message"
./scripts/push-main.sh   # pull --rebase, then push
```

### Post-Push Verification
1. Wait ~60s for CI to run
2. `git pull --rebase origin main`
3. Read `version.json` — report version

### Version Format
`vYYMMDD.NN H:MMa` — date + daily counter + Austin time.
CI bumps automatically via GitHub Action on every push. **Never bump locally.**

### Post-Push Output Format
- **Main branch:** "Deployed to main — ..." with test URLs
- **Feature branch:** "Pushed to branch `name` (not yet deployed)" with changed files list

## Live URLs

| Environment | URL |
|---|---|
| Custom domain | https://alpacaplayhouse.com/ |
| GitHub Pages | https://rsonnad.github.io/alpacapps/ |
| Resident portal | https://alpacaplayhouse.com/residents/ |
| Admin | https://alpacaplayhouse.com/spaces/admin/manage.html |
| Public spaces | https://alpacaplayhouse.com/spaces/ |
| Payments | https://alpacaplayhouse.com/pay/ |
| Repository | https://github.com/rsonnad/alpacapps |

## Tailwind CSS

After adding new Tailwind classes, run: `npm run css:build`

## Supply-chain checks

Read [SUPPLY-CHAIN.md](SUPPLY-CHAIN.md) before changing release jobs or dependencies.
`npm run security:check` checks SHA pins, lockfile integrity and privilege isolation;
`npm run security:audit` queries the registry without installing dependencies.
The build runs both before installing dependencies. A newer main commit arriving
during the build makes that run fail rather than rebase generated assets onto
unbuilt source; the newer push has its own serialized release.
