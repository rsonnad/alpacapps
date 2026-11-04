/**
 * Event request form fields, shared by event-intake-voice (the chat panel)
 * and event-request-agent (the "let my AI assistant fill this out" API), so
 * both use one whitelist and one set of validation rules.
 *
 * Neither path may set acknowledgments, the deposit, a partner code or card
 * data: those stay a manual step for the guest on the page.
 */

// Fields the AI may fill. Anything else it returns is dropped.
export const STRING_FIELDS = [
  "first_name", "last_name", "email", "phone", "organization_name",
  "event_name", "event_type", "event_date", "event_start_time", "event_end_time",
  "event_description", "ticket_price_range",
  "setup_staff_name", "setup_staff_phone", "cleanup_staff_name", "cleanup_staff_phone",
  "parking_manager_name", "parking_manager_phone",
  "marketing_materials_link", "special_requests",
] as const;

export const REQUIRED_FIELDS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  email: "email",
  phone: "phone",
  event_name: "event name",
  event_type: "event type",
  expected_guests: "number of guests",
  event_date: "event date",
  event_start_time: "start time",
  event_end_time: "end time",
  event_description: "event description",
  spaces: "spaces",
  setup_staff_name: "setup coordinator name",
  setup_staff_phone: "setup coordinator phone",
  cleanup_staff_name: "cleanup coordinator name",
  cleanup_staff_phone: "cleanup coordinator phone",
  parking_manager_name: "parking coordinator name",
  parking_manager_phone: "parking coordinator phone",
};

/** The event types the form's <select> offers (value -> label). Keep in sync with rentals/hostevent/index.html. */
export const EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "party", label: "Party / Celebration" },
  { value: "workshop", label: "Workshop / Class" },
  { value: "retreat", label: "Retreat" },
  { value: "ceremony", label: "Ceremony" },
  { value: "meeting", label: "Meeting / Gathering" },
  { value: "photoshoot", label: "Photoshoot" },
  { value: "other", label: "Other" },
];

export function clean(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** Validate one proposed field value. Returns null to drop it. */
export function validateField(name: string, raw: unknown, eventTypes: string[], today: string): unknown {
  if (raw === null || raw === undefined) return null;
  switch (name) {
    case "expected_guests": {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
    }
    case "is_ticketed":
      return typeof raw === "boolean" ? raw : null;
    case "email": {
      const s = clean(raw, 200)?.toLowerCase().replace(/\s/g, "") ?? null;
      return s && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s) ? s : null;
    }
    case "event_type": {
      const s = clean(raw, 40)?.toLowerCase() ?? null;
      return s && eventTypes.includes(s) ? s : null;
    }
    case "event_date": {
      const s = clean(raw, 10);
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + "T12:00:00Z"))) return null;
      return s >= today ? s : null;
    }
    case "event_start_time":
    case "event_end_time": {
      const m = clean(raw, 8)?.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const h = Number(m[1]), min = Number(m[2]);
      return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
    }
    case "marketing_materials_link": {
      const s = clean(raw, 300);
      return s && !/\s/.test(s) && /\.[a-z]{2,}/i.test(s) && !/^(javascript|data):/i.test(s) ? s : null;
    }
    case "event_description":
    case "special_requests":
      return clean(raw, 2000);
    default:
      if (name.endsWith("_phone") || name === "phone") {
        const s = clean(raw, 40);
        return s && (s.match(/\d/g) || []).length >= 7 ? s : null;
      }
      return clean(raw, 200);
  }
}
