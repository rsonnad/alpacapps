/**
 * Build a per-day breakdown of time_entries for a payout email.
 * Returns rows like:
 *   { date, label, hours, amount, descriptions: string[] }
 *
 * Used by pay-pending-associates, stripe-payout, paypal-payout and
 * weekly-payroll-summary. It is the ONE place a payout amount is computed, so
 * every path pays (and shows) the same number for the same entries:
 *
 *   amount = Σ entry hours × entry.hourly_rate (profile rate if the entry has none)
 *          + daily_extra × distinct work days (America/Chicago clock_in date)
 *
 * Why the entry rate: time_entries.hourly_rate is snapshotted at clock-in, so
 * a later raise or cut on the profile doesn't reprice work already done. Paths
 * that used the profile's current rate disagreed with the staff UI (entry rate)
 * whenever a rate changed.
 */

export interface DailyBreakdownRow {
  date: string;          // ISO yyyy-mm-dd
  label: string;         // "Mon, Apr 06"
  hours: number;
  amount: number;
  descriptions: string[]; // task descriptions for that day (deduped)
}

export interface PayoutBreakdown {
  totalHours: number;
  hourlyAmount: number;   // Σ hours × rate
  dailyExtra: number;     // per-day stipend used
  extraAmount: number;    // dailyExtra × dayCount
  totalAmount: number;    // hourlyAmount + extraAmount — the amount to pay
  entryCount: number;
  dayCount: number;
  period: { first: string; last: string };
  rows: DailyBreakdownRow[];
}

interface MinimalEntry {
  clock_in: string;
  clock_out: string | null;
  description?: string | null;
  task_id?: string | null;
  hourly_rate?: number | string | null;
}

// Work days are Central calendar days. Grouping by the UTC date (the old
// clock_in.slice(0, 10)) split any evening after 7 PM CDT into the next day,
// so two shifts on one day could earn daily_extra twice.
const workDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function entryRate(e: MinimalEntry, fallbackRate: number): number {
  const r = parseFloat(e.hourly_rate as string);
  return Number.isFinite(r) ? r : fallbackRate;
}

/**
 * Build breakdown from already-fetched entries.
 * Pass `taskNamesById` (optional) to substitute task names for time_entries
 * that have no inline description but do have a task_id.
 */
export function rollupEntries(
  entries: MinimalEntry[],
  hourlyRate: number,
  taskNamesById?: Record<string, string>,
  dailyExtra = 0
): PayoutBreakdown {
  const byDate = new Map<string, { hours: number; amount: number; descriptions: Set<string> }>();
  let totalHours = 0;
  let hourlyAmountRaw = 0;

  for (const e of entries) {
    if (!e.clock_out) continue;
    const date = workDay(e.clock_in);
    const hours =
      (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) /
      3_600_000;
    if (hours <= 0) continue;
    totalHours += hours;
    const amt = hours * entryRate(e, hourlyRate);
    hourlyAmountRaw += amt;

    const slot = byDate.get(date) || { hours: 0, amount: 0, descriptions: new Set<string>() };
    slot.hours += hours;
    slot.amount += amt;

    const desc = (e.description || "").trim();
    if (desc) {
      slot.descriptions.add(desc);
    } else if (e.task_id && taskNamesById?.[e.task_id]) {
      slot.descriptions.add(taskNamesById[e.task_id]);
    }
    byDate.set(date, slot);
  }

  const rows: DailyBreakdownRow[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const d = new Date(`${date}T12:00:00`);
      const label = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const amount = Math.round((v.amount + (dailyExtra || 0)) * 100) / 100;
      return {
        date,
        label,
        hours: Math.round(v.hours * 100) / 100,
        amount,
        descriptions: Array.from(v.descriptions),
      };
    });

  const extra = dailyExtra > 0 ? dailyExtra : 0;
  const hourlyAmount = Math.round(hourlyAmountRaw * 100) / 100;
  const extraAmount = Math.round(extra * rows.length * 100) / 100;
  const totalAmount = Math.round((hourlyAmount + extraAmount) * 100) / 100;
  const dates = rows.map((r) => r.date);
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    hourlyAmount,
    dailyExtra: extra,
    extraAmount,
    totalAmount,
    entryCount: entries.filter((e) => e.clock_out).length,
    dayCount: rows.length,
    period: {
      first: dates[0] || "",
      last: dates[dates.length - 1] || "",
    },
    rows,
  };
}

/**
 * Convenience: fetch entries by id list (and any referenced tasks)
 * via a Supabase JS client and return the rolled-up breakdown.
 *
 * `supabase` is a `@supabase/supabase-js` client passed in by the caller —
 * we don't import it here so this helper stays usable from any function
 * regardless of which client version that function pins.
 */
export async function buildBreakdownByEntryIds(
  supabase: any,
  timeEntryIds: string[],
  hourlyRate: number,
  dailyExtra = 0
): Promise<PayoutBreakdown> {
  if (!timeEntryIds || timeEntryIds.length === 0) {
    return {
      totalHours: 0,
      hourlyAmount: 0,
      dailyExtra: 0,
      extraAmount: 0,
      totalAmount: 0,
      entryCount: 0,
      dayCount: 0,
      period: { first: "", last: "" },
      rows: [],
    };
  }
  const { data: entries } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out, description, task_id, hourly_rate")
    .in("id", timeEntryIds);

  const list: MinimalEntry[] = entries || [];
  const taskIds = Array.from(
    new Set(list.map((e) => e.task_id).filter(Boolean))
  ) as string[];

  let taskNames: Record<string, string> = {};
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title")
      .in("id", taskIds);
    for (const t of tasks || []) {
      if (t.title) taskNames[t.id] = t.title;
    }
  }

  return rollupEntries(list, hourlyRate, taskNames, dailyExtra);
}
