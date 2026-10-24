// files-gate — Cloudflare Worker in front of files.alpacaplayhouse.com
// (the Alpuca file-search API, reached through the cloudflared tunnel).
//
// The origin trusts one shared secret, and that secret used to sit in the
// public page rahulio/pages/files/index.html. This Worker holds it instead
// (Worker secret ORIGIN_SECRET) and only forwards requests that carry a
// Supabase access token for ALLOWED_EMAIL:
//   - Authorization: Bearer <jwt>   (fetch calls)
//   - ?jwt=<jwt>                    (<img src> thumbnails, which can't send headers)
// The jwt param is stripped before the request reaches the origin.

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
// env.SUPABASE_ANON_KEY: the public anon key from shared/supabase.js, set at deploy
// (see README / wrangler.jsonc) so secret scanners don't flag the JWT here.
const ALLOWED_ORIGINS = new Set(['https://alpacaplayhouse.com', 'https://www.alpacaplayhouse.com']);

const emailCache = new Map();
const CACHE_MS = 60_000;

async function emailFor(jwt, anonKey) {
  const hit = emailCache.get(jwt);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.email;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
  });
  const email = res.ok ? ((await res.json()).email || '').toLowerCase() : null;
  if (emailCache.size > 200) emailCache.clear();
  emailCache.set(jwt, { at: Date.now(), email });
  return email;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://alpacaplayhouse.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const auth = request.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('jwt');
    const allowed = (env.ALLOWED_EMAIL || '').toLowerCase();
    if (!jwt || !allowed || !env.ORIGIN_SECRET || !env.SUPABASE_ANON_KEY || (await emailFor(jwt, env.SUPABASE_ANON_KEY)) !== allowed) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...cors(origin) },
      });
    }

    // Rebuild the request for the origin: drop the caller's credentials, add the shared secret.
    url.searchParams.delete('jwt');
    url.searchParams.delete('_k');
    url.searchParams.delete('key');
    if (url.pathname.startsWith('/thumbnail/')) url.searchParams.set('key', env.ORIGIN_SECRET);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${env.ORIGIN_SECRET}`);
    headers.delete('Cookie');

    const upstream = await fetch(url.toString(), { method: request.method, headers, body: request.body });
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
    return res;
  },
};
