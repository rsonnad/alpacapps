# Database Schema (Supabase)

> Reference file for Claude. Read on-demand when working with database tables.

## Core Tables
```
spaces          - Rental units (name, rates, beds, baths, visibility flags)
people          - Tenants/guests (name, contact, type)
assignments     - Bookings (person_id, dates, rate, status)
assignment_spaces - Junction: which spaces are in which assignments
```

### Key Columns on `spaces`
- `type` - Free-form text field (e.g., "Dwelling", "Amenity", "Event")
- `is_listed` - Show in consumer view
- `is_secret` - Only accessible via direct URL with ?id=
- `can_be_dwelling` - Filter for rental listings
- `can_be_event` - Can be used for events
- `is_micro` - Too small to show in projects/dropdowns/consumer view (e.g., individual beds)
- `is_archived` - Soft delete (filtered out everywhere)
- `access_code` - Keypad/door code for each space
- `airbnb_ical_url` - Inbound iCal feed URL from Airbnb
- `airbnb_link` - Public Airbnb listing URL
- `airbnb_rate` - Airbnb listing price
- `airbnb_blocked_dates` - JSONB array of blocked date ranges

### Key Columns on `assignments`
- `status` - active, pending_contract, contract_sent, completed, cancelled
- `start_date`, `end_date` - Assignment period
- `desired_departure_date` - Early exit date (tenant wants to leave early)
- `desired_departure_listed` - Boolean, when true the early exit date is shown to consumers for availability

## Media System (use this, not legacy photos)
```
media           - All media files (url, dimensions, caption, category)
media_spaces    - Junction: media <-> spaces (with display_order, is_primary)
media_tags      - Tag definitions (name, color)
media_tag_assignments - Junction: media <-> tags
```

## SMS & WhatsApp System
```
telnyx_config        - Telnyx API configuration (single row, id=1)
                      (api_key, messaging_profile_id, phone_number, is_active, test_mode)
whatsapp_config      - WhatsApp Cloud API configuration (single row, id=1)
                      (access_token, phone_number_id, waba_id, verify_token,
                       app_secret, phone_number, is_active, test_mode)
sms_messages         - Log of all SMS and WhatsApp messages sent/received
                      (person_id, direction, from/to_number, body, sms_type, telnyx_id,
                       status, channel [sms/whatsapp])
```

## Inbound Email System
```
inbound_emails       - Log of all inbound emails received via Resend
                      (resend_email_id, from_address, to_address, cc, subject,
                       body_html, body_text, attachments, route_action,
                       forwarded_to, forwarded_at, special_logic_type,
                       processed_at, raw_payload)
```

## Lease Agreement System
```
lease_templates      - Markdown templates with {{placeholders}}
                      (name, content, version, is_active)
signwell_config      - SignWell API configuration (single row)
                      (api_key, webhook_secret, test_mode)
```

Key columns added to `rental_applications`:
- `generated_pdf_url` - URL to generated lease PDF in Supabase storage
- `signwell_document_id` - SignWell document tracking ID
- `signed_pdf_url` - URL to signed lease PDF after e-signature

## Govee Lighting System
```
govee_config         - Govee Cloud API configuration (single row, id=1)
                      (api_key, api_base, is_active, test_mode, last_synced_at)
govee_devices        - All Govee/AiDot smart lights (63 devices)
                      (device_id, sku, name, area, device_type, is_group,
                       capabilities, online, last_state, is_active, notes,
                       parent_group_id, display_order, space_id)
govee_models         - SKU -> friendly model name lookup (16 rows)
                      (sku [PK], model_name, category)
```

## Nest Thermostat System
```
nest_config          - Google SDM API OAuth credentials (single row, id=1)
                      (google_client_id, google_client_secret, sdm_project_id,
                       refresh_token, access_token, token_expires_at,
                       is_active, test_mode)
nest_devices         - Cached thermostat info (3 devices: Master, Kitchen, Skyloft)
                      (sdm_device_id, room_name, device_type, display_order,
                       is_active, last_state [jsonb], lan_ip)
thermostat_rules     - Future rules engine (schema only, not yet implemented)
                      (name, device_id [FK->nest_devices], rule_type,
                       conditions [jsonb], actions [jsonb], is_active, priority)
```

## Weather System
```
weather_config       - OpenWeatherMap API configuration (single row, id=1)
                      (owm_api_key, latitude, longitude, location_name, is_active)
```

## Tesla & Vehicle System
```
tesla_accounts  - Tesla account credentials + Fleet API config
                  (owner_name, tesla_email, refresh_token, access_token,
                   token_expires_at, is_active, last_error,
                   last_token_refresh_at, fleet_client_id, fleet_client_secret,
                   fleet_api_base, created_at, updated_at)
vehicles        - All vehicles (renamed from tesla_vehicles)
                  (account_id [FK->tesla_accounts], vehicle_api_id, vin,
                   name, make, model, year, color, color_hex, svg_key, image_url,
                   owner_name, display_order, is_active,
                   vehicle_state [online/asleep/offline/unknown],
                   last_state [jsonb], last_synced_at, created_at, updated_at)
vehicle_drivers - Junction: vehicles <-> people (who can drive which vehicle)
                  (vehicle_id [FK->vehicles], person_id [FK->people])
```

## Camera Streaming System
```
camera_streams  - go2rtc HLS stream configuration (9 rows: 3 cameras x 3 qualities)
                  (camera_name, quality [low/med/high], stream_name,
                   proxy_base_url, location, protect_share_url, is_active)
```

## LG Laundry System
```
lg_config           - LG ThinQ API configuration (single row, id=1)
                      (pat, api_base, country_code, client_id, is_active, test_mode, last_error)
lg_appliances       - LG washer/dryer devices with cached state
                      (lg_device_id, device_type [washer/dryer], name, model, lan_ip,
                       display_order, is_active, last_state [jsonb], last_synced_at)
push_tokens         - FCM push notification tokens per user (shared, not LG-specific)
                      (app_user_id [FK->app_users], token, platform [ios/android],
                       device_info, is_active)
laundry_watchers    - Who is watching which appliance for cycle-end notification
                      (app_user_id [FK->app_users], appliance_id [FK->lg_appliances])
```

## Cloudflare R2 & Document Storage
```
r2_config       - Cloudflare R2 configuration (single row, id=1)
                  (account_id, bucket_name, public_url, is_active)
document_index  - Documents stored in R2 for PAI lookup
                  (title, description, keywords [text[]], source_url,
                   file_type, file_size_bytes, storage_backend [supabase/r2],
                   is_active, uploaded_by, created_at, updated_at)
```

## AI Image Generation
```
image_gen_jobs  - Async image generation job queue
                  (prompt, job_type, status, metadata [jsonb],
                   result_media_id [FK->media], result_url,
                   input_tokens, output_tokens, estimated_cost_usd,
                   batch_id, batch_label, attempt_count, max_attempts,
                   priority, created_at, started_at, completed_at)
```

## User & Auth System
```
app_users       - Application users with roles and profiles
                  (supabase_auth_id, email, role [admin/staff/resident/associate],
                   display_name, first_name, last_name, phone, phone2,
                   avatar_url, bio, person_id [FK->people],
                   nationality, location_base, gender,
                   privacy_phone, privacy_email, privacy_bio [public/residents/private],
                   facebook_url, instagram_url, linkedin_url, x_url,
                   created_at, last_sign_in_at)
user_invitations - Pending user invitations (email, role, invited_by, expires_at)
```

## Associate Hours & Payouts
```
associate_profiles   - Associate metadata
                      (app_user_id [FK->app_users], person_id [FK->people],
                       hourly_rate, payment_method, payment_handle,
                       identity_verification_status [pending/link_sent/verified/flagged/rejected],
                       setup_completed_at)
time_entries         - Clock in/out records
                      (associate_id [FK->associate_profiles], space_id [FK->spaces],
                       clock_in, clock_out, duration_minutes,
                       is_manual, manual_reason, notes,
                       latitude, longitude, status [active/completed/paid],
                       paid_at, payout_id [FK->payouts])
work_photos          - Before/during/after work photos
                      (time_entry_id [FK->time_entries], associate_id,
                       photo_url, photo_type [before/progress/after], caption)
paypal_config        - PayPal API credentials (single row, id=1)
                      (client_id, client_secret, sandbox_client_id, sandbox_client_secret,
                       webhook_id, sandbox_webhook_id, is_active, test_mode)
payouts              - Payout records for associate payments
                      (associate_id, person_id, amount, payment_method,
                       external_payout_id, status [pending/processing/completed/failed/returned],
                       time_entry_ids [uuid[]], created_at, completed_at)
```

## Identity Verification
```
upload_tokens        - Secure tokenized upload links for ID verification
                      (token, person_id [FK->people], app_user_id [FK->app_users],
                       purpose, expires_at, used_at)
identity_verifications - Extracted DL data from Claude Vision API
                      (person_id, app_user_id, photo_url,
                       extracted_name, extracted_dob, extracted_dl_number,
                       extracted_address, match_status [auto_approved/flagged/rejected],
                       verified_at, reviewed_by)
```

## Vapi Voice Calling System
```
vapi_config          - Vapi API configuration (single row, id=1)
                      (api_key, phone_number_id, is_active, test_mode)
voice_assistants     - Configurable AI voice assistants
                      (name, system_prompt, model, voice, temperature,
                       tools [jsonb], is_active)
voice_calls          - Call log
                      (vapi_call_id, caller_phone, person_id [FK->people],
                       assistant_id [FK->voice_assistants], duration_seconds,
                       cost_usd, transcript [jsonb], recording_url,
                       status, created_at)
```

## Airbnb iCal Sync
```
(Uses existing spaces + assignments tables)
Key columns on spaces: airbnb_ical_url, airbnb_link, airbnb_rate, airbnb_blocked_dates
```

## API Usage Logging
```
api_usage_log   - Cost tracking for all external API calls
                  (vendor, category, endpoint, input_tokens, output_tokens,
                   units, unit_type, estimated_cost_usd, metadata [jsonb],
                   app_user_id [FK->app_users], created_at)
```

## Legacy (Deprecated - don't use for new features)
```
photos          - Old photo storage
photo_spaces    - Old photo-space links
```
