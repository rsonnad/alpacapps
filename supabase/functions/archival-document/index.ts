/**
 * Serve the canonical archival HTML for one executed signature record.
 *
 * The PDF archiver runs on Alpuca (headless Chrome — Deno has no browser to
 * render with), but the *document* must not be built there: if Alpuca
 * assembled its own copy, the PDF on file could drift from the HTML the
 * parties actually signed. So Alpuca asks this function for the bytes and
 * limits itself to rendering and uploading them.
 *
 * Works for every document type the e-signature system handles — the record
 * lives in signature_audit_log regardless of whether it's a rental lease, an
 * event agreement, or a waiver.
 *
 * Auth: service-role only. These are executed leases containing tenant PII and
 * signatures; the anon key also satisfies verify_jwt, so the role claim is
 * checked explicitly rather than trusting that a valid JWT is a privileged one.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeadersOpen } from "../_shared/api-helpers.ts";
import { buildArchivalLeaseHtml } from "../_shared/archival-lease.ts";

function isServiceRole(req: Request): boolean {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    // verify_jwt has already validated the signature; we only need the claim.
    const pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);
    const payload = JSON.parse(
      atob(pad(parts[1].replace(/-/g, '+').replace(/_/g, '/'))),
    );
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersOpen });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
    });

  if (!isServiceRole(req)) return json({ error: 'Forbidden' }, 403);

  try {
    const url = new URL(req.url);
    const auditId = url.searchParams.get('audit_id');
    if (!auditId) return json({ error: 'audit_id is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: row, error } = await supabase
      .from('signature_audit_log')
      .select('id, document_type, rental_application_id, event_hosting_request_id, signing_version, signer_name, signer_email, signed_at, ip_address, user_agent, document_hash, signature_image_url, document_html')
      .eq('id', auditId)
      .maybeSingle();

    if (error) throw error;
    if (!row) return json({ error: 'No such signature record' }, 404);
    if (!row.document_html) {
      // Pre-dates HTML retention. Nothing faithful can be rendered, and
      // inventing a document for a signed agreement would be far worse than
      // reporting the gap.
      return json({ error: 'This signature record retained no document HTML' }, 409);
    }

    const html = buildArchivalLeaseHtml({
      documentHtml: row.document_html,
      signerName: row.signer_name || '',
      signerEmail: row.signer_email || '',
      signedAt: row.signed_at,
      ipAddress: row.ip_address || '',
      userAgent: row.user_agent || '',
      documentHash: row.document_hash || '',
      signatureImageUrl: row.signature_image_url || '',
    });

    if (url.searchParams.get('format') === 'json') {
      return json({
        id: row.id,
        document_type: row.document_type,
        application_id: row.rental_application_id || row.event_hosting_request_id,
        signing_version: row.signing_version,
        signed_at: row.signed_at,
        signer_name: row.signer_name,
        html,
      });
    }

    return new Response(html, {
      headers: { ...corsHeadersOpen, 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (e) {
    console.error('archival-document error:', e);
    return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
  }
});
