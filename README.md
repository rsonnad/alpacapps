# AlpacApps Ops

Property management UI for AlpacApps Residency.

## Setup

1. Get your Supabase anon key:
   - Go to Supabase Dashboard > Settings > API
   - Copy the `anon` `public` key

2. Edit `app.js` line 3:
   ```js
   const SUPABASE_ANON_KEY = 'your-key-here';
   ```

3. Deploy to GitHub Pages:
   - Push to repo
   - Settings > Pages > Source: main branch, / (root)
   - Your site will be at https://alpacaplayhouse.com/

## Features

### Consumer View
- Card and table layouts
- Filter by price, bathroom type, availability
- View space details and photos

### Admin View (click "Enter Admin")
- See all spaces including unlisted and secret
- View current occupants, lease dates, rates
- Request photos for spaces
- Filter by visibility status

## Stack
- Vanilla HTML/CSS/JS
- Supabase JS client (CDN)
- No build step required

## Database

Connected to Supabase project: `aphrrfprbixmhissnjfn`

Tables used:
- `spaces` - dwelling units and event spaces
- `people` - tenants, staff, guests
- `assignments` - bookings/leases
- `assignment_spaces` - links assignments to spaces
- `photos` / `photo_spaces` - space images
- `photo_requests` - pending photo requests
