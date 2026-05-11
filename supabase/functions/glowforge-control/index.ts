import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAppUserWithPermission } from "../_shared/permissions.ts";
import { timingSafeEqual } from "../_shared/timing-safe.ts";

import { getCorsHeaders } from "../_shared/api-helpers.ts";
interface GlowforgeControlRequest {
  action: "getStatus";
  machineId?: string;
  force?: boolean;
}

function jsonResponse(req: Request, data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function collectCookies(resp: Response, cookies: string[]) {
  const getSetCookie = resp.headers.getSetCookie?.bind(resp.headers);
  let cookieHeaders = getSetCookie ? getSetCookie() : [];

  if (cookieHeaders.length === 0) {
    const folded = resp.headers.get("set-cookie");
    if (folded) {
      cookieHeaders = folded.split(/,(?=\s*[^;,\s]+=)/g).map((c) => c.trim());
    }
  }

  for (const cookieHeader of cookieHeaders) {
    const cookiePart = cookieHeader.split(";")[0];
    if (cookiePart.includes("=")) cookies.push(cookiePart);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function cookieNames(cookies: string | null | undefined): string {
  if (!cookies) return "none";
  return cookies
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter(Boolean)
    .join(",");
}

/**
 * Authenticate with Glowforge via cookie-based login.
 * 1. GET accounts.glowforge.com/users/sign_in → extract CSRF authenticity_token
 * 2. POST accounts.glowforge.com/users/sign_in with credentials
 * 3. Return session cookies
 */
async function glowforgeLogin(
  email: string,
  password: string,
): Promise<{ cookies: string; expiresAt: string }> {
  // Step 1: Get CSRF token from the actual sign-in form.
  const signInResp = await fetch("https://accounts.glowforge.com/users/sign_in", {
    headers: { "User-Agent": BROWSER_UA },
    redirect: "follow",
  });

  const signInHtml = await signInResp.text();
  const csrfMatch = signInHtml.match(
    /name="authenticity_token"\s+value="([^"]+)"/,
  );
  if (!csrfMatch) {
    throw new Error("Could not extract CSRF token from Glowforge login page");
  }
  const csrfToken = csrfMatch[1];

  // Collect cookies from the initial page load
  const initCookies: string[] = [];
  collectCookies(signInResp, initCookies);

  // Step 2: POST login
  const formData = new URLSearchParams({
    authenticity_token: csrfToken,
    "user[email]": email,
    "user[password]": password,
    "user[remember_me]": "1",
    commit: "Sign in",
  });

  const loginResp = await fetch(
    "https://accounts.glowforge.com/users/sign_in",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_UA,
        Cookie: initCookies.join("; "),
      },
      body: formData.toString(),
      redirect: "manual",
    },
  );

  // Collect all session cookies from the login response
  const allCookies: string[] = [...initCookies];
  collectCookies(loginResp, allCookies);

  // Follow redirects manually to collect cookies from each hop
  let location = loginResp.headers.get("location");
  if (!location || loginResp.status < 300 || loginResp.status >= 400) {
    throw new Error(`Glowforge login did not redirect after sign-in: ${loginResp.status}`);
  }
  let hops = 0;
  while (location && hops < 5) {
    const redirectUrl: string = new URL(
      location,
      "https://accounts.glowforge.com",
    ).toString();
    const redirectResp: Response = await fetch(redirectUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Cookie: allCookies.join("; "),
      },
      redirect: "manual",
    });
    collectCookies(redirectResp, allCookies);
    location = redirectResp.headers.get("location");
    hops++;
  }

  // Deduplicate cookies (later values override earlier ones for the same name)
  const cookieMap = new Map<string, string>();
  for (const c of allCookies) {
    const eqIdx = c.indexOf("=");
    if (eqIdx > 0) {
      const name = c.substring(0, eqIdx).trim();
      cookieMap.set(name, c);
    }
  }
  const cookieStr = Array.from(cookieMap.values()).join("; ");

  // Session cookies last about 2 weeks with remember_me, set conservative expiry
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  return { cookies: cookieStr, expiresAt };
}

/**
 * Fetch machine list from Glowforge API using session cookies.
 */
async function fetchMachines(
  cookies: string,
): Promise<any[]> {
  const resp = await fetch(
    "https://api.glowforge.com/gfcore/users/machines",
    {
      headers: {
        "User-Agent": BROWSER_UA,
        Cookie: cookies,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://app.glowforge.com",
        Referer: "https://app.glowforge.com/",
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Glowforge API returned ${resp.status}: ${text.substring(0, 200)}`,
    );
  }

  const data = await resp.json();
  // The API may return an object with a machines array or directly an array
  if (Array.isArray(data)) return data;
  if (data.machines && Array.isArray(data.machines)) return data.machines;
  if (data.data && Array.isArray(data.data)) return data.data;
  // If it's a single object with machine-like properties, wrap it
  if (data.id || data.serial || data.name) return [data];
  // Return whatever we got as an array for debugging
  return Array.isArray(Object.values(data)) ? Object.values(data) : [data];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    // 1. Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Allow service role key for internal calls (PAI, etc.)
    const token = authHeader.replace("Bearer ", "");
    let appUser: any = null;

    if (await timingSafeEqual(token, supabaseServiceKey)) {
      appUser = { id: "service", role: "oracle" };
    } else {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse(req, { error: "Invalid token" }, 401);
      }

      const permResult = await getAppUserWithPermission(
        supabase,
        user.id,
        "view_glowforge",
      );
      appUser = permResult.appUser;
      if (!permResult.hasPermission) {
        return jsonResponse(req, { error: "Insufficient permissions" }, 403);
      }
    }

    // 2. Parse request
    const body: GlowforgeControlRequest = await req.json();

    // 3. Load config
    const { data: config } = await supabase
      .from("glowforge_config")
      .select(
        "is_active, test_mode, session_cookies, session_expires_at, last_synced_at",
      )
      .eq("id", 1)
      .single();

    if (!config?.is_active) {
      return jsonResponse(req, 
        { error: "Glowforge integration is disabled" },
        400,
      );
    }

    if (config.test_mode) {
      return jsonResponse(req, {
        test_mode: true,
        machines: [],
        count: 0,
        message: "Test mode — no API call made",
      });
    }

    // ---- GET STATUS ----
    if (body.action === "getStatus") {
      if (!body.force && config.last_synced_at) {
        const lastSyncedAt = new Date(config.last_synced_at);
        const ageMs = Date.now() - lastSyncedAt.getTime();
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30000) {
          const { data: cachedMachines, error: cachedError } = await supabase
            .from("glowforge_machines")
            .select("*")
            .eq("is_active", true)
            .order("display_order", { ascending: true });

          if (!cachedError) {
            return jsonResponse(req, {
              machines: cachedMachines || [],
              count: cachedMachines?.length || 0,
              cached: true,
              last_synced_at: config.last_synced_at,
            });
          }
        }
      }

      // Get credentials from Supabase secrets only when an upstream call is needed.
      const gfEmail = Deno.env.get("GLOWFORGE_EMAIL");
      const gfPassword = Deno.env.get("GLOWFORGE_PASSWORD");
      if (!gfEmail || !gfPassword) {
        return jsonResponse(req,
          {
            error:
              "Glowforge credentials not configured. Set GLOWFORGE_EMAIL and GLOWFORGE_PASSWORD secrets.",
          },
          400,
        );
      }

      // Check if we have valid cached cookies
      let cookies = config.session_cookies;
      const expiresAt = config.session_expires_at
        ? new Date(config.session_expires_at)
        : null;
      const needsLogin =
        !cookies || !expiresAt || expiresAt.getTime() < Date.now() + 60000;

      if (needsLogin) {
        console.log("Glowforge: authenticating (no valid session)...");
        try {
          const session = await glowforgeLogin(gfEmail, gfPassword);
          cookies = session.cookies;

          // Cache the cookies in DB
          await supabase
            .from("glowforge_config")
            .update({
              session_cookies: session.cookies,
              session_expires_at: session.expiresAt,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
        } catch (err) {
          const message = errorMessage(err);
          await supabase
            .from("glowforge_config")
            .update({
              last_error: `Login failed: ${message}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
          return jsonResponse(req, 
            { error: "Glowforge login failed" },
            502,
          );
        }
      }

      // Fetch machines
      let machines: any[];
      try {
        machines = await fetchMachines(cookies);
      } catch (err) {
        const message = errorMessage(err);
        // If fetch fails, try re-authenticating once
        console.log(
          "Glowforge: fetch failed, re-authenticating...",
          message,
        );
        try {
          const session = await glowforgeLogin(gfEmail, gfPassword);
          cookies = session.cookies;
          await supabase
            .from("glowforge_config")
            .update({
              session_cookies: session.cookies,
              session_expires_at: session.expiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
          machines = await fetchMachines(cookies);
        } catch (retryErr) {
          const retryMessage = errorMessage(retryErr);
          await supabase
            .from("glowforge_config")
            .update({
              last_error:
                `API failed after re-auth: ${retryMessage}; cookies=${cookieNames(cookies)}`,
              session_cookies: null,
              session_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
          return jsonResponse(req,
            { error: "Glowforge API failed after re-authentication" },
            502,
          );
        }
      }

      // Upsert machines into glowforge_machines
      const now = new Date().toISOString();
      const rows = machines.map((machine) => {
        const machineId =
          machine.serial || machine.id?.toString() || machine.name || "unknown";
        return {
          machine_id: machineId,
          name: machine.name || "Glowforge",
          machine_type: machine.type || machine.model || null,
          last_state: machine,
          last_synced_at: now,
          updated_at: now,
        };
      });

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("glowforge_machines")
          .upsert(rows, { onConflict: "machine_id" });
        if (upsertError) throw upsertError;
      }

      // Clear last_error on success
      await supabase
        .from("glowforge_config")
        .update({
          last_error: null,
          last_synced_at: now,
          updated_at: now,
        })
        .eq("id", 1);

      // Log API usage (fire-and-forget)
      supabase
        .from("api_usage_log")
        .insert({
          vendor: "glowforge",
          category: "glowforge_status_poll",
          endpoint: "gfcore/users/machines",
          units: 1,
          unit_type: "api_calls",
          estimated_cost_usd: 0,
          metadata: { machines_found: machines.length },
          app_user_id:
            appUser?.id !== "service" ? appUser?.id : null,
        })
        .then(() => {})
        .then(undefined, () => {});

      return jsonResponse(req, { machines, count: machines.length, cached: false });
    }

    return jsonResponse(req, { error: `Unknown action: ${body.action}` }, 400);
  } catch (error) {
    console.error("Glowforge control error:", errorMessage(error), errorStack(error));
    return jsonResponse(req, { error: "Internal error processing glowforge control request" }, 500);
  }
});
