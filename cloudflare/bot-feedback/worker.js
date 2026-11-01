// alpacaplayhouse.com/bots/feedback — lets bots POST feedback to the site's own
// address. GitHub Pages cannot take a POST, so this Worker sits on the route
// alpacaplayhouse.com/bots/feedback* and:
//   - POST /bots/feedback(/)  -> the bot-feedback edge function, with the
//     caller's real IP in X-Client-IP plus a shared secret, so the function's
//     per-IP limit still works (otherwise every caller shares Cloudflare's IP);
//   - everything else (the form page, the admin page) -> GitHub Pages untouched.
const FUNCTION_URL = "https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/bot-feedback";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isEndpoint = url.pathname === "/bots/feedback" || url.pathname === "/bots/feedback/";
    if (!isEndpoint || !["POST", "OPTIONS"].includes(request.method)) return fetch(request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const upstream = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") || "application/json",
        "X-Client-IP": request.headers.get("cf-connecting-ip") || "",
        "X-Forward-Secret": env.FORWARD_SECRET,
      },
      body: await request.arrayBuffer(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
};
