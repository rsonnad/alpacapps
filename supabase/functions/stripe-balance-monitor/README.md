# Stripe balance monitor

Restored from the live function, then extended with recipient reporting. Uses the
existing `stripe_balance_snapshots`, `stripe_config`, `associate_profiles`,
`app_users` and `payouts` tables. No migration is required for the current project.

Each daily email includes every debit since the last delivered notification,
all currently pending platform/connected-account bank payouts, queued Stripe
payouts and a separate list of app records awaiting delivery confirmation.
These last records were already transferred and may already have been paid;
they are not additional unpaid obligations. Incoming settlement balances are
not pending outgoing payments. Activity with no net balance change still sends
an update. HTML and plain text contain the same recipient/payment rows.

`?preview=true` requires an admin/oracle or service-role token, returns HTML,
text and report JSON, sends no email and writes no snapshot. Regular invocation
preserves the existing cron and gateway configuration. Only the existing admin
email destination receives the report; payment recipient names do not become
email addressees.

Checks:

```sh
deno check supabase/functions/stripe-balance-monitor/index.ts
deno test supabase/functions/stripe-balance-monitor/outgoing_test.ts
```

Deploy with Supabase CLI 3 (the project recipe's older CLI used `--project-ref`):

```sh
SUPABASE_ACCESS_TOKEN=$(~/bin/bw-read 'Supabase — AlpacApps Project' 'Management API Token') \
  npx --yes supabase functions deploy stripe-balance-monitor \
  --remote=aphrrfprbixmhissnjfn --no-verify-jwt --use-api --yes
```

Read-only live preview was verified after deployment. All recipient names resolved;
the screenshot's $71.94 debit resolved to the corresponding named associate.
