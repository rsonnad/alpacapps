# Future Plans & Features

A running list of planned improvements and new features for AlpacApps / AlpacApps. Not committed to a timeline—these are backlog / ideas.

---

## Call-in / Text-in Concierge — Extra Security

**Context:** PAI concierge is available by **voice** (Vapi call) and **email** (pai@). Access codes and other sensitive info are already scoped to the authenticated identity (assignments). Caller ID and email can be spoofed, so identity on those channels is weaker than logged-in chat.

**Planned hardening:**

- **Voice PIN** — Optional per-person or per–app_user PIN. When a caller is identified by caller ID, PAI asks for the PIN before returning access codes (or before any sensitive tool use). Reduces risk of caller-ID spoofing.
- **SMS one-time code** — For voice or text-in: “I’ll text you a one-time code; say it or send it to continue.” Only then allow access-code or other sensitive responses. Requires Telnyx (or similar) to send the code to the number we’re trusting.
- **Policy / UX** — Document that sensitive info (e.g. access codes) is “best obtained via logged-in chat” and that call/text is convenience-only unless extra verification (PIN or OTP) is enabled.

**Related:** Access-code tool already restricts to `assignedSpaceIds` only; no bypass via prompt injection or cross-tenant requests. Door codes now come from `password_vault` (category='house') instead of `spaces.access_code`. See in-code SECURITY comment in `supabase/functions/alpaca-pai/index.ts` (`get_access_code` case).

---

---

## Domain Migration — GoDaddy → Cloudflare

**Context:** All domains are currently on GoDaddy. Renewal prices are inflated (~$22+/yr for .com + $10/yr WHOIS privacy). The GoDaddy interface is painful.

**Plan:**

- Consolidate all domains into the existing Cloudflare account (already used for R2 / AlpacApps)
- At-cost pricing (~$10/yr for .com, no renewal markup, free WHOIS privacy)
- One dashboard for domains + R2 + DNS + CDN
- Point DNS records to Vercel, DO droplet, Supabase, etc. as needed
- Cloudflare DNS stays as nameservers (free CDN, DDoS protection, fast propagation)

**Transfer steps (per domain):**

1. Unlock domain at GoDaddy
2. Get EPP/auth code from GoDaddy
3. Cloudflare dashboard → Register Domains → Transfer
4. Enter auth code, pay at-cost renewal
5. Confirm via email (~5 days to complete)
6. Set up DNS records pointing to actual hosts

## Other Ideas (TBD)

- *Add more items here as you decide to track them.*
