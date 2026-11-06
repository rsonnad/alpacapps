# Stripe payout confirm

Marks `payouts` rows paid once Stripe shows the money reached the worker's bank.

`stripe-payout` saves each Connect transfer as `processing`. The webhook waited
for `transfer.paid`, but Stripe stopped sending that event in API 2017-04-06
(Connect transfers have no status), so rows stayed `processing` forever.

For each `processing` Stripe row with a `tr_` transfer
(`_shared/stripe-payout-confirm.ts`):

| Stripe shows | Row becomes |
|---|---|
| transfer not reversed, amount matches, the connected account's bank payout carrying it is `paid` | `completed` (ledger `completed`) |
| transfer fully reversed | `returned` (ledger `failed`) |
| bank payout pending / in transit, or none yet | stays `processing` |
| partial reversal, amount mismatch, bank payout failed, or no bank payout after 14 days | stays `processing`, reported as `review` |

Only automatic bank payouts can be traced to a transfer. No money moves.

Schedule: `supabase/migrations/20261106_stripe_payout_confirm_cron.sql`
(every 6 hours, service-role key from Vault via `payroll_cron_bearer()`).

```sh
deno test supabase/functions/_shared/stripe-payout-confirm_test.ts
SUPABASE_ACCESS_TOKEN=$(~/bin/bw-read 'Supabase — AlpacApps Project' 'Management API Token') \
  npx --yes supabase functions deploy stripe-payout-confirm \
  --remote=aphrrfprbixmhissnjfn --no-verify-jwt --use-api --yes
```

Check without writing: `POST /functions/v1/stripe-payout-confirm?dry=true` with
an admin or service-role token.
