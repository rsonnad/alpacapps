/**
 * Payroll Overdue Watchdog
 *
 * Independent safety net for associate payroll. Does NOT depend on
 * pay-pending-associates running — it watches the OUTCOME (unpaid hours sitting
 * too long) so a silent failure of ANY payment path (cron dead, deploy broken,
 * constraint violation, balance, Stripe outage) gets surfaced no matter the cause.
 *
 * For each active associate it computes payable, clocked-out, unpaid hours and the
 * age of the OLDEST such entry. If that age exceeds the threshold (default 7 days —
 * associates are paid ~weekly), the associate is "overdue" and we:
 *   - email the admin a digest of everyone overdue (daily, while the condition holds)
 *   - email the payee a gentle, throttled "payment delayed" notice (one per
 *     escalation step, deduped via payment_reminders)
 *
 * Why this exists: from 2026-05-18 to 2026-06-08, pay-pending-associates returned
 * HTTP 200 every day while paying nobody (a payouts.status CHECK violation that was
 * caught and swallowed). Nothing alerted anyone for three weeks. This watchdog makes
 * that class of silent failure impossible to miss.
 *
 * Trigger: daily via pg_cron.
 * Query params (for testing):
 *   ?dry_run=1  -> compute + return the overdue list as JSON, send NO email
 *   ?days=N     -> override the overdue threshold (default 7)
 *
 * Deploy: supabase functions deploy payroll-overdue-check
 *   (verify_jwt stays ON; the pg_cron job passes the anon key, same as
 *   pay-pending-associates. Manual/test calls must send an apikey/Bearer.)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from '../_shared/api-helpers.ts';
import { SENDER_MAP } from '../_shared/template-engine.ts';

const ADMIN_ALERT_EMAIL = 'alpacaplayhouse@gmail.com';
const DEFAULT_THRESHOLD_DAYS = 7;

interface OverdueAssociate {
  associateId: string;
  personId: string | null;
  name: string;
  firstName: string;
  email: string | null;
  amount: number;
  hours: number;
  entryCount: number;
  oldestUnpaid: string;       // ISO date of oldest unpaid clock_out
  daysOverdue: number;
  lastPayout: string | null;  // ISO date of last payout with a transfer, or null
  paymentMethod: string | null;
  stripeReady: boolean;
}

/** Escalation step from days overdue — payee gets one email per step. */
function escalationLevel(daysOverdue: number, threshold: number): number {
  if (daysOverdue >= threshold + 14) return 4; // ~3 weeks late
  if (daysOverdue >= threshold + 7) return 3;  // ~2 weeks late
  if (daysOverdue >= threshold + 3) return 2;
  return 1;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function sendEmail(
  resendKey: string,
  to: string[],
  subject: string,
  html: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        reply_to: SENDER_MAP.pai.reply_to,
        to,
        subject,
        html,
      }),
    });
    const text = await res.text();
    return { ok: res.ok, detail: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const daysParam = url.searchParams.get('days');
  const parsedDays = daysParam !== null ? parseInt(daysParam, 10) : NaN;
  const threshold = Number.isFinite(parsedDays) ? parsedDays : DEFAULT_THRESHOLD_DAYS;

  try {
    const now = Date.now();

    const { data: associates, error: aerr } = await supabase
      .from('associate_profiles')
      .select('id, hourly_rate, payment_method, stripe_connect_account_id, app_user:app_user_id(id, email, first_name, last_name, display_name, person_id)')
      .eq('is_active', true);
    if (aerr) throw new Error(`associates query failed: ${aerr.message}`);

    const overdue: OverdueAssociate[] = [];

    for (const assoc of associates || []) {
      const user = assoc.app_user as any;
      if (!user) continue;

      const { data: entries, error: eerr } = await supabase
        .from('time_entries')
        .select('id, clock_in, clock_out')
        .eq('associate_id', assoc.id)
        .eq('is_paid', false)
        .not('clock_out', 'is', null);
      if (eerr) {
        console.error(`entries query failed for ${assoc.id}: ${eerr.message}`);
        continue;
      }
      if (!entries || entries.length === 0) continue;

      const rate = parseFloat(assoc.hourly_rate as unknown as string) || 0;
      let hours = 0;
      let oldestMs = Infinity;
      for (const e of entries) {
        hours += (new Date(e.clock_out as string).getTime() - new Date(e.clock_in as string).getTime()) / 3_600_000;
        const co = new Date(e.clock_out as string).getTime();
        if (co < oldestMs) oldestMs = co;
      }
      const amount = Math.round(hours * rate * 100) / 100;
      if (amount <= 0) continue;

      const daysOverdue = Math.floor((now - oldestMs) / 86_400_000);
      if (daysOverdue < threshold) continue;

      // Most recent payout that actually moved money (has a transfer id).
      const { data: lastPay } = await supabase
        .from('payouts')
        .select('created_at')
        .eq('associate_id', assoc.id)
        .not('external_payout_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const name = user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Associate';

      // Prefer people.email (matches pay-pending-associates recipient logic).
      let email: string | null = user.email || null;
      if (user.person_id) {
        const { data: person } = await supabase.from('people').select('email').eq('id', user.person_id).single();
        if (person?.email) email = person.email;
      }

      overdue.push({
        associateId: assoc.id,
        personId: user.person_id || null,
        name,
        firstName: user.first_name || name.split(' ')[0] || 'there',
        email,
        amount,
        hours: Math.round(hours * 100) / 100,
        entryCount: entries.length,
        oldestUnpaid: new Date(oldestMs).toISOString(),
        daysOverdue,
        lastPayout: lastPay && lastPay.length > 0 ? lastPay[0].created_at : null,
        paymentMethod: assoc.payment_method || null,
        stripeReady: !!assoc.stripe_connect_account_id,
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, threshold_days: threshold, overdue }, null, 2),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    if (overdue.length === 0) {
      return new Response(JSON.stringify({ ok: true, threshold_days: threshold, overdue: 0, message: 'All associates paid up to date' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured', overdue: overdue.length }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    let payeeNotified = 0;

    // ── Payee notices (throttled: one email per escalation step) ──
    for (const o of overdue) {
      if (!o.email) continue;
      const level = escalationLevel(o.daysOverdue, threshold);

      const { data: priorRems } = await supabase
        .from('payment_reminders')
        .select('escalation_level')
        .eq('source_type', 'associate_payroll_overdue')
        .eq('source_id', o.associateId)
        .eq('recipient_type', 'payer')
        .eq('status', 'sent');
      const maxSent = (priorRems || []).reduce((m, r) => Math.max(m, r.escalation_level || 0), 0);
      if (level <= maxSent) continue; // already told them at this (or higher) level

      const html = `
        <div style="max-width:560px;margin:0 auto;font-family:'DM Sans',-apple-system,Segoe UI,Roboto,sans-serif;background:#faf9f6;border-radius:12px;overflow:hidden;border:1px solid #e6e2d9;">
          <div style="background:#1c1618;padding:24px 28px;text-align:center;">
            <h1 style="color:#faf9f6;margin:0;font-size:20px;">Alpaca Playhouse</h1>
            <p style="color:rgba(250,249,246,0.65);margin:6px 0 0;font-size:13px;">Payment Update</p>
          </div>
          <div style="padding:24px 28px;color:#2a1f23;">
            <p style="font-size:15px;margin:0 0 12px;">Hi ${o.firstName},</p>
            <p style="font-size:14px;line-height:1.6;color:#5a4f54;margin:0 0 16px;">
              We see your logged hours and your payment is <strong>running behind</strong>. We're on it &mdash;
              this is a heads-up so you're not left wondering. No action is needed from you.
            </p>
            <table style="width:100%;background:#f2f0e8;border-radius:8px;padding:16px;margin:0 0 16px;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#7d6f74;font-size:13px;">Amount pending</td><td style="padding:4px 0;text-align:right;font-weight:700;font-size:16px;color:#d4883a;">$${o.amount.toFixed(2)}</td></tr>
              <tr><td style="padding:4px 0;color:#7d6f74;font-size:13px;">Hours logged</td><td style="padding:4px 0;text-align:right;">${o.hours.toFixed(2)} hrs</td></tr>
              <tr><td style="padding:4px 0;color:#7d6f74;font-size:13px;">Oldest unpaid since</td><td style="padding:4px 0;text-align:right;">${fmtDate(o.oldestUnpaid)}</td></tr>
            </table>
            <p style="font-size:13px;color:#7d6f74;margin:0;">If you have any questions, just reply to this email. Thanks for your patience.</p>
          </div>
        </div>`;

      const sent = await sendEmail(resendKey, [o.email], `Your Alpaca Playhouse payment is on the way ($${o.amount.toFixed(2)})`, html);
      await supabase.from('payment_reminders').insert({
        source_type: 'associate_payroll_overdue',
        source_id: o.associateId,
        person_id: o.personId,
        period_label: `${o.entryCount} unpaid entries since ${fmtDate(o.oldestUnpaid)}`,
        amount_due: o.amount,
        due_date: o.oldestUnpaid.slice(0, 10),
        days_overdue: o.daysOverdue,
        channel: 'email',
        recipient: o.email,
        recipient_type: 'payer',
        status: sent.ok ? 'sent' : 'failed',
        escalation_level: level,
        error_message: sent.ok ? null : sent.detail,
      });
      if (sent.ok) payeeNotified++;
    }

    // ── Admin digest (always, while anyone is overdue) ──
    const totalOwed = overdue.reduce((s, o) => s + o.amount, 0);
    const rows = overdue
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map(o => {
        const stripe = o.paymentMethod === 'stripe' ? (o.stripeReady ? 'Stripe ✓' : 'Stripe ⚠ not set up') : (o.paymentMethod || 'no method');
        const last = o.lastPayout ? fmtDate(o.lastPayout) : 'never';
        const color = o.daysOverdue >= threshold + 7 ? '#c62828' : '#e65100';
        return `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${o.name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">$${o.amount.toFixed(2)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${o.entryCount}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:${color};font-weight:600;">${o.daysOverdue}d</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${last}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${stripe}</td>
        </tr>`;
      }).join('');

    const adminHtml = `
      <h2 style="color:#c62828;margin:0 0 6px;">&#9888;&#65039; ${overdue.length} associate(s) overdue on payroll</h2>
      <p style="color:#444;font-size:14px;">These associates have payable hours that have gone unpaid past ${threshold} days. Total pending: <strong>$${totalOwed.toFixed(2)}</strong>. Investigate the payout path &mdash; this is the kind of silent failure the watchdog exists to catch.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead><tr style="background:#f0f0f0;">
          <th style="padding:8px 10px;text-align:left;">Associate</th>
          <th style="padding:8px 10px;text-align:right;">Owed</th>
          <th style="padding:8px 10px;text-align:center;">Entries</th>
          <th style="padding:8px 10px;text-align:center;">Oldest</th>
          <th style="padding:8px 10px;text-align:left;">Last payout</th>
          <th style="padding:8px 10px;text-align:left;">Method</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#666;font-size:13px;">Payees have been sent a delay notice (throttled). Automated daily alert from payroll-overdue-check.</p>`;

    const adminSent = await sendEmail(
      resendKey,
      [ADMIN_ALERT_EMAIL],
      `⚠️ Payroll overdue — ${overdue.length} associate(s), $${totalOwed.toFixed(2)} pending`,
      adminHtml,
    );
    await supabase.from('payment_reminders').insert({
      source_type: 'associate_payroll_overdue',
      source_id: null,
      person_id: null,
      period_label: `${overdue.length} associates overdue`,
      amount_due: totalOwed,
      due_date: new Date().toISOString().slice(0, 10),
      days_overdue: 0,
      channel: 'email',
      recipient: ADMIN_ALERT_EMAIL,
      recipient_type: 'admin',
      status: adminSent.ok ? 'sent' : 'failed',
      escalation_level: 0,
      error_message: adminSent.ok ? null : adminSent.detail,
    });

    return new Response(JSON.stringify({
      ok: true,
      threshold_days: threshold,
      overdue: overdue.length,
      total_owed: totalOwed,
      payee_notified: payeeNotified,
      admin_alerted: adminSent.ok,
    }, null, 2), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('payroll-overdue-check error', err);
    // Best-effort admin alert that the watchdog itself failed.
    if (resendKey) {
      await sendEmail(resendKey, [ADMIN_ALERT_EMAIL], '⚠️ Payroll watchdog FAILED',
        `<p>payroll-overdue-check threw an exception and could not check payroll status.</p><pre>${(err as Error).message}</pre>`);
    }
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
