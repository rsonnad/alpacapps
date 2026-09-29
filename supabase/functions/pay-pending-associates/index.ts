/**
 * Pay Pending Associates Edge Function
 *
 * Designed to be invoked by pg_cron repeatedly. Each run:
 *   1. Reads available Stripe balance.
 *   2. For each associate with unpaid `time_entries` (clock_out IS NOT NULL,
 *      is_paid=false) and a verified `stripe_connect_account_id`, computes
 *      the amount owed.
 *   3. If the available balance covers the full amount, fires a Stripe
 *      transfer, writes `payouts` + `ledger` rows, sets `time_entries.is_paid=true`
 *      and `payment_id`=<ledger_id>, and emails the associate + alpacaplayhouse@gmail.com.
 *   4. If the balance does not cover the full amount for any associate, it
 *      logs and exits without partial payments. Idempotent — safe to call
 *      every few hours.
 *
 * Identity gate: only associates with `payment_method='stripe'` and a
 * stripe_connect_account_id are processed.
 *
 * Instant payout associates (`associate_profiles.instant_payout = true`):
 *   - Are paid every run regardless of payout_frequency (always daily).
 *   - Get an extra run at 8:00 PM America/Chicago: pg_cron calls this function
 *     with `?mode=instant` at both 01:00 and 02:00 UTC (CDT and CST), and the
 *     hour gate below lets through only the one that lands at 20:xx Central.
 *     That run only touches instant_payout associates.
 *   - After the platform → connected-account transfer, we try a Stripe Instant
 *     Payout (connected account → debit card, minutes not days). If Stripe
 *     refuses (no instant-eligible debit card, balance not instant-available,
 *     etc.) the money still reaches the bank on the account's standard schedule;
 *     the payee email shows the standard ETA and admin gets a heads-up.
 *   `?mode=instant&force=1` skips the hour gate for manual runs, and requires
 *   the service-role key.
 *
 * Auth: service-role key (pg_cron) or an admin/oracle JWT. The anon key is
 * rejected. Cron jobs are defined in supabase/migrations/20260929_payroll_hardening.sql.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from '../_shared/api-helpers.ts';
import { rollupEntries } from '../_shared/payout-breakdown.ts';
import { SENDER_MAP } from '../_shared/template-engine.ts';
import { requireFunctionRoles } from '../_shared/require-auth.ts';

// Admin gets an immediate, technical alert the moment a payroll run hits any
// problem. Both addresses are on it so a funding stall can't sit unread in one
// inbox — an underfunded Stripe balance silently skipped Jon Sheppard for two
// straight weekly runs (2026-08-02, 2026-08-09) before anyone noticed.
const ADMIN_ALERT_EMAILS = ['alpacaplayhouse@gmail.com', 'rahulioson@gmail.com'];

// A payee waiting on money deserves to know WHY, not just eventually. The
// payroll-overdue-check watchdog only speaks up after 7 days; this tells them
// on the first missed run. Throttled so a multi-week stall is not a daily nag.
const FUNDING_DELAY_SOURCE_TYPE = 'associate_payout_funding_delay';
const FUNDING_DELAY_THROTTLE_DAYS = 3;

// Local hour (America/Chicago, 24h) at which the `?mode=instant` run is allowed
// to proceed. pg_cron has no timezone support here, so it fires at both UTC
// offsets and this gate discards the one that is not 8 PM Central.
const INSTANT_RUN_HOUR_CENTRAL = 20;

async function sendAdminAlert(resendKey: string | undefined, subject: string, html: string): Promise<void> {
  if (!resendKey) {
    console.error('[payroll-alert] RESEND_API_KEY missing — cannot send admin alert:', subject);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        reply_to: SENDER_MAP.pai.reply_to,
        to: ADMIN_ALERT_EMAILS,
        subject,
        html,
      }),
    });
    if (!res.ok) console.error('[payroll-alert] admin alert send failed:', await res.text());
  } catch (e) {
    console.error('[payroll-alert] admin alert threw:', (e as Error).message);
  }
}

/**
 * Tell an associate their payout is held up on funding, not on their work.
 *
 * Deduped through `payment_reminders` (same table the overdue watchdog uses) so
 * repeated daily cron runs during one funding stall produce at most one email
 * every FUNDING_DELAY_THROTTLE_DAYS. Best-effort: a notify failure must never
 * abort the payroll run, so everything here is caught and logged.
 */
async function notifyFundingDelay(
  supabase: any,
  resendKey: string | undefined,
  opts: { personId: string | null; personName: string; firstName: string; email: string | null; owed: number; available: number; entryCount: number; oldestUnpaid: Date | null }
): Promise<'sent' | 'throttled' | 'skipped' | 'failed'> {
  if (!opts.email || !resendKey) return 'skipped';
  try {
    const since = new Date(Date.now() - FUNDING_DELAY_THROTTLE_DAYS * 86_400_000).toISOString();
    const { data: recent } = await supabase
      .from('payment_reminders')
      .select('id')
      .eq('source_type', FUNDING_DELAY_SOURCE_TYPE)
      .eq('recipient', opts.email)
      .gte('created_at', since)
      .limit(1);
    if (recent && recent.length > 0) return 'throttled';

    const html = `<p>Hi ${opts.firstName},</p>
      <p>Heads up: your scheduled payout of <strong>$${opts.owed.toFixed(2)}</strong>
      (${opts.entryCount} logged ${opts.entryCount === 1 ? 'entry' : 'entries'}) did not go out on its
      usual run today.</p>
      <p><strong>This is not a problem with your hours or your account.</strong> Your time is logged,
      approved, and owed to you in full. The payout account simply does not have enough funds to
      cover it right now, and we do not send partial payments.</p>
      <p>We have been alerted and are topping the account up. Your payout will go out automatically
      on the next run once funding clears, with nothing needed from you.</p>
      <p>Sorry for the delay — and thank you for the work.</p>
      <p style="color:#666;font-size:13px;">— Alpaca Playhouse. Questions? Just reply to this email.</p>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SENDER_MAP.pai.from,
        reply_to: SENDER_MAP.pai.reply_to,
        to: [opts.email],
        cc: ADMIN_ALERT_EMAILS,
        subject: `Your payout is delayed — funding, not your hours ($${opts.owed.toFixed(2)})`,
        html,
      }),
    });
    const ok = res.ok;
    if (!ok) console.error('[payroll-alert] payee funding-delay send failed:', await res.text());

    // Log the attempt either way so a failing send doesn't silently retry every
    // run. `due_date` and `days_overdue` are NOT NULL on this table — omitting
    // them makes the insert fail, which would silently defeat the throttle above
    // and email the payee on every single run.
    const oldest = opts.oldestUnpaid;
    const daysOverdue = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 86_400_000)) : 0;
    const { error: logErr } = await supabase.from('payment_reminders').insert({
      source_type: FUNDING_DELAY_SOURCE_TYPE,
      person_id: opts.personId,
      amount_due: opts.owed,
      due_date: (oldest || new Date()).toISOString().slice(0, 10),
      days_overdue: daysOverdue,
      channel: 'email',
      recipient: opts.email,
      recipient_type: 'associate',
      status: ok ? 'sent' : 'failed',
      escalation_level: 1,
      metadata: {
        available_balance: opts.available,
        shortfall: Math.round((opts.owed - opts.available) * 100) / 100,
        entry_count: opts.entryCount,
        person_name: opts.personName
      }
    });
    if (logErr) {
      // Loud: without this row the throttle is blind and the payee gets spammed.
      console.error('[payroll-alert] funding-delay dedupe row FAILED to insert:', logErr.message);
      return 'failed';
    }
    return ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('[payroll-alert] notifyFundingDelay threw:', (e as Error).message);
    return 'failed';
  }
}

function formEncode(obj: Record<string, string | number>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function addBusinessDays(date: Date, n: number): Date {
  const r = new Date(date);
  let added = 0;
  while (added < n) {
    r.setDate(r.getDate() + 1);
    const d = r.getDay();
    if (d !== 0 && d !== 6) added++;
  }
  return r;
}

async function stripeGet(secret: string, path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe GET ${path} failed: ${text}`);
  return JSON.parse(text);
}

/** Stripe rejected the request (4xx), so it definitely had no effect. */
class StripeApiError extends Error {}

async function stripePost(
  secret: string,
  path: string,
  body: Record<string, string | number>,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders
    },
    body: formEncode(body)
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message || text; } catch { /* non-JSON body */ }
    // 4xx = Stripe rejected the request. A 5xx may still have created it.
    throw res.status < 500 ? new StripeApiError(msg) : new Error(`Stripe ${res.status}: ${msg}`);
  }
  return JSON.parse(text);
}

/**
 * Push freshly transferred funds from the connected account to its debit card
 * via Stripe Instant Payouts. Never throws: the transfer has already succeeded,
 * so a refusal here only means the money goes out on the account's standard
 * payout schedule instead. The Idempotency-Key ties the payout to our payouts
 * row, so a retried run can't create a second instant payout for it.
 */
async function tryInstantPayout(
  secret: string,
  connectAccountId: string,
  amountCents: number,
  payoutId: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const payout = await stripePost(secret, 'payouts', {
      amount: amountCents,
      currency: 'usd',
      method: 'instant',
      'metadata[payout_id]': payoutId,
      'metadata[source]': 'pay-pending-associates'
    }, {
      'Stripe-Account': connectAccountId,
      'Idempotency-Key': `instant-payout-${payoutId}`
    });
    return { ok: true, id: payout.id };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Moves money, so it must never be callable with the public anon key (which
  // ships in every page of the site). pg_cron sends the service-role key via
  // public.payroll_cron_bearer(); an admin/oracle JWT is allowed for manual runs.
  const auth = await requireFunctionRoles(req, supabase, ['admin', 'oracle']);
  if (auth.response) return auth.response;

  const results: any[] = [];

  // `?mode=instant` is the 8 PM Central run for instant_payout associates only.
  // Anything else is the regular nightly run for everyone.
  const params = new URL(req.url).searchParams;
  const instantMode = params.get('mode') === 'instant';
  if (instantMode) {
    const hourCentral = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23'
    }).format(new Date()));
    const force = params.get('force') === '1';
    if (force) {
      // Skipping the 8 PM schedule is restricted to the service-role key, so a
      // stray admin click can't fire instant payouts (and their fees) early.
      if (!auth.caller?.isServiceRole) {
        return new Response(JSON.stringify({ ok: false, error: 'force=1 requires the service-role key' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
      }
    } else if (hourCentral !== INSTANT_RUN_HOUR_CENTRAL) {
      // The other half of the CDT/CST cron pair. Expected, not an error.
      return new Response(JSON.stringify({ ok: true, mode: 'instant', skipped: 'outside_instant_window', hour_central: hourCentral }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }
  }

  try {
    const { data: config } = await supabase.from('stripe_config').select('*').single();
    if (!config?.is_active || !config.connect_enabled) {
      return new Response(JSON.stringify({ ok: false, error: 'Stripe not active or Connect disabled' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }
    const secretKey = config.test_mode ? config.sandbox_secret_key : config.secret_key;
    if (!secretKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing Stripe secret key' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const balance = await stripeGet(secretKey, 'balance');
    const availableCents = (balance.available || []).reduce((s: number, b: any) => s + (b.amount || 0), 0);

    let associatesQuery = supabase
      .from('associate_profiles')
      .select('id, app_user_id, hourly_rate, daily_extra, payment_method, stripe_connect_account_id, identity_verification_status, payout_frequency, payout_day_of_week, instant_payout')
      .eq('payment_method', 'stripe')
      .eq('is_active', true)
      .not('stripe_connect_account_id', 'is', null)
      .eq('identity_verification_status', 'verified');
    if (instantMode) associatesQuery = associatesQuery.eq('instant_payout', true);
    const { data: associates, error: aerr } = await associatesQuery;

    if (aerr) throw new Error(`associates query failed: ${aerr.message}`);

    // Day-of-week (0=Sun .. 6=Sat) in America/Chicago, so a configured payout
    // day means that weekday in Texas regardless of the cron's UTC fire time.
    const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const todayDowCentral = DOW[
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date())
    ];

    for (const assoc of associates || []) {
      // --- Pay cadence gate ---------------------------------------------
      // Honor each associate's payout_frequency. 'daily' (or null) pays every
      // run, as before. 'weekly'/'biweekly'/'monthly' only pay on their
      // configured payout_day_of_week (default Saturday). The cron still runs
      // daily; this gate decides whether THIS associate is due today. Because
      // the 02:30 UTC run lands on exactly one Central weekday per week, a
      // weekly associate is paid once per week. Entry-level idempotency
      // (payout_time_entries UNIQUE) still prevents any double-claim.
      // instant_payout associates are always due: "paid immediately" overrides
      // any weekly cadence left on their profile.
      const freq = (assoc.payout_frequency || 'daily').toLowerCase();
      if (freq !== 'daily' && !assoc.instant_payout) {
        const payDay = assoc.payout_day_of_week ?? 6; // default Saturday
        if (todayDowCentral !== payDay) {
          results.push({
            associate_id: assoc.id,
            skipped: 'not_payout_day',
            frequency: freq,
            payout_day_of_week: payDay,
            today_dow_central: todayDowCentral
          });
          continue;
        }
      }

      const { data: entries, error: eerr } = await supabase
        .from('time_entries')
        .select('id, clock_in, clock_out, description, task_id, hourly_rate')
        .eq('associate_id', assoc.id)
        .eq('is_paid', false)
        .not('clock_out', 'is', null);
      if (eerr) { results.push({ associate_id: assoc.id, skipped: 'entries query failed', error: eerr.message }); continue; }
      if (!entries || entries.length === 0) continue;

      // #2 idempotency guard: exclude any entries already claimed by a concurrent payout.
      // `payout_time_entries` has UNIQUE(time_entry_id) — querying it tells us which IDs
      // are still free to claim. We re-filter `entries` before computing totals so the
      // amount we transfer matches the entries we actually claim.
      const candidateIds = entries.map(e => e.id);
      const { data: alreadyClaimed } = await supabase
        .from('payout_time_entries')
        .select('time_entry_id')
        .in('time_entry_id', candidateIds);
      const claimedSet = new Set((alreadyClaimed || []).map(r => r.time_entry_id));
      const claimableEntries = entries.filter(e => !claimedSet.has(e.id));
      if (claimableEntries.length === 0) continue;

      // Amount comes from the shared calculator (payout-breakdown.ts) so this
      // path, stripe-payout, paypal-payout and the weekly summary agree:
      // each entry's own hourly_rate (profile rate as fallback) plus
      // daily_extra × distinct work days. daily_extra was once dropped here,
      // silently underpaying by that amount per work-day.
      const rate = parseFloat(assoc.hourly_rate as unknown as string) || 0;
      const dailyExtra = parseFloat(assoc.daily_extra as unknown as string) || 0;
      const money = rollupEntries(claimableEntries as any, rate, undefined, dailyExtra);
      const totalHours = money.totalHours;
      const workDayCount = money.dayCount;
      const extraAmount = money.extraAmount;
      const hourlyAmount = money.hourlyAmount;
      const amount = money.totalAmount;
      const amountCents = Math.round(amount * 100);

      if (amountCents <= 0) continue;

      // Resolved BEFORE the balance gate: an underfunded run still needs the
      // person's name and email so both the admin alert and the payee notice
      // can say who is waiting and why.
      const { data: appUser } = await supabase
        .from('app_users')
        .select('display_name, first_name, last_name, person_id, email')
        .eq('id', assoc.app_user_id)
        .single();
      const personName = appUser?.display_name
        || `${appUser?.first_name || ''} ${appUser?.last_name || ''}`.trim()
        || 'Associate';
      const personId = appUser?.person_id || null;

      let recipientEmail = appUser?.email || null;
      if (personId) {
        const { data: person } = await supabase.from('people').select('email').eq('id', personId).single();
        if (person?.email) recipientEmail = person.email;
      }

      if (amountCents > availableCents) {
        // Tell the payee it's a funding problem, not their hours — the admin
        // digest at the end of this run covers the technical side.
        const notified = await notifyFundingDelay(supabase, resendKey, {
          personId,
          personName,
          firstName: appUser?.first_name || personName.split(' ')[0],
          email: recipientEmail,
          owed: amount,
          available: availableCents / 100,
          entryCount: claimableEntries.length,
          oldestUnpaid: claimableEntries.reduce((min: Date | null, e: any) => {
            const d = new Date(e.clock_out as string);
            return !min || d < min ? d : min;
          }, null as Date | null)
        });
        results.push({
          associate_id: assoc.id,
          person_name: personName,
          skipped: 'insufficient_balance',
          owed: amount,
          available: availableCents / 100,
          shortfall: Math.round((amount - availableCents / 100) * 100) / 100,
          entry_count: claimableEntries.length,
          payee_notified: notified
        });
        continue;
      }

      // Resolve task titles for entries that have a task_id but no inline description.
      const taskIds = Array.from(new Set(claimableEntries.map(e => (e as any).task_id).filter(Boolean))) as string[];
      let taskNames: Record<string, string> = {};
      if (taskIds.length > 0) {
        const { data: tasks } = await supabase.from('tasks').select('id, title').in('id', taskIds);
        for (const t of tasks || []) if (t.title) taskNames[t.id] = t.title;
      }
      const breakdown = rollupEntries(claimableEntries as any, rate, taskNames, dailyExtra);
      const dateRange = breakdown.period;
      const description = `Auto payout: ${personName} — ${totalHours.toFixed(2)} hrs ${dateRange.first} to ${dateRange.last}`;

      // #2 idempotency: pre-allocate a payout row so we have an id to attach
      // entries to, then claim entries atomically via payout_time_entries
      // (UNIQUE on time_entry_id). If any claim fails, abort BEFORE calling
      // Stripe — no money moves until we own the entries.
      const { data: payoutPre, error: payoutPreErr } = await supabase
        .from('payouts')
        .insert({
          associate_id: assoc.id,
          person_id: personId,
          person_name: personName,
          amount,
          payment_method: 'stripe',
          payment_handle: assoc.stripe_connect_account_id,
          // 'pending' is the placeholder state until the Stripe transfer fires
          // (then updated to 'processing'). MUST be a value allowed by the
          // payouts_status_check constraint (pending/processing/completed/failed/returned).
          // 'preparing' is NOT allowed and silently killed all auto-payroll from
          // 2026-05-18 until this fix — matches stripe-payout/paypal-payout convention.
          status: 'pending',
          time_entry_ids: claimableEntries.map(e => e.id),
          notes: `Auto-fired by pay-pending-associates${extraAmount > 0 ? ` (incl $${extraAmount.toFixed(2)} daily extra: ${workDayCount} day${workDayCount === 1 ? '' : 's'} × $${dailyExtra.toFixed(2)})` : ''}`,
          is_test: false
        })
        .select('id')
        .single();
      if (payoutPreErr) {
        results.push({ associate_id: assoc.id, error: 'payout_pre_insert_failed', message: payoutPreErr.message });
        continue;
      }

      const claimRows = claimableEntries.map(e => ({ payout_id: payoutPre.id, time_entry_id: e.id }));
      const { error: claimErr } = await supabase.from('payout_time_entries').insert(claimRows);
      if (claimErr) {
        // Roll back the placeholder payout — we couldn't claim atomically.
        await supabase.from('payouts').delete().eq('id', payoutPre.id);
        results.push({ associate_id: assoc.id, skipped: 'concurrent_claim', message: claimErr.message });
        continue;
      }

      let transfer: { id: string };
      try {
        transfer = await stripePost(secretKey, 'transfers', {
          amount: amountCents,
          currency: 'usd',
          destination: assoc.stripe_connect_account_id as string,
          description: description.slice(0, 500),
          'metadata[payout_associate_id]': assoc.id,
          'metadata[entry_count]': String(claimableEntries.length),
          'metadata[source]': 'pay-pending-associates',
          'metadata[payout_id]': payoutPre.id
        });
      } catch (transferErr) {
        if (transferErr instanceof StripeApiError) {
          // Stripe refused: no money moved. Roll back so the next run can pay.
          await supabase.from('payout_time_entries').delete().eq('payout_id', payoutPre.id);
          await supabase.from('payouts').delete().eq('id', payoutPre.id);
          results.push({ associate_id: assoc.id, person_name: personName, error: 'stripe_transfer_failed', message: (transferErr as Error).message });
        } else {
          // Network/timeout: the transfer may exist. Keep the claim so no run
          // re-pays these entries; admin must check Stripe and reconcile.
          await supabase.from('payouts').update({
            status: 'failed',
            error_message: `Outcome unknown — check Stripe for metadata.payout_id=${payoutPre.id}: ${(transferErr as Error).message}`
          }).eq('id', payoutPre.id);
          results.push({ associate_id: assoc.id, person_name: personName, error: 'stripe_transfer_outcome_unknown', message: `Check Stripe for payout_id ${payoutPre.id} before releasing its entries. ${(transferErr as Error).message}` });
        }
        continue;
      }

      const { data: ledgerRow, error: lerr } = await supabase.from('ledger').insert({
        direction: 'expense',
        category: 'associate_payment',
        amount,
        payment_method: 'stripe',
        transaction_date: new Date().toISOString().slice(0, 10),
        person_id: personId,
        person_name: personName,
        status: 'pending',
        description: `Stripe payout to ${personName}`,
        notes: `Auto-fired by pay-pending-associates. Transfer ${transfer.id}. ${claimableEntries.length} entries (${dateRange.first} to ${dateRange.last}).${extraAmount > 0 ? ` Incl $${extraAmount.toFixed(2)} daily extra (${workDayCount} day${workDayCount === 1 ? '' : 's'} × $${dailyExtra.toFixed(2)}); hourly $${hourlyAmount.toFixed(2)}.` : ''}`,
        recorded_by: 'system:pay-pending-associates',
        is_test: false
      }).select('id').single();
      if (lerr) {
        // Money moved: still record the transfer and mark the entries paid so
        // they can't be paid again. Only the accounting row is missing.
        await supabase.from('payouts')
          .update({ external_payout_id: transfer.id, status: 'processing' })
          .eq('id', payoutPre.id);
        await supabase.from('time_entries')
          .update({ payment_status: 'paid', payment_id: null })
          .in('id', claimableEntries.map(e => e.id));
        // No transfer_id key on purpose: it keeps this row in the admin alert.
        results.push({ associate_id: assoc.id, person_name: personName, error: 'ledger_insert_failed', message: `Transfer ${transfer.id} SENT ($${amount.toFixed(2)}); add the ledger row by hand. ${lerr.message}` });
        continue;
      }

      await supabase.from('payouts')
        .update({ external_payout_id: transfer.id, status: 'processing', ledger_id: ledgerRow.id })
        .eq('id', payoutPre.id);
      const payoutRow = { id: payoutPre.id };

      // Instant payout: move the transferred funds on to the payee's debit card
      // now instead of waiting ~2 business days for the standard bank payout.
      let instantResult: Awaited<ReturnType<typeof tryInstantPayout>> | null = null;
      if (assoc.instant_payout) {
        instantResult = await tryInstantPayout(secretKey, assoc.stripe_connect_account_id as string, amountCents, payoutPre.id);
        if (instantResult.ok) {
          await supabase.from('payouts')
            .update({ stripe_instant_payout_id: instantResult.id })
            .eq('id', payoutPre.id);
        } else {
          console.warn(`[instant-payout] fell back to standard for ${personName}: ${instantResult.reason}`);
        }
      }

      // #15 server-side payment_status transition; legacy is_paid is mirrored by trigger.
      const { error: uerr } = await supabase
        .from('time_entries')
        .update({ payment_status: 'paid', payment_id: ledgerRow.id })
        .in('id', claimableEntries.map(e => e.id));
      if (uerr) {
        results.push({ associate_id: assoc.id, transfer_id: transfer.id, ledger_id: ledgerRow.id, warning: 'time_entries_update_failed', message: uerr.message });
      }

      // decrement remaining balance so we don't over-promise within a single run
      const newAvailable = availableCents - amountCents;

      // emails — route through send-email so the associate_payout_sent template
      // (and SENDER_MAP) is the single source of truth for payout emails.
      if (recipientEmail) {
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const eta = instantResult?.ok
          ? 'Today (instant payout to your debit card, usually within 30 minutes)'
          : addBusinessDays(new Date(), 2).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const firstName = appUser?.first_name || personName.split(' ')[0];
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              type: 'associate_payout_sent',
              to: recipientEmail,
              cc: 'alpacaplayhouse@gmail.com',
              data: {
                first_name: firstName,
                recipient_name: personName,
                amount: amount.toFixed(2),
                payment_method: instantResult?.ok ? 'Stripe Instant (debit card)' : 'Stripe (ACH)',
                hours: totalHours.toFixed(2),
                hourly_rate: rate.toFixed(2),
                hourly_subtotal: hourlyAmount.toFixed(2),
                daily_extra: dailyExtra.toFixed(2),
                daily_extra_total: extraAmount.toFixed(2),
                payout_date: today,
                expected_deposit_date: eta,
                transfer_id: transfer.id,
                period_first: dateRange.first,
                period_last: dateRange.last,
                entry_count: breakdown.entryCount,
                day_count: breakdown.dayCount,
                daily_breakdown: breakdown.rows
              }
            })
          });
        } catch (mailErr) {
          results.push({ associate_id: assoc.id, transfer_id: transfer.id, warning: 'email_failed', message: (mailErr as Error).message });
        }
      }

      results.push({
        associate_id: assoc.id,
        person_name: personName,
        amount,
        hours: totalHours,
        entry_count: claimableEntries.length,
        transfer_id: transfer.id,
        ledger_id: ledgerRow.id,
        payout_id: payoutRow?.id,
        balance_remaining: newAvailable / 100,
        ...(instantResult ? {
          instant_payout: instantResult.ok ? 'sent' : 'fallback',
          ...(instantResult.ok ? { instant_payout_id: instantResult.id } : { instant_fallback_reason: instantResult.reason })
        } : {})
      });
    }

    // Never let a payroll problem be silent. Any associate that did NOT get a
    // transfer_id is a failure the admin must see — except benign concurrent-claim
    // idempotency (another payout already grabbed the entries, not a real problem).
    const failures = results.filter((r: any) => !r.transfer_id && r.skipped !== 'concurrent_claim' && r.skipped !== 'not_payout_day');
    if (failures.length > 0) {
      const rows = failures.map((f: any) => {
        const who = f.person_name || f.associate_id;
        const reason = f.error || f.skipped || f.warning || 'unknown';
        const detail = f.message
          || (f.owed != null ? `owed $${f.owed}, available $${f.available}` : '')
          || '';
        return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${who}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>${reason}</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${detail}</td></tr>`;
      }).join('');
      // An underfunded balance is the one failure with a single concrete fix, so
      // it gets its own banner naming the exact top-up amount instead of being
      // buried as one row in a generic problem table.
      const underfunded = failures.filter((f: any) => f.skipped === 'insufficient_balance');
      const totalOwed = underfunded.reduce((s: number, f: any) => s + (f.owed || 0), 0);
      const topUpNeeded = Math.max(0, Math.round((totalOwed - availableCents / 100) * 100) / 100);
      const fundingBanner = underfunded.length === 0 ? '' : `
        <div style="border:2px solid #c62828;background:#fff5f5;border-radius:8px;padding:14px 16px;margin:16px 0;">
          <h3 style="margin:0 0 8px;color:#c62828;">&#128176; Stripe balance too low — this is a funding problem</h3>
          <p style="margin:0 0 8px;">${underfunded.length} associate(s) went unpaid purely because the Stripe balance
          could not cover them. Payouts are all-or-nothing, so a partly funded balance pays <strong>nobody</strong>.</p>
          <table style="font-size:14px;margin:0 0 8px;">
            <tr><td style="padding:2px 12px 2px 0;">Available balance:</td><td><strong>$${(availableCents / 100).toFixed(2)}</strong></td></tr>
            <tr><td style="padding:2px 12px 2px 0;">Total owed to blocked associates:</td><td><strong>$${totalOwed.toFixed(2)}</strong></td></tr>
            <tr><td style="padding:2px 12px 2px 0;">Top up at least:</td><td><strong style="color:#c62828;">$${topUpNeeded.toFixed(2)}</strong></td></tr>
          </table>
          <p style="margin:0;"><a href="https://dashboard.stripe.com/balance" style="color:#c62828;"><strong>Top up / check auto top-up in Stripe &rarr;</strong></a></p>
          <p style="margin:8px 0 0;color:#666;font-size:13px;">The affected associates have each been emailed that the delay
          is funding, not their hours (throttled to once every ${FUNDING_DELAY_THROTTLE_DAYS} days). Once funded, the next
          run pays them automatically.</p>
        </div>`;
      const subject = underfunded.length > 0
        ? `💰 Payroll BLOCKED — top up Stripe $${topUpNeeded.toFixed(2)} (${underfunded.length} unpaid)`
        : `⚠️ Payroll problem — ${failures.length} associate(s) unpaid`;
      const html = `<h2 style="color:#c62828;">&#9888;&#65039; Payroll run could not pay ${failures.length} associate(s)</h2>
        ${fundingBanner}
        <p>pay-pending-associates ran but failed to pay the following. <strong>No money moved</strong> for these associates. Please investigate.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr style="background:#f0f0f0;"><th style="padding:8px 10px;text-align:left;">Associate</th><th style="padding:8px 10px;text-align:left;">Reason</th><th style="padding:8px 10px;text-align:left;">Detail</th></tr></thead><tbody>${rows}</tbody></table>
        <p style="color:#666;font-size:13px;">Stripe balance at start of run: $${(availableCents / 100).toFixed(2)}. Automated alert from pay-pending-associates.</p>`;
      await sendAdminAlert(resendKey, subject, html);
    }

    // The payee WAS paid, just not instantly. Separate, lower-severity alert so
    // admin can fix the cause (usually: no instant-eligible debit card on the
    // connected account) or turn instant_payout off. Repeats each run until then.
    const instantFallbacks = results.filter((r: any) => r.instant_payout === 'fallback');
    if (instantFallbacks.length > 0) {
      const rows = instantFallbacks.map((f: any) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${f.person_name || f.associate_id}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">$${Number(f.amount).toFixed(2)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${f.instant_fallback_reason}</td></tr>`
      ).join('');
      await sendAdminAlert(
        resendKey,
        `ℹ️ Instant payout fell back to standard (${instantFallbacks.length})`,
        `<h2>Instant payout not possible — paid via standard bank payout instead</h2>
         <p>These associates are set to <code>instant_payout</code>. Their Stripe transfer succeeded, but Stripe refused the
         instant payout to their card, so the money will reach their bank on the normal schedule (~2 business days).</p>
         <table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr style="background:#f0f0f0;"><th style="padding:8px 10px;text-align:left;">Associate</th><th style="padding:8px 10px;text-align:left;">Amount</th><th style="padding:8px 10px;text-align:left;">Stripe reason</th></tr></thead><tbody>${rows}</tbody></table>
         <p style="color:#666;font-size:13px;">Usual fix: the associate adds an instant-eligible debit card in their Stripe Express dashboard.
         Automated alert from pay-pending-associates${instantMode ? ' (8 PM instant run)' : ''}.</p>`
      );
    }

    return new Response(JSON.stringify({ ok: true, mode: instantMode ? 'instant' : 'standard', available_at_start: availableCents / 100, results }, null, 2),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('pay-pending-associates error', err);
    await sendAdminAlert(
      resendKey,
      '⚠️ Payroll run FAILED (exception)',
      `<h2 style="color:#c62828;">pay-pending-associates threw an exception</h2>
       <p>The payroll run failed before completing. Some or all associates may not have been paid.</p>
       <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${(err as Error).message}</pre>
       <p style="color:#666;font-size:13px;">Automated alert. Check the function logs for the full stack.</p>`
    );
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, results }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
