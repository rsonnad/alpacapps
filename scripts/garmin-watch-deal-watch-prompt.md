Search LIVE US retail/marketplace listings right now for a Garmin Forerunner 145 or Garmin Forerunner 245 GPS running watch. Do not invent listings. Open the actual product/search pages. If a source is empty, blocked, or has no matching listings, say so.

MUST MATCH (drop anything that fails even one of these):
- Model: Forerunner 145 or Forerunner 145 Music, or Forerunner 245 or Forerunner 245 Music only (reject other Forerunner models — 55, 165, 265, 955, etc.)
- Condition: Used or Refurbished only — reject brand-new/sealed listings
  - Accept: Garmin Certified Refurbished, manufacturer-refurbished (Back Market, GPS Nation, Best Buy refurb), eBay Refurbished, high-feedback eBay used, Facebook Marketplace / Craigslist used (only if seller has some verifiable history)
  - Reject: heavy wear, cracked/scratched screen, swollen battery, "for parts", "no returns" with no photos, missing charging cable with no price discount to compensate
- Must include the charging cable (proprietary Garmin clip) or note clearly if missing

SEARCH EACH SOURCE (visit the live page, do not rely on memory):
1. eBay: filter to "Refurbished" and "Used", prefer reputable sellers / high feedback / eBay Refurbished program
2. Back Market: https://www.backmarket.com/en-us/l/garmin-forerunner-watches
3. GPS Nation refurbished: https://www.gpsnation.com/collections/garmin-refurbished
4. Best Buy: refurbished/open-box listings
5. Facebook Marketplace and Craigslist (optional, note if inaccessible to automated search)
6. Garmin's own refurbished store if available: https://buy.garmin.com

PRICE TIERS (USD, before tax, include shipping in the compared total if not free):
- Forerunner 145 / 145 Music (new retail ~$200):
  - excellent: $70 or under
  - good: $70 – $100
  - acceptable: $100 – $120
  - over_budget: above $120 — still include true matches so the market is visible, but mark the tier
- Forerunner 245 / 245 Music (new retail ~$300):
  - excellent: $110 or under
  - good: $110 – $150
  - acceptable: $150 – $180
  - over_budget: above $180 — still include true matches so the market is visible, but mark the tier

Prefer lower risk: Garmin/manufacturer refurbished > Back Market / GPS Nation / Best Buy refurb > high-feedback eBay Refurbished > private used with photos and return window > private used no-returns.

Return TWO sections and nothing else after them:

## EMAIL_BODY
Plain text, ready to email. Start with a one-line summary (counts by tier, split by model if useful). Then list matching deals cheapest-first, each as:

- $PRICE | TIER | MODEL | SOURCE | CONDITION | seller
  URL
  one-line note (missing accessories / warranty / risk / why it is or isn't interesting)

Then a short "Near misses" section if useful (wrong model, sealed new, no charger, etc.) — max 5.
Then "Sources checked" with one line per source (ok / empty / blocked).

If zero matches, say so clearly and still include the cheapest near-misses and current typical used/refurb floor prices for each model.

## JSON
A single fenced ```json block with this exact shape:

{
  "generated_at": "<ISO-8601>",
  "listings": [
    {
      "id": "stable-id-from-url-or-sku",
      "source": "ebay|backmarket|gpsnation|bestbuy|garmin_refurb|facebook_marketplace|craigslist|other",
      "title": "",
      "url": "",
      "price": 0,
      "shipping": 0,
      "total": 0,
      "model": "Forerunner 145|Forerunner 145 Music|Forerunner 245|Forerunner 245 Music",
      "condition": "used|refurbished|open_box",
      "color": "",
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
    {"source": "ebay", "status": "ok|empty|blocked|error", "detail": ""}
  ]
}

Rules for JSON:
- listings[] contains ONLY matches (Forerunner 145/145 Music/245/245 Music, used or refurbished only)
- price/total are numbers, no $ or commas
- url must be a real http(s) link you observed
- Do not duplicate the same product URL
