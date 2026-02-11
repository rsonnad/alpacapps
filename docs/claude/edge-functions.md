# Supabase Edge Functions

> Reference file for Claude. Read on-demand when working with edge functions.

## Function List (`/supabase/functions/`)

| Function | Purpose |
|----------|---------|
| `signwell-webhook` | Receives SignWell webhook when documents are signed |
| `send-sms` | Outbound SMS via Telnyx API |
| `telnyx-webhook` | Receives inbound SMS from Telnyx |
| `send-whatsapp` | Outbound WhatsApp messages via Meta Cloud API |
| `whatsapp-webhook` | Receives inbound WhatsApp messages + delivery status from Meta |
| `send-email` | Outbound email via Resend API (45+ templates) |
| `resend-inbound-webhook` | Receives inbound email via Resend webhook, routes/forwards, auto-records Zelle payments |
| `govee-control` | Proxies requests to Govee Cloud API (resident+ auth) |
| `alpaca-pai` | PAI chat + voice assistant: Gemini-powered natural language smart home control + property Q&A + Vapi voice calling (resident+ auth) |
| `sonos-control` | Proxies requests to Sonos HTTP API via Alpaca Mac (resident+ auth) |
| `nest-control` | Proxies requests to Google SDM API with OAuth token management (resident+ auth) |
| `nest-token-refresh` | Standalone Nest OAuth token refresher (cron) |
| `tesla-command` | Sends commands to Tesla vehicles via Fleet API (lock, unlock, wake, flash, honk) (resident+ auth) |
| `create-tesla-account` | Creates tesla_accounts row with server-held Fleet API credentials (resident+ auth); use default JWT |
| `lg-control` | LG ThinQ laundry control (status, start/stop, watch/unwatch notifications, push token registration) (resident+ auth) |
| `verify-identity` | Driver's license photo -> Claude Vision API -> auto-verify applicants/associates |
| `paypal-payout` | Sends PayPal payouts to associates |
| `paypal-webhook` | Receives PayPal payout status updates |
| `vapi-server` | Returns dynamic assistant config to Vapi on incoming calls |
| `vapi-webhook` | Receives Vapi call lifecycle events (end, transcript) |
| `airbnb-sync` | Fetches Airbnb iCal feeds -> creates blocking assignments |
| `ical` | Generates iCal feeds per space for external calendar sync |
| `regenerate-ical` | Regenerates iCal feeds when assignments change |
| `process-square-payment` | Server-side Square payment processing |
| `refund-square-payment` | Square payment refunds |
| `record-payment` | AI-assisted payment matching (Gemini) |
| `resolve-payment` | Manual payment resolution for pending matches |
| `confirm-deposit-payment` | Deposit payment confirmation workflow |
| `error-report` | Error logging and daily digest emails |
| `contact-form` | Public contact form submission handler |
| `event-payment-reminder` | Daily cron: 10-day payment reminders for events |
| `ask-question` | PAI Q&A backend |

## Deployment Flags

Functions that handle auth internally MUST be deployed with `--no-verify-jwt` to prevent Supabase's gateway from rejecting valid user tokens before they reach the function code.

### `--no-verify-jwt` required:
```
sonos-control, govee-control, nest-control, resend-inbound-webhook,
telnyx-webhook, whatsapp-webhook, signwell-webhook, tesla-command, lg-control,
alpaca-pai, verify-identity, vapi-server, vapi-webhook, paypal-webhook
```

### Default JWT verification (all others):
```
supabase functions deploy <name>
```

### Deploy examples:
```bash
supabase functions deploy sonos-control --no-verify-jwt
supabase functions deploy send-email   # default JWT
```
