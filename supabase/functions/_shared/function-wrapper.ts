/**
 * Edge-function wrapper (#33).
 *
 * Wraps a handler with CORS + JSON error responses + (optional) role
 * gating. Replaces the ~25 copies of the same try/catch + cors
 * boilerplate across our edge functions.
 *
 * Usage:
 *   Deno.serve(withCors(async (req) => {
 *     const body = await req.json();
 *     return jsonOk({ hello: 'world' });
 *   }));
 *
 * Usage with auth:
 *   Deno.serve(withCors(withAuth('admin', async (req, ctx) => {
 *     // ctx.user, ctx.appUser, ctx.role available
 *     return jsonOk(...)
 *   })));
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from './api-helpers.ts';

export type Handler = (req: Request, ctx?: any) => Promise<Response>;

export function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function withCors(handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    try {
      const res = await handler(req);
      // Merge CORS into response.
      const merged = new Headers(res.headers);
      Object.entries(cors).forEach(([k, v]) => merged.set(k, v));
      return new Response(res.body, { status: res.status, headers: merged });
    } catch (err) {
      console.error('[withCors] unhandled error:', err);
      return new Response(
        JSON.stringify({ error: (err as Error)?.message || 'Internal error' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
  };
}

type Role = 'admin' | 'oracle' | 'staff' | 'associate' | 'resident' | 'demo';

export function withAuth(requiredRoles: Role | Role[], handler: Handler): Handler {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return async (req: Request) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!auth) return jsonError('Missing Authorization header', 401);

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: `Bearer ${auth}` } }
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonError('Invalid auth token', 401);

    const admin = createClient(supabaseUrl, service);
    const { data: appUser } = await admin
      .from('app_users')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!appUser || !roles.includes(appUser.role as Role)) {
      return jsonError(`Role required: ${roles.join(', ')}`, 403);
    }

    return handler(req, { user, appUser, role: appUser.role, supabase: admin });
  };
}

/**
 * Check a sliding-window rate limit via the check_rate_limit RPC.
 * Returns true if the request should be allowed.
 */
export async function checkRateLimit(
  supabase: any,
  bucket: string,
  ip: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data } = await supabase.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_ip: ip,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });
    return data !== false;
  } catch (_e) {
    // Fail open if the helper is unavailable — better than blocking real users.
    return true;
  }
}

export function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || 'unknown';
}
