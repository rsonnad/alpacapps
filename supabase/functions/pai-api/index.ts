import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAppUserWithPermission } from "../_shared/permissions.ts";

// =============================================
// PAI API — HTTP API channel for PAI
// Parallel to chat widget, Discord, email, voice
// =============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { message, conversation_id, user_id } = body;

    if (!message?.trim()) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    // --- Authentication ---
    // Accept either:
    //   1. Authorization: Bearer <JWT> (user's Supabase JWT)
    //   2. x-api-key header matching SUPABASE_SERVICE_ROLE_KEY (machine-to-machine)
    const authHeader = req.headers.get("Authorization");
    const apiKeyHeader = req.headers.get("x-api-key");
    const token = authHeader?.replace("Bearer ", "") ?? "";

    let appUser: any = null;

    if (apiKeyHeader === supabaseServiceKey) {
      // Machine-to-machine auth with service role key
      // If user_id provided, look up that app_user; otherwise use a generic API user
      if (user_id) {
        const { data: targetUser } = await supabase
          .from("app_users")
          .select("id, role, display_name, email, person_id, auth_user_id")
          .eq("id", user_id)
          .single();
        if (targetUser) {
          appUser = targetUser;
        }
      }
      if (!appUser) {
        // Fallback: generic API caller with staff-level access
        appUser = {
          id: "",
          role: "staff",
          display_name: "API Caller",
          email: null,
          person_id: null,
        };
      }
    } else if (token) {
      // JWT-based auth
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse({ error: "Invalid or expired token" }, 401);
      }
      const { appUser: au, hasPermission } = await getAppUserWithPermission(
        supabase, user.id, "use_pai"
      );
      if (!hasPermission) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }
      appUser = au;
    } else {
      return jsonResponse({
        error: "Authentication required. Provide Authorization: Bearer <JWT> or x-api-key header."
      }, 401);
    }

    // --- Load api_addendum from pai_config ---
    let apiAddendum = "";
    try {
      const { data: paiConfig } = await supabase
        .from("pai_config")
        .select("api_addendum")
        .eq("id", 1)
        .single();
      apiAddendum = paiConfig?.api_addendum?.trim() || "";
    } catch (_) { /* non-critical */ }

    // --- Forward to alpaca-pai function ---
    const paiUrl = `${supabaseUrl}/functions/v1/alpaca-pai`;
    const startTime = Date.now();

    const paiBody: any = {
      message: message.trim(),
      conversationHistory: body.conversation_history || [],
      context: {
        source: "api",
        conversation_id: conversation_id || null,
        api_addendum: apiAddendum,
      },
    };

    // If user has an auth_user_id, we can forward their JWT scope
    // For service-key callers, we forward with service key to get full access
    const forwardAuth = apiKeyHeader === supabaseServiceKey
      ? `Bearer ${supabaseServiceKey}`
      : `Bearer ${token}`;

    const paiResponse = await fetch(paiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": forwardAuth,
      },
      body: JSON.stringify(paiBody),
    });

    const elapsed = Date.now() - startTime;
    const paiResult = await paiResponse.json();

    // --- Log interaction ---
    if (appUser.id) {
      try {
        await supabase.from("pai_interactions").insert({
          app_user_id: appUser.id,
          source: "api",
          message_preview: message.substring(0, 100),
        });
      } catch (_) { /* non-critical */ }
    }

    // --- Log API usage ---
    try {
      await supabase.from("api_usage_log").insert({
        vendor: "internal",
        category: "pai_api_request",
        endpoint: "pai-api",
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        metadata: {
          channel: "api",
          user: appUser.display_name,
          role: appUser.role,
          response_time_ms: elapsed,
          conversation_id: conversation_id || null,
        },
      });
    } catch (_) { /* non-critical */ }

    // --- Return response ---
    return jsonResponse({
      reply: paiResult.reply || paiResult.error || "No response from PAI",
      actions_taken: paiResult.actions_taken || [],
      conversation_id: conversation_id || null,
      response_time_ms: elapsed,
      channel: "api",
      user: {
        display_name: appUser.display_name,
        role: appUser.role,
      },
      error: paiResult.error || undefined,
    });
  } catch (error) {
    console.error("pai-api error:", error.message);
    return jsonResponse(
      { error: error.message || "An unexpected error occurred" },
      500
    );
  }
});
