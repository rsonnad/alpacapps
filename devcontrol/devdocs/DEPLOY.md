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
| `rsonnad/muse-rahulio` | Rahul's Muse | warsawapt, bookinghostredflags, bw-test, tesla-bmw-austin, austin-car-rental, lisbon-marvila, warsawtable, bridget-html-test, bridgit-story, kerdoiv-visszajelzes |
| `rsonnad/muse-sonia` | Sonia's Muse | soniabikes |

- A Muse pushes `muse/<project>/` to `main` of its own repo. It has no write access to `rsonnad/alpacapps`.
- `.github/workflows/muse-sync.yml` compares those repos with the live site and starts a publish run when one moved. A run of the main workflow (push or manual) also picks up the latest Muse commits. See "Muse sync trigger" below for what starts `muse-sync.yml`.
- `scripts/compose-muse.mjs` pins each Muse repo's commit, copies only regular files under `muse/<project>/`, and never publishes a project that `muse-sources.json` gives to another repo. An unlisted project is published only if exactly one repo has it. Nothing from a Muse repo is executed.
- `_deployment.json` records the alpacapps commit and each Muse repo's commit. The final verification step compares every Muse HTML file with those bytes.
- To move or claim a project, edit `muse-sources.json` on main. To add a Muse, create its repo, add a writable deploy key from that Muse (public key only), protect its `main` (block force-push and deletion) and add it to `muse-sources.json`.

Grokbot pages work the same way, in two folders: `https://alpacaplayhouse.com/bots/<project>/` (`bots-sources.json`) and `https://alpacaplayhouse.com/botsy/<project>/` (`botsy-sources.json`).

### Muse sync trigger

`muse-sync.yml` has a `*/10` cron, but GitHub drops most scheduled runs: in Oct–Nov 2026 it ran only 4–6 times a day, so Muse pushes waited hours. The real trigger is a 5-minute systemd timer on Phoenix (`alpacapps-workers`, 144.24.51.48):

- Files: `scripts/muse-sync-watch/` (script, `alpacapps-muse-sync.service`, `alpacapps-muse-sync.timer`, `install.sh`). Installed script: `/usr/local/bin/alpacapps-muse-sync-watch`.
- Each tick reads `muse-sources.json`, `bots-sources.json` and `botsy-sources.json` from main, runs `git ls-remote` on every listed repo, and compares with `https://alpacaplayhouse.com/_deployment.json`. Only when something moved does it start `muse-sync.yml` (once per set of commits per 15 minutes). All reads are public.
- The only secret is `ALPACAPPS_DISPATCH_TOKEN` in `/etc/alpacapps-muse-sync.env` (root:ubuntu 0640): a fine-grained token from `rsonnad`, repository `rsonnad/alpacapps` only, permission **Actions: Read and write**. It cannot push code. Copy in Bitwarden DevOps: "GitHub — alpacapps Muse sync dispatch token". Muse repos get no token. Don't `gh auth login` with it on Phoenix: the host's `gh` login (`sponicgarden`) is used by other timers.
- Without the env file the script logs "No ALPACAPPS_DISPATCH_TOKEN" and exits 0, so the cron fallback still works.
- Install or update: copy the folder to Phoenix and run `sudo ./install.sh`. Check: `systemctl list-timers alpacapps-muse-sync.timer` and `journalctl -u alpacapps-muse-sync.service -n 20`. A started run shows in `gh run list --workflow muse-sync.yml` as `workflow_dispatch` by `rsonnad`.
- Manual kick from any signed-in machine: `gh workflow run muse-sync.yml --repo rsonnad/alpacapps --ref main`.

| Repo | Agent | Folders |
|---|---|---|
| `rsonnad/grokbot-pages` | Grokbot | `bots/<project>/`, `botsy/<project>/` |

- Grokbot pushes to `main` of `rsonnad/grokbot-pages` with its own deploy key (write on that repo only; private key in 1Password vault GrokBotsy, owner record in Bitwarden "Grokbot — AlpacApps /bots/ + /botsy/ Publishing Guide"). `main` blocks force-push and deletion.
- The same sync check, `compose-muse.mjs` rules, `_deployment.json` keys (`bots`, `botsy`) and final verification apply.
- A folder committed to this repo under `bots/`, `botsy/` or `muse/` stays as committed and no agent repo can replace it. `bots/feedback/` (the bot feedback form and its admin page, see `API.md` → "Bot feedback") is kept this way.

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
