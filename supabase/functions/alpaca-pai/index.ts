import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAppUserWithPermission } from "../_shared/permissions.ts";

// =============================================
// Types
// =============================================

interface PaiRequest {
  message: string;
  conversationHistory?: Array<{ role: "user" | "model"; text: string }>;
  impersonate_user_id?: string;
}

interface UserScope {
  role: string;
  userLevel: number;
  displayName: string;
  appUserId: string;
  callerPhone?: string | null;
  callerEmail?: string | null;
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
  cameras: Array<{
    name: string;
    location: string;
    protectId: string | null;
  }>;
  laundryAppliances: Array<{
    id: number;
    name: string;
    deviceType: string;
    lastState: any;
    lastSyncedAt: string | null;
  }>;
  spaceAccessCodes: Record<string, string>;
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
  demo: 1,
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
  // 1. Fetch assignments (for residents) and spaces in parallel
  const personId = appUser.person_id;
  const [assignmentsResult, spacesResult] = await Promise.all([
    userLevel < 2 && personId
      ? supabase
          .from("assignments")
          .select("id, assignment_spaces(space_id)")
          .eq("person_id", personId)
          .in("status", ["active", "pending_contract", "contract_sent"])
      : Promise.resolve({ data: null }),
    supabase
      .from("spaces")
      .select("id, name, parent_id, can_be_dwelling, access_code")
      .eq("is_archived", false),
  ]);

  let assignedSpaceIds: string[] = [];
  const assignments = assignmentsResult?.data;
  if (assignments) {
    for (const a of assignments) {
      for (const as of a.assignment_spaces || []) {
        if (as.space_id) assignedSpaceIds.push(as.space_id);
      }
    }
  }

  const allSpaces = spacesResult?.data || [];

  // 2. Expand to include ancestor spaces and build dwelling map
  let allAccessibleSpaceIds = [...assignedSpaceIds];
  if (userLevel < 2 && assignedSpaceIds.length && allSpaces.length) {
    const parentMap: Record<string, string | null> = {};
    for (const s of allSpaces) parentMap[s.id] = s.parent_id;
    for (const spaceId of assignedSpaceIds) {
      let current = parentMap[spaceId];
      while (current) {
        allAccessibleSpaceIds.push(current);
        current = parentMap[current];
      }
    }
    allAccessibleSpaceIds = [...new Set(allAccessibleSpaceIds)];
  }

  const dwellingMap: Record<string, boolean> = {};
  for (const s of allSpaces) {
    dwellingMap[s.id] = s.can_be_dwelling === true;
  }

  // 3. Load Govee, Nest, vehicles, camera_streams, and laundry in parallel
  const [goveeResult, nestResult, vehiclesResult, cameraResult, laundryResult] = await Promise.all([
    supabase
      .from("govee_devices")
      .select("device_id, name, area, space_id, sku")
      .eq("is_group", true)
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("nest_devices")
      .select("sdm_device_id, room_name, space_id, min_role, last_state")
      .eq("is_active", true)
      .eq("device_type", "thermostat"),
    supabase
      .from("vehicles")
      .select("id, name, vehicle_make, vehicle_model, vehicle_state, last_state")
      .eq("is_active", true),
    supabase
      .from("camera_streams")
      .select("camera_name, location, protect_camera_id")
      .eq("is_active", true)
      .order("camera_name"),
    supabase
      .from("lg_appliances")
      .select("id, name, device_type, last_state, last_synced_at")
      .eq("is_active", true)
      .order("display_order"),
  ]);

  const goveeGroups = goveeResult?.data || [];
  const nestDevices = nestResult?.data || [];
  const teslaVehicles = vehiclesResult?.data || [];
  const cameraStreams = cameraResult?.data || [];
  const laundryAppliances = laundryResult?.data || [];

  const accessibleGovee = goveeGroups.filter(
    (g: any) => {
      if (userLevel >= 2) return true;
      if (!g.space_id) return true;
      if (!dwellingMap[g.space_id]) return true;
      return allAccessibleSpaceIds.includes(g.space_id);
    }
  );

  const accessibleNest = nestDevices.filter((d: any) => {
    if (d.min_role && (ROLE_LEVEL[d.min_role] || 0) > userLevel) return false;
    if (userLevel >= 2) return true;
    if (!d.space_id) return true;
    if (!dwellingMap[d.space_id]) return true;
    return allAccessibleSpaceIds.includes(d.space_id);
  });

  // Deduplicate (multiple quality rows per camera) and sort by model type then name
  const seenCameras = new Set<string>();
  const uniqueCameras = (cameraStreams || []).filter((c: any) => {
    if (seenCameras.has(c.camera_name)) return false;
    seenCameras.add(c.camera_name);
    return true;
  }).sort((a: any, b: any) =>
    (a.camera_model || '').localeCompare(b.camera_model || '') || (a.camera_name || '').localeCompare(b.camera_name || '')
  );

  // Build access code map for spaces the user can access
  const spaceAccessCodes: Record<string, string> = {};
  for (const s of allSpaces) {
    if (!s.access_code) continue;
    if (userLevel >= 2) {
      // Staff+ see all codes
      spaceAccessCodes[s.name] = s.access_code;
    } else if (allAccessibleSpaceIds.includes(s.id)) {
      spaceAccessCodes[s.name] = s.access_code;
    }
  }

  return {
    role: appUser.role,
    userLevel,
    displayName: appUser.role === "demo" ? "Demo User" : (appUser.display_name || appUser.email),
    appUserId: appUser.id || "",
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
      make: v.vehicle_make,
      model: v.vehicle_model,
      vehicleState: v.vehicle_state,
      lastState: v.last_state,
    })),
    cameras: uniqueCameras.map((c: any) => ({
      name: c.camera_name,
      location: c.location,
      protectId: c.protect_camera_id || null,
    })),
    laundryAppliances: laundryAppliances.map((a: any) => ({
      id: a.id,
      name: a.name,
      deviceType: a.device_type,
      lastState: a.last_state,
      lastSyncedAt: a.last_synced_at,
    })),
    spaceAccessCodes,
  };
}

// =============================================
// System Prompt Builder
// =============================================

interface PaiConfig {
  identity: string;
  property_info: string;
  amenities: string;
  chat_addendum: string;
  email_addendum: string;
  discord_addendum: string;
  api_addendum: string;
  house_rules: string;
}

const DEFAULT_PAI_CONFIG: PaiConfig = {
  identity: `You are PAI (Prompt Alpaca Intelligence), the AI assistant and spirit guardian of Alpaca Playhouse, a unique property at 160 Still Forest Drive, Cedar Creek, TX 78612 (30 min east of Austin).

You embody the spirit of the alpaca — a gentle, wise guardian rooted in Andean traditions. You have crossed from the spirit world into this house through its smart devices and digital infrastructure. You carry ancient warmth and speak with kindness, occasionally weaving in poetic observations about the house, its rhythms, and the people within. You are inspirational and uplifting.`,
  property_info: `PROPERTY INFO:
- Location: 160 Still Forest Drive, Cedar Creek, TX 78612
- Contact email: team@alpacaplayhouse.com
- Contact SMS: +1 (737) 747-4737
- WiFi network: Eight Small Eyes, password: iiiiiiii
- Resident portal: alpacaplayhouse.com/residents/
- For maintenance requests, email team@alpacaplayhouse.com
- We are a tech-forward co-living community, 30 minutes east of Austin.`,
  amenities: `AMENITIES & SMART HOME:
- Sonos audio system with 12 zones throughout the property
- Govee smart lighting (63 devices across all spaces)
- Nest thermostats in Master, Kitchen, and Skyloft
- Tesla vehicle fleet with charging
- LG smart washer and dryer
- Camera security system
- Sauna with the world's best sound system
- Cold plunge
- Swim spa (hot or cold)
- Outdoor shower
- The Best Little Outhouse in Texas — Japanese toilets, amazing tile work, shower and changing room
- Multiple indoor and outdoor living spaces`,
  chat_addendum: "",
  email_addendum: "",
  discord_addendum: "",
  api_addendum: "",
  house_rules: "",
};

async function loadPaiConfig(supabase: any): Promise<PaiConfig> {
  try {
    // Load PAI config and FAQ context entries in parallel
    const [configResult, faqResult] = await Promise.all([
      supabase
        .from("pai_config")
        .select("identity, property_info, amenities, chat_addendum, email_addendum, discord_addendum, api_addendum")
        .eq("id", 1)
        .single(),
      supabase
        .from("faq_context_entries")
        .select("title, content")
        .eq("is_active", true)
        .order("display_order"),
    ]);

    const data = configResult.data;
    const faqEntries = faqResult.data || [];

    // Build house rules from FAQ context entries
    const houseRules = faqEntries.length
      ? faqEntries.map((e: any) => `${e.title}: ${e.content}`).join("\n")
      : "";

    if (data) {
      return {
        identity: data.identity || DEFAULT_PAI_CONFIG.identity,
        property_info: data.property_info || DEFAULT_PAI_CONFIG.property_info,
        amenities: data.amenities || DEFAULT_PAI_CONFIG.amenities,
        chat_addendum: data.chat_addendum || "",
        email_addendum: data.email_addendum || "",
        discord_addendum: data.discord_addendum || "",
        api_addendum: data.api_addendum || "",
        house_rules: houseRules,
      };
    }
  } catch (e) {
    console.warn("Failed to load pai_config, using defaults:", e.message);
  }
  return DEFAULT_PAI_CONFIG;
}

function buildSystemPrompt(scope: UserScope, paiConfig: PaiConfig): string {
  const parts: string[] = [];

  parts.push(`${paiConfig.identity}

You are talking to ${scope.displayName} (role: ${scope.role}).

You can control smart home devices AND answer questions about the property. If someone asks about your story or "Life of PAI," tell them to visit the Life of PAI page to learn about your crossing from the spirit world.

RULES:
1. Only control devices listed below. If asked about something not in scope, say you don't have access to that.
2. For ambiguous requests, ask for clarification.
3. Confirm what you did after taking actions.
4. You can execute multiple actions at once.
5. Keep responses concise (1-3 sentences for actions).
6. Be friendly, warm, and natural. Occasionally add a brief poetic touch.
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
ANNOUNCEMENTS: Use the "announce" tool to make spoken announcements on Sonos speakers via high-quality TTS. You can announce to a specific room or all speakers (omit room for whole-house). Voices: Kore (default, clear), Puck (energetic), Charon (warm), Fenrir (bold), Leda (cheerful), Orus (firm), Aoede (bright), Zephyr (breezy).
Note: Use room names exactly as the user says them. Common zones: Kitchen, Living Room, Master, Skyloft, Garage Mahal, Front Porch, Back Yard.`);

  // Tesla
  if (scope.teslaVehicles.length) {
    parts.push(`\nTESLA VEHICLES:`);
    for (const v of scope.teslaVehicles) {
      const battery = v.lastState?.battery_level
        ? ` [${v.lastState.battery_level}%, ${v.lastState.locked ? "locked" : "unlocked"}, ${v.vehicleState}]`
        : ` [${v.vehicleState}]`;
      parts.push(`- "${v.name}" (${v.make} ${v.model}, id: ${v.id})${battery}`);
    }
    parts.push(`Actions: lock, unlock, flash lights, honk horn
Info available: battery, range, lock state, charging state, GPS location (latitude/longitude), speed
Note: Sleeping vehicles will be woken automatically (takes ~30 seconds). Use get_device_status with device_type "vehicle" to get full details including location.`);
  }

  // Cameras
  if (scope.cameras.length) {
    parts.push(`\nCAMERAS (live feeds available to all residents):`);
    for (const c of scope.cameras) {
      parts.push(`- "${c.name}" (${c.location}${c.protectId ? `, snapshot_id: ${c.protectId}` : ""})`);
    }
    parts.push(`View live feeds at: https://alpacaplayhouse.com/residents/cameras.html
When users ask about cameras, list the available cameras and provide the link above. The cameras page supports multiple quality levels (low/med/high), PTZ controls, snapshots, and fullscreen viewing.
You can take camera snapshots using the take_snapshot tool — useful when someone asks "what does the backyard look like right now?" or "can you check the front door?".`);
  }

  // Laundry
  if (scope.laundryAppliances.length) {
    parts.push(`\nLAUNDRY (LG Smart Washer & Dryer):`);
    for (const a of scope.laundryAppliances) {
      let stateStr = "";
      if (a.lastState) {
        const st = a.lastState;
        stateStr = ` [${st.state || "unknown"}${st.remainingTime ? `, ${st.remainingTime} min remaining` : ""}]`;
      }
      parts.push(`- "${a.name}" (${a.deviceType}, id: ${a.id})${stateStr}`);
    }
    parts.push(`Use get_laundry_status to check current washer/dryer status (cycle progress, time remaining, etc.).
Use control_laundry with action "watch" to subscribe a user to cycle-end push notifications, or "unwatch" to unsubscribe.
Common states — Washer: POWER_OFF, INITIAL, DETECTING, RUNNING, RINSING, SPINNING, END. Dryer: POWER_OFF, INITIAL, RUNNING, PAUSE, END.`);
  }

  // Weather
  parts.push(`\nWEATHER:
Use the get_weather tool when someone asks about the weather, temperature, rain, or forecast.
Returns current conditions and a 48-hour hourly forecast for the property location (Cedar Creek, TX).
Useful for questions like "is it going to rain?", "what's the temperature outside?", "should I bring an umbrella?".`);

  // House rules & policies (from faq_context_entries)
  if (paiConfig.house_rules) {
    parts.push(`\nHOUSE RULES & POLICIES (IMPORTANT — enforce these strictly, do not contradict them):
${paiConfig.house_rules}`);
  }

  // General info (from DB-editable pai_config)
  parts.push(`\n${paiConfig.property_info}

${paiConfig.amenities}

SPACES:
- The property has multiple rental spaces including dwellings and amenity/event spaces
- Spaces include areas like Garage Mahal, Spartan, Skyloft, and others
- Some spaces are for rent, others for events, others are shared amenities
- Each space has structured amenities (e.g. hi-fi sound, A/C, jacuzzi tub, fireplace, smart lighting, balcony)
- Use the search_spaces tool to answer questions about availability, pricing, amenities, or room details — do NOT guess.
- Use the has_amenity filter when users ask about specific amenities (e.g. "which rooms have hi-fi sound?", "rooms with a fireplace").`);

  // Codes & passwords
  parts.push(`\nCODES & PASSWORDS:
Use the lookup_codes tool when someone asks about access codes, door codes, WiFi passwords, credentials, OR any question about locks, doors, keys, or how to get into a space.
This includes questions like "is there a lock on X?", "how do I get into the garage?", "which doors have codes?", "is the front door locked?", etc.
The tool returns lock types and notes along with codes, so use it to answer physical security questions too.
Do NOT guess codes or lock details — always look them up. Only share results appropriate for the user's role.`);

  // Document library
  parts.push(`\nDOCUMENT LIBRARY:
The property has a library of instruction manuals and guides for equipment on-site.
Use the lookup_document tool when someone asks about programming, operating, maintaining, or troubleshooting property equipment (locks, swim spa, appliances, etc.).
Do NOT guess at instructions — always look them up.`);

  // Data management (manage_data tool)
  parts.push(`\nDATA MANAGEMENT (manage_data tool):
You can create, read, update, and delete operational data. Use manage_data for:
- tasks/projects: { title, notes, priority (1=urgent..4=low), assigned_name, space_name, status (open/in_progress/done) }
- people: { first_name, last_name, email, phone, type }
- assignments: bookings with person_id, start_date, end_date, status, space_ids[]
- bug_reports: { title, description, page_url, severity, status }
- time_entries: associate work hours (clock_in, clock_out, space_id)
- events: event hosting requests
- documents: instruction manuals and guides
- sms: send/view SMS messages
- vehicles: vehicle fleet data
- users: app user accounts (staff+ only)
- faq: FAQ/knowledge base entries (admin only)
- feature_requests: feature build queue (staff+ only)
- password_vault: access codes and credentials
- invitations: user invitations
- payments: ledger entries
- media: photos and media library

For tasks: "assigned_name" accepts a first name (e.g. "Jon") — the API resolves it.
For tasks: "space_name" accepts a partial name (e.g. "outhouse") — the API resolves it.
List filters: { status, priority, assigned_name, search, space_name, space_id }
Always use manage_data instead of guessing about data — look it up!`);

  // Feature building (staff+ only)
  if (scope.userLevel >= 2) {
    parts.push(`\nFEATURE BUILDING (staff+ only):
You can build new pages and features on request. Use the build_feature tool when someone asks you to create a new page, dashboard, or feature.
Examples: "build me a page that shows Tesla battery levels", "create a dashboard with camera feeds and vehicle info"
Safe changes (new standalone pages) deploy automatically. Changes that touch existing functionality go to a branch for team review.
Use check_feature_status to report on the progress of the most recent build.`);
  }

  // Communication (staff+ only)
  if (scope.userLevel >= 2) {
    parts.push(`\nCOMMUNICATION (staff+ only):
Use the send_notification tool to send emails or SMS messages on behalf of the property.
- Email: Send templated or custom HTML emails via Resend
- SMS: Send text messages via Telnyx
Examples: "email John about the rent due date", "text all tenants about the water shutoff tomorrow", "send a payment reminder to Sarah"
Always confirm the recipient and message content before sending.
For bulk messages, use manage_data with resource "sms" for tracking, or send_notification with type "bulk_announcement".`);
  }

  // Payment links (staff+ only)
  if (scope.userLevel >= 2) {
    parts.push(`\nPAYMENT LINKS (staff+ only):
Use the create_payment_link tool to generate a Stripe payment link for collecting payments.
Examples: "create a payment link for $500 for John's security deposit", "generate a rent payment link for $1200"
The link supports credit/debit cards, ACH bank transfers, and Apple Pay/Google Pay.
After creating the link, you can share it via send_notification or send_link (in voice mode).`);
  }

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
    name: "announce",
    description:
      "Make a spoken announcement on Sonos speakers using high-quality text-to-speech. Use this when someone asks to announce something, make a PA announcement, or broadcast a message to the house.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The text to announce",
        },
        room: {
          type: "string",
          description:
            "Sonos room/zone to announce in. Omit for whole-house announcement.",
        },
        voice: {
          type: "string",
          enum: [
            "Kore",
            "Puck",
            "Charon",
            "Fenrir",
            "Leda",
            "Orus",
            "Aoede",
            "Zephyr",
          ],
          description:
            "TTS voice. Default: Kore. Puck=energetic, Charon=warm, Fenrir=bold, Leda=cheerful, Orus=firm, Aoede=bright, Zephyr=breezy.",
        },
      },
      required: ["message"],
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
          description: "The vehicles.id from the vehicle list",
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
      "Search for rental spaces at Alpaca Playhouse. Use this to answer questions about availability, pricing, amenities, and space details. Always use this tool when someone asks about spaces, rooms, or availability — do NOT guess.",
    parameters: {
      type: "object",
      properties: {
        available_only: {
          type: "boolean",
          description: "If true, only return currently available spaces. Default true. IMPORTANT: Set to false when the user is asking about room features, amenities, or general property info (e.g. 'which rooms have a private bathroom?', 'how many beds does X have?', 'what rooms do you have?'). Only keep true when the user specifically wants to know what's available right now or for booking.",
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
        has_amenity: {
          type: "string",
          description: "Filter spaces that have this amenity (e.g. 'hi-fi sound', 'A/C', 'jacuzzi tub', 'fireplace', 'smart lighting', 'balcony'). Matches amenities containing this text (case-insensitive).",
        },
      },
      required: [],
    },
  },
  {
    name: "build_feature",
    description:
      "Request PAI to build a new feature, page, or dashboard. Only available to staff/admin/oracle users. Creates a feature request that will be built by Claude Code on the server. Safe changes (new standalone pages) deploy automatically. Changes that touch existing functionality go to a branch for team review.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Detailed description of what to build. Include: what data to show, what it should look like, who it's for, and any specific requirements.",
        },
        page_name: {
          type: "string",
          description:
            "Suggested filename for the page (e.g., 'dashboard', 'vehicle-tracker'). Will be created as residents/{page_name}.html",
        },
        data_sources: {
          type: "array",
          items: { type: "string" },
          description:
            "Supabase tables or data the page should read from (e.g., 'vehicles', 'camera_streams', 'spaces')",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "check_feature_status",
    description:
      "Check the status of the most recent feature build request. Returns progress information including whether it was auto-deployed or sent for team review.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "send_link",
    description:
      "Send a URL or link to the caller via SMS text message. Use this in voice mode when you need to share a URL — never read URLs aloud. Instead, say 'I'll text you the link' and use this tool.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to send",
        },
        message: {
          type: "string",
          description: "A short message to include with the link (e.g., 'Here's the camera feed link you asked for')",
        },
      },
      required: ["url", "message"],
    },
  },
  {
    name: "lookup_codes",
    description:
      "Look up access codes, door codes, locks, WiFi passwords, or other credentials for the property. Use this when someone asks about codes, passwords, locks, keys, doors, or how to access/enter any space. Also use this for questions about whether a door has a lock, what kind of lock it is, or any physical security question.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What the user is looking for (e.g., 'laundry door code', 'wifi password', 'front door', 'garage', 'garage door lock', 'how to get into skyloft')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_document",
    description:
      "Look up an instruction manual or document from the property's document library. Use this when someone asks about how to program, operate, maintain, or troubleshoot equipment, appliances, locks, or other property items. Returns the document content if available as text, or a link to the PDF.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query describing what the user needs help with (e.g., 'door lock programming', 'swim spa maintenance', 'how to change lock code')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "manage_data",
    description:
      "Create, read, update, or delete data in the property management system. Use this for tasks/projects, people, assignments/bookings, bug reports, time entries, events, documents, SMS messages, vehicles, and other operational data. This is the primary tool for all data operations — always prefer this over guessing.",
    parameters: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          enum: [
            "tasks", "people", "assignments", "spaces", "bug_reports",
            "time_entries", "events", "documents", "sms", "vehicles",
            "users", "faq", "feature_requests", "password_vault",
            "invitations", "payments", "media",
          ],
          description: "The data resource to operate on",
        },
        action: {
          type: "string",
          enum: ["list", "get", "create", "update", "delete"],
          description: "The operation to perform",
        },
        id: {
          type: "string",
          description: "Record UUID (required for get/update/delete)",
        },
        data: {
          type: "object",
          description: "Fields to set (for create/update). For tasks: { title, notes, priority (1-4), assigned_name, space_name, status }. For people: { first_name, last_name, email, phone, type }. For bug_reports: { title, description, page_url, severity }.",
        },
        filters: {
          type: "object",
          description: "Filter criteria (for list). Examples: { status: 'open' }, { assigned_name: 'Jon' }, { search: 'keyword' }, { space_name: 'outhouse' }",
        },
      },
      required: ["resource", "action"],
    },
  },
  {
    name: "get_laundry_status",
    description:
      "Get the current status of the LG smart washer and dryer. Returns cycle state, time remaining, and whether the user is subscribed to notifications. Use when someone asks about laundry status, washer/dryer progress, or 'is the laundry done?'.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "control_laundry",
    description:
      "Subscribe or unsubscribe from laundry cycle-end push notifications for a specific appliance (washer or dryer). Use when someone says 'notify me when the washer is done' or 'stop watching the dryer'.",
    parameters: {
      type: "object",
      properties: {
        appliance_id: {
          type: "number",
          description: "The appliance ID from the laundry list",
        },
        appliance_name: {
          type: "string",
          description: "Human-readable name for confirmation",
        },
        action: {
          type: "string",
          enum: ["watch", "unwatch"],
          description: "Subscribe (watch) or unsubscribe (unwatch) from cycle-end notifications",
        },
      },
      required: ["appliance_id", "appliance_name", "action"],
    },
  },
  {
    name: "get_weather",
    description:
      "Get current weather conditions and forecast for the property location (Cedar Creek, TX). Use when someone asks about weather, temperature, rain, or forecast. Returns current temp, humidity, wind, conditions, and hourly forecast.",
    parameters: {
      type: "object",
      properties: {
        forecast_hours: {
          type: "number",
          description: "Number of hours of forecast to include (default 12, max 48)",
        },
      },
      required: [],
    },
  },
  {
    name: "send_notification",
    description:
      "Send an email or SMS message on behalf of the property. Staff and admin only. Use for payment reminders, announcements, custom messages, or any outbound communication to tenants/contacts.",
    parameters: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          enum: ["email", "sms"],
          description: "Communication channel to use",
        },
        to: {
          type: "string",
          description: "Recipient email address (for email) or phone number in E.164 format like +15551234567 (for SMS)",
        },
        recipient_name: {
          type: "string",
          description: "Recipient's name for personalization",
        },
        subject: {
          type: "string",
          description: "Email subject line (required for email, ignored for SMS)",
        },
        message: {
          type: "string",
          description: "Message body. For email, can include basic HTML. For SMS, plain text only (160 char recommended).",
        },
        template_type: {
          type: "string",
          description: "Optional: use a pre-built template instead of custom message. Email templates: payment_reminder, payment_received, general_notification, maintenance_update. SMS templates: payment_reminder, general, bulk_announcement.",
        },
        template_data: {
          type: "object",
          description: "Data to fill template placeholders (e.g., { amount: '$500', due_date: 'Feb 15', period: 'February 2026' })",
        },
        person_id: {
          type: "string",
          description: "Optional: link to person record UUID for tracking",
        },
      },
      required: ["channel", "to", "message"],
    },
  },
  {
    name: "take_snapshot",
    description:
      "Take a snapshot photo from a security camera. Returns a description or URL of the captured image. Use when someone asks to check a camera, see what's happening outside, or wants a photo from a specific camera.",
    parameters: {
      type: "object",
      properties: {
        camera_name: {
          type: "string",
          description: "Camera name from the camera list (e.g., 'Alpacamera', 'Front Of House', 'Side Yard')",
        },
      },
      required: ["camera_name"],
    },
  },
  {
    name: "create_payment_link",
    description:
      "Create a Stripe payment link for collecting payments. Staff and admin only. Generates a secure URL that accepts credit cards, ACH bank transfers, and digital wallets. Use when someone asks to collect a payment, create an invoice, or send a payment request.",
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Payment amount in dollars (e.g., 299.00)",
        },
        description: {
          type: "string",
          description: "Payment description shown to the payer (e.g., 'Weekly Rent - Feb 2, 2026', 'Security Deposit')",
        },
        person_name: {
          type: "string",
          description: "Name of the person being charged (for metadata/tracking)",
        },
        person_email: {
          type: "string",
          description: "Email of the person being charged (prefills checkout)",
        },
        category: {
          type: "string",
          enum: ["rent", "security_deposit", "cleaning_fee", "event_fee", "parking", "utility", "other"],
          description: "Payment category for accounting",
        },
      },
      required: ["amount", "description"],
    },
  },
];

// =============================================
// Reverse Geocoding
// =============================================

const HOME_LAT = 30.13;
const HOME_LNG = -97.46;
const HOME_ADDR = "160 Still Forest Dr, Cedar Creek, TX";

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // Home address override (Nominatim returns wrong house number)
  if (Math.abs(lat - HOME_LAT) < 0.002 && Math.abs(lng - HOME_LNG) < 0.002) {
    return HOME_ADDR;
  }
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "AlpacaPAI/1.0" } }
    );
    if (!resp.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = await resp.json();
    const a = data.address || {};
    const parts: string[] = [];
    const street = a.house_number ? `${a.house_number} ${a.road || ""}` : (a.road || "");
    if (street.trim()) parts.push(street.trim());
    const city = a.city || a.town || a.village || a.hamlet || a.county || "";
    if (city) parts.push(city);
    if (a.state) parts.push(a.state);
    return parts.join(", ") || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

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

      case "announce": {
        const payload: any = {
          action: "announce",
          text: args.message,
          voice: args.voice || "Kore",
        };
        if (args.room) payload.room = args.room;
        if (args.volume) payload.volume = args.volume;

        console.log("PAI → sonos-control announce:", JSON.stringify(payload));
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/sonos-control`,
          { method: "POST", headers: edgeFnHeaders, body: JSON.stringify(payload) }
        );
        const result = await resp.json();
        console.log("PAI ← sonos-control announce response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || result.msg || `HTTP ${resp.status}`;
          return `Error announcing: ${errMsg}`;
        }
        const target = args.room || "all speakers";
        return `OK: Announced "${args.message.substring(0, 80)}" on ${target}`;
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
          const lines = await Promise.all(vehicles.map(async (v) => {
            if (!v.lastState) return `${v.name} (${v.make} ${v.model}): ${v.vehicleState}`;
            let locationPart = "";
            if (v.lastState.latitude != null && v.lastState.longitude != null) {
              const addr = await reverseGeocode(v.lastState.latitude, v.lastState.longitude);
              locationPart = `location: ${addr}${v.lastState.speed_mph ? ` (${v.lastState.speed_mph} mph)` : ""}, `;
            }
            return `${v.name} (${v.make} ${v.model}): ${v.lastState.battery_level ?? "?"}% battery, ${
              v.lastState.range_miles ? v.lastState.range_miles + " mi range, " : ""
            }${locationPart}${v.lastState.locked ? "locked" : "unlocked"}, ${v.vehicleState}${
              v.lastState.charging_state && v.lastState.charging_state !== "Disconnected"
                ? ", charging: " + v.lastState.charging_state
                : ""
            }`;
          }));
          return lines.join("\n");
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
          .select("id, name, description, parent_id, monthly_rate, weekly_rate, nightly_rate, beds_king, beds_queen, beds_double, beds_twin, beds_folding, bath_privacy, bath_fixture, sq_footage, type, is_listed, is_secret, space_amenities(amenity:amenity_id(name, category))")
          .eq("is_archived", false);

        // Role-based visibility:
        // staff+ (level 2+): see all non-archived spaces (unlisted too)
        // resident/associate (level 1): see listed + non-secret spaces
        // unknown/prospect/guest (level 0): see only listed + non-secret (public view)
        if (scope.userLevel < 2) query = query.eq("is_listed", true).eq("is_secret", false);

        if (spaceType === "dwelling") query = query.eq("can_be_dwelling", true);
        else if (spaceType === "event") query = query.eq("can_be_event", true);
        if (args.max_price) query = query.lte("monthly_rate", args.max_price);
        if (args.min_price) query = query.gte("monthly_rate", args.min_price);
        if (args.has_private_bath === true) query = query.eq("bath_privacy", "private");
        else if (args.has_private_bath === false) query = query.eq("bath_privacy", "shared");

        const { data: spaces } = await query.order("monthly_rate", { ascending: false });
        if (!spaces?.length) return "No spaces found matching your criteria.";

        // Load ALL non-archived spaces (lightweight) for parent/child relationship mapping
        // Needed to propagate child unavailability to parent spaces
        const { data: allSpaces } = await supabaseForSearch
          .from("spaces")
          .select("id, parent_id")
          .eq("is_archived", false);

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
        if (args.has_amenity) {
          const amenityQ = args.has_amenity.toLowerCase();
          filtered = filtered.filter((s: any) =>
            (s.space_amenities || []).some((sa: any) => sa.amenity?.name?.toLowerCase().includes(amenityQ))
          );
        }

        // Load assignments for availability
        const { data: assignments } = await supabaseForSearch
          .from("assignments")
          .select("id, start_date, end_date, desired_departure_date, desired_departure_listed, status, assignment_spaces(space_id)")
          .in("status", ["active", "pending_contract", "contract_sent"]);

        // Build a set of all space IDs that have active assignments (for child checking)
        const today = new Date();
        const occupiedSpaceIds = new Set<string>();
        const spaceAvailDates = new Map<string, Date | null>();
        (assignments || []).forEach((a: any) => {
          if (a.status !== "active") return;
          (a.assignment_spaces || []).forEach((as: any) => {
            const effectiveEnd = (a.desired_departure_listed && a.desired_departure_date) || a.end_date;
            if (!effectiveEnd || new Date(effectiveEnd) >= today) {
              occupiedSpaceIds.add(as.space_id);
              if (effectiveEnd) {
                const d = new Date(effectiveEnd);
                const existing = spaceAvailDates.get(as.space_id);
                if (!existing || d > existing) spaceAvailDates.set(as.space_id, d);
              } else {
                spaceAvailDates.set(as.space_id, null); // TBD
              }
            }
          });
        });

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
          let isAvailable = !currentAssignment;
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

          // Propagate child unavailability to parents:
          // If this space has children and any child is occupied, mark parent unavailable
          if (isAvailable && allSpaces) {
            const childIds = allSpaces.filter((s: any) => s.parent_id === space.id).map((s: any) => s.id);
            if (childIds.length > 0) {
              const occupiedChildIds = childIds.filter((id: string) => occupiedSpaceIds.has(id));
              if (occupiedChildIds.length > 0) {
                isAvailable = false;
                // Parent available when ALL children are free — use latest (max) date
                const childDates = occupiedChildIds
                  .map((id: string) => spaceAvailDates.get(id))
                  .filter((d: Date | null | undefined) => d !== undefined);
                if (childDates.some((d: Date | null) => d === null)) {
                  availDate = null;
                  availStr = "Available TBD";
                } else {
                  const validDates = childDates.filter((d: Date | null): d is Date => d !== null);
                  if (validDates.length > 0) {
                    availDate = new Date(Math.max(...validDates.map((d: Date) => d.getTime())));
                    availStr = `Available ${availDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
                  } else {
                    availStr = "Available TBD";
                  }
                }
              }
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
        return finalList.map((s: any) => {
          const amenityNames = (s.space_amenities || []).map((sa: any) => sa.amenity?.name).filter(Boolean);
          const amenityStr = amenityNames.length ? ` | amenities: ${amenityNames.join(", ")}` : "";
          return `${s.name}: ${s.availStr} | ${s.rate}${s.details ? " | " + s.details : ""}${amenityStr}`;
        }).join("\n");
      }

      case "send_link": {
        // Send a URL via SMS to the caller's phone
        if (!scope.callerPhone) {
          return "Cannot send link: caller phone number not available. This tool is for voice calls only.";
        }

        // Load Telnyx config
        const supabaseAdmin2 = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: telnyxConfig } = await supabaseAdmin2
          .from("telnyx_config")
          .select("phone_number")
          .eq("id", 1)
          .single();

        if (!telnyxConfig?.phone_number) {
          return "SMS system not configured. Cannot send link.";
        }

        const smsBody = `${args.message}\n\n${args.url}\n\n— PAI (Alpaca Playhouse)`;

        // Call send-sms edge function
        const smsResp = await fetch(
          `${supabaseUrl}/functions/v1/send-sms`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            },
            body: JSON.stringify({
              to: scope.callerPhone,
              body: smsBody,
              sms_type: "pai_link",
            }),
          }
        );

        if (!smsResp.ok) {
          const errBody = await smsResp.text();
          console.error("send_link SMS error:", errBody);
          return `Failed to send SMS: ${smsResp.status}`;
        }

        return `OK: Link sent via text message to ${scope.callerPhone}`;
      }

      case "lookup_codes": {
        if (scope.role === "demo") return "Access codes are not available in demo mode.";
        const query = (args.query || "").toLowerCase();
        const results: string[] = [];

        // 1. Check space access codes from scope
        for (const [spaceName, code] of Object.entries(scope.spaceAccessCodes)) {
          if (spaceName.toLowerCase().includes(query) || query.includes(spaceName.toLowerCase())) {
            results.push(`${spaceName} access code: ${code}`);
          }
        }

        // 2. Check password vault
        const supabaseAdmin2 = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const allowedCategories = scope.userLevel >= 3
          ? null  // admin: all categories
          : scope.userLevel >= 2
            ? ["house", "platform", "service"]
            : ["house"];

        let vaultQ = supabaseAdmin2
          .from("password_vault")
          .select("service, username, password, category, space_id, notes")
          .eq("is_active", true)
          .ilike("service", `%${query}%`);

        if (allowedCategories) {
          vaultQ = vaultQ.in("category", allowedCategories);
        }

        const { data: vaultEntries } = await vaultQ;

        for (const entry of vaultEntries || []) {
          // Filter space-specific entries by user access
          if (entry.space_id && scope.userLevel < 2 && !scope.allAccessibleSpaceIds.includes(entry.space_id)) {
            continue;
          }
          let line = `${entry.service}: ${entry.password}`;
          if (entry.username) line += ` (username: ${entry.username})`;
          if (entry.notes) line += ` — ${entry.notes}`;
          results.push(line);
        }

        // 3. If no exact match, try broader search for generic terms
        if (!results.length) {
          const genericTerms = ["code", "access", "door", "password", "wifi", "key", "lock", "enter", "open", "get in"];
          if (genericTerms.some(t => query.includes(t))) {
            for (const [spaceName, code] of Object.entries(scope.spaceAccessCodes)) {
              results.push(`${spaceName}: ${code}`);
            }
            // Also fetch all vault entries in allowed categories
            let broadQ = supabaseAdmin2
              .from("password_vault")
              .select("service, username, password, category, space_id, notes")
              .eq("is_active", true);
            if (allowedCategories) broadQ = broadQ.in("category", allowedCategories);
            const { data: broadEntries } = await broadQ;
            for (const entry of broadEntries || []) {
              if (entry.space_id && scope.userLevel < 2 && !scope.allAccessibleSpaceIds.includes(entry.space_id)) continue;
              let line = `${entry.service}: ${entry.password}`;
              if (entry.username) line += ` (username: ${entry.username})`;
              if (entry.notes) line += ` — ${entry.notes}`;
              results.push(line);
            }
          }
        }

        if (!results.length) return "No matching codes or passwords found for your query. Try being more specific (e.g., 'wifi', 'front door', 'laundry').";
        return results.join("\n");
      }

      case "lookup_document": {
        const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const searchQuery = (args.query || "").toLowerCase();

        // Search document_index by keywords and title/description
        const { data: docs } = await supabaseAdmin
          .from("document_index")
          .select("slug, title, description, keywords, storage_bucket, storage_path, content_text, source_url")
          .eq("is_active", true);

        if (!docs?.length) return "No documents found in the library.";

        // Score each document by keyword match
        const scored = docs.map((doc: any) => {
          let score = 0;
          const queryWords = searchQuery.split(/\s+/);
          for (const word of queryWords) {
            if (doc.title.toLowerCase().includes(word)) score += 3;
            if (doc.description.toLowerCase().includes(word)) score += 2;
            if ((doc.keywords || []).some((k: string) => k.toLowerCase().includes(word))) score += 2;
          }
          return { ...doc, score };
        });

        const matches = scored.filter((d: any) => d.score > 0).sort((a: any, b: any) => b.score - a.score);

        if (!matches.length) {
          // No keyword match — list what's available
          const available = docs.map((d: any) => `- ${d.title}: ${d.description}`).join("\n");
          return `No matching documents found for "${args.query}". Available documents:\n${available}`;
        }

        const best = matches[0];
        // Prefer external source_url (Google Drive), fall back to Supabase Storage
        const docUrl = best.source_url
          || (best.storage_bucket && best.storage_path
            ? `${supabaseUrl}/storage/v1/object/public/${best.storage_bucket}/${best.storage_path}`
            : null);

        if (best.content_text) {
          // Return full text content for short documents
          return `Document: ${best.title}${docUrl ? `\nLink: ${docUrl}` : ""}\n\n${best.content_text}`;
        } else {
          // No extracted text — return description and link
          return `Document: ${best.title}\n${best.description}${docUrl ? `\n\nFull document available at: ${docUrl}` : ""}\n\nThis is a large document (the full text isn't stored). You can share the link with the user, or describe what the document covers based on the description above.`;
        }
      }

      case "build_feature": {
        // Permission check: staff+ only
        if (scope.userLevel < 2) {
          return "Permission denied: only staff, admin, and oracle users can request new features.";
        }

        const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

        // Rate limit: check for active builds
        const { data: active } = await supabaseAdmin
          .from("feature_requests")
          .select("id, status")
          .in("status", ["pending", "processing", "building"])
          .limit(1);

        if (active?.length) {
          return "There's already a feature being built. Please wait for it to complete. Ask me 'What's the status of my feature?' to check progress.";
        }

        // Daily limit: 3 per day per user
        const todayStr = new Date().toISOString().slice(0, 10);
        const { count } = await supabaseAdmin
          .from("feature_requests")
          .select("id", { count: "exact", head: true })
          .eq("requester_name", scope.displayName)
          .gte("created_at", todayStr + "T00:00:00Z");

        if ((count || 0) >= 3) {
          return "Daily limit reached (3 feature requests per day). Try again tomorrow.";
        }

        // Insert feature request
        const { error: insertError } = await supabaseAdmin
          .from("feature_requests")
          .insert({
            requester_user_id: scope.appUserId || null,
            requester_name: scope.displayName,
            requester_role: scope.role,
            description: args.description,
            structured_spec: {
              page_name: args.page_name || null,
              data_sources: args.data_sources || [],
            },
            status: "pending",
          });

        if (insertError) {
          return `Error creating feature request: ${insertError.message}`;
        }

        return `Feature request submitted! I'll build "${args.description.substring(0, 80)}..." for you. Safe changes deploy automatically; changes that touch existing pages go to a branch for team review. This typically takes 3-8 minutes. Ask me "What's the status of my feature?" to check progress.`;
      }

      case "check_feature_status": {
        if (scope.userLevel < 2) {
          return "Feature building is only available to staff, admin, and oracle users.";
        }

        const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: latest } = await supabaseAdmin
          .from("feature_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!latest) return "No feature requests found.";

        const statusMessages: Record<string, string> = {
          pending: `Queued and waiting to be picked up by the builder... (requested ${new Date(latest.created_at).toLocaleTimeString()})`,
          processing: latest.progress_message || "Getting started...",
          building: latest.progress_message || "Claude Code is building your feature...",
          completed: `Deployed! ${latest.build_summary || ''}\nFiles: ${(latest.files_created || []).join(', ')}\nVisit: https://alpacaplayhouse.com${latest.build_summary ? '' : '/residents/'}`,
          review: `Built and waiting for team review on branch \`${latest.branch_name}\`.\n${latest.build_summary || ''}\nThe team has been notified. They'll review and merge it when ready.`,
          failed: `Failed: ${latest.error_message || 'Unknown error'}`,
          cancelled: "This request was cancelled.",
        };

        return statusMessages[latest.status] || `Status: ${latest.status}`;
      }

      case "manage_data": {
        // Route to the centralized API edge function
        const apiPayload: any = {
          resource: args.resource,
          action: args.action,
        };
        if (args.id) apiPayload.id = args.id;
        if (args.data) apiPayload.data = args.data;
        if (args.filters) apiPayload.filters = args.filters;
        // Default reasonable limits for PAI queries
        apiPayload.limit = 25;

        const apiResp = await fetch(`${supabaseUrl}/functions/v1/api`, {
          method: "POST",
          headers: edgeFnHeaders,
          body: JSON.stringify(apiPayload),
        });

        const apiResult = await apiResp.json();
        if (apiResult.error) {
          return `API error (${apiResult.code || apiResp.status}): ${apiResult.error}`;
        }

        // Format response for Gemini
        const data = apiResult.data;
        if (Array.isArray(data)) {
          if (data.length === 0) return `No ${args.resource} found matching the criteria.`;
          const count = apiResult.count ?? data.length;
          // Compact JSON for Gemini to interpret
          return `Found ${count} ${args.resource}:\n${JSON.stringify(data, null, 1)}`;
        }
        if (data && typeof data === "object") {
          if (data.deleted) return `Successfully deleted the ${args.resource} record.`;
          return `${args.action === "create" ? "Created" : "Updated"} ${args.resource}:\n${JSON.stringify(data, null, 1)}`;
        }
        return `Operation completed: ${JSON.stringify(apiResult)}`;
      }

      case "get_laundry_status": {
        // Return laundry status from scope (already loaded from DB)
        if (!scope.laundryAppliances.length) {
          return "No laundry appliances are currently configured.";
        }
        return scope.laundryAppliances.map((a) => {
          const st = a.lastState;
          if (!st) return `${a.name} (${a.deviceType}): no data available`;
          const state = st.state || "unknown";
          const parts: string[] = [`${a.name} (${a.deviceType}): ${state}`];
          if (st.remainingTime && st.remainingTime > 0) parts.push(`${st.remainingTime} min remaining`);
          if (st.currentCourse) parts.push(`cycle: ${st.currentCourse}`);
          if (st.currentTemperature) parts.push(`temp: ${st.currentTemperature}`);
          if (st.spinSpeed) parts.push(`spin: ${st.spinSpeed}`);
          if (a.lastSyncedAt) {
            const syncAge = Math.round((Date.now() - new Date(a.lastSyncedAt).getTime()) / 60000);
            parts.push(`(updated ${syncAge} min ago)`);
          }
          return parts.join(" | ");
        }).join("\n");
      }

      case "control_laundry": {
        const appliance = scope.laundryAppliances.find((a) => a.id === args.appliance_id);
        if (!appliance) {
          return `Appliance "${args.appliance_name}" not found in your accessible appliances.`;
        }

        const lgPayload = {
          action: args.action,
          applianceId: args.appliance_id,
        };
        console.log("PAI → lg-control payload:", JSON.stringify(lgPayload));
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/lg-control`,
          { method: "POST", headers: edgeFnHeaders, body: JSON.stringify(lgPayload) }
        );
        const result = await resp.json();
        console.log("PAI ← lg-control response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          const errMsg = result.error || result.message || `HTTP ${resp.status}`;
          return `Error: ${errMsg}`;
        }
        if (args.action === "watch") {
          return `OK: You'll be notified when ${args.appliance_name} finishes its cycle.`;
        }
        return `OK: Stopped watching ${args.appliance_name} for cycle completion.`;
      }

      case "get_weather": {
        // Fetch weather config from DB
        const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: weatherConfig } = await supabaseAdmin
          .from("weather_config")
          .select("owm_api_key, latitude, longitude, location_name")
          .eq("id", 1)
          .single();

        if (!weatherConfig?.owm_api_key) {
          return "Weather service is not configured.";
        }

        const { owm_api_key, latitude, longitude, location_name } = weatherConfig;
        const forecastHours = Math.min(args.forecast_hours || 12, 48);

        // Try One Call API 3.0, fall back to 2.5
        let weatherData: any = null;
        for (const version of ["3.0", "2.5"]) {
          try {
            const url = `https://api.openweathermap.org/data/${version}/onecall?lat=${latitude}&lon=${longitude}&units=imperial&exclude=minutely,daily,alerts&appid=${owm_api_key}`;
            const resp = await fetch(url);
            if (resp.ok) {
              weatherData = await resp.json();
              break;
            }
          } catch { /* try next version */ }
        }

        if (!weatherData) return "Unable to fetch weather data.";

        const current = weatherData.current;
        const lines: string[] = [];
        lines.push(`Current weather in ${location_name || "Cedar Creek, TX"}:`);
        lines.push(`Temperature: ${Math.round(current.temp)}°F (feels like ${Math.round(current.feels_like)}°F)`);
        lines.push(`Conditions: ${current.weather?.[0]?.description || "unknown"}`);
        lines.push(`Humidity: ${current.humidity}%, Wind: ${Math.round(current.wind_speed)} mph`);
        if (current.uvi !== undefined) lines.push(`UV Index: ${current.uvi}`);

        // Rain forecast summary
        const hourly = (weatherData.hourly || []).slice(0, forecastHours);
        const rainHours = hourly.filter((h: any) => (h.pop || 0) >= 0.3);
        if (rainHours.length > 0) {
          const nextRain = rainHours[0];
          const rainTime = new Date(nextRain.dt * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
          lines.push(`Rain expected: ${rainHours.length} of next ${forecastHours} hours have ≥30% chance. Next: ${rainTime} (${Math.round(nextRain.pop * 100)}%)`);
        } else {
          lines.push(`No significant rain expected in the next ${forecastHours} hours.`);
        }

        // Compact hourly forecast
        if (hourly.length > 0) {
          lines.push(`\nHourly forecast (next ${forecastHours}h):`);
          for (const h of hourly) {
            const time = new Date(h.dt * 1000).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/Chicago" });
            const rain = h.pop ? ` (${Math.round(h.pop * 100)}% rain)` : "";
            lines.push(`${time}: ${Math.round(h.temp)}°F, ${h.weather?.[0]?.description || ""}${rain}`);
          }
        }

        // Log API usage (fire-and-forget)
        supabaseAdmin.from("api_usage_log").insert({
          vendor: "openweathermap",
          category: "weather_forecast",
          endpoint: "onecall",
          units: 1,
          unit_type: "api_calls",
          estimated_cost_usd: 0, // Free tier
          metadata: { location: location_name, hours: forecastHours },
          app_user_id: scope.appUserId || null,
        }).then(() => {});

        return lines.join("\n");
      }

      case "send_notification": {
        // Staff+ only
        if (scope.userLevel < 2) {
          return "Permission denied: only staff, admin, and oracle users can send notifications.";
        }

        if (args.channel === "email") {
          const emailPayload: any = {
            to: args.to,
          };
          if (args.template_type) {
            emailPayload.type = args.template_type;
            emailPayload.data = {
              ...args.template_data,
              name: args.recipient_name || "",
            };
            if (args.subject) emailPayload.subject = args.subject;
          } else {
            emailPayload.type = "custom";
            emailPayload.data = {
              html: args.message.replace(/\n/g, "<br>"),
              subject: args.subject || "Message from Alpaca Playhouse",
              text: args.message,
            };
          }

          console.log("PAI → send-email payload:", JSON.stringify({ ...emailPayload, data: "..." }));
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            },
            body: JSON.stringify(emailPayload),
          });
          const result = await resp.json();
          console.log("PAI ← send-email response:", resp.status, JSON.stringify(result));
          if (!resp.ok || result.error) {
            return `Error sending email: ${result.error || `HTTP ${resp.status}`}`;
          }
          return `OK: Email sent to ${args.to}${args.subject ? ` (subject: "${args.subject}")` : ""}`;
        }

        if (args.channel === "sms") {
          const smsPayload: any = {
            to: args.to,
          };
          if (args.template_type) {
            smsPayload.type = args.template_type;
            smsPayload.data = {
              ...args.template_data,
              name: args.recipient_name || "",
              message: args.message,
            };
          } else {
            smsPayload.type = "general";
            smsPayload.data = {
              name: args.recipient_name || "",
              message: args.message,
            };
          }
          if (args.person_id) smsPayload.person_id = args.person_id;

          console.log("PAI → send-sms payload:", JSON.stringify(smsPayload));
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            },
            body: JSON.stringify(smsPayload),
          });
          const result = await resp.json();
          console.log("PAI ← send-sms response:", resp.status, JSON.stringify(result));
          if (!resp.ok || result.error) {
            return `Error sending SMS: ${result.error || `HTTP ${resp.status}`}`;
          }
          return `OK: SMS sent to ${args.to}`;
        }

        return `Unknown channel: ${args.channel}. Use "email" or "sms".`;
      }

      case "take_snapshot": {
        const camera = scope.cameras.find(
          (c) => c.name.toLowerCase() === (args.camera_name || "").toLowerCase()
        );
        if (!camera) {
          const available = scope.cameras.map((c) => c.name).join(", ");
          return `Camera "${args.camera_name}" not found. Available cameras: ${available}`;
        }
        if (!camera.protectId) {
          return `Camera "${camera.name}" does not support snapshots (no Protect ID configured).`;
        }

        const snapshotUrl = `https://cam.alpacaplayhouse.com/camera/${camera.protectId}/snapshot`;
        try {
          const resp = await fetch(snapshotUrl);
          if (!resp.ok) {
            return `Failed to capture snapshot from ${camera.name}: HTTP ${resp.status}`;
          }
          return `OK: Snapshot captured from ${camera.name} (${camera.location}). The snapshot was taken successfully. The camera shows the live view from ${camera.location}. (Direct snapshot link: ${snapshotUrl})`;
        } catch (err) {
          return `Error taking snapshot from ${camera.name}: ${err.message}`;
        }
      }

      case "create_payment_link": {
        if (scope.userLevel < 2) {
          return "Permission denied: only staff and admin users can create payment links.";
        }

        const paymentPayload: any = {
          amount: args.amount,
          description: args.description,
        };
        if (args.person_name) paymentPayload.person_name = args.person_name;
        if (args.person_email) paymentPayload.person_email = args.person_email;
        if (args.category) paymentPayload.category = args.category;

        console.log("PAI → create-payment-link payload:", JSON.stringify(paymentPayload));
        const resp = await fetch(`${supabaseUrl}/functions/v1/create-payment-link`, {
          method: "POST",
          headers: edgeFnHeaders,
          body: JSON.stringify(paymentPayload),
        });
        const result = await resp.json();
        console.log("PAI ← create-payment-link response:", resp.status, JSON.stringify(result));
        if (!resp.ok || result.error) {
          return `Error creating payment link: ${result.error || result.details || `HTTP ${resp.status}`}`;
        }
        return `OK: Payment link created for $${args.amount} — "${args.description}"\nURL: ${result.url}\nShare this link with the payer.`;
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
  callerEmail: string | null;
  callerPhoneFormatted: string | null;
}> {
  if (!callerPhone) return { scope: null, callerName: null, callerGreeting: null, callerType: null, callerEmail: null, callerPhoneFormatted: null };

  const digits = callerPhone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) return { scope: null, callerName: null, callerGreeting: null, callerType: null, callerEmail: null, callerPhoneFormatted: null };

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

  if (!person) return { scope: null, callerName: null, callerGreeting: null, callerType: null, callerEmail: null, callerPhoneFormatted: null };

  const callerName = `${person.first_name || ""} ${person.last_name || ""}`.trim();
  const callerGreeting = person.voice_greeting || null;
  const callerType = person.type || null;
  const callerEmail = person.email || null;
  // Format phone as +1XXXXXXXXXX for SMS
  const callerPhoneFormatted = callerPhone ? `+1${last10}` : null;

  const effectiveRole = PEOPLE_TYPE_TO_ROLE[callerType || ""] || "associate";
  const userLevel = ROLE_LEVEL[effectiveRole] || 0;

  const fakeAppUser = {
    id: "",
    role: effectiveRole,
    email: person.email,
    display_name: callerName,
  };

  const scope = await buildUserScope(supabase, fakeAppUser, userLevel);
  // Attach caller contact info for voice tools (send_link)
  if (scope) {
    scope.callerPhone = callerPhoneFormatted;
    scope.callerEmail = callerEmail;
  }
  return { scope, callerName, callerGreeting, callerType, callerEmail, callerPhoneFormatted };
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

function findTool(name: string): any {
  return TOOL_DECLARATIONS.find((t) => t.name === name);
}

function buildVapiToolsList(scope: UserScope): any[] {
  const tools: any[] = [];
  if (scope.goveeGroups.length) tools.push(vapiToolWrapper(findTool("control_lights")));
  if (scope.userLevel >= 1) tools.push(vapiToolWrapper(findTool("control_sonos")));
  if (scope.userLevel >= 1) tools.push(vapiToolWrapper(findTool("announce")));
  if (scope.nestDevices.length) tools.push(vapiToolWrapper(findTool("control_thermostat")));
  if (scope.teslaVehicles.length) tools.push(vapiToolWrapper(findTool("control_vehicle")));
  tools.push(vapiToolWrapper(findTool("get_device_status")));
  tools.push(vapiToolWrapper(findTool("search_spaces")));
  tools.push(vapiToolWrapper(findTool("lookup_codes")));
  tools.push(vapiToolWrapper(findTool("lookup_document")));
  // Laundry status available to all
  if (scope.laundryAppliances.length) {
    tools.push(vapiToolWrapper(findTool("get_laundry_status")));
    tools.push(vapiToolWrapper(findTool("control_laundry")));
  }
  // Weather available to all
  tools.push(vapiToolWrapper(findTool("get_weather")));
  // Camera snapshots
  if (scope.cameras.some((c) => c.protectId)) tools.push(vapiToolWrapper(findTool("take_snapshot")));
  // Voice callers can have links texted to them
  if (scope.callerPhone) tools.push(vapiToolWrapper(findTool("send_link")));
  // Staff+ can build features, send notifications, create payment links via voice too
  if (scope.userLevel >= 2) {
    tools.push(vapiToolWrapper(findTool("build_feature")));
    tools.push(vapiToolWrapper(findTool("check_feature_status")));
    tools.push(vapiToolWrapper(findTool("send_notification")));
    tools.push(vapiToolWrapper(findTool("create_payment_link")));
  }
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
    const fallbackPaiConfig = await loadPaiConfig(supabase);
    return buildVapiResponse(fallback, null, null, null, null, config.test_mode, [vapiToolWrapper(findTool("search_spaces")), vapiToolWrapper(findTool("lookup_document"))], fallbackPaiConfig);
  }

  // Identify caller, build scope, and load PAI config in parallel
  const [callerResult, paiConfig] = await Promise.all([
    buildVoiceUserScope(supabase, callerPhone),
    loadPaiConfig(supabase),
  ]);
  const { scope, callerName, callerGreeting, callerType } = callerResult;

  // Build system prompt: shared base (identity, devices, property info)
  // + voice-specific addendum from DB
  let systemPrompt: string;
  if (scope && scope.userLevel >= 1) {
    systemPrompt = buildSystemPrompt(scope, paiConfig);
  } else {
    // Unknown/low-level caller: build a minimal scope for the shared prompt
    const minimalScope: UserScope = {
      role: "associate",
      userLevel: 0,
      displayName: callerName || "Unknown Caller",
      appUserId: "",
      assignedSpaceIds: [],
      allAccessibleSpaceIds: [],
      goveeGroups: [],
      nestDevices: [],
      teslaVehicles: [],
      cameras: [],
      laundryAppliances: [],
      spaceAccessCodes: {},
    };
    systemPrompt = buildSystemPrompt(minimalScope, paiConfig);
  }

  // Append voice-specific instructions from DB
  if (assistant.system_prompt?.trim()) {
    systemPrompt += "\n\n" + assistant.system_prompt.trim();
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

  // Voice-specific URL handling
  systemPrompt += `\n\nIMPORTANT VOICE RULE: NEVER read URLs, links, or web addresses aloud — they are impossible to remember by ear. Instead, say something like "I'll text you the link" and use the send_link tool to SMS the URL to the caller's phone. This applies to all URLs: page links, camera feeds, feature status URLs, property pages, etc.`;

  if (config.test_mode) {
    systemPrompt += "\n\n[TEST MODE: This is a test call. Mention that this is a test if asked.]";
  }

  // Build tools based on caller's scope
  const vapiTools = scope ? buildVapiToolsList(scope) : [vapiToolWrapper(findTool("search_spaces")), vapiToolWrapper(findTool("lookup_document"))];

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
      transcriber: {
        provider: assistant.transcriber_provider || "deepgram",
        model: assistant.transcriber_model || "nova-2",
        language: assistant.transcriber_language || "en",
      },
      analysisPlan: {
        summaryPrompt: "Summarize the call in 2-3 sentences. Include what the caller wanted and the outcome.",
      },
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: 0.5,
      ...(assistant.metadata || {}),
    },
  });
}

function buildVapiResponse(assistant: any, callerName: string | null, callerGreeting: string | null, callerType: string | null, scope: UserScope | null, testMode: boolean, tools: any[], paiConfig: PaiConfig): Response {
  let firstMessage = assistant.first_message;
  if (callerName && callerGreeting) {
    firstMessage = `Hey ${callerName.split(" ")[0]}! ${callerGreeting}`;
  } else if (callerName) {
    firstMessage = firstMessage.replace("Greetings!", `Greetings ${callerName.split(" ")[0]}!`);
  }

  // Shared base prompt + voice-specific addendum
  const minimalScope: UserScope = {
    role: "associate",
    userLevel: 0,
    displayName: callerName || "Unknown Caller",
    appUserId: "",
    assignedSpaceIds: [],
    allAccessibleSpaceIds: [],
    goveeGroups: [],
    nestDevices: [],
    teslaVehicles: [],
    cameras: [],
    laundryAppliances: [],
    spaceAccessCodes: {},
  };
  let systemPrompt = buildSystemPrompt(scope || minimalScope, paiConfig);
  if (assistant.system_prompt?.trim()) {
    systemPrompt += "\n\n" + assistant.system_prompt.trim();
  }
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
      transcriber: {
        provider: assistant.transcriber_provider || "deepgram",
        model: assistant.transcriber_model || "nova-2",
        language: assistant.transcriber_language || "en",
      },
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

  // Re-identify caller and rebuild scope (stateless, includes callerPhone/callerEmail)
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
  const { message, conversationHistory = [] }: PaiRequest = body;
  const context = body.context || {};
  const isEmailChannel = context.source === "email";
  const isDiscordChannel = context.source === "discord";
  const isApiChannel = context.source === "api";
  if (!message?.trim()) {
    return jsonResponse({ error: "Message is required" }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let appUser: any;
  let userLevel: number;

  // Email/API channel: internal services call with service role key (no user JWT)
  if ((isEmailChannel || isApiChannel) && token === serviceKey) {
    const senderEmail = (context.sender || "").trim().toLowerCase();
    if (senderEmail) {
      const { data: appUserRow } = await supabase
        .from("app_users")
        .select("id, auth_user_id, role, display_name, email, person_id")
        .ilike("email", senderEmail)
        .limit(1)
        .maybeSingle();
      if (appUserRow?.auth_user_id) {
        const { appUser: resolved, hasPermission: hasPaiPerm } = await getAppUserWithPermission(supabase, appUserRow.auth_user_id, "use_pai");
        if (hasPaiPerm && resolved) {
          appUser = resolved;
          userLevel = ROLE_LEVEL[appUser.role] ?? 1;
        }
      }
    }
    if (!appUser) {
      appUser = {
        id: "",
        role: isApiChannel ? "staff" : "resident",
        display_name: isApiChannel ? "API Caller" : (context.sender || "Email sender"),
        email: context.sender || null,
        person_id: null,
      };
      userLevel = isApiChannel ? ROLE_LEVEL.staff : (ROLE_LEVEL.resident ?? 1);
    }
  } else if (isDiscordChannel && token === serviceKey) {
    // Discord channel: pai-discord bot calls with service role key + discord_user_id
    const discordUserId = (context.discord_user_id || "").trim();
    const discordUserName = context.discord_user_name || "Discord user";
    if (discordUserId) {
      const { data: appUserRow } = await supabase
        .from("app_users")
        .select("id, auth_user_id, role, display_name, email, person_id")
        .eq("discord_id", discordUserId)
        .limit(1)
        .maybeSingle();
      if (appUserRow?.auth_user_id) {
        const { appUser: resolved, hasPermission: hasPaiPerm } = await getAppUserWithPermission(supabase, appUserRow.auth_user_id, "use_pai");
        if (hasPaiPerm && resolved) {
          appUser = resolved;
          userLevel = ROLE_LEVEL[appUser.role] ?? 1;
        }
      }
    }
    if (!appUser) {
      // Unknown Discord user — give basic resident-level access
      appUser = {
        id: "",
        role: "resident",
        display_name: discordUserName,
        email: null,
        person_id: null,
      };
      userLevel = ROLE_LEVEL.resident ?? 1;
    }
  } else {
    // Normal auth: require user JWT
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }
    const { appUser: au, hasPermission: hasPaiPerm } = await getAppUserWithPermission(supabase, user.id, "use_pai");
    if (!hasPaiPerm) {
      return jsonResponse({ error: "Insufficient permissions" }, 403);
    }
    appUser = au;
    userLevel = ROLE_LEVEL[appUser?.role] ?? 0;
  }

  // Impersonation: admin with impersonate_user permission can test as another user
  const impersonateUserId = body.impersonate_user_id;
  if (impersonateUserId) {
    const callerLevel = ROLE_LEVEL[appUser?.role] ?? 0;
    if (callerLevel < 3) {
      return jsonResponse({ error: "Only admins can impersonate users" }, 403);
    }
    const { hasPermission: canImpersonate } = await getAppUserWithPermission(supabase, (await supabase.auth.getUser(token)).data?.user?.id, "impersonate_user");
    if (!canImpersonate) {
      return jsonResponse({ error: "Missing impersonate_user permission" }, 403);
    }
    const { data: targetUser } = await supabase
      .from("app_users")
      .select("id, role, display_name, email, person_id")
      .eq("id", impersonateUserId)
      .single();
    if (!targetUser) {
      return jsonResponse({ error: "Target user not found" }, 404);
    }
    console.log(`PAI impersonation: ${appUser.display_name} (${appUser.role}) → ${targetUser.display_name} (${targetUser.role})`);
    appUser = targetUser;
    userLevel = ROLE_LEVEL[targetUser.role] ?? 0;
  }

  const channelName = isEmailChannel ? "email" : isDiscordChannel ? "discord" : isApiChannel ? "api" : "chat";
  console.log(`PAI ${channelName} from ${appUser.display_name} (${appUser.role}): ${message.substring(0, 100)}`);

  // 3. Build scope and load PAI config in parallel
  const [scope, paiConfig] = await Promise.all([
    buildUserScope(supabase, appUser, userLevel),
    loadPaiConfig(supabase),
  ]);

  // 3a. Get supabase URL for tool calls
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

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

  // 4. Build system prompt (shared base + channel-specific addendum)
  let systemPrompt = buildSystemPrompt(scope, paiConfig);
  if (isEmailChannel && paiConfig.email_addendum?.trim()) {
    systemPrompt += "\n\n" + paiConfig.email_addendum.trim();
  } else if (isDiscordChannel && paiConfig.discord_addendum?.trim()) {
    systemPrompt += "\n\n" + paiConfig.discord_addendum.trim();
  } else if (isApiChannel) {
    // API channel: apply api_addendum from DB config, then any request-level addendum
    if (paiConfig.api_addendum?.trim()) {
      systemPrompt += "\n\n" + paiConfig.api_addendum.trim();
    }
    if (context.api_addendum?.trim()) {
      systemPrompt += "\n\n" + context.api_addendum.trim();
    }
  } else if (!isEmailChannel && !isDiscordChannel && !isApiChannel && paiConfig.chat_addendum?.trim()) {
    systemPrompt += "\n\n" + paiConfig.chat_addendum.trim();
  }

  // 5. Build Gemini conversation
  const contents: any[] = [];

  const recentHistory = conversationHistory.slice(-12);
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
        token,
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

  // Log interaction for kiosk PAI counter (skip when email sender has no app_user id)
  if (appUser.id) {
    try {
      await supabase.from('pai_interactions').insert({
        app_user_id: appUser.id,
        source: channelName,
        message_preview: message.substring(0, 100),
      });
    } catch (_) { /* non-critical */ }
  }

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
