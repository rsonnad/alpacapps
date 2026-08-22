# AlpacApps Full-Project Code Review

Date: 2026-08-22

Status: Findings only — no implementation fixes made

Scope: 1,503 tracked files, excluding `/mistiq/`
Working tree note: `supabase/functions/resend-inbound-webhook/index.ts` was already modified before this review; `.agents/`, `.codex/`, and `AGENTS.md` were untracked and excluded from the external source bundle.

## Review method

- Two-pass review: discovery, then an adversarial attempt to disprove every candidate.
- Parallel Luna passes covered backend security, frontend/data exposure, integrations/payments/AI, operations/build/deployment, and cross-cutting boundaries.
- Deterministic checks included JavaScript syntax, shell syntax, package parsing, route mirror validation, plist linting, `git diff --check`, and lockfile/build configuration inspection.
- OpenRouter Ox Alpha was authorized and reached directly at `https://openrouter.ai/api/v1/chat/completions` using model `stealth/ox-alpha`. The live model catalog and a zero-cost probe returned HTTP 200. Initial oversized bundles were rejected with HTTP 404; a bounded chunk runner was started after reducing bundle size. The findings below are the evidence-backed Luna and static-review ledger; the reconciliation section records the supplemental Ox Alpha limitation.
- Findings are deduplicated. Repeated reports are combined, but distinct failure modes remain separate.

## Priority summary

| Priority | Count | Meaning |
|---|---:|---|
| CRITICAL | 12 | Direct financial mutation, secret exposure, or privilege/data boundary failure |
| SECURITY | 18 | Auth, integrity, privacy, injection, abuse, or transport weakness |
| BUG | 11 | Confirmed production failure or silent data/workflow corruption |
| ADDITIONAL INTEGRITY | 7 | Confirmed payment, queue, or cross-boundary integrity weakness |
| NIT / operational debt | 4 | Reproducibility or documentation issues that do not independently expose data |

## CRITICAL findings

### C-01 — Privileged payout and refund functions lack function-level authorization

Evidence: `supabase/functions/paypal-payout/index.ts:112-129,274-296`; `supabase/functions/stripe-payout/index.ts:78-95,250-256`; `supabase/functions/refund-square-payment/index.ts:30-41,82-95`.

Any caller who reaches these functions can select payout/refund targets and, in some paths, caller-controlled amounts or recipients. The functions use service-role/provider credentials and perform real external money movement. The normal client sends an ordinary user JWT, so gateway JWT validation is not a substitute for role authorization.

Suggested fix: require verified staff/admin/oracle authorization inside every function, derive payee and amount from approved server-side records, ignore recipient overrides, validate refund ownership and cumulative refund amount, and add stable provider idempotency keys.

Adversarial result: Confirmed — no shared authorization or ownership check exists on the money-moving paths.

### C-02 — Payment recording and manual resolution are unauthenticated service-role write surfaces

Evidence: `supabase/functions/record-payment/index.ts:23-45,69-125,267-307`; `supabase/functions/resolve-payment/index.ts:34-77,124-135,195-249`.

`record-payment` accepts caller-provided payment text/name and can create paid payment and ledger rows after matching. `resolve-payment` accepts arbitrary pending/person/assignment identifiers and can write payment, ledger, and sender-mapping rows. Neither resolves caller identity or role.

Suggested fix: restrict these functions to signed internal calls or verified finance-admin roles; validate that person, assignment, pending payment, and amount are consistent; make payment plus ledger resolution transactional and idempotent.

Adversarial result: Confirmed — all mutations use a service-role client without an application-level authorization boundary.

### C-03 — Event hosting tables have public read/write RLS policies

Evidence: `migrations/009_event_hosting_system.sql:215-238`; sensitive columns are defined at `:32-109,159-180`.

The `FOR ALL USING (true)` policies allow a direct Supabase client using the public project key to read, insert, update, or delete event requests, event payments, spaces, and templates. This bypasses the centralized API permission matrix and exposes contact data, admin notes, approval state, agreement URLs, and payment values.

Suggested fix: replace permissive policies with explicit public-submit policies, owner-scoped reads, and staff/admin-only updates/deletes. Recheck all later migrations for policy replacement before deploying.

Adversarial result: Confirmed by static policy trace; no later tracked migration narrows these policies.

### C-04 — Password-vault `get` bypasses resident scope

Evidence: `supabase/functions/api/index.ts:1533-1591`; intended scope is documented in `API.md:820-828`.

The list path applies category/space scope, but `get` fetches any vault row by UUID. A resident who obtains or guesses a vault UUID can retrieve credentials outside their assigned space.

Suggested fix: reuse the exact list scope predicate in `get`, require active rows, and keep secret-bearing reads behind a separate staff-authorized operation where possible.

Adversarial result: Confirmed — the handler uses the service role, so database RLS cannot compensate.

### C-05 — Assignment and event detail endpoints leak cross-user records

Evidence: assignment detail path `supabase/functions/api/index.ts:413-425`; event detail path `:1208-1216`; row-scope declarations `supabase/functions/_shared/api-permissions.ts:162-168`.

Assignment `get` omits the deny branch when no linked person exists. Event `get` does not apply the contact-email/person filter used by list. A resident can request another record by UUID, and an account without a person link may receive arbitrary assignment details.

Suggested fix: centralize row-scope predicates and require them for every `get`; explicitly deny when identity linkage is absent; require staff/admin for unrestricted detail reads.

Adversarial result: Confirmed by tracing separate list and get queries.

### C-06 — Associate time entries allow ownership and payroll-state forgery

Evidence: permission matrix `supabase/functions/_shared/api-permissions.ts:149-155`; create/update paths `supabase/functions/api/index.ts:1116-1167`.

Level-1 users can create entries with caller-supplied fields and update an owned row with unrestricted fields. The pre-update ownership check validates the old row, while the payload can change `associate_id`, rates, timestamps, `status`, `is_paid`, or payout fields.

Suggested fix: derive `associate_id` from the authenticated associate profile, whitelist editable fields, calculate payable values server-side, and make payment-state transitions staff-only/database-guarded.

Adversarial result: Confirmed — ownership is checked before a mass assignment that can change ownership.

### C-07 — Stripe payment amount and accounting attribution are client-controlled

Evidence: `pay/index.html:847-866`; `supabase/functions/process-stripe-payment/index.ts:88-114,146-164`; `supabase/functions/stripe-webhook/index.ts:679-735`.

The public page and endpoint accept amount, fee, payment type, references, person, and description. The webhook later books those stored values. A caller can submit a valid charge while changing ledger attribution or fee/amount metadata.

Suggested fix: derive expected amount, fee, person, assignment, and category from a signed invoice/reference; validate finite positive values, bounds, UUIDs, currency, and the amount/fee relationship; never trust caller-supplied ledger identity.

Adversarial result: Confirmed — request-to-ledger data flow has no server-side recomputation.

### C-08 — PayPal webhook signature verification is a stub

Evidence: `supabase/functions/paypal-webhook/index.ts:43-59,81-110,280-381`.

The verifier returns true without validating PayPal transmission headers, certificate, or signature, and the handler then mutates payouts and ledger rows. A forged capture or payout event can create false income or status changes.

Suggested fix: implement PayPal `verify-webhook-signature` using the raw body, all transmission headers, configured webhook ID, and provider API; fail closed when configuration is missing; persist unique event IDs.

Adversarial result: Confirmed — stored configuration is not cryptographically used.

### C-09 — Sensitive credentials are committed in migrations, documentation, and client binaries

Evidence: `supabase/migrations/2026021211_paypal_sandbox_credentials.sql:2-4`; `supabase/migrations/2026021212_paypal_alpacappspay_sandbox.sql:2-4`; `residents/profile.js:1320-1328`; `mobile-ios/AlpacaPlayhouse/Services/ApiConfig.swift:3-7`; `mobile-android/app/src/main/java/com/alpacaplayhouse/app/data/ApiConfig.kt:3-7`; `docs/plans/do-migration.md:73-78`; `HOMEAUTOMATION.md:294-303,327-331`; `staff/inventory.js:292-293`.

The reviewed agents found literal PayPal sandbox credentials, Tesla client secrets, HA bearer tokens, and infrastructure/password material in tracked files or shipped clients. Sandbox labels do not make secrets safe once committed; mobile/API binaries are distributable.

Suggested fix: rotate/revoke every exposed credential, remove it from history where practical, move runtime secrets to Bitwarden/Supabase secret storage, and ship only public identifiers/configuration to clients. Re-run secret scanning after rotation.

Adversarial result: Confirmed by literal-value inspection; this is not a public Supabase anon-key false positive.

### C-10 — Vapi tool calls trust unauthenticated caller identity

Evidence: `supabase/functions/alpaca-pai/index.ts:2605-2738,3228-3292,3561-3602,4050-4068`.

The Vapi tool-call path can accept a forged body claiming a privileged phone number, map it to a role, and execute service-role-backed tools such as notifications and payment-link creation. Caller ID alone is not an identity factor.

Suggested fix: verify Vapi request signatures/shared secrets, bind tool calls to known call/assistant IDs, reject unknown call state, and require step-up confirmation for payments, messaging, and physical device actions.

Adversarial result: Confirmed — no independent authenticity check protects the tool-call path.

### C-11 — Client-supplied signed-document HTML and hash are trusted

Evidence: `supabase/functions/process-signature/index.ts:35-40,262-290,303-322,343-362`.

The signing endpoint accepts both `document_html` and `document_hash`, then stores/archives those values without recomputing the hash from a canonical server-side document. A token holder can submit altered HTML with a matching arbitrary hash.

Suggested fix: render the canonical agreement server-side, hash the exact rendered bytes, compare against the signing record, and archive only the canonical content; make the audit row immutable.

Adversarial result: Confirmed — token validation protects access to the action, not document integrity.

### C-12 — Native clients use incompatible identity/table models

Evidence: canonical auth lookup `supabase/functions/_shared/api-helpers.ts:153-164`; iOS `mobile-ios/AlpacaPlayhouse/Services/AuthService.swift:112-118`; Android `mobile-android/app/src/main/java/com/alpacaplayhouse/app/data/AuthManager.kt:129-140` and `UserCapabilities.kt:60-78`; stale work tables `mobile-ios/.../WorkService.swift:3-38,91-108` and `mobile-android/.../WorkApi.kt:112-144`; schema `devcontrol/devdocs/SCHEMA.md:264-279,438-450`.

Native code mixes `auth.users.id`, `app_users.id`, `people.id`, and associate profile IDs, and calls `hours_entries`/integer-ID models while the canonical API uses UUID `time_entries`. Roles, assignments, and work screens can resolve empty, wrong, or undecodable data.

Suggested fix: route mobile through one central API/identity-resolution layer, model all IDs as UUID strings, and port native clients to canonical table/resource names.

Adversarial result: Confirmed by cross-boundary comparison and the explicit schema distinction.

## SECURITY findings

### S-01 — Webhook verification fails open when provider secrets are missing

Evidence: Square `supabase/functions/square-webhook/index.ts:244-269`; Telnyx `supabase/functions/telnyx-webhook/index.ts:87-116`; WhatsApp `supabase/functions/whatsapp-webhook/index.ts:110-135`; Resend/Svix `supabase/functions/resend-inbound-webhook/index.ts:4784-4810,4823-4839,4932-4988`.

Missing configuration or missing signature headers can turn public webhook endpoints into unsigned mutation endpoints. The handlers then store messages, change payment state, or trigger email/payment logic.

Suggested fix: fail closed in production when verification configuration or required headers are missing; enforce timestamp/replay windows; persist provider event IDs; return non-2xx on verification/configuration failure so providers retry.

Adversarial result: Confirmed for the missing-secret branches; provider-side gateway behavior was not assumed.

### S-02 — Stripe webhook is replayable and can acknowledge accounting failure

Evidence: `supabase/functions/stripe-webhook/index.ts:98-154,503-543,641-744,830-845`; `supabase/migrations/20260210_stripe_connect.sql:33-55`.

There is no durable unique Stripe event claim. Duplicate valid deliveries can duplicate ledger rows and emails. Missing metadata or ledger errors can be converted to a null/continued path while the webhook returns HTTP 200, preventing retry.

Suggested fix: persist `event.id` under a unique constraint, atomically claim/process events, require required metadata or use nullable reference fields, and return retryable errors until accounting is durable.

Adversarial result: Confirmed by duplicate-delivery and error-path traces.

### S-03 — Refund and payout operations are not idempotent

Evidence: Square refund `supabase/functions/refund-square-payment/index.ts:40-83,116-177`; PayPal payout `supabase/functions/paypal-payout/index.ts:199-200,274-276`; Stripe payout `supabase/functions/stripe-payout/index.ts:51-73`; PayPal refund handling `supabase/functions/paypal-webhook/index.ts:413-451`; deposit confirmation `supabase/functions/confirm-deposit-payment/index.ts:73-105,120-206`.

Retries after provider timeouts use fresh keys or no key and can issue duplicate refunds/transfers. Deposit confirmation checks status before writes without atomically claiming the confirmation, so double-click/concurrent requests can duplicate records.

Suggested fix: persist a provider event/refund/payout intent, use stable idempotency keys, lock/claim before side effects, enforce unique transaction/provider IDs, and reconcile external success with local accounting.

Adversarial result: Confirmed by separate-check-then-write and `Date.now()`/missing-key paths.

### S-04 — Outbound SMS, WhatsApp, and event-staff mail have no effective authorization

Evidence: `supabase/functions/send-sms/index.ts:71-91,123-176`; `supabase/functions/send-whatsapp/index.ts:253-276,353-365`; `supabase/functions/event-staff-notify/index.ts:32-55,75-143`.

Public callers can trigger paid messages, choose arbitrary recipients or template data, and in the event notification path influence HTML. This enables spam, spoofed property notices, and cost abuse.

Suggested fix: require authenticated internal/staff authorization, derive recipients from trusted IDs, restrict templates and fields, escape HTML, enforce per-user/IP quotas, length limits, and idempotency.

Adversarial result: Confirmed — no downstream authorization compensates.

### S-05 — Gemini weather is an unauthenticated paid proxy

Evidence: `supabase/functions/gemini-weather/index.ts:4-33`.

The endpoint forwards caller-controlled `contents` and `generationConfig` using the server Gemini key. Direct HTTP callers can consume quota or use the endpoint as an arbitrary prompt proxy.

Suggested fix: authenticate, use a fixed server-generated prompt, validate location fields, bound output tokens, rate-limit, and fail closed on quota/configuration errors.

Adversarial result: Confirmed — CORS allowlisting does not block direct HTTP calls.

### S-06 — Rate limiting is raceable and fails open

Evidence: `migrations/20260517_code_review_fixes.sql:395-411`; `supabase/functions/_shared/function-wrapper.ts:104-122`.

The limiter counts and inserts without an atomic lock; concurrent requests can all pass. RPC errors are treated as allowed, and client IP extraction trusts spoofable `x-forwarded-for`.

Suggested fix: enforce atomically with a transaction/advisory lock/RPC, fail closed for abuse-sensitive operations, and only trust proxy headers from a known proxy.

Adversarial result: Confirmed by SQL execution order.

### S-07 — Stripe Connect onboarding lacks role/ownership authorization

Evidence: `supabase/functions/stripe-connect-onboard/index.ts:52-80,116-124`.

The function verifies authentication but accepts an arbitrary associate target. Any authenticated user can trigger onboarding/account creation for another associate.

Suggested fix: require staff/admin, or enforce that the requested associate profile belongs to the caller; derive the target from the authenticated identity where self-service is intended.

Adversarial result: Confirmed — JWT authentication is not authorization.

### S-08 — Vapi webhook accepts unsigned state updates

Evidence: `supabase/functions/vapi-webhook/index.ts:47-60,65-204`.

Forged callbacks can overwrite call status, caller mapping, transcript, recording URL, duration, and cost fields.

Suggested fix: validate Vapi signature/shared secret, reject unknown call IDs and invalid status transitions, and persist event IDs.

Adversarial result: Confirmed in tracked code; no external gateway protection was assumed.

### S-09 — Tesla refresh tokens are selected into browser JavaScript

Evidence: `shared/services/cars-data.js:31-41`.

The client-facing service selects and returns `refresh_token` from `tesla_accounts`. Any browser compromise, extension, or XSS on an admin/resident origin can extract a long-lived vehicle credential.

Suggested fix: never select tokens client-side; move vehicle account operations to an authenticated edge function and return only non-sensitive status.

Adversarial result: Confirmed — the exported loader returns the sensitive field.

### S-10 — Camera control APIs lack independent auth and device scope

Evidence: `shared/services/camera-data.js:63-86,99-136`; intended scope helper `shared/services/resident-device-scope.js:14-38`.

The client sends arbitrary camera IDs for PTZ/settings/snapshot operations directly to the camera proxy without a Supabase token or scope check. Actual exploitability depends on proxy enforcement, which is outside this repository.

Suggested fix: route all camera operations through an authenticated edge function, enforce scope server-side, and allowlist camera IDs/commands.

Adversarial result: Confirmed as a missing client/server boundary; proxy acceptance is conditional and must be verified separately.

### S-11 — Admin SMS viewer has stored XSS

Evidence: `admin/settings.js:978-1005,1092-1100`.

Inbound message bodies, sender data, and phone data are inserted into `innerHTML` without escaping. A crafted SMS can execute when an administrator opens the list/thread.

Suggested fix: use text nodes/textContent, escape every untrusted value, and avoid interpolating untrusted data into attributes or inline handlers.

Adversarial result: Confirmed with an `<img onerror=...>` message path.

### S-12 — Signature document viewer injects stored HTML/URLs

Evidence: `admin/signatures.js:139-153`.

Stored `document_html` is appended into admin DOM and signature URLs are placed in image attributes without strict validation. Contaminated signed content can execute in the admin origin.

Suggested fix: strict HTML allowlist or sandboxed iframe with no same-origin privileges; allow only expected image protocols/hosts.

Adversarial result: Confirmed for stored markup/URL paths.

### S-13 — User and invitation fields reach executable HTML/inline JavaScript

Evidence: `admin/users.js:229-239,992-1010,1080-1092`.

Names, emails, roles, and invitation values are rendered without escaping and are interpolated into inline `onclick` handlers. Crafted values can inject markup or break into JavaScript.

Suggested fix: use DOM nodes/textContent, data attributes for IDs, and delegated event listeners; remove inline handlers.

Adversarial result: Confirmed for HTML and quote-breaking payloads.

### S-14 — Private DOM remains visible after sign-out/session expiry

Evidence: `shared/auth.js:216-224`; shell guards `shared/admin-shell.js:592-619`, `shared/resident-shell.js:651-663`, `shared/associate-shell.js:407-419`.

When content has already rendered, the shells only redirect when `pageContentShown` is false. A sign-out or auth change can leave bookkeeping, payroll, SMS, credentials, or profile data in the DOM and controls active.

Suggested fix: handle explicit `SIGNED_OUT`/unauthenticated transitions regardless of prior render state; clear private DOM, stop polling, disable controls, and redirect.

Adversarial result: Confirmed by control flow.

### S-15 — Image worker has an SSRF/resource-abuse path

Evidence: `image-gen/worker.js:50-57,233-256`; job insert policy `supabase/migrations/2026021202_image_gen_jobs_delete_policy.sql:25-40`.

An authenticated user can create a job with arbitrary `metadata.source_image_url`; the worker fetches it without scheme/host allowlist, timeout, size, or content validation.

Suggested fix: accept only approved storage URLs or storage object IDs, block private/link-local destinations, enforce timeouts/size/content-type limits, and validate redirects.

Adversarial result: Confirmed by direct user-input-to-fetch flow.

### S-16 — One-time W-9/identity tokens are not atomically consumed

Evidence: `supabase/functions/w9-submit/index.ts:74-87,166-210`; `supabase/functions/verify-identity/index.ts:73-93,362-394`.

Concurrent requests can both pass `is_used=false`, create sensitive submissions, and only then mark the token used.

Suggested fix: atomically claim with `UPDATE ... WHERE is_used=false RETURNING`, or enforce one submission per token in a transaction/unique constraint.

Adversarial result: Confirmed by separate check/write/consume operations.

### S-17 — Camera worker disables TLS certificate verification

Evidence: `camera-event-poller/worker.js:65-89,105-110`.

`rejectUnauthorized: false` permits a local-network MITM against authenticated UDM traffic.

Suggested fix: trust the correct UDM CA/certificate or pin it; never disable verification for credentialed device APIs.

Adversarial result: Confirmed; exploit requires network positioning.

### S-18 — Discord/PAI has no effective per-user cost/rate boundary

Evidence: `pai-discord/bot.js:69-94,130-180`; `supabase/functions/alpaca-pai/index.ts:3787-3794,3822-3843,3912-3944`.

The six-round cap limits one request but not repeated requests. A user/channel can trigger repeated Gemini, search, and tool calls.

Suggested fix: add per-user/channel/IP rate limits, concurrency and request-size limits, daily quotas, queue admission controls, and hard spend cutoffs.

Adversarial result: Confirmed; no per-actor quota was found.

## BUG findings

### B-01 — PAI Vapi handlers reference undefined `req`

Evidence: `supabase/functions/alpaca-pai/index.ts:3365-3394,3496-3527,3561-3610`.

Several handlers call `jsonResponse(req, ...)` without receiving `req`. Vapi assistant/tool paths can fail while side effects may already have occurred.

Suggested fix: pass `req` through every handler or use a request-independent response helper; add direct handler tests.

Adversarial result: Confirmed by direct identifier inspection.

### B-02 — Several admin gates use nonexistent/stale `supabase_auth_id`

Evidence: `supabase/functions/create-payment-link/index.ts:47-59`; `edit-email-template/index.ts:67-79`; `generate-whispers/index.ts:244-256`; `reprocess-pai-email/index.ts:55-71`; canonical field `auth_user_id` at `_shared/api-helpers.ts:160-164`.

Legitimate authenticated admin/staff requests can fail role resolution because these functions query a column not defined by the canonical schema.

Suggested fix: use the shared auth helper everywhere and standardize on `auth_user_id`; add a repository-wide stale-column check.

Adversarial result: Confirmed; no tracked migration defines the queried column.

### B-03 — Worker queue jobs are selected and updated non-atomically

Evidence: feature builder `feature-builder/feature_builder.js:651-655,897-917`; image gen `image-gen/worker.js:223-230,406-427`; project inquiry `project-inquiry/worker.js:406-414,453-474`; bug fixer `bug-fixer/bug_scout.js:506-510,639-662`.

Two worker instances can select the same pending row before either update, causing duplicate AI calls, emails, commits, or state transitions.

Suggested fix: use atomic `UPDATE ... WHERE status='pending' RETURNING`, a locking RPC with `SKIP LOCKED`, lease expiry, and a unique job execution record.

Adversarial result: Confirmed by the separate select/update sequences.

### B-04 — Mobile build silently falls back after deleting output

Evidence: `mobile/scripts/copy-web.js:15-37,151-155,192-205`.

The script removes/replaces output, then only warns when required mobile source is missing and continues. A successful-looking build can contain the wrong legacy web root.

Suggested fix: fail fast when mobile source, package, or Capacitor inputs are missing; validate the output manifest before sync.

Adversarial result: Confirmed from script control flow.

### B-05 — Bug Scout installer references wrong/nonexistent worker paths

Evidence: `bug-fixer/install.sh:62,75,79,107`; checked-in unit `bug-fixer/bug-fixer.service:11`; tracked worker is `bug_scout.js`.

The installer copies from an obsolete local path and creates an `ExecStart` for `worker.js`, so fresh installation can lack the executable/package and fail to start.

Suggested fix: copy `bug_scout.js` and `package.json` from the installer’s own directory and install the checked-in service unit.

Adversarial result: Confirmed by comparing installer, unit, and tracked files.

### B-06 — Feature Builder and Instruction Runner clone into root-owned directories

Evidence: `feature-builder/install.sh:13,30,41`; `instruction-runner/install.sh:13,30,41`.

The parent is created as root, then `sudo -u bugfixer git clone` attempts to create the repo before ownership is corrected. Clean installs fail unless permissions were pre-fixed manually.

Suggested fix: create/chown the parent before cloning, or clone as root and chown before configuring/running as `bugfixer`.

Adversarial result: Confirmed for clean installs; preexisting corrected directories can mask it.

### B-07 — Live subtitles production installer enables mock mode

Evidence: `live-subtitles/install.sh:18,28`; mock behavior `live-subtitles/server.js:8,25`.

The production service emits canned text instead of processing live audio.

Suggested fix: use `ExecStart=/usr/bin/node server.js` in production and keep `--mock` only in development.

Adversarial result: Confirmed by runtime flag definition.

### B-08 — Broken migrated staff/admin routes and links

Evidence: `rentals/admin/index.html:13`; `devices/cars.html:45`; `admin/settings.html:273`; `staff/sms-messages.html:58`; `staff/rentals.html:335`; canonical route definitions `shared/routes.js:64`.

Several links target missing files or stale `/rentals/admin/` routes, causing 404s in staff/admin navigation.

Suggested fix: update links to canonical routes or add deliberate redirect stubs; run route existence checks on every HTML href.

Adversarial result: Confirmed by target existence checks.

### B-09 — Permitting tracker uses broken relative document links

Evidence: `staff/permittingplan.html:425,487,689,706,796,869`.

Links resolve under `/staff/` while targets live under `/jackie/pages/permittingplan/`, so permit/cost pages fail from the tracker.

Suggested fix: use canonical `/jackie/pages/permittingplan/...` URLs or add compatible redirects.

Adversarial result: Confirmed by filesystem checks.

### B-10 — Leaflet default image assets are missing

Evidence: `vendor/leaflet-1.9.4.css:359,364,407`; usage `devices/cars.html:16` and `devices/cars.js:621`; no `vendor/images/` directory.

Map tiles may render, but default markers and layer-control icons can be broken.

Suggested fix: ship the expected Leaflet image assets or configure explicit icon URLs to tracked assets.

Adversarial result: Confirmed by asset existence check.

### B-11 — iOS `@Observable` import is likely missing

Evidence: `mobile-ios/AlpacaPlayhouse/Services/AuthService.swift:1-4`; target iOS 17 in `mobile-ios/AlpacaPlayhouse.xcodeproj/project.pbxproj:278`.

The file uses `@Observable` without importing `Observation` or `SwiftUI`, unlike sibling files. A clean build may fail.

Suggested fix: import `Observation` explicitly and add a source-only CI compile check on the supported build host.

Adversarial result: Conditional/medium-high confidence; full Xcode compilation was unavailable on this host.

## Additional confirmed integrity/behavior findings

### A-01 — Square refund can succeed externally while local accounting fails

Evidence: `supabase/functions/refund-square-payment/index.ts:116-177`.

The function can return success after Square accepts a refund even when local payment/ledger updates fail, leaving money movement unreconciled.

Suggested fix: persist external refund ID in a durable pending state, reconcile asynchronously, and report only a recoverable status.

Adversarial result: Confirmed.

### A-02 — PayPal sandbox capture can mark local payment complete without binding provider capture

Evidence: `supabase/functions/paypal-checkout/index.ts:333-373`; sandbox migrations `2026021211...:2-6` and `2026021212...:2-6`.

The test-mode capture path accepts local order/payment state without verifying the provider order/capture relationship and writes test ledger entries.

Suggested fix: bind stored order IDs to provider capture IDs, isolate test accounting, and require staff authorization for mock capture.

Adversarial result: Confirmed for the repository-enabled test path.

### A-03 — Payment success UI is not provider-backed and allows arbitrary redirect

Evidence: `pay/index.html:975-995`.

`success=true` alone displays payment success, and a caller-controlled `redirect` can create an open redirect after the fake receipt screen.

Suggested fix: verify success server-side against a provider-backed payment record and allow redirects only from a fixed internal allowlist.

Adversarial result: Confirmed by direct query-parameter flow.

### A-04 — Payment-link creation ignores test mode and lacks amount bounds

Evidence: `supabase/functions/create-payment-link/index.ts:61-86,126-133`.

The function reads test-mode configuration but always uses the live secret path; amount validation only checks truthiness/rounding. Test-mode admin work can create live links, and arbitrary values are accepted.

Suggested fix: select credentials/API mode from `test_mode`, validate finite positive bounded amounts and metadata references, and add creation idempotency.

Adversarial result: Confirmed by control-flow inspection.

### A-05 — Archived space media can still be returned

Evidence: `shared/media-service.js:1526-1538`; active filtering exists elsewhere at `:1584-1588`.

`getForSpace()` does not filter nested `media.is_archived`, so removed/private media that remains linked can appear.

Suggested fix: filter active media in the relation or select/archive-filter client-side before returning.

Adversarial result: Confirmed.

### A-06 — Vehicle driver management mixes `app_users.id` and `people.id`

Evidence: `residents/profile.js:26,51-55,1285-1287,1402-1410,1461-1465`.

Vehicle driver rows use `people.id`, but the UI queries/inserts `app_users.id`; driver lists and updates can be empty, invalid, or target the wrong identity.

Suggested fix: resolve the linked `people.id` and use it consistently; add a shared identity helper and regression test.

Adversarial result: Confirmed against the project’s identity routing rules.

### A-07 — Admin navigation references missing SMS page

Evidence: `admin/settings.html:273`; expected existing page `staff/sms-messages.html`.

The “View All Messages” link targets a missing admin file.

Suggested fix: point to the canonical staff route or add a deliberate admin alias.

Adversarial result: Confirmed.

## Operational/reproducibility findings

### O-01 — Version-bump workflow can lose updates on rapid pushes

Evidence: `.github/workflows/bump-version-on-push.yml:19,25,57`.

Concurrency serializes jobs, but each job checks out an event SHA and pushes without rebasing/retrying. A later queued job can receive a non-fast-forward rejection and miss version/release metadata.

Suggested fix: after acquiring the concurrency lock, update from `origin/main`, apply the bump to the latest commit, and retry push with bounded backoff.

Adversarial result: Confirmed; no retry/rebase path was found.

### O-02 — Deployable worker packages have no lockfiles and installers use `npm install`

Evidence: `blink-poller/package.json`; `bug-fixer/package.json`; `camera-event-poller/package.json`; `feature-builder/package.json`; `image-gen/package.json`; `lg-poller/package.json`; `pai-discord/package.json`; `tesla-poller/package.json` and their installers.

Redeploys can resolve different dependency versions and introduce untested breakage.

Suggested fix: commit a lockfile per deployable package and use `npm ci`.

Adversarial result: Confirmed reproducibility risk; not an observed immediate outage.

### O-03 — `mobile/scripts/copy-web.js` copies `/mistiq/`

Evidence: `mobile/scripts/copy-web.js:33`.

This violates the project directive to exclude `/mistiq/` from AlpacApps work and can copy unrelated content into mobile output.

Suggested fix: remove the source path and add a guard that fails if the copy manifest includes `/mistiq/`.

Adversarial result: Confirmed by script path list.

### O-04 — Review/developer docs point at stale paths and absent mobile layout

Evidence: `AGENTS.md:5-10` points at `spaces/admin/devcontrol/devdocs/...`, while tracked docs are under `devcontrol/devdocs/`; `devcontrol/devdocs/KEY-FILES.md:49-58` and `PATTERNS.md:53` describe absent `mobile/app` files.

Agents following the docs can load the wrong guidance or fail to find the native/mobile source tree.

Suggested fix: update canonical paths and add an automated documentation-path check.

Adversarial result: Confirmed as documentation/operations debt; not itself a runtime security issue.

## Rejected or conditional hypotheses

- The public Supabase anon key is intentional and was not treated as a secret leak.
- Wildcard CORS on the centralized API was not retained by itself; authorization is the relevant control, although handler-level authorization findings above remain.
- The camera proxy’s actual acceptance of unauthenticated requests was not assumed; the missing client-side auth/scope boundary is confirmed, proxy exploitation remains conditional.
- The iOS `@Observable` issue is conditional because Xcode was unavailable for a full native build.
- Legacy Blink plist paths were treated as stale deployment drift, not a confirmed active outage.
- Formatting, missing types, generic test-coverage requests, and architectural rewrites were excluded unless tied to a concrete failure.

## Cleared checks

- JavaScript syntax: 167 tracked JavaScript files passed `node --check`.
- Shell syntax: tracked shell scripts outside `/mistiq/` passed `bash -n`.
- Package JSON parsing passed.
- `npm ci --dry-run --ignore-scripts` passed for root, `scripts`, and `dev/testing` lockfile-backed packages.
- `node scripts/sync-routes.js --check` passed.
- Plist linting passed.
- Required generated files (`version.json`, Tailwind output, route mirror, Rahulio manifest) are present.
- No `photo_spaces` references were retained in the reviewed scope; media code uses `media_spaces`.
- Most archive-sensitive queries correctly filter archived rows; `getForSpace()` is the retained omission.
- PAI/chat renderers and several associate/resident renderers correctly escape user/AI text.
- Shared polling visibility/circuit-breaker behavior is present.

## Fix order recommendation

1. Freeze or protect money-moving/webhook/payment endpoints: C-01, C-02, C-07, C-08, S-01–S-03, A-01–A-04.
2. Rotate/remove committed and client-shipped secrets: C-09.
3. Close cross-user data and device boundaries: C-04–C-06, C-10–C-12, S-07, S-09–S-10.
4. Remove stored-XSS and session-lifecycle exposure: S-11–S-14.
5. Fix queue claims and production installers/build paths: B-03–B-07, O-01–O-03.
6. Repair route/assets/identity defects: B-02, B-08–B-11, A-05–A-07, O-04.

## External-model reconciliation

OpenRouter Ox Alpha request status:

- Catalog lookup: `stealth/ox-alpha` present, provider `Stealth`, prompt/completion price `0`.
- Minimal probe: HTTP 200, `cost=0`.
- Oversized 1.7–2.6 MB lane submissions: HTTP 404 before a usable response.
- Bounded chunk runner: started with sanitized chunks and wrote only temporary responses under `/private/tmp/oxalpha-fullreview/`. The first 50,839-token backend chunk returned HTTP 200 at zero cost, but Ox Alpha exhausted its 12,000-token completion limit in the reasoning channel without a normal final answer. Its candidate observations were not promoted automatically; they require independent evidence and adversarial validation, which is why the ledger remains grounded in the local checks and Luna passes. The next chunk did not complete within the bounded wait and was stopped. This is a supplemental model pass, not evidence that unreviewed chunks are clean.
