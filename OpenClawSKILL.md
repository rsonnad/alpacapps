# GenAlpaca Property Management Skill

Manage the GenAlpaca Residency property system - spaces, tenants, photos, and bookings.

## Configuration

```
SUPABASE_URL: https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk
STORAGE_BUCKET: housephotos
```

Headers for all requests:
```
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {SUPABASE_ANON_KEY}
Content-Type: application/json
```

## Capabilities

### Spaces
- List all rental spaces with rates, amenities, availability
- Check which spaces are available now or in a date range
- Update space details (rates, descriptions)

### Occupancy
- Show who's living in each space
- Show lease end dates and upcoming vacancies
- Create new bookings/assignments

### Photos
- Upload photos to spaces
- Fulfill photo requests
- List photos for a space

### Tenants
- Look up tenant info
- Add new tenants
- Track payments

## Common Commands

### "What spaces are available?"
```
GET /rest/v1/spaces?can_be_dwelling=eq.true&is_listed=eq.true&select=id,name,monthly_rate
```
Then check active assignments to filter occupied ones.

### "Who lives in [space]?"
```
GET /rest/v1/spaces?name=ilike.*{space}*&select=id,name
```
Then:
```
GET /rest/v1/assignment_spaces?space_id=eq.{id}&select=assignment:assignment_id(status,start_date,end_date,person:person_id(first_name,last_name,email,phone))
```

### "Show current occupancy"
```
GET /rest/v1/assignments?status=eq.active&select=*,person:person_id(first_name,last_name),assignment_spaces(space:space_id(name))
```

### "Upload a photo to [space]"

1. Get space ID:
```
GET /rest/v1/spaces?name=ilike.*{space}*&select=id,name
```

2. Upload to storage:
```
POST /storage/v1/object/housephotos/{space_id}/{timestamp}.jpg
Content-Type: image/jpeg
{binary data}
```

3. Create photo record:
```
POST /rest/v1/photos
{"url": "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/{space_id}/{timestamp}.jpg", "caption": "{caption}", "uploaded_by": "openclaw"}
```
Returns: `{"id": "{photo_id}"}`

4. Link to space:
```
POST /rest/v1/photo_spaces
{"photo_id": "{photo_id}", "space_id": "{space_id}"}
```

### "Add a booking for [person] in [space] from [date] to [date]"

1. Find or create person:
```
GET /rest/v1/people?first_name=ilike.*{first}*&last_name=ilike.*{last}*&select=id
```
If not found:
```
POST /rest/v1/people
{"first_name": "{first}", "last_name": "{last}", "type": "tenant"}
```

2. Get space:
```
GET /rest/v1/spaces?name=ilike.*{space}*&select=id,monthly_rate
```

3. Create assignment:
```
POST /rest/v1/assignments
Prefer: return=representation
{"person_id": "{person_id}", "type": "dwelling", "status": "contract_sent", "start_date": "{start}", "end_date": "{end}", "rate_amount": {rate}, "rate_term": "monthly", "is_free": false}
```

4. Link to space:
```
POST /rest/v1/assignment_spaces
{"assignment_id": "{assignment_id}", "space_id": "{space_id}"}
```

### "What photo requests are pending?"
```
GET /rest/v1/photo_requests?status=eq.pending&select=*,space:space_id(name)
```

### "Record payment of $X from [person]"

1. Find person's active assignment:
```
GET /rest/v1/people?first_name=ilike.*{name}*&select=id
GET /rest/v1/assignments?person_id=eq.{id}&status=eq.active&select=id
```

2. Record payment:
```
POST /rest/v1/payments
{"assignment_id": "{id}", "amount": {amount}, "payment_date": "{today}", "payment_method": "venmo"}
```

## Database Schema Reference

### spaces
- `id` (uuid), `name`, `description`, `location`
- `monthly_rate`, `weekly_rate`, `nightly_rate`
- `sq_footage`, `bath_privacy`, `bath_fixture`
- `beds_king`, `beds_queen`, `beds_double`, `beds_twin`
- `min_residents`, `max_residents`, `gender_restriction`
- `is_listed`, `is_secret`, `can_be_dwelling`, `can_be_event`
- `parent_id` (references spaces)

### people
- `id` (uuid), `first_name`, `last_name`
- `type` (tenant, staff, airbnb_guest, house_guest)
- `email`, `phone`, `forwarding_address`

### assignments
- `id` (uuid), `person_id`, `type` (dwelling, event)
- `status` (active, completed, cancelled, pending_contract, contract_sent)
- `start_date`, `end_date`
- `rate_amount`, `rate_term` (monthly, weekly, nightly, flat)
- `deposit_amount`, `is_free`

### assignment_spaces
- `assignment_id`, `space_id` (junction table)

### photos
- `id` (uuid), `url`, `caption`, `uploaded_by`

### photo_spaces
- `photo_id`, `space_id` (junction table)

### payments
- `id` (uuid), `assignment_id`, `amount`
- `payment_date`, `payment_method`
- `period_start`, `period_end`, `notes`

## Web UI

Admin interface: https://alpacaplayhouse.com/

Features:
- View all spaces with availability windows
- Filter by price, bathroom, availability
- Admin mode shows occupants and lease details
- Upload photos directly
- Request photos (creates pending request)
