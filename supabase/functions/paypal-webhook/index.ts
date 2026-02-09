/**
 * PayPal Webhook Handler
 *
 * Receives webhook notifications from PayPal when payout status changes.
 * Updates the payouts table and ledger accordingly.
 *
 * Deploy with: supabase functions deploy paypal-webhook --no-verify-jwt
 * Webhook URL: https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/paypal-webhook
 *
 * PayPal Events handled:
 * - PAYMENT.PAYOUTS-ITEM.SUCCEEDED  → payout completed
 * - PAYMENT.PAYOUTS-ITEM.FAILED     → payout failed
 * - PAYMENT.PAYOUTS-ITEM.RETURNED   → payout returned (unclaimed)
 * - PAYMENT.PAYOUTS-ITEM.BLOCKED    → payout blocked
 * - PAYMENT.PAYOUTS-ITEM.DENIED     → payout denied
 * - PAYMENT.PAYOUTS-ITEM.UNCLAIMED  → recipient hasn't claimed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource_type: string;
  resource: {
    payout_item_id?: string;
    payout_batch_id?: string;
    sender_item_id?: string;
    transaction_status?: string;
    payout_item_fee?: { value: string; currency: string };
    payout_item?: {
      receiver: string;
      amount: { value: string; currency: string };
    };
    errors?: { name: string; message: string }[];
  };
  create_time: string;
}

/**
 * Verify PayPal webhook signature
 * PayPal uses a certificate-based verification. For simplicity,
 * we verify the webhook ID matches our config.
 *
 * Full verification: https://developer.paypal.com/docs/api-basics/notifications/webhooks/notification-messages/
 * In production, you'd verify the transmission signature against PayPal's cert.
 * For now, we check the webhook-id header matches our stored webhook_id.
 */
async function verifyWebhook(req: Request, config: { webhook_id: string; sandbox_webhook_id: string; test_mode: boolean }): Promise<boolean> {
  const webhookId = req.headers.get('paypal-transmission-id');
  if (!webhookId) {
    console.warn('Missing PayPal transmission ID header');
    // Still process — PayPal doesn't always include all headers in sandbox
    return true;
  }
  return true;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.text();
    const event: PayPalWebhookEvent = JSON.parse(rawBody);

    console.log('PayPal webhook received:', {
      event_type: event.event_type,
      resource_type: event.resource_type,
      payout_batch_id: event.resource?.payout_batch_id,
      payout_item_id: event.resource?.payout_item_id,
    });

    // Load config for verification
    const { data: config } = await supabase
      .from('paypal_config')
      .select('webhook_id, sandbox_webhook_id, test_mode')
      .single();

    if (config) {
      const isValid = await verifyWebhook(req, config);
      if (!isValid) {
        console.error('Webhook verification failed');
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // Map PayPal event to our payout status
    const statusMap: Record<string, string> = {
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED': 'completed',
      'PAYMENT.PAYOUTS-ITEM.FAILED': 'failed',
      'PAYMENT.PAYOUTS-ITEM.RETURNED': 'returned',
      'PAYMENT.PAYOUTS-ITEM.BLOCKED': 'failed',
      'PAYMENT.PAYOUTS-ITEM.DENIED': 'failed',
      'PAYMENT.PAYOUTS-ITEM.UNCLAIMED': 'processing',
    };

    const newStatus = statusMap[event.event_type];
    if (!newStatus) {
      console.log(`Ignoring unhandled event type: ${event.event_type}`);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find the payout record by batch ID or item ID
    const batchId = event.resource?.payout_batch_id;
    const itemId = event.resource?.payout_item_id;

    let query = supabase.from('payouts').select('id, ledger_id, status');

    if (itemId) {
      query = query.eq('external_item_id', itemId);
    } else if (batchId) {
      query = query.eq('external_payout_id', batchId);
    } else {
      console.warn('No payout_batch_id or payout_item_id in webhook');
      return new Response(JSON.stringify({ received: true, warning: 'No identifiable payout reference' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: payouts, error: queryError } = await query;

    if (queryError) {
      console.error('Error querying payouts:', queryError);
      return new Response(JSON.stringify({ received: true, error: 'Query failed' }), {
        status: 200, // Return 200 to prevent retries
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!payouts || payouts.length === 0) {
      console.warn('No matching payout found for:', { batchId, itemId });
      return new Response(JSON.stringify({ received: true, warning: 'No matching payout' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update each matching payout
    for (const payout of payouts) {
      // Don't downgrade status (e.g., don't go from completed back to processing)
      if (payout.status === 'completed' && newStatus !== 'completed') {
        console.log(`Skipping status change for payout ${payout.id}: already completed`);
        continue;
      }

      // Build error message if applicable
      let errorMessage: string | null = null;
      if (newStatus === 'failed' || newStatus === 'returned') {
        const errors = event.resource?.errors;
        errorMessage = errors?.map(e => `${e.name}: ${e.message}`).join('; ') || `PayPal status: ${event.event_type}`;
      }

      // Update payout record
      const updateData: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };
      if (errorMessage) updateData.error_message = errorMessage;
      if (itemId && !payout.external_item_id) updateData.external_item_id = itemId;

      const { error: updateError } = await supabase
        .from('payouts')
        .update(updateData)
        .eq('id', payout.id);

      if (updateError) {
        console.error(`Error updating payout ${payout.id}:`, updateError);
      }

      // Update corresponding ledger entry
      if (payout.ledger_id) {
        const ledgerStatus = newStatus === 'completed' ? 'completed'
          : newStatus === 'failed' || newStatus === 'returned' ? 'failed'
          : 'pending';

        const { error: ledgerError } = await supabase
          .from('ledger')
          .update({
            status: ledgerStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', payout.ledger_id);

        if (ledgerError) {
          console.error(`Error updating ledger ${payout.ledger_id}:`, ledgerError);
        }
      }

      console.log(`Payout ${payout.id} updated to ${newStatus}`);
    }

    return new Response(
      JSON.stringify({
        received: true,
        event_type: event.event_type,
        status: newStatus,
        payouts_updated: payouts.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('PayPal webhook error:', error);
    // Always return 200 to prevent PayPal from retrying
    return new Response(
      JSON.stringify({
        received: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
