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

## Access recipe

Use `memory/service-access.md` in the primary workspace for the verified Supabase
Management API recipe. The exact Bitwarden field is
`bw-read "Supabase — AlpacApps Project" "Management API Token"`. Pass credentials
in process memory; send SQL with curl, and never print keys or complete vault items.
Run the checked-in access regression SQL through that endpoint as postgres.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[function privileges](https://supabase.com/docs/guides/database/functions),
[secret vs public keys](https://supabase.com/docs/guides/database/secure-data).
