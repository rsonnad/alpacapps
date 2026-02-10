# CLAUDE.md - GenAlpaca Project Context

> **See `CLAUDE.local.md` for credentials, connection strings, and environment-specific configuration.**

## Reference Index (read on-demand, not loaded automatically)

| File | When to read |
|------|-------------|
| `docs/claude/database-schema.md` | Working with DB tables, writing queries or migrations |
| `docs/claude/edge-functions.md` | Creating/deploying/modifying edge functions |
| `docs/claude/external-systems.md` | Working with any external API integration |
| `docs/claude/api-cost-accounting.md` | Building features that call paid APIs |
| `docs/claude/file-map.md` | Need to locate files in the codebase |
| `docs/claude/changelog.md` | Need context on recent feature additions |

## Excluded: `/mistiq/`

The `/mistiq/` directory is a **separate, unrelated project** (Mistiq Staffing). Do NOT include it in shared components or apply AlpacApps styles to it.

## Project Overview

GenAlpaca is a property management system for GenAlpaca Residency. Manages rental spaces, tenants, bookings, payments, and photos.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework) | Capacitor 8 mobile | Supabase backend | GitHub Pages hosting | OpenClaw Discord bot on DO droplet

```
Browser -> GitHub Pages (static HTML/JS) --> Supabase (DB + storage + edge functions)
Discord -> OpenClaw Bot (DO Droplet) ------/
Mobile  -> Capacitor App (iOS/Android) ---/  (same shared/ code as web)
```

No server-side code - all logic runs client-side. Supabase handles data persistence.

## Important Conventions

1. **Use `media_spaces` not `photo_spaces`** - The old photo system is deprecated
2. **Filter archived spaces** - Always add `.filter(s => !s.is_archived)` client-side
3. **Don't expose personal info in consumer view** - Load assignment dates only, not person details
4. **Toast notifications in admin** - Use `showToast(message, type)` not `alert()`
5. **Lightbox for images** - Use `openLightbox(url)` for full-size image viewing
6. **API cost logging** - Every external API call MUST log to `api_usage_log` (see `docs/claude/api-cost-accounting.md`)

## Common Patterns

### Fetching Spaces with Media
```javascript
const { data } = await supabase
  .from('spaces')
  .select(`*, media_spaces(display_order, is_primary, media:media_id(id, url, caption))`)
  .eq('can_be_dwelling', true)
  .order('monthly_rate', { ascending: false, nullsFirst: false });
```

### Computing Availability
```javascript
const { data: assignments } = await supabase
  .from('assignments')
  .select('id, start_date, end_date, desired_departure_date, desired_departure_listed, status, assignment_spaces(space_id)')
  .in('status', ['active', 'pending_contract', 'contract_sent']);

// Only use desired_departure_date if desired_departure_listed is true
const effectiveEndDate = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
```

### Uploading Media
```javascript
import { mediaService } from '../shared/media-service.js';
const media = await mediaService.uploadMedia(file, { category: 'mktg', caption: 'Room photo' });
await mediaService.linkMediaToSpace(media.id, spaceId, displayOrder);
```

### Sending SMS
```javascript
import { smsService } from '../shared/sms-service.js';
await smsService.sendPaymentReminder(tenant, amount, dueDate, period);
await smsService.sendGeneral(tenant, "Your package arrived.");
await smsService.sendBulk('bulk_announcement', recipients, { message: "..." });
```

### Adding a New Mobile Tab
```javascript
// mobile/app/tabs/example-tab.js
import { ExampleService } from '../../../shared/services/example-data.js';
import { PollManager } from '../../../shared/services/poll-manager.js';
let poll;
export async function init(appUser) {
  const container = document.getElementById('exampleContent');
  poll = new PollManager(() => refreshData(), 30000);
  poll.start();
}
```

### Building Mobile App
```bash
cd mobile && npm run sync          # Full rebuild + sync both platforms
npm run sync:ios                   # iOS only
npm run open:ios                   # Open Xcode
```

## Sorting & Display Rules

- **Consumer view**: Available first -> highest price -> name alphabetically
- **Admin view**: Highest price -> name
- **Availability**: "Available: NOW" | "Available: Mar 15" | "Available: TBD"

## Deployment

GitHub Pages from `main` branch. No build step, no PR process - push to main and it's live.

**Version** is bumped automatically by GitHub Action on every push to main. Format: `vYYMMDD.NN`.

```bash
git add -A && git commit -m "message" && ./scripts/push-main.sh
```

### REQUIRED: Display Version in Chat

**You MUST display the current public version string in every response where you make code changes or deploy.** Read from `version.json` or `bump-version.sh` output. Format: `vYYMMDD.NN H:MMa/p [model]`

### REQUIRED: Post-Push Status Message

**If pushed to `main`:**
> **Deployed to main** -- GitHub Action will bump version. Test: https://alpacaplayhouse.com/residents/laundry.html

**If pushed to feature branch:**
> **Pushed to `claude/branch-name`** (not yet deployed) `[model]`
> Changed files: `list`
> To deploy: merge to main

**Common URLs:**
- Resident: `https://alpacaplayhouse.com/residents/{page}.html` (cameras, climate, lighting, sonos, laundry, cars)
- Admin: `https://alpacaplayhouse.com/spaces/admin/{page}.html` (spaces, rentals, settings, templates, users, sms-messages)
- Public: `https://alpacaplayhouse.com/spaces/`, `https://alpacaplayhouse.com/`

## Supabase Details

- Anon key in `shared/supabase.js` (safe to expose, RLS protects data)
- Storage buckets: `housephotos` (media), `lease-documents` (PDFs)
- External storage: Cloudflare R2 bucket `alpacapps` for documents/manuals

## Testing Changes

1. Check both card and table views in consumer and admin
2. Test on mobile web (responsive breakpoint at 768px)
3. Verify availability badges show correct dates
4. **Mobile app**: After changing `shared/services/` or `mobile/app/` files, rebuild with `cd mobile && npm run sync`
5. **Mobile app login**: Test both email/password and Google Sign In on both platforms
