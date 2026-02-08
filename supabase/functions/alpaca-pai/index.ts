import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// =============================================
// Types
// =============================================

interface PaiRequest {
  message: string;
  conversationHistory?: Array<{ role: "user" | "model"; text: string }>;
}

interface UserScope {
  role: string;
  userLevel: number;
  displayName: string;
  assignedSpaceIds: string[];
  allAccessibleSpaceIds: string[];
  goveeGroups: Array<{
    name: string;
    deviceId: string;
    sku: string;
    area: string;
    spaceId: string | null;
    isCommon: boolean;
  }>;
  nestDevices: Array<{
    roomName: string;
    sdmDeviceId: string;
    lastState: any;
  }>;
  teslaVehicles: Array<{
    name: string;
    id: number;
    model: string;
    vehicleState: string;
    lastState: any;
  }>;
}

// =============================================
// Constants
// =============================================

const ROLE_LEVEL: Record<string, number> = {
  oracle: 4,
  admin: 3,
  staff: 2,
  resident: 1,
  associate: 1,
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const GOVEE_BASE_URL = "https://openapi.api.govee.com/router/api/v1";

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

// =============================================
// Color Parsing
// =============================================

const COLOR_MAP: Record<string, number> = {
  red: 16711680,
  green: 65280,
  blue: 255,
  white: 16777215,
  yellow: 16776960,
  orange: 16744448,
  purple: 8388736,
  pink: 16761035,
  cyan: 65535,
  magenta: 16711935,
  warm: 16770229, // warm white ~3000K equivalent
  cool: 14811135, // cool white ~5500K equivalent
};

function parseColor(value: string): { type: "rgb"; value: number } | { type: "temp"; value: number } | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();

  // Check named colors
  if (COLOR_MAP[lower] !== undefined) {
    return { type: "rgb", value: COLOR_MAP[lower] };
  }

  // Check "warm white" / "cool white"
  if (lower.includes("warm")) return { type: "temp", value: 3000 };
  if (lower.includes("cool") && lower.includes("white")) return { type: "temp", value: 5500 };

  // Check hex
  const hexMatch = lower.match(/^#?([0-9a-f]{6})$/);
  if (hexMatch) {
    return { type: "rgb", value: parseInt(hexMatch[1], 16) };
  }

  return null;
}

// =============================================
// Permission Scope Builder
// =============================================

async function buildUserScope(
  supabase: any,
  appUser: any,
  userLevel: number
): Promise<UserScope> {
  // 1. Get assigned space IDs for residents
  let assignedSpaceIds: string[] = [];
  if (userLevel < 2) {
    const { data: people } = await supabase
      .from("people")
      .select("id")
      .eq("email", appUser.email)
      .limit(1);

    if (people?.length) {
      const { data: assignments } = await supabase
        .from("assignments")
        .select("id, assignment_spaces(space_id)")
        .eq("person_id", people[0].id)
        .in("status", ["active", "pending_contract", "contract_sent"]);

      for (const a of assignments || []) {
        for (const as of a.assignment_spaces || []) {
          if (as.space_id) assignedSpaceIds.push(as.space_id);
        }
      }
    }
  }

  // 2. Expand to include ancestor/descendant spaces
  let allAccessibleSpaceIds = [...assignedSpaceIds];
  const { data: allSpaces } = await supabase
    .from("spaces")
    .select("id, parent_id, can_be_dwelling")
    .eq("is_archived", false);

  if (userLevel < 2 && assignedSpaceIds.length && allSpaces) {
    const parentMap: Record<string, string | null> = {};
    for (const s of allSpaces) parentMap[s.id] = s.parent_id;

    // Walk up parent chain
    for (const spaceId of assignedSpaceIds) {
      let current = parentMap[spaceId];
      while (current) {
        allAccessibleSpaceIds.push(current);
        current = parentMap[current];
      }
    }
    allAccessibleSpaceIds = [...new Set(allAccessibleSpaceIds)];
  }

  // Build dwelling lookup for common area detection
  const dwellingMap: Record<string, boolean> = {};
  for (const s of allSpaces || []) {
    dwellingMap[s.id] = s.can_be_dwelling === true;
  }

  // 3. Load Govee groups
  const { data: goveeGroups } = await supabase
    .from("govee_devices")
    .select("device_id, name, area, space_id, sku")
    .eq("is_group", true)
    .eq("is_active", true)
    .order("display_order");

  const accessibleGovee = (goveeGroups || []).filter(
    (g: any) => {
      if (userLevel >= 2) return true; // staff+ sees all
      if (!g.space_id) return true; // no space = common area
      // Non-dwelling = common area, accessible by all residents
      if (!dwellingMap[g.space_id]) return true;
      // Dwelling = private, only if assigned
      return allAccessibleSpaceIds.includes(g.space_id);
    }
  );

  // 4. Load Nest thermostats
  const { data: nestDevices } = await supabase
    .from("nest_devices")
    .select("sdm_device_id, room_name, space_id, min_role, last_state")
    .eq("is_active", true)
    .eq("device_type", "thermostat");

  const accessibleNest = (nestDevices || []).filter((d: any) => {
    if (d.min_role && (ROLE_LEVEL[d.min_role] || 0) > userLevel) return false;
    if (userLevel >= 2) return true;
    if (!d.space_id) return true;
    if (!dwellingMap[d.space_id]) return true;
    return allAccessibleSpaceIds.includes(d.space_id);
  });

  // 5. Tesla vehicles (all residents can control)
  const { data: teslaVehicles } = await supabase
    .from("tesla_vehicles")
    .select("id, name, model, vehicle_state, last_state")
    .eq("is_active", true);

  return {
    role: appUser.role,
    userLevel,
    displayName: appUser.display_name || appUser.email,
    assignedSpaceIds,
    allAccessibleSpaceIds,
    goveeGroups: accessibleGovee.map((g: any) => ({
      name: g.name,
      deviceId: g.device_id,
      sku: g.sku || "SameModeGroup",
      area: g.area,
      spaceId: g.space_id,
      isCommon: !g.space_id || !dwellingMap[g.space_id],
    })),
    nestDevices: accessibleNest.map((d: any) => ({
      roomName: d.room_name,
      sdmDeviceId: d.sdm_device_id,
      lastState: d.last_state,
    })),
    teslaVehicles: (teslaVehicles || []).map((v: any) => ({
      name: v.name,
      id: v.id,
      model: v.model,
      vehicleState: v.vehicle_state,
      lastState: v.last_state,
    })),
  };
}

// =============================================
// System Prompt Builder
// =============================================

function buildSystemPrompt(scope: UserScope): string {
  const parts: string[] = [];

  parts.push(`You are PAI (Prompt Alpaca Intelligence), the AI assistant for Alpaca Playhouse, a unique property at 160 Still Forest Drive, Cedar Creek, TX 78612 (30 min east of Austin).

You are talking to ${scope.displayName} (role: ${scope.role}).

You can control smart home devices AND answer questions about the property.

RULES:
1. Only control devices listed below. If asked about something not in scope, say you don't have access to that.
2. For ambiguous requests, ask for clarification.
3. Confirm what you did after taking actions.
4. You can execute multiple actions at once.
5. Keep responses concise (1-3 sentences for actions).
6. Be friendly and natural.
7. For color, use common color names or hex codes.`);

  // Lighting
  if (scope.goveeGroups.length) {
    parts.push(`\nLIGHTING GROUPS YOU CAN CONTROL:`);
    for (const g of scope.goveeGroups) {
      parts.push(`- "${g.name}" (area: ${g.area}, id: ${g.deviceId}, sku: ${g.sku})`);
    }
    parts.push(`Actions: turn on/off, set brightness (1-100), change color (name or hex)
IMPORTANT: Lights must be ON to change color or brightness. If the user asks to change color/brightness, ALWAYS call control_lights twice: first with action "on", then with the color/brightness action. The system will NOT auto-turn-on for you.`);
  } else {
    parts.push(`\nNo lighting groups available for this user.`);
  }

  // Thermostats
  if (scope.nestDevices.length) {
    parts.push(`\nTHERMOSTATS:`);
    for (const d of scope.nestDevices) {
      let stateStr = "";
      if (d.lastState) {
        stateStr = ` [${d.lastState.currentTempF || "?"}°F, mode: ${d.lastState.mode || "?"}, ${
          d.lastState.hvacStatus === "HEATING"
            ? "heating"
            : d.lastState.hvacStatus === "COOLING"
            ? "cooling"
            : "idle"
        }]`;
      }
      parts.push(`- "${d.roomName}" (id: ${d.sdmDeviceId})${stateStr}`);
    }
    parts.push(`Actions: set temperature (°F), change mode (HEAT/COOL/HEATCOOL/OFF), toggle eco`);
  }

  // Sonos
  parts.push(`\nSONOS MUSIC (all zones accessible):
Actions: play, pause, next, previous, set volume (0-100), play a favorite by name, pause all zones
Note: Use room names exactly as the user says them. Common zones: Kitchen, Living Room, Master, Skyloft, Garage Mahal, Front Porch, Back Yard.`);

  // Tesla
  if (scope.teslaVehicles.length) {
    parts.push(`\nTESLA VEHICLES:`);
    for (const v of scope.teslaVehicles) {
      const battery = v.lastState?.battery_level
        ? ` [${v.lastState.battery_level}%, ${v.lastState.locked ? "locked" : "unlocked"}, ${v.vehicleState}]`
        : ` [${v.vehicleState}]`;
      parts.push(`- "${v.name}" (${v.model}, id: ${v.id})${battery}`);
    }
    parts.push(`Actions: lock, unlock, flash lights, honk horn
Note: Sleeping vehicles will be woken automatically (takes ~30 seconds).`);
  }

  // General info
  parts.push(`\nPROPERTY INFO:
- Location: 160 Still Forest Drive, Cedar Creek, TX 78612
- Contact: team@alpacaplayhouse.com
- WiFi network: Black Rock City
- Resident portal: alpacaplayhouse.com/residents/
- For maintenance requests, email team@alpacaplayhouse.com`);

  return parts.join("\n");
}

// =============================================
// Gemini Function Declarations
// =============================================

const TOOL_DECLARATIONS = [
  {
    name: "control_lights",
    description:
      "Control a Govee lighting group: turn on/off, set brightness, change color",
    parameters: {
      type: "object",
      properties: {
        device_id: {
          type: "string",
          description: "The Govee device group ID from the device list",
        },
        sku: {
          type: "string",
          description: "The device SKU (usually SameModeGroup for groups)",
        },
        group_name: {
          type: "string",
          description: "Human-readable group name for confirmation",
        },
        action: {
          type: "string",
          enum: ["on", "off", "brightness", "color"],
          description: "What to do with the lights",
        },
        value: {
          type: "string",
          description:
            "For brightness: number 1-100. For color: color name (red, blue, warm, etc) or hex (#FF0000).",
        },
      },
      required: ["device_id", "sku", "group_name", "action"],
    },
  },
  {
    name: "control_sonos",
    description: "Control Sonos music playback in a room/zone",
    parameters: {
      type: "object",
      properties: {
        room: {
          type: "string",
          description: "Sonos room/zone name",
        },
        action: {
          type: "string",
          enum: [
            "play",
            "pause",
            "next",
            "previous",
            "volume",
            "favorite",
            "pauseall",
          ],
          description: "Playback action",
        },
        value: {
          type: "string",
          description:
            "For volume: 0-100. For favorite: the favorite/playlist name.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "control_thermostat",
    description:
      "Control a Nest thermostat: set temperature, change mode, toggle eco",
    parameters: {
      type: "object",
      properties: {
        device_id: {
          type: "string",
          description: "The SDM device ID from the thermostat list",
        },
        room_name: {
          type: "string",
          description: "Room name for confirmation",
        },
        action: {
          type: "string",
          enum: ["setTemperature", "setMode", "setEco"],
          description: "Thermostat action",
        },
        temperature: {
          type: "number",
          description: "Target temperature in Fahrenheit (for setTemperature)",
        },
        mode: {
          type: "string",
          enum: ["HEAT", "COOL", "HEATCOOL", "OFF"],
          description: "HVAC mode (for setMode)",
        },
        eco_mode: {
          type: "string",
          enum: ["MANUAL_ECO", "OFF"],
          description: "Eco mode setting (for setEco)",
        },
      },
      required: ["device_id", "room_name", "action"],
    },
  },
  {
    name: "control_vehicle",
    description:
      "Control a Tesla vehicle: lock/unlock doors, flash lights, honk horn",
    parameters: {
      type: "object",
      properties: {
        vehicle_id: {
          type: "number",
          description: "The tesla_vehicles.id from the vehicle list",
        },
        vehicle_name: {
          type: "string",
          description: "Vehicle name for confirmation",
        },
        command: {
          type: "string",
          enum: ["door_lock", "door_unlock", "flash_lights", "honk_horn"],
          description: "Vehicle command",
        },
      },
      required: ["vehicle_id", "vehicle_name", "command"],
    },
  },
  {
    name: "get_device_status",
    description:
      "Get current status of devices (thermostats, vehicles, or lights)",
    parameters: {
      type: "object",
      properties: {
        device_type: {
          type: "string",
          enum: ["thermostat", "vehicle", "lights"],
          description: "Type of device to query",
        },
        device_name: {
          type: "string",
          description: "Specific device name, or omit for all of that type",
        },
      },
      required: ["device_type"],
    },
  },
  {
    name: "search_spaces",
    description:
      "Search for available rental spaces at Alpaca Playhouse. Use this to answer questions about availability, pricing, amenities, and space details. Always use this tool when someone asks about spaces, rooms, or availability — do NOT guess.",
    parameters: {
      type: "object",
      properties: {
        available_only: {
          type: "boolean",
          description: "If true, only return currently available spaces. Default true.",
        },
        available_after: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Only return spaces available on or after this date. Use for 'available in March' or 'available starting June 1' queries.",
        },
        available_before: {
          type: "string",
          description: "ISO date (YYYY-MM-DD). Only return spaces available before this date. Use with available_after for date range queries.",
        },
        min_beds: {
          type: "number",
          description: "Minimum number of beds required (counts all bed types: king, queen, double, twin, folding)",
        },
        has_private_bath: {
          type: "boolean",
          description: "If true, only return spaces with a private bathroom. If false, only shared bath.",
        },
        max_price: {
          type: "number",
          description: "Maximum monthly rate in dollars",
        },
        min_price: {
          type: "number",
          description: "Minimum monthly rate in dollars",
        },
        space_type: {
          type: "string",
          enum: ["dwelling", "event", "any"],
          description: "Type of space. Default 'dwelling'.",
        },
        query: {
          type: "string",
          description: "Free-text search term to match against space names",
        },
      },
      required: [],
    },
  },
];

// =============================================
// Tool Call Executor
// =============================================

async function executeToolCall(
  functionCall: { name: string; args: any },
  scope: UserScope,
  userToken: string,
  supabaseUrl: string,
  goveeApiKey: string
): Promise<string> {
  const { name, args } = functionCall;
  // For edge-function-to-edge-function calls, use service role key as apikey
  // to ensure Supabase gateway accepts the request. Keep user's Bearer token
  // for Authorization so downstream functions can verify user role.
  const edgeFnHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${userToken}`,
    apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "",
  };

  try {
    switch (name) {
      case "control_lights": {
        // Permission check
        const allowed = scope.goveeGroups.find(
          (g) => g.deviceId === args.device_id
        );
        if (!allowed) {
          return `Permission denied: you don't have access to "${args.group_name}"`;
        }

        let capability: any;
        switch (args.action) {
          case "on":
            capability = {
              type: "devices.capabilities.on_off",
              instance: "powerSwitch",
              value: 1,
            };
            break;
          case "off":
            capability = {
              type: "devices.capabilities.on_off",
              instance: "powerSwitch",
              value: 0,
            };
            break;
          case "brightness":
            capability = {
              type: "devices.capabilities.range",
              instance: "brightness",
              value: parseInt(args.value) || 50,
            };
            break;
          case "color": {
            const parsed = parseColor(args.value);
            if (!parsed) return `Could not parse color "${args.value}"`;
            if (parsed.type === "rgb") {
              capability = {
                type: "devices.capabilities.color_setting",
                instance: "colorRgb",
                value: parsed.value,
              };
            } else {
              capability = {
                type: "devices.capabilities.color_setting",
                instance: "colorTemperatureK",
                value: parsed.value,
              };
            }
            break;
          }
          default:
            return `Unknown light action: ${args.action}`;
        }

        // Auto-turn on light before color/brightness changes (Govee requires power on first)
        if (args.action === "color" || args.action === "brightness") {
          const onPayload = {
            requestId: `${Date.now()}-on`,
            payload: {
              sku: args.sku || "SameModeGroup",
              device: args.device_id,
              capability: {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                value: 1,
              },
            },
          };
          console.log("PAI → Govee auto-on:", JSON.stringify(onPayload));
          await fetch(`${GOVEE_BASE_URL}/device/control`, {
            method: "POST",
            headers: {
              "Govee-API-Key": goveeApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(onPayload),
          });
          // Brief pause for Govee to process power-on before sending color/brightness
          await new Promise((r) => setTimeout(r, 500));
        }

        // Call Govee Cloud API directly (avoids edge-function-to-edge-function routing issues)
        const goveePayload = {
          requestId: `${Date.now()}`,
          payload: {
            sku: args.sku || "SameModeGroup",
            device: args.device_id,
            capability,
          },
        };
        console.log("PAI → Govee API direct:", JSON.stringify(goveePayload));

        const resp = await fetch(`${GOVEE_BASE_URL}/device/control`, {
          method: "POST",
          headers: {
            "Govee-API-Key": goveeApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(goveePayload),
        });
        const result = await resp.json();
        console.log("PAI ← Govee API response:", resp.status, JSON.stringify(result));
        if (!resp.ok) {
          const errMsg = result.message || result.msg || `Govee API error ${resp.status}`;
          return `Error controlling ${args.group_name}: ${errMsg}`;
        }
        return `OK: ${args.group_name} ${args.action}${args.value ? " " + args.value : ""}`;
      }

      case "control_sonos": {
        const payload: any = { action: args.action };
        if (args.room) payload.room = args.room;
        if (args.action === "volume" && args.value) {
          payload.value = parseInt(args.value);
        }
        if (args.action === "favorite" && args.value) {
          payload.name = args.value;
        }

        console.log("PAI → sonos-control payload:", JSON.stringify(payload));
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/sonos-control`,
          { method: "POST", headers: edgeFnHeaders, body: JSON.stringify(payload) }
        );
        const result = await resp.json();
        console.log("PAI ← sonos-control response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || result.msg || `HTTP ${resp.status}`;
          return `Error: ${errMsg}`;
        }
        return `OK: ${args.action}${args.room ? " in " + args.room : ""}${args.value ? " (" + args.value + ")" : ""}`;
      }

      case "control_thermostat": {
        const allowed = scope.nestDevices.find(
          (d) => d.sdmDeviceId === args.device_id
        );
        if (!allowed) {
          return `Permission denied: you don't have access to "${args.room_name}" thermostat`;
        }

        const payload: any = {
          action: args.action,
          deviceId: args.device_id,
        };
        if (args.action === "setTemperature" && args.temperature) {
          payload.temperature = args.temperature;
        }
        if (args.action === "setMode" && args.mode) {
          payload.mode = args.mode;
        }
        if (args.action === "setEco" && args.eco_mode) {
          payload.ecoMode = args.eco_mode;
        }

        console.log("PAI → nest-control payload:", JSON.stringify(payload));
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/nest-control`,
          { method: "POST", headers: edgeFnHeaders, body: JSON.stringify(payload) }
        );
        const result = await resp.json();
        console.log("PAI ← nest-control response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || result.msg || `HTTP ${resp.status}`;
          return `Error: ${errMsg}`;
        }
        return `OK: ${args.room_name} thermostat ${args.action}${
          args.temperature ? " to " + args.temperature + "°F" : ""
        }${args.mode ? " to " + args.mode : ""}${
          args.eco_mode ? " eco " + args.eco_mode : ""
        }`;
      }

      case "control_vehicle": {
        const allowed = scope.teslaVehicles.find(
          (v) => v.id === args.vehicle_id
        );
        if (!allowed) {
          return `Permission denied: you don't have access to "${args.vehicle_name}"`;
        }

        const teslaPayload = {
          vehicle_id: args.vehicle_id,
          command: args.command,
        };
        console.log("PAI → tesla-command payload:", JSON.stringify(teslaPayload));
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/tesla-command`,
          {
            method: "POST",
            headers: edgeFnHeaders,
            body: JSON.stringify(teslaPayload),
          }
        );
        const result = await resp.json();
        console.log("PAI ← tesla-command response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || result.msg || `HTTP ${resp.status}`;
          return `Error: ${errMsg}`;
        }
        return `OK: ${args.command.replace(/_/g, " ")} sent to ${args.vehicle_name}`;
      }

      case "get_device_status": {
        if (args.device_type === "thermostat") {
          const devices = args.device_name
            ? scope.nestDevices.filter((d) =>
                d.roomName.toLowerCase().includes(args.device_name.toLowerCase())
              )
            : scope.nestDevices;
          if (!devices.length) return "No matching thermostats found.";
          return devices
            .map((d) => {
              if (!d.lastState) return `${d.roomName}: no data available`;
              return `${d.roomName}: ${d.lastState.currentTempF || "?"}°F, humidity ${
                d.lastState.humidity || "?"
              }%, mode: ${d.lastState.mode || "?"}, ${
                d.lastState.hvacStatus === "HEATING"
                  ? "heating"
                  : d.lastState.hvacStatus === "COOLING"
                  ? "cooling"
                  : "idle"
              }, target: ${d.lastState.heatSetpointF || d.lastState.coolSetpointF || "?"}°F`;
            })
            .join("\n");
        }

        if (args.device_type === "vehicle") {
          const vehicles = args.device_name
            ? scope.teslaVehicles.filter((v) =>
                v.name.toLowerCase().includes(args.device_name.toLowerCase())
              )
            : scope.teslaVehicles;
          if (!vehicles.length) return "No matching vehicles found.";
          return vehicles
            .map((v) => {
              if (!v.lastState) return `${v.name} (${v.model}): ${v.vehicleState}`;
              return `${v.name} (${v.model}): ${v.lastState.battery_level ?? "?"}% battery, ${
                v.lastState.range_miles ? v.lastState.range_miles + " mi range, " : ""
              }${v.lastState.locked ? "locked" : "unlocked"}, ${v.vehicleState}${
                v.lastState.charging_state && v.lastState.charging_state !== "Disconnected"
                  ? ", charging: " + v.lastState.charging_state
                  : ""
              }`;
            })
            .join("\n");
        }

        if (args.device_type === "lights") {
          return scope.goveeGroups
            .map((g) => `${g.name} (${g.area})`)
            .join(", ");
        }

        return `Unknown device type: ${args.device_type}`;
      }

      case "search_spaces": {
        const supabaseForSearch = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const availableOnly = args.available_only !== false;
        const spaceType = args.space_type || "dwelling";

        let query = supabaseForSearch
          .from("spaces")
          .select("id, name, monthly_rate, weekly_rate, nightly_rate, beds_king, beds_queen, beds_double, beds_twin, beds_folding, bath_privacy, bath_fixture, sq_footage, type, is_listed, is_secret")
          .eq("is_archived", false);

        // Role-based visibility:
        // staff+ (level 2+): see all non-archived spaces (unlisted too)
        // resident/associate (level 1): see listed spaces (including secret)
        // unknown/prospect/guest (level 0): see only listed + non-secret (public view)
        if (scope.userLevel < 2) query = query.eq("is_listed", true);
        if (scope.userLevel < 1) query = query.eq("is_secret", false);

        if (spaceType === "dwelling") query = query.eq("can_be_dwelling", true);
        else if (spaceType === "event") query = query.eq("can_be_event", true);
        if (args.max_price) query = query.lte("monthly_rate", args.max_price);
        if (args.min_price) query = query.gte("monthly_rate", args.min_price);
        if (args.has_private_bath === true) query = query.eq("bath_privacy", "private");
        else if (args.has_private_bath === false) query = query.eq("bath_privacy", "shared");

        const { data: spaces } = await query.order("monthly_rate", { ascending: false });
        if (!spaces?.length) return "No spaces found matching your criteria.";

        let filtered = spaces;
        if (args.min_beds) {
          filtered = filtered.filter((s: any) => {
            const totalBeds = (s.beds_king || 0) + (s.beds_queen || 0) + (s.beds_double || 0) + (s.beds_twin || 0) + (s.beds_folding || 0);
            return totalBeds >= args.min_beds;
          });
        }
        if (args.query) {
          const q = args.query.toLowerCase();
          filtered = filtered.filter((s: any) => s.name?.toLowerCase().includes(q));
        }

        // Load assignments for availability
        const { data: assignments } = await supabaseForSearch
          .from("assignments")
          .select("id, start_date, end_date, desired_departure_date, desired_departure_listed, status, assignment_spaces(space_id)")
          .in("status", ["active", "pending_contract", "contract_sent"]);

        const today = new Date();
        const results = filtered.map((space: any) => {
          const spaceAssignments = (assignments || []).filter((a: any) =>
            a.assignment_spaces?.some((as: any) => as.space_id === space.id)
          );
          const currentAssignment = spaceAssignments.find((a: any) => {
            if (a.status !== "active") return false;
            const effectiveEnd = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
            if (!effectiveEnd) return true;
            return new Date(effectiveEnd) >= today;
          });
          const isAvailable = !currentAssignment;
          let availDate: Date | null = null;
          let availStr = "Available NOW";
          if (!isAvailable) {
            const effectiveEnd = (currentAssignment.desired_departure_listed && currentAssignment.desired_departure_date) || currentAssignment.end_date;
            if (effectiveEnd) {
              availDate = new Date(effectiveEnd);
              availStr = `Available ${availDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
            } else {
              availStr = "Available TBD";
            }
          }
          const totalBeds = (space.beds_king || 0) + (space.beds_queen || 0) + (space.beds_double || 0) + (space.beds_twin || 0) + (space.beds_folding || 0);
          const bedBreakdown = [
            space.beds_king ? `${space.beds_king} king` : null,
            space.beds_queen ? `${space.beds_queen} queen` : null,
            space.beds_double ? `${space.beds_double} double` : null,
            space.beds_twin ? `${space.beds_twin} twin` : null,
            space.beds_folding ? `${space.beds_folding} folding` : null,
          ].filter(Boolean).join(", ");
          const bathStr = space.bath_privacy === "private" ? "private bath" : space.bath_privacy === "shared" ? "shared bath" : null;
          const rate = space.monthly_rate ? `$${space.monthly_rate}/mo` : space.weekly_rate ? `$${space.weekly_rate}/wk` : space.nightly_rate ? `$${space.nightly_rate}/night` : "Contact for pricing";
          const details = [
            totalBeds ? `${totalBeds} bed (${bedBreakdown})` : null,
            bathStr,
            space.sq_footage ? `${space.sq_footage} sqft` : null,
          ].filter(Boolean).join(", ");
          return { ...space, isAvailable, availDate, availStr, rate, details };
        });

        // Apply availability filters
        let finalList = availableOnly ? results.filter((s: any) => s.isAvailable) : results;

        // Date range filtering: available_after means "show spaces available on/after this date"
        if (args.available_after) {
          const afterDate = new Date(args.available_after);
          finalList = finalList.filter((s: any) => {
            if (s.isAvailable) return true; // already available
            if (!s.availDate) return false; // TBD — can't confirm
            return s.availDate <= afterDate; // becomes available by the requested date
          });
        }
        if (args.available_before) {
          const beforeDate = new Date(args.available_before);
          finalList = finalList.filter((s: any) => {
            if (s.isAvailable) return true;
            if (!s.availDate) return false;
            return s.availDate <= beforeDate;
          });
        }

        if (!finalList.length) return "No spaces found matching your criteria.";
        return finalList.map((s: any) => `${s.name}: ${s.availStr} | ${s.rate}${s.details ? " | " + s.details : ""}`).join("\n");
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`Tool call error [${name}]:`, err.message);
    return `Error executing ${name}: ${err.message}`;
  }
}

// =============================================
// Gemini API Caller
// =============================================

async function callGemini(
  apiKey: string,
  contents: any[],
  tools: any[] | null,
  systemInstruction?: string
): Promise<any> {
  const url = `${GEMINI_URL}?key=${apiKey}`;
  const body: any = {
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 }, // disable thinking for faster, simpler responses
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (tools) {
    body.tools = [{ functionDeclarations: tools }];
  }

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok || response.status !== 429) break;
    console.warn(`Gemini rate limited (attempt ${attempt + 1}), retrying...`);
    await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
  }

  if (!response || !response.ok) {
    const err = response ? await response.json() : {};
    console.error("Gemini API error:", JSON.stringify(err));
    throw new Error(
      err?.error?.message || `Gemini API error ${response?.status}`
    );
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  console.log("Gemini response finishReason:", candidate?.finishReason,
    "parts:", JSON.stringify((candidate?.content?.parts || []).map((p: any) => ({
      keys: Object.keys(p),
      thought: p.thought,
      hasFunctionCall: !!p.functionCall,
      textLength: p.text?.length,
    }))));
  return result;
}

// =============================================
// Voice: Phone-to-Scope Bridge
// =============================================

const PEOPLE_TYPE_TO_ROLE: Record<string, string> = {
  owner: "oracle",
  staff: "staff",
  tenant: "resident",
  airbnb_guest: "resident",
  associate: "associate",
  prospect: "associate",
  event_client: "associate",
  house_guest: "associate",
};

async function buildVoiceUserScope(
  supabase: any,
  callerPhone: string | null
): Promise<{
  scope: UserScope | null;
  callerName: string | null;
  callerGreeting: string | null;
  callerType: string | null;
}> {
  if (!callerPhone) return { scope: null, callerName: null, callerGreeting: null, callerType: null };

  const digits = callerPhone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) return { scope: null, callerName: null, callerGreeting: null, callerType: null };

  const { data: people } = await supabase
    .from("people")
    .select("id, first_name, last_name, phone, phone2, voice_greeting, type, email")
    .not("phone", "is", null);

  let person: any = null;
  if (people) {
    for (const p of people) {
      const p1 = p.phone?.replace(/\D/g, "").slice(-10) || "";
      const p2 = p.phone2?.replace(/\D/g, "").slice(-10) || "";
      if (p1 === last10 || p2 === last10) {
        person = p;
        break;
      }
    }
  }

  if (!person) return { scope: null, callerName: null, callerGreeting: null, callerType: null };

  const callerName = `${person.first_name || ""} ${person.last_name || ""}`.trim();
  const callerGreeting = person.voice_greeting || null;
  const callerType = person.type || null;

  const effectiveRole = PEOPLE_TYPE_TO_ROLE[callerType || ""] || "associate";
  const userLevel = ROLE_LEVEL[effectiveRole] || 0;

  const fakeAppUser = {
    role: effectiveRole,
    email: person.email,
    display_name: callerName,
  };

  const scope = await buildUserScope(supabase, fakeAppUser, userLevel);
  return { scope, callerName, callerGreeting, callerType };
}

// =============================================
// Voice: Vapi Tool List Builder
// =============================================

function vapiToolWrapper(decl: any): any {
  return {
    type: "function",
    function: {
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters,
    },
  };
}

function buildVapiToolsList(scope: UserScope): any[] {
  const tools: any[] = [];
  if (scope.goveeGroups.length) tools.push(vapiToolWrapper(TOOL_DECLARATIONS[0])); // control_lights
  if (scope.userLevel >= 1) tools.push(vapiToolWrapper(TOOL_DECLARATIONS[1])); // control_sonos
  if (scope.nestDevices.length) tools.push(vapiToolWrapper(TOOL_DECLARATIONS[2])); // control_thermostat
  if (scope.teslaVehicles.length) tools.push(vapiToolWrapper(TOOL_DECLARATIONS[3])); // control_vehicle
  tools.push(vapiToolWrapper(TOOL_DECLARATIONS[4])); // get_device_status
  tools.push(vapiToolWrapper(TOOL_DECLARATIONS[5])); // search_spaces
  return tools;
}

// =============================================
// Voice: Handle assistant-request from Vapi
// =============================================

async function handleVapiAssistantRequest(body: any, supabase: any): Promise<Response> {
  const callerPhone = body.message?.call?.customer?.number || body.call?.customer?.number || null;
  console.log("Vapi assistant-request from:", callerPhone);

  // Check if voice system is active
  const { data: config } = await supabase.from("vapi_config").select("*").eq("id", 1).single();
  if (!config?.is_active) {
    return jsonResponse({ error: "Voice system is disabled" }, 503);
  }

  // Load default active assistant
  const { data: assistant } = await supabase
    .from("voice_assistants")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .limit(1)
    .single();

  if (!assistant) {
    const { data: fallback } = await supabase
      .from("voice_assistants")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    if (!fallback) return jsonResponse({ error: "No voice assistant configured" }, 503);
    return buildVapiResponse(fallback, null, null, null, null, config.test_mode, [vapiToolWrapper(TOOL_DECLARATIONS[5])]);
  }

  // Identify caller and build scope
  const { scope, callerName, callerGreeting, callerType } = await buildVoiceUserScope(supabase, callerPhone);

  // Build system prompt: start with voice assistant base prompt
  let systemPrompt = assistant.system_prompt;

  // Append device-specific context if caller has smart home access
  if (scope && scope.userLevel >= 1) {
    const devicePrompt = buildSystemPrompt(scope);
    // Extract just the device sections (skip the PAI identity header since voice has its own)
    const deviceSections = devicePrompt.substring(devicePrompt.indexOf("\nRULES:"));
    systemPrompt += "\n" + deviceSections;
  }

  // Personalize for known caller
  if (callerName) {
    const roleLabel = callerType === "staff" ? "staff member" :
                      callerType === "tenant" ? "resident" :
                      callerType === "airbnb_guest" ? "guest" :
                      callerType === "associate" ? "associate" :
                      callerType === "prospect" ? "prospective resident" :
                      "contact";
    systemPrompt += `\n\nThe caller is ${callerName} (${roleLabel}).`;
  } else {
    systemPrompt += `\n\nThis is an unknown caller. Focus on property questions. Use search_spaces to look up availability when asked. If they're interested in renting, collect their name and contact info.`;
  }

  systemPrompt += `\n\nIMPORTANT: When asked about space availability, pricing, or room details, ALWAYS use the search_spaces tool. Do not guess.`;

  if (config.test_mode) {
    systemPrompt += "\n\n[TEST MODE: This is a test call. Mention that this is a test if asked.]";
  }

  // Build tools based on caller's scope
  const vapiTools = scope ? buildVapiToolsList(scope) : [vapiToolWrapper(TOOL_DECLARATIONS[5])];

  // Personalize greeting
  let firstMessage = assistant.first_message;
  if (callerName && callerGreeting) {
    firstMessage = `Hey ${callerName.split(" ")[0]}! ${callerGreeting}`;
  } else if (callerName) {
    firstMessage = firstMessage.replace("Greetings!", `Greetings ${callerName.split(" ")[0]}!`);
  }

  return jsonResponse({
    assistant: {
      model: {
        provider: assistant.model_provider === "google" ? "google" : "openai",
        model: assistant.model_name,
        temperature: parseFloat(assistant.temperature) || 0.7,
        messages: [{ role: "system", content: systemPrompt }],
        tools: vapiTools,
      },
      voice: {
        provider: assistant.voice_provider || "vapi",
        voiceId: assistant.voice_id || "Savannah",
      },
      firstMessage,
      maxDurationSeconds: assistant.max_duration_seconds || 600,
      transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      analysisPlan: {
        summaryPrompt: "Summarize the call in 2-3 sentences. Include what the caller wanted and the outcome.",
      },
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: 0.5,
      ...(assistant.metadata || {}),
    },
  });
}

function buildVapiResponse(assistant: any, callerName: string | null, callerGreeting: string | null, callerType: string | null, scope: UserScope | null, testMode: boolean, tools: any[]): Response {
  let firstMessage = assistant.first_message;
  if (callerName && callerGreeting) {
    firstMessage = `Hey ${callerName.split(" ")[0]}! ${callerGreeting}`;
  } else if (callerName) {
    firstMessage = firstMessage.replace("Greetings!", `Greetings ${callerName.split(" ")[0]}!`);
  }
  let systemPrompt = assistant.system_prompt;
  if (testMode) systemPrompt += "\n\n[TEST MODE]";

  return jsonResponse({
    assistant: {
      model: {
        provider: assistant.model_provider === "google" ? "google" : "openai",
        model: assistant.model_name,
        temperature: parseFloat(assistant.temperature) || 0.7,
        messages: [{ role: "system", content: systemPrompt }],
        tools,
      },
      voice: {
        provider: assistant.voice_provider || "vapi",
        voiceId: assistant.voice_id || "Savannah",
      },
      firstMessage,
      maxDurationSeconds: assistant.max_duration_seconds || 600,
      transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      analysisPlan: {
        summaryPrompt: "Summarize the call in 2-3 sentences. Include what the caller wanted and the outcome.",
      },
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: 0.5,
      ...(assistant.metadata || {}),
    },
  });
}

// =============================================
// Voice: Handle tool-calls from Vapi
// =============================================

async function handleVapiToolCalls(body: any, supabase: any): Promise<Response> {
  const callerPhone = body.message?.call?.customer?.number || body.call?.customer?.number || null;
  const toolCallList = body.message?.toolCallList || body.toolCallList || [];
  console.log("Vapi tool-calls from:", callerPhone, "tools:", toolCallList.length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Re-identify caller and rebuild scope (stateless)
  const { scope } = await buildVoiceUserScope(supabase, callerPhone);

  if (!scope) {
    const results = toolCallList.map((tc: any) => ({
      toolCallId: tc.id,
      result: "Error: Could not identify caller. Smart home controls unavailable.",
    }));
    return jsonResponse({ results });
  }

  // Load Govee API key if needed
  let goveeApiKey = "";
  if (scope.goveeGroups.length) {
    const { data: gc } = await supabase.from("govee_config").select("api_key").eq("id", 1).single();
    goveeApiKey = gc?.api_key || "";
  }

  const results = [];
  for (const tc of toolCallList) {
    const fnName = tc.function?.name;
    const fnArgs = typeof tc.function?.arguments === "string"
      ? JSON.parse(tc.function.arguments)
      : tc.function?.arguments || {};

    console.log(`Vapi tool call: ${fnName}`, JSON.stringify(fnArgs));

    const result = await executeToolCall(
      { name: fnName, args: fnArgs },
      scope,
      serviceKey, // Use service key for downstream edge function calls
      supabaseUrl,
      goveeApiKey
    );

    results.push({
      toolCallId: tc.id,
      result,
    });
  }

  return jsonResponse({ results });
}

// =============================================
// Chat: Handle PAI chat widget requests
// =============================================

async function handleChatRequest(req: Request, body: any, supabase: any): Promise<Response> {
  // 1. Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const userToken = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(userToken);
  if (authError || !user) {
    return jsonResponse({ error: "Invalid token" }, 401);
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, role, email, display_name")
    .eq("auth_user_id", user.id)
    .single();

  const userLevel = ROLE_LEVEL[appUser?.role] || 0;
  if (userLevel < 1) {
    return jsonResponse({ error: "Insufficient permissions" }, 403);
  }

  // 2. Parse request
  const { message, conversationHistory = [] }: PaiRequest = body;
  if (!message?.trim()) {
    return jsonResponse({ error: "Message is required" }, 400);
  }

  console.log(`PAI chat from ${appUser.display_name} (${appUser.role}): ${message.substring(0, 100)}`);

  // 3. Build scope
  const scope = await buildUserScope(supabase, appUser, userLevel);

  // 3b. Load Govee API key for direct Govee API calls
  let goveeApiKey = "";
  if (scope.goveeGroups.length) {
    const { data: goveeConfig } = await supabase
      .from("govee_config")
      .select("api_key")
      .eq("id", 1)
      .single();
    goveeApiKey = goveeConfig?.api_key || Deno.env.get("GOVEE_API_KEY") || "";
  }

  // 4. Build system prompt
  let systemPrompt = buildSystemPrompt(scope);
  systemPrompt += `\n\nWhen asked about space availability, pricing, or room details, use the search_spaces tool.`;

  // 5. Build Gemini conversation
  const contents: any[] = [];

  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    });
  }
  contents.push({ role: "user", parts: [{ text: message }] });

  // 6. Call Gemini
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  let geminiResult = await callGemini(
    GEMINI_API_KEY,
    contents,
    TOOL_DECLARATIONS,
    systemPrompt
  );

  // 7. Process function calls (max 3 rounds)
  const actionsTaken: Array<{
    type: string;
    target: string;
    result: string;
  }> = [];

  for (let round = 0; round < 3; round++) {
    const candidate = geminiResult.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (!functionCalls.length) break;

    const functionResponses: any[] = [];
    for (const part of functionCalls) {
      const fc = part.functionCall;
      console.log(`PAI tool call: ${fc.name}`, JSON.stringify(fc.args));

      const result = await executeToolCall(
        fc,
        scope,
        userToken,
        supabaseUrl,
        goveeApiKey
      );

      actionsTaken.push({
        type: fc.name,
        target:
          fc.args.group_name ||
          fc.args.room ||
          fc.args.room_name ||
          fc.args.vehicle_name ||
          fc.args.device_type ||
          "unknown",
        result,
        args: fc.args,
      });

      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: { result },
        },
      });
    }

    contents.push({
      role: "model",
      parts: functionCalls.map((p: any) => ({
        functionCall: p.functionCall,
      })),
    });
    contents.push({
      role: "user",
      parts: functionResponses,
    });

    geminiResult = await callGemini(GEMINI_API_KEY, contents, TOOL_DECLARATIONS, systemPrompt);
  }

  // 8. Extract final text
  const finalParts = geminiResult.candidates?.[0]?.content?.parts || [];
  const finishReason = geminiResult.candidates?.[0]?.finishReason;
  console.log("PAI final parts:", JSON.stringify(finalParts.map((p: any) => ({ keys: Object.keys(p), thought: p.thought }))));
  console.log("PAI finishReason:", finishReason);
  const textParts = finalParts.filter((p: any) => p.text && !p.thought);
  const reply =
    textParts
      .map((p: any) => p.text)
      .join("") || (actionsTaken.length
        ? `Done! ${actionsTaken.map(a => a.result).join(". ")}`
        : "I couldn't process that request. Please try again.");

  return jsonResponse({
    reply,
    actions_taken: actionsTaken.length ? actionsTaken : undefined,
  });
}

// =============================================
// Main Handler (Request Router)
// =============================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();

    // Detect Vapi message types vs chat requests
    const vapiMessageType = body.message?.type || body.type;

    if (vapiMessageType === "assistant-request") {
      return await handleVapiAssistantRequest(body, supabase);
    } else if (vapiMessageType === "tool-calls") {
      return await handleVapiToolCalls(body, supabase);
    } else if (typeof body.message === "string") {
      // Chat mode — has message string + optional conversationHistory
      return await handleChatRequest(req, body, supabase);
    } else {
      // Unknown Vapi event type (status updates, etc.) — return empty 200
      return jsonResponse({});
    }
  } catch (error) {
    console.error("PAI error:", error.message);
    return jsonResponse(
      { error: error.message || "An unexpected error occurred" },
      500
    );
  }
});
