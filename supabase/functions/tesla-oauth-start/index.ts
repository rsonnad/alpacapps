import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";

const DEFAULT_FLEET_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com";
const REDIRECT_URI = "https://alpacaplayhouse.com/auth/tesla/callback";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const auth = await requireFunctionRoles(req, supabase, ["admin", "oracle", "staff", "associate", "resident"]);
    if (auth.response || !auth.caller) return auth.response!;

    const clientId = Deno.env.get("TESLA_FLEET_CLIENT_ID");
    const clientSecret = Deno.env.get("TESLA_FLEET_CLIENT_SECRET");
    const fleetApiBase = Deno.env.get("TESLA_FLEET_API_BASE") || DEFAULT_FLEET_API_BASE;
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Tesla Fleet OAuth is not configured" }), {
        status: 503,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const appUser = auth.caller.appUser!;
    const { data: account, error } = await supabase
      .from("tesla_accounts")
      .insert({
        owner_name: appUser.email || "AlpacApps user",
        tesla_email: appUser.email,
        app_user_id: appUser.id,
        fleet_client_id: clientId,
        fleet_client_secret: clientSecret,
        fleet_api_base: fleetApiBase,
      })
      .select("id")
      .single();
    if (error || !account) throw new Error(error?.message || "Could not create Tesla account");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds",
      state: `profile:${account.id}`,
      audience: fleetApiBase,
    });
    return new Response(JSON.stringify({ url: `https://auth.tesla.com/oauth2/v3/authorize?${params}` }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("tesla-oauth-start error:", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Unable to start Tesla authorization" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
