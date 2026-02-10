/**
 * Stripe Webhook Handler
 *
 * Receives webhook notifications from Stripe for transfer and payment status.
 * Updates payouts table (and optionally stripe_payments) and ledger accordingly.
 *
 * Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
 * Webhook URL: https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/stripe-webhook
 *
 * Events handled:
 * - transfer.paid → payout completed
 * - transfer.failed → payout failed
 * - transfer.reversed → payout returned
 * - payment_intent.succeeded → inbound payment completed
 * - payment_intent.payment_failed → inbound payment failed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature'
};

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function parseStripeSignature(header: string | null): { t: string; v1: string } | null {
  if (!header) return null;
  const parts = header.split(',');
  let t = '';
  let v1 = '';
  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key?.trim() === 't') t = val?.trim() ?? '';
    if (key?.trim() === 'v1') v1 = val?.trim() ?? '';
  }
  return t && v1 ? { t, v1 } : null;
}

async function verifyStripeWebhook(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  const parsed = parseStripeSignature(signature);
  if (!parsed) return false;
  const { t, v1 } = parsed;
  const signedPayload = `${t}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );
  const expectedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return expectedHex === v1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('Stripe-Signature');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: config, error: configError } = await supabase
      .from('stripe_config')
      .select('webhook_secret, sandbox_webhook_secret, test_mode')
      .single();

    if (configError || !config) {
      console.error('Stripe config not found:', configError);
      return new Response(JSON.stringify({ error: 'Stripe config not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const webhookSecret = config.test_mode ? config.sandbox_webhook_secret : config.webhook_secret;
    if (!webhookSecret) {
      console.warn('No webhook secret configured');
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const valid = await verifyStripeWebhook(rawBody, signature, webhookSecret);
    if (!valid) {
      console.error('Stripe webhook signature verification failed');
      return new Response(
        JSON.stringify({ error: 'Webhook signature verification failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    console.log('Stripe webhook:', event.type, event.id);

    switch (event.type) {
      case 'transfer.paid': {
        const transfer = event.data.object as { id: string };
        const newStatus = 'completed';
        const { data: payouts } = await supabase
          .from('payouts')
          .select('id, ledger_id')
          .eq('external_payout_id', transfer.id)
          .eq('payment_method', 'stripe');

        if (payouts?.length) {
          for (const p of payouts) {
            await supabase.from('payouts').update({
              status: newStatus,
              updated_at: new Date().toISOString()
            }).eq('id', p.id);
            if (p.ledger_id) {
              await supabase.from('ledger').update({
                status: 'completed',
                updated_at: new Date().toISOString()
              }).eq('id', p.ledger_id);
            }
          }
        }
        break;
      }

      case 'transfer.failed':
      case 'transfer.reversed': {
        const transfer = event.data.object as { id: string; failure_message?: string };
        const newStatus = event.type === 'transfer.reversed' ? 'returned' : 'failed';
        const { data: payouts } = await supabase
          .from('payouts')
          .select('id, ledger_id')
          .eq('external_payout_id', transfer.id)
          .eq('payment_method', 'stripe');

        if (payouts?.length) {
          for (const p of payouts) {
            await supabase.from('payouts').update({
              status: newStatus,
              updated_at: new Date().toISOString(),
              error_message: transfer.failure_message || event.type
            }).eq('id', p.id);
            if (p.ledger_id) {
              await supabase.from('ledger').update({
                status: 'failed',
                updated_at: new Date().toISOString()
              }).eq('id', p.ledger_id);
            }
          }
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string };
        const { data: rows } = await supabase
          .from('stripe_payments')
          .select('id, ledger_id, payment_type, amount, person_id, person_name')
          .eq('stripe_payment_intent_id', pi.id);

        const PAYMENT_TYPE_TO_CATEGORY: Record<string, string> = {
          rental_application: 'application_fee',
          rent: 'rent',
          prorated_rent: 'prorated_rent',
          security_deposit: 'security_deposit',
          move_in_deposit: 'move_in_deposit',
          reservation_deposit: 'reservation_deposit',
          event_rental_fee: 'event_rental_fee',
          event_reservation_deposit: 'event_reservation_deposit',
          event_cleaning_deposit: 'event_cleaning_deposit',
          other: 'other'
        };

        if (rows?.length) {
          for (const row of rows) {
            const category = PAYMENT_TYPE_TO_CATEGORY[row.payment_type] || 'other';
            const { data: ledgerEntry, error: ledgerErr } = await supabase
              .from('ledger')
              .insert({
                direction: 'income',
                category,
                amount: row.amount,
                payment_method: 'stripe',
                transaction_date: new Date().toISOString().split('T')[0],
                person_id: row.person_id || null,
                person_name: row.person_name || null,
                status: 'completed',
                description: `Stripe payment: ${row.payment_type.replace(/_/g, ' ')}`,
                recorded_by: 'system:stripe-webhook',
                is_test: false
              })
              .select('id')
              .single();

            if (!ledgerErr && ledgerEntry) {
              await supabase.from('stripe_payments').update({
                status: 'completed',
                ledger_id: ledgerEntry.id,
                updated_at: new Date().toISOString()
              }).eq('id', row.id);
            } else {
              await supabase.from('stripe_payments').update({
                status: 'completed',
                updated_at: new Date().toISOString()
              }).eq('id', row.id);
            }
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as { id: string; last_payment_error?: { message?: string } };
        const { data: rows } = await supabase
          .from('stripe_payments')
          .select('id, ledger_id')
          .eq('stripe_payment_intent_id', pi.id);

        if (rows?.length) {
          for (const row of rows) {
            await supabase.from('stripe_payments').update({
              status: 'failed',
              error_message: pi.last_payment_error?.message || 'Payment failed',
              updated_at: new Date().toISOString()
            }).eq('id', row.id);
            if (row.ledger_id) {
              await supabase.from('ledger').update({
                status: 'failed',
                updated_at: new Date().toISOString()
              }).eq('id', row.ledger_id);
            }
          }
        }
        break;
      }

      default:
        console.log('Unhandled Stripe event type:', event.type);
    }

    return new Response(
      JSON.stringify({ received: true, type: event.type }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response(
      JSON.stringify({
        received: true,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
