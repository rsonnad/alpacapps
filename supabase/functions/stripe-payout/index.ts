/**
 * Stripe Payout Edge Function
 *
 * Sends outbound ACH payments to workers/associates via Stripe Connect Transfers.
 * Associate must have stripe_connect_account_id (completed Connect onboarding).
 * Follows paypal-payout pattern: load config, identity gate, dual-write payouts + ledger.
 *
 * Deploy with: supabase functions deploy stripe-payout
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { buildBreakdownByEntryIds } from "../_shared/payout-breakdown.ts";
import { claimEntries, findClaimedEntries, markEntriesPaid, releaseClaim } from "../_shared/payout-claims.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
interface PayoutRequest {
  associate_id: string;
  amount: number;
  time_entry_ids?: string[];
  notes?: string;
}

interface StripeConfig {
  secret_key: string | null;
  sandbox_secret_key: string | null;
  connect_enabled: boolean;
  is_active: boolean;
  test_mode: boolean;
}

/**
 * Add N business days to a date, skipping weekends (Sat/Sun).
 * Federal holidays not considered — adequate for ETA rendering only.
 */
function addBusinessDays(date: Date, n: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

function formEncode(obj: Record<string, string | number>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Stripe rejected the request (4xx), so the transfer definitely did not happen. */
class StripeApiError extends Error {}

async function createStripeTransfer(
  secretKey: string,
  amountCents: number,
  destinationAccountId: string,
  description: string,
  metadata: Record<string, string>,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const body = formEncode({
    amount: amountCents,
    currency: 'usd',
    destination: destinationAccountId,
    description: description.slice(0, 500),
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v]))
  });

  const response = await fetch('https://api.stripe.com/v1/transfers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    const err = JSON.parse(text);
    const message = err?.error?.message || text;
    // 4xx = Stripe rejected the request. A 5xx may still have created it.
    throw response.status < 500 ? new StripeApiError(message) : new Error(`Stripe ${response.status}: ${message}`);
  }
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const auth = await requireFunctionRoles(req, supabase, ["admin", "oracle", "staff"]);
    if (auth.response) return auth.response;

    const body: PayoutRequest = await req.json();
    const { associate_id, time_entry_ids, notes } = body;
    let amount = Number.NaN;

    console.log('Processing Stripe payout:', { associate_id, amount, entryCount: time_entry_ids?.length ?? 0 });

    if (!associate_id || !Array.isArray(time_entry_ids) || time_entry_ids.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'associate_id and time_entry_ids are required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const { data: config, error: configError } = await supabase
      .from('stripe_config')
      .select('*')
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ success: false, error: 'Stripe configuration not found' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const stripeConfig = config as StripeConfig;
    if (!stripeConfig.is_active) {
      return new Response(
        JSON.stringify({ success: false, error: 'Stripe is not active. Enable it in Settings.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }
    if (!stripeConfig.connect_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: 'Stripe Connect is not enabled. Enable it in Settings.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const secretKey = stripeConfig.test_mode
      ? stripeConfig.sandbox_secret_key
      : stripeConfig.secret_key;
    if (!secretKey) {
      return new Response(
        JSON.stringify({ success: false, error: `Missing ${stripeConfig.test_mode ? 'sandbox' : 'production'} Stripe secret key` }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const { data: associate, error: assocError } = await supabase
      .from('associate_profiles')
      .select('*, app_user:app_user_id(display_name, first_name, last_name, person_id)')
      .eq('id', associate_id)
      .single();

    if (assocError || !associate) {
      return new Response(
        JSON.stringify({ success: false, error: 'Associate not found' }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (associate.identity_verification_status !== 'verified') {
      return new Response(
        JSON.stringify({ success: false, error: 'Identity verification required before payout. The associate must upload and verify their ID first.' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const uniqueEntryIds = [...new Set(time_entry_ids)].filter((id): id is string => typeof id === 'string' && id.length > 0);
    const { data: entries } = await supabase
      .from('time_entries')
      .select('id, associate_id, clock_in, clock_out, is_paid')
      .in('id', uniqueEntryIds)
      .eq('associate_id', associate_id);
    if (!entries || entries.length !== uniqueEntryIds.length || entries.some((entry: any) => entry.is_paid || !entry.clock_out)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Time entries are missing, unpaid status is invalid, or belong to another associate' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }
    const alreadyClaimed = await findClaimedEntries(supabase, uniqueEntryIds);
    if (alreadyClaimed.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: `${alreadyClaimed.length} of these time entries are already part of another payout` }),
        { status: 409, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }
    // Server-derived amount from the shared calculator (entry rates + daily
    // extra). The request's `amount` is ignored.
    const hourlyRate = parseFloat(associate.hourly_rate as any) || 0;
    const dailyExtra = parseFloat(associate.daily_extra as any) || 0;
    const breakdown = await buildBreakdownByEntryIds(supabase, uniqueEntryIds, hourlyRate, dailyExtra);
    amount = breakdown.totalAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No payable amount could be derived from the selected time entries' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const connectAccountId = associate.stripe_connect_account_id;
    if (!connectAccountId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No Stripe Connect account linked for this associate. They must complete Stripe Connect onboarding first.' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const personName = associate.app_user?.display_name
      || `${associate.app_user?.first_name || ''} ${associate.app_user?.last_name || ''}`.trim()
      || 'Unknown';
    const personId = associate.app_user?.person_id || null;
    const amountCents = Math.round(amount * 100);
    const description = notes ? `Alpaca Playhouse: ${notes}` : `Associate payment: ${personName}`;
    const isTest = !!stripeConfig.test_mode;

    // Claim the entries before any money moves (see _shared/payout-claims.ts).
    const { data: payout, error: payoutPreErr } = await supabase
      .from('payouts')
      .insert({
        associate_id,
        person_id: personId,
        person_name: personName,
        amount,
        payment_method: 'stripe',
        payment_handle: connectAccountId,
        status: 'pending',
        time_entry_ids: uniqueEntryIds,
        notes: isTest ? `[TEST MODE] ${notes || ''}`.trim() : (notes || null),
        is_test: isTest
      })
      .select()
      .single();
    if (payoutPreErr || !payout) {
      return new Response(
        JSON.stringify({ success: false, error: `Could not create payout record: ${payoutPreErr?.message}` }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }
    const claimErr = await claimEntries(supabase, payout.id, uniqueEntryIds);
    if (claimErr) {
      await releaseClaim(supabase, payout.id);
      return new Response(
        JSON.stringify({ success: false, error: `These time entries were just claimed by another payout (${claimErr})` }),
        { status: 409, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (isTest) {
      console.log('TEST MODE: Would send Stripe transfer:', {
        destination: connectAccountId,
        amountCents,
        description
      });

      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('ledger')
        .insert({
          direction: 'expense',
          category: 'associate_payment',
          amount,
          payment_method: 'stripe',
          transaction_date: new Date().toISOString().split('T')[0],
          person_id: personId,
          person_name: personName,
          status: 'completed',
          description: `Stripe payout to ${personName}`,
          notes: `[TEST MODE] ${notes || ''}`.trim(),
          recorded_by: 'system:stripe-payout',
          is_test: true
        })
        .select()
        .single();

      if (ledgerError) console.error('Error creating test ledger entry:', ledgerError);
      await supabase.from('payouts').update({
        status: 'completed',
        external_payout_id: `TEST-tr_${Date.now()}`,
        ledger_id: ledgerEntry?.id ?? null
      }).eq('id', payout.id);
      const markErr = await markEntriesPaid(supabase, uniqueEntryIds, ledgerEntry?.id ?? null);
      if (markErr) console.error('Error marking test entries paid:', markErr);

      await supabase.from('api_usage_log').insert({
        vendor: 'stripe',
        category: 'stripe_associate_payout',
        endpoint: 'transfers.create',
        units: 1,
        unit_type: 'api_calls',
        estimated_cost_usd: 0,
        metadata: { test_mode: true, associate_id }
      });

      return new Response(
        JSON.stringify({
          success: true,
          test_mode: true,
          payout_id: payout.id,
          ledger_id: ledgerEntry?.id,
          amount,
          entries_marked_paid: !markErr,
          message: `[TEST] Would have sent $${amount.toFixed(2)} to ${personName} via Stripe`
        }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Keyed on our payout row: short (Stripe caps keys at 255 chars, which a
    // key built from entry UUIDs overflowed past 6 entries) and unique per claim.
    const idempotencyKey = req.headers.get('Idempotency-Key')?.trim() || `stripe-payout-${payout.id}`;
    let transfer: { id: string };
    try {
      transfer = await createStripeTransfer(
        secretKey,
        amountCents,
        connectAccountId,
        description,
        { payout_associate_id: associate_id, payout_id: payout.id, source: 'stripe-payout' },
        idempotencyKey
      );
    } catch (transferErr) {
      if (transferErr instanceof StripeApiError) {
        // Stripe refused: no money moved. Release so a later attempt can pay.
        await releaseClaim(supabase, payout.id);
        throw transferErr;
      }
      // Network/timeout: the transfer may or may not exist. Keep the claim so
      // nothing re-pays these entries; the overdue watchdog will surface them
      // if the transfer really didn't happen.
      await supabase.from('payouts').update({
        status: 'failed',
        error_message: `Outcome unknown — check Stripe for metadata.payout_id=${payout.id} before retrying: ${(transferErr as Error).message}`
      }).eq('id', payout.id);
      throw new Error(`Stripe did not respond; entries stay locked to payout ${payout.id}. Check the Stripe dashboard before retrying.`);
    }

    console.log('Stripe transfer created:', transfer.id);

    const { data: ledgerEntry, error: ledgerError } = await supabase
      .from('ledger')
      .insert({
        direction: 'expense',
        category: 'associate_payment',
        amount,
        payment_method: 'stripe',
        transaction_date: new Date().toISOString().split('T')[0],
        person_id: personId,
        person_name: personName,
        status: 'pending',
        description: `Stripe payout to ${personName}`,
        notes: `Transfer ${transfer.id}.${breakdown.extraAmount > 0 ? ` Incl $${breakdown.extraAmount.toFixed(2)} daily extra.` : ''}${notes ? ` ${notes}` : ''}`,
        recorded_by: 'system:stripe-payout',
        is_test: false
      })
      .select()
      .single();

    if (ledgerError) console.error('Error creating ledger entry:', ledgerError);
    await supabase.from('payouts').update({
      status: 'processing',
      external_payout_id: transfer.id,
      ledger_id: ledgerEntry?.id ?? null
    }).eq('id', payout.id);
    // Money has moved: mark paid even if the ledger write failed.
    const markErr = await markEntriesPaid(supabase, uniqueEntryIds, ledgerEntry?.id ?? null);
    if (markErr) console.error('CRITICAL: transfer sent but entries not marked paid:', transfer.id, markErr);

    await supabase.from('api_usage_log').insert({
      vendor: 'stripe',
      category: 'stripe_associate_payout',
      endpoint: 'transfers.create',
      units: 1,
      unit_type: 'api_calls',
      estimated_cost_usd: 0,
      metadata: { transfer_id: transfer.id, associate_id }
    });

    // Send payout notification email (fire-and-forget, goes through approval workflow)
    try {
      // Look up associate's email from people table
      let recipientEmail = associate.payment_handle;
      if (personId) {
        const { data: person } = await supabase
          .from('people')
          .select('email')
          .eq('id', personId)
          .single();
        if (person?.email) recipientEmail = person.email;
      }
      if (recipientEmail) {
        const firstName = associate.app_user?.first_name || personName.split(' ')[0] || 'there';
        const tz = 'America/Chicago';
        const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: tz });
        // Stripe Connect ACH transfers typically settle in 2 business days
        const expectedDeposit = addBusinessDays(new Date(), 2);
        const expectedDepositDate = expectedDeposit.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
        const rate = hourlyRate;
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            type: 'associate_payout_sent',
            to: recipientEmail,
            bcc: 'alpacaplayhouse@gmail.com',
            data: {
              first_name: firstName,
              recipient_name: personName,
              amount: amount.toFixed(2),
              payment_method: 'Stripe (ACH)',
              payout_date: today,
              expected_deposit_date: expectedDepositDate,
              hours: breakdown.totalHours.toFixed(2),
              hourly_rate: rate > 0 ? rate.toFixed(2) : null,
              hourly_subtotal: breakdown.hourlyAmount.toFixed(2),
              daily_extra: breakdown.dailyExtra.toFixed(2),
              daily_extra_total: breakdown.extraAmount.toFixed(2),
              transfer_id: transfer.id,
              period_first: breakdown.period.first || null,
              period_last: breakdown.period.last || null,
              entry_count: breakdown.entryCount || null,
              day_count: breakdown.dayCount || null,
              daily_breakdown: breakdown.rows,
              notes: notes || null
            }
          })
        });
        console.log('Payout notification email queued for', recipientEmail, '(bcc admin)');
      }
    } catch (emailErr) {
      console.error('Non-fatal: payout email failed:', emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        payout_id: payout.id,
        ledger_id: ledgerEntry?.id,
        transfer_id: transfer.id,
        amount,
        // Lets the staff UI skip its own markPaid (see staff/payments.js).
        entries_marked_paid: !markErr,
        message: `Sent $${amount.toFixed(2)} to ${personName} via Stripe`
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe payout error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
