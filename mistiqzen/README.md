# Mistiq Massage by Ivy Zen — Chiang Mai

**This is a separate project.** Like `/mistiq/`, it is NOT part of the AlpacApps/GenAlpaca property management system.
It is the Chiang Mai, Thailand branch of Mistique Journey (the Austin, Texas site lives at `/mistiq/`).
Exclude it from shared components, templates and packaged versions of this codebase, just like `/mistiq/`.

## Structure

- `index.html`, `th/index.html` — English and Thai home pages
- `book/`, `th/book/` — booking request (opens WhatsApp or email; no backend)
- `qr/` — printable QR code page pointing to `https://alpacaplayhouse.com/mistiqzen/?src=qr`
- `lang.js` — first visit: phones set to Thai (language `th` or region `TH`) go to `/th/`; an explicit flag choice (`?lang=en|th`) is remembered
- `site.js`, `book.js`, `lang-picker.js`, `styles.css` — own copies (forked from `/mistiq/`)
- `img/` — branch photos (AI-stylized to match the Mistiq illustration style)

## Branch facts

- Ivy Zen Massage, 63/2 Chediplong Rd, Tambon Chang Phueak, Mueang Chiang Mai 50300 — open daily 10:00–22:00
- Phone/WhatsApp 096 886 2601 · Facebook profile id 61592039963570 · email mistiqzen@alpacaplayhouse.com
- 2-hour Journey: ฿1,500, or free for Feedback Partners (detailed feedback + video testimonial + marketing help)
- Hot herbal compress replaces sauna; ice blanket replaces cold plunge

## Decisions

**Decision (2026-10-09):** The Chiang Mai program is about 2 hours (Grounding 15m, Somatics ~100m, Wind Down 10m, then open-ended Integration) at ฿1,500, with the same session free for Feedback Partners.
**Why:** Local pricing for Chiang Mai; free sessions buy detailed product feedback, video testimonials and marketing while the branch is new.

**Decision:** Austin testimonials are shown, labeled as Austin guests, with every reference to Rahul removed (omissions marked with … or [brackets]). Darcy's video is not embedded because it names Rahul; its relevant part is quoted as text.
**Why:** Ivy Zen is the Chiang Mai practitioner; the quotes describe the shared Mistique protocol, not her.

**Decision:** Booking is a static form that opens WhatsApp or email with a prefilled message, plus Facebook. No backend and no Austin calendar.
**Why:** WhatsApp and Facebook are how local customers book, and reusing the Austin form would send Chiang Mai requests to the Austin inbox.

**Decision:** Language routing uses the phone's language/region (`th`, or any `-TH` region), not the time zone.
**Why:** Tourists' phones switch to the Bangkok time zone automatically, so time zone can't tell a local from a visitor.
