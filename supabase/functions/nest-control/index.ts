import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SDM_BASE_URL = "https://smartdevicemanagement.googleapis.com/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface NestRequest {
  action:
    | "listDevices"
    | "getDeviceState"
    | "getAllStates"
    | "setTemperature"
    | "setMode"
    | "setEco"
    | "oauthCallback";
  deviceId?: string;
  temperature?: number; // Fahrenheit
  heatTemp?: number; // Fahrenheit (for HEATCOOL)
  coolTemp?: number; // Fahrenheit (for HEATCOOL)
  mode?: string; // HEAT, COOL, HEATCOOL, OFF
  ecoMode?: string; // MANUAL_ECO, OFF
  code?: string; // OAuth authorization code
  redirectUri?: string; // OAuth redirect URI
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fToC(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 2) / 2;
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
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

    // Allow trusted internal calls from PAI (service role key = already permission-checked)
    const isInternalCall = token === supabaseServiceKey;

    let userLevel = 3; // default to admin for internal calls
    if (!isInternalCall) {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse({ error: "Invalid token" }, 401);
      }

      // Check user role
      const { data: appUser } = await supabase
        .from("app_users")
        .select("role")
        .eq("auth_user_id", user.id)
        .single();

      const ROLE_LEVEL: Record<string, number> = {
        admin: 3,
        staff: 2,
        resident: 1,
        associate: 1,
      };
      userLevel = ROLE_LEVEL[appUser?.role] || 0;
    }
    if (userLevel < 1) {
      return jsonResponse({ error: "Insufficient permissions" }, 403);
    }

    // Read nest_config
    const { data: config, error: configError } = await supabase
      .from("nest_config")
      .select("*")
      .single();

    if (configError || !config) {
      return jsonResponse({ error: "Nest not configured" }, 500);
    }

    if (!config.is_active) {
      return jsonResponse({ error: "Nest integration is disabled" }, 503);
    }

    const body: NestRequest = await req.json();
    const { action } = body;

    // OAuth callback is admin-only
    if (action === "oauthCallback") {
      if (!["admin", "oracle"].includes(appUser?.role)) {
        return jsonResponse(
          { error: "Admin required for OAuth setup" },
          403
        );
      }

      if (!body.code) {
        return jsonResponse({ error: "Missing authorization code" }, 400);
      }

      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.google_client_id,
          client_secret: config.google_client_secret,
          code: body.code,
          grant_type: "authorization_code",
          redirect_uri:
            body.redirectUri ||
            "https://rsonnad.github.io/alpacapps/residents/climate.html",
        }),
      });

      const tokenData = await tokenResponse.json();
      if (tokenData.error) {
        console.error("OAuth token error:", tokenData);
        return jsonResponse(
          { error: `OAuth failed: ${tokenData.error_description || tokenData.error}` },
          400
        );
      }

      await supabase
        .from("nest_config")
        .update({
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          token_expires_at: new Date(
            Date.now() + tokenData.expires_in * 1000
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);

      return jsonResponse({ success: true });
    }

    // For all other actions, we need a valid access token
    if (!config.refresh_token) {
      return jsonResponse(
        { error: "Nest not authorized. Admin must complete OAuth setup." },
        401
      );
    }

    // Test mode: log and return mock data
    if (config.test_mode) {
      console.log(`[TEST MODE] nest-control action=${action}`, body);
      return jsonResponse({
        test_mode: true,
        action,
        message: "Test mode - no API call made",
      });
    }

    // Get valid access token (refresh if needed)
    const accessToken = await getValidAccessToken(supabase, config);

    // Execute action
    switch (action) {
      case "listDevices": {
        const res = await fetch(
          `${SDM_BASE_URL}/enterprises/${config.sdm_project_id}/devices`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const data = await res.json();
        if (!res.ok) {
          return jsonResponse({ error: data.error?.message || "SDM API error" }, res.status);
        }
        return jsonResponse(data);
      }

      case "getDeviceState": {
        if (!body.deviceId) {
          return jsonResponse({ error: "Missing deviceId" }, 400);
        }
        const res = await fetch(
          `${SDM_BASE_URL}/${body.deviceId}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const data = await res.json();
        if (!res.ok) {
          return jsonResponse({ error: data.error?.message || "SDM API error" }, res.status);
        }

        // Cache state in nest_devices
        if (data.traits) {
          const state = {
            currentTempC:
              data.traits["sdm.devices.traits.Temperature"]
                ?.ambientTemperatureCelsius,
            currentTempF: data.traits["sdm.devices.traits.Temperature"]
              ?.ambientTemperatureCelsius != null
              ? cToF(
                  data.traits["sdm.devices.traits.Temperature"]
                    .ambientTemperatureCelsius
                )
              : null,
            humidity:
              data.traits["sdm.devices.traits.Humidity"]
                ?.ambientHumidityPercent,
            mode: data.traits["sdm.devices.traits.ThermostatMode"]?.mode,
            hvacStatus:
              data.traits["sdm.devices.traits.ThermostatHvac"]?.status,
            ecoMode:
              data.traits["sdm.devices.traits.ThermostatEco"]?.mode,
            heatSetpointC:
              data.traits[
                "sdm.devices.traits.ThermostatTemperatureSetpoint"
              ]?.heatCelsius,
            coolSetpointC:
              data.traits[
                "sdm.devices.traits.ThermostatTemperatureSetpoint"
              ]?.coolCelsius,
            heatSetpointF:
              data.traits[
                "sdm.devices.traits.ThermostatTemperatureSetpoint"
              ]?.heatCelsius != null
                ? cToF(
                    data.traits[
                      "sdm.devices.traits.ThermostatTemperatureSetpoint"
                    ].heatCelsius
                  )
                : null,
            coolSetpointF:
              data.traits[
                "sdm.devices.traits.ThermostatTemperatureSetpoint"
              ]?.coolCelsius != null
                ? cToF(
                    data.traits[
                      "sdm.devices.traits.ThermostatTemperatureSetpoint"
                    ].coolCelsius
                  )
                : null,
            connectivity:
              data.traits["sdm.devices.traits.Connectivity"]?.status,
            updatedAt: new Date().toISOString(),
          };

          await supabase
            .from("nest_devices")
            .update({ last_state: state, updated_at: new Date().toISOString() })
            .eq("sdm_device_id", body.deviceId);

          return jsonResponse(state);
        }
        return jsonResponse(data);
      }

      case "getAllStates": {
        // Fetch all active devices and get their states
        const { data: devices } = await supabase
          .from("nest_devices")
          .select("sdm_device_id, room_name")
          .eq("is_active", true)
          .eq("device_type", "thermostat");

        if (!devices || devices.length === 0) {
          return jsonResponse({ devices: [] });
        }

        const states = await Promise.allSettled(
          devices.map(async (device) => {
            const res = await fetch(
              `${SDM_BASE_URL}/${device.sdm_device_id}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );
            const data = await res.json();
            if (!res.ok) return { deviceId: device.sdm_device_id, error: true };

            const state = {
              currentTempC:
                data.traits?.["sdm.devices.traits.Temperature"]
                  ?.ambientTemperatureCelsius,
              currentTempF: data.traits?.["sdm.devices.traits.Temperature"]
                ?.ambientTemperatureCelsius != null
                ? cToF(
                    data.traits["sdm.devices.traits.Temperature"]
                      .ambientTemperatureCelsius
                  )
                : null,
              humidity:
                data.traits?.["sdm.devices.traits.Humidity"]
                  ?.ambientHumidityPercent,
              mode: data.traits?.["sdm.devices.traits.ThermostatMode"]?.mode,
              hvacStatus:
                data.traits?.["sdm.devices.traits.ThermostatHvac"]?.status,
              ecoMode:
                data.traits?.["sdm.devices.traits.ThermostatEco"]?.mode,
              heatSetpointC:
                data.traits?.[
                  "sdm.devices.traits.ThermostatTemperatureSetpoint"
                ]?.heatCelsius,
              coolSetpointC:
                data.traits?.[
                  "sdm.devices.traits.ThermostatTemperatureSetpoint"
                ]?.coolCelsius,
              heatSetpointF:
                data.traits?.[
                  "sdm.devices.traits.ThermostatTemperatureSetpoint"
                ]?.heatCelsius != null
                  ? cToF(
                      data.traits[
                        "sdm.devices.traits.ThermostatTemperatureSetpoint"
                      ].heatCelsius
                    )
                  : null,
              coolSetpointF:
                data.traits?.[
                  "sdm.devices.traits.ThermostatTemperatureSetpoint"
                ]?.coolCelsius != null
                  ? cToF(
                      data.traits[
                        "sdm.devices.traits.ThermostatTemperatureSetpoint"
                      ].coolCelsius
                    )
                  : null,
              connectivity:
                data.traits?.["sdm.devices.traits.Connectivity"]?.status,
              updatedAt: new Date().toISOString(),
            };

            // Cache state
            await supabase
              .from("nest_devices")
              .update({
                last_state: state,
                updated_at: new Date().toISOString(),
              })
              .eq("sdm_device_id", device.sdm_device_id);

            return {
              deviceId: device.sdm_device_id,
              roomName: device.room_name,
              state,
            };
          })
        );

        const results = states
          .filter((s) => s.status === "fulfilled")
          .map((s) => (s as PromiseFulfilledResult<any>).value);

        return jsonResponse({ devices: results });
      }

      case "setTemperature": {
        if (!body.deviceId) {
          return jsonResponse({ error: "Missing deviceId" }, 400);
        }

        let command: string;
        let params: Record<string, number>;

        if (body.heatTemp != null && body.coolTemp != null) {
          // HEATCOOL mode
          command =
            "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange";
          params = {
            heatCelsius: fToC(body.heatTemp),
            coolCelsius: fToC(body.coolTemp),
          };
        } else if (body.temperature != null) {
          // Determine command based on current mode
          const { data: device } = await supabase
            .from("nest_devices")
            .select("last_state")
            .eq("sdm_device_id", body.deviceId)
            .single();

          const currentMode = device?.last_state?.mode;
          if (currentMode === "COOL") {
            command =
              "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool";
            params = { coolCelsius: fToC(body.temperature) };
          } else {
            command =
              "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat";
            params = { heatCelsius: fToC(body.temperature) };
          }
        } else {
          return jsonResponse(
            { error: "Missing temperature parameter" },
            400
          );
        }

        const res = await fetch(
          `${SDM_BASE_URL}/${body.deviceId}:executeCommand`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ command, params }),
          }
        );

        if (!res.ok) {
          const errData = await res.json();
          return jsonResponse(
            { error: errData.error?.message || "Failed to set temperature" },
            res.status
          );
        }
        return jsonResponse({ success: true });
      }

      case "setMode": {
        if (!body.deviceId || !body.mode) {
          return jsonResponse(
            { error: "Missing deviceId or mode" },
            400
          );
        }

        const res = await fetch(
          `${SDM_BASE_URL}/${body.deviceId}:executeCommand`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              command: "sdm.devices.commands.ThermostatMode.SetMode",
              params: { mode: body.mode },
            }),
          }
        );

        if (!res.ok) {
          const errData = await res.json();
          return jsonResponse(
            { error: errData.error?.message || "Failed to set mode" },
            res.status
          );
        }
        return jsonResponse({ success: true });
      }

      case "setEco": {
        if (!body.deviceId || !body.ecoMode) {
          return jsonResponse(
            { error: "Missing deviceId or ecoMode" },
            400
          );
        }

        const res = await fetch(
          `${SDM_BASE_URL}/${body.deviceId}:executeCommand`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              command: "sdm.devices.commands.ThermostatEco.SetMode",
              params: { mode: body.ecoMode },
            }),
          }
        );

        if (!res.ok) {
          const errData = await res.json();
          return jsonResponse(
            { error: errData.error?.message || "Failed to set eco mode" },
            res.status
          );
        }
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error("Nest control error:", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});

async function getValidAccessToken(
  supabase: any,
  config: any
): Promise<string> {
  // Check if current access_token is still valid (with 5 min buffer)
  if (config.access_token && config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at);
    if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return config.access_token;
    }
  }

  // Refresh the token
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google_client_id,
      client_secret: config.google_client_secret,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    throw new Error(
      `Token refresh failed: ${tokenData.error_description || tokenData.error}`
    );
  }

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  await supabase
    .from("nest_config")
    .update({
      access_token: tokenData.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  return tokenData.access_token;
}
