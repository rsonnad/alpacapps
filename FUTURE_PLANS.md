# Future Plans & Features

A running list of planned improvements and new features for AlpacApps / GenAlpaca. Not committed to a timeline—these are backlog / ideas.

---

## Call-in / Text-in Concierge — Extra Security

**Context:** PAI concierge is available by **voice** (Vapi call) and **email** (pai@). Access codes and other sensitive info are already scoped to the authenticated identity (assignments). Caller ID and email can be spoofed, so identity on those channels is weaker than logged-in chat.

**Planned hardening:**

- **Voice PIN** — Optional per-person or per–app_user PIN. When a caller is identified by caller ID, PAI asks for the PIN before returning access codes (or before any sensitive tool use). Reduces risk of caller-ID spoofing.
- **SMS one-time code** — For voice or text-in: “I’ll text you a one-time code; say it or send it to continue.” Only then allow access-code or other sensitive responses. Requires Telnyx (or similar) to send the code to the number we’re trusting.
- **Policy / UX** — Document that sensitive info (e.g. access codes) is “best obtained via logged-in chat” and that call/text is convenience-only unless extra verification (PIN or OTP) is enabled.

**Related:** Access-code tool already restricts to `assignedSpaceIds` only; no bypass via prompt injection or cross-tenant requests. See in-code SECURITY comment in `supabase/functions/alpaca-pai/index.ts` (`get_access_code` case).

---

## Other Ideas (TBD)

- *Add more items here as you decide to track them.*
