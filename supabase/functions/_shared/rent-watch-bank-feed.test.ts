import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dedupeAgainstLedger, feedRowToLedger } from "./rent-watch-bank-feed.ts";
import { checkPeriod, type RentWatch } from "./rent-watch.ts";

const watch: RentWatch = {
  label: "Tenant A", match_names: ["tenant a"], expected_amount: 495, due_day: 1, prepay_days: 14, starts_on: null, ends_on: null,
};

Deno.test("bank line 'ZELLE FROM TENANT A' counts as that tenant's rent", () => {
  const row = feedRowToLedger({ transaction_date: "2026-11-03", amount: 495, payer_label: null, description: "ZELLE FROM TENANT A" });
  assertEquals(checkPeriod(watch, [row], "2026-11", "2026-11-25").state, "paid");
});

Deno.test("a bank line for someone else does not count", () => {
  const row = feedRowToLedger({ transaction_date: "2026-11-03", amount: 495, payer_label: null, description: "ZELLE FROM SOMEONE ELSE" });
  assertEquals(checkPeriod(watch, [row], "2026-11", "2026-11-25").state, "late");
});

Deno.test("a feed row the ledger already has is dropped, so rent is not counted twice", () => {
  const ledger = [feedRowToLedger({ transaction_date: "2026-10-23", amount: 495, payer_label: "Tenant A", description: "Cash App" })];
  const feed = [feedRowToLedger({ transaction_date: "2026-10-23", amount: 495, payer_label: "Tenant A", description: "Cash App payment" })];
  assertEquals(dedupeAgainstLedger(feed, ledger).length, 0);
});

Deno.test("a feed row on a different day is kept", () => {
  const ledger = [feedRowToLedger({ transaction_date: "2026-10-23", amount: 495, payer_label: null, description: "x" })];
  const feed = [feedRowToLedger({ transaction_date: "2026-11-03", amount: 495, payer_label: null, description: "ZELLE FROM TENANT A" })];
  assertEquals(dedupeAgainstLedger(feed, ledger).length, 1);
});
