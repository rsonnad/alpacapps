# API Cost Accounting

> Reference file for Claude. Read on-demand when building features that call external APIs.

**Every feature that makes external API calls MUST log usage to the `api_usage_log` table for cost tracking.** This is non-negotiable.

## The `api_usage_log` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `vendor` | text NOT NULL | API provider (see vendor list below) |
| `category` | text NOT NULL | Granular feature category (see category list below) |
| `endpoint` | text | API endpoint or operation name |
| `input_tokens` | integer | Input/request tokens (for LLM APIs) |
| `output_tokens` | integer | Output/response tokens (for LLM APIs) |
| `units` | numeric | Non-token usage units (SMS segments, emails, minutes, etc.) |
| `unit_type` | text | What the units represent (e.g., "sms_segments", "emails", "call_minutes", "documents", "api_calls") |
| `estimated_cost_usd` | numeric | Calculated cost for this call |
| `metadata` | jsonb | Additional context (model name, prompt snippet, error info, etc.) |
| `app_user_id` | uuid FK->app_users | User who triggered the call (if applicable) |
| `created_at` | timestamptz | When the API call was made |

## Vendors

| Vendor | Services |
|--------|----------|
| `gemini` | Gemini API (image gen, PAI chat, payment matching) |
| `anthropic` | Claude API (identity verification, bug analysis) |
| `vapi` | Vapi voice calls |
| `telnyx` | SMS sending/receiving |
| `whatsapp` | WhatsApp Cloud API messaging |
| `resend` | Email sending |
| `signwell` | E-signature documents |
| `square` | Payment processing |
| `paypal` | Associate payouts |
| `openweathermap` | Weather API |
| `google_sdm` | Nest thermostat API |
| `tesla` | Tesla Fleet API |
| `lg_thinq` | LG ThinQ API |
| `govee` | Govee Cloud API |
| `supabase` | Supabase platform (storage, edge function invocations) |
| `cloudflare_r2` | Cloudflare R2 object storage |
| `alpacapps_api` | Internal REST API calls (self-tracking) |

## Categories (Granular)

| Category | Description |
|----------|-------------|
| `spaces_image_gen` | AI-generated space/marketing images |
| `pai_chat` | PAI conversational AI (text chat) |
| `pai_voice` | PAI voice assistant (Vapi calls) |
| `pai_smart_home` | PAI smart home commands (lights, music, climate) |
| `life_of_pai_backstory` | Life of PAI backstory generation |
| `life_of_pai_voice` | Life of PAI voice/personality generation |
| `identity_verification` | DL photo verification via Claude Vision |
| `lease_esignature` | Lease document e-signatures |
| `payment_matching` | AI-assisted payment matching |
| `bug_analysis` | Bug Scout automated bug analysis |
| `feature_building` | Feature Builder automated implementation |
| `sms_tenant_notification` | SMS notifications to tenants |
| `sms_bulk_announcement` | Bulk SMS announcements |
| `whatsapp_tenant_notification` | WhatsApp notifications to tenants |
| `whatsapp_bulk_announcement` | Bulk WhatsApp announcements |
| `email_tenant_notification` | Email notifications to tenants |
| `email_system_alert` | System alert emails (errors, digests) |
| `email_payment_receipt` | Payment receipt/confirmation emails |
| `weather_forecast` | Weather API calls |
| `nest_climate_control` | Thermostat reads and commands |
| `tesla_vehicle_poll` | Tesla vehicle data polling |
| `tesla_vehicle_command` | Tesla vehicle commands |
| `lg_laundry_poll` | LG washer/dryer status polling |
| `govee_lighting_control` | Govee light commands |
| `sonos_music_control` | Sonos playback commands |
| `square_payment_processing` | Square payment transactions |
| `paypal_associate_payout` | PayPal associate payouts |
| `airbnb_ical_sync` | Airbnb calendar sync |
| `r2_document_upload` | Document upload to Cloudflare R2 |
| `pai_email_classification` | PAI email classification via Gemini |
| `api_spaces_list` | Internal API: spaces list calls |
| `api_tasks_create` | Internal API: task creation calls |
| `api_{resource}_{action}` | Internal API: auto-generated per resource/action |

**When adding a new feature that uses an API, add a new category.** The centralized API auto-logs calls as `api_{resource}_{action}` categories under the `alpacapps_api` vendor.

## How to Log (Edge Functions)

```typescript
await supabaseAdmin.from('api_usage_log').insert({
  vendor: 'gemini',
  category: 'pai_chat',
  endpoint: 'generateContent',
  input_tokens: response.usageMetadata?.promptTokenCount,
  output_tokens: response.usageMetadata?.candidatesTokenCount,
  estimated_cost_usd: calculateGeminiCost(inputTokens, outputTokens),
  metadata: { model: 'gemini-2.0-flash', conversation_id: '...' },
  app_user_id: userId
});
```

## How to Log (DO Droplet Workers)

```javascript
await supabase.from('api_usage_log').insert({
  vendor: 'tesla',
  category: 'tesla_vehicle_poll',
  endpoint: 'vehicle_data',
  units: vehicleCount,
  unit_type: 'api_calls',
  estimated_cost_usd: 0,
  metadata: { vehicles_polled: vehicleNames }
});
```

## Pricing Reference

| Vendor | Pricing |
|--------|---------|
| Gemini 2.5 Flash | $0.15/1M in, $3.50/1M out (under 200k context) |
| Gemini 2.0 Flash | $0.10/1M in, $0.40/1M out |
| Claude (Anthropic) | Varies by model |
| Vapi | ~$0.05-0.15/min |
| Telnyx SMS | ~$0.004/segment out, ~$0.001/segment in |
| WhatsApp Cloud API | ~$0.015/utility conv, ~$0.025/marketing conv, $0/service (24h window) |
| Resend Email | Free tier: 100/day, then $0.00028/email |
| SignWell | Included (25 docs/month free) |
| Square | 2.6% + $0.10/transaction |
| PayPal Payouts | $0.25/payout (US) |

## Cost Aggregation

The accounting admin page (`spaces/admin/accounting.html`) shows:
- **By vendor**: Total spend per vendor per month
- **By category**: Total spend per category per month
- **Drill-down**: Click vendor -> see category breakdown
