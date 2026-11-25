/**
 * Second source for the rent watch: the finleg bank feed (rent-payments-api), read-only.
 * It sees Zelle deposits that never reach the AlpacApps ledger by name, because US Bank Zelle
 * emails carry no payer name but the bank line ("ZELLE FROM <NAME>") does.
 *
 * The key lives in the function secret RENT_PAYMENTS_API_KEY (Bitwarden item "finleg rent-payments-api key").
 * It is an owner-level key, so this module asks only for the two Playhouse-relevant property
 * buckets and never logs rows or the key. If the feed is down, the digest still runs on the ledger alone.
 */

import type { LedgerRow } from "./rent-watch.ts";

const FEED_URL = "https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/rent-payments-api/payments";
const PROPERTIES = ["alpacaplayhouse", "unassigned"];

export interface FeedRow {
  transaction_date: string;
  amount: number;
  payer_label: string | null;
  description: string | null;
}

/** Turn a bank-feed row into the same shape as a ledger row so checkPeriod can count it. */
export function feedRowToLedger(r: FeedRow): LedgerRow {
  return {
    person_name: [r.payer_label, r.description].filter(Boolean).join(" ").toLowerCase(),
    amount: Number(r.amount),
    transaction_date: r.transaction_date,
    period_start: null,
    period_end: null,
    status: "completed",
    is_test: false,
    direction: "income",
  };
}

/** Drop feed rows the ledger already has (same day and amount), so nothing is counted twice. */
export function dedupeAgainstLedger(feed: LedgerRow[], ledger: LedgerRow[]): LedgerRow[] {
  const seen = new Set(ledger.map((l) => `${l.transaction_date}|${Number(l.amount).toFixed(2)}`));
  const out: LedgerRow[] = [];
  for (const f of feed) {
    const k = `${f.transaction_date}|${Number(f.amount).toFixed(2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** Fetch bank-feed rows since a date. Returns { rows, error }; never throws. */
export async function fetchBankFeed(since: string): Promise<{ rows: LedgerRow[]; error: string | null }> {
  const key = Deno.env.get("RENT_PAYMENTS_API_KEY");
  if (!key) return { rows: [], error: "RENT_PAYMENTS_API_KEY not set" };
  try {
    const rows: LedgerRow[] = [];
    for (const property of PROPERTIES) {
      const res = await fetch(`${FEED_URL}?property=${property}&date_from=${since}`, {
        headers: { "x-api-key": key, "x-agent-name": "alpacapps-rent-watch" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { rows: [], error: `bank feed answered ${res.status}` };
      const body = await res.json();
      for (const r of (body.rows || []) as FeedRow[]) rows.push(feedRowToLedger(r));
    }
    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: `bank feed unreachable: ${(err as Error)?.name || "error"}` };
  }
}
