-- Vehicle rental e-signing
--
-- Wires vehicle_rentals into the native e-signature flow (get-signing-document,
-- process-signature, archival-document) alongside rental leases and event
-- agreements.
--
-- Security model differs deliberately from rental_applications: vehicle_rentals
-- is readable AND writable by the public anon role (policy "Allow all
-- vehicle_rentals", USING true), so neither the signing token nor the signed
-- terms can live there. Instead:
--   * the bearer token lives in vehicle_rental_signings, which has RLS enabled
--     and no policies — only the service role (edge functions) can touch it;
--   * the rendered agreement is frozen into that row at send time, so the text
--     the renter signs cannot be altered afterwards by editing vehicle_rentals.
-- vehicle_rentals only gains non-sensitive status fields and the per-rental
-- contract terms that feed the render at send time.

-- ── Per-rental terms and status on vehicle_rentals ──────────────────────
alter table vehicle_rentals
  add column if not exists contract_terms jsonb not null default '{}'::jsonb,
  add column if not exists agreement_status text,
  add column if not exists agreement_sent_at timestamptz,
  add column if not exists agreement_signed_at timestamptz;

comment on column vehicle_rentals.contract_terms is
  'Per-rental agreement terms not held in dedicated columns (insurance start, damage inventory, photo archive, retroactivity, initial term end). Read once at send time by send-vehicle-rental-signing.';

-- ── Signing sessions: token + frozen document, service-role only ────────
create table if not exists vehicle_rental_signings (
  id uuid primary key default gen_random_uuid(),
  vehicle_rental_id uuid not null references vehicle_rentals(id) on delete restrict,
  signing_token uuid not null unique,
  token_expires_at timestamptz not null,
  status text not null default 'sent'
    check (status in ('sent', 'signed', 'superseded')),
  signing_version integer not null default 1 check (signing_version > 0),
  signer_name text not null,
  signer_email text not null,
  cc_emails text[] not null default '{}',
  document_html text not null,
  document_hash text not null,
  template_id uuid references lease_templates(id),
  template_version integer,
  sent_at timestamptz not null default now(),
  sent_by text,
  signed_at timestamptz,
  agreement_document_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_rental_signings_rental
  on vehicle_rental_signings (vehicle_rental_id);

-- One live signing link per rental at a time; older ones are superseded.
create unique index if not exists idx_vehicle_rental_signings_one_open
  on vehicle_rental_signings (vehicle_rental_id)
  where status = 'sent';

alter table vehicle_rental_signings enable row level security;
revoke all on vehicle_rental_signings from anon, authenticated;

-- ── Audit log: vehicle rentals as a third document type ─────────────────
alter table signature_audit_log
  add column if not exists vehicle_rental_id uuid references vehicle_rentals(id);

create index if not exists idx_signature_audit_vehicle
  on signature_audit_log (vehicle_rental_id)
  where vehicle_rental_id is not null;

-- Mirrors idx_signature_audit_unique_execution_role_rental: a second submit
-- of the same execution fails with 23505 instead of double-recording.
create unique index if not exists idx_signature_audit_unique_execution_role_vehicle
  on signature_audit_log (vehicle_rental_id, signing_version, signer_role)
  where vehicle_rental_id is not null;

alter table signature_audit_log
  drop constraint if exists signature_audit_log_document_type_check;
alter table signature_audit_log
  add constraint signature_audit_log_document_type_check
  check (document_type = any (array['rental'::text, 'event'::text, 'vehicle_rental'::text]));
