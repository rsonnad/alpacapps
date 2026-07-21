-- Every executed agreement (rental lease, event agreement, waiver) is archived
-- as HTML, but until now nothing kept a PDF — the durable, portable, offline
-- copy you actually want years later when someone asks for "the signed lease".
--
-- signature_audit_log is the right home for this: it already has one row per
-- signer per signing_version, carries the exact document_html that was signed,
-- and covers every document type the e-signature system handles. The PDF is
-- rendered from the tenant row (the one with the drawn signature) by the
-- signed-pdf-archiver sweeper on Alpuca and uploaded to R2.
--
-- Nullable by design: PDF archival is best-effort and asynchronous so that a
-- renderer being offline can never block a signer mid-signature. The sweeper
-- treats "url IS NULL" as its work queue, so a missed document is picked up on
-- the next pass rather than lost.

ALTER TABLE signature_audit_log
  ADD COLUMN IF NOT EXISTS archival_pdf_url          text,
  ADD COLUMN IF NOT EXISTS archival_pdf_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS archival_pdf_error        text,
  ADD COLUMN IF NOT EXISTS archival_pdf_attempts     integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN signature_audit_log.archival_pdf_url IS
  'R2 URL of the PDF rendering of this executed document. NULL = not yet archived (sweeper queue).';
COMMENT ON COLUMN signature_audit_log.archival_pdf_error IS
  'Last failure reason from the PDF archiver; cleared on success.';
COMMENT ON COLUMN signature_audit_log.archival_pdf_attempts IS
  'Failed render attempts, so the sweeper can back off a permanently broken row instead of retrying forever.';

-- The sweeper polls for unarchived signings constantly; keep that cheap.
-- Only tenant rows carry a drawn signature, and only rows with retained HTML
-- can be rendered at all, so the queue is exactly this partial index.
CREATE INDEX IF NOT EXISTS idx_signature_audit_pdf_queue
  ON signature_audit_log (signed_at)
  WHERE archival_pdf_url IS NULL
    AND signer_role = 'tenant'
    AND document_html IS NOT NULL;
