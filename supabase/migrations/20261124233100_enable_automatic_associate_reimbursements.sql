-- Apply after Accounting with the payment-hold control is live.
ALTER TABLE public.associate_reimbursements ALTER COLUMN automatic_payment SET DEFAULT true;
