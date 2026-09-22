/**
 * Render a vehicle rental agreement from its lease_templates row.
 *
 * Called once, at send time, by send-vehicle-rental-signing. The result is
 * frozen into vehicle_rental_signings.document_html and served verbatim from
 * then on — get-signing-document and process-signature never re-render a
 * vehicle agreement. That is deliberate: vehicle_rentals is writable by the
 * public anon role, so re-rendering at signing time (as leases do) would let
 * anyone change the terms of a contract after it was sent.
 *
 * Template syntax matches the lease pipeline in get-signing-document:
 * `{{placeholders}}`, `#`/`##`/`###` headings, `**bold**`, `- ` bullets, `---`,
 * one paragraph per line. Every value that originates from a database text
 * field is HTML-escaped before substitution.
 */

export interface RenderedVehicleAgreement {
  html: string;
  templateId: string;
  templateVersion: number;
  signerName: string;
  signerEmail: string;
  vehicleLabel: string;
}

interface ContractTerms {
  retroactive?: boolean;
  initial_term_end?: string;       // YYYY-MM-DD
  insurance_start_date?: string;   // YYYY-MM-DD
  odometer_recorded_on?: string;   // YYYY-MM-DD
  damage_photos_url?: string;
  damage?: Record<string, string[]>;
}

const NUMBER_WORDS: Record<number, string> = {
  7: 'seven', 10: 'ten', 14: 'fourteen', 15: 'fifteen', 30: 'thirty', 45: 'forty-five', 60: 'sixty', 90: 'ninety',
};

export async function renderVehicleRentalAgreement(
  supabase: any,
  vehicleRentalId: string,
): Promise<RenderedVehicleAgreement> {
  const { data: rental, error } = await supabase
    .from('vehicle_rentals')
    .select(`
      id, renter_name, renter_email, renter_address,
      vehicle_id, vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_vin,
      starting_mileage, start_date, current_monthly_rate, security_deposit_amount,
      cancel_notice_days, monthly_mileage_limit, mileage_overage_rate,
      late_return_hourly_rate, accident_deductible_max, contract_terms,
      person:person_id (first_name, last_name, email)
    `)
    .eq('id', vehicleRentalId)
    .single();
  if (error || !rental) throw new Error('Vehicle rental not found');

  const { data: template } = await supabase
    .from('lease_templates')
    .select('id, version, content')
    .eq('is_active', true)
    .eq('type', 'vehicle_rental')
    .order('version', { ascending: false })
    .limit(1)
    .single();
  if (!template) throw new Error('No active vehicle_rental template found');

  let vehicleName = '';
  if (rental.vehicle_id) {
    const { data: vehicle } = await supabase
      .from('vehicles').select('name').eq('id', rental.vehicle_id).maybeSingle();
    vehicleName = vehicle?.name || '';
  }

  const person = rental.person as any;
  const signerName = (rental.renter_name
    || `${person?.first_name || ''} ${person?.last_name || ''}`).trim();
  const signerEmail = (rental.renter_email || person?.email || '').trim();

  const terms: ContractTerms = rental.contract_terms || {};

  // ── Validate: refuse to render a contract with holes in it ──────────
  const missing: string[] = [];
  if (!signerName) missing.push('renter name');
  if (!signerEmail) missing.push('renter email');
  if (!rental.renter_address) missing.push('renter address');
  if (!rental.start_date) missing.push('start date');
  if (!rental.current_monthly_rate) missing.push('monthly rate');
  if (rental.security_deposit_amount == null) missing.push('security deposit');
  if (rental.starting_mileage == null) missing.push('starting mileage');
  if (!rental.vehicle_vin) missing.push('vehicle VIN');
  if (!terms.initial_term_end) missing.push('contract_terms.initial_term_end');
  if (!terms.insurance_start_date) missing.push('contract_terms.insurance_start_date');
  if (missing.length) throw new Error(`Cannot render agreement — missing: ${missing.join(', ')}`);

  // Template v1 states "no proration applies" because the term begins on the
  // 1st. Rather than render a false statement, refuse mid-month starts.
  if (!/^\d{4}-\d{2}-01$/.test(rental.start_date)) {
    throw new Error('vehicle_rental template v1 supports only terms starting on the 1st of a month');
  }

  // ── Formatting helpers ──────────────────────────────────────────────
  const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
  });
  const monthLabel = (d: Date) => d.toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'America/Chicago',
  });
  const money = (n: number) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const money2 = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const e = escapeHtml;

  const start = new Date(`${rental.start_date}T12:00:00`);
  const next = new Date(start); next.setMonth(next.getMonth() + 1);
  const effectiveDate = fmtDate(rental.start_date);
  const rate = Number(rental.current_monthly_rate);
  const deposit = Number(rental.security_deposit_amount);
  const deductible = Number(rental.accident_deductible_max ?? 500);
  const noticeDays = Number(rental.cancel_notice_days ?? 30);
  const noticeWords = `${NUMBER_WORDS[noticeDays] || String(noticeDays)} (${noticeDays})`;
  const odometer = Number(rental.starting_mileage).toLocaleString('en-US');
  const recordedOn = terms.odometer_recorded_on ? fmtDate(terms.odometer_recorded_on) : '';
  const retroactive = terms.retroactive === true;
  const depositMatchesDeductible = deposit === deductible;

  // ── Conditional clauses ─────────────────────────────────────────────
  const retroactivePeriodNote = retroactive
    ? `The Parties acknowledge that this Agreement is being executed after the Start Date and applies retroactively to ${effectiveDate}. Renter's possession and use of the Vehicle from that date forward is governed by this Agreement in full, and rent accrues from ${effectiveDate}.`
    : '';

  const firstMonthPaymentNote = retroactive
    ? `The ${monthLabel(start)} payment is due in full and, as this Agreement is retroactive, is payable upon execution.`
    : `The ${monthLabel(start)} payment is due in full upon execution.`;

  const depositDeductibleNote = depositMatchesDeductible
    ? ' This amount is set equal to the maximum insurance deductible for which Renter is liable under Section 10, so that the deposit fully covers a single deductible.'
    : '';

  const deductibleDepositRef = depositMatchesDeductible
    ? ' — the amount held as the security deposit under Section 4 —'
    : ',';

  // "…was taken on <date>" — the date alone. Drafts asserted it was "the date
  // of execution", which stops being true the moment signing slips a day.
  const odometerNote = retroactive && recordedOn
    ? `The odometer reading of ${odometer} miles recorded in Section 1 was taken on ${recordedOn}. The Parties agree to use this figure as the baseline for calculating Renter's mileage allowance and any overage, and that miles driven between the ${effectiveDate} effective date and that reading are not charged against Renter's allowance.`
    : `The odometer reading of ${odometer} miles recorded in Section 1 is the baseline for calculating Renter's mileage allowance and any overage.`;

  const damageGroups = Object.entries(terms.damage || {}).filter(([, items]) => items?.length);
  const damageBlock = damageGroups.length
    ? damageGroups.map(([area, items]) =>
        [`**${e(area)}**`, ...items.map((it) => `- ${e(it)}`)].join('\n')).join('\n')
    : '- None noted.';

  const photosUrl = terms.damage_photos_url ? e(terms.damage_photos_url) : '';
  const damagePhotosBlock = photosUrl
    ? `**Photographic documentation.** The Parties acknowledge the photographs of the above-described pre-existing damage maintained at the following location, which are incorporated into this Agreement by reference:\n<a href="${photosUrl}" style="color:#16213e;word-break:break-all;">${photosUrl}</a>`
    : '';

  const conditionNote = photosUrl
    ? `This list and the referenced photographs reflect the condition of the Vehicle as of ${effectiveDate}. Any additional damage identified at the walkthrough shall be noted here and initialed by both Parties.`
    : `This list reflects the condition of the Vehicle as of ${effectiveDate}. Any additional damage identified at the walkthrough shall be noted here and initialed by both Parties.`;

  const signingDate = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
  });

  const data: Record<string, string> = {
    effective_date: effectiveDate,
    initial_term_end: fmtDate(terms.initial_term_end!),
    renter_name: e(signerName),
    renter_address: e(rental.renter_address),
    renter_email: e(signerEmail),
    vehicle_make: e(rental.vehicle_make || ''),
    vehicle_model: e(rental.vehicle_model || ''),
    vehicle_year: e(String(rental.vehicle_year || '')),
    vehicle_color: e(rental.vehicle_color || ''),
    vehicle_name: e(vehicleName),
    vehicle_vin: e(rental.vehicle_vin),
    odometer_display: recordedOn ? `${odometer} (recorded ${recordedOn})` : odometer,
    retroactive_period_note: retroactivePeriodNote,
    notice_words: noticeWords,
    first_month_label: monthLabel(start),
    second_month_label: monthLabel(next),
    rate: money(rate),
    rate_decimal: money2(rate),
    first_month_payment_note: firstMonthPaymentNote,
    deposit: money(deposit),
    deposit_deductible_note: depositDeductibleNote,
    insurance_start: fmtDate(terms.insurance_start_date!),
    mileage_limit: Number(rental.monthly_mileage_limit ?? 1000).toLocaleString('en-US'),
    overage_rate: money2(Number(rental.mileage_overage_rate ?? 0.15)),
    odometer_note: odometerNote,
    deductible: money(deductible),
    deductible_deposit_ref: deductibleDepositRef,
    late_fee: money(Number(rental.late_return_hourly_rate ?? 20)),
    damage_block: damageBlock,
    damage_photos_block: damagePhotosBlock,
    damage_condition_note: `<span style="color:#666;font-size:0.9em;font-style:italic;">${conditionNote}</span>`,
    due_on_execution: money(deposit + rate),
    landlord_signature_img: await ownerSignatureHtml(supabase, signingDate),
    signing_date: signingDate,
  };

  const vehicleLabel = [rental.vehicle_year, rental.vehicle_make, rental.vehicle_model]
    .filter(Boolean).join(' ') + (vehicleName ? ` "${vehicleName}"` : '');

  return {
    html: parseMarkdownTemplate(template.content, data),
    templateId: template.id,
    templateVersion: template.version,
    signerName,
    signerEmail,
    vehicleLabel,
  };
}

/**
 * The owner's pre-signature, from the same config the lease pipeline uses
 * (config.landlord_signature, uploaded via /admin/landlord-signature.html).
 */
async function ownerSignatureHtml(supabase: any, dateLabel: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('config').select('value').eq('key', 'landlord_signature').single();
    const cfg = data?.value || {};
    const name = escapeHtml(cfg.name || 'Rahul Sonnad');
    if (cfg.signature_image_url) {
      const url = String(cfg.signature_image_url).replace(/"/g, '&quot;');
      return `<img src="${url}" alt="Owner signature: ${name}" style="max-width:260px;max-height:80px;display:block;border:0;background:transparent;"/><span style="display:block;font-size:11px;color:#888;margin-top:4px;border-top:1px solid #ccc;padding-top:4px;">Pre-signed ${dateLabel}</span>`;
    }
    return `<span style="font-family:'Brush Script MT','Snell Roundhand',cursive;font-size:30px;color:#1c4a3e;">${name}</span><span style="display:block;font-size:11px;color:#888;">Pre-signed ${dateLabel}</span>`;
  } catch (_e) {
    return `<span style="font-family:'Brush Script MT','Snell Roundhand',cursive;font-size:30px;color:#1c4a3e;">Rahul Sonnad</span><span style="display:block;font-size:11px;color:#888;">Pre-signed ${dateLabel}</span>`;
  }
}

export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Same markdown subset and output shape as get-signing-document's lease
 * parser. Values are substituted as-is: callers escape anything that came
 * from a database text field before passing it in.
 */
function parseMarkdownTemplate(template: string, data: Record<string, string>): string {
  let content = template;
  for (const [key, value] of Object.entries(data)) {
    content = content.split(`{{${key}}}`).join(value ?? '');
  }
  const leftover = content.match(/\{\{\w+\}\}/g);
  if (leftover) throw new Error(`Unfilled template placeholders: ${[...new Set(leftover)].join(', ')}`);

  const htmlParts: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { htmlParts.push('</ul>'); inList = false; } };

  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) { closeList(); htmlParts.push('<br>'); continue; }
    if (t === '---' || t === '***') { closeList(); htmlParts.push('<hr>'); continue; }
    if (t.startsWith('### ')) { closeList(); htmlParts.push(`<h3>${boldify(t.slice(4))}</h3>`); continue; }
    if (t.startsWith('## ')) { closeList(); htmlParts.push(`<h2>${boldify(t.slice(3))}</h2>`); continue; }
    if (t.startsWith('# ')) { closeList(); htmlParts.push(`<h1>${boldify(t.slice(2))}</h1>`); continue; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${boldify(t.slice(2))}</li>`);
      continue;
    }
    closeList();
    htmlParts.push(`<p>${boldify(t)}</p>`);
  }
  closeList();
  return htmlParts.join('\n');
}

function boldify(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
