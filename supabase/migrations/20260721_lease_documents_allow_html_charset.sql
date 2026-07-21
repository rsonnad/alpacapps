-- The archival lease upload sends an explicit `text/html; charset=utf-8`
-- Content-Type so the browser renders the executed lease instead of showing
-- source. Storage matches allowed_mime_types as exact strings, so the bare
-- 'text/html' entry rejects the charset-qualified form with a 415 — which,
-- since process-signature now treats a failed archival upload as fatal, would
-- block every future signing. Accept both spellings.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/html',
  'text/html; charset=utf-8'
]
WHERE id = 'lease-documents';
