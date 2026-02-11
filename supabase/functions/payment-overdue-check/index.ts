/**
 * Payment Overdue Check
 * Detects overdue rent and event payments, sends escalating reminders
 * to both the payer and alpacaplayhouse@gmail.com.
 *
 * Reminders include a table of all overdue periods, a "Pay Now" button
 * linking to /pay with prefilled params, and branded payment method cards.
 *
 * Escalation: day 1 (friendly), day 3 (firm), day 7+ (urgent)
 *
 * Trigger: Daily via pg_cron at 10 AM CT (3 PM UTC)
 * Deploy: supabase functions deploy payment-overdue-check
 * Manual: curl -X POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/payment-overdue-check -H "Authorization: Bearer <anon_key>"
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'alpacaplayhouse@gmail.com';
const ESCALATION_DAYS = [1, 3, 7]; // days after due date
const PAY_BASE_URL = 'https://alpacaplayhouse.com/pay/';

interface OverdueItem {
  sourceType: string;
  sourceId: string;
  personId: string;
  personEmail: string;
  personFirstName: string;
  personLastName: string;
  periodLabel: string;
  amountDue: number;
  dueDate: string; // YYYY-MM-DD
  daysOverdue: number;
  rateTerm?: string;
}

function getEscalationLevel(daysOverdue: number): number | null {
  if (daysOverdue >= 7) return 3;
  if (daysOverdue >= 3) return 2;
  if (daysOverdue >= 1) return 1;
  return null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2).replace(/\.00$/, '')}`;
}

/** Compute current rent due dates for an assignment */
function computeRentDueDates(assignment: {
  start_date: string;
  end_date: string | null;
  rate_term: string;
  rate_amount: number;
}): { dueDate: string; periodStart: string; periodEnd: string; amount: number; label: string }[] {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(assignment.start_date + 'T12:00:00');
  const endDate = assignment.end_date ? new Date(assignment.end_date + 'T12:00:00') : null;
  const dues: { dueDate: string; periodStart: string; periodEnd: string; amount: number; label: string }[] = [];

  if (assignment.rate_term === 'monthly') {
    let year = start.getFullYear();
    let month = start.getMonth();
    if (start.getDate() > 1) {
      month++;
      if (month > 11) { month = 0; year++; }
    }
    while (true) {
      const dueDate = new Date(year, month, 1, 12, 0, 0);
      if (dueDate > today) break;
      if (endDate && dueDate > endDate) break;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const label = dueDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      dues.push({ dueDate: periodStart, periodStart, periodEnd, amount: assignment.rate_amount, label });
      month++;
      if (month > 11) { month = 0; year++; }
    }
  } else if (assignment.rate_term === 'weekly' || assignment.rate_term === 'biweekly') {
    const intervalDays = assignment.rate_term === 'weekly' ? 7 : 14;
    const cursor = new Date(start);
    while (true) {
      const periodStart = cursor.toISOString().split('T')[0];
      const nextCursor = new Date(cursor);
      nextCursor.setDate(nextCursor.getDate() + intervalDays);
      const periodEnd = new Date(nextCursor);
      periodEnd.setDate(periodEnd.getDate() - 1);
      if (cursor > today) break;
      if (endDate && cursor > endDate) break;
      const ps = new Date(periodStart + 'T12:00:00');
      const pe = new Date(periodEnd.toISOString().split('T')[0] + 'T12:00:00');
      const label = `${ps.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${pe.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      dues.push({
        dueDate: periodStart,
        periodStart,
        periodEnd: periodEnd.toISOString().split('T')[0],
        amount: assignment.rate_amount,
        label,
      });
      cursor.setDate(cursor.getDate() + intervalDays);
    }
  }
  return dues;
}

/** Build the "Pay Now" URL with all params */
function buildPayUrl(opts: {
  amount: number;
  personId: string;
  personName: string;
  email: string;
  description: string;
  paymentType: string;
  referenceType: string;
  referenceId: string;
}): string {
  const p = new URLSearchParams();
  p.set('amount', String(opts.amount));
  p.set('person_id', opts.personId);
  p.set('person_name', opts.personName);
  p.set('email', opts.email);
  p.set('description', opts.description);
  p.set('payment_type', opts.paymentType);
  p.set('reference_type', opts.referenceType);
  p.set('reference_id', opts.referenceId);
  return `${PAY_BASE_URL}?${p.toString()}`;
}

/** Build branded payment method cards HTML for emails */
function buildPaymentMethodCardsHtml(
  methods: { name: string; method_type: string; account_identifier: string | null; instructions: string | null }[],
  memoText: string,
): string {
  const METHOD_STYLES: Record<string, { bg: string; border: string }> = {
    venmo: { bg: '#f0f7fc', border: '#3d95ce' },
    zelle: { bg: '#f3edfc', border: '#6c1cd3' },
    paypal: { bg: '#eef1f8', border: '#003087' },
    bank_ach: { bg: '#f5f5f5', border: '#333333' },
    cash: { bg: '#f0f7f0', border: '#2e7d32' },
    check: { bg: '#f5f5f5', border: '#555555' },
  };

  return methods.map(m => {
    const style = METHOD_STYLES[m.method_type] || { bg: '#f5f5f5', border: '#888' };
    const id = m.account_identifier || '';
    const instr = (m.instructions || '').split('\n').filter(Boolean);
    // Build detail line
    let detail = '';
    if (id) detail += `<strong>${id}</strong>`;
    if (instr.length > 0) {
      const instrText = instr[0].replace(/"/g, '&quot;');
      if (detail) detail += ` &middot; `;
      detail += instrText;
    }
    if (memoText) {
      if (detail) detail += ` &middot; `;
      detail += `Include "${memoText}" in memo`;
    }

    return `<div style="background:${style.bg};border:2px solid ${style.border};border-radius:10px;padding:14px 18px;margin-bottom:8px;text-align:center;">
      <div style="font-weight:700;font-size:15px;color:#333;margin-bottom:2px;">${m.name}${id ? ` &mdash; ${id}` : ''}</div>
      ${detail ? `<div style="font-size:13px;color:#666;">${detail.replace(id ? `<strong>${id}</strong> &middot; ` : '', '')}</div>` : ''}
    </div>`;
  }).join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    console.log(`Payment overdue check running for ${todayStr}`);

    // ========== A. Detect overdue rent ==========
    const { data: activeAssignments, error: assignError } = await supabase
      .from('assignments')
      .select(`
        id, status, start_date, end_date, rate_amount, rate_term, is_free, monthly_rent,
        person:person_id (id, first_name, last_name, email)
      `)
      .eq('status', 'active')
      .eq('is_free', false);

    if (assignError) {
      console.error('Error querying assignments:', assignError);
      throw assignError;
    }

    // Get space names for assignments
    const assignmentSpaceNames = new Map<string, string>();
    if (activeAssignments?.length) {
      const assignIds = activeAssignments.map(a => a.id);
      const { data: aspaces } = await supabase
        .from('assignment_spaces')
        .select('assignment_id, space:space_id(name)')
        .in('assignment_id', assignIds);
      for (const as of (aspaces || [])) {
        const sp = as.space as { name: string } | null;
        if (sp?.name) assignmentSpaceNames.set(as.assignment_id, sp.name);
      }
    }

    const overdueItems: OverdueItem[] = [];

    for (const assignment of (activeAssignments || [])) {
      const person = assignment.person as { id: string; first_name: string; last_name: string; email: string } | null;
      if (!person?.email) continue;
      if (!assignment.start_date) continue;
      if (assignment.rate_term === 'flat') continue;

      const effectiveRate = assignment.rate_amount || assignment.monthly_rent || 0;
      if (effectiveRate <= 0) continue;

      const dueDates = computeRentDueDates({
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        rate_term: assignment.rate_term,
        rate_amount: effectiveRate,
      });

      // For each due date, check if paid
      for (const due of dueDates) {
        const dueD = new Date(due.dueDate + 'T12:00:00');
        const diffMs = today.getTime() - dueD.getTime();
        const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (daysOverdue < 1) continue;
        if (daysOverdue > 30) continue;

        // Check ledger for a matching completed payment
        const { data: payments } = await supabase
          .from('ledger')
          .select('id, amount, period_start, period_end')
          .in('category', ['rent', 'prorated_rent'])
          .eq('status', 'completed')
          .eq('is_test', false)
          .or(`assignment_id.eq.${assignment.id},person_id.eq.${person.id}`)
          .gte('period_end', due.periodStart)
          .lte('period_start', due.periodEnd);

        const { data: unlinkedPayments } = await supabase
          .from('ledger')
          .select('id, amount, transaction_date')
          .in('category', ['rent', 'prorated_rent'])
          .eq('status', 'completed')
          .eq('is_test', false)
          .eq('person_id', person.id)
          .is('period_start', null)
          .gte('transaction_date', due.periodStart)
          .lte('transaction_date', due.periodEnd);

        const hasPeriodPayment = payments && payments.length > 0;
        const hasUnlinkedPayment = unlinkedPayments && unlinkedPayments.length > 0;

        if (!hasPeriodPayment && !hasUnlinkedPayment) {
          overdueItems.push({
            sourceType: 'rent',
            sourceId: assignment.id,
            personId: person.id,
            personEmail: person.email,
            personFirstName: person.first_name,
            personLastName: person.last_name,
            periodLabel: due.label,
            amountDue: due.amount,
            dueDate: due.dueDate,
            daysOverdue,
            rateTerm: assignment.rate_term,
          });
        }
      }
    }

    // ========== B. Detect overdue event fees ==========
    const { data: events, error: eventsError } = await supabase
      .from('event_hosting_requests')
      .select(`
        id, event_name, event_date,
        rental_fee, cleaning_deposit, reservation_fee,
        rental_fee_paid, cleaning_deposit_paid, reservation_fee_paid,
        request_status,
        person:person_id (id, first_name, last_name, email)
      `)
      .eq('request_status', 'approved')
      .or('is_archived.is.null,is_archived.eq.false')
      .gte('event_date', todayStr);

    if (eventsError) {
      console.error('Error querying events:', eventsError);
      throw eventsError;
    }

    for (const event of (events || [])) {
      const person = event.person as { id: string; first_name: string; last_name: string; email: string } | null;
      if (!person?.email) continue;

      const eventDate = new Date(event.event_date + 'T12:00:00');
      const feeDueDate = new Date(eventDate);
      feeDueDate.setDate(feeDueDate.getDate() - 7);
      const feeDueDateStr = feeDueDate.toISOString().split('T')[0];

      if (today < feeDueDate) continue;

      const daysOverdue = Math.floor((today.getTime() - feeDueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue < 1) continue;

      const feeTypes = [
        { type: 'event_rental_fee', paid: event.rental_fee_paid, amount: event.rental_fee || 295, label: 'Rental Fee' },
        { type: 'event_cleaning_deposit', paid: event.cleaning_deposit_paid, amount: event.cleaning_deposit || 195, label: 'Cleaning Deposit' },
        { type: 'event_reservation_fee', paid: event.reservation_fee_paid, amount: event.reservation_fee || 95, label: 'Reservation Fee' },
      ];

      for (const fee of feeTypes) {
        if (fee.paid) continue;
        overdueItems.push({
          sourceType: fee.type,
          sourceId: event.id,
          personId: person.id,
          personEmail: person.email,
          personFirstName: person.first_name,
          personLastName: person.last_name,
          periodLabel: `${event.event_name} - ${fee.label}`,
          amountDue: fee.amount,
          dueDate: feeDueDateStr,
          daysOverdue,
        });
      }
    }

    console.log(`Found ${overdueItems.length} overdue items`);

    if (overdueItems.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No overdue payments found', date: todayStr }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== C. Group by person and filter by escalation ==========
    const { data: existingReminders } = await supabase
      .from('payment_reminders')
      .select('source_type, source_id, due_date, escalation_level, recipient_type')
      .in('status', ['sent']);

    const reminderMap = new Map<string, number>();
    for (const r of (existingReminders || [])) {
      const key = `${r.source_type}:${r.source_id}:${r.due_date}:${r.recipient_type}`;
      const current = reminderMap.get(key) || 0;
      if (r.escalation_level > current) reminderMap.set(key, r.escalation_level);
    }

    // Get payment methods for email
    const { data: paymentMethods } = await supabase
      .from('payment_methods')
      .select('name, method_type, account_identifier, instructions')
      .eq('is_active', true)
      .order('display_order');

    // Group overdue items by person
    const personGroups = new Map<string, OverdueItem[]>();
    for (const item of overdueItems) {
      const level = getEscalationLevel(item.daysOverdue);
      if (!level) continue;

      const payerKey = `${item.sourceType}:${item.sourceId}:${item.dueDate}:payer`;
      const maxPayerLevel = reminderMap.get(payerKey) || 0;
      if (level <= maxPayerLevel) continue;

      if (!personGroups.has(item.personId)) {
        personGroups.set(item.personId, []);
      }
      personGroups.get(item.personId)!.push(item);
    }

    // ========== D. Send grouped reminders ==========
    let remindersSent = 0;
    let skipped = 0;
    let errors = 0;
    const adminDigestItems: OverdueItem[] = [];

    // Pre-fetch ID verification status for all persons with overdue items
    const personIdVerification = new Map<string, { needsId: boolean; uploadUrl: string | null }>();
    for (const [personId] of personGroups) {
      try {
        const { data: apps } = await supabase
          .from('rental_applications')
          .select('identity_verification_status')
          .eq('person_id', personId)
          .order('created_at', { ascending: false })
          .limit(1);
        const latestApp = apps?.[0];
        const needsId = !latestApp || latestApp.identity_verification_status !== 'verified';
        let uploadUrl: string | null = null;
        if (needsId) {
          // Generate an upload token (7-day expiry)
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);
          const { data: tokenData } = await supabase
            .from('upload_tokens')
            .insert({
              person_id: personId,
              token_type: 'identity_verification',
              expires_at: expiresAt.toISOString(),
            })
            .select('token')
            .single();
          if (tokenData?.token) {
            uploadUrl = `https://alpacaplayhouse.com/spaces/verify.html?token=${tokenData.token}`;
          }
        }
        personIdVerification.set(personId, { needsId, uploadUrl });
      } catch (e) {
        console.warn(`Could not check ID verification for person ${personId}:`, e);
        personIdVerification.set(personId, { needsId: false, uploadUrl: null });
      }
    }

    for (const [personId, items] of personGroups) {
      const first = items[0];
      const totalDue = items.reduce((sum, i) => sum + i.amountDue, 0);
      const maxDaysOverdue = Math.max(...items.map(i => i.daysOverdue));
      const level = getEscalationLevel(maxDaysOverdue)!;
      const periodsCount = items.length;

      // Look up space name
      const spaceName = assignmentSpaceNames.get(first.sourceId) || 'your space';

      // ID verification info
      const idInfo = personIdVerification.get(personId) || { needsId: false, uploadUrl: null };

      // Build table rows for each overdue period
      const periodRows = items.map(item => {
        const statusColor = item.daysOverdue >= 7 ? '#c62828' : item.daysOverdue >= 1 ? '#e65100' : '#888';
        const statusText = item.daysOverdue > 0 ? `${item.daysOverdue} days overdue` : 'Due today';
        return `<tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;">${item.periodLabel}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:center;color:#333;font-weight:600;font-size:14px;">${formatCurrency(item.amountDue)}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:right;"><span style="color:${statusColor};font-size:13px;font-weight:600;">${statusText}</span></td>
        </tr>`;
      }).join('\n');

      // Determine tone
      let headerBg: string;
      let headerSubtext: string;
      let subject: string;
      let introText: string;

      if (level === 1) {
        headerBg = 'linear-gradient(135deg, #2d3024 0%, #3a3f30 100%)';
        headerSubtext = 'Rent Payment Reminder';
        subject = `Rent Payment Due - ${formatCurrency(totalDue)} - ${first.personFirstName} - Alpaca Playhouse`;
        introText = `This is a friendly reminder that you have <strong>${periodsCount} ${periodsCount === 1 ? 'week' : 'weeks'} of rent</strong> outstanding for the <strong>${spaceName}</strong>.`;
      } else if (level === 2) {
        headerBg = 'linear-gradient(135deg, #5d4037 0%, #4e342e 100%)';
        headerSubtext = 'Rent Payment Follow-Up';
        subject = `Rent Payment Follow-Up - ${formatCurrency(totalDue)} - ${first.personFirstName} - Alpaca Playhouse`;
        introText = `This is a follow-up regarding <strong>${periodsCount} ${periodsCount === 1 ? 'period' : 'periods'} of rent</strong> outstanding for the <strong>${spaceName}</strong>. Please submit payment at your earliest convenience.`;
      } else {
        headerBg = 'linear-gradient(135deg, #b71c1c 0%, #c62828 100%)';
        headerSubtext = 'Urgent: Rent Payment Overdue';
        subject = `URGENT: Rent Payment Overdue - ${formatCurrency(totalDue)} - ${first.personFirstName} - Alpaca Playhouse`;
        introText = `You have <strong>${periodsCount} ${periodsCount === 1 ? 'period' : 'periods'} of overdue rent</strong> totaling <strong>${formatCurrency(totalDue)}</strong> for the <strong>${spaceName}</strong>. Please submit payment immediately to avoid additional fees.`;
      }

      // Build pay URL
      const payUrl = buildPayUrl({
        amount: totalDue,
        personId: first.personId,
        personName: `${first.personFirstName} ${first.personLastName}`,
        email: first.personEmail,
        description: `${periodsCount === 1 ? items[0].periodLabel : periodsCount + ' periods'} rent`,
        paymentType: 'rent',
        referenceType: 'assignment',
        referenceId: first.sourceId,
      });

      // Build memo text
      const memoText = `${first.personFirstName} rent`;

      // Build payment method cards
      const methodCardsHtml = buildPaymentMethodCardsHtml(paymentMethods || [], memoText);

      const emailHtml = `
        <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <div style="background:${headerBg};padding:28px 32px;text-align:center;">
            <h1 style="color:white;margin:0;font-size:22px;font-weight:600;">Alpaca Playhouse</h1>
            <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:14px;">${headerSubtext}</p>
          </div>
          <div style="padding:28px 32px;">
            <p style="color:#333;font-size:15px;margin-bottom:4px;">Hi ${first.personFirstName},</p>
            <p style="color:#555;font-size:14px;line-height:1.5;margin-bottom:20px;">${introText}</p>

            <table style="border-collapse:collapse;width:100%;margin-bottom:4px;">
              <thead>
                <tr style="background:#f8f9fa;">
                  <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Period</th>
                  <th style="padding:10px 16px;text-align:center;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Amount</th>
                  <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${periodRows}
              </tbody>
            </table>
            <div style="background:#f8f9fa;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;border-radius:0 0 8px 8px;margin-bottom:24px;">
              <span style="font-weight:600;color:#333;font-size:14px;">Total Due</span>
              <span style="font-weight:800;color:#333;font-size:20px;">${formatCurrency(totalDue)}</span>
            </div>

            <div style="text-align:center;margin-bottom:8px;">
              <p style="color:#555;font-size:14px;font-weight:600;margin-bottom:12px;">Fastest way to pay:</p>
              <a href="${payUrl}" style="display:inline-block;background:linear-gradient(135deg,#2d3024 0%,#3a3f30 100%);color:white;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:17px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(45,48,36,0.25);">Pay ${formatCurrency(totalDue)} Now</a>
              <p style="color:#999;font-size:12px;margin-top:8px;">Credit card, debit card, or bank transfer (ACH)</p>
            </div>

            ${(paymentMethods || []).length > 0 ? `
            <div style="text-align:center;color:#aaa;font-size:13px;margin:20px 0;border-top:1px solid #eee;padding-top:20px;">or pay with</div>
            ${methodCardsHtml}
            ` : ''}

            ${idInfo.needsId ? `
            <div style="margin:20px 0;padding:16px;background:#fff8e1;border-left:4px solid #f9a825;border-radius:4px;">
              <p style="margin:0 0 8px;font-weight:bold;color:#333;">ID Verification Required</p>
              <p style="margin:0;color:#555;font-size:14px;">We also need a copy of your government-issued photo ID to complete your rental setup.</p>
              ${idInfo.uploadUrl
                ? `<p style="margin:12px 0 0;"><a href="${idInfo.uploadUrl}" style="display:inline-block;padding:10px 20px;background:#f9a825;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Upload Your ID</a></p>`
                : `<p style="margin:8px 0 0;color:#555;font-size:14px;">Please reply to this email with a photo of your ID.</p>`}
            </div>
            ` : ''}

            <p style="color:#888;font-size:13px;margin-top:20px;line-height:1.5;">If you've already sent payment, please disregard this notice &mdash; it may take a day to process.</p>
            <p style="color:#555;font-size:14px;margin-top:8px;">Best regards,<br><strong>Alpaca Playhouse</strong></p>
          </div>
          <div style="background:#f5f5f5;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">160 Still Forest Drive, Cedar Creek, TX 78612</p>
          </div>
        </div>
      `;

      const payMethodsText = (paymentMethods || []).map(pm => {
        let line = `- ${pm.name}`;
        if (pm.account_identifier) line += `: ${pm.account_identifier}`;
        if (pm.instructions) line += ` (${pm.instructions.split('\n')[0]})`;
        return line;
      }).join('\n');

      const emailText = `${headerSubtext}

Hi ${first.personFirstName},

You have ${periodsCount} ${periodsCount === 1 ? 'period' : 'periods'} of rent outstanding for the ${spaceName}.

${items.map(i => `  ${i.periodLabel}: ${formatCurrency(i.amountDue)} (${i.daysOverdue}d overdue)`).join('\n')}

Total Due: ${formatCurrency(totalDue)}

Pay now: ${payUrl}

Or pay with:
${payMethodsText}

Please include "${memoText}" in the payment memo.
${idInfo.needsId ? `
ID VERIFICATION REQUIRED
We also need a copy of your government-issued photo ID to complete your rental setup.
${idInfo.uploadUrl ? `Upload here: ${idInfo.uploadUrl}` : 'Please reply to this email with a photo of your ID.'}
` : ''}
If you've already sent payment, please disregard this notice.

Best regards,
Alpaca Playhouse`;

      // --- Send to payer ---
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Alpaca Team <team@alpacaplayhouse.com>',
            to: [first.personEmail],
            reply_to: 'team@alpacaplayhouse.com',
            subject,
            html: emailHtml,
            text: emailText,
          }),
        });

        if (emailRes.ok) {
          const resendData = await emailRes.json();
          // Record reminder for each item in this group
          for (const item of items) {
            await supabase.from('payment_reminders').insert({
              source_type: item.sourceType,
              source_id: item.sourceId,
              person_id: item.personId,
              period_label: item.periodLabel,
              amount_due: item.amountDue,
              due_date: item.dueDate,
              days_overdue: item.daysOverdue,
              channel: 'email',
              recipient: item.personEmail,
              recipient_type: 'payer',
              status: 'sent',
              escalation_level: level,
              metadata: { resend_id: resendData.id, grouped: true, total_due: totalDue },
            });
          }
          remindersSent += items.length;
          adminDigestItems.push(...items);
          console.log(`Sent L${level} grouped reminder (${items.length} periods, ${formatCurrency(totalDue)}) to ${first.personEmail}`);
        } else {
          const errBody = await emailRes.json();
          console.error(`Failed to send to ${first.personEmail}:`, errBody);
          for (const item of items) {
            await supabase.from('payment_reminders').insert({
              source_type: item.sourceType,
              source_id: item.sourceId,
              person_id: item.personId,
              period_label: item.periodLabel,
              amount_due: item.amountDue,
              due_date: item.dueDate,
              days_overdue: item.daysOverdue,
              channel: 'email',
              recipient: item.personEmail,
              recipient_type: 'payer',
              status: 'failed',
              escalation_level: level,
              error_message: JSON.stringify(errBody),
            });
          }
          errors++;
        }
      } catch (err) {
        console.error(`Error sending to ${first.personEmail}:`, err);
        errors++;
      }
    }

    // --- Send admin digest ---
    if (adminDigestItems.length > 0) {
      try {
        // Group by person for admin digest
        const personSummaries = new Map<string, { name: string; items: OverdueItem[]; total: number }>();
        for (const item of adminDigestItems) {
          const key = item.personId;
          if (!personSummaries.has(key)) {
            personSummaries.set(key, {
              name: `${item.personFirstName} ${item.personLastName}`,
              items: [],
              total: 0,
            });
          }
          const s = personSummaries.get(key)!;
          s.items.push(item);
          s.total += item.amountDue;
        }

        const totalOverdue = adminDigestItems.reduce((sum, i) => sum + i.amountDue, 0);

        const itemRows = Array.from(personSummaries.values()).map(s => {
          const maxDays = Math.max(...s.items.map(i => i.daysOverdue));
          const level = getEscalationLevel(maxDays);
          const levelLabel = level === 1 ? 'Friendly' : level === 2 ? 'Firm' : 'Urgent';
          return `<tr>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${s.name}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${s.items.length} period${s.items.length > 1 ? 's' : ''}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${formatCurrency(s.total)}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${maxDays}d</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${levelLabel}</td>
          </tr>`;
        }).join('\n');

        const adminEmailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Alpaca System <auto@alpacaplayhouse.com>',
            to: [ADMIN_EMAIL],
            subject: `Late Payment Report: ${personSummaries.size} tenant${personSummaries.size > 1 ? 's' : ''} (${formatCurrency(totalOverdue)})`,
            html: `
              <h2>Late Payment Report - ${formatDate(todayStr)}</h2>
              <p>${adminDigestItems.length} overdue period${adminDigestItems.length > 1 ? 's' : ''} across ${personSummaries.size} tenant${personSummaries.size > 1 ? 's' : ''} totaling <strong>${formatCurrency(totalOverdue)}</strong>. Reminders have been sent.</p>

              <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
                <thead>
                  <tr style="background: #f0f0f0;">
                    <th style="padding: 8px 10px; text-align: left;">Tenant</th>
                    <th style="padding: 8px 10px; text-align: left;">Periods</th>
                    <th style="padding: 8px 10px; text-align: left;">Amount</th>
                    <th style="padding: 8px 10px; text-align: left;">Max Overdue</th>
                    <th style="padding: 8px 10px; text-align: left;">Level</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <p style="color: #666; font-size: 0.9em;">This is an automated report from the payment overdue checker.</p>
            `,
            text: `Late Payment Report - ${formatDate(todayStr)}

${adminDigestItems.length} overdue payments totaling ${formatCurrency(totalOverdue)}.

${Array.from(personSummaries.values()).map(s => {
  const maxDays = Math.max(...s.items.map(i => i.daysOverdue));
  return `- ${s.name}: ${s.items.length} periods, ${formatCurrency(s.total)} (${maxDays}d overdue)`;
}).join('\n')}

Reminders have been sent.`,
          }),
        });

        if (adminEmailRes.ok) {
          const resendData = await adminEmailRes.json();
          await supabase.from('payment_reminders').insert({
            source_type: 'admin_digest',
            source_id: null,
            person_id: null,
            period_label: `${adminDigestItems.length} overdue payments`,
            amount_due: totalOverdue,
            due_date: todayStr,
            days_overdue: 0,
            channel: 'email',
            recipient: ADMIN_EMAIL,
            recipient_type: 'admin',
            status: 'sent',
            escalation_level: 0,
            metadata: { resend_id: resendData.id, items: adminDigestItems.length },
          });
          console.log(`Admin digest sent to ${ADMIN_EMAIL}`);
        } else {
          const errBody = await adminEmailRes.json();
          console.error('Failed to send admin digest:', errBody);
        }
      } catch (err) {
        console.error('Error sending admin digest:', err);
      }
    }

    // ========== E. Log API usage ==========
    const emailsSent = personGroups.size + (adminDigestItems.length > 0 ? 1 : 0);
    if (emailsSent > 0) {
      await supabase.from('api_usage_log').insert({
        vendor: 'resend',
        category: 'email_payment_reminder',
        endpoint: 'emails',
        units: emailsSent,
        unit_type: 'emails',
        estimated_cost_usd: emailsSent * 0.00028,
        metadata: { overdue_items: overdueItems.length, reminders_sent: remindersSent, skipped, persons: personGroups.size },
      });
    }

    const result = {
      success: true,
      date: todayStr,
      overdueFound: overdueItems.length,
      personsNotified: personGroups.size,
      remindersSent,
      skipped,
      errors,
      adminDigestSent: adminDigestItems.length > 0,
    };

    console.log('Payment overdue check complete:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Payment overdue check error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
