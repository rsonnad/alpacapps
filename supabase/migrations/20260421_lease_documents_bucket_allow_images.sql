-- Allow PNG/JPEG uploads to the lease-documents bucket so the native
-- e-signature flow (process-signature) can store signature images.
-- Previously the bucket only allowed application/pdf, which caused
-- every signing attempt to fail with "Failed to store signature".

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg']
WHERE name = 'lease-documents';
