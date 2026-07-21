-- Executed native leases are stored as immutable archival HTML. The bucket
-- previously accepted only PDFs and signature images, causing the signing
-- flow to reject a completion when it correctly tried to preserve the record.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/html'
]
WHERE id = 'lease-documents';
