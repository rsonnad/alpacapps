-- Vendor CRM: extend the existing `vendors` table into a lightweight contact directory.
--
-- Context: `vendors` already existed (read-only) from the purchases flow with
--   id, name, phone, email, category, address, total_spent, purchase_count,
--   website, notes, created_at, updated_at
-- but had no migration and no SCHEMA.md entry. This migration adopts it and adds
-- the CRM fields so utility providers and contractors can be tracked in one place.
--
-- Design note: one row per company (a vendor appears once, not once per property).
-- `account_number` is a single field for now; if a vendor ever needs per-property
-- accounts, normalize into a `vendor_accounts` child table then.

-- 1. CRM columns -------------------------------------------------------------

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vendor_type       text,
  ADD COLUMN IF NOT EXISTS contact_name      text,
  ADD COLUMN IF NOT EXISTS account_number    text,
  ADD COLUMN IF NOT EXISTS license_number    text,
  ADD COLUMN IF NOT EXISTS insurance_expires date,
  ADD COLUMN IF NOT EXISTS is_active         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata          jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- vendor_type is a controlled vocabulary; category stays free text because the
-- purchases flow already wrote arbitrary values into it (the UI offers a dropdown).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_vendor_type_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_vendor_type_check
      CHECK (vendor_type IS NULL OR vendor_type IN
        ('utility', 'contractor', 'service', 'supplier', 'government'));
  END IF;
END $$;

COMMENT ON TABLE  public.vendors                   IS 'Vendor/contractor CRM: utilities, trades, and suppliers who service the property. One row per company.';
COMMENT ON COLUMN public.vendors.vendor_type       IS 'utility | contractor | service | supplier | government';
COMMENT ON COLUMN public.vendors.category          IS 'Trade/service category, e.g. waste, electric, plumbing, hvac. Free text; UI offers a dropdown.';
COMMENT ON COLUMN public.vendors.account_number    IS 'Our account number with this vendor. Single-account assumption — normalize if per-property accounts are needed.';
COMMENT ON COLUMN public.vendors.insurance_expires IS 'COI expiry, for contractors that carry one. Nullable.';
COMMENT ON COLUMN public.vendors.is_active         IS 'Soft-hide flag; the UI filters to is_active = true.';

-- 2. Indexes -----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vendors_is_active   ON public.vendors (is_active);
CREATE INDEX IF NOT EXISTS idx_vendors_category    ON public.vendors (category);
CREATE INDEX IF NOT EXISTS idx_vendors_vendor_type ON public.vendors (vendor_type);

-- 3. RLS ---------------------------------------------------------------------
-- Staff and above may read; admins may write; service_role unrestricted.

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_staff_read  ON public.vendors;
DROP POLICY IF EXISTS vendors_admin_write ON public.vendors;
DROP POLICY IF EXISTS vendors_service     ON public.vendors;

CREATE POLICY vendors_staff_read ON public.vendors
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle', 'staff'))
  );

CREATE POLICY vendors_admin_write ON public.vendors
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'oracle'))
  );

CREATE POLICY vendors_service ON public.vendors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Seed --------------------------------------------------------------------
-- First real entry. Phone is the published Customer Care line.

INSERT INTO public.vendors (name, vendor_type, category, phone, website, notes)
SELECT 'Texas Disposal Systems', 'utility', 'waste', '(800) 375-8375',
       'https://www.texasdisposal.com',
       'Customer Care line, Mon-Fri 8am-5pm. Account number TBD.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.vendors WHERE lower(name) = lower('Texas Disposal Systems')
);

-- Aerobic septic service contract (160 Still Forest Dr). Billing lives in their
-- FieldPortals customer portal; invoice/renewal detail kept in metadata.
INSERT INTO public.vendors (name, vendor_type, category, contact_name, account_number, website, notes, metadata)
SELECT 'Aerobic Services', 'service', 'wastewater', 'Rahul Sonnad', '189495',
       'https://aerobicservices.fieldportals.com',
       'Residential Service Contract for 160 Still Forest Dr, Cedar Creek, TX 78612. $325/yr, renews 9/1. Pay/renew in the FieldPortals customer portal.',
       jsonb_build_object(
         'portal_url', 'https://aerobicservices.fieldportals.com/billing',
         'service_address', '160 Still Forest Dr, Cedar Creek, TX 78612',
         'contract', 'Residential Service Contract',
         'annual_cost', 325,
         'renewal_date', '2026-09-01',
         'last_invoice', '334411'
       )
WHERE NOT EXISTS (
  SELECT 1 FROM public.vendors WHERE lower(name) = lower('Aerobic Services')
);
