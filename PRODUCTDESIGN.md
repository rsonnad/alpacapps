# Product Design Decisions

This document captures the **why** behind how AlpacApps has been built. It covers financial reasoning, user experience philosophy, business model choices, and design tradeoffs that go beyond pure technical architecture. Read this alongside `ARCHITECTURE.md` (system components) and `CLAUDE.md` (conventions and schemas) to understand the full picture.

---

## 1. What AlpacApps Is

AlpacApps is a property management system built for **AlpacApps Residency** (a co-living property in Cedar Creek, TX). It handles spaces, tenants, bookings, payments, smart home control, and an AI concierge (PAI).

The product was purpose-built for one property. Multi-tenancy is a future consideration (see `docs/MULTI_TENANCY_EFFORT_ASSESSMENT.md`) but every decision today optimizes for the single-property experience first.

---

## 2. Design Principles

### 2.1 No Framework, No Build Step

**Decision:** Vanilla HTML/CSS/JavaScript. No React, Vue, or Angular. No webpack, vite, or bundler.

**Why:**
- **Instant deployment.** Push to GitHub Pages and it's live. No CI build pipeline (other than version bumping and Tailwind compilation). This matters because the property needs fast iteration — fix a bug, push, done.
- **AI-friendly codebase.** Autonomous agents (Bug Scout, Feature Builder) can read, understand, and modify plain HTML/JS files without navigating framework abstractions, JSX compilation, or module resolution complexity.
- **Low maintenance.** No dependency upgrades breaking the build. No node_modules security advisories on the frontend. The only npm dependency is Tailwind CSS for utility classes.
- **Accessibility of contribution.** Anyone who knows basic web development can understand and modify the code.

**Tradeoff accepted:** More boilerplate per page. Shared behavior is handled via module imports (`shared/*.js`) rather than components. This is acceptable at the current scale (~54 pages).

### 2.2 Supabase as the Entire Backend

**Decision:** No custom server. Supabase provides database, auth, storage, and edge functions. All client logic runs in the browser.

**Why:**
- **Zero server ops.** No EC2, no containers, no scaling concerns for the web app itself.
- **Cost.** Supabase free tier covers most needs. Even on paid plans, it's cheaper than running a backend server for a single-property system.
- **Edge functions for sensitive logic.** Anything requiring server-side secrets (API keys, webhooks, payment processing) runs as Supabase Edge Functions (Deno). This keeps the architecture serverless without needing a separate backend.
- **RLS for security.** Row-Level Security means the anon key can be safely embedded in client code. Data access is enforced at the database level, not in application code.

**Tradeoff accepted:** Client-side logic can be inspected. Business logic isn't hidden. This is fine for a property management tool where the users are known (residents, staff, admin).

### 2.3 Push to Main = Deploy

**Decision:** No staging environment, no pull request process, no branch protection.

**Why:**
- **Speed over ceremony.** This is a single-property tool with a small user base. The cost of a 5-minute outage from a bad push is much lower than the cost of a slow deployment pipeline slowing down every change.
- **Autonomous agents need to ship.** Bug Scout and Feature Builder merge directly to main. Adding PR review gates would break the autonomous fix-and-deploy loop.
- **Version tracking provides rollback context.** Every push is recorded in `release_events` with SHA, actor, and timestamp. `git revert` is always available.

**Tradeoff accepted:** A bad push goes live immediately. Mitigated by: small blast radius (one property), fast revert capability, and error logging that catches runtime issues.

---

## 3. Smart Home Integration Philosophy

### 3.1 Cloud APIs Over Local Control

**Decision:** Control smart devices (Govee, Nest, Tesla, LG, Anova, Glowforge) via their cloud APIs, proxied through Supabase Edge Functions, rather than local-network-only control.

**Why:**
- **Works from anywhere.** Residents can check the dryer or adjust the thermostat from their phone whether they're on property WiFi or away.
- **No hub dependency.** No single piece of hardware on the LAN needs to stay running for the system to work (except for Sonos and cameras, which require the Alpaca Mac bridge).
- **Consistent auth model.** All device access goes through the same Supabase auth layer. Role-based permissions (resident vs. admin) apply uniformly.

**Exception — Sonos and Cameras:** These require a local bridge (Alpaca Mac) because Sonos HTTP API is LAN-only and camera RTSP streams need local restreaming via go2rtc. The proxy chain (Browser -> Edge Function -> DO Droplet -> Tailscale -> Alpaca Mac) adds latency but maintains the "works from anywhere" principle.

### 3.2 All Residents Can Control Everything

**Decision:** Any resident can control any thermostat, any light group, lock/unlock any car, etc. No per-device or per-room access restrictions.

**Why:**
- **Co-living model.** This is a shared house, not an apartment building. Shared spaces (kitchen, garage, outdoor areas) have devices that everyone uses. Restricting access creates friction without meaningful privacy benefit.
- **Car rotation.** Tesla vehicles need to be moved on/off chargers. Any resident being able to unlock any car enables self-service charger rotation without coordinating with the car's "owner."
- **Simplicity.** Per-device permissions would add significant complexity to the UI and backend for a scenario (one shared house) where it's not needed.

**Tradeoff accepted:** A resident could theoretically abuse controls (crank the heat, lock someone's car). This is a social problem solved by social norms in a co-living house, not a technical access control problem.

### 3.3 Music Assistant as Sonos Controller

**Decision:** Use Music Assistant on Alpaca Mac as the primary control plane for Sonos playback/grouping/library actions, while keeping the Sonos HTTP API path for announcements and EQ fallback.

**Why:**
- **Single music control layer.** MA gives one API for transport, grouping, and library operations, reducing custom Sonos- and Spotify-specific edge logic over time.
- **Future-proofing.** MA can support additional player/provider types without rewriting resident/mobile/PAI music UX contracts.
- **Operational safety.** We keep Sonos proxy fallback for announce and any unsupported MA command so migration can be gradual and non-breaking.
- **Infra simplification.** Hostinger acts as the HTTPS proxy (`/sonos`, `/ma-api`) while Alpaca Mac stays the LAN bridge where Sonos and MA run.

### 3.4 FlashForge: TCP G-code Over HTTP API

**Decision:** Control the FlashForge Adventurer 5M Pro via its raw TCP G-code protocol (port 8899) rather than the HTTP REST API (port 8898).

**Why:**
- **No authentication needed.** TCP port 8899 accepts G-code commands without any auth token or checkCode, while the HTTP API requires a checkCode handshake that changes per session.
- **Full functionality.** TCP exposes every printer capability: temperatures, print control, LED, file listing, progress, endstops, homing — the HTTP API has a smaller surface area.
- **Same proxy pattern.** The printer is LAN-only, so we need an Alpaca Mac bridge regardless. A lightweight HTTP→TCP proxy (`printer-proxy.js`) fits the same Caddy/Tailscale pattern used for Sonos and cameras.
- **Community-proven.** FlashForge TCP protocol is well-documented by the community (OctoPrint plugin, FlashPrint source analysis). The HTTP API is less documented and less stable across firmware versions.

**Tradeoff accepted:** TCP requires a custom proxy to bridge HTTP→TCP, adding one more LaunchAgent on Alpaca Mac. This is acceptable since the same machine already runs go2rtc, talkback-relay, and sonos-http-api.

---

## 4. Payment System Design

### 4.1 Manual Methods First, Online Second

**Decision:** The payment page (`/pay/`) prominently shows free manual methods (Zelle, Venmo, PayPal) above the online payment option (Stripe ACH/card).

**Why:**
- **Cost.** Zelle and Venmo transfers cost the property $0. Stripe ACH costs 0.8% capped at $5. Card payments cost 2.9% + $0.30. For a $2,000/month rent payment, that's $0 vs $5 vs $58.30.
- **Tenant preference.** Most tenants already use Zelle for rent at other properties. Offering it as the primary method matches existing behavior.
- **Auto-recording.** Zelle payments send confirmation emails to `alpacaplayhouse@gmail.com`. The inbound email webhook automatically detects these and creates ledger entries. This gives the convenience of automatic recording without payment processing fees.

**Stripe is there for:** Tenants who prefer automated online payments, or for situations where manual payment isn't practical (deposits from out-of-state applicants, event payments from non-residents).

### 4.2 Transparent Fee Display

**Decision:** The pay page shows "0.8% processing fee (max $5)" directly on the Stripe payment option, and "Free - no processing fee" on manual methods.

**Why:** Tenants should make informed choices. If they know Zelle is free and Stripe costs $5 on a large payment, most will choose Zelle — which is the preferred outcome for the property.

---

## 5. PAI (Property AI) Design

### 5.1 One AI, Multiple Channels

**Decision:** PAI is a single AI assistant accessible via web chat widget, voice phone calls (Vapi), email (`pai@alpacaplayhouse.com`), and Discord. All channels route to the same `alpaca-pai` edge function.

**Why:**
- **Consistency.** PAI gives the same answers and has the same capabilities regardless of channel. A question asked via Discord gets the same smart home access as one asked via voice.
- **Single point of improvement.** Upgrading PAI's knowledge or tools benefits all channels simultaneously.
- **Meet users where they are.** Some residents prefer chat, some prefer voice, some prefer Discord. Forcing one channel reduces adoption.

### 5.2 PAI Controls Real Devices

**Decision:** PAI can actually control lights, music, thermostats, and other devices — not just answer questions about them.

**Why:**
- **The whole point.** "Hey PAI, turn off the garage lights" is more useful than "The garage lights are controlled from the Lighting page." Natural language smart home control is the killer feature for residents who don't want to navigate a UI.
- **Guarded by the same permissions.** PAI checks the user's role and permissions before executing device commands. A demo user asking PAI to unlock a car will be denied the same way as clicking the button in the UI.

### 5.3 Sensitive Data Restrictions

**Decision:** PAI only returns access codes for spaces the requesting user is actively assigned to. No cross-tenant data, no prompt injection bypass.

**Why:** Access codes are the highest-sensitivity data in the system. A voice caller identified only by caller ID (which can be spoofed) should not be able to get access codes for spaces they don't live in. Future hardening (voice PIN, SMS OTP) is planned in `FUTURE_PLANS.md`.

---

## 6. Autonomous Agents (Bug Scout & Feature Builder)

### 6.1 Agents Ship Directly to Production

**Decision:** Bug Scout and Feature Builder commit fixes and features directly to `main`, which deploys immediately to production.

**Why:**
- **Speed of resolution.** A bug reported at 2 AM can be fixed and deployed by 2:15 AM without any human intervention.
- **The codebase supports it.** No build step means no build failures. Plain HTML/JS means fewer ways for a generated change to break non-obviously.
- **Verification screenshots.** After deploying, Bug Scout takes a screenshot of the affected page and emails it. If the fix is wrong, a human can revert.

**Tradeoff accepted:** An agent could introduce a regression. Mitigated by: error logging catches runtime errors, the small user base notices issues quickly, and `git revert` is always one command away.

### 6.2 Agents Run on Separate Infrastructure

**Decision:** Bug Scout, Feature Builder, Tesla Poller, LG Poller, and Image Gen run on a DigitalOcean droplet (migrating to Oracle Cloud free tier), not as Supabase Edge Functions.

**Why:**
- **Long-running processes.** Edge functions have execution time limits. A Bug Scout job that runs Claude Code to analyze and fix a bug can take several minutes. Pollers need to run continuously.
- **System-level access.** Bug Scout needs `git`, a filesystem, and Puppeteer for screenshots. Edge functions are sandboxed Deno with no filesystem access.
- **Cost optimization.** The Oracle Cloud Always Free ARM instance provides 4 cores and 24 GB RAM at $0/month. This is more than enough for all workers.

---

## 7. Cost Tracking as a First-Class Feature

### 7.1 Every API Call is Logged

**Decision:** All external API calls must log to `api_usage_log` with vendor, category, and estimated cost.

**Why:**
- **Visibility.** A property management system that silently racks up API bills is a liability. Knowing that PAI costs $X/month in Gemini tokens, or that SMS costs $Y/month in Telnyx segments, enables informed decisions about which features to keep, optimize, or cut.
- **Per-feature cost attribution.** Categories like `pai_chat`, `tesla_vehicle_poll`, and `sms_tenant_notification` answer "how much does this specific feature cost?" — not just "how much did Gemini cost total?"
- **Multi-tenancy readiness.** When (if) the system goes multi-tenant, per-org billing requires per-org cost tracking. Building the logging habit now means the data is already there.

### 7.2 Free-Tier-First Vendor Selection

**Decision:** Prefer vendors with meaningful free tiers (Supabase, Gemini, Oracle Cloud, Cloudflare R2, Brave Search) over vendors that charge from day one.

**Why:** This is a single-property system, not a SaaS at scale. Monthly infrastructure cost should be as close to $0 as possible for the base system. The current recurring costs are:
- Supabase: Free tier (or $25/month Pro if needed)
- GitHub Pages: Free
- Oracle Cloud: Free tier (replacing $24/month DigitalOcean)
- Cloudflare R2: Free tier (10 GB)
- Gemini: Free tier (1,000 requests/day)
- Brave Search: Free tier (2,000 queries/month)

Usage-based costs (SMS, e-signatures, payment processing) are unavoidable but scale with actual usage, not infrastructure.

---

## 8. Demo Mode & Future Multi-Tenancy

### 8.1 Demo Mode for Showcasing

**Decision:** A `demo` role allows invited users to see the full product with sensitive data redacted (names, dollar amounts, passwords/codes replaced with visually-obvious fakes).

**Why:**
- **Sales tool.** Showing the product to potential adopters (other co-living houses) requires letting them see real functionality without exposing real tenant data.
- **Low effort.** Client-side redaction with a CSS class is simpler than maintaining a parallel demo environment with fake data.
- **Honest representation.** Demo users see the real UI, real smart home data, and real system behavior — just with PII masked. This is more convincing than a staged demo.

### 8.2 Multi-Tenancy as a Future Option, Not a Current Constraint

**Decision:** Build for one property now. Don't add `org_id` to every table until multi-tenancy is actually needed.

**Why:**
- **YAGNI.** Multi-tenancy adds 12-20 weeks of work (per the assessment). Every table, edge function, and RLS policy would need modification. Doing this before there's a second customer wastes months of development time.
- **The assessment exists.** `docs/MULTI_TENANCY_EFFORT_ASSESSMENT.md` documents the full plan: data model, auth, edge functions, storage, billing, hosted workers, feature flags. When the time comes, the path is clear.
- **No lock-in.** The architecture (Supabase + Edge Functions + static frontend) doesn't prevent multi-tenancy later. Adding `org_id` is additive, not a rewrite.

---

## 9. User Role Hierarchy

**Decision:** Five roles with increasing access: `public` < `associate` < `resident` < `staff` < `admin` (+ `oracle` as super-admin, `demo` as view-only).

**Why:**
- **Associates** are workers (cleaners, maintenance) who need clock-in/out and payment features but not smart home control or tenant data.
- **Residents** are current tenants who need smart home control, their own profile, and visibility into shared spaces.
- **Staff** can view and manage most admin functions but can't change system settings or user roles.
- **Admin** has full control.
- **Oracle** exists as a super-admin bypass for edge cases and system debugging.

This hierarchy maps directly to the property's real-world roles. Permissions are defined per-role in a permission matrix (`api-permissions.ts`) so adding a new permission is a one-line change, not a policy rewrite.

---

## 10. Mobile App Strategy

### 10.1 Capacitor Wrapping, Not Native

**Decision:** The mobile app is a Capacitor 8 wrapper around the same web code, not a native Swift/Kotlin app.

**Why:**
- **One codebase.** Shared service modules (`shared/services/*.js`) work identically on web and mobile. A fix to the lighting data layer benefits both platforms.
- **Speed of iteration.** OTA updates via Capgo mean code changes ship without App Store review. For a single-property app, this is more important than native performance.
- **The UI is already mobile-first.** Resident pages are designed for phone screens. Wrapping them in a native shell adds native navigation (tab bar) and platform integrations (push notifications, biometrics) without rewriting the UI.

### 10.2 Five Tabs, Not a Kitchen Sink

**Decision:** The mobile app has exactly five tabs: Cameras, Music, Lights, Climate, Cars.

**Why:** These are the features residents use most frequently and benefit most from quick access. Other features (laundry, profile, PAI) are accessible but not tab-bar-promoted. The tab bar is prime real estate — every addition makes existing tabs harder to reach.

---

## 11. Email & Communication Design

### 11.1 Branded Email Wrapper

**Decision:** All system emails are wrapped in a consistent branded shell (header with logo, body, footer with address and tagline) rather than plain text.

**Why:**
- **Professionalism.** Emails from `noreply@alpacaplayhouse.com` that look branded and consistent build trust. Plain text emails look like spam.
- **One change, all emails.** The wrapper is defined in `email-brand-wrapper.ts`. Updating the logo, colors, or footer text updates every email template automatically.
- **Brand config from DB.** The wrapper reads colors, logos, and text from `brand_config`, so a non-developer can update the email look from the Brand admin page.

### 11.2 Inbound Email Routing

**Decision:** All `*@alpacaplayhouse.com` addresses are received via Resend webhook and routed by prefix (personal forwards, `team@`, `auto@`, `pai@`).

**Why:**
- **One domain, many uses.** Personal email addresses (haydn@, rahulio@, sonia@) forward to Gmail. Team email goes to a shared inbox. PAI email goes to the AI. Auto email handles bug report replies. All from one domain with one webhook.
- **No separate email service.** No Google Workspace or Microsoft 365 subscription needed. Resend handles both sending and receiving.

---

## 12. Data & Privacy Decisions

### 12.1 No Personal Data in Consumer View

**Decision:** The public spaces listing shows availability dates but never tenant names, contact info, or any personal details.

**Why:** Prospective tenants need to know when a space becomes available, not who currently lives there. This is both a privacy protection and a legal consideration.

### 12.2 Soft Deletes Over Hard Deletes

**Decision:** Spaces use `is_archived`, documents use `is_active`, vehicles use `is_active`. Records are never actually deleted from the database.

**Why:**
- **Audit trail.** Property management involves legal and financial records. Being able to show a historical assignment or payment record years later matters.
- **Undo capability.** Accidentally archiving a space is a one-click fix. Accidentally deleting a space and its associated assignments, media, and history is catastrophic.
- **Referential integrity.** Foreign keys to spaces, people, and vehicles would break if records were hard-deleted.

### 12.3 Access Codes in Database, Not in Code

**Decision:** Space access codes (door keypads) are stored in the `spaces` table, not hardcoded anywhere.

**Why:**
- **Dynamic updates.** When a code changes, update one database field. No code push required.
- **Scoped access.** PAI only returns access codes for spaces the requesting user is assigned to. This scoping is a database query, not application logic.
- **Rotation.** Codes can be changed when a tenant moves out without any deployment.

---

## 13. AI Model Selection

### 13.1 Gemini for PAI Chat & Voice

**Decision:** PAI uses Gemini (currently 2.0 Flash and 2.5 Flash/Pro) for all conversational AI — chat, voice, email classification, payment matching, and image generation.

**Why Gemini over OpenAI or Claude API:**
- **Cost.** Gemini 2.0 Flash is $0.10/1M input, $0.40/1M output. GPT-4o is ~$2.50/$10.00. Claude Sonnet is ~$3/$15. For a chatbot handling dozens of conversations daily, the 25x cost difference matters.
- **Free tier.** 1,000 requests/day with no credit card. This covers development, testing, and moderate production usage at zero cost.
- **Multimodal.** Gemini natively generates images (2.5 Flash Image), reads images, and handles voice through Vapi integration. One vendor for text + image + voice context.
- **Tool calling.** Gemini's function calling works well for PAI's 15+ tools (smart home control, data queries, web search, send links). Latency is acceptable for conversational use.
- **Google ecosystem alignment.** Nest thermostats already use Google SDM API. Staying in the Google ecosystem reduces cognitive overhead.

**Tradeoff accepted:** Gemini is less capable than Claude or GPT-4 for complex reasoning. For property Q&A and smart home control, this doesn't matter — the tasks are straightforward function calls and knowledge retrieval, not nuanced analysis.

### 13.2 Claude for Identity Verification & Bug Analysis

**Decision:** Claude Vision API (via Anthropic) is used for driver's license photo verification. Claude Code (via Anthropic) powers Bug Scout and Feature Builder.

**Why Claude for these specific tasks:**
- **Vision accuracy.** Claude Vision extracts structured data (name, DOB, DL number, address) from driver's license photos with higher accuracy than Gemini Vision for this specific task. Identity verification is high-stakes — a wrong extraction means manual review.
- **Code generation quality.** Bug Scout and Feature Builder generate real code changes that ship to production. Claude Code's ability to understand a full codebase, make targeted edits, and maintain style consistency is better than alternatives for autonomous coding.
- **Different cost tolerance.** Identity verification happens rarely (new applicants/associates). Bug fixes happen a few times per week. Low volume means the higher per-token cost of Claude is acceptable for these use cases.

### 13.3 No Single-Vendor Lock-In

**Decision:** Use different AI providers for different tasks rather than standardizing on one.

**Why:**
- **Best tool for the job.** Gemini is cheapest for high-volume chat. Claude is best for code and vision tasks. Choosing one vendor for everything means overpaying for some tasks or getting worse results for others.
- **Resilience.** If one provider has an outage or price increase, only the features using that provider are affected. PAI chat and Bug Scout are independent.
- **API usage logging.** The `api_usage_log` table tracks cost per vendor per category. This makes it easy to see if a vendor becomes uneconomical and switch.

---

## 14. Service Selection Rationale

Each external service was chosen for specific reasons. This section documents why each service was selected over alternatives.

### 14.1 Supabase (not Firebase, not self-hosted Postgres)

- **vs Firebase:** Supabase is Postgres (standard SQL, powerful queries, joins) vs Firestore (NoSQL, limited queries). Property management data is inherently relational (spaces have assignments, assignments have people, people have payments). Postgres is the natural fit.
- **vs Self-hosted Postgres:** Supabase bundles auth, storage, realtime subscriptions, and edge functions. Self-hosting would require separate solutions for each, plus ops for backups, upgrades, and availability.
- **vs PlanetScale/Neon:** Supabase's edge functions eliminate the need for a separate backend server. PlanetScale and Neon are DB-only — you'd still need a server for auth, storage, and serverless functions.

### 14.2 Resend (not SendGrid, not Mailgun, not SES)

- **vs SendGrid:** Resend has a cleaner API, built-in inbound email support (webhook-based), and the free tier (100 emails/day) covers daily needs. SendGrid's inbound parsing requires more setup.
- **vs Mailgun:** Similar capability but Mailgun's free tier is more restrictive and their pricing for low volume is higher.
- **vs SES:** AWS SES is cheapest at scale but requires AWS account setup, IAM configuration, and has no built-in inbound routing. For a single-property system, the operational simplicity of Resend wins.
- **Key differentiator:** Resend handles both sending AND receiving on the same domain with one webhook. This eliminated the need for Google Workspace ($6/user/month) or a separate inbound email service.

### 14.3 Telnyx (not Twilio)

- **vs Twilio:** Telnyx SMS costs ~$0.004/segment outbound vs Twilio's ~$0.0079. For a system sending payment reminders and notifications, the per-message cost adds up. API quality and reliability are comparable.
- **Messaging profile model.** Telnyx's messaging profiles make it easy to manage phone numbers and routing. The webhook model is similar to Twilio.

### 14.4 Stripe (not Square alone)

- **Why both:** Square was the original payment processor. Stripe was added for ACH bank transfers (0.8% capped at $5 — much cheaper than card processing for large rent payments) and for Stripe Connect (associate payouts via direct ACH transfers).
- **Stripe ACH advantage:** For a $2,000 rent payment, Stripe ACH costs $5. Square card processing would cost $52.10 (2.6% + $0.10). This single feature saves $47/transaction.
- **Stripe Connect for payouts:** Associates get paid via Stripe Connect Express accounts. This handles KYC, tax forms (1099), and direct deposit without the property managing bank account details.

### 14.5 Brave Search (not Google Search API, not Bing)

- **vs Gemini's built-in google_search:** Gemini's native search tool is opaque — you can't control the query, result count, or parsing. Brave Search gives full control over what's searched and how results are used.
- **vs Google Custom Search API:** $5 per 1,000 queries. Brave is free for 2,000 queries/month. For PAI's web search needs (current events, local business lookup), this is more than enough.
- **Privacy:** Brave doesn't track searches. For a system where residents ask PAI about local restaurants, events, and services, this is a values alignment.

### 14.6 Cloudflare R2 (not S3, not keeping everything in Supabase Storage)

- **vs S3:** Zero egress fees. When documents are accessed frequently (PAI looks up manuals, residents download guides), egress costs on S3 add up. R2 charges $0 for reads.
- **vs Supabase Storage:** Supabase Storage is fine for images and lease documents (infrequent access, small files). R2 is better for the document library (frequent access by PAI, larger files, needs public URLs).
- **S3-compatible API:** The `r2-upload.ts` helper uses AWS Signature V4. If R2 ever becomes insufficient, migrating to S3 is a config change, not a code rewrite.

### 14.7 SignWell (not DocuSign, not HelloSign)

- **vs DocuSign:** DocuSign starts at $10/month for 5 envelopes. SignWell's free tier includes 25 documents/month, which covers a co-living property's lease signing volume.
- **vs HelloSign (Dropbox Sign):** Similar pricing but SignWell's API is simpler and their webhook model fits the existing Supabase Edge Function pattern cleanly.
- **Why e-signatures at all:** Legal requirement. Lease agreements need signatures. Mailing physical documents adds days to the rental pipeline. Digital signatures close in hours.

### 14.8 Vapi (not building voice in-house)

- **vs Custom Twilio + STT + TTS:** Vapi handles the full voice pipeline (telephony, speech-to-text, LLM routing, text-to-speech) as a service. Building this in-house would require integrating Twilio for telephony, Whisper for STT, a TTS service, and managing the conversation state machine. Vapi does all of this for ~$0.10-0.30 per call.
- **Server URL pattern:** Vapi calls our `vapi-server` edge function on each incoming call to get the assistant config dynamically. This means PAI's personality, tools, and knowledge base are always current without reconfiguring Vapi.

---

## 15. Environment & Configuration Design

### 15.1 Config in Database, Not Environment Variables

**Decision:** Most service configurations (API keys, phone numbers, test mode toggles) are stored in singleton database tables (`telnyx_config`, `nest_config`, `govee_config`, etc.) rather than environment variables.

**Why:**
- **Runtime changes.** An admin can toggle test mode, update an API key, or change a phone number from the Settings page without redeploying anything.
- **Visibility.** Config stored in the database can be displayed in the admin UI. Environment variables are invisible to non-technical users.
- **Multi-tenancy future.** When (if) the system goes multi-tenant, config tables naturally become per-org rows. Environment variables can't be per-tenant.

**Exception:** Supabase secrets (edge function env vars) are used for credentials that edge functions need at cold-start time and that should never be exposed client-side (e.g., `RESEND_API_KEY`, `BRAVE_API_KEY`). These are set via `supabase secrets set` and are not user-configurable at runtime.

### 15.2 Test Mode Per Service

**Decision:** Each external service has an independent `test_mode` boolean in its config table.

**Why:**
- **Granular testing.** You can test SMS sending (Telnyx test mode) while payments (Stripe) run in production. Not everything needs to be in test mode simultaneously.
- **Safe iteration.** Developers and admins can experiment with one integration without risking real transactions on others.
- **No separate staging environment.** Test mode flags are the staging environment. This avoids maintaining a parallel Supabase project, separate API keys, and duplicate infrastructure.

### 15.3 Tailscale Mesh for LAN Bridge

**Decision:** The DO droplet (and Oracle Cloud instance) connects to Alpaca Mac via Tailscale VPN, not a public-facing API or SSH tunnel.

**Why:**
- **Zero exposed ports.** Alpaca Mac doesn't need any ports open to the internet. Tailscale creates a private mesh network where only authorized nodes can communicate.
- **Stable addressing.** Tailscale IPs don't change when the home network's public IP changes (common with residential ISPs).
- **No port forwarding.** The home router doesn't need any special configuration. This is important for a property where the network setup should be maintainable by non-network-engineers.

### 15.4 Version Tracking via Database Sequence

**Decision:** Version numbers (`vYYMMDD.NN`) are generated by a Supabase database sequence (`release_event_seq`), not by counting git commits or using timestamps alone.

**Why:**
- **Guaranteed ordering.** A database sequence is monotonically increasing and atomic. Two simultaneous pushes can't get the same counter.
- **Idempotent per SHA.** The `record_release_event()` function is idempotent — re-running CI on the same commit returns the same version. This prevents duplicate versions from webhook retries.
- **Austin timezone.** The version timestamp is in America/Chicago (Austin) because the property is in Texas. Displaying UTC would confuse users who think in local time.

### 15.5 Workers as Systemd Services

**Decision:** All background workers (Bug Scout, Feature Builder, Tesla Poller, LG Poller, Image Gen, PAI Discord Bot) run as systemd services on a Linux server.

**Why:**
- **Auto-restart.** Systemd automatically restarts a crashed worker. No external process manager (PM2, forever) needed.
- **Logging.** `journalctl -u service-name` gives logs with timestamps and rotation for free.
- **Simple deployment.** Update the code, `systemctl restart service-name`. No container registry, no Kubernetes, no Docker Compose.
- **One server, many services.** All six workers share one Oracle Cloud instance. Each is a lightweight Node.js process consuming minimal resources when idle.

---

## 16. Infrastructure Cost Decisions

| Decision | Monthly Cost | Alternative Considered | Alternative Cost | Why This Choice |
|----------|-------------|----------------------|-----------------|----------------|
| GitHub Pages hosting | $0 | Vercel, Netlify | $0-20 | Simplest. No build step needed. Custom domain support. |
| Oracle Cloud free tier (workers) | $0 | DigitalOcean droplet | $24 | Same capability, zero cost. ARM is fine for Node.js workers. |
| Supabase (DB + Auth + Storage + Edge) | $0-25 | Self-hosted Postgres + custom auth | $20-50+ | Managed service. Edge functions eliminate need for a backend server. |
| Cloudflare R2 (document storage) | $0 | S3, Supabase Storage | $0-5 | Zero egress fees. 10 GB free. S3-compatible API. |
| Resend (email) | $0 | SendGrid, Google Workspace | $0-72/yr | Clean API. Inbound + outbound on one domain. No per-user subscription. |
| Telnyx (SMS) | ~$2-5 | Twilio | ~$5-15 | Lower per-segment cost. Same API quality. |
| Gemini (PAI chat) | $0-5 | OpenAI GPT-4o, Claude API | $10-50 | Free tier generous. 25x cheaper per token for chat workloads. |
| Claude (code gen, vision) | Usage-based | Gemini, GPT-4 | Varies | Best quality for autonomous code generation and document vision. |
| Brave Search (PAI web search) | $0 | Google Custom Search | $5/1K queries | Free 2,000 queries/month. Full control over results. Privacy-focused. |
| Stripe (ACH payments) | 0.8% capped $5 | Square (card only) | 2.6% + $0.10 | $5 vs $52 on a $2,000 rent payment. |
| Vapi (voice calling) | ~$0.10-0.30/call | Custom Twilio + STT + TTS | $50+/month + dev time | Fully managed voice pipeline. No telephony infrastructure to maintain. |
| SignWell (e-signatures) | $0 (free tier) | DocuSign | $10+/month | 25 docs/month free covers lease signing volume. |

**Total target:** Under $30/month for the full system (was ~$50/month before Oracle migration). Usage-based costs (SMS, payments, AI) scale with activity, not infrastructure.

---

## 17. What This Document Does NOT Cover

- **Technical architecture** (component diagrams, data flow, deployment topology) -> see `ARCHITECTURE.md`
- **Database schema details** (table definitions, columns, relationships) -> see `CLAUDE.md` and `docs/claude/database-schema.md`
- **API contracts** (endpoints, request/response formats) -> see `API.md`
- **Home automation specifics** (device IPs, proxy chains, protocols) -> see `HOMEAUTOMATION.md`
- **Future roadmap** (planned features, backlog ideas) -> see `FUTURE_PLANS.md`
- **Multi-tenancy plan** (effort assessment, phasing) -> see `docs/MULTI_TENANCY_EFFORT_ASSESSMENT.md`
- **Demo mode implementation** (role permissions, redaction logic) -> see `docs/DEMO_MODE_FEATURE_PLAN.md`
