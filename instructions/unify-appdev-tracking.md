Unify all DO server Claude session activity into the appdev.html request list.

Currently the appdev page only shows feature requests from the `feature_requests` table (submitted via the appdev UI). But there are three sources of Claude work on the DO server that should ALL appear in the appdev request list:

1. **Feature Builder** (`feature-builder/feature_builder.js`) — polls `feature_requests` table, already shows in appdev
2. **Bug Fixer** (`bug_scout.js`) — polls `bug_reports` table, does NOT show in appdev
3. **Android Claude Instructions** — processes `instructions/*.md` files from git branches pushed by mobile Claude sessions, does NOT show in appdev

All three should create/update entries in `feature_requests` so they appear in the appdev.html timeline with status, progress, and results.

For Bug Fixer:
- When bug_scout picks up a bug report, insert a `feature_requests` row with `source: 'bug_fixer'` and link to the bug_report_id
- Update status as it progresses (building → review → completed/failed)
- Include commit_sha, branch, changed_files when done

For Android Claude Instructions:
- When the instruction processor picks up an `instructions/*.md` file, insert a `feature_requests` row with `source: 'android_instruction'`
- Use the instruction filename as the title and file contents as the description
- Update status as it progresses
- Include commit_sha, branch, changed_files, and the result from `instructions/results/`

The `feature_requests` table may need a `source` column if it doesn't have one already (values: 'appdev', 'bug_fixer', 'android_instruction', 'pai').

The appdev.html UI should show a source badge/tag on each request so you can tell where it came from.

Also: merge branch `claude/monastery-donation-payments-r5onx` into main as part of this work. That branch has `rahulio/pages/donate.html` which needs to go live.
