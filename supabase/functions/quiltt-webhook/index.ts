/**
 * Quiltt Webhook Handler
 *
 * Receives webhook notifications from Quiltt for banking events:
 * connection syncs, account creation/verification, balance updates, etc.
 *
 * Deploy with: supabase functions deploy quiltt-webhook --no-verify-jwt
 * Webhook URL: https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/quiltt-webhook
 *
 * Events handled:
 * - connection.synced.successful* → bank data synced
 * - connection.disconnected → bank connection lost
 * - account.created → new bank account linked
 * - account.verified → ACH numbers available
 * - balance.created → balance data available
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, quiltt-signature, quiltt-timestamp',
};

interface QuilttEvent {
  id: string;
  at: string;
  type: string;
  profile: {
    id: string;
    uuid: string;
    metadata: Record<string, unknown> | null;
  };
  record: {
    id: string;
    provider?: string;
    status?: string;
    metadata: Record<string, unknown> | null;
    at?: string;
  };
  metadata?: {
    startDate?: string;
    endDate?: string;
    [key: string]: unknown;
  };
}

interface QuilttWebhookPayload {
  environment: {
    id: string;
    mode: string;
    metadata: Record<string, unknown> | null;
  };
  eventTypes: string[];
  events: QuilttEvent[];
}

// Quiltt signature: Base64(HMAC-SHA256("1" + timestamp + rawBody))
async function verifyQuilttWebhook(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!timestamp || !signature) return false;

  // Check timestamp freshness (5 minutes)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    console.warn('Quiltt webhook timestamp too old:', now - ts, 'seconds');
    return false;
  }

  const payload = `1${timestamp}${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expectedBase64 === signature;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const rawBody = await req.text();
    const timestamp = req.headers.get('quiltt-timestamp');
    const signature = req.headers.get('quiltt-signature');

    // Get webhook secret from config
    const { data: config } = await supabase
      .from('quiltt_config')
      .select('webhook_secret, is_active')
      .single();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ error: 'Quiltt integration disabled' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify signature if secret is configured
    if (config.webhook_secret) {
      const isValid = await verifyQuilttWebhook(rawBody, timestamp, signature, config.webhook_secret);
      if (!isValid) {
        console.error('Quiltt webhook signature verification failed');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const payload: QuilttWebhookPayload = JSON.parse(rawBody);
    console.log('Quiltt webhook received:', payload.eventTypes.join(', '), `(${payload.events.length} events)`);

    for (const event of payload.events) {
      // Dedup: check if we already processed this event
      const { data: existing } = await supabase
        .from('quiltt_webhook_events')
        .select('id')
        .eq('event_id', event.id)
        .maybeSingle();

      if (existing) {
        console.log(`Skipping duplicate event: ${event.id}`);
        continue;
      }

      // Log the event
      await supabase.from('quiltt_webhook_events').insert({
        event_id: event.id,
        event_type: event.type,
        quiltt_profile_id: event.profile.id,
        quiltt_record_id: event.record.id,
        payload: event,
      });

      // Route by event type
      if (event.type.startsWith('connection.synced.successful')) {
        await handleConnectionSynced(supabase, event);
      } else if (event.type === 'connection.disconnected') {
        await handleConnectionDisconnected(supabase, event);
      } else if (event.type === 'account.created') {
        await handleAccountCreated(supabase, event);
      } else if (event.type === 'account.verified') {
        await handleAccountVerified(supabase, event);
      } else if (event.type === 'balance.created') {
        await handleBalanceCreated(supabase, event);
      } else {
        console.log(`Unhandled event type: ${event.type}`);
      }
    }

    // Log API usage
    await supabase.from('api_usage_log').insert({
      vendor: 'quiltt',
      category: 'quiltt_webhook',
      endpoint: payload.eventTypes.join(','),
      units: payload.events.length,
      unit_type: 'webhook_events',
      estimated_cost_usd: 0,
      metadata: {
        environment: payload.environment.mode,
        event_types: payload.eventTypes,
        event_count: payload.events.length,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Quiltt webhook error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// --- Event Handlers ---

async function handleConnectionSynced(supabase: ReturnType<typeof createClient>, event: QuilttEvent) {
  console.log(`Connection synced: ${event.record.id} (${event.type})`);

  // Upsert the connection
  await supabase
    .from('quiltt_connections')
    .upsert(
      {
        quiltt_connection_id: event.record.id,
        quiltt_profile_id: event.profile.id,
        institution_name: (event.record.metadata as Record<string, string>)?.institutionName || null,
        institution_id: (event.record.metadata as Record<string, string>)?.institutionId || null,
        status: 'synced',
        last_synced_at: event.record.at || event.at,
        metadata: {
          provider: event.record.provider,
          sync_type: event.type.replace('connection.synced.successful.', ''),
          start_date: event.metadata?.startDate,
          end_date: event.metadata?.endDate,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'quiltt_connection_id' }
    );
}

async function handleConnectionDisconnected(supabase: ReturnType<typeof createClient>, event: QuilttEvent) {
  console.log(`Connection disconnected: ${event.record.id}`);

  await supabase
    .from('quiltt_connections')
    .update({
      status: 'disconnected',
      disconnected_at: event.at,
      updated_at: new Date().toISOString(),
    })
    .eq('quiltt_connection_id', event.record.id);
}

async function handleAccountCreated(supabase: ReturnType<typeof createClient>, event: QuilttEvent) {
  console.log(`Account created: ${event.record.id}`);

  const record = event.record as Record<string, unknown>;
  await supabase
    .from('quiltt_accounts')
    .upsert(
      {
        quiltt_account_id: event.record.id,
        quiltt_profile_id: event.profile.id,
        account_type: (record.metadata as Record<string, string>)?.type || null,
        account_subtype: (record.metadata as Record<string, string>)?.subtype || null,
        account_name: (record.metadata as Record<string, string>)?.name || null,
        mask: (record.metadata as Record<string, string>)?.mask || null,
        metadata: record.metadata || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'quiltt_account_id' }
    );
}

async function handleAccountVerified(supabase: ReturnType<typeof createClient>, event: QuilttEvent) {
  console.log(`Account verified: ${event.record.id} — ACH numbers now available`);

  await supabase
    .from('quiltt_accounts')
    .update({
      is_verified: true,
      updated_at: new Date().toISOString(),
    })
    .eq('quiltt_account_id', event.record.id);
}

async function handleBalanceCreated(supabase: ReturnType<typeof createClient>, event: QuilttEvent) {
  console.log(`Balance created for account: ${event.record.id}`);

  const record = event.record as Record<string, unknown>;
  const meta = record.metadata as Record<string, unknown> | null;

  await supabase
    .from('quiltt_accounts')
    .update({
      balance_available: meta?.available != null ? Number(meta.available) : null,
      balance_current: meta?.current != null ? Number(meta.current) : null,
      balance_updated_at: event.at,
      updated_at: new Date().toISOString(),
    })
    .eq('quiltt_account_id', event.record.id);
}
