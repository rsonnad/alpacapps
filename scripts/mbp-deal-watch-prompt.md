Search LIVE US retail listings right now for a 16-inch MacBook Pro. Do not invent listings. Open the actual product/search pages. If a source is empty, blocked, or has no matching configs, say so.

MUST MATCH (drop anything that fails even one of these):
- Screen: 16-inch only (reject 14-inch)
- Chip: Apple M5 Pro (preferred) or M5 Max only (reject base M5, M4, M3, Intel)
- RAM: 48 GB or more
- Storage: 1 TB or more
- Condition: New, Open-Box, Apple Certified Refurbished, Amazon Renewed, eBay Refurbished, or Excellent/Like New used
- Reject: heavy wear, screen delamination, heavy scratches, cracked screens, "for parts", "no returns", private-party beaters, incomplete boxes with missing chargers unless the price is excellent

SEARCH EACH SOURCE (visit the live page, do not rely on memory):
1. Apple Certified Refurbished: https://www.apple.com/shop/refurbished/mac/2026-macbook-pro and https://www.apple.com/shop/refurbished/mac
2. Amazon: new + Amazon Renewed. Buyer gets free Asurion protection on Amazon, so Amazon is slightly more attractive even at a higher price.
3. Best Buy Open-Box (and new if priced in range)
4. eBay: prefer reputable sellers (ItsWorthMore, eBay Refurbished, high-feedback stores). Deprioritize no-returns private sales.
5. B&H Photo (optional but useful)

PRICE TIERS (USD, before tax, include shipping in the compared total if not free):
- excellent: under $2,900
- good: $2,900 – $3,100
- acceptable: $3,100 – $3,150 (especially with strong warranty / free Asurion)
- over_budget: above $3,150 — still include true spec matches so the market is visible, but mark the tier

Prefer lower risk: Apple Refurb > Best Buy Open-Box / Amazon (Asurion) > high-feedback eBay Refurbished > private used.

Return TWO sections and nothing else after them:

## EMAIL_BODY
Plain text, ready to email. Start with a one-line summary (counts by tier). Then list matching deals cheapest-first, each as:

- $PRICE | TIER | SOURCE | CHIP | RAMgb/STORAGEgb | CONDITION | seller
  URL
  one-line note (warranty / risk / why it is or isn't interesting)

Then a short "Near misses" section if useful (wrong RAM, 14-inch, etc.) — max 5.
Then "Sources checked" with one line per source (ok / empty / blocked).

If zero matches, say so clearly and still include the cheapest near-misses and current Apple refurb 16" M5 Pro/Max floor prices.

## JSON
A single fenced ```json block with this exact shape:

{
  "generated_at": "<ISO-8601>",
  "listings": [
    {
      "id": "stable-id-from-url-or-sku",
      "source": "apple_refurb|amazon|bestbuy|ebay|bhphoto|other",
      "title": "",
      "url": "",
      "price": 0,
      "shipping": 0,
      "total": 0,
      "chip": "M5 Pro|M5 Max",
      "ram_gb": 48,
      "storage_gb": 1024,
      "screen_inches": 16,
      "condition": "",
      "seller": "",
      "warranty": "",
      "tier": "excellent|good|acceptable|over_budget",
      "risk": "low|medium|high",
      "notes": ""
    }
  ],
  "near_misses": [
    {
      "title": "",
      "url": "",
      "price": 0,
      "reason": "why it failed the filter"
    }
  ],
  "source_notes": [
    {"source": "apple_refurb", "status": "ok|empty|blocked|error", "detail": ""}
  ]
}

Rules for JSON:
- listings[] contains ONLY spec matches (16" + M5 Pro/Max + >=48GB + >=1TB)
- price/total are numbers, no $ or commas
- url must be a real http(s) link you observed
- Do not duplicate the same product URL
