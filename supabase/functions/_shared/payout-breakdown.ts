/**
 * Build a per-day breakdown of time_entries for a payout email.
 * Returns rows like:
 *   { date, label, hours, amount, descriptions: string[] }
 *
 * Used by pay-pending-associates, stripe-payout, paypal-payout so all three
 * payout paths render the same "Days paid" table via the
 * `associate_payout_sent` email template.
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
  totalAmount: number;
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
}

/**
 * Build breakdown from already-fetched entries.
 * Pass `taskNamesById` (optional) to substitute task names for time_entries
 * that have no inline description but do have a task_id.
 */
export function rollupEntries(
  entries: MinimalEntry[],
  hourlyRate: number,
  taskNamesById?: Record<string, string>
): PayoutBreakdown {
  const byDate = new Map<string, { hours: number; descriptions: Set<string> }>();
  let totalHours = 0;

  for (const e of entries) {
    if (!e.clock_out) continue;
    const date = e.clock_in.slice(0, 10);
    const hours =
      (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) /
      3_600_000;
    if (hours <= 0) continue;
    totalHours += hours;

    const slot = byDate.get(date) || { hours: 0, descriptions: new Set<string>() };
    slot.hours += hours;

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
      const amount = Math.round(v.hours * hourlyRate * 100) / 100;
      return {
        date,
        label,
        hours: Math.round(v.hours * 100) / 100,
        amount,
        descriptions: Array.from(v.descriptions),
      };
    });

  const totalAmount = Math.round(totalHours * hourlyRate * 100) / 100;
  const dates = rows.map((r) => r.date);
  return {
    totalHours: Math.round(totalHours * 100) / 100,
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
  hourlyRate: number
): Promise<PayoutBreakdown> {
  if (!timeEntryIds || timeEntryIds.length === 0) {
    return {
      totalHours: 0,
      totalAmount: 0,
      entryCount: 0,
      dayCount: 0,
      period: { first: "", last: "" },
      rows: [],
    };
  }
  const { data: entries } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out, description, task_id")
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

  return rollupEntries(list, hourlyRate, taskNames);
}
