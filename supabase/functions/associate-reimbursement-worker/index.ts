import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { isServiceToken } from '../_shared/require-auth.ts';
import { SENDER_MAP } from '../_shared/template-engine.ts';

const ADMIN_EMAIL = 'rahulioson@gmail.com';
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

async function sendNotices(db: SupabaseClient, id: string | null) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('Resend is not configured');

  let query = db.from('associate_reimbursements')
    .select('id, amount_cents, description, purchase_date, profile:associate_profiles(user:app_users(display_name))')
    .eq('automatic_payment', true)
    .eq('status', 'pending')
    .is('review_email_sent_at', null)
    .order('created_at')
    .limit(12);
  if (id) query = query.eq('id', id);
  const { data: requests, error } = await query;
  if (error) throw new Error('Could not load the reimbursement notice queue');

  let sent = 0;
  const startedAt = Date.now();
  for (const request of requests || []) {
    if (Date.now() - startedAt > 40000) break;
    const profile = request.profile as unknown as { user: { display_name: string | null } | null } | null;
    const name = profile?.user?.display_name || 'An associate';
    const amount = currency.format(request.amount_cents / 100);
    const reviewUrl = 'https://alpacaplayhouse.com/admin/accounting.html?reimbursement=' + request.id;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'associate-reimbursement-notice/' + request.id
        },
        body: JSON.stringify({
          from: SENDER_MAP.pai.from,
          reply_to: SENDER_MAP.pai.reply_to,
          to: [ADMIN_EMAIL],
          subject: 'Reimbursement requested · ' + amount,
          text: [
            name + ' requested a reimbursement of ' + amount + '.',
            'Purchase date: ' + request.purchase_date,
            'Description: ' + request.description,
            '',
            'If eligible for automatic payment, it will go out at the next payroll run at least 24 hours after this notice.',
            'Sign in to review the receipts, delay payment until you release the hold, or decline the request.',
            '',
            'Review or delay payment: ' + reviewUrl
          ].join('\n')
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('Resend HTTP ' + response.status);

      const { error: updateError } = await db.from('associate_reimbursements')
        .update({ review_email_sent_at: new Date().toISOString() })
        .eq('id', request.id)
        .is('review_email_sent_at', null);
      if (updateError) throw new Error('Could not record accepted notice');
      sent++;
    } catch (error) {
      console.error('Reimbursement notice failed', request.id, (error as Error).message);
    }
  }
  return { examined: requests?.length || 0, sent };
}

function withinPayrollWindow(mode: string, now: Date) {
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  if (mode === 'regular') return hour === 2 && minute >= 30 && minute < 40;

  const hourCentral = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23'
  }).format(now);
  return (hour === 1 || hour === 2) && minute < 10 && hourCentral === '20';
}

async function updateFailedTransfer(db: SupabaseClient, id: string, reason: string, canRetry: boolean) {
  const fields = canRetry
    ? { transfer_error: reason, transfer_started_at: null, transfer_retry_after: new Date(Date.now() + 3600000).toISOString() }
    : { transfer_error: reason };
  const { error } = await db.from('associate_reimbursements').update(fields).eq('id', id).eq('status', 'pending');
  if (error) console.error('Reimbursement transfer state could not be updated', id);
}

async function payRequests(db: SupabaseClient, mode: string, now: Date) {
  if (!withinPayrollWindow(mode, now)) return { skipped: 'outside_payroll_window' };
  const { data: stripe, error: configError } = await db.from('stripe_config')
    .select('is_active, connect_enabled, test_mode, secret_key').single();
  if (configError) throw new Error('Could not load Stripe configuration');
  if (!stripe?.is_active || !stripe.connect_enabled || stripe.test_mode || !stripe.secret_key) {
    return { skipped: 'live_stripe_connect_not_available' };
  }

  const centralWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short'
  }).format(now);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(centralWeekday);
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  let query = db.from('associate_reimbursements')
    .select('id, profile:associate_profiles!inner(id)')
    .eq('automatic_payment', true)
    .eq('status', 'pending')
    .eq('payment_held', false)
    .is('transfer_started_at', null)
    .lte('created_at', cutoff)
    .lte('review_email_sent_at', cutoff)
    .or('transfer_retry_after.is.null,transfer_retry_after.lte.' + now.toISOString())
    .eq('profile.is_active', true)
    .eq('profile.payment_method', 'stripe')
    .not('profile.stripe_connect_account_id', 'is', null)
    .eq('profile.identity_verification_status', 'verified')
    .eq('profile.w9_status', 'submitted')
    .order('created_at')
    .limit(50);
  if (mode === 'instant') {
    query = query.eq('profile.instant_payout', true);
  } else {
    query = query.or(
      'instant_payout.eq.true,payout_frequency.is.null,payout_frequency.ilike.daily,payout_day_of_week.eq.' + day
        + (day === 6 ? ',payout_day_of_week.is.null' : ''),
      { foreignTable: 'profile' }
    );
  }
  const { data: requests, error } = await query;
  if (error) throw new Error('Could not load due reimbursements: ' + error.message);

  let paid = 0;
  for (const request of requests || []) {
    // Keep the invocation short enough to reach the durable result after Stripe accepts.
    if (Date.now() - now.getTime() > 40000) break;

    const { data: claim, error: claimError } = await db.rpc('claim_reimbursement_transfer', {
      p_id: request.id,
      p_instant: mode === 'instant'
    }).maybeSingle();
    if (claimError) {
      console.error('Could not claim reimbursement', request.id, claimError.message);
      continue;
    }
    if (!claim) continue;

    const { amount_cents: amount, destination, attempt_id: attemptId } = claim as {
      amount_cents: number; destination: string; attempt_id: string;
    };
    let transferId: string;
    try {
      const response = await fetch('https://api.stripe.com/v1/transfers', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + stripe.secret_key,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': 'associate-reimbursement/' + attemptId
        },
        body: new URLSearchParams({
          amount: String(amount),
          currency: 'usd',
          destination,
          'metadata[reimbursement_id]': request.id
        }),
        signal: AbortSignal.timeout(10000)
      });
      const payload = await response.json();
      if (response.status === 400 && payload.error?.code === 'balance_insufficient') {
        await updateFailedTransfer(db, request.id, 'Insufficient Stripe balance. Will retry at a later payroll run.', true);
        continue;
      }
      if (!response.ok || typeof payload.id !== 'string' || !/^tr_[a-z0-9]+$/i.test(payload.id)) {
        console.error('Stripe reimbursement transfer requires review', request.id, response.status, payload.error?.code);
        await updateFailedTransfer(db, request.id, 'Check Stripe before taking further payment action.', false);
        continue;
      }
      transferId = payload.id;
    } catch {
      console.error('Stripe reimbursement transfer outcome unknown', request.id);
      await updateFailedTransfer(db, request.id, 'Stripe transfer outcome is unknown. Check Stripe before taking further payment action.', false);
      continue;
    }

    const params = { p_id: request.id, p_transfer_id: transferId };
    let result = await db.rpc('finish_reimbursement_transfer', params);
    if (result.error) result = await db.rpc('finish_reimbursement_transfer', params);
    if (result.error) {
      console.error('Stripe reimbursement sent; ledger needs reconciliation', request.id, transferId);
      await updateFailedTransfer(db, request.id, 'Stripe accepted the transfer (' + transferId + '). The ledger needs reconciliation.', false);
      continue;
    }
    paid++;
  }
  return { examined: requests?.length || 0, paid };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !await isServiceToken(token)) {
    return Response.json({ error: 'Service role required' }, { status: 403 });
  }

  try {
    const { mode, id } = await request.json();
    if (!['notice', 'regular', 'instant'].includes(mode) || (id != null && (typeof id !== 'string' || !UUID.test(id)))) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const result = mode === 'notice' ? await sendNotices(db, id ?? null) : await payRequests(db, mode, new Date());
    return Response.json(result);
  } catch (error) {
    console.error('Reimbursement worker failed', (error as Error).message);
    return Response.json({ error: 'Reimbursement worker failed' }, { status: 500 });
  }
});
