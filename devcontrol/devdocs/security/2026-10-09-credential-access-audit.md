# Credential access audit — 2026-10-09

## Outcome

The live Supabase database now rejects anonymous and ordinary authenticated
accounts on nine raw device credential tables: `google_tts_config`, `lg_config`,
`anova_config`, `govee_config`, `nest_config`, `home_assistant_config`,
`weather_config`, `vapi_config`, and `tesla_accounts`. Staff/admin/oracle identity
is checked with `is_staff_or_admin_user()` for reads and writes. Service-role
workers retain access. Browser roles have no TRUNCATE privilege on these tables.

`get_kiosk_haos_config()` no longer permits anonymous execution and independently
checks staff identity for authenticated calls. Previously it returned the populated
Home Assistant token anonymously through SECURITY DEFINER, bypassing table RLS.
LG's populated PAT was also anonymously selectable. Anova, Govee, weather, Vapi,
Home Assistant and Tesla had populated credentials reachable by ordinary
signed-in users. Nest credentials and Google TTS API key were empty at audit time,
but their permissive access paths were closed before future credentials are added.

Printer `check_code` is a server-only bearer credential alongside `proxy_secret`.
Rental `access_tokens` can no longer be enumerated or changed by anonymous or
ordinary accounts. `validate_rental_access_token(text)` returns only a boolean
for an exact supplied token; rental listing links use this RPC.

## Existing protections verified

Stripe secret and webhook columns, PayPal secret columns, Telnyx API key,
Spotify tokens and client secret, printer proxy secret, and Glowforge session
cookies already had column-level restrictions. They remain restricted; no
migration broadens their access to staff. Stripe's publishable configuration
remains available to anonymous clients for the public payment page.

Square, OpenClaw, password vault, password history, WhatsApp and API-key inventory
have existing restrictive row policies. Resident access to their own door codes
through the scoped RPC was outside this API-credential change and remains intact.
The application API's Tesla account handler uses an explicit non-secret projection.

The Supabase anon key in `shared/supabase.js` is intentionally public. It is not
a server credential; its safety depends on grants, policies and RPC authorization.

## Verification

- Live metadata audit: 252 relations, 625 policies, 780 public-schema functions,
  table and column grants, seven views and storage bucket visibility.
- Anonymous REST probes request `limit=0`, so no secret values are retrieved.
  Stripe secret selection returns permission denied; publishable config stays allowed.
- `supabase/tests/device-credential-access.sql` runs in rollback transactions.
  It impersonates anonymous, existing ordinary and staff identities, and service role.
  All nine tables deny anonymous/non-staff reads, retain staff/server reads, and
  deny browser TRUNCATE. The HA RPC denies non-staff, permits staff/server calls,
  and printer/Stripe secret-column restrictions remain in force.
- Rental tests verify inventory denial, reject empty/null/unknown supplied tokens,
  and preserve the validity result for an existing bearer link.
- Current tracked files and remote main were scanned for Stripe secret prefixes,
  Supabase secret/service-role keys, Google API keys, GitHub tokens, private keys,
  and common AI key formats. No actual matches were found. A PEM-header regex
  in the Google signing implementation was a false positive, not a private key.
- Exact current configured credential values were compared inside Postgres against
  bug reports, error logs, context snapshots, property/config JSON, device recipes,
  email/SMS logs, API usage logs, network snapshots, prompts and site config.
  No matching records were found. Only counts are returned; no credential values
  are printed or saved in this report.
- Rental JavaScript syntax and Git whitespace checks pass.

## Remaining work and limits

1. **Rotate previously exposed credentials.** Closing access cannot retract copies.
   Home Assistant and LG require rotation because their live credentials had
   anonymous read paths. Review Anova, Govee, OpenWeatherMap, Vapi and Tesla token
   revocation/rotation because ordinary signed-in accounts previously had access.
   Vendor integrations must be updated from Bitwarden after rotation; do not
   copy runtime credentials back into the vault.
2. **Git history.** A historical version of
   `supabase/migrations/2026021211_paypal_sandbox_credentials.sql` in commit
   `df8c6fb218` contains an embedded sandbox secret, although the current file is
   cleaned. Confirm that historical credential was revoked. This audit did not
   rewrite published history or revoke vendor credentials.
3. **Staff visibility is deliberate.** These device credentials remain visible
   to authorized staff/admin/oracle browsers, consistent with the user's requested
   access boundary. Password input masking is not an access-control mechanism.
4. **Kiosk/weather behavior.** Unauthenticated kiosk Home Assistant chat and weather
   cannot fetch raw credentials. Non-staff weather clients and Tesla metadata
   queries against the raw credential table are also blocked. Restoring those
   features needs a narrow server proxy or non-secret projection, not broader
   credential-table grants.
5. **Storage and other services.** Public buckets include bug screenshots, documents
   and home-automation assets. Object contents, images, old backups, vendor
   dashboards, third-party hosting/log systems, workstation files and chat histories
   were not exhaustively scanned. The provided Stripe key exists in this chat's
   history. This is an access audit, not evidence that no historic copy exists.
6. **Other app security.** The metadata shows unrelated permissive business-data
   policies and public SECURITY DEFINER mutators such as prompt version creation.
   Those require a separate authorization audit; they were not changed as part of
   this credential lockdown.

## Rotation follow-up (2026-10-09)

- Verified the canonical Bitwarden Stripe `Secret Key` ends in `V9F8` and
  exactly matches the active production `stripe_config.id = 1` value.
- Found a stale `STRIPE_SECRET_KEY` in the Supabase function environment and
  replaced it from the verified vault value. The Management API's returned
  SHA-256 digest confirms the environment now matches the vault and database.
- Stripe has one enabled production webhook endpoint,
  `we_1SzXyZEZGgxeL4qABgaz2cWQ`, pointing to the project's `stripe-webhook`
  function. Its signing secret currently matches the vault and environment;
  rotation remains pending. Safari is prepared at that endpoint's Roll secret
  menu. Browser credential changes require human handoff under the computer-use
  policy; choose an overlap period before saving the replacement in Bitwarden.
- Home Assistant's configured token is duplicated in `HA_TOKEN` and
  `HOME_ASSISTANT_TOKEN`. Both environment values and `home_assistant_config`
  must change together. Its current database token does not match any populated
  Home Assistant vault item. Authenticated inspection identifies it as the
  `DevControl Backup Monitor` long-lived token. It also occurs in Alpuca's
  `~/.ha_llat` and `~/ha-cmd.sh`; maintenance jobs read those files. API and
  WebSocket authentication succeeded. Rotation has not occurred: Bitwarden
  locked before token creation, so the operation stopped without mutating HA.
  Unlock the vault, save a replacement first, update all consumers, verify the
  new token, and revoke only the old token's identified refresh-token record.
- PayPal live and sandbox credentials, Telnyx's API key, Spotify's client secret,
  and LG's PAT match their populated vault fields. This verification is not
  rotation. Spotify access/refresh tokens also require revocation and renewed
  authorization; rotating only its client secret is insufficient.

## Access recipe

Use `memory/service-access.md` in the primary workspace for the verified Supabase
Management API recipe. The exact Bitwarden field is
`bw-read "Supabase — AlpacApps Project" "Management API Token"`. Pass credentials
in process memory; send SQL with curl, and never print keys or complete vault items.
Run the checked-in access regression SQL through that endpoint as postgres.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[function privileges](https://supabase.com/docs/guides/database/functions),
[secret vs public keys](https://supabase.com/docs/guides/database/secure-data).

## Batch 2 — PII and anonymous writes (applied 2026-10-09)

Migration `202610090004_lock_down_pii_and_anon_writes.sql`; regression test
`supabase/tests/pii-and-anon-write-access.sql` (23 checks, all passing; run
without its final `ROLLBACK` line through the Management API to see results).

- `identity_verifications`: had anon SELECT and authenticated ALL. That exposed
  9 people's licence number, DOB, address and 1-year signed photo URLs. It is now
  staff-only, plus own-row read. All 11 objects in `identity-documents` were moved
  under `r20261009/` and the 8 referenced rows re-signed, so every earlier signed
  URL now returns 400.
- Staff-only: `payouts`, `payment_reminders`, `vehicle_rentals`, `event_payments`,
  `signature_audit_log`, `payout_time_entries`.
- Public read kept, writes staff-only: `assignments`, `lease_templates`,
  `event_agreement_templates`, `printer_devices`.
- Writes need a signed-in user: `todo_*`, `work_groups`, `work_group_members`,
  `associate_schedules`, `permit_tasks`, `schedule_edits`. Anon `govee_devices`
  update and `waiver_signatures` update removed.
- RLS enabled: `system_commands` (staff read; writers are service role) and
  `sonos_health_samples` (writer is the Management API).
- Storage `lease-documents`: public listing, upload, overwrite and delete removed
  and staff-only policies added. Exact-path public links still return 200.

## Batch 3 — public pages off direct table access (applied 2026-10-09)

Migrations `202610090005_public_flow_rpcs.sql` (RPCs), `202610090006_revoke_anon_pii.sql`
(revoke) and `202610090007_square_public_config.sql`. The revoke was applied only after
the updated pages were deployed and loaded signed-out in a browser.

- Anonymous users can no longer read or write `people`, `rental_applications`,
  `event_hosting_requests`, `event_request_spaces`, `waiver_signatures` and
  `rental_payments` (all return 401). Policies that applied to PUBLIC/anon now apply
  to `authenticated`, so signed-in access is unchanged.
- The public pages call SECURITY DEFINER RPCs scoped to the caller's own identifier:
  `apply_get_application`, `apply_submit_application` (inquiry→submitted only),
  `apply_record_fee` and `apply_add_previous_residence` (once each),
  `get_application_status(token)`, `hostevent_submit_request` (person find-or-create,
  request and spaces in one transaction), `hostevent_update_deposit`
  (pending/failed→paid/failed), `verify_resident` (current residents only),
  `sign_waiver`, `get_public_contact_phone`, `kiosk_current_occupants`,
  `kiosk_upcoming_events` and `get_square_public_config`.
- Verified in a browser while signed out: status, apply, book, kiosk, TV, waiver,
  contact and hostevent. The Square card form loads on apply and hostevent. All 23
  role checks still pass.
- **Square had been broken since about 2026-04-19.** `square_config` is admin-only,
  so public pages couldn't load the app/location ids and the card form never started.
  `get_square_public_config()` returns only those public ids and `test_mode`.
  A read-only Square API check confirmed the location is ACTIVE with card processing.
- The tommy-hall agreement page (event of 2026-03-31) no longer writes crew contacts
  to `people`.

### Still open

- Signed-in non-staff users (residents, associates) can still read all of `people`,
  `rental_applications` and `rental_payments`. `residents/bookkeeping.js` depends on
  this, so it needs own-row policies.
- Square payment records: `square_payments` was staff/service-only, so the public
  pages' anonymous writes were rejected. Apply stopped before charging. Hostevent
  **charged the card with no record**, and also passed the event request id as
  `paymentRecordId`. Migration `202610090008` adds `create_square_payment_record`
  (only for the caller's own submitted application or recent event request; the
  record must exist before charging) and `settle_square_payment_record`
  (pending → completed needs a Square payment id; settles once). Both pages now use
  them, and hostevent passes the real record id. The client still reports the
  charge outcome, but only for its own pending record. Moving settlement into
  `process-square-payment` would remove that trust.
- `previous_residences` and `square_payments` still have anon table grants. RLS has
  no anon policy, so access is denied in practice. Revoke the grants for clarity.
- `hostevent` passes the event request id as `paymentRecordId` (pre-existing).
- `lease-documents` is still a public bucket. Two filenames are guessable. Making it
  private needs `lease.html` and `rentals/signed` to use signed URLs.
- `verify-identity` still mints 1-year signed URLs; on-demand short-lived URLs would be better.
- `record_release_event()` is SECURITY DEFINER and anon-executable (low impact).
- The kiosk Home Assistant chat is blocked by the batch-1b HA RPC lockdown, as intended.
