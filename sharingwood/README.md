# /sharingwood/ — Sharingwood co-housing rentals (Snohomish, WA)

Public pages for Sharingwood rentals, served at https://alpacaplayhouse.com/sharingwood/.
Sharingwood is a separate entity from the Alpaca Playhouse (Cedar Creek, TX), so these
pages do not use the Playhouse nav/branding.

```
sharingwood/
  index.html                  Landing page: community overview + link to rentals
  shared/sharingwood.css      Styles shared by every page in this folder
  rentals/
    index.html                List of available units
    unit1b/
      index.html              Unit 1B listing (22003 E Lost Lake Rd #1B)
```

New unit: copy `rentals/unit1b/` to `rentals/<unitname>/`, upload its photos to
`rentals/<unitname>/` in the bucket, and add a card to `rentals/index.html`.

## Photos: R2 bucket `sharingwood` (not in git)

Images are kept out of the repo in their own Cloudflare R2 bucket, `sharingwood`
(AlpacApps Cloudflare account `9cd3a280…`). It is separate from the Playhouse's `alpacapps` bucket.

Public base URL: `https://pub-9ea612c4da1f40caa438c0c5d6529205.r2.dev/`

```
sharingwood (bucket)
  rentals/unit1b/
    large/       11 full-size JPGs (2400px), converted from the owner's iPhone HEICs.
                 img-6382 … img-6397 + basement-7 (same shot as img-6384)
    zillow/      01.jpg … 46.jpg, the Zillow listing photos in Zillow's order (384–1536px)
                 20, 35, 36, 38, 39 have full-size versions in large/
    originals/   all 49 files from the owner's zip, as received (incl. 10 .heic, which
                 browsers mostly can't show; keep them as masters)
```

**Uploading (anyone with access to the Bitwarden `DevOps-alpacapps` collection):**
the item **"Cloudflare R2 — sharingwood bucket (read-write)"** holds S3 keys that can read
and write this bucket only; they are refused on every other bucket.

```bash
export AWS_ACCESS_KEY_ID=$(bw get username "Cloudflare R2 — sharingwood bucket (read-write)")
export AWS_SECRET_ACCESS_KEY=$(bw get password "Cloudflare R2 — sharingwood bucket (read-write)")
export AWS_DEFAULT_REGION=auto AWS_ENDPOINT_URL=https://9cd3a280a54ce2a5b382602f0247b577.r2.cloudflarestorage.com
aws s3 cp photo.jpg s3://sharingwood/rentals/unit1b/large/photo.jpg --content-type image/jpeg
aws s3 ls s3://sharingwood/rentals/unit1b/ --recursive
```

## Unit 1B facts (from the Zillow listing, 2026-11-15)

Source: https://www.zillow.com/homedetails/22003-E-Lost-Lake-Rd-1B-Snohomish-WA-98296/465086293_zpid/

- $1,595/mo, 12-month standard WA lease, deposit $1,595, available Nov 16 2026
- Lower unit of a modern single-family home; 1 large bedroom + smaller room, 1 bath, 1,200 sqft
- Fully furnished (dishware, linens, sound system), hardwood floors, large windows, forced-air heat
- Patio; 3-person sauna; lots of cupboards/closets; large storage room
- Bosch washer + electric dryer in unit; dishwasher, oven, fridge
- Parking for 2 cars (tandem); fast internet; Alexa-connected sound system
- Upstairs occupied by a couple
- Utilities: tenant pays 30% by usage, ~$175/mo yearly average (more in winter)
- HOA fee listed: $59/mo
- No smoking. No cats. Dogs only with upstairs tenants' agreement + $350 non-refundable cleaning fee
- Community: one of WA's oldest co-housing communities; common house, play field, greenbelt
  with trails and creeks; non-religious, engagement-focused
- Schools: Maltby Elem (3.1 mi), Hidden River Middle (3.3 mi), Monroe High (3.5 mi)

When you change shared/sharingwood.css, bump the `?v=N` on its <link> in every page (browsers cache it for 10 min).
