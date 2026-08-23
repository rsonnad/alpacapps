import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeadersOpen } from "./api-helpers.ts";

export type FunctionRole = "admin" | "oracle" | "staff" | "associate" | "resident" | "demo";

export interface FunctionCaller {
  authUserId: string | null;
  appUser: {
    id: string;
    role: string;
    person_id?: string | null;
    email?: string | null;
    display_name?: string | null;
  } | null;
  isServiceRole: boolean;
}

function authResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeadersOpen, "Content-Type": "application/json" },
  });
}

/** Resolve a Supabase JWT or the private service-role token for an Edge Function. */
export async function resolveFunctionCaller(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ caller: FunctionCaller | null; response?: Response }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { caller: null, response: authResponse("Missing Authorization header", 401) };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) {
    return {
      caller: { authUserId: null, appUser: { id: "__service__", role: "oracle" }, isServiceRole: true },
    };
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { caller: null, response: authResponse("Invalid auth token", 401) };

  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("id, role, person_id, email, display_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (appUserError || !appUser) return { caller: null, response: authResponse("Application user not found", 403) };

  return { caller: { authUserId: user.id, appUser, isServiceRole: false } };
}

export async function requireFunctionRoles(
  req: Request,
  supabase: SupabaseClient,
  roles: FunctionRole[],
): Promise<{ caller: FunctionCaller | null; response?: Response }> {
  const result = await resolveFunctionCaller(req, supabase);
  if (result.response || !result.caller) return result;
  if (result.caller.isServiceRole || roles.includes(result.caller.appUser?.role as FunctionRole)) return result;
  return { caller: null, response: authResponse(`Role required: ${roles.join(", ")}`, 403) };
}

export async function requireFunctionPermission(
  req: Request,
  supabase: SupabaseClient,
  permissionKey: string,
): Promise<{ caller: FunctionCaller | null; response?: Response }> {
  const result = await resolveFunctionCaller(req, supabase);
  if (result.response || !result.caller) return result;
  if (result.caller.isServiceRole || result.caller.appUser?.role === "admin" || result.caller.appUser?.role === "oracle") return result;

  const { data: permission } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role", result.caller.appUser?.role)
    .eq("permission_key", permissionKey)
    .maybeSingle();
  if (permission) return result;
  return { caller: null, response: authResponse("Permission denied", 403) };
}
