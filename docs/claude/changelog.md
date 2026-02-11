# Changelog / Recent Changes

> Reference file for Claude. Read on-demand for context on recent feature additions.

1. **Consumer view real availability** - Fetches assignments to show actual dates
2. **Media system migration** - `media`/`media_spaces` tables replace `photos`/`photo_spaces`
3. **Space archiving** - `is_archived` flag for soft deletes
4. **Image compression** - Client-side compression for images > 500KB
5. **Early exit feature** - `desired_departure_date` + `desired_departure_listed` on assignments
6. **Space type field** - Free-form `type` column on spaces table
7. **Manage page filters** - Search, parent area dropdown, dwelling/non-dwelling checkboxes
8. **URL parameter handling** - `/spaces/admin/?edit=<id>` auto-opens edit modal
9. **Lease Template System** - DB-driven lease generation with {{placeholders}}, jsPDF, SignWell e-signatures
10. **Rental Pipeline** - Kanban workflow: Applications -> Approved -> Contract -> Deposit -> Ready
11. **Telnyx SMS Integration** - Outbound/inbound SMS via `send-sms` and `telnyx-webhook`
12. **Bug Fix Verification Screenshots** - Puppeteer on DO droplet screenshots after deploy
13. **Bug Reports Browser Info** - Extensions collect user_agent, browser, OS, screen, viewport
14. **Resend Inbound Email** - Prefix-based routing, SVIX verification, `inbound_emails` table
15. **Home Automation System** - Sonos HTTP API + UniFi via Alpaca Mac + Tailscale
16. **Govee Lighting Integration** - 63 devices, `govee_devices` table, space hierarchy grouping
17. **Nest Thermostat Integration** - SDM API, 3 thermostats, OAuth token management
18. **Weather Forecast** - 48-hour OWM forecast on climate page with rain windows
19. **AI Image Generation Worker** - Gemini 2.5 Flash on DO droplet, `image_gen_jobs` queue
20. **Tesla Fleet API** - 6 vehicles, poller on DO, commands via `tesla-command` edge function
21. **Camera Streaming (go2rtc)** - HLS via go2rtc on Alpaca Mac, Caddy proxy, PTZ controls
22. **LG Laundry Monitoring** - ThinQ API, 30s polling, FCM push on cycle end
23. **Camera Talkback** - WebSocket -> FFmpeg -> UDP two-way audio relay
24. **Vapi Voice Calling** - AI phone assistant with dynamic prompts and PAI tool routing
25. **User Profile Page** - Self-service profile editor with privacy controls
26. **Associate Hours Tracking** - Clock in/out, GPS, work photos, manual entry
27. **Identity Verification** - DL photo -> Claude Vision -> auto-verify
28. **PayPal Payouts** - Instant associate payments, sandbox + production
29. **Zelle Auto-Recording** - Inbound email -> parse Zelle confirmation -> ledger entry
30. **Airbnb iCal Sync** - Two-way calendar sync with parent cascade
31. **Vehicle Management Overhaul** - `tesla_vehicles` -> `vehicles`, `vehicle_drivers` junction
32. **PAI Feature Builder** - Autonomous feature implementation from PAI chat
33. **Emergency Contacts Page** - `lost.html` with reversed phone numbers
34. **Space Access Codes** - `access_code` field on spaces table
35. **UP-SENSE Smart Sensors** - Installation guide at `residents/sensorinstallation.html`
36. **Mobile App (Capacitor 8)** - iOS/Android, 5 tabs, dark theme, OTA updates via Capgo
37. **Cloudflare R2 Object Storage** - Replaced Google Drive, S3-compatible, zero egress
38. **PAI Email Inbox** - `pai@alpacaplayhouse.com` classifies and responds via Gemini
39. **Centralized Internal REST API** - Single `POST /functions/v1/api` endpoint for all entity CRUD. 20 resources (spaces, people, assignments, tasks, users, profile, vehicles, media, payments, bug_reports, time_entries, events, documents, sms, faq, invitations, password_vault, feature_requests, pai_config, tesla_accounts). Role-based RBAC (0=public → 4=oracle). Smart fuzzy name/space resolution, auto-timestamps, soft deletes, row-level scoping. PAI integration via `manage_data` tool. Shared modules: `api-permissions.ts`, `api-helpers.ts`. Deployed with `--no-verify-jwt`.
