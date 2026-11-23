# Issue Reporting Kit

In-app "Report a bug / Request a feature" for Android, iOS and macOS, plus the backend that receives
the reports. Extracted from Bridgit and slimmed down so you can copy it into any app. MIT licence.

Guide with the design, the flow and every file: https://alpacaplayhouse.com/rahulio/pages/issuereportingcode/

```
backend/   Cloudflare Worker + D1: worker.mjs, schema.sql, wrangler.jsonc, smoke-test.mjs
android/   IssueReporting.kt (store, identity, upload queue), ReportIssueActivity.kt (Compose form)
apple/     IssueReporting.swift (store, identity, upload), ReportIssueView.swift (SwiftUI form)
```

## 1. Backend (10 minutes)

```bash
cd backend
npm install
npx wrangler d1 create issues            # paste the database_id into wrangler.jsonc
npx wrangler d1 execute issues --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN       # a long random string, the team's key
npx wrangler deploy
```

Try it locally first:

```bash
npm run db:local
npx wrangler dev --var ADMIN_TOKEN:dev-admin-token
node smoke-test.mjs http://localhost:8787 dev-admin-token
```

Optional: `npx wrangler secret put NOTIFY_WEBHOOK_URL` (a Slack or Discord incoming webhook) to get a
message for each new report.

## 2. Android

Copy both files into your app (change `package com.example.issues`), set `IssueConfig.BASE_URL`, add the
dependencies listed at the top of each file and the activity to your manifest. Open it from any menu:

```kotlin
lifecycleScope.launch { ReportIssue.open(this@MainActivity, IssueKind.BUG, "Settings") }
```

Call `IssueUploadWorker.enqueue(context)` on app start to flush anything still waiting, and
`IssueApi.pullUpdates(context)` (off the main thread) when you show a "My reports" list.

## 3. iOS / macOS

Add both Swift files, set `IssueConfig.baseURL`, then:

```swift
@State private var report: ReportRequest?
Button("Report a bug") { report = ReportRequest(kind: .bug, screen: "Settings") }
  .sheet(item: $report) { ReportIssueView(request: $0) }
```

Call `await IssueStore.shared.sendPending()` on launch and when the app returns to the foreground.

## The API

| Route | Who | What |
|---|---|---|
| `POST /v1/issues` | app | file an issue (idempotent on install + `client_issue_id`) |
| `GET /v1/issues/updates?since=&since_id=` | app | status/notes the team changed |
| `GET /v1/admin/issues` | team | list, `?status=&limit=&before=` |
| `GET /v1/admin/issues/:id` | team | one issue with context and log |
| `GET /v1/admin/issues/:id/images/:n` | team | a screenshot |
| `PATCH /v1/admin/issues/:id` | team | `{status, team_note}` |

App calls send `X-Install-Id: <uuid>` and `Authorization: Bearer <install key>`; the server trusts the
first key it sees for an install id. Team calls send `Authorization: Bearer <ADMIN_TOKEN>`.

Tested: the backend passes `smoke-test.mjs` under `wrangler dev`; the Kotlin compiles (AGP 8.7, Kotlin 2.0,
compileSdk 35); the Swift type-checks for iOS 16 and macOS 13. Run them on your own devices before shipping.
