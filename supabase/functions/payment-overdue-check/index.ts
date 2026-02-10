/**
 * Payment Overdue Check
 * Detects overdue rent and event payments, sends escalating reminders
 * to both the payer and alpacaplayhouse@gmail.com.
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
  // Return the highest escalation level that applies
  // 1 = day 1+, 2 = day 3+, 3 = day 7+
  if (daysOverdue >= 7) return 3;
  if (daysOverdue >= 3) return 2;
  if (daysOverdue >= 1) return 1;
  return null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
}): { dueDate: string; periodStart: string; periodEnd: string; amount: number }[] {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const start = new Date(assignment.start_date + 'T12:00:00');
  const endDate = assignment.end_date ? new Date(assignment.end_date + 'T12:00:00') : null;
  const dues: { dueDate: string; periodStart: string; periodEnd: string; amount: number }[] = [];

  if (assignment.rate_term === 'monthly') {
    // Due on the 1st of each month, starting from the month of or after start_date
    let year = start.getFullYear();
    let month = start.getMonth();
    // If start_date is after the 1st, first full month is next month
    if (start.getDate() > 1) {
      month++;
      if (month > 11) { month = 0; year++; }
    }

    while (true) {
      const dueDate = new Date(year, month, 1, 12, 0, 0);
      if (dueDate > today) break; // only look at past/current due dates
      if (endDate && dueDate > endDate) break;

      const lastDay = new Date(year, month + 1, 0).getDate();
      const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      dues.push({
        dueDate: periodStart,
        periodStart,
        periodEnd,
        amount: assignment.rate_amount,
      });

      month++;
      if (month > 11) { month = 0; year++; }
    }
  } else if (assignment.rate_term === 'weekly' || assignment.rate_term === 'biweekly') {
    const intervalDays = assignment.rate_term === 'weekly' ? 7 : 14;
    let cursor = new Date(start);

    while (true) {
      const periodStart = cursor.toISOString().split('T')[0];
      const nextCursor = new Date(cursor);
      nextCursor.setDate(nextCursor.getDate() + intervalDays);
      const periodEnd = new Date(nextCursor);
      periodEnd.setDate(periodEnd.getDate() - 1);

      // Due date = first day of the period
      if (cursor > today) break;
      if (endDate && cursor > endDate) break;

      dues.push({
        dueDate: periodStart,
        periodStart,
        periodEnd: periodEnd.toISOString().split('T')[0],
        amount: assignment.rate_amount,
      });

      cursor.setDate(cursor.getDate() + intervalDays);
    }
  }
  // 'flat' rate_term = one-time, skip

  return dues;
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
        if (daysOverdue < 1) continue; // not yet overdue
        if (daysOverdue > 30) continue; // too old, skip historical periods

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

        // Also check for payments without period but matching person + approximate date
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
          // Build period label
          let periodLabel: string;
          if (assignment.rate_term === 'monthly') {
            const d = new Date(due.periodStart + 'T12:00:00');
            periodLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          } else {
            periodLabel = `Week of ${formatDate(due.periodStart)}`;
          }

          overdueItems.push({
            sourceType: 'rent',
            sourceId: assignment.id,
            personId: person.id,
            personEmail: person.email,
            personFirstName: person.first_name,
            personLastName: person.last_name,
            periodLabel,
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
      .gte('event_date', todayStr); // only upcoming/today events

    if (eventsError) {
      console.error('Error querying events:', eventsError);
      throw eventsError;
    }

    for (const event of (events || [])) {
      const person = event.person as { id: string; first_name: string; last_name: string; email: string } | null;
      if (!person?.email) continue;

      // Event fee due date = 7 days before event
      const eventDate = new Date(event.event_date + 'T12:00:00');
      const feeDueDate = new Date(eventDate);
      feeDueDate.setDate(feeDueDate.getDate() - 7);
      const feeDueDateStr = feeDueDate.toISOString().split('T')[0];

      if (today < feeDueDate) continue; // not yet due

      const daysOverdue = Math.floor((today.getTime() - feeDueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue < 1) continue;

      // Check each fee type
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

    // ========== C. Filter by escalation + dedup ==========
    // Load all existing reminders for these source items
    const sourceKeys = overdueItems.map(i => `${i.sourceType}:${i.sourceId}:${i.dueDate}`);
    const { data: existingReminders } = await supabase
      .from('payment_reminders')
      .select('source_type, source_id, due_date, escalation_level, recipient_type')
      .in('status', ['sent']);

    // Build lookup: "sourceType:sourceId:dueDate:recipientType" -> max escalation sent
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

    const paymentMethodsHtml = (paymentMethods || []).map(pm => {
      let line = `<li><strong>${pm.name}</strong>`;
      if (pm.account_identifier) line += `: ${pm.account_identifier}`;
      if (pm.instructions) line += `<br><span style="color: #666; font-size: 0.9em;">${pm.instructions}</span>`;
      line += '</li>';
      return line;
    }).join('\n');

    const paymentMethodsText = (paymentMethods || []).map(pm => {
      let line = `- ${pm.name}`;
      if (pm.account_identifier) line += `: ${pm.account_identifier}`;
      if (pm.instructions) line += ` (${pm.instructions})`;
      return line;
    }).join('\n');

    // ========== D. Send reminders ==========
    let remindersSent = 0;
    let skipped = 0;
    let errors = 0;

    // Group overdue items by person for admin digest
    const adminDigestItems: OverdueItem[] = [];

    for (const item of overdueItems) {
      const level = getEscalationLevel(item.daysOverdue);
      if (!level) continue;

      // Check if this escalation was already sent to the payer
      const payerKey = `${item.sourceType}:${item.sourceId}:${item.dueDate}:payer`;
      const maxPayerLevel = reminderMap.get(payerKey) || 0;
      if (level <= maxPayerLevel) {
        skipped++;
        continue; // already sent this level
      }

      // Determine tone
      let subject: string;
      let toneHeading: string;
      let toneColor: string;
      let toneMessage: string;
      let urgencyNote: string;

      if (level === 1) {
        subject = `Payment Reminder: ${item.periodLabel} - Alpaca Playhouse`;
        toneHeading = 'Friendly Payment Reminder';
        toneColor = '#856404';
        toneMessage = `This is a friendly reminder that your payment of <strong>${formatCurrency(item.amountDue)}</strong> for <strong>${item.periodLabel}</strong> was due on <strong>${formatDate(item.dueDate)}</strong> and is now ${item.daysOverdue} day${item.daysOverdue > 1 ? 's' : ''} past due.`;
        urgencyNote = '';
      } else if (level === 2) {
        subject = `Payment Follow-Up: ${item.periodLabel} - Alpaca Playhouse`;
        toneHeading = 'Payment Follow-Up';
        toneColor = '#cc6600';
        toneMessage = `We noticed your payment of <strong>${formatCurrency(item.amountDue)}</strong> for <strong>${item.periodLabel}</strong> was due on <strong>${formatDate(item.dueDate)}</strong> and is now ${item.daysOverdue} days past due. Please submit payment at your earliest convenience.`;
        urgencyNote = '<p style="color: #cc6600;"><strong>This is your second reminder.</strong></p>';
      } else {
        subject = `URGENT: Payment Overdue - ${item.periodLabel} - Alpaca Playhouse`;
        toneHeading = 'Payment Overdue';
        toneColor = '#cc0000';
        toneMessage = `Your payment of <strong>${formatCurrency(item.amountDue)}</strong> for <strong>${item.periodLabel}</strong> was due on <strong>${formatDate(item.dueDate)}</strong> and is now <strong>${item.daysOverdue} days overdue</strong>. Please submit payment immediately to avoid additional fees.`;
        urgencyNote = '<p style="color: #cc0000;"><strong>This is an urgent notice. Please respond promptly.</strong></p>';
      }

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
            to: [item.personEmail],
            reply_to: 'team@alpacaplayhouse.com',
            subject,
            html: `
              <h2 style="color: ${toneColor};">${toneHeading}</h2>
              <p>Hi ${item.personFirstName},</p>
              <p>${toneMessage}</p>
              ${urgencyNote}

              <div style="background: #f8f9fa; border-left: 4px solid ${toneColor}; padding: 15px; margin: 20px 0;">
                <strong>Amount Due:</strong> ${formatCurrency(item.amountDue)}<br>
                <strong>For:</strong> ${item.periodLabel}<br>
                <strong>Due Date:</strong> ${formatDate(item.dueDate)}<br>
                <strong>Days Overdue:</strong> ${item.daysOverdue}
              </div>

              <h3>Payment Options</h3>
              <ul style="line-height: 1.8;">
                ${paymentMethodsHtml}
              </ul>
              <p><strong>Important:</strong> Please include your name and "${item.periodLabel}" in the payment memo.</p>

              <p>If you've already sent payment, please disregard this notice — it may take a day to process.</p>
              <p>If you're experiencing difficulties, please reply to this email to discuss options.</p>
              <p>Best regards,<br>Alpaca Playhouse</p>
            `,
            text: `${toneHeading}

Hi ${item.personFirstName},

Your payment of ${formatCurrency(item.amountDue)} for ${item.periodLabel} was due on ${formatDate(item.dueDate)} and is now ${item.daysOverdue} day(s) past due.

Amount Due: ${formatCurrency(item.amountDue)}
For: ${item.periodLabel}
Due Date: ${formatDate(item.dueDate)}
Days Overdue: ${item.daysOverdue}

PAYMENT OPTIONS
${paymentMethodsText}

Important: Please include your name and "${item.periodLabel}" in the payment memo.

If you've already sent payment, please disregard this notice.
If you're experiencing difficulties, please reply to this email to discuss options.

Best regards,
Alpaca Playhouse`,
          }),
        });

        if (emailRes.ok) {
          const resendData = await emailRes.json();
          // Record payer reminder
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
            metadata: { resend_id: resendData.id },
          });
          remindersSent++;
          adminDigestItems.push(item);
          console.log(`Sent L${level} reminder to ${item.personEmail} for ${item.periodLabel}`);
        } else {
          const errBody = await emailRes.json();
          console.error(`Failed to send to ${item.personEmail}:`, errBody);
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
          errors++;
        }
      } catch (err) {
        console.error(`Error sending to ${item.personEmail}:`, err);
        errors++;
      }
    }

    // --- Send admin digest ---
    if (adminDigestItems.length > 0) {
      try {
        const itemRows = adminDigestItems.map(item => {
          const level = getEscalationLevel(item.daysOverdue);
          const levelLabel = level === 1 ? 'Friendly' : level === 2 ? 'Firm' : 'Urgent';
          return `<tr>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${item.personFirstName} ${item.personLastName}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${item.periodLabel}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${formatCurrency(item.amountDue)}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${item.daysOverdue}d</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #eee;">${levelLabel}</td>
          </tr>`;
        }).join('\n');

        const totalOverdue = adminDigestItems.reduce((sum, i) => sum + i.amountDue, 0);

        const adminEmailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Alpaca System <auto@alpacaplayhouse.com>',
            to: [ADMIN_EMAIL],
            subject: `Late Payment Report: ${adminDigestItems.length} overdue (${formatCurrency(totalOverdue)})`,
            html: `
              <h2>Late Payment Report - ${formatDate(todayStr)}</h2>
              <p>${adminDigestItems.length} overdue payment${adminDigestItems.length > 1 ? 's' : ''} totaling <strong>${formatCurrency(totalOverdue)}</strong>. Reminders have been sent.</p>

              <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
                <thead>
                  <tr style="background: #f0f0f0;">
                    <th style="padding: 8px 10px; text-align: left;">Tenant</th>
                    <th style="padding: 8px 10px; text-align: left;">For</th>
                    <th style="padding: 8px 10px; text-align: left;">Amount</th>
                    <th style="padding: 8px 10px; text-align: left;">Overdue</th>
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

${adminDigestItems.map(item => {
  const level = getEscalationLevel(item.daysOverdue);
  const levelLabel = level === 1 ? 'Friendly' : level === 2 ? 'Firm' : 'Urgent';
  return `- ${item.personFirstName} ${item.personLastName}: ${item.periodLabel} - ${formatCurrency(item.amountDue)} (${item.daysOverdue}d overdue, ${levelLabel})`;
}).join('\n')}

Reminders have been sent.`,
          }),
        });

        if (adminEmailRes.ok) {
          const resendData = await adminEmailRes.json();
          // Record admin digest as a single reminder
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
    const emailsSent = remindersSent + (adminDigestItems.length > 0 ? 1 : 0);
    if (emailsSent > 0) {
      await supabase.from('api_usage_log').insert({
        vendor: 'resend',
        category: 'email_payment_reminder',
        endpoint: 'emails',
        units: emailsSent,
        unit_type: 'emails',
        estimated_cost_usd: emailsSent * 0.00028,
        metadata: { overdue_items: overdueItems.length, reminders_sent: remindersSent, skipped },
      });
    }

    const result = {
      success: true,
      date: todayStr,
      overdueFound: overdueItems.length,
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
