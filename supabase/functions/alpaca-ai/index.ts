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
  admin: 3,
  staff: 2,
  resident: 1,
  associate: 1,
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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
    parts.push(`Actions: turn on/off, set brightness (1-100), change color (name or hex)`);
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
];

// =============================================
// Tool Call Executor
// =============================================

async function executeToolCall(
  functionCall: { name: string; args: any },
  scope: UserScope,
  userToken: string,
  supabaseUrl: string
): Promise<string> {
  const { name, args } = functionCall;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${userToken}`,
    apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
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

        const goveePayload = {
          action: "controlDevice",
          device: args.device_id,
          sku: args.sku || "SameModeGroup",
          capability,
        };
        console.log("PAI → govee-control payload:", JSON.stringify(goveePayload));

        const resp = await fetch(
          `${supabaseUrl}/functions/v1/govee-control`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(goveePayload),
          }
        );
        const result = await resp.json();
        console.log("PAI ← govee-control response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || result.msg || `HTTP ${resp.status}`;
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
          { method: "POST", headers, body: JSON.stringify(payload) }
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
          { method: "POST", headers, body: JSON.stringify(payload) }
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
            headers,
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
  tools: any[] | null
): Promise<any> {
  const url = `${GEMINI_URL}?key=${apiKey}`;
  const body: any = {
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
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

  return await response.json();
}

// =============================================
// Main Handler
// =============================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    const { message, conversationHistory = [] }: PaiRequest = await req.json();
    if (!message?.trim()) {
      return jsonResponse({ error: "Message is required" }, 400);
    }

    console.log(`PAI request from ${appUser.display_name} (${appUser.role}): ${message.substring(0, 100)}`);

    // 3. Build scope
    const scope = await buildUserScope(supabase, appUser, userLevel);

    // 4. Build system prompt
    const systemPrompt = buildSystemPrompt(scope);

    // 5. Build Gemini conversation
    const contents: any[] = [
      { role: "user", parts: [{ text: systemPrompt }] },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I'm PAI, ready to help with smart home controls and property questions.",
          },
        ],
      },
    ];

    // Add conversation history (last 20 messages)
    const recentHistory = conversationHistory.slice(-20);
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      });
    }

    // Add current message
    contents.push({ role: "user", parts: [{ text: message }] });

    // 6. Call Gemini
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    let geminiResult = await callGemini(
      GEMINI_API_KEY,
      contents,
      TOOL_DECLARATIONS
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

      // Execute all function calls
      const functionResponses: any[] = [];
      for (const part of functionCalls) {
        const fc = part.functionCall;
        console.log(`PAI tool call: ${fc.name}`, JSON.stringify(fc.args));

        const result = await executeToolCall(
          fc,
          scope,
          userToken,
          supabaseUrl
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
        });

        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result },
          },
        });
      }

      // Send function results back to Gemini
      // Append the model's function call turn + user's function response turn
      // Strip thoughtSignature and other fields — only keep functionCall
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

      geminiResult = await callGemini(GEMINI_API_KEY, contents, TOOL_DECLARATIONS);
    }

    // 8. Extract final text
    const finalParts = geminiResult.candidates?.[0]?.content?.parts || [];
    console.log("PAI final parts:", JSON.stringify(finalParts.map((p: any) => Object.keys(p))));
    const textParts = finalParts.filter((p: any) => p.text);
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
  } catch (error) {
    console.error("PAI error:", error.message);
    return jsonResponse(
      { error: error.message || "An unexpected error occurred" },
      500
    );
  }
});
