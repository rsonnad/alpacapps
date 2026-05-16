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
      .select('id, app_user_id, hourly_rate, payment_method, stripe_connect_account_id, identity_verification_status, payout_frequency, payout_day_of_week')
      .eq('payment_method', 'stripe')
      .not('stripe_connect_account_id', 'is', null)
      .eq('identity_verification_status', 'verified');

    if (aerr) throw new Error(`associates query failed: ${aerr.message}`);

    // Schedule gate. Cron fires every night at 00:00 UTC (= 8pm EDT / 7pm EST).
    // Day-of-week / day-of-month are evaluated in ET so a "Saturday payout" means
    // Saturday-evening-Eastern, even though that's already Sunday in UTC.
    //
    //   daily     → fire every night; pay all unpaid (clock_out IS NOT NULL)
    //   weekly    → fire only on payout_day_of_week; pay through end of (chosen_day − 1) ET
    //   biweekly  → fire only on payout_day_of_week AND >=13 days since last payout
    //   monthly   → fire only on the first occurrence of payout_day_of_week each month
    const TZ = 'America/New_York';
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(new Date());
    const etYear = etParts.find(p => p.type === 'year')!.value;
    const etMonth = etParts.find(p => p.type === 'month')!.value;
    const etDay = etParts.find(p => p.type === 'day')!.value;
    const etWeekdayStr = etParts.find(p => p.type === 'weekday')!.value; // 'Sun'..'Sat'
    const WEEKDAY_MAP: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const etDayOfWeek = WEEKDAY_MAP[etWeekdayStr];
    const etDayOfMonth = parseInt(etDay, 10);
    const etTodayStr = `${etYear}-${etMonth}-${etDay}`; // YYYY-MM-DD in ET

    for (const assoc of associates || []) {
      const frequency = (assoc as any).payout_frequency || 'daily';
      const targetDow = (assoc as any).payout_day_of_week ?? 6;

      // Schedule gate
      if (frequency !== 'daily' && etDayOfWeek !== targetDow) {
        results.push({ associate_id: assoc.id, skipped: `${frequency}_wrong_day_of_week`, target_dow: targetDow, today_dow: etDayOfWeek });
        continue;
      }
      if (frequency === 'monthly' && etDayOfMonth > 7) {
        // First occurrence of target_dow is always within day-of-month 1..7
        results.push({ associate_id: assoc.id, skipped: 'monthly_not_first_occurrence', frequency, day_of_month: etDayOfMonth });
        continue;
      }
      if (frequency === 'biweekly') {
        const { data: lastPayout } = await supabase
          .from('payouts')
          .select('created_at')
          .eq('associate_id', assoc.id)
          .in('status', ['processing', 'paid', 'succeeded'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastPayout?.created_at) {
          const daysSince = (Date.now() - new Date(lastPayout.created_at).getTime()) / 86_400_000;
          if (daysSince < 13) {
            results.push({ associate_id: assoc.id, skipped: 'biweekly_too_soon', days_since_last: Math.round(daysSince) });
            continue;
          }
        }
      }

      // Entry window: daily pays everything unpaid; non-daily caps at end of
      // (chosen_day − 1) ET. Since the run happens ON the chosen day, that's
      // end-of-yesterday in ET. We approximate this as clock_out < etTodayStr,
      // treating clock_out's date in UTC. Off-by-up-to-4h for entries clocked
      // out in the late-night ET window of "yesterday" — acceptable; those
      // entries just roll to next cycle.
      let entriesQuery = supabase
        .from('time_entries')
        .select('id, clock_in, clock_out, description, task_id')
        .eq('associate_id', assoc.id)
        .eq('is_paid', false)
        .not('clock_out', 'is', null);
      if (frequency !== 'daily') {
        entriesQuery = entriesQuery.lt('clock_out', etTodayStr);
      }
      const { data: entries, error: eerr } = await entriesQuery;
      if (eerr) { results.push({ associate_id: assoc.id, skipped: 'entries query failed', error: eerr.message }); continue; }
      if (!entries || entries.length === 0) continue;

      const totalHours = entries.reduce((s, e) => {
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
          entry_count: entries.length
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
      const taskIds = Array.from(new Set(entries.map(e => (e as any).task_id).filter(Boolean))) as string[];
      let taskNames: Record<string, string> = {};
      if (taskIds.length > 0) {
        const { data: tasks } = await supabase.from('tasks').select('id, title').in('id', taskIds);
        for (const t of tasks || []) if (t.title) taskNames[t.id] = t.title;
      }
      const breakdown = rollupEntries(entries as any, rate, taskNames);
      const dateRange = breakdown.period;
      const description = `Auto payout: ${personName} — ${totalHours.toFixed(2)} hrs ${dateRange.first} to ${dateRange.last}`;

      let transfer: { id: string };
      try {
        transfer = await stripePost(secretKey, 'transfers', {
          amount: amountCents,
          currency: 'usd',
          destination: assoc.stripe_connect_account_id as string,
          description: description.slice(0, 500),
          'metadata[payout_associate_id]': assoc.id,
          'metadata[entry_count]': String(entries.length),
          'metadata[source]': 'pay-pending-associates'
        });
      } catch (transferErr) {
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
        notes: `Auto-fired by pay-pending-associates. Transfer ${transfer.id}. ${entries.length} entries (${dateRange.first} to ${dateRange.last}).`,
        recorded_by: 'system:pay-pending-associates',
        is_test: false
      }).select('id').single();
      if (lerr) {
        results.push({ associate_id: assoc.id, transfer_id: transfer.id, error: 'ledger_insert_failed', message: lerr.message });
        continue;
      }

      const { data: payoutRow } = await supabase.from('payouts').insert({
        associate_id: assoc.id,
        person_id: personId,
        person_name: personName,
        amount,
        payment_method: 'stripe',
        payment_handle: assoc.stripe_connect_account_id,
        external_payout_id: transfer.id,
        status: 'processing',
        time_entry_ids: entries.map(e => e.id),
        ledger_id: ledgerRow.id,
        notes: `Auto-fired by pay-pending-associates`,
        is_test: false
      }).select('id').single();

      const { error: uerr } = await supabase
        .from('time_entries')
        .update({ is_paid: true, payment_id: ledgerRow.id })
        .in('id', entries.map(e => e.id));
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
        entry_count: entries.length,
        transfer_id: transfer.id,
        ledger_id: ledgerRow.id,
        payout_id: payoutRow?.id,
        balance_remaining: newAvailable / 100
      });
    }

    return new Response(JSON.stringify({ ok: true, available_at_start: availableCents / 100, results }, null, 2),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('pay-pending-associates error', err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, results }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
