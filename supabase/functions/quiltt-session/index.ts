/**
 * Quiltt Session Token Manager
 *
 * Issues and manages Quiltt session tokens for authenticated users.
 * The API secret cannot be exposed client-side, so this edge function
 * acts as a proxy to Quiltt's Auth API.
 *
 * Deploy with: supabase functions deploy quiltt-session
 *
 * Actions:
 * - create: Issue a session token (creates Quiltt profile if needed)
 * - revoke: Revoke a session token on logout
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUILTT_AUTH_URL = 'https://auth.quiltt.io/v1/users/sessions';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('OK', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Authenticate the caller
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get app_user for person linkage
    const { data: appUser } = await supabase
      .from('app_users')
      .select('id, email, person_id, display_name')
      .eq('supabase_auth_id', user.id)
      .single();

    if (!appUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Quiltt config
    const { data: config } = await supabase
      .from('quiltt_config')
      .select('is_active')
      .single();

    if (!config?.is_active) {
      return new Response(JSON.stringify({ error: 'Quiltt integration disabled' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiSecret = Deno.env.get('QUILTT_API_SECRET');
    if (!apiSecret) {
      return new Response(JSON.stringify({ error: 'Quiltt API secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const action = body.action || 'create';

    if (action === 'create') {
      // Check if user already has a Quiltt profile
      const { data: existingProfile } = await supabase
        .from('quiltt_profiles')
        .select('quiltt_profile_id')
        .eq('app_user_id', appUser.id)
        .maybeSingle();

      let sessionBody: Record<string, unknown>;

      if (existingProfile) {
        // Reuse existing profile
        sessionBody = { userId: existingProfile.quiltt_profile_id };
      } else {
        // Create new profile with user's email
        sessionBody = { email: appUser.email };
      }

      const quilttRes = await fetch(QUILTT_AUTH_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody),
      });

      if (!quilttRes.ok) {
        const errText = await quilttRes.text();
        console.error('Quiltt session creation failed:', quilttRes.status, errText);
        return new Response(JSON.stringify({ error: 'Failed to create Quiltt session', detail: errText }), {
          status: quilttRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const session = await quilttRes.json();

      // Store/update the profile mapping if new
      if (!existingProfile) {
        await supabase.from('quiltt_profiles').upsert(
          {
            quiltt_profile_id: session.userId,
            app_user_id: appUser.id,
            person_id: appUser.person_id,
            email: appUser.email,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'quiltt_profile_id' }
        );
      }

      // Log API usage
      await supabase.from('api_usage_log').insert({
        vendor: 'quiltt',
        category: 'quiltt_session',
        endpoint: 'auth/sessions/create',
        units: 1,
        unit_type: 'api_calls',
        estimated_cost_usd: 0,
        metadata: { profile_id: session.userId, is_new: !existingProfile },
        app_user_id: appUser.id,
      });

      return new Response(JSON.stringify({
        token: session.token,
        profileId: session.userId,
        expiresAt: session.expiresAt,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'revoke') {
      const token = body.token;
      if (!token) {
        return new Response(JSON.stringify({ error: 'Token required for revoke' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const revokeRes = await fetch(QUILTT_AUTH_URL, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      return new Response(JSON.stringify({ success: revokeRes.ok }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('Quiltt session error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
