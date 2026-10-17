import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeadersOpen } from "./api-helpers.ts";
import { timingSafeEqual } from "./timing-safe.ts";

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
  isCron?: boolean;
}

function authResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeadersOpen, "Content-Type": "application/json" },
  });
}

/** True when the token is one of the project's service-role keys (new sb_secret key or the legacy JWT). */
async function isServiceToken(token: string): Promise<boolean> {
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "LEGACY_SERVICE_ROLE_KEY", "SERVICE_ROLE_JWT"]) {
    const key = Deno.env.get(name);
    if (key && await timingSafeEqual(token, key)) return true;
  }
  return false;
}

/** Resolve a Supabase JWT or the private service-role token for an Edge Function. */
export async function resolveFunctionCaller(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ caller: FunctionCaller | null; response?: Response }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { caller: null, response: authResponse("Missing Authorization header", 401) };

  if (await isServiceToken(token)) {
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

/**
 * For scheduled functions: accept pg_cron's X-Cron-Secret header (SCHEDULE_CRON_SECRET,
 * read by cron jobs from Vault via public.cron_post), otherwise fall back to role checks.
 * Opt-in per function so the cron secret never unlocks payout or messaging endpoints.
 */
export async function requireCronOrRoles(
  req: Request,
  supabase: SupabaseClient,
  roles: FunctionRole[],
): Promise<{ caller: FunctionCaller | null; response?: Response }> {
  const cronSecret = Deno.env.get("SCHEDULE_CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && cronHeader && await timingSafeEqual(cronHeader, cronSecret)) {
    return {
      caller: { authUserId: null, appUser: { id: "__cron__", role: "oracle" }, isServiceRole: true, isCron: true },
    };
  }
  return requireFunctionRoles(req, supabase, roles);
}
