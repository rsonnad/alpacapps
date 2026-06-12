# Page Linking & SEO — Reference for AlpacApps

How to publish a new page on `alpacaplayhouse.com` so people (and Google) can find it. Distilled from real indexing experience on the site.

---

## TL;DR — the publishing checklist

When you ship a new public page (e.g. `rahulio/pages/some-new-page.html`):

1. **Filename: kebab-case, descriptive, with the searchable terms.** `chelsae-zirna-jacket-theft.html` ranks far better than `cheasejackettheft.html` for searches of the subject's name. Hyphens are word separators to Google; concatenated words aren't.
2. **Set canonical + OG + JSON-LD meta tags** (templates below).
3. **Add it to `sitemap.xml`** so Google can discover it.
4. **Run `node scripts/rahulio-pages-manifest.js`** to regenerate the static link list at `rahulio/pages/index.html`. This is the most important link-equity step — see below.
5. **Use `initPublicPage()` for indexed pages.** Do not leave sitemap pages behind `initPersonalPage()`; personal pages default open, but an explicit access row can still hide them.
6. **Run `npm run public-pages:audit`** before pushing. It checks `sitemap.xml`, `rahulio/pages/pages-manifest.json`, the static pages index, page robots tags, and live `page_access_settings` rows.
7. **Add at least one in-context link** from a related, already-indexed page (e.g. a "Related" callout). One contextual link beats five low-context ones.
8. **(Optional)** Submit to Bing Webmaster Tools for fast non-Google coverage.
9. **Push, wait for CI, verify HTTP 200 on the live URL.**

That's the floor. Everything below is rationale, the priority order of link types, and what to do when a page sits in "Discovered, not indexed" purgatory.

---

## How indexing actually works on this site

The site is static HTML on GitHub Pages. There is no server-side anything. So the levers we have are:

| Lever | Mechanism | Effect on Google |
|---|---|---|
| **`sitemap.xml`** | Google's primary discovery feed for the site | Tells Google a URL exists. Necessary, not sufficient. |
| **Internal `<a>` links** from other indexed pages | Standard HTML hyperlink graph | Strongest in-our-control signal that the page is worth crawling. |
| **External links** to the page (X, Reddit, HN, blogs) | Off-domain referring pages | Strongest signal overall, *if* the linking context is dofollow. X is `nofollow ugc`, so heavily discounted. |
| **Open Graph / JSON-LD** | Per-page metadata | Doesn't directly cause indexing. Improves how the page renders when shared (X cards, search snippets) and helps Google parse the content type. |
| **GSC Request Indexing button** | Manual nudge | Marginal at best. Silent ~10/day quota. Often errors with "Oops! Something went wrong." Don't rely on it. |

**Counterintuitive fact we learned the hard way:** a JS-rendered link list is much weaker than a static `<a>` link list. Even though Googlebot does render JavaScript, it's a deferred second-pass crawl and the link signal is heavily discounted. **Always prefer static `<a>` over JS-rendered.**

---

## The pages-index — `rahulio/pages/index.html`

This page is the central hub of internal links to everything in `rahulio/pages/`. It gets the most Google authority of any rahulio page over time. **Every new page you publish should appear in this index, as a static `<a>` link, on the day it ships.**

How it works:

- The list of pages lives in `rahulio/pages/pages-manifest.json`.
- `scripts/rahulio-pages-manifest.js` reads the manifest and writes a static `<ul class="pages-list">…</ul>` block into `rahulio/pages/index.html` between the `<!-- BEGIN_STATIC_PAGES_LIST -->` and `<!-- END_STATIC_PAGES_LIST -->` markers.
- The page also has a JS fallback that renders from the same manifest if the static block is missing — but the static block is what Google actually sees and counts as link equity.

**Workflow when adding a new page:**

```bash
# 1. Add your new page file
$EDITOR rahulio/pages/some-new-page.html

# 2. Update the manifest
$EDITOR rahulio/pages/pages-manifest.json
# add an entry like:
# { "path": "some-new-page.html", "title": "Some New Page", "section": "Projects", "modifiedAt": "2026-05-07T00:00:00.000Z" }

# 3. Regenerate the static block
node scripts/rahulio-pages-manifest.js

# 4. Verify the static <a> appears in rahulio/pages/index.html
grep "some-new-page.html" rahulio/pages/index.html

# 5. Add it to sitemap.xml (see template below)

# 6. Verify public access + SEO pointers
npm run public-pages:audit

# 7. Commit + push — CI deploys to GitHub Pages
```

If a page is listed in the JSON manifest but **not** showing up as a static `<a>` in `rahulio/pages/index.html`, the regen script wasn't run. Run it.

---

## `sitemap.xml` template entry

Add to `/sitemap.xml` (in repo root). One block per public URL:

```xml
<url>
  <loc>https://alpacaplayhouse.com/rahulio/pages/some-new-page.html</loc>
  <lastmod>2026-05-07</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
```

- `<loc>` — full canonical URL with `https://`. Don't use relative paths.
- `<lastmod>` — `YYYY-MM-DD`. Update this when the page changes substantively.
- `<changefreq>` — `weekly` is fine for most pages. Use `daily` for pages that genuinely change daily, `monthly` for rarely-updated reference pages.
- `<priority>` — `0.5` default, `0.8` for important pages, `1.0` for the homepage. Google mostly ignores this in practice.

After updating the sitemap, re-submit it once via GSC: **Sitemaps → enter `sitemap.xml` → Submit.** Google re-fetches it daily after that.

---

## Per-page meta tag templates

These go in `<head>`. Copy-paste, then change the URL/title/description.

### Required minimum

```html
<title>Page Title — Site Name</title>
<meta name="description" content="One-sentence summary of the page in 150 chars or less. This shows up in Google search results.">
<link rel="canonical" href="https://alpacaplayhouse.com/path/to/page.html">
<meta name="robots" content="index, follow">
```

### Open Graph (X/Twitter, Facebook, LinkedIn cards)

```html
<meta property="og:type" content="article">
<meta property="og:title" content="Page Title">
<meta property="og:description" content="One-sentence summary.">
<meta property="og:url" content="https://alpacaplayhouse.com/path/to/page.html">
<meta property="og:site_name" content="alpacaplayhouse.com">
<meta property="article:published_time" content="2026-05-07">
<meta property="article:author" content="Rahul Sonnad">

<!-- Twitter Card variant — use summary_large_image when you have an og:image -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Page Title">
<meta name="twitter:description" content="One-sentence summary.">
```

### Optional banner image (for social cards)

If you want a hero image to appear on X/LinkedIn cards:

```html
<meta property="og:image" content="https://alpacaplayhouse.com/path/to/hero.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

Image should be **1200×630 px** (Twitter/Open Graph standard). Save as JPG/PNG to a sibling `assets/` folder.

### JSON-LD structured data

Helps Google understand the page type. Drop this in `<head>` for any article-like page:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Page Title",
  "datePublished": "2026-05-07",
  "dateModified": "2026-05-07",
  "author": { "@type": "Person", "name": "Rahul Sonnad", "url": "https://alpacaplayhouse.com/rahulio/" },
  "publisher": { "@type": "Person", "name": "Rahul Sonnad", "url": "https://alpacaplayhouse.com/rahulio/" },
  "url": "https://alpacaplayhouse.com/path/to/page.html"
}
</script>
```

Use `"@type": "ReportageNewsArticle"` for documented complaints/disputes, `"@type": "TechArticle"` for technical writeups, `"@type": "BlogPosting"` for general writing.

---

## Link signal hierarchy (what actually moves the needle)

In rough order of effect on Google indexing:

1. **Static `<a>` from a high-traffic indexed page on the same domain** (e.g. site root, or `rahulio/pages/index.html`). This is what `scripts/rahulio-pages-manifest.js` gives us automatically.
2. **Static `<a>` in body context from another related indexed page on the same domain** (e.g. the "Related case" callout we added from `rachelcarrental.html` to `chelsae-zirna-jacket-theft.html`). Contextual placement matters — a link inside relevant prose passes more equity than a link in a sidebar.
3. **External link from a heavily-crawled, dofollow site** — Hacker News, Reddit (most subreddits), high-authority blogs, news sites. Single biggest accelerator if you can get one.
4. **External link from a partial-credit site** — X/Twitter (`rel="nofollow ugc"`), LinkedIn posts, most social platforms. Counts for discovery but heavily discounted for ranking.
5. **`sitemap.xml` entry alone** — necessary but not sufficient. Pages can sit in "Discovered, not indexed" for weeks with only a sitemap entry.
6. **JS-rendered `<a>`** — Google does render JS, but slower and with less weight. Avoid as primary link mechanism.

---

## Diagnosing "Discovered, currently not indexed"

This is the most common holding state for new pages on smaller-authority domains. It means: *Google knows the URL exists (saw it in the sitemap or via a referring link) but hasn't decided to spend crawl budget on it yet.*

**Normal time-to-resolve:** 3–14 days on alpacaplayhouse.com authority level.

**Things that move pages out of this state, in order of effectiveness:**

1. Add a dofollow internal link from an already-indexed page. **Cheapest win.**
2. Get a single external dofollow link (Reddit comment, HN submission, blog mention).
3. Click "Request Indexing" in GSC URL Inspection. Marginal but free. Daily quota ~10 requests; the button will silently fail (`Oops! Something went wrong`) once you hit it.
4. Wait. The natural crawl will happen.

**Things that don't help:**

- Repeatedly clicking Request Indexing. You're capped.
- Re-submitting the sitemap. One submission is enough.
- Editing the page repeatedly. Doesn't change discovery dynamics.

**Things that hurt:**

- Renaming/moving the URL after it's been discovered. Google has to re-discover, and the old paths sit in the queue as 404s for ~1 week. **Pick the final URL before publishing.**
- Submitting old/redirected URLs to GSC. Wasted quota.
- Mass-submitting many URLs at once via Request Indexing. Burns the daily quota with no commensurate benefit.

---

## GSC URL Inspection — how to read the report

When inspecting `https://alpacaplayhouse.com/some/page.html`:

| Status | Meaning | Action |
|---|---|---|
| **URL is on Google** | Indexed and serveable in search | Done. |
| **Discovered – currently not indexed** | Found via sitemap or referring link, not yet crawled | Add an inbound link, or wait. |
| **Crawled – currently not indexed** | Crawled, Google chose not to index | Usually a quality/duplicate-content signal. Check `Page indexing → Why pages aren't indexed`. |
| **Page with redirect** | Page redirects to another URL | Make sure the destination is the canonical and is itself indexed. |
| **Not found (404)** | URL doesn't exist | If unintended, fix the link/file. If intended (deleted), Google drops it from the queue within ~1 week. |
| **Blocked by robots.txt** | Excluded by `/robots.txt` | Either intended or a bug. Check `/robots.txt`. |

**Daily Request Indexing quota:** ~10–12 URLs per property per day. Silent. The "Oops! Something went wrong" error message is what Google returns for both transient backend issues *and* quota exhaustion — they don't differentiate. If the button keeps erroring after 2–3 attempts in a session, you've almost certainly hit the cap. Wait 24h.

**Tip:** Click `TEST LIVE URL` (top-right of the inspection panel) before clicking `Request Indexing`. The live test sometimes succeeds when the cached one fails.

---

## External link strategies — fastest discovery routes

Ranked by speed-to-Google-crawl after posting:

1. **Hacker News submission** — usually crawled within minutes. Dofollow.
2. **Reddit comment or post** in any active subreddit — typically crawled within an hour. Dofollow on most subs.
3. **Bluesky post** — crawled within hours, dofollow.
4. **A blog comment on an already-indexed blog** — varies, sometimes hours.
5. **LinkedIn post** — crawled within hours, partial credit.
6. **X/Twitter post** — crawled within hours but `rel="nofollow ugc"` on outbound links → discovery only, weak ranking signal.
7. **Bing Webmaster Tools → Submit URL** — Bing/DuckDuckGo/Yahoo within hours. Doesn't directly help Google but gets you searchable on the rest of the web.

**A single quality inbound link beats 20 low-quality ones.** Don't spam.

---

## When to NOT do SEO

Some pages on the site are intentionally not for Google:

- Internal admin tools (`spaces/admin/*`)
- Test/staging pages
- Pages with sensitive context (rental disputes during ongoing negotiation, guest names, etc.)

For those, opt out:

```html
<meta name="robots" content="noindex, nofollow">
```

And don't add them to `sitemap.xml` or the pages-index.

---

## Real-world reference: `chelsae-zirna-jacket-theft.html` (May 2026)

Shipped May 2026 as a documented complaint page. Took ~5 days from publish to "Discovered, not indexed → Indexed" because:

- ✅ Filename used the subject's full name kebab-cased
- ✅ Full canonical/OG/JSON-LD meta block
- ✅ Added to sitemap.xml
- ✅ Added to `rahulio/pages/pages-manifest.json` and regenerated static index
- ✅ In-context "Related case" link added from `rachelcarrental.html`
- ⚠️ Initial filename was a typo (`cheasejackettheft.html`) which had to be renamed twice — caused 3 lingering 404 entries in GSC for a week
- ⚠️ X post was the first external link but `rel="nofollow ugc"` discounted the signal
- ⚠️ GSC Request Indexing repeatedly returned "Oops" — daily quota exhausted

**Lesson:** pick the final URL slug before publishing. Renames cost a week.

---

## Quick reference — files involved

| File | Purpose |
|---|---|
| `sitemap.xml` | Google discovery feed for the whole site |
| `rahulio/pages/index.html` | Static link list of all rahulio pages — primary internal-link surface |
| `rahulio/pages/pages-manifest.json` | Source of truth for what's in the static link list |
| `scripts/rahulio-pages-manifest.js` | Regenerator — run after manifest changes |
| `robots.txt` (repo root, if present) | Crawl rules |
| GSC: https://search.google.com/search-console | Inspection, sitemap submission, indexing requests |
| Bing WMT: https://www.bing.com/webmasters | Bing/DDG/Yahoo submission |

---

*Last updated: 2026-05-07. Based on indexing experience with `chelsae-zirna-jacket-theft.html` and prior pages.*
