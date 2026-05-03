import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/api-helpers.ts";

const MAX_LEN = 2000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    let text = url.searchParams.get("text");

    // Fallback: if no ?text=..., use the raw query string (so /showpolish?Hello+World works)
    if (!text && url.search.length > 1) {
      const raw = url.search.slice(1);
      try {
        text = decodeURIComponent(raw.replace(/\+/g, " "));
      } catch {
        text = raw;
      }
    }

    if (!text) {
      return new Response(
        JSON.stringify({
          error: "Missing text",
          usage: "GET /showpolish?text=Hello+World  OR  GET /showpolish?Hello+World",
        }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const channel = supabase.channel("showpolish");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Channel subscribe timeout")), 5000);
      channel.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`Channel error: ${status}`));
        }
      });
    });

    await channel.send({
      type: "broadcast",
      event: "update",
      payload: { text },
    });

    await supabase.removeChannel(channel);

    return new Response(
      JSON.stringify({ ok: true, text }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("showpolish error:", e.message);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
