-- Drafts written by a guest's own AI assistant for the host-event form
-- (rentals/hostevent "Let my AI assistant fill this out").
--
-- The page mints a key on an explicit tap; the assistant saves answers here
-- through the event-request-agent edge function; the page reads them back
-- into the form. A draft is never an event request: the guest still ticks
-- the acknowledgments, pays the deposit and submits on the page.
--
-- Only the edge function (service role) touches this table: RLS on, no policies.

create table if not exists public.event_request_drafts (
  id          uuid primary key default gen_random_uuid(),
  key_hash    text not null unique,          -- sha256 hex of the plaintext key
  key_prefix  text not null,                 -- first characters, for logs
  fields      jsonb not null default '{}'::jsonb,
  space_ids   uuid[] not null default '{}',
  agent_name  text,                          -- what the assistant called itself, if it said
  created_ip  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at  timestamptz not null default now() + interval '3 days'
);

create index if not exists event_request_drafts_expires_idx on public.event_request_drafts (expires_at);

alter table public.event_request_drafts enable row level security;
revoke all on public.event_request_drafts from anon, authenticated;

comment on table public.event_request_drafts is
  'Host-event form drafts filled by a guest''s AI assistant via event-request-agent. Service role only; expires after 3 days.';

-- Drafts hold guest and staff names and phone numbers: delete them a day after they expire.
select cron.schedule(
  'event-request-drafts-sweep',
  '17 9 * * *',
  $$delete from public.event_request_drafts where expires_at < now() - interval '1 day'$$
);
