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
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from '../_shared/api-helpers.ts';
import { rollupEntries } from '../_shared/payout-breakdown.ts';
import { SENDER_MAP } from '../_shared/template-engine.ts';

// Admin gets an immediate, technical alert the moment a payroll run hits any
// problem. Payee-facing "payment delayed" notices are handled (throttled) by
// the independent payroll-overdue-check watchdog, so contractors aren't spammed.
const ADMIN_ALERT_EMAIL = 'alpacaplayhouse@gmail.com';

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
        to: [ADMIN_ALERT_EMAIL],
        subject,
        html,
      }),
    });
    if (!res.ok) console.error('[payroll-alert] admin alert send failed:', await res.text());
  } catch (e) {
    console.error('[payroll-alert] admin alert threw:', (e as Error).message);
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

async function stripePost(secret: string, path: string, body: Record<string, string | number>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(body)
  });
  const text = await res.text();
  if (!res.ok) {
    const err = JSON.parse(text);
    throw new Error(err?.error?.message || text);
  }
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const results: any[] = [];

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

    const { data: associates, error: aerr } = await supabase
      .from('associate_profiles')
      .select('id, app_user_id, hourly_rate, payment_method, stripe_connect_account_id, identity_verification_status')
      .eq('payment_method', 'stripe')
      .not('stripe_connect_account_id', 'is', null)
      .eq('identity_verification_status', 'verified');

    if (aerr) throw new Error(`associates query failed: ${aerr.message}`);

    for (const assoc of associates || []) {
      const { data: entries, error: eerr } = await supabase
        .from('time_entries')
        .select('id, clock_in, clock_out, description, task_id')
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

      const totalHours = claimableEntries.reduce((s, e) => {
        const h = (new Date(e.clock_out as string).getTime() - new Date(e.clock_in as string).getTime()) / 3_600_000;
        return s + h;
      }, 0);
      const rate = parseFloat(assoc.hourly_rate as unknown as string) || 0;
      const amount = Math.round(totalHours * rate * 100) / 100;
      const amountCents = Math.round(amount * 100);

      if (amountCents <= 0) continue;

      if (amountCents > availableCents) {
        results.push({
          associate_id: assoc.id,
          skipped: 'insufficient_balance',
          owed: amount,
          available: availableCents / 100,
          entry_count: claimableEntries.length
        });
        continue;
      }

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

      // Resolve task titles for entries that have a task_id but no inline description.
      const taskIds = Array.from(new Set(claimableEntries.map(e => (e as any).task_id).filter(Boolean))) as string[];
      let taskNames: Record<string, string> = {};
      if (taskIds.length > 0) {
        const { data: tasks } = await supabase.from('tasks').select('id, title').in('id', taskIds);
        for (const t of tasks || []) if (t.title) taskNames[t.id] = t.title;
      }
      const breakdown = rollupEntries(claimableEntries as any, rate, taskNames);
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
          notes: `Auto-fired by pay-pending-associates`,
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
        // Roll back claim so the entries become payable again on next run.
        await supabase.from('payout_time_entries').delete().eq('payout_id', payoutPre.id);
        await supabase.from('payouts').delete().eq('id', payoutPre.id);
        results.push({ associate_id: assoc.id, error: 'stripe_transfer_failed', message: (transferErr as Error).message });
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
        notes: `Auto-fired by pay-pending-associates. Transfer ${transfer.id}. ${claimableEntries.length} entries (${dateRange.first} to ${dateRange.last}).`,
        recorded_by: 'system:pay-pending-associates',
        is_test: false
      }).select('id').single();
      if (lerr) {
        results.push({ associate_id: assoc.id, transfer_id: transfer.id, error: 'ledger_insert_failed', message: lerr.message });
        continue;
      }

      await supabase.from('payouts')
        .update({ external_payout_id: transfer.id, status: 'processing', ledger_id: ledgerRow.id })
        .eq('id', payoutPre.id);
      const payoutRow = { id: payoutPre.id };

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
        const eta = addBusinessDays(new Date(), 2).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
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
                payment_method: 'Stripe (ACH)',
                hours: totalHours.toFixed(2),
                hourly_rate: rate.toFixed(2),
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
        balance_remaining: newAvailable / 100
      });
    }

    // Never let a payroll problem be silent. Any associate that did NOT get a
    // transfer_id is a failure the admin must see — except benign concurrent-claim
    // idempotency (another payout already grabbed the entries, not a real problem).
    const failures = results.filter((r: any) => !r.transfer_id && r.skipped !== 'concurrent_claim');
    if (failures.length > 0) {
      const rows = failures.map((f: any) => {
        const who = f.person_name || f.associate_id;
        const reason = f.error || f.skipped || f.warning || 'unknown';
        const detail = f.message
          || (f.owed != null ? `owed $${f.owed}, available $${f.available}` : '')
          || '';
        return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${who}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>${reason}</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${detail}</td></tr>`;
      }).join('');
      const html = `<h2 style="color:#c62828;">&#9888;&#65039; Payroll run could not pay ${failures.length} associate(s)</h2>
        <p>pay-pending-associates ran but failed to pay the following. <strong>No money moved</strong> for these associates. Please investigate.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr style="background:#f0f0f0;"><th style="padding:8px 10px;text-align:left;">Associate</th><th style="padding:8px 10px;text-align:left;">Reason</th><th style="padding:8px 10px;text-align:left;">Detail</th></tr></thead><tbody>${rows}</tbody></table>
        <p style="color:#666;font-size:13px;">Stripe balance at start of run: $${(availableCents / 100).toFixed(2)}. Automated alert from pay-pending-associates.</p>`;
      await sendAdminAlert(resendKey, `⚠️ Payroll problem — ${failures.length} associate(s) unpaid`, html);
    }

    return new Response(JSON.stringify({ ok: true, available_at_start: availableCents / 100, results }, null, 2),
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
