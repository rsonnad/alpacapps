/**
 * Get Signing Document
 * Returns the rendered lease/event agreement HTML for a given signing token.
 * Called by the tenant-facing signing page.
 *
 * POST { token: string }
 * Returns { document_html, signer_name, signer_email, document_type, application_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeadersOpen } from "../_shared/api-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersOpen });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { token } = await req.json();
    if (!token) {
      return jsonError('Missing signing token', 400);
    }

    // Try rental_applications first
    const { data: rentalApp } = await supabase
      .from('rental_applications')
      .select(`
        id,
        signing_token_expires_at,
        agreement_status,
        approved_rate,
        approved_rate_term,
        approved_move_in,
        approved_lease_end,
        notice_period,
        security_deposit_amount,
        move_in_deposit_amount,
        reservation_deposit_amount,
        application_fee_paid,
        application_fee_amount,
        additional_terms,
        waiver_template_id,
        approved_space:approved_space_id (id, name, type),
        person:person_id (id, first_name, last_name, email, phone, current_address, emergency_contact_name, emergency_contact_phone, emergency_contact_email, emergency_contact_relationship)
      `)
      .eq('signing_token', token)
      .single();

    if (rentalApp) {
      // Validate token expiry
      if (rentalApp.signing_token_expires_at && new Date(rentalApp.signing_token_expires_at) < new Date()) {
        return jsonError('This signing link has expired. Please contact the landlord for a new link.', 410);
      }

      if (rentalApp.agreement_status === 'signed') {
        return jsonError('This document has already been signed.', 409);
      }

      // Get the active lease template
      const { data: template } = await supabase
        .from('lease_templates')
        .select('content')
        .eq('is_active', true)
        .eq('type', 'lease')
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (!template) {
        return jsonError('No active lease template found', 500);
      }

      // Get waiver template if applicable
      let waiverContent = '';
      if (rentalApp.waiver_template_id) {
        const { data: waiverTemplate } = await supabase
          .from('lease_templates')
          .select('content')
          .eq('id', rentalApp.waiver_template_id)
          .single();
        if (waiverTemplate) {
          waiverContent = waiverTemplate.content;
        }
      } else {
        // Check for active renter_waiver
        const { data: defaultWaiver } = await supabase
          .from('lease_templates')
          .select('content')
          .eq('is_active', true)
          .eq('type', 'renter_waiver')
          .order('version', { ascending: false })
          .limit(1)
          .single();
        if (defaultWaiver) {
          waiverContent = defaultWaiver.content;
        }
      }

      const person = rentalApp.person as any;
      const space = rentalApp.approved_space as any;

      // Build agreement data for template substitution
      const landlordSig = await fetchLandlordSignatureHtml(supabase);
      const agreementData = buildRentalAgreementData(rentalApp, person, space, landlordSig);

      // Parse template
      let documentHtml = parseMarkdownTemplate(template.content, agreementData);

      // Append waiver if present
      let waiverHtml = '';
      if (waiverContent) {
        waiverHtml = parseMarkdownTemplate(waiverContent, {
          ...agreementData,
          client_name: agreementData.tenant_name,
          client_email: agreementData.tenant_email,
          client_phone: agreementData.tenant_phone,
        });
      }

      const signerName = `${person?.first_name || ''} ${person?.last_name || ''}`.trim();

      return jsonResponse({
        document_html: documentHtml,
        waiver_html: waiverHtml,
        signer_name: signerName,
        signer_email: person?.email || '',
        document_type: 'rental',
        application_id: rentalApp.id,
        space_name: space?.name || 'Unknown Space',
        contact_info: {
          person_id: person?.id || null,
          current_address: person?.current_address || '',
          emergency_contact_name: person?.emergency_contact_name || '',
          emergency_contact_phone: person?.emergency_contact_phone || '',
          emergency_contact_email: person?.emergency_contact_email || '',
          emergency_contact_relationship: person?.emergency_contact_relationship || '',
        },
      });
    }

    // Try event_hosting_requests
    const { data: eventReq } = await supabase
      .from('event_hosting_requests')
      .select(`
        id,
        signing_token_expires_at,
        agreement_status,
        event_name,
        event_date,
        event_start_time,
        event_end_time,
        rental_fee,
        reservation_fee,
        cleaning_deposit,
        person:person_id (id, first_name, last_name, email, phone, current_address, emergency_contact_name, emergency_contact_phone, emergency_contact_email, emergency_contact_relationship)
      `)
      .eq('signing_token', token)
      .single();

    if (eventReq) {
      if (eventReq.signing_token_expires_at && new Date(eventReq.signing_token_expires_at) < new Date()) {
        return jsonError('This signing link has expired.', 410);
      }
      if (eventReq.agreement_status === 'signed') {
        return jsonError('This document has already been signed.', 409);
      }

      // Get event waiver template
      const { data: eventTemplate } = await supabase
        .from('lease_templates')
        .select('content')
        .eq('is_active', true)
        .eq('type', 'event_waiver')
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (!eventTemplate) {
        return jsonError('No active event waiver template found', 500);
      }

      const person = eventReq.person as any;
      const signerName = `${person?.first_name || ''} ${person?.last_name || ''}`.trim();

      const eventData: Record<string, string> = {
        client_name: signerName,
        client_email: person?.email || '',
        client_phone: person?.phone || '',
        event_date: eventReq.event_date || '',
        signing_date: formatSigningDate(),
      };

      const documentHtml = parseMarkdownTemplate(eventTemplate.content, eventData);

      return jsonResponse({
        document_html: documentHtml,
        waiver_html: '',
        signer_name: signerName,
        signer_email: person?.email || '',
        document_type: 'event',
        application_id: eventReq.id,
        space_name: eventReq.event_name || 'Event',
      });
    }

    return jsonError('Invalid or expired signing link.', 404);

  } catch (error) {
    console.error('get-signing-document error:', error);
    return jsonError(error.message || 'Internal error', 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeadersOpen, 'Content-Type': 'application/json' },
  });
}

function formatSigningDate(): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Chicago' });
  const month = now.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/Chicago' });
  const year = now.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'America/Chicago' });
  return `${day} day of ${month} ${year}`;
}

function buildRentalAgreementData(app: any, person: any, space: any, landlordSignatureHtml?: string): Record<string, string> {
  const rateTermDisplay: Record<string, string> = { monthly: 'month', weekly: 'week', nightly: 'night' };
  const rateTerm = rateTermDisplay[app.approved_rate_term] || 'month';

  const noticePeriodDisplay: Record<string, string> = {
    none: 'Fixed-length lease (no early termination)',
    '1_day': '1 day notice required',
    '1_week': '1 week notice required',
    '30_days': '30 days notice required',
    '60_days': '60 days notice required',
  };

  const formatDate = (d: string | null) => {
    if (!d) return 'TBD';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago'
    });
  };

  const applicationFeePaid = app.application_fee_paid && app.application_fee_amount > 0 ? app.application_fee_amount : 0;
  const reservationDeposit = app.reservation_deposit_amount || 0;
  const moveInDeposit = app.move_in_deposit_amount || 0;
  const totalCredits = applicationFeePaid + reservationDeposit;
  const firstMonthDue = Math.max(0, moveInDeposit - totalCredits);

  let applicationFeeCredit = '';
  if (applicationFeePaid > 0) {
    applicationFeeCredit = `Application fee of $${applicationFeePaid} has been received and will be credited toward the first month's rent.`;
  }

  let reservationDepositCredit = '';
  if (reservationDeposit > 0) {
    reservationDepositCredit = `Reservation deposit of $${reservationDeposit} will be credited toward the first month's rent.`;
  }

  // Build lease term block
  const leaseStart = formatDate(app.approved_move_in);
  const leaseEnd = formatDate(app.approved_lease_end) || 'Open-ended';
  const noticePeriodLabel: Record<string, string> = { '1_day': '1 day', '1_week': '1 week', '30_days': '30 days', '60_days': '60 days' };

  let leaseTermBlock;
  if (app.notice_period === 'none') {
    leaseTermBlock = `This Lease shall commence on: **${leaseStart}** and continue until: **${leaseEnd}**. This is a fixed-length lease.`;
  } else {
    const label = noticePeriodLabel[app.notice_period] || '30 days';
    leaseTermBlock = `This Lease shall commence on: **${leaseStart}** and continue on a month-to-month basis until terminated by either party with at least **${label}** written notice.`;
  }

  return {
    tenant_name: `${person?.first_name || ''} ${person?.last_name || ''}`.trim(),
    tenant_email: person?.email || '',
    tenant_phone: person?.phone || '',
    signing_date: formatSigningDate(),
    lease_start_date: leaseStart,
    lease_end_date: leaseEnd,
    dwelling_description: space?.name || 'Unknown',
    dwelling_location: space?.type || '',
    rate: `$${app.approved_rate || 0}`,
    rate_term: rateTerm,
    rate_display: `$${app.approved_rate || 0}/${rateTerm}`,
    security_deposit: `$${app.security_deposit_amount || 0}`,
    move_in_deposit: `$${moveInDeposit}`,
    reservation_deposit: `$${reservationDeposit}`,
    application_fee_paid: `$${applicationFeePaid}`,
    application_fee_credit: applicationFeeCredit,
    reservation_deposit_credit: reservationDepositCredit,
    total_credits: `$${totalCredits}`,
    first_month_due: `$${firstMonthDue}`,
    notice_period: app.notice_period || '30_days',
    notice_period_display: noticePeriodDisplay[app.notice_period] || '30 days notice required',
    lease_term_block: leaseTermBlock,
    additional_terms: app.additional_terms || '',
    landlord_signature_img: landlordSignatureHtml || landlordSignatureSvg('Rahul Sonnad', formatSigningDate()),
  };
}

/**
 * Resolve the landlord's pre-signature HTML to embed in produced leases.
 *
 * Reads `config.landlord_signature` — when an admin uploads an image via
 * /admin/landlord-signature.html, signature_image_url points at a public
 * URL in the lease-documents bucket and we render an <img> tag. When no
 * image is configured (initial state), we fall back to a typed-name
 * cursive SVG so leases still render a real-looking signature.
 */
async function fetchLandlordSignatureHtml(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'landlord_signature')
      .single();
    const cfg = data?.value || {};
    const name = cfg.name || 'Rahul Sonnad';
    if (cfg.signature_image_url) {
      const dateLabel = formatSigningDate();
      const safeUrl = String(cfg.signature_image_url).replace(/"/g, '&quot;');
      return `<img src="${safeUrl}" alt="Landlord signature: ${name}" style="max-width:260px;max-height:80px;display:block;border:0;background:transparent;"/><div style="font-size:11px;color:#888;margin-top:4px;border-top:1px solid #ccc;padding-top:4px;">Pre-signed ${dateLabel}</div>`;
    }
    return landlordSignatureSvg(name, formatSigningDate());
  } catch (_e) {
    return landlordSignatureSvg('Rahul Sonnad', formatSigningDate());
  }
}

/**
 * Inline SVG fallback when no uploaded landlord signature image is
 * configured. Renders reliably in Gmail web and most modern email clients.
 */
function landlordSignatureSvg(name: string, dateLabel: string): string {
  const safe = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg width="260" height="64" viewBox="0 0 260 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Landlord signature: ${safe}"><text x="6" y="46" font-family="'Brush Script MT','Lucida Handwriting','Snell Roundhand',cursive" font-style="italic" font-size="38" fill="#1c4a3e">${safe}</text><line x1="0" y1="56" x2="260" y2="56" stroke="#aaa" stroke-width="0.5"/><text x="0" y="63" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" fill="#888">Pre-signed ${dateLabel}</text></svg>`;
}

/**
 * HTML-escape a string so user-controlled values cannot inject script tags
 * or other markup when interpolated into the lease template.
 */
function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fields whose values originate from user input (signer-provided) and must be
 * HTML-escaped before substitution into the markdown→HTML pipeline. All other
 * fields are server-generated (formatted dates, currency, lookup-table strings,
 * `lease_term_block` markdown) and are trusted by construction.
 */
const USER_CONTROLLED_FIELDS = new Set([
  'tenant_name', 'tenant_email', 'tenant_phone',
  'client_name', 'client_email', 'client_phone',
  'dwelling_description', 'dwelling_location',
  'additional_terms',
]);

/**
 * Convert markdown template with {{placeholders}} to HTML.
 * Supports: # headers, **bold**, - bullet lists, ---.
 *
 * SECURITY: Values for user-controlled fields (see USER_CONTROLLED_FIELDS) are
 * HTML-escaped before substitution to prevent stored XSS via fields like
 * `additional_terms` (entered by admin during application approval) or signer
 * profile fields (`tenant_name`, etc.).
 */
function parseMarkdownTemplate(template: string, data: Record<string, string>): string {
  // Substitute placeholders
  let content = template;

  // Handle additional_terms specially — wrap with intro line, but escape the user-supplied body.
  const additionalTerms = data.additional_terms?.trim();
  if (additionalTerms) {
    content = content.replace(/\{\{additional_terms\}\}/g,
      `The following additional terms apply:\n\n${escapeHtml(additionalTerms)}`);
  } else {
    content = content.replace(/\{\{additional_terms\}\}/g, 'None.');
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'additional_terms') continue;
    const safeValue = USER_CONTROLLED_FIELDS.has(key) ? escapeHtml(value) : (value ?? '');
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safeValue);
  }
  content = content.replace(/\{\{\w+\}\}/g, '');

  // Convert markdown to HTML
  const lines = content.split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push('<br>');
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push('<hr>');
      continue;
    }

    // Headers
    if (trimmed.startsWith('# ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h1>${boldify(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h2>${boldify(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h3>${boldify(trimmed.slice(4))}</h3>`);
      continue;
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${boldify(trimmed.slice(2))}</li>`);
      continue;
    }

    if (inList) { htmlParts.push('</ul>'); inList = false; }
    htmlParts.push(`<p>${boldify(trimmed)}</p>`);
  }

  if (inList) htmlParts.push('</ul>');

  return htmlParts.join('\n');
}

function boldify(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
