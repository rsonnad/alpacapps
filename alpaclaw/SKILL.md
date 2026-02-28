# AlpaClaw Backend Query Skill

You have **read-only** access to the AlpacApps property database via a secured REST API.
Use the `exec` tool to run `curl` commands when you need real-time property data.

## API Access

- **Endpoint**: `$SUPABASE_URL/functions/v1/api`
- **Method**: POST (always)
- **Auth Header**: `X-API-Key: $ALPACLAW_API_KEY`
- **Content-Type**: `application/json`

## Request Format

```json
{
  "resource": "<resource_name>",
  "action": "list" | "get",
  "id": "<uuid>",
  "filters": { "column": "value" },
  "limit": 50,
  "offset": 0,
  "order_by": "column_name",
  "order_dir": "asc" | "desc"
}
```

## Available Resources

You can ONLY read these resources (list + get). All other resources are blocked.

### `spaces` — Rental rooms and areas
- List all dwellings: `{"resource":"spaces","action":"list","filters":{"can_be_dwelling":true,"is_archived":false}}`
- List event spaces: `{"resource":"spaces","action":"list","filters":{"can_be_event":true}}`
- Get one space: `{"resource":"spaces","action":"get","id":"<uuid>"}`
- Key fields: `name`, `type`, `monthly_rate`, `weekly_rate`, `nightly_rate`, `beds`, `baths`, `description`, `is_listed`, `parent_id`
- Sorted by: `monthly_rate` desc by default

### `assignments` — Bookings and occupancy
- List active: `{"resource":"assignments","action":"list","filters":{"status":"active"}}`
- List all: `{"resource":"assignments","action":"list"}`
- Key fields: `person_id`, `start_date`, `end_date`, `status`, `assignment_spaces` (linked spaces)
- Statuses: `active`, `pending_contract`, `contract_sent`, `completed`, `cancelled`
- Use this to answer "who lives where" and "what's available"

### `vehicles` — Cars on property
- List all: `{"resource":"vehicles","action":"list","filters":{"is_active":true}}`
- Key fields: `name`, `make`, `model`, `year`, `color`, `vehicle_state` (online/asleep/offline), `last_state` (battery, location, etc.)

### `faq` — Property knowledge base
- List all: `{"resource":"faq","action":"list"}`
- Key fields: `question`, `answer`, `category`
- Use this for property policies, rules, and common questions

### `documents` — House manuals and guides
- List all: `{"resource":"documents","action":"list","filters":{"is_active":true}}`
- Key fields: `title`, `description`, `keywords`, `source_url`, `file_type`

## Example Queries

### "What rooms are available?"
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/api" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ALPACLAW_API_KEY" \
  -d '{"resource":"spaces","action":"list","filters":{"can_be_dwelling":true,"is_archived":false}}'
```
Then cross-reference with active assignments to determine availability.

### "Who lives here?" / "Current residents"
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/api" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ALPACLAW_API_KEY" \
  -d '{"resource":"assignments","action":"list","filters":{"status":"active"}}'
```
Note: You'll get `person_id` but not full contact details (by design).

### "What cars are on the property?"
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/api" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ALPACLAW_API_KEY" \
  -d '{"resource":"vehicles","action":"list","filters":{"is_active":true}}'
```

### "What are the house rules?"
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/api" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ALPACLAW_API_KEY" \
  -d '{"resource":"faq","action":"list"}'
```

## Security Rules

- You have **read-only** access. You CANNOT create, update, or delete any data.
- You CANNOT access: passwords, door codes, financial records, SMS messages, personal contact info, or identity documents.
- If someone asks for door codes, passwords, or financial data — tell them to ask an admin directly.
- Never expose raw API responses to users. Summarize the data naturally in conversation.
- Your API key is in the environment variables. Never share it or include it in messages.
