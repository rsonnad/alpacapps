/**
 * Rent watch: decide, per watched payer and per month, whether rent has arrived.
 * Pure functions so they can be tested without a database. Dates are 'YYYY-MM-DD'
 * strings (Chicago calendar dates); months are 'YYYY-MM'.
 */

export interface RentWatch {
  label: string;
  match_names: string[];       // lowercase substrings matched against ledger.person_name
  expected_amount: number;
  due_day: number;             // day of month rent is due
  prepay_days: number;         // a payment this many days before the 1st still counts for the month
  starts_on: string | null;
  ends_on: string | null;
}

export interface LedgerRow {
  person_name: string | null;
  amount: number;
  transaction_date: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  is_test: boolean;
  direction: string;
}

export type RentState = "paid" | "partial" | "waiting" | "due_today" | "late" | "inactive";

export interface PeriodResult {
  label: string;
  month: string;
  state: RentState;
  expected: number;
  received: number;
  owed: number;
  daysLate: number;
}

const COUNTS = new Set(["pending", "completed"]);

function monthStart(month: string): string { return `${month}-01`; }

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function countsForMonth(w: RentWatch, r: LedgerRow, month: string): boolean {
  if (r.direction !== "income" || r.is_test || !COUNTS.has(r.status)) return false;
  const name = (r.person_name || "").toLowerCase();
  if (!w.match_names.some((n) => name.includes(n.toLowerCase()))) return false;
  const start = monthStart(month);
  const end = monthEnd(month);
  if (r.period_start) {
    const pEnd = r.period_end || r.period_start;
    return r.period_start <= end && pEnd >= start;
  }
  return r.transaction_date >= addDays(start, -w.prepay_days) && r.transaction_date <= end;
}

export function checkPeriod(w: RentWatch, rows: LedgerRow[], month: string, today: string): PeriodResult {
  const base = { label: w.label, month, expected: w.expected_amount, received: 0, owed: w.expected_amount, daysLate: 0 };
  if ((w.starts_on && w.starts_on > monthEnd(month)) || (w.ends_on && w.ends_on < monthStart(month))) {
    return { ...base, state: "inactive", owed: 0 };
  }
  const received = round2(rows.filter((r) => countsForMonth(w, r, month)).reduce((t, r) => t + (Number(r.amount) || 0), 0));
  const owed = Math.max(0, round2(w.expected_amount - received));
  if (owed === 0) return { ...base, state: "paid", received, owed: 0 };

  const dueDate = `${month}-${String(w.due_day).padStart(2, "0")}`;
  const daysLate = dayDiff(today, dueDate);
  if (daysLate < 0) return { ...base, state: "waiting", received, owed };
  if (daysLate === 0) return { ...base, state: "due_today", received, owed };
  return { ...base, state: received > 0 ? "partial" : "late", received, owed, daysLate };
}

/** Always on the 1st and 2nd; after that only while something is unpaid. */
export function shouldSendDigest(today: string, anyUnpaid: boolean): boolean {
  const day = Number(today.slice(8, 10));
  return day <= 2 || anyUnpaid;
}
