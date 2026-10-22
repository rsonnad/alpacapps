/**
 * Deposit Deadline Check — follow-through for the "payment due within 24
 * hours" line in the lease-signed email (process-signature).
 *
 * For signed leases whose payment is still `requested`:
 *   - 4h before the deadline: one reminder to the tenant.
 *   - After the deadline: one alert to the house inbox listing everyone newly overdue.
 * It never cancels or releases a reservation. Staff decide that.
 *
 * The deadline is payment_deadline_at when staff set one (the lease-signed
 * email shows the same date). Otherwise it is 24 hours after the later of
 * deposit_requested_at and agreement_signed_at, so a deposit requested before
 * signing still gets the full 24 hours the email promised.
 *
 * Trigger: hourly via pg_cron → public.cron_post() (X-Cron-Secret).
 * Manual (admin/oracle JWT): POST {"dry_run": true} lists who would be
 * contacted without sending or stamping anything.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import { requireCronOrRoles } from "../_shared/require-auth.ts";
import { computePaymentDueAtSigning, formatChicagoDeadline, formatMoney } from "../_shared/payment-due.ts";

const ADMIN_EMAIL = 'alpacaplayhouse@gmail.com';
const HOUR = 60 * 60 * 1000;
const REMIND_BEFORE_H = 4;
const DEFAULT_DEADLINE_H = 24;

interface Candidate {
  id: string;
  name: string;
  email: string | null;
  firstName: string;
  spaceName: string;
  amount: number;
  items: { label: string; amount: number }[];
  creditedToRent: boolean;
  clockStart: string;
  deadline: Date;
  hoursToDeadline: number;
  adminUrl: string;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const auth = await requireCronOrRoles(req, supabase, ['admin', 'oracle']);
  if (auth.response) return auth.response;

  let dryRun = false;
  try { dryRun = (await req.json())?.dry_run === true; } catch { /* empty body */ }

  try {
    const { data: apps, error } = await supabase
      .from('rental_applications')
      .select(`
        id, is_archived, require_deposit, deposit_requested_at, agreement_signed_at, payment_deadline_at,
        payment_reminder_sent_at, payment_overdue_alert_sent_at,
        reservation_deposit_amount, reservation_deposit_paid,
        move_in_deposit_amount, move_in_deposit_paid,
        security_deposit_amount, security_deposit_paid,
        application_fee_paid, application_fee_amount,
        person:person_id(first_name, last_name, email),
        approved_space:approved_space_id(name)
      `)
      .eq('agreement_status', 'signed')
      .eq('deposit_status', 'requested')
      .not('deposit_requested_at', 'is', null)
      // require_deposit is nullable; null means required (same as process-signature).
      .or('require_deposit.is.null,require_deposit.eq.true');
    if (error) throw new Error(`Query failed: ${error.message}`);

    const now = Date.now();
    const toRemind: Candidate[] = [];
    const toAlert: Candidate[] = [];

    for (const a of (apps || []) as any[]) {
      if (a.is_archived) continue;
      const due = computePaymentDueAtSigning(a, { excludePaid: true });
      if (!(due.total > 0)) continue;

      const startMs = Math.max(
        new Date(a.deposit_requested_at).getTime(),
        a.agreement_signed_at ? new Date(a.agreement_signed_at).getTime() : 0,
      );
      const deadlineMs = a.payment_deadline_at
        ? new Date(a.payment_deadline_at).getTime()
        : startMs + DEFAULT_DEADLINE_H * HOUR;
      const hoursToDeadline = (deadlineMs - now) / HOUR;
      const person = a.person || {};
      const c: Candidate = {
        id: a.id,
        name: `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown tenant',
        email: person.email || null,
        firstName: person.first_name || 'there',
        spaceName: a.approved_space?.name || 'your space',
        amount: due.total,
        items: due.items,
        creditedToRent: due.creditedToRent,
        clockStart: new Date(startMs).toISOString(),
        deadline: new Date(deadlineMs),
        hoursToDeadline: Math.round(hoursToDeadline * 10) / 10,
        adminUrl: `https://alpacaplayhouse.com/staff/rentals.html#applicant=${a.id}`,
      };

      // A stamp older than the clock start belongs to an earlier request; ignore it.
      const reminded = a.payment_reminder_sent_at && new Date(a.payment_reminder_sent_at).getTime() >= startMs;
      const alerted = a.payment_overdue_alert_sent_at && new Date(a.payment_overdue_alert_sent_at).getTime() >= startMs;

      // Tenant reminder only before the deadline; once overdue, staff follow up.
      if (!reminded && hoursToDeadline <= REMIND_BEFORE_H && hoursToDeadline > 0 && c.email) toRemind.push(c);
      if (!alerted && hoursToDeadline <= 0) toAlert.push(c);
    }

    const summarize = (list: Candidate[]) => list.map((c) => ({
      id: c.id, name: c.name, email: c.email, amount: c.amount,
      deadline: c.deadline.toISOString(), hours_to_deadline: c.hoursToDeadline, admin_url: c.adminUrl,
    }));

    if (dryRun) {
      return json({ success: true, dry_run: true, would_remind: summarize(toRemind), would_alert: summarize(toAlert) });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY not set');

    const reminded: string[] = [];
    const failed: { id: string; step: string; error: string }[] = [];

    if (toRemind.length) {
      const { data: methods } = await supabase
        .from('payment_methods')
        .select('name, account_identifier, instructions')
        .eq('is_active', true)
        .order('display_order');
      const methodsHtml = (methods || []).map((pm: any) => {
        let line = `<li><strong>${esc(pm.name)}</strong>`;
        if (pm.account_identifier) line += `: ${esc(pm.account_identifier)}`;
        if (pm.instructions) line += `<br><span style="color: #666; font-size: 0.9em;">${esc(pm.instructions)}</span>`;
        return line + '</li>';
      }).join('\n');

      for (const c of toRemind) {
        const stamp = new Date().toISOString();
        if (!await claim(supabase, c.id, 'payment_reminder_sent_at', c.clockStart, stamp)) continue;
        const err = await sendEmail(resendKey, {
          to: [c.email!],
          subject: 'Reminder: Payment Due Soon to Hold Your Reservation - Alpaca Playhouse',
          html: reminderHtml(c, methodsHtml),
        });
        if (err) {
          await release(supabase, c.id, 'payment_reminder_sent_at', stamp);
          failed.push({ id: c.id, step: 'reminder', error: err });
        } else {
          reminded.push(c.id);
        }
      }
    }

    // One digest for everyone newly overdue. Claim each row first so a
    // concurrent run can't list the same person twice.
    const alertStamp = new Date().toISOString();
    const claimed: Candidate[] = [];
    for (const c of toAlert) {
      if (await claim(supabase, c.id, 'payment_overdue_alert_sent_at', c.clockStart, alertStamp)) claimed.push(c);
    }
    let alerted: string[] = [];
    if (claimed.length) {
      const err = await sendEmail(resendKey, {
        to: [ADMIN_EMAIL],
        subject: `Payment overdue: ${claimed.length} signed lease${claimed.length === 1 ? '' : 's'} past their payment deadline`,
        html: adminAlertHtml(claimed),
      });
      if (err) {
        for (const c of claimed) await release(supabase, c.id, 'payment_overdue_alert_sent_at', alertStamp);
        failed.push(...claimed.map((c) => ({ id: c.id, step: 'admin_alert', error: err })));
      } else {
        alerted = claimed.map((c) => c.id);
      }
    }

    console.log(`deposit-deadline-check: reminded ${reminded.length}, alerted ${alerted.length}, failed ${failed.length}`);
    return json({ success: failed.length === 0, reminded, alerted, failed });
  } catch (e) {
    console.error('deposit-deadline-check error:', e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});

/** Stamp the column only if no stamp for this request exists yet. True if this run won. */
async function claim(supabase: any, id: string, col: string, clockStart: string, stamp: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('rental_applications')
    .update({ [col]: stamp })
    .eq('id', id)
    .or(`${col}.is.null,${col}.lt."${clockStart}"`)
    .select('id');
  if (error) { console.error(`claim ${col} failed for ${id}:`, error); return false; }
  return (data || []).length > 0;
}

async function release(supabase: any, id: string, col: string, stamp: string) {
  const { error } = await supabase.from('rental_applications').update({ [col]: null }).eq('id', id).eq(col, stamp);
  if (error) console.error(`release ${col} failed for ${id}:`, error);
}

async function sendEmail(apiKey: string, msg: { to: string[]; subject: string; html: string }): Promise<string | null> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: SENDER_MAP.pai.from, reply_to: SENDER_MAP.pai.reply_to, ...msg }),
    });
    if (!res.ok) return `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function reminderHtml(c: Candidate, methodsHtml: string): string {
  const rows = c.items.map((i) => `
      <tr><td style="padding: 6px 0;">${esc(i.label)}</td><td style="padding: 6px 0; text-align: right;">${formatMoney(i.amount)}</td></tr>`).join('');
  return `
    <p>Hi ${esc(c.firstName)},</p>
    <p>Thanks for signing your lease for <strong>${esc(c.spaceName)}</strong>. We haven't received your payment yet.</p>
    <div style="background: #fff4e5; border: 2px solid #f9a825; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #b26a00;">Payment Due by ${esc(formatChicagoDeadline(c.deadline))}</h3>
      <p>Payment is required by then to hold your reservation.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 400px;">${rows}
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid #ddd;"><strong>Total Due</strong></td>
          <td style="padding: 8px 0; border-top: 1px solid #ddd; text-align: right; font-size: 1.2em; font-weight: bold; color: #b26a00;">${formatMoney(c.amount)}</td>
        </tr>
      </table>
      ${c.creditedToRent ? `<p style="font-size: 0.9em; color: #666; margin-bottom: 0;">This amount will be credited toward your first month's rent.</p>` : ''}
    </div>
    <h3>Payment Options</h3>
    <ul style="line-height: 1.8;">${methodsHtml}</ul>
    <p><strong>Important:</strong> Please include your name in the payment memo.</p>
    <p>Already paid? Thank you. Reply to this email so we can match it up.</p>
    <p>Questions? Reply to this email or contact us at team@alpacaplayhouse.com</p>
    <p>Best regards,<br>Alpaca Playhouse</p>`;
}

function adminAlertHtml(list: Candidate[]): string {
  const rows = list.map((c) => `
      <tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(c.name)}<br><span style="color:#666;font-size:0.9em;">${esc(c.email || 'no email')}</span></td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(c.spaceName)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align: right;">${formatMoney(c.amount)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${esc(formatChicagoDeadline(c.deadline))}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee;"><a href="${c.adminUrl}">Open</a></td>
      </tr>`).join('');
  return `
    <p>These tenants signed their lease but haven't paid by the deadline in their lease-signed email.</p>
    <p>Nothing has been cancelled. Their reservations are still held until you decide.</p>
    <table style="border-collapse: collapse; width: 100%;">
      <tr style="text-align: left; background: #f5f5f5;">
        <th style="padding: 6px 8px;">Tenant</th><th style="padding: 6px 8px;">Space</th>
        <th style="padding: 6px 8px; text-align: right;">Amount due</th><th style="padding: 6px 8px;">Was due by</th><th style="padding: 6px 8px;"></th>
      </tr>${rows}
    </table>
    <p style="color:#666;font-size:0.9em;">Sent once per lease by deposit-deadline-check.</p>`;
}
