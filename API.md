# GenAlpaca API Documentation

API reference for OpenClaw and other integrations to interact with the GenAlpaca property management system.

## Base Configuration

```
SUPABASE_URL: https://aphrrfprbixmhissnjfn.supabase.co
SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk
STORAGE_BUCKET: housephotos
```

All requests require these headers:
```
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {SUPABASE_ANON_KEY}
Content-Type: application/json
```

---

## Photo Management

### Upload a Photo

**Step 1: Upload image to storage**

```
POST https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/housephotos/{space_id}/{filename}
Content-Type: image/jpeg (or image/png, image/webp)

{binary image data}
```

Example filename: `550e8400-e29b-41d4-a716-446655440000/1706745600000.jpg`

**Step 2: Get the public URL**

```
https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/{space_id}/{filename}
```

**Step 3: Create photo record**

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photos
Content-Type: application/json
Prefer: return=representation

{
  "url": "https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/{space_id}/{filename}",
  "caption": "View from the bed",
  "uploaded_by": "openclaw"
}
```

Response includes `id` of new photo record.

**Step 4: Link photo to space**

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photo_spaces
Content-Type: application/json

{
  "photo_id": "{photo_id from step 3}",
  "space_id": "{space_id}"
}
```

### Delete a Photo

```
DELETE https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photos?id=eq.{photo_id}
```

Storage cleanup:
```
DELETE https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/housephotos/{path}
```

### List Photos for a Space

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photo_spaces?space_id=eq.{space_id}&select=photo:photo_id(id,url,caption)
```

---

## Spaces

### List All Spaces

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?select=*
```

### List Dwelling Spaces Only

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?can_be_dwelling=eq.true&select=*
```

### List Available Spaces (Listed, Not Secret)

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?is_listed=eq.true&is_secret=eq.false&select=*
```

### Get Space with Amenities and Photos

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?id=eq.{space_id}&select=*,space_amenities(amenity:amenity_id(name)),photo_spaces(photo:photo_id(url,caption))
```

### Get Space by Name

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?name=eq.Skyloft&select=*
```

### Update Space

```
PATCH https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?id=eq.{space_id}
Content-Type: application/json

{
  "monthly_rate": 1200,
  "description": "Updated description"
}
```

---

## People

### List All People

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/people?select=*
```

### List Tenants Only

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/people?type=eq.tenant&select=*
```

### Create a Person

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/people
Content-Type: application/json
Prefer: return=representation

{
  "first_name": "John",
  "last_name": "Doe",
  "type": "tenant",
  "email": "john@example.com",
  "phone": "+1 555-123-4567"
}
```

### Find Person by Name

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/people?first_name=eq.John&last_name=eq.Doe&select=*
```

---

## Assignments (Bookings/Leases)

### List Active Assignments

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignments?status=eq.active&select=*,person:person_id(first_name,last_name,email),assignment_spaces(space_id)
```

### List Future Assignments

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignments?status=in.(active,pending_contract,contract_sent)&select=*,person:person_id(first_name,last_name),assignment_spaces(space:space_id(name))
```

### Create Assignment

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignments
Content-Type: application/json
Prefer: return=representation

{
  "person_id": "{person_uuid}",
  "type": "dwelling",
  "status": "active",
  "start_date": "2026-03-01",
  "end_date": "2026-06-01",
  "rate_amount": 800,
  "rate_term": "monthly",
  "deposit_amount": 800,
  "is_free": false
}
```

### Link Assignment to Space

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignment_spaces
Content-Type: application/json

{
  "assignment_id": "{assignment_uuid}",
  "space_id": "{space_uuid}"
}
```

### Update Assignment Status

```
PATCH https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignments?id=eq.{assignment_id}
Content-Type: application/json

{
  "status": "completed"
}
```

---

## Photo Requests

### List Pending Photo Requests

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photo_requests?status=eq.pending&select=*,space:space_id(name)
```

### Create Photo Request

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photo_requests
Content-Type: application/json

{
  "space_id": "{space_uuid}",
  "description": "Photo of the outdoor bathroom",
  "status": "pending",
  "requested_by": "openclaw"
}
```

### Fulfill Photo Request

After uploading a photo:

```
PATCH https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/photo_requests?id=eq.{request_id}
Content-Type: application/json

{
  "status": "approved",
  "fulfilled_by_photo_id": "{photo_uuid}",
  "reviewed_at": "2026-02-01T12:00:00Z"
}
```

---

## Amenities

### List All Amenities

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/amenities?select=*
```

### Get Amenities for a Space

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/space_amenities?space_id=eq.{space_id}&select=amenity:amenity_id(name,description)
```

---

## Payments

### Record a Payment

```
POST https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/payments
Content-Type: application/json

{
  "assignment_id": "{assignment_uuid}",
  "amount": 800.00,
  "payment_date": "2026-02-01",
  "payment_method": "venmo",
  "period_start": "2026-02-01",
  "period_end": "2026-02-28",
  "notes": "February rent"
}
```

### List Payments for Assignment

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/payments?assignment_id=eq.{assignment_id}&select=*&order=payment_date.desc
```

---

## Common Queries

### Get Current Occupancy

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/assignments?status=eq.active&select=*,person:person_id(first_name,last_name,type),assignment_spaces(space:space_id(name,monthly_rate))
```

### Find Available Spaces (No Active Assignment)

This requires application logic - fetch all dwelling spaces and all active assignments, then filter.

### Get Space with Full Details

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/spaces?id=eq.{space_id}&select=*,parent:parent_id(name),space_amenities(amenity:amenity_id(name)),photo_spaces(photo:photo_id(url,caption))
```

---

## Error Handling

Supabase returns standard HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request (check your JSON)
- `401` - Unauthorized (check API key)
- `404` - Not found
- `409` - Conflict (duplicate key)
- `500` - Server error

Error response format:
```json
{
  "code": "PGRST116",
  "details": null,
  "hint": null,
  "message": "The result contains 0 rows"
}
```

---

## Rate Limits

Supabase free tier: ~500 requests/day
Pro tier: Much higher, usually not a concern

---

## Smart Payment Recording (Edge Functions)

These Edge Functions use AI to intelligently match payments to tenants. The system learns sender names over time, so subsequent payments from the same sender skip AI matching.

### Record Payment with Auto-Matching

**Endpoint:**
```
POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/record-payment
Content-Type: application/json
```

**Request:**
```json
{
  "name": "KYMBERLY DELIOU",
  "payment_string": "02/02/2026\nCREDIT\nZELLE FROM KYMBERLY DELIOU$1,195.00$7,965.45",
  "source": "openclaw",
  "force_gemini": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | Sender name (extracted from payment_string if not provided) |
| payment_string | string | Yes | Raw bank transaction text |
| source | string | No | Source identifier (default: "openclaw") |
| force_gemini | boolean | No | Skip cache and force AI matching (default: false) |

**Success Response (200):**
```json
{
  "success": true,
  "payment_id": "uuid",
  "match_method": "cached|exact|gemini",
  "matched_tenant": {
    "id": "person-uuid",
    "name": "Kymberly Deliou"
  },
  "parsed_payment": {
    "amount": 1195.00,
    "date": "2026-02-02",
    "method": "zelle"
  }
}
```

**Needs Review Response (200):**
```json
{
  "success": false,
  "requires_review": true,
  "pending_id": "uuid",
  "parsed_payment": {
    "amount": 1195.00,
    "date": "2026-02-02",
    "method": "zelle"
  },
  "suggestions": [
    {
      "person_id": "uuid",
      "name": "Kym Deliou",
      "confidence": 0.72,
      "reasoning": "Similar first name, matching rent amount"
    }
  ],
  "reasoning": "Low confidence match, requires manual review"
}
```

**Match Methods:**
- `cached` - Found in saved sender mappings (instant, no AI)
- `exact` - Exact name match with tenant (instant, no AI)
- `gemini` - AI matched with ≥85% confidence

### Resolve Pending Payment

**Endpoint:**
```
POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/resolve-payment
Content-Type: application/json
```

**Request (Match):**
```json
{
  "pending_id": "uuid",
  "person_id": "person-uuid",
  "assignment_id": "assignment-uuid",
  "action": "match",
  "save_mapping": true,
  "resolved_by": "admin"
}
```

**Request (Ignore):**
```json
{
  "pending_id": "uuid",
  "action": "ignore",
  "resolved_by": "admin"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pending_id | string | Yes | ID of pending payment to resolve |
| action | string | Yes | "match" or "ignore" |
| person_id | string | For match | Tenant to match payment to |
| assignment_id | string | For match | Assignment to record payment against |
| save_mapping | boolean | No | Save name mapping for future (default: true) |
| resolved_by | string | No | Who resolved it (default: "admin") |

**Success Response:**
```json
{
  "success": true,
  "payment_id": "uuid",
  "mapping_saved": true
}
```

### List Pending Payments

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/pending_payments?resolved_at=is.null&select=*
```

### List Sender Mappings

```
GET https://aphrrfprbixmhissnjfn.supabase.co/rest/v1/payment_sender_mappings?select=*,person:person_id(first_name,last_name)
```

---

## Web UI

Admin interface: https://alpacaplayhouse.com/

Click "Enter Admin" to access upload and management features.
