import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

interface SonosRequest {
  action:
    | "getZones"
    | "getState"
    | "play"
    | "pause"
    | "playpause"
    | "next"
    | "previous"
    | "volume"
    | "mute"
    | "unmute"
    | "favorite"
    | "favorites"
    | "pauseall"
    | "resumeall"
    | "join"
    | "leave";
  room?: string;
  value?: number | string;
  name?: string;
  other?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Verify user has resident+ role
    const { data: appUser } = await supabase
      .from("app_users")
      .select("role")
      .eq("auth_user_id", user.id)
      .single();

    if (
      !appUser ||
      !["resident", "associate", "staff", "admin"].includes(appUser.role)
    ) {
      return jsonResponse({ error: "Insufficient permissions" }, 403);
    }

    // Get proxy config from env
    const proxyUrl = Deno.env.get("SONOS_PROXY_URL");
    const proxySecret = Deno.env.get("SONOS_PROXY_SECRET");
    if (!proxyUrl || !proxySecret) {
      return jsonResponse({ error: "Sonos proxy not configured" }, 500);
    }

    const body: SonosRequest = await req.json();
    const { action } = body;

    // Build Sonos HTTP API path
    let path = "";
    const room = body.room ? encodeURIComponent(body.room) : null;

    switch (action) {
      case "getZones":
        path = "/zones";
        break;
      case "getState":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/state`;
        break;
      case "play":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/play`;
        break;
      case "pause":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/pause`;
        break;
      case "playpause":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/playpause`;
        break;
      case "next":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/next`;
        break;
      case "previous":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/previous`;
        break;
      case "volume": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const vol = body.value;
        if (vol === undefined || vol === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/volume/${encodeURIComponent(String(vol))}`;
        break;
      }
      case "mute":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/mute`;
        break;
      case "unmute":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/unmute`;
        break;
      case "favorite":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        if (!body.name) return jsonResponse({ error: "Missing name" }, 400);
        path = `/${room}/favorite/${encodeURIComponent(body.name)}`;
        break;
      case "favorites":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/favorites`;
        break;
      case "pauseall":
        path = "/pauseall";
        break;
      case "resumeall":
        path = "/resumeall";
        break;
      case "join":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        if (!body.other) return jsonResponse({ error: "Missing other" }, 400);
        path = `/${room}/join/${encodeURIComponent(body.other)}`;
        break;
      case "leave":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/leave`;
        break;
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    // Forward to Sonos proxy on DO droplet
    const sonosResponse = await fetch(`${proxyUrl}${path}`, {
      headers: { "X-Sonos-Secret": proxySecret },
    });

    const result = await sonosResponse.text();

    // Try to parse as JSON, fall back to wrapping as text
    try {
      const json = JSON.parse(result);
      return jsonResponse(json, sonosResponse.ok ? 200 : sonosResponse.status);
    } catch {
      return jsonResponse(
        { status: sonosResponse.ok ? "ok" : "error", response: result },
        sonosResponse.ok ? 200 : sonosResponse.status
      );
    }
  } catch (error) {
    console.error("Sonos control error:", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});
