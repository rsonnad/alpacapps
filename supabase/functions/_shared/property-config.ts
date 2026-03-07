/**
 * Property configuration loader for edge functions.
 * Fetches operational identity from `property_config` table.
 * Per-invocation cache (edge functions are short-lived).
 */

const FALLBACK_CONFIG: Record<string, any> = {
  property: {
    name: "Alpaca Playhouse",
    short_name: "AlpacApps",
    tagline: "We put the AI into Alpacas",
    address: "160 Still Forest Dr, Cedar Creek, TX 78612",
    city: "Cedar Creek",
    state: "TX",
    zip: "78612",
    country: "US",
    latitude: 30.13,
    longitude: -97.46,
    timezone: "America/Chicago",
  },
  domain: {
    primary: "alpacaplayhouse.com",
    github_pages: "rsonnad.github.io/alpacapps",
    camera_proxy: "cam.alpacaplayhouse.com",
  },
  email: {
    team: "team@alpacaplayhouse.com",
    admin_gmail: "alpacaplayhouse@gmail.com",
    notifications_from: "notifications@alpacaplayhouse.com",
    noreply_from: "noreply@alpacaplayhouse.com",
    automation: "alpacaautomatic@gmail.com",
  },
  payment: {
    zelle_email: "alpacaplayhouse@gmail.com",
    venmo_handle: "@AlpacaPlayhouse",
  },
  ai_assistant: {
    name: "PAI",
    full_name: "Prompt Alpaca Intelligence",
    personality: "the AI assistant for the property",
    email_from: "pai@alpacaplayhouse.com",
  },
  wifi: {
    network_name: "Black Rock City",
  },
  mobile_app: {
    name: "Alpaca Playhouse",
    id: "com.alpacaplayhouse.app",
  },
};

let _cached: Record<string, any> | null = null;

export async function getPropertyConfig(
  supabase: any
): Promise<Record<string, any>> {
  if (_cached) return _cached;

  try {
    const { data, error } = await supabase
      .from("property_config")
      .select("config")
      .eq("id", 1)
      .single();

    if (error || !data?.config) {
      _cached = FALLBACK_CONFIG;
    } else {
      _cached = { ...FALLBACK_CONFIG, ...data.config };
    }
  } catch (_e) {
    _cached = FALLBACK_CONFIG;
  }

  return _cached!;
}

export function getFallbackConfig(): Record<string, any> {
  return FALLBACK_CONFIG;
}
