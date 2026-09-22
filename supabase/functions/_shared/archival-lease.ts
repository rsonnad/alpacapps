/**
 * Canonical builder for the archival copy of an executed agreement.
 *
 * Shared deliberately: `process-signature` writes this HTML at signing time and
 * `archival-document` re-serves it for the PDF archiver on Alpuca. If the two
 * ever built the document independently they would drift, and the PDF on file
 * would stop matching the HTML both parties signed.
 */

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short',
  });
}

/**
 * Party labels for the signature record. Leases and event agreements keep
 * their original Landlord/Tenant wording (and byte-identical output); vehicle
 * rental agreements name the parties Owner/Renter, and the signature record
 * must match the contract it is attached to.
 */
function partyLabels(documentType?: string) {
  if (documentType === 'vehicle_rental') {
    return {
      docTitle: 'Signed Vehicle Rental Agreement',
      bannerTitle: 'Executed Vehicle Rental Agreement',
      ownerLabel: 'Owner signature',
      ownerCaption: 'Rahul Sonnad — Owner',
      ownerAria: 'Owner signature',
      signerLabel: 'Renter signature',
      signerAlt: 'Renter signature',
    };
  }
  return {
    docTitle: 'Signed Lease',
    bannerTitle: 'Executed Lease Agreement',
    ownerLabel: 'Landlord signature',
    ownerCaption: 'Rahul Sonnad — Admin, Revocable Trust of Subhash Sonnad',
    ownerAria: 'Landlord signature',
    signerLabel: 'Tenant signature',
    signerAlt: 'Tenant signature',
  };
}

// Build the e-signature audit block HTML used in all post-signing emails
/**
 * Wrap the rendered lease HTML the tenant signed (which already has the
 * landlord's pre-signature embedded) plus an audit footer into a complete
 * standalone HTML document suitable for archival in lease-documents/signed/.
 * Both parties (tenant and landlord) reference the same file via
 * rental_applications.agreement_document_url.
 *
 * `documentType` must be the signature_audit_log.document_type of the record,
 * so `archival-document` can rebuild exactly what `process-signature` wrote.
 */
export function buildArchivalLeaseHtml(opts: {
  documentHtml: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  ipAddress: string;
  userAgent: string;
  documentHash: string;
  signatureImageUrl: string;
  documentType?: string;
}): string {
  const labels = partyLabels(opts.documentType);
  const audit = auditBlockHtml(opts);
  const titleSafe = (opts.signerName || labels.docTitle).replace(/[<>&]/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${labels.docTitle} — ${titleSafe}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 820px; margin: 32px auto; padding: 0 20px 60px; color: #1c1618; line-height: 1.55; }
  h1 { font-size: 24px; }
  h2 { font-size: 18px; margin-top: 1.6em; }
  h3 { font-size: 15px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.6em 0; }
  .archival-banner { background:#f1f8f4; border-left: 4px solid #3d8b7a; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; color:#1c4a3e; }
</style>
</head>
<body>
  <div class="archival-banner"><strong>${labels.bannerTitle}</strong> — signed by ${titleSafe} on ${formatDateTime(opts.signedAt)}. This file is the canonical archival record; both parties have the same URL on file.</div>
  ${opts.documentHtml}
  ${audit}
</body>
</html>`;
}

function landlordSignatureSvg(name: string, dateLabel: string, ariaPrefix = 'Landlord signature'): string {
  // Inline SVG renders reliably in Gmail web (the primary inbox we send to)
  // and most modern clients. Falls back gracefully — even when stripped,
  // the lease text below still names Rahul Sonnad as the pre-signing landlord.
  const safeName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg width="260" height="64" viewBox="0 0 260 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ariaPrefix}: ${safeName}">
    <text x="6" y="46" font-family="'Brush Script MT','Lucida Handwriting','Snell Roundhand',cursive" font-style="italic" font-size="38" fill="#1c4a3e">${safeName}</text>
    <line x1="0" y1="56" x2="260" y2="56" stroke="#aaa" stroke-width="0.5"/>
    <text x="0" y="63" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" fill="#888">Pre-signed ${dateLabel}</text>
  </svg>`;
}

export function auditBlockHtml(opts: { signedAt: string; ipAddress: string; userAgent: string; documentHash: string; signatureImageUrl: string; documentType?: string }): string {
  const labels = partyLabels(opts.documentType);
  const landlordSig = landlordSignatureSvg('Rahul Sonnad', formatDateTime(opts.signedAt).split(',')[0] || formatDateTime(opts.signedAt), labels.ownerAria);
  return `
    <div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <h3 style="margin-top: 0; color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Electronic Signature Record</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Signed at</td><td style="padding: 6px 0;">${formatDateTime(opts.signedAt)}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">IP Address</td><td style="padding: 6px 0;">${opts.ipAddress}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Browser</td><td style="padding: 6px 0; word-break: break-all; font-size: 11px;">${opts.userAgent}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Document Hash</td><td style="padding: 6px 0; font-family: monospace; font-size: 11px; word-break: break-all;">${opts.documentHash}</td></tr>
      </table>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px solid #eee; padding-top: 12px;">
        <tr>
          <td style="vertical-align: top; padding: 12px 8px 0 0; width: 50%;">
            <p style="color: #888; font-size: 12px; margin: 0 0 6px 0;">${labels.ownerLabel}</p>
            <div style="border: 1px solid #eee; border-radius: 4px; padding: 6px 10px; background: #fff;">${landlordSig}</div>
            <p style="color: #555; font-size: 11px; margin: 6px 0 0 0;">${labels.ownerCaption}</p>
          </td>
          <td style="vertical-align: top; padding: 12px 0 0 8px; width: 50%;">
            <p style="color: #888; font-size: 12px; margin: 0 0 6px 0;">${labels.signerLabel}</p>
            <img src="${opts.signatureImageUrl}" alt="${labels.signerAlt}" style="max-width: 260px; max-height: 64px; height: auto; border: 1px solid #eee; border-radius: 4px; padding: 6px 10px; background: #fff;">
          </td>
        </tr>
      </table>
      <p style="color: #999; font-size: 11px; margin: 12px 0 0 0;">
        This document was signed electronically in compliance with the ESIGN Act (15 U.S.C. § 7001) and the Texas Uniform Electronic Transactions Act (Tex. Bus. & Com. Code Ch. 322).
      </p>
    </div>`;
}

