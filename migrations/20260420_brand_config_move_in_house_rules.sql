-- Seed default move_in_house_rules markdown into brand_config singleton.
-- Idempotent: only sets the key if it doesn't already exist, so re-runs don't clobber admin edits.

UPDATE brand_config
SET
  config = jsonb_set(
    config,
    '{move_in_house_rules}',
    to_jsonb($$Please read the [Visiting Guide](https://alpacaplayhouse.com/visiting) and [Community](https://alpacaplayhouse.com/community) pages before arrival — they cover parking, house rules, and culture in full.

**At a glance:**

• **Parking** — gravel lot on the right when you enter the gate. If full, across the street to the left past two houses. Never on the grass, never in front of neighbors, never by the sauna or garage.
• **Gates** — always keep the back fence gates closed. Always.
• **No meat inside the house** — store in the doghouse fridge, cook on the back patio grills.
• **No alcohol on property.**
• **Never share the address** — if guests are coming, send them alpacaplayhouse.com/visiting. Not the address. Ever.
• **Quiet hours** — before 9am and after 9:30pm.
• **Clean up immediately** — no personal items on kitchen or living room counters.
• **Wifi** — Black Rock City / popopopo

**Stay connected — reach us any time:**

• **WhatsApp community (essential — please join!)** — [Tap to join the resident group](https://chat.whatsapp.com/Ce6KL2dMi3L5AU56rOIYRy?mode=gi_t). This is our primary way of keeping in touch. Other residents and staff need a way to reach you for check-ins, updates, and community coordination.
• **Ask PAI first** — our AI assistant handles most questions. Email pai@alpacaplayhouse.com, text (737) 747-4737, or call (737) 225-9525.
• **Jon — on-site house engineer** — if you can't find the answer autonomously or PAI can't help, Jon lives on-site and can troubleshoot anything in person. Text him at (239) 666-5815.
• **Urgent** — Text Rahul at (424) 234-1750.$$::text)
  ),
  updated_at = now()
WHERE id = 1
  AND NOT (config ? 'move_in_house_rules');
